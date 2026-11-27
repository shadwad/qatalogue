#!/usr/bin/env python3
"""Enrich staged papers with text and subject metadata for search and topic building.

  OpenAlex: abstract, keywords, concepts, full topic details (subfield/field/domain), arXiv link, work type
            (article, review, editorial, ...; used to keep non-research items out of the counts).
  arXiv:    abstract, primary + secondary categories. Kept only when the arXiv title matches ours.

Resumable: each paper is fetched once; rerun to pick up new papers or ones that failed.
  --refresh        refetch everything
  --only openalex|arxiv|types   (types: fetch only the work type for papers that lack it)
  --limit N        process at most N papers per source (for testing)
"""
import argparse
import difflib
import html
import json
import re
import time
import urllib.error
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from pipeline.core.logger import setup_pipeline_logger
from pipeline.core.api_config import get_email
from pipeline.db.connection import init_db, init_cache_db, open_staging
from pipeline.clients.http_retry import RetriesExhausted, request
from pipeline.clients.openalex_client import OpenAlexClient

logger = setup_pipeline_logger("enrich", "enrich.log")

OA_SELECT = "id,doi,type,type_crossref,abstract_inverted_index,keywords,concepts,topics,locations,ids"
OA_TYPE_SELECT = "id,doi,type,type_crossref"
OA_BATCH = 50
ARXIV_BATCH = 100
ARXIV_DELAY = 3.1          # arXiv API terms: no more than one request every 3 seconds
ARXIV_TITLE_MIN = 0.6      # below this title similarity the arXiv record is usually a different paper
ARXIV_RE = re.compile(r"arxiv\.org/(?:abs|pdf)/([^\s?#]+?)(?:v\d+)?(?:\.pdf)?$", re.I)
ARXIV_DOI_RE = re.compile(r"10\.48550/arxiv\.(.+)$", re.I)
ARXIV_VALID = re.compile(r"^(\d{4}\.\d{4,5}|[a-z\-]+(\.[a-z]{2})?/\d{7})$", re.I)
NS = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def short_id(raw: str | None) -> str:
    return (raw or "").rstrip("/").split("/")[-1]


def rebuild_abstract(inv: dict | None) -> str | None:
    if not inv:
        return None
    words = sorted((i, w) for w, idx in inv.items() for i in idx)
    text = " ".join(w for _, w in words).strip()
    return text or None


def find_arxiv_id(work: dict) -> str | None:
    for loc in work.get("locations") or []:
        for url in (loc.get("landing_page_url"), loc.get("pdf_url")):
            m = ARXIV_RE.search(url or "")
            if m:
                return m.group(1)
    m = ARXIV_DOI_RE.search(work.get("doi") or "")
    return m.group(1) if m else None


def openalex_row(work: dict) -> tuple:
    keywords = [[k.get("display_name"), round(k.get("score") or 0, 4)] for k in work.get("keywords") or []]
    concepts = [[short_id(c.get("id")), c.get("display_name"), c.get("level"), round(c.get("score") or 0, 4)]
                for c in work.get("concepts") or []]
    topics = [{
        "id": short_id(t.get("id")),
        "name": t.get("display_name"),
        "score": round(t.get("score") or 0, 4),
        "subfield": (t.get("subfield") or {}).get("display_name"),
        "field": (t.get("field") or {}).get("display_name"),
        "domain": (t.get("domain") or {}).get("display_name"),
    } for t in work.get("topics") or []]
    return (rebuild_abstract(work.get("abstract_inverted_index")), json.dumps(keywords), json.dumps(concepts),
            json.dumps(topics), find_arxiv_id(work), work.get("type"), work.get("type_crossref"))


def fetch_page(oa: OpenAlexClient, url: str) -> list[dict]:
    """One request (an id-filtered batch fits on one page). The client retries rate limits, server errors, dropped
    connections and truncated responses, and raises once the retries run out."""
    return (oa.get_json(url) or {}).get("results", [])


def save_openalex(conn, paper_id: str, work: dict | None):
    if work is None:
        conn.execute("""INSERT INTO paper_text (paper_id, openalex_status, openalex_fetched_at) VALUES (?, 'missing', ?)
                        ON CONFLICT(paper_id) DO UPDATE SET openalex_status='missing', openalex_fetched_at=excluded.openalex_fetched_at""",
                     (paper_id, now()))
        return
    abstract, kw, co, tp, arxiv_id, wtype, wtype_cr = openalex_row(work)
    conn.execute("""INSERT INTO paper_text (paper_id, abstract_openalex, keywords, concepts, topics_detail, arxiv_id,
                                            work_type, work_type_crossref, openalex_status, openalex_fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?)
                    ON CONFLICT(paper_id) DO UPDATE SET
                      abstract_openalex=excluded.abstract_openalex, keywords=excluded.keywords,
                      concepts=excluded.concepts, topics_detail=excluded.topics_detail,
                      arxiv_id=excluded.arxiv_id, work_type=excluded.work_type,
                      work_type_crossref=excluded.work_type_crossref, openalex_status='ok',
                      openalex_fetched_at=excluded.openalex_fetched_at""",
                 (paper_id, abstract, kw, co, tp, arxiv_id, wtype, wtype_cr, now()))


def enrich_openalex(refresh: bool, limit: int | None):
    with open_staging() as conn:
        where = "" if refresh else "WHERE t.openalex_fetched_at IS NULL"
        todo = [r[0] for r in conn.execute(f"SELECT p.paper_id FROM papers p LEFT JOIN paper_text t USING (paper_id) {where}")]
        if limit is not None:
            todo = todo[:limit]
        logger.info(f"OpenAlex: {len(todo)} papers to fetch")
        oa = OpenAlexClient()
        t0, done, missing = time.time(), 0, []
        for b in range(0, len(todo), OA_BATCH):
            chunk = todo[b:b + OA_BATCH]
            url = f"{oa.base_url}/works?filter=openalex_id:{'|'.join(chunk)}&per-page={OA_BATCH}&select={OA_SELECT}"
            try:
                got = {short_id(w.get("id")): w for w in fetch_page(oa, url)}
            except (urllib.error.HTTPError, RetriesExhausted, ValueError) as e:  # leave the batch unfetched; a rerun retries it
                logger.warning(f"  batch {b} failed ({e}); rerun to retry")
                continue
            with conn:
                for pid in chunk:
                    if pid in got:
                        save_openalex(conn, pid, got[pid])
                    else:
                        missing.append(pid)
            done += len(chunk)
            if (b // OA_BATCH) % 50 == 0:
                rate = done / max(time.time() - t0, 1e-6)
                logger.info(f"  {done}/{len(todo)}  ({rate:.0f}/s, ~{(len(todo) - done) / max(rate, 1e-6) / 60:.0f} min left)")

        # Works merged into another id are not returned by the id filter; the single-work endpoint follows the redirect.
        if missing:
            logger.info(f"OpenAlex: {len(missing)} not returned in batches (likely merged ids); fetching one by one")
        recovered = 0
        for pid in missing:
            try:
                work = oa.get_json(f"{oa.base_url}/works/{pid}?select={OA_SELECT}")
            except (urllib.error.HTTPError, RetriesExhausted, ValueError) as e:
                logger.warning(f"  single work {pid} failed ({e}); rerun to retry")
                continue
            with conn:
                save_openalex(conn, pid, work)
            recovered += work is not None
        if missing:
            logger.info(f"  recovered {recovered}/{len(missing)}")

        # Some recent works get re-numbered by OpenAlex with no redirect (old id returns 404).
        # Look those up by DOI instead; runs every time so earlier misses get another chance.
        lost = conn.execute("""SELECT t.paper_id, LOWER(p.doi) FROM paper_text t JOIN papers p USING (paper_id)
                               WHERE t.openalex_status = 'missing' AND p.doi IS NOT NULL AND p.doi <> ''""").fetchall()
        if lost:
            logger.info(f"OpenAlex: looking up {len(lost)} unfound papers by DOI")
            found = 0
            for b in range(0, len(lost), OA_BATCH):
                chunk = lost[b:b + OA_BATCH]
                dois = "|".join(urllib.parse.quote(d, safe="/:") for _, d in chunk)
                url = f"{oa.base_url}/works?filter=doi:{dois}&per-page={OA_BATCH}&select={OA_SELECT}"
                try:
                    by_doi = {(w.get("doi") or "").lower().split("doi.org/")[-1]: w for w in fetch_page(oa, url)}
                except (urllib.error.HTTPError, RetriesExhausted, ValueError) as e:
                    logger.warning(f"  DOI batch {b} failed ({e}); rerun to retry")
                    continue
                with conn:
                    for pid, doi in chunk:
                        if doi in by_doi:
                            save_openalex(conn, pid, by_doi[doi])
                            found += 1
            logger.info(f"  found {found}/{len(lost)} by DOI")


def enrich_types(limit: int | None):
    """Backfill the OpenAlex work type for papers fetched before it was part of the select (cheap: ids only)."""
    with open_staging() as conn:
        todo = conn.execute("""SELECT t.paper_id, LOWER(p.doi) FROM paper_text t JOIN papers p USING (paper_id)
                               WHERE t.openalex_status = 'ok' AND t.work_type IS NULL""").fetchall()
        if limit is not None:
            todo = todo[:limit]
        logger.info(f"OpenAlex types: {len(todo)} papers to fetch")
        oa = OpenAlexClient()
        got_n, by_doi_n = 0, 0
        for b in range(0, len(todo), OA_BATCH):
            chunk = todo[b:b + OA_BATCH]
            url = f"{oa.base_url}/works?filter=openalex_id:{'|'.join(p for p, _ in chunk)}&per-page={OA_BATCH}&select={OA_TYPE_SELECT}"
            try:
                works = fetch_page(oa, url)
            except (urllib.error.HTTPError, RetriesExhausted, ValueError) as e:
                logger.warning(f"  batch {b} failed ({e}); rerun to retry")
                continue
            by_id = {short_id(w.get("id")): w for w in works}
            # Merged/renumbered ids come back under a new id; match those by DOI.
            by_doi = {(w.get("doi") or "").lower().split("doi.org/")[-1]: w for w in works if w.get("doi")}
            with conn:
                for pid, doi in chunk:
                    w = by_id.get(pid) or (by_doi.get(doi) if doi else None)
                    if w is None:
                        continue
                    by_doi_n += pid not in by_id
                    got_n += 1
                    conn.execute("UPDATE paper_text SET work_type = ?, work_type_crossref = ? WHERE paper_id = ?",
                                 (w.get("type") or "unknown", w.get("type_crossref"), pid))
            if (b // OA_BATCH) % 100 == 0:
                logger.info(f"  {b + len(chunk)}/{len(todo)}")
        # Ids merged into another work are not resolved by the id filter (a single-work lookup follows the merge, the
        # filter does not), so look the remaining papers up by DOI.
        left = conn.execute("""SELECT t.paper_id, LOWER(p.doi) FROM paper_text t JOIN papers p USING (paper_id)
                               WHERE t.openalex_status = 'ok' AND t.work_type IS NULL AND p.doi IS NOT NULL""").fetchall()
        if limit is not None:
            wanted = set(todo)
            left = [r for r in left if r in wanted]
        for b in range(0, len(left), OA_BATCH):
            chunk = left[b:b + OA_BATCH]
            url = (f"{oa.base_url}/works?filter=doi:{'|'.join(urllib.parse.quote(d, safe='/:') for _, d in chunk)}"
                   f"&per-page={OA_BATCH}&select={OA_TYPE_SELECT}")
            try:
                works = fetch_page(oa, url)
            except (urllib.error.HTTPError, RetriesExhausted, ValueError) as e:
                logger.warning(f"  DOI batch {b} failed ({e}); rerun to retry")
                continue
            by_doi = {(w.get("doi") or "").lower().split("doi.org/")[-1]: w for w in works if w.get("doi")}
            with conn:
                for pid, doi in chunk:
                    w = by_doi.get(doi)
                    if w is None:
                        continue
                    by_doi_n += 1
                    got_n += 1
                    conn.execute("UPDATE paper_text SET work_type = ?, work_type_crossref = ? WHERE paper_id = ?",
                                 (w.get("type") or "unknown", w.get("type_crossref"), pid))
        logger.info(f"OpenAlex types: stored {got_n}/{len(todo)} ({by_doi_n} via DOI); the rest stay NULL (rerun or --refresh)")
        for t, n in conn.execute("SELECT work_type, COUNT(*) FROM paper_text GROUP BY work_type ORDER BY 2 DESC"):
            logger.info(f"  {str(t):12} {n}")


def norm_title(t: str | None) -> str:
    t = html.unescape(re.sub(r"<[^>]+>|\$", "", t or ""))
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def parse_arxiv_feed(xml_bytes: bytes) -> dict:
    out = {}
    for e in ET.fromstring(xml_bytes).findall("a:entry", NS):
        eid = (e.findtext("a:id", "", NS) or "").split("/abs/")[-1]
        base = re.sub(r"v\d+$", "", eid)
        prim = e.find("arxiv:primary_category", NS)
        primary = prim.get("term") if prim is not None else None
        cats = [c.get("term") for c in e.findall("a:category", NS)]
        if primary:
            cats = [primary] + [c for c in cats if c != primary]
        out[base.lower()] = {
            "title": " ".join((e.findtext("a:title", "", NS) or "").split()),
            "abstract": " ".join((e.findtext("a:summary", "", NS) or "").split()),
            "primary": primary,
            "cats": cats,
        }
    return out


def enrich_arxiv(refresh: bool, limit: int | None):
    with open_staging() as conn:
        where = "" if refresh else "AND t.arxiv_fetched_at IS NULL"
        todo = conn.execute(f"""SELECT t.paper_id, t.arxiv_id, p.title FROM paper_text t JOIN papers p USING (paper_id)
                                WHERE t.arxiv_id IS NOT NULL {where}""").fetchall()
        if limit is not None:
            todo = todo[:limit]
        logger.info(f"arXiv: {len(todo)} papers to fetch (~{len(todo) / ARXIV_BATCH * ARXIV_DELAY / 60:.0f} min at the API's rate limit)")
        headers = {"User-Agent": f"Qatalogue (mailto:{get_email()})"}
        t0 = time.time()
        counts = {"ok": 0, "mismatch": 0, "missing": 0}
        for b in range(0, len(todo), ARXIV_BATCH):
            chunk = todo[b:b + ARXIV_BATCH]
            ids = sorted({r[1] for r in chunk if ARXIV_VALID.match(r[1])})
            url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode({"id_list": ",".join(ids), "max_results": len(ids)})
            feed = {}   # malformed ids are never sent (one would fail the whole batch)
            if ids:
                try:
                    feed = request(url, headers=headers, timeout=90, attempts=5, backoff=lambda attempt: 5 * (attempt + 1),
                                   parse=parse_arxiv_feed, parse_errors=(ET.ParseError, ValueError))
                except (urllib.error.HTTPError, RetriesExhausted) as e:
                    logger.debug(f"  arXiv: {e}")
                    feed = None
            if feed is None:
                logger.warning(f"  batch {b} failed; rerun to retry")
                time.sleep(ARXIV_DELAY)
                continue
            with conn:
                for pid, aid, title in chunk:
                    rec = feed.get(aid.lower())
                    if not rec:
                        status, sim = "missing", None
                    else:
                        sim = difflib.SequenceMatcher(None, norm_title(title), norm_title(rec["title"])).ratio()
                        status = "ok" if sim >= ARXIV_TITLE_MIN else "mismatch"
                    counts[status] += 1
                    keep = status == "ok"
                    conn.execute("""UPDATE paper_text SET arxiv_title=?, arxiv_abstract=?, arxiv_primary=?, arxiv_categories=?,
                                      arxiv_title_match=?, arxiv_status=?, arxiv_fetched_at=? WHERE paper_id=?""",
                                 (rec["title"] if rec else None,
                                  rec["abstract"] if keep else None,
                                  rec["primary"] if keep else None,
                                  json.dumps(rec["cats"]) if keep else None,
                                  None if sim is None else round(sim, 3), status, now(), pid))
            done = b + len(chunk)
            if (b // ARXIV_BATCH) % 20 == 0:
                rate = done / max(time.time() - t0, 1e-6)
                logger.info(f"  {done}/{len(todo)}  ~{(len(todo) - done) / max(rate, 1e-6) / 60:.0f} min left")
            time.sleep(ARXIV_DELAY)
        logger.info(f"arXiv: verified {counts['ok']}, title mismatch {counts['mismatch']}, not found {counts['missing']}")


def report():
    with open_staging() as conn:
        n = conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
        row = conn.execute("""SELECT
            SUM(t.openalex_status = 'ok'),
            SUM(t.abstract_openalex IS NOT NULL),
            SUM(t.abstract_openalex IS NOT NULL OR t.arxiv_abstract IS NOT NULL),
            SUM(t.keywords IS NOT NULL AND t.keywords <> '[]'),
            SUM(t.arxiv_id IS NOT NULL),
            SUM(t.arxiv_status = 'ok')
          FROM papers p LEFT JOIN paper_text t USING (paper_id)""").fetchone()
    labels = ["OpenAlex fetched", "abstract (OpenAlex)", "abstract (any source)", "keywords", "arXiv linked", "arXiv verified"]
    logger.info(f"Coverage over {n} papers:")
    for label, v in zip(labels, row):
        v = v or 0
        logger.info(f"  {label:22} {v:6}  {v / max(n, 1):6.1%}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--only", choices=["openalex", "arxiv", "types"])
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()
    init_db()
    init_cache_db()
    if args.only in (None, "openalex"):
        enrich_openalex(args.refresh, args.limit)
    if args.only in (None, "types"):
        enrich_types(args.limit)
    if args.only in (None, "arxiv"):
        enrich_arxiv(args.refresh, args.limit)
    report()


if __name__ == "__main__":
    main()
