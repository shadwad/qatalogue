#!/usr/bin/env python3
"""
Builds the served facts from staging, after the merge step: the papers in scope, and one row per person and paper and
per person, institution and paper, with their shares (pipeline/core/credit.py has the rules). Starts serve.db.tmp afresh;
the later build steps add to it, check_build.py checks it, finalize_build.py puts it live.
"""
import gc
import os

import polars as pl

from pipeline.core import credit, suppressions
from pipeline.core.logger import setup_pipeline_logger
from pipeline.core.placeholders import is_placeholder_name
from pipeline.core.publish import DEFAULT_SUMMARIES, PUBLIC_DIR
from pipeline.core.scope import load_scope
from pipeline.db.connection import STAGING_DB_PATH, SERVE_TMP_PATH, init_db, open_build, open_readonly

logger = setup_pipeline_logger("build_facts", "build_facts.log")

SCHEMA = """
    CREATE TABLE paper_facts (
      paper_id TEXT PRIMARY KEY, title TEXT, year INTEGER, venue_id TEXT, venue_name TEXT, topics TEXT,
      total_authors INTEGER, doi TEXT
    );
    CREATE TABLE author_paper_facts (
      author_id TEXT NOT NULL, paper_id TEXT NOT NULL, canonical_author_count INTEGER NOT NULL,
      fractional_share REAL NOT NULL, total_authors INTEGER,
      PRIMARY KEY (author_id, paper_id)
    );
    CREATE TABLE author_institution_paper_facts (
      author_id TEXT NOT NULL, institution_id TEXT NOT NULL, paper_id TEXT NOT NULL, year INTEGER, venue_id TEXT,
      location_code TEXT, canonical_author_count INTEGER NOT NULL, fractional_share REAL NOT NULL,
      adjusted_fractional_share REAL NOT NULL,
      PRIMARY KEY (author_id, institution_id, paper_id)
    );
    CREATE TABLE paper_topics (paper_id TEXT NOT NULL, topic_id TEXT NOT NULL, PRIMARY KEY (paper_id, topic_id));
    CREATE TABLE paper_venues (paper_id TEXT NOT NULL, venue_id TEXT NOT NULL, PRIMARY KEY (paper_id, venue_id));
"""

INDEXES = """
    CREATE INDEX idx_paper_facts_year ON paper_facts(year);
    CREATE INDEX idx_paper_facts_venue_year ON paper_facts(venue_id, year);
    CREATE INDEX idx_author_paper_paper ON author_paper_facts(paper_id);
    CREATE INDEX idx_author_inst_year ON author_institution_paper_facts(year);
    CREATE INDEX idx_author_inst_inst_year_author ON author_institution_paper_facts(institution_id, year, author_id);
    CREATE INDEX idx_author_inst_paper ON author_institution_paper_facts(paper_id);
    CREATE INDEX idx_author_inst_location ON author_institution_paper_facts(location_code);
    CREATE INDEX idx_author_inst_venue ON author_institution_paper_facts(venue_id);
    CREATE INDEX idx_paper_topics_topic ON paper_topics(topic_id, paper_id);
    CREATE INDEX idx_paper_venues_venue ON paper_venues(venue_id, paper_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_authors_author_id ON authors(author_id);
    CREATE UNIQUE INDEX idx_institutions_inst_id ON institutions(inst_id);
"""


def served_papers_filter(conn, scope) -> tuple[str, bool]:
    """The WHERE clause that keeps a staging paper: inside the scope (pipeline/config/scope.json; staging can hold more
    after the scope narrows) and research (classify_articles.py: reviews, perspectives, news, editorials, comments and
    errata stay in staging only, so they are never listed, ranked, searched, mapped or counted). Also whether
    paper_classes exists."""
    # A paper OpenAlex holds twice is served once (pipeline/stages/duplicates.py).
    in_scope = (f"paper_id IN (SELECT paper_id FROM papers WHERE {scope.papers_sql()}) "
                "AND paper_id NOT IN (SELECT paper_id FROM duplicate_papers)")
    n_duplicates = conn.execute("SELECT COUNT(*) FROM duplicate_papers").fetchone()[0]
    if n_duplicates:
        logger.info(f"Leaving out {n_duplicates} duplicate copies of papers (duplicate_papers)")
    n_outside = conn.execute(f"SELECT COUNT(*) FROM papers WHERE NOT ({scope.papers_sql()})").fetchone()[0]
    if n_outside:
        logger.info(f"Leaving out {n_outside} papers outside the scope")
    has_classes = bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'paper_classes'").fetchone())
    if not has_classes:
        logger.warning("staging.paper_classes missing: run classify_articles.py; serving every paper")
        return f" WHERE {in_scope}", False
    n_excluded = conn.execute("SELECT COUNT(*) FROM paper_classes WHERE is_research = 0").fetchone()[0]
    logger.info(f"Leaving out {n_excluded} non-research papers (paper_classes)")
    return f" WHERE {in_scope} AND paper_id NOT IN (SELECT paper_id FROM paper_classes WHERE is_research = 0)", True


def load_staging(conn, served: str) -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame, pl.DataFrame]:
    """authorships, authors (author_id, canonical_author_id), papers and institutions of the served papers."""
    text = pl.Utf8
    authorships = pl.read_database(
        # A row OpenAlex left without an institution takes those recovered from its printed affiliation (affiliations.py).
        """SELECT paper_id, author_id, openalex_institution_id, corrected_institution_id FROM (
             SELECT a.paper_id, a.author_id, COALESCE(a.openalex_institution_id, r.inst_id) AS openalex_institution_id,
                    a.corrected_institution_id
             FROM authorships a LEFT JOIN recovered_affiliations r
               ON a.openalex_institution_id IS NULL AND r.paper_id = a.paper_id AND r.author_id = a.author_id)"""
        + served + " ORDER BY paper_id, author_id, openalex_institution_id",
        conn, schema_overrides={"paper_id": text, "author_id": text, "openalex_institution_id": text,
                                "corrected_institution_id": text})
    authors = pl.read_database("SELECT author_id, name, canonical_author_id FROM authors ORDER BY author_id", conn,
                               schema_overrides={"author_id": text, "name": text, "canonical_author_id": text})
    # Placeholder authors ("Anonymous", …) are distinct unknown people: undo any merge that grouped them (or merged a
    # real author into one), so each keeps its own id and paper author counts stay correct.
    placeholder_ids = [a for a, name in authors.select(["author_id", "name"]).iter_rows() if is_placeholder_name(name)]
    authors = authors.with_columns(canonical_author_id=pl.when(
        pl.col("author_id").is_in(placeholder_ids) | pl.col("canonical_author_id").is_in(placeholder_ids)
    ).then(pl.col("author_id")).otherwise(pl.col("canonical_author_id"))).select(["author_id", "canonical_author_id"])
    logger.info(f"Placeholder authors kept separate: {len(placeholder_ids)}")
    papers = pl.read_database(
        "SELECT paper_id, title, year, venue_id, venue_name, topics, total_authors, doi FROM papers" + served
        + " ORDER BY paper_id",
        conn, schema_overrides={"paper_id": text, "venue_id": text, "topics": text, "doi": text})
    institutions = pl.read_database("SELECT inst_id, canonical_inst_id, location_code FROM institutions ORDER BY inst_id",
                                    conn, schema_overrides={"inst_id": text, "canonical_inst_id": text,
                                                            "location_code": text})
    return authorships, authors, papers, institutions


def write_facts(serve_conn, papers, author_paper, author_institution) -> None:
    serve_conn.executescript(SCHEMA)
    serve_conn.executemany("INSERT INTO paper_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?)", papers.iter_rows())
    serve_conn.executemany("INSERT INTO author_paper_facts VALUES (?, ?, ?, ?, ?)", author_paper.iter_rows())
    serve_conn.executemany("INSERT INTO author_institution_paper_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           author_institution.iter_rows())


def copy_reference_tables(serve_conn, scope, has_classes: bool) -> None:
    """Authors, institutions, topics, platforms and venues of the served papers, from staging."""
    serve_conn.execute("ATTACH DATABASE ? AS staging", (os.path.abspath(STAGING_DB_PATH),))
    serve_conn.create_function("is_placeholder_name", 1, lambda n: 1 if is_placeholder_name(n) else 0, deterministic=True)
    # Canonical authors, plus every placeholder author (kept separate, whatever staging says). Rows whose canonical
    # points at a placeholder are also their own identity now.
    serve_conn.execute("""
      CREATE TABLE main.authors AS
      SELECT a.author_id, a.name, a.orcid,
             CASE WHEN is_placeholder_name(a.name) = 1 OR is_placeholder_name(c.name) = 1 THEN a.author_id
                  ELSE a.canonical_author_id END AS canonical_author_id,
             is_placeholder_name(a.name) AS is_placeholder,
             CAST(NULL AS TEXT) AS latest_affiliation, CAST(NULL AS TEXT) AS latest_location_code
      FROM staging.authors a
      LEFT JOIN staging.authors c ON c.author_id = a.canonical_author_id
      WHERE a.canonical_author_id IS NULL OR a.canonical_author_id = a.author_id
         OR is_placeholder_name(a.name) = 1 OR is_placeholder_name(c.name) = 1
      ORDER BY a.author_id
    """)
    serve_conn.execute("""CREATE TABLE main.institutions AS SELECT inst_id, display_name, ror, location_code, openalex_id
                          FROM staging.institutions WHERE canonical_inst_id IS NULL OR canonical_inst_id = inst_id
                          ORDER BY inst_id""")

    # Topics come from data/taxonomy.json through the assignment step (assign_topics.py -> staging.paper_subtopics):
    # one row per topic and one per "topic/subtopic", so filtering on either level uses the same table.
    if not serve_conn.execute(
            "SELECT 1 FROM staging.sqlite_master WHERE type = 'table' AND name = 'paper_subtopics'").fetchone():
        raise RuntimeError("staging.paper_subtopics is missing: run pipeline/scripts/assign_topics.py (make topics) first")
    served = "paper_id IN (SELECT paper_id FROM main.paper_facts)"
    serve_conn.execute(f"""
      INSERT OR IGNORE INTO paper_topics (paper_id, topic_id)
      SELECT paper_id, topic_id FROM staging.paper_subtopics WHERE {served}
      UNION
      SELECT paper_id, topic_id || '/' || subtopic_id FROM staging.paper_subtopics WHERE {served}
      ORDER BY 1, 2
    """)
    serve_conn.executescript(f"""
      CREATE TABLE main.paper_subtopics AS SELECT * FROM staging.paper_subtopics WHERE {served} ORDER BY 1, 2, 3;
      CREATE INDEX main.idx_paper_subtopics_paper ON paper_subtopics(paper_id);
      CREATE TABLE main.paper_platforms AS SELECT * FROM staging.paper_platforms WHERE {served} ORDER BY 1, 2;
      CREATE INDEX main.idx_paper_platforms_platform ON paper_platforms(platform_id, paper_id);
      CREATE INDEX main.idx_paper_platforms_paper ON paper_platforms(paper_id);
    """)
    serve_conn.execute(f"""
      INSERT INTO paper_venues (paper_id, venue_id)
      SELECT paper_id, venue_id FROM staging.papers WHERE venue_id IS NOT NULL AND venue_id <> '' AND {served}
      ORDER BY paper_id
    """)
    # For reference only (no route reads it): what was left out and why.
    if has_classes:
        serve_conn.execute("""
          CREATE TABLE main.excluded_papers AS
          SELECT p.paper_id, p.title, p.year, p.venue_name, p.doi, c.kind, c.reason
          FROM staging.papers p JOIN staging.paper_classes c ON c.paper_id = p.paper_id
          WHERE c.is_research = 0 AND """ + scope.papers_sql('p') + " ORDER BY p.paper_id")


def set_shown_affiliations(serve_conn) -> int:
    """authors.latest_affiliation and latest_location_code, by credit.shown_affiliations_sql. Returns how many were set."""
    rows = serve_conn.execute(credit.shown_affiliations_sql(per_year=False)).fetchall()
    serve_conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_authors_author_id ON authors(author_id)")  # one lookup per update
    serve_conn.executemany("UPDATE authors SET latest_affiliation = ?, latest_location_code = ? WHERE author_id = ?",
                           [(name, location, author) for author, _year, _inst, name, location in rows])
    return len(rows)


def main() -> None:
    init_db()  # staging's tables and columns, including recovered_affiliations, even before the merge step has run
    scope = load_scope()
    with open_readonly(STAGING_DB_PATH) as conn:
        served, has_classes = served_papers_filter(conn, scope)
        logger.info("Loading staging...")
        authorships, authors, papers, institutions = load_staging(conn, served)

    logger.info("Computing facts...")
    a_c = credit.canonical_authorships(authorships, authors)
    author_paper = credit.author_paper_facts(a_c, papers)
    author_institution = credit.author_institution_paper_facts(a_c, papers, institutions)
    del authorships, authors, a_c

    # Every build starts from an empty serve.db.tmp (and clears stale staged default summaries), so nothing is left over from a build that stopped at the check.
    for leftover in (SERVE_TMP_PATH, SERVE_TMP_PATH + "-wal", SERVE_TMP_PATH + "-shm",
                     *(os.path.join(PUBLIC_DIR, name + ".tmp") for name in DEFAULT_SUMMARIES)):
        if os.path.exists(leftover):
            os.remove(leftover)
    with open_build(must_exist=False) as serve_conn:
        logger.info("Writing facts...")
        write_facts(serve_conn, papers, author_paper, author_institution)
        counts = (papers.height, author_paper.height, author_institution.height)
        del papers, author_paper, author_institution
        gc.collect()  # free polars memory before SQLite sorts the indexes

        logger.info("Copying authors, institutions, topics and venues...")
        copy_reference_tables(serve_conn, scope, has_classes)
        logger.info(f"Shown affiliations set for {set_shown_affiliations(serve_conn):,} researchers")
        # After the affiliations, which would fill them in again. Their credit stays in every total; they are not listed.
        logger.info(f"Researchers not listed at their request (data/suppressions.json): {suppressions.apply_to_served_authors(serve_conn):,}")
        logger.info("Creating indexes...")
        serve_conn.executescript(INDEXES)
    logger.info("Canonical facts built: papers=%d author_papers=%d author_institution_papers=%d" % counts)


if __name__ == "__main__":
    main()
