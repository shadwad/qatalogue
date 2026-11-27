#!/usr/bin/env python3
"""Classify staged papers by research type into staging.paper_classes(paper_id, kind, is_research, reason).

Only papers with is_research = 1 are exported to serve.db. Precedence:
  1. data/article_overrides.json        optional manual overrides
  2. publisher article type             staging.paper_publisher_types (Springer Nature, APS)
  3. OpenAlex work_type                 review, editorial, erratum, etc.
  4. DOI patterns                       known non-research prefixes
  5. title / abstract patterns          strong non-research markers and short-form news teasers

Weak matches (ABS_WEAK) remain research and are listed in data/topics/article_types_report.md.

  --report-only    print classification counts without writing paper_classes
"""
import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from pipeline.core.logger import setup_pipeline_logger
from pipeline.db.connection import init_db, open_staging
from pipeline.core.paper_ids import PaperIds

logger = setup_pipeline_logger("classify_articles", "classify_articles.log")
ROOT = Path(__file__).resolve().parents[2]
OVERRIDES = ROOT / "data" / "article_overrides.json"
REPORT = ROOT / "data" / "topics" / "article_types_report.md"

KINDS = ("research", "review", "perspective", "tutorial", "news", "editorial", "comment", "erratum", "other")

# ── 2. publisher types ───────────────────────────────────────────────────────────────────────────────────────
NATURE_RESEARCH = {
    "article", "originalpaper", "letter", "analysis", "brief communication", "briefcommunication",
    "resource", "registered report", "registeredreport", "technical report", "technicalreport", "methods",
}
APS_RESEARCH = {"article", "letter", "rapid", "rapid-communication", "brief-report"}


def publisher_kind(source: str, ptype: str | None) -> str | None:
    if not ptype:
        return None
    t = ptype.strip().lower()
    if (source == "nature" and t in NATURE_RESEARCH) or (source == "aps" and t in APS_RESEARCH):
        return "research"
    if "tutorial" in t:
        return "tutorial"
    if "review" in t and "book" not in t:
        return "review"
    if any(w in t for w in ("perspective", "comment", "viewpoint", "essay", "opinion", "correspondence", "q&a",
                            "feature", "obituary", "measure for measure", "thesis", "turning point", "history")):
        return "comment" if t in ("comment", "reply") and source == "aps" else "perspective"
    if any(w in t for w in ("news", "highlight", "briefing", "research summary", "focus")):
        return "news"
    if "editorial" in t:
        return "editorial"
    if any(w in t for w in ("matters arising", "reply")):
        return "comment"
    if any(w in t for w in ("correction", "erratum", "retraction", "addendum", "publisher", "expression of concern")):
        return "erratum"
    return "other"


# ── 3. OpenAlex types ────────────────────────────────────────────────────────────────────────────────────────
OPENALEX_KIND = {"review": "review", "editorial": "editorial", "other": "news", "letter": "comment",
                 "erratum": "erratum", "retraction": "erratum", "paratext": "other", "book-review": "other",
                 "dissertation": "news", "peer-review": "other", "supplementary-materials": "other"}

# ── 4–6. patterns ────────────────────────────────────────────────────────────────────────────────────────────
NATURE_NEWS = re.compile(r"^10\.1038/d41586-")
SCIENCE_SHORT = re.compile(r"^10\.1126/science\.\d+\.\d+\.\d+-[a-z]$")
QUANTUM_VIEWS = re.compile(r"^10\.22331/qv-")
TITLE_COMMENT = re.compile(
    r"^\s*(comment on|reply to|response to)\b|\breply\s*:?\s*$|\bet al\.?\s+reply\b", re.I)
TITLE_ERRATUM = re.compile(
    r"^\s*(erratum|errata|publisher'?s note|retraction|correction to|corrigendum|addendum to|expression of concern)\b",
    re.I)
TITLE_TUTORIAL = re.compile(r"\btutorial\b", re.I)
TITLE_REVIEW = re.compile(
    r"^\s*(perspective|review|roadmap|primer)\s*:|^\s*(a |an )?(perspective|review|overview) (on|of)\b"
    r"|^\s*roadmap (on|for)\b"
    r"|:\s*(a |an )?(brief |short |pedagogical |gentle |critical )?(review|roadmap|primer|overview|survey|perspective)\b"
    r"(?! (from|based))"
    r"|past,? present,? and (the )?future"
    r"|\b(progress|status|challenges|advances) and (prospects|perspectives|outlook|opportunities|challenges|future directions)\b"
    r"|\brecent (progress|advances|developments) (in|and)\b", re.I)
# Require title-cased type nouns here; lowercase "in this perspective" is treated as a weak signal in ABS_WEAK.
ABS_CASED = re.compile(r"\b[Tt]his (Review|Perspective|Tutorial|Roadmap|Colloquium)\b")
ABS_STRONG = re.compile(
    r"\b(in )?this (review|tutorial|roadmap|mini-?review|review article|perspective article|colloquium)\b"
    r"(?!,? (of|on) (the|this) )"
    r"|\b(here|herein),? we (briefly )?review\b|\bwe present an? (brief |short )?tutorial\b"
    r"|\bpedagogical (overview|introduction)\b|\bthis article reviews\b", re.I)
ABS_WEAK = re.compile(
    r"(?<!from )\bthis perspective\b"
    r"|\bwe (give|provide|present|offer) (an? )?(brief |broad |comprehensive |concise |self-contained |critical |detailed |short )?"
    r"(overview|survey|perspective)\b"
    r"|\b(here|herein),? we survey\b|\bwe (review|survey)\b|\b(is|are) (briefly )?reviewed\b"
    r"|\bwe (summari[sz]e|highlight|discuss) (the )?(recent|current|latest) (progress|advances|developments|state)\b"
    r"|\b(this|our) (article|paper) (surveys|summari[sz]es|reviews)\b", re.I)
SHORT_ABSTRACT_VENUES = {"Science", "Nature", "Science Advances"}
SHORT_ABSTRACT_CHARS = 300   # Minimum non-teaser abstract length for short-form news venues


def text_kind(title: str, abstract: str) -> tuple[str | None, str]:
    if TITLE_TUTORIAL.search(title):
        return "tutorial", "title"
    m = TITLE_REVIEW.search(title)
    if m:
        w = m.group(0).lower()
        return ("perspective" if "perspective" in w or "prospect" in w or "outlook" in w else "review"), "title"
    m = ABS_CASED.search(abstract) or ABS_STRONG.search(abstract)
    if m:
        w = m.group(0).lower()
        kind = "tutorial" if "tutorial" in w else "perspective" if "perspective" in w else "review"
        return kind, "abstract"
    return None, ""


def classify(row: dict, override: dict | None) -> tuple[str, str]:
    """→ (kind, reason)."""
    if override:
        return override["kind"], "override" + (f": {override['note']}" if override.get("note") else "")
    if row["ptype"] and row["pstatus"] == "ok":
        k = publisher_kind(row["psource"], row["ptype"])
        if k:
            return k, f"publisher ({row['psource']}): {row['ptype']}"
    wt = row["work_type"]
    if wt in OPENALEX_KIND:
        return OPENALEX_KIND[wt], f"OpenAlex type: {wt}"
    doi, title, abstract = row["doi"], row["title"], row["abstract"]
    if NATURE_NEWS.search(doi):
        return "news", "DOI: Nature news"
    if SCIENCE_SHORT.search(doi):
        return "news", "DOI: Science short item"
    if QUANTUM_VIEWS.search(doi):
        return "perspective", "DOI: Quantum Views"
    if TITLE_ERRATUM.search(title):
        return "erratum", "title"
    if TITLE_COMMENT.search(title):
        return "comment", "title"
    k, where = text_kind(title, abstract)
    if k:
        return k, where
    if row["venue"] in SHORT_ABSTRACT_VENUES and abstract and len(abstract) < SHORT_ABSTRACT_CHARS:
        return "news", f"teaser abstract ({len(abstract)} chars)"
    if doi.startswith("10.1038/s41") and not abstract and (row["authors"] or 0) <= 1 and not row["arxiv"]:
        return "perspective", "Nature journal item without abstract, ≤1 author"
    return "research", ""


def load_rows(conn) -> list[dict]:
    has_pub = conn.execute("SELECT 1 FROM sqlite_master WHERE name='paper_publisher_types'").fetchone()
    pub = ("pt.source, pt.publisher_type, pt.status" if has_pub else "NULL, NULL, NULL")
    join = "LEFT JOIN paper_publisher_types pt ON pt.paper_id = p.paper_id" if has_pub else ""
    rows = conn.execute(f"""
        SELECT p.paper_id, p.title, p.venue_name, LOWER(COALESCE(p.doi, '')), p.total_authors,
               t.work_type, COALESCE(t.abstract_openalex, t.arxiv_abstract), t.arxiv_id, {pub}
        FROM papers p LEFT JOIN paper_text t USING (paper_id) {join}""").fetchall()
    keys = ("paper_id", "title", "venue", "doi", "authors", "work_type", "abstract", "arxiv", "psource", "ptype",
            "pstatus")
    out = []
    for r in rows:
        d = dict(zip(keys, r))
        d["title"], d["abstract"] = d["title"] or "", d["abstract"] or ""
        out.append(d)
    return out


def load_overrides(conn) -> tuple[dict, list[str]]:
    """Overrides keyed by the paper's current staging id (found by DOI when OpenAlex has changed the id), and the
    entries that match no paper."""
    if not OVERRIDES.exists():
        return {}, []
    data = json.loads(OVERRIDES.read_text(encoding="utf-8"))
    ids = PaperIds(conn)
    out, unmatched = {}, []
    for pid, o in data.get("papers", {}).items():
        if o.get("kind") not in KINDS:
            raise ValueError(f"{OVERRIDES.name}: {pid} has unknown kind {o.get('kind')!r} (use one of {KINDS})")
        current = ids.resolve(pid, o.get("doi"))
        if current:
            out[current] = o
        else:
            unmatched.append(pid)
    return out, unmatched


def write_report(rows, results, weak_unreviewed):
    by_kind = Counter(k for k, _ in results.values())
    by_reason = defaultdict(Counter)
    for pid, (k, reason) in results.items():
        if k != "research":
            label = reason if reason.startswith("publisher") else re.sub(r"\s*\(.*?\)", "", reason.split(":")[0])
            by_reason[k][label] += 1
    n = len(rows)
    lines = [f"# Article types — {datetime.now(timezone.utc):%Y-%m-%d}", "",
             f"{n:,} papers in staging; **{by_kind['research']:,} research** "
             f"({by_kind['research'] / max(n, 1):.1%}) are served. The rest stay in staging only.", "",
             "| Kind | Papers | Evidence |", "|---|---:|---|"]
    for k in KINDS[1:]:
        if by_kind[k]:
            ev = ", ".join(f"{r} {c}" for r, c in by_reason[k].most_common(6))
            lines.append(f"| {k} | {by_kind[k]:,} | {ev} |")
    lines += ["", f"## Weak hits not yet decided ({len(weak_unreviewed)})", "",
              "Wording that is sometimes a review (\"we review…\"). Counted as research until decided in "
              "`data/article_overrides.json`.", ""]
    for r in weak_unreviewed:
        lines.append(f"- `{r['paper_id']}` {r['venue']}: {r['title'][:120]}")
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--report-only", action="store_true")
    args = ap.parse_args()
    init_db()
    with open_staging() as conn:
        rows = load_rows(conn)
        overrides, unknown = load_overrides(conn)
        results, weak_unreviewed = {}, []
        for r in rows:
            results[r["paper_id"]] = classify(r, overrides.get(r["paper_id"]))
            if results[r["paper_id"]][0] == "research" and r["paper_id"] not in overrides and ABS_WEAK.search(r["abstract"]):
                weak_unreviewed.append(r)
        if unknown:
            logger.warning(f"{len(unknown)} override(s) name papers not in staging: {unknown[:5]}")

        counts = Counter(k for k, _ in results.values())
        logger.info("Article kinds: " + ", ".join(f"{k} {counts[k]}" for k in KINDS if counts[k]))
        logger.info(f"Weak review wording, undecided (counted as research): {len(weak_unreviewed)}")
        write_report(rows, results, weak_unreviewed)
        if args.report_only:
            return
        conn.execute("DROP TABLE IF EXISTS paper_classes")
        conn.execute("""
          CREATE TABLE paper_classes (
            paper_id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,            -- research | review | perspective | tutorial | news | editorial | comment | erratum | other
            is_research INTEGER NOT NULL,  -- 1 = served and counted; 0 = kept in staging only
            reason TEXT)""")
        conn.executemany("INSERT INTO paper_classes VALUES (?, ?, ?, ?)",
                         [(pid, k, int(k == "research"), reason) for pid, (k, reason) in results.items()])
    logger.info(f"staging.paper_classes written; report: {REPORT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
