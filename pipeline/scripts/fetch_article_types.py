#!/usr/bin/env python3
"""Fetch publisher-reported article types into staging.paper_publisher_types (resumable).

  Springer Nature (10.1038/s41...): reads genre / contentType from api.springernature.com/meta/v2/json
                                      when SPRINGER_NATURE_API_KEY is set.
  APS (10.1103/...):                  reads articleType from harvest.aps.org metadata API.

  --only nature|aps
  --journals all     include all APS journals (default: open-access PRX Quantum and PRX)
  --limit N          at most N papers per source
  --refresh          re-fetch already processed records
"""
import argparse
import json
import time
import urllib.error
import urllib.parse
from datetime import datetime, timezone

from pipeline.clients.http_retry import RetriesExhausted, doubling, request
from pipeline.core.api_config import get_email, get_setting
from pipeline.core.logger import setup_pipeline_logger
from pipeline.db.connection import init_db, open_staging

logger = setup_pipeline_logger("article_types", "article_types.log")

SPRINGER_API_URL = "https://api.springernature.com/meta/v2/json"
NATURE_BATCH = 20
NATURE_DELAY = 0.7     # stay under the 100 req/min free-tier limit
APS_DELAY = 0.25
USER_AGENT = f"Qatalogue (mailto:{get_email()})"
APS_OPEN = ("10.1103/prxquantum.", "10.1103/physrevx.")
# APS harvest API paths are case-sensitive; newer 10.1103/abcd-efgh DOIs fall back to classify_articles rules.
APS_CASE = {"prxquantum": "PRXQuantum", "physrevx": "PhysRevX", "physrevlett": "PhysRevLett", "physreva": "PhysRevA",
            "physrevapplied": "PhysRevApplied", "physrevresearch": "PhysRevResearch", "physrevb": "PhysRevB"}


def aps_doi(doi: str) -> str:
    prefix, rest = doi.split("/", 1)
    journal, _, tail = rest.partition(".")
    return f"{prefix}/{APS_CASE.get(journal, journal)}.{tail}" if tail else doi


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def ensure_table(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS paper_publisher_types (
        paper_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,          -- 'nature' | 'aps'
        publisher_type TEXT,           -- e.g. 'OriginalPaper', 'ReviewPaper', 'News & Views', 'review'
        detail TEXT,                   -- secondary label (Meta API genres/contentType, APS type)
        status TEXT NOT NULL,          -- 'ok' | 'unavailable' | 'error'
        fetched_at TEXT NOT NULL)""")
    conn.commit()


def fetch_with_retry(url, headers) -> tuple[int, str]:
    """Return (http_status, body_text), mapping exhausted retries to the last status or -1."""
    try:
        body = request(url, headers=headers, timeout=30, attempts=5, backoff=doubling(start=2),
                       read=lambda response: response.read())
        return 200, body.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except RetriesExhausted as e:
        return (e.status if e.status is not None else -1), ""


def save(conn, pid, source, ptype, detail, status):
    conn.execute("""INSERT INTO paper_publisher_types (paper_id, source, publisher_type, detail, status, fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(paper_id) DO UPDATE SET source=excluded.source, publisher_type=excluded.publisher_type,
                      detail=excluded.detail, status=excluded.status, fetched_at=excluded.fetched_at""",
                 (pid, source, ptype, detail, status, now()))


def todo_for(conn, prefixes: tuple[str, ...], refresh: bool, limit: int | None):
    """Papers with a matching DOI, those without an abstract first (where text rules cannot help)."""
    where = " OR ".join("LOWER(p.doi) LIKE ?" for _ in prefixes)
    skip = "" if refresh else "AND pt.paper_id IS NULL"
    rows = conn.execute(f"""
        SELECT p.paper_id, LOWER(p.doi) FROM papers p
        LEFT JOIN paper_text t USING (paper_id)
        LEFT JOIN paper_publisher_types pt ON pt.paper_id = p.paper_id AND pt.status <> 'error'
        WHERE ({where}) {skip}
        ORDER BY (COALESCE(t.abstract_openalex, t.arxiv_abstract) IS NOT NULL), p.paper_id""",
                        [f"{p}%" for p in prefixes]).fetchall()
    return rows[:limit] if limit is not None else rows


def extract_nature_type(record: dict) -> tuple[str | None, str | None]:
    """Pick the most specific article type and detail label from a Springer Nature Meta API record."""
    raw_genre = record.get("genre")
    if isinstance(raw_genre, list):
        genres = [g.strip() for g in raw_genre if isinstance(g, str) and g.strip()]
    elif isinstance(raw_genre, str) and raw_genre.strip():
        genres = [raw_genre.strip()]
    else:
        genres = []
    raw_ctype = record.get("contentType")
    ctype = raw_ctype.strip() if isinstance(raw_ctype, str) and raw_ctype.strip() else None
    specific = [g for g in genres if g.lower() != "article"]
    publisher_type = specific[-1] if specific else (genres[-1] if genres else ctype)
    detail = " ; ".join(genres) if len(genres) > 1 else ctype
    return publisher_type, detail


def _normalise_record_doi(record: dict) -> str:
    raw = (record.get("doi") or record.get("identifier") or "").strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        raw = raw.removeprefix(prefix)
    return raw


def run_nature(conn, refresh, limit, api_key=None):
    key = (api_key if api_key is not None else get_setting("SPRINGER_NATURE_API_KEY")).strip()
    if not key:
        logger.info("Springer Nature: SPRINGER_NATURE_API_KEY not set; skipping")
        return
    todo = todo_for(conn, ("10.1038/s41",), refresh, limit)
    logger.info(f"Springer Nature: {len(todo)} records to fetch")
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    t0 = time.time()
    for start in range(0, len(todo), NATURE_BATCH):
        chunk = todo[start:start + NATURE_BATCH]
        query = urllib.parse.urlencode({
            "q": " OR ".join(f"doi:{doi}" for _, doi in chunk),
            "p": len(chunk),
            "s": 1,
            "api_key": key,
        })
        code, body = fetch_with_retry(f"{SPRINGER_API_URL}?{query}", headers)
        if code in (401, 403, 429):
            logger.warning(f"Springer Nature: HTTP {code}; stopping early (rerun to resume)")
            break
        if code != 200:
            with conn:
                for pid, _ in chunk:
                    save(conn, pid, "nature", None, f"http {code}", "error")
        else:
            try:
                records = json.loads(body).get("records") or []
            except ValueError:
                with conn:
                    for pid, _ in chunk:
                        save(conn, pid, "nature", None, "bad json", "error")
            else:
                by_doi = {d: rec for rec in records if (d := _normalise_record_doi(rec))}
                with conn:
                    for pid, doi in chunk:
                        rec = by_doi.get(doi)
                        if not rec:
                            save(conn, pid, "nature", None, "not found", "unavailable")
                        else:
                            ptype, detail = extract_nature_type(rec)
                            if ptype:
                                save(conn, pid, "nature", ptype, detail, "ok")
                            else:
                                save(conn, pid, "nature", None, "no type", "unavailable")
        done = min(start + len(chunk), len(todo))
        if done % 200 == 0 or done == len(todo):
            rate = done / max(time.time() - t0, 1e-6)
            logger.info(f"  {done}/{len(todo)}  ~{(len(todo) - done) / rate / 60:.0f} min left")
        if start + NATURE_BATCH < len(todo):
            time.sleep(NATURE_DELAY)


def run_aps(conn, all_journals, refresh, limit):
    todo = [(pid, doi) for pid, doi in todo_for(conn, ("10.1103/",) if all_journals else APS_OPEN, refresh, None)
            if "." in doi.split("/", 1)[1]]
    if limit is not None:
        todo = todo[:limit]
    logger.info(f"APS: {len(todo)} records to fetch")
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    t0 = time.time()
    for i, (pid, doi) in enumerate(todo):
        path_doi = urllib.parse.quote(aps_doi(doi), safe="/")
        code, body = fetch_with_retry(f"https://harvest.aps.org/v2/journals/articles/{path_doi}", headers)
        with conn:
            if code == 200:
                try:
                    data = json.loads(body).get("data", {})
                    save(conn, pid, "aps", data.get("articleType"), data.get("type"), "ok")
                except ValueError:
                    save(conn, pid, "aps", None, "bad json", "error")
            else:
                save(conn, pid, "aps", None, f"http {code}", "unavailable" if code in (401, 403, 404) else "error")
        if i % 500 == 0:
            rate = (i + 1) / max(time.time() - t0, 1e-6)
            logger.info(f"  {i + 1}/{len(todo)}  ~{(len(todo) - (i + 1)) / rate / 60:.0f} min left")
        time.sleep(APS_DELAY)


def report(conn):
    for src, t, n in conn.execute("""SELECT source, COALESCE(publisher_type, '(' || status || ')'), COUNT(*)
                                     FROM paper_publisher_types GROUP BY 1, 2 ORDER BY 1, 3 DESC"""):
        logger.info(f"  {src:7} {t:32} {n}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=["nature", "aps"])
    ap.add_argument("--journals", choices=["open", "all"], default="open")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    init_db()
    with open_staging() as conn:
        ensure_table(conn)
        if args.only in (None, "aps"):
            run_aps(conn, args.journals == "all", args.refresh, args.limit)
        if args.only in (None, "nature"):
            run_nature(conn, args.refresh, args.limit)
        report(conn)


if __name__ == "__main__":
    main()
