#!/usr/bin/env python3
"""
Fetch the corpus from OpenAlex, one venue-year at a time.

pipeline/config/scope.json names the years and venues (see pipeline/core/scope.py). Each (venue, year) is a shard, recorded in
staging's fetch_shards table with the topic filter it was fetched with, OpenAlex's count, and the papers stored. A run fetches
only the shards the scope needs and staging doesn't have yet, or whose topic filter has changed, so widening the years or
adding a venue fetches just the new part. --refresh fetches every shard in scope again.

Only raw OpenAlex data is written here, and a shard is written in one transaction, so a stopped run resumes cleanly:
  - papers, authors and institutions are inserted or updated column by column, never replaced; institutions' OpenAlex
    location code and ROR go to location_code and ror (the ROR enrichment step later fills in what OpenAlex lacks);
  - a paper's authorships are rewritten as a whole, so fetching again never duplicates rows;
  - papers OpenAlex no longer returns for a refetched shard are removed with their authorships.
Author lists that OpenAlex cuts off at 100 in list queries are fetched again from the single-work endpoint.

Usage
  python pipeline/scripts/import.py [--refresh] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone

from pipeline.clients.openalex_client import OpenAlexClient
from pipeline.core.logger import setup_pipeline_logger
from pipeline.core.scope import Scope, Venue, load_scope
from pipeline.db.connection import init_cache_db, init_db, open_staging

logger = setup_pipeline_logger("import", "import.log")

# Only the fields the pipeline reads, which keeps each page small.
FIELDS = "id,title,publication_year,doi,topics,authorships,is_authors_truncated"


def oa_id(raw: str | None) -> str:
    return raw.split("/")[-1] if raw else ""


def shard_url(venue: Venue, year: int, topic_filter: str) -> str:
    parts = [f"primary_location.source.id:{venue.openalex_id}", f"publication_year:{year}", "type:article|conference-paper"]
    if topic_filter:
        parts.append(f"topics.id:{topic_filter}")
    query = urllib.parse.quote(",".join(parts), safe=":,")
    return f"https://api.openalex.org/works?filter={query}&select={FIELDS}&per-page=200"


def shards_to_fetch(conn, scope: Scope, refresh: bool) -> list[tuple[Venue, int, str]]:
    have = {(v, y): f for v, y, f in conn.execute("SELECT venue_id, year, topic_filter FROM fetch_shards")}
    wanted = []
    for venue in scope.venues:
        topic_filter = scope.topic_filter(venue)
        for year in scope.years:
            if refresh or have.get((venue.openalex_id, year)) != topic_filter:
                wanted.append((venue, year, topic_filter))
    return wanted


def affiliation_rows(authorship: dict) -> tuple[list[str], dict[str, list[str]]]:
    """Every affiliation string printed for the author, and for each institution the strings OpenAlex matched to it."""
    strings = [s for s in authorship.get("raw_affiliation_strings") or [] if s]
    by_institution = defaultdict(list)
    for a in authorship.get("affiliations") or []:
        for iid in a.get("institution_ids") or []:
            if a.get("raw_affiliation_string"):
                by_institution[oa_id(iid)].append(a["raw_affiliation_string"])
    return strings, by_institution


def write_shard(conn, venue: Venue, year: int, topic_filter: str, works: list[dict], expected: int) -> None:
    """Stores one shard's papers and records the shard, all in one transaction."""
    ids = [oa_id(w.get("id")) for w in works]
    with conn:
        old = {r[0] for r in conn.execute("SELECT paper_id FROM papers WHERE venue_id = ? AND year = ?",
                                          (venue.openalex_id, year))}
        gone = list(old - set(ids))
        if gone:
            marks = ",".join("?" * len(gone))
            conn.execute(f"DELETE FROM authorships WHERE paper_id IN ({marks})", gone)
            conn.execute(f"DELETE FROM papers WHERE paper_id IN ({marks})", gone)
            logger.info(f"       Removed {len(gone)} paper(s) OpenAlex no longer returns for this shard")

        for work, work_id in zip(works, ids):
            authorships = work.get("authorships") or []
            total_authors = len(authorships)
            doi = work.get("doi")
            conn.execute("""
                INSERT INTO papers (paper_id, title, year, venue_id, venue_name, total_authors, paper_score, topics, doi)
                VALUES (?, ?, ?, ?, ?, ?, 1.0, ?, ?)
                ON CONFLICT(paper_id) DO UPDATE SET
                  title = excluded.title, year = excluded.year, venue_id = excluded.venue_id, venue_name = excluded.venue_name,
                  total_authors = excluded.total_authors, topics = excluded.topics, doi = excluded.doi
            """, (work_id, work.get("title") or "Untitled Publication", work.get("publication_year"), venue.openalex_id,
                  venue.name, total_authors,
                  ",".join(oa_id(t.get("id")) for t in work.get("topics") or [] if t.get("id")),
                  doi.split("doi.org/")[-1] if doi else None))

            conn.execute("DELETE FROM authorships WHERE paper_id = ?", (work_id,))
            seen = set()
            for idx, authorship in enumerate(authorships):
                author = authorship.get("author") or {}
                author_id = oa_id(author.get("id")) or f"NO_ID_{work_id}_{idx}"
                orcid = oa_id(author.get("orcid")) or None
                conn.execute("""
                    INSERT INTO authors (author_id, name, orcid) VALUES (?, ?, ?)
                    ON CONFLICT(author_id) DO UPDATE SET name = excluded.name, orcid = excluded.orcid
                """, (author_id, author.get("display_name"), orcid))

                strings, by_institution = affiliation_rows(authorship)
                strings_json = json.dumps(strings, ensure_ascii=False) if strings else None
                institutions = authorship.get("institutions") or []
                if not institutions:
                    if (author_id, None) not in seen:
                        seen.add((author_id, None))
                        conn.execute("""
                            INSERT INTO authorships (paper_id, author_id, openalex_author_id, raw_affiliation_string,
                                                     openalex_institution_id, raw_affiliation_strings)
                            VALUES (?, ?, ?, ?, NULL, ?)
                        """, (work_id, author_id, author_id, strings[0] if len(strings) == 1 else None, strings_json))
                    continue
                for inst_idx, inst in enumerate(institutions):
                    inst_id = oa_id(inst.get("id")) or f"NO_INST_{work_id}_{author_id}_{inst_idx}"
                    if (author_id, inst_id) in seen:
                        continue
                    seen.add((author_id, inst_id))
                    ror, location = oa_id(inst.get("ror")) or None, inst.get("country_code")
                    conn.execute("""
                        INSERT INTO institutions (inst_id, ror, openalex_id, display_name, location_code)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(inst_id) DO UPDATE SET display_name = excluded.display_name,
                          ror = excluded.ror, location_code = excluded.location_code
                    """, (inst_id, ror, inst_id, inst.get("display_name"), location))
                    matched = by_institution.get(inst_id) or (strings if len(strings) == 1 else [])
                    conn.execute("""
                        INSERT INTO authorships (paper_id, author_id, openalex_author_id, raw_affiliation_string,
                                                 openalex_institution_id, raw_affiliation_strings)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (work_id, author_id, author_id, max(matched, key=len) if matched else None, inst_id, strings_json))

        conn.execute("""
            INSERT INTO fetch_shards (venue_id, year, topic_filter, expected, papers, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(venue_id, year) DO UPDATE SET topic_filter = excluded.topic_filter, expected = excluded.expected,
              papers = excluded.papers, fetched_at = excluded.fetched_at
        """, (venue.openalex_id, year, topic_filter, expected, len(works),
              datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")))


def fetch_shard(client: OpenAlexClient, venue: Venue, year: int, topic_filter: str) -> tuple[list[dict], int]:
    works, expected = client.fetch_all(shard_url(venue, year, topic_filter))
    truncated = [i for i, w in enumerate(works) if w.get("is_authors_truncated")]
    for i in truncated:
        full = client.fetch_work(oa_id(works[i].get("id")))
        if full is None or full.get("is_authors_truncated"):
            raise RuntimeError(f"could not fetch the full author list of {oa_id(works[i].get('id'))}")
        works[i] = full
    if truncated:
        logger.info(f"       Fetched the full author list of {len(truncated)} paper(s)")
    return works, expected


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="fetch every shard in scope again")
    ap.add_argument("--dry-run", action="store_true", help="list the shards a run would fetch, without fetching")
    args = ap.parse_args()

    scope = load_scope()
    init_db()
    init_cache_db()
    with open_staging() as conn:
        todo = shards_to_fetch(conn, scope, args.refresh)
        total = len(scope.venues) * len(scope.years)
        logger.info(f"Scope: {len(scope.venues)} venues, {scope.start_year}–{scope.end_year}: {total} shards, "
                    f"{len(todo)} to fetch")
        if args.dry_run:
            for venue, year, topic_filter in todo:
                logger.info(f"  {venue.name} {year}{' (topic filter)' if topic_filter else ''}")
            return 0

        client = OpenAlexClient()
        failed, stored = [], 0
        for n, (venue, year, topic_filter) in enumerate(todo, 1):
            logger.info(f"[{n}/{len(todo)}] {venue.name} {year}")
            try:
                works, expected = fetch_shard(client, venue, year, topic_filter)
                write_shard(conn, venue, year, topic_filter, works, expected)
            except Exception as e:  # one bad shard shouldn't stop the others; it stays unfetched for the next run
                logger.error(f"       Failed: {e}")
                failed.append(f"{venue.name} {year}")
                continue
            stored += len(works)
            note = "" if len(works) == expected else f" (OpenAlex counted {expected})"
            logger.info(f"       {len(works)} papers{note}")

    logger.info(f"Fetched {len(todo) - len(failed)} of {len(todo)} shards, {stored} papers.")
    if failed:
        logger.error(f"{len(failed)} shard(s) failed and will be fetched on the next run: {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
