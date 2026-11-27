#!/usr/bin/env python3
import json
import os
from pipeline.db.connection import init_db, init_cache_db
from pipeline.core.logger import setup_pipeline_logger
from pipeline.core.audit import AUDIT_FILE, _audit, start_audit
from pipeline.core.extra_evidence import add_extra_evidence
from pipeline.core.scoring_config import MERGE_THRESHOLD
from pipeline.stages.institution_clustering import (
    collapse_paper_local_institutions,
    merge_global_institutions_fuzzy,
)
from pipeline.stages.pairwise_scoring import (
    _build_author_records,
    collect_pairwise_evidence,
    apply_scored_merges
)
import pipeline.stages.apply_merges as apply_merges
import pipeline.stages.ror_enrichment as ror_enrich
import pipeline.stages.ror_gravity as ror_int
from pipeline.stages.affiliations import recover_affiliations
from pipeline.stages.duplicates import find_duplicate_papers
from pipeline.stages.reset import reset_decisions

logger = setup_pipeline_logger("merge", "merge.log")

script_dir = os.path.dirname(os.path.abspath(__file__))
MERGES_FILE = os.path.join(script_dir, "../../data/merges.json")

def apply_manual_overrides() -> tuple[dict, dict]:
    """Apply author/institution pairs from merges.json.  These always win."""
    if not os.path.exists(MERGES_FILE):
        return {}, {}
    with open(MERGES_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    auth_merges = {}
    inst_merges = {}

    for bad, good in data.get("authors", {}).items():
        logger.debug(f"    [Manual Override] Author:       {bad} → {good}")
        auth_merges[bad] = good
        _audit({"action": "manual-author", "id_keep": good, "id_merge": bad})

    for bad, good in data.get("institutions", {}).items():
        logger.debug(f"    [Manual Override] Institution:  {bad} → {good}")
        inst_merges[bad] = good
        _audit({"action": "manual-institution", "id_keep": good, "id_merge": bad})
        
    return auth_merges, inst_merges

# ══════════════════════════════════════════════════════════════════════════════
# MAIN ORCHESTRATOR
# ══════════════════════════════════════════════════════════════════════════════

def _banner(text: str) -> None:
    w = 60
    logger.info(f"\n{'═' * w}")
    logger.info(f"  {text}")
    logger.info(f"{'═' * w}")

def _step(label: str, result, unit: str = "") -> None:
    n = result if isinstance(result, int) else sum(result)
    tag = f"  {n} {unit}" if unit else f"  {result}"
    logger.info(f"  ✓  {label:<42}  {tag}")

def main() -> None:
    init_db()
    init_cache_db()
    
    _banner("Data Cleaning & Entity Resolution Pipeline")

    # Every run decides from the raw data alone (pipeline/stages/reset.py).
    start_audit()
    for label, n in reset_decisions().items():
        _step(label.capitalize(), n, "row(s)")


    # Papers OpenAlex holds twice under one DOI: one copy is kept, the rest are left out of the merging and the build.
    _step("Duplicate papers set aside", find_duplicate_papers(), "paper(s)")

    # Institutions for author rows OpenAlex left without one, from the affiliation printed on the paper.
    recovered = recover_affiliations()
    _step("Affiliations recovered", recovered.get("rows recovered", 0), "author row(s)")

    logger.info("\n  STAGE: Institution Consolidation\n")
    
    corrections = ror_enrich.enrich_missing_locations()
    _step("Missing Location Enrichment", corrections, "institution(s) resolved")

    # 1. Author Gravity Correction
    author_inst_merges = ror_int.run_ror_phases()
    apply_merges.apply_author_inst_merges(author_inst_merges)
    _step("Author Gravity Correction (ROR cross-location)", len(author_inst_merges), "correction(s)")
    
    fallback_author_merges = ror_int.correct_author_gravity_fallback()
    apply_merges.apply_author_inst_merges(fallback_author_merges)
    _step("Fallback Author Gravity Correction", len(fallback_author_merges), "correction(s)")

    # 2. Paper-Local Collapse (before fuzzy merges alter canonical_inst_id)
    paper_local_inst = collapse_paper_local_institutions()
    apply_merges.apply_paper_local_merges(paper_local_inst)
    _step("Paper-local institution collapse", len(paper_local_inst), "correction(s)")

    # 3. Global Institution Merges
    fallback_global_merges = merge_global_institutions_fuzzy()
    apply_merges.apply_inst_merges(fallback_global_merges)
    _step("Global Inst Merge (Fuzzy)", len(fallback_global_merges), "correction(s)")

    logger.info("\n  STAGE: Evidence Collection\n")
    logger.info("    [Evidence] Analyzing author pairs and computing unified scores... (this may take a minute)")
    authors = _build_author_records()
    G       = collect_pairwise_evidence(authors)

    edges_above = sum(1 for u, v, d in G.edges(data=True) if d.get('weight', 0) >= MERGE_THRESHOLD)
    edges_below = G.number_of_edges() - edges_above
    logger.info(f"  ✓  Candidate pairs scored: {G.number_of_edges():,}  "
          f"(≥threshold: {edges_above}, below: {edges_below})")

    # Extra merge evidence from EXTRA_EVIDENCE modules, if configured.
    for label, count, detail in add_extra_evidence(G, authors):
        _step(label, count, detail) if count is not None else logger.info(f"  -  {label:<45} skipped ({detail})")

    logger.info("\n  STAGE: Decision & Commit\n")

    author_merges, refused = apply_scored_merges(G, authors)
    apply_merges.apply_author_merges(author_merges)
    _step("Scored merges applied", len(author_merges), "merge(s)")
    _step("Joins refused", sum(refused.values()),
          "(" + ", ".join(f"{n:,} {why}" for why, n in sorted(refused.items())) + ")")

    manual_a_merges, manual_i_merges = apply_manual_overrides()
    apply_merges.apply_author_merges(manual_a_merges, flatten=True)
    apply_merges.apply_inst_merges(manual_i_merges, flatten=True)
    _step("Manual overrides", len(manual_a_merges) + len(manual_i_merges), f"({len(manual_a_merges)} authors, {len(manual_i_merges)} institutions)")

    _banner(f"Done  |  audit → {AUDIT_FILE}")

if __name__ == "__main__":
    main()
