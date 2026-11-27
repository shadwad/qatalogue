#!/usr/bin/env python3
"""
Validate serve.db.tmp before finalize_build.py swaps it into serve.db (exits 1 on failure).

Checks fail when:
  - any venue-year in pipeline/config/scope.json is missing or has a stale topic filter in fetch_shards;
  - serve.db.tmp or any required served table is missing or empty;
  - any author listed in optional data/suppressions.json remains named or searchable in serve.db.tmp or default summaries;
  - paper_facts shrinks by > 10% compared to the live serve.db (unless --allow-shrink).

Also logs per-year coverage gaps and unmatched entries in answer_key/overrides/merges/suppressions.

Usage
  python pipeline/scripts/check_build.py [--allow-shrink]          (make check CHECK_ARGS=--allow-shrink)
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sqlite3
import statistics
import sys
from pathlib import Path

from pipeline.core import suppressions
from pipeline.core.logger import setup_pipeline_logger
from pipeline.core.paper_ids import PaperIds
from pipeline.core.publish import DEFAULT_RESEARCHERS, DEFAULT_SUMMARIES, PUBLIC_DIR
from pipeline.core.scope import load_scope
from pipeline.db.connection import SERVE_DB_PATH, SERVE_TMP_PATH, STAGING_DB_PATH, open_readonly

logger = setup_pipeline_logger("check", "check.log")
ROOT = Path(__file__).resolve().parents[2]

# Tables the site reads; each must exist and have rows.
SERVED_TABLES = [
    "paper_facts", "author_paper_facts", "author_institution_paper_facts", "authors", "institutions",
    "paper_topics", "paper_subtopics", "paper_platforms", "paper_venues",
    "performance_summary", "performance_summary_meta", "performance_summary_dimensions",
    "performance_summary_contributors", "location_dimension", "authors_fts", "institutions_fts",
    "paper_search", "paper_index", "paper_index_meta", "institution_geo",
]
SHRINK_LIMIT = 0.10
SHARE_GAP = 10.0  # percentage points from the other years' median


def check_shards(staging, scope, failures, notes):
    have = {(v, y): (f, e, p) for v, y, f, e, p in
            staging.execute("SELECT venue_id, year, topic_filter, expected, papers FROM fetch_shards")}
    if not have:
        notes.append("Staging has no fetch record (it was fetched before the import kept one), so venue-years "
                     "can't be checked; the next full fetch records them")
        return
    missing, stale, short = [], [], []
    for venue in scope.venues:
        for year in scope.years:
            row = have.get((venue.openalex_id, year))
            if row is None:
                missing.append(f"{venue.name} {year}")
            elif row[0] != scope.topic_filter(venue):
                stale.append(f"{venue.name} {year}")
            elif row[1] != row[2]:
                short.append(f"{venue.name} {year} ({row[2]} of {row[1]})")
    if missing:
        failures.append(f"{len(missing)} venue-year(s) in the scope not fetched: {', '.join(missing[:8])}")
    if stale:
        failures.append(f"{len(stale)} venue-year(s) fetched with an older topic filter: {', '.join(stale[:8])}")
    if short:
        notes.append(f"{len(short)} venue-year(s) stored a different number of papers than OpenAlex counted: "
                     + ", ".join(short[:8]))


def check_serve(tmp_path, failures):
    if not os.path.exists(tmp_path):
        failures.append(f"{tmp_path} does not exist: the build steps did not run")
        return None
    serve = sqlite3.connect(f"{Path(tmp_path).resolve().as_uri()}?mode=ro", uri=True)
    tables = {r[0] for r in serve.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")}
    for t in SERVED_TABLES:
        if t not in tables:
            failures.append(f"serve.db.tmp has no {t} table")
        elif t != "paper_platforms" and serve.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] == 0:
            failures.append(f"serve.db.tmp table {t} is empty")
    return serve


def check_default_summaries(failures, public_dir=PUBLIC_DIR):
    """finalize_build.py moves these into place with the database; one missing or corrupt would leave the site's first screen
    showing the previous build's numbers."""
    for name in DEFAULT_SUMMARIES:
        staged = os.path.join(public_dir, name + ".tmp")
        if not os.path.exists(staged):
            failures.append(f"public/{name}.tmp does not exist: build_default_summary.py did not run")
            continue
        try:
            with gzip.open(staged, "rt", encoding="utf-8") as handle:
                payload = json.load(handle)
            if not isinstance(payload, dict) or not isinstance(payload.get("entries"), list):
                failures.append(f"public/{name}.tmp is malformed: missing entries list")
        except (OSError, EOFError, ValueError) as error:
            failures.append(f"public/{name}.tmp is unreadable ({error}): build_default_summary.py must succeed")


def check_shrink(serve, allow_shrink, failures, notes):
    if serve is None or not os.path.exists(SERVE_DB_PATH):
        return
    with open_readonly(SERVE_DB_PATH) as live:
        try:
            before = live.execute("SELECT COUNT(*) FROM paper_facts").fetchone()[0]
        except sqlite3.Error:
            return
    after = serve.execute("SELECT COUNT(*) FROM paper_facts").fetchone()[0]
    notes.append(f"Served papers: {before:,} now, {after:,} in this build")
    if before and after < (1 - SHRINK_LIMIT) * before:
        message = f"this build serves {after:,} papers, {100 * (1 - after / before):.0f}% fewer than the live {before:,}"
        if allow_shrink:
            notes.append(message + " (allowed with --allow-shrink)")
        else:
            failures.append(message + "; if the scope was narrowed on purpose, run with --allow-shrink")


def year_table(staging, tmp_path):
    staging.execute("ATTACH DATABASE ? AS serve", (f"{Path(tmp_path).resolve().as_uri()}?mode=ro",))
    rows = {}
    for year, papers in staging.execute("SELECT year, COUNT(*) FROM serve.paper_facts GROUP BY year ORDER BY year"):
        rows[year] = {"papers": papers}
    shares = {
        "institution": """SELECT p.year, AVG(a.openalex_institution_id IS NOT NULL) FROM authorships a
                          JOIN serve.paper_facts p ON p.paper_id = a.paper_id GROUP BY p.year""",
        "orcid": """SELECT p.year, AVG(au.orcid IS NOT NULL) FROM authorships a JOIN authors au ON au.author_id = a.author_id
                    JOIN serve.paper_facts p ON p.paper_id = a.paper_id GROUP BY p.year""",
        "abstract": """SELECT p.year, AVG(COALESCE(t.abstract_openalex, t.arxiv_abstract) IS NOT NULL)
                       FROM serve.paper_facts p LEFT JOIN paper_text t ON t.paper_id = p.paper_id GROUP BY p.year""",
        "topic": """SELECT p.year, AVG(p.paper_id IN (SELECT paper_id FROM serve.paper_subtopics))
                    FROM serve.paper_facts p GROUP BY p.year""",
    }
    for name, sql in shares.items():
        for year, share in staging.execute(sql):
            if year in rows:
                rows[year][name] = 100 * (share or 0)
    return rows


def report_years(rows, notes):
    names = ["institution", "orcid", "abstract", "topic"]
    lines = ["  year   papers" + "".join(f"{h:>13}" for h in ("institution", "ORCID", "abstract", "topic"))]
    flagged = []
    for year, r in rows.items():
        marks = []
        for name in names:
            others = [o[name] for y, o in rows.items() if y != year and name in o]
            if name in r and len(others) >= 2 and abs(r[name] - statistics.median(others)) > SHARE_GAP:
                marks.append(name)
        cells = "".join(f"{r.get(n, 0):>12.1f}%" for n in names)
        lines.append(f"  {year}  {r['papers']:>7,}{cells}" + (f"   <- {', '.join(marks)}" if marks else ""))
        if marks:
            flagged.append(f"{year} ({', '.join(marks)})")
    notes.append("Per year:\n" + "\n".join(lines))
    if flagged:
        notes.append(f"Years more than {SHARE_GAP:.0f} points from the others: {'; '.join(flagged)}")


def check_duplicates(staging, notes):
    """How many copies of papers OpenAlex holds twice were left out; a merge step that did not run leaves them in."""
    n = staging.execute("SELECT COUNT(*) FROM duplicate_papers").fetchone()[0]
    if n:
        notes.append(f"Duplicate papers: {n} copies of papers OpenAlex holds twice under one DOI are left out")
    else:
        notes.append("Duplicate papers: none set aside (merge_entities.py has not run on this staging, or the data has none)")


def check_hand_inputs(staging, notes):
    ids = PaperIds(staging)
    key_path = ROOT / "data" / "topics" / "answer_key.json"
    if key_path.exists():
        papers = json.loads(key_path.read_text(encoding="utf-8"))["papers"]
        lost = [p["paper_id"] for p in papers if not ids.resolve(p["paper_id"], p.get("doi"))]
        moved = sum(1 for p in papers if ids.resolve(p["paper_id"], p.get("doi")) not in (None, p["paper_id"]))
        if lost or moved:
            notes.append(f"Topic answer key: {len(lost)} of {len(papers)} papers match nothing in staging"
                         + (f" ({', '.join(lost[:5])})" if lost else "") + f"; {moved} found by DOI under a new id")
    overrides_path = ROOT / "data" / "article_overrides.json"
    if overrides_path.exists():
        entries = json.loads(overrides_path.read_text(encoding="utf-8")).get("papers", {})
        lost = [pid for pid, o in entries.items() if not ids.resolve(pid, o.get("doi"))]
        if lost:
            notes.append(f"Article overrides: {len(lost)} of {len(entries)} match nothing in staging: {', '.join(lost[:5])}")
    merges_path = ROOT / "data" / "merges.json"
    if merges_path.exists():
        merges = json.loads(merges_path.read_text(encoding="utf-8"))
        authors = {r[0] for r in staging.execute("SELECT author_id FROM authors")}
        insts = {r[0] for r in staging.execute("SELECT inst_id FROM institutions")}
        lost = [a for pair in merges.get("authors", {}).items() for a in pair if a not in authors]
        lost += [i for pair in merges.get("institutions", {}).items() for i in pair if i not in insts]
        if lost:
            notes.append(f"data/merges.json: {len(lost)} id(s) match nothing in staging: {', '.join(lost[:5])}")


def check_suppressions(staging, serve, failures, notes, public_dir=PUBLIC_DIR):
    """Verify suppressed author profiles are redacted in serve.db.tmp and default researcher summaries (logs counts only)."""
    try:
        sup = suppressions.load()
    except ValueError as error:
        failures.append(str(error))
        return
    if not sup.entries:
        return
    ids, unmatched = suppressions.suppressed_ids(staging, sup)
    notes.append(f"data/suppressions.json: {len(sup.entries)} entr{'y' if len(sup.entries) == 1 else 'ies'}, "
                 f"{len(ids)} person(s) not listed" + (f"; {unmatched} entr{'y matches' if unmatched == 1 else 'ies match'} "
                                                      "nothing in staging" if unmatched else ""))
    if serve is None or not ids:
        return
    wanted = json.dumps(sorted(ids))
    visible = serve.execute(
        """SELECT COUNT(*) FROM authors WHERE author_id IN (SELECT value FROM json_each(?))
           AND (name IS NOT NULL OR orcid IS NOT NULL OR latest_affiliation IS NOT NULL
                OR latest_location_code IS NOT NULL OR is_placeholder IS NOT 1)""", (wanted,)).fetchone()[0]
    searchable = serve.execute("SELECT COUNT(*) FROM authors_fts WHERE author_id IN (SELECT value FROM json_each(?))",
                               (wanted,)).fetchone()[0]
    if visible:
        failures.append(f"{visible} person(s) in data/suppressions.json still have a name, ORCID or affiliation in serve.db.tmp")
    if searchable:
        failures.append(f"{searchable} person(s) in data/suppressions.json are still in the name search of serve.db.tmp")
    summary = os.path.join(public_dir, DEFAULT_RESEARCHERS + ".tmp")
    if os.path.exists(summary):
        with gzip.open(summary, "rt", encoding="utf-8") as f:
            listed = {e.get("author_id") for e in json.load(f).get("entries", [])} & ids
        if listed:
            failures.append(f"{len(listed)} person(s) in data/suppressions.json are still in the default researcher summary")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--allow-shrink", action="store_true", help="accept a build with far fewer papers than the live one")
    args = ap.parse_args()

    scope = load_scope()
    tmp_path = SERVE_TMP_PATH
    failures, notes = [], []
    serve = None
    try:
        with open_readonly(STAGING_DB_PATH) as staging:
            check_shards(staging, scope, failures, notes)
            serve = check_serve(tmp_path, failures)
            check_default_summaries(failures)
            check_shrink(serve, args.allow_shrink, failures, notes)
            if serve is not None and "paper_facts" in {r[0] for r in serve.execute("SELECT name FROM sqlite_master")}:
                report_years(year_table(staging, tmp_path), notes)
            check_duplicates(staging, notes)
            check_hand_inputs(staging, notes)
            check_suppressions(staging, serve, failures, notes)
    finally:
        if serve is not None:
            serve.close()

    for note in notes:
        logger.info(note)
    for failure in failures:
        logger.error(f"FAIL: {failure}")
    if failures:
        logger.error(f"{len(failures)} check(s) failed; serve.db is unchanged.")
        return 1
    logger.info("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
