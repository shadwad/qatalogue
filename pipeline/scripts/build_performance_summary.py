#!/usr/bin/env python3
"""
Builds the read-optimised tables the list routes use, from the facts build_canonical_facts.py wrote: per entity and
year (performance_summary), per entity, year and topic, venue or location (performance_summary_dimensions), who
contributed (performance_summary_contributors), the venue and location lookups, and the name search tables.
"""
import gc
import sqlite3

import polars as pl

from pipeline.core import credit
from pipeline.core.locations import load_location_mapping
from pipeline.core.logger import setup_pipeline_logger
from pipeline.core.scope import load_scope
from pipeline.db.connection import STAGING_DB_PATH, open_build, open_readonly

logger = setup_pipeline_logger("build_summary", "build_summary.log")

SUMMARY_COLUMNS = ["entity_type", "entity_id", "year", "total_fractional_score", "fractional_count", "paper_count",
                   "faculty_count", "latest_affiliation", "location_code"]

# Dropped first, so this step can be run again on its own (make performance) on the same build database.
SCHEMA = """
    DROP TABLE IF EXISTS performance_summary;
    DROP TABLE IF EXISTS performance_summary_meta;
    DROP TABLE IF EXISTS performance_summary_dimensions;
    DROP TABLE IF EXISTS performance_summary_contributors;
    DROP TABLE IF EXISTS venue_dimension;
    DROP TABLE IF EXISTS location_dimension;
    DROP TABLE IF EXISTS authors_fts;
    DROP TABLE IF EXISTS institutions_fts;
    CREATE TABLE performance_summary (
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, year INTEGER NOT NULL, total_fractional_score REAL NOT NULL,
      fractional_count REAL NOT NULL, paper_count INTEGER NOT NULL, faculty_count INTEGER NOT NULL,
      latest_affiliation TEXT, location_code TEXT,
      PRIMARY KEY (entity_type, entity_id, year)
    );
    CREATE TABLE performance_summary_meta (
      papers_count INTEGER NOT NULL, authorships_count INTEGER NOT NULL, data_revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE performance_summary_dimensions (
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, year INTEGER NOT NULL, dimension_type TEXT NOT NULL,
      dimension_value TEXT NOT NULL, total_count INTEGER NOT NULL, fractional_count REAL NOT NULL,
      adjusted_fractional_count REAL NOT NULL, paper_count INTEGER NOT NULL, faculty_count INTEGER NOT NULL,
      PRIMARY KEY (entity_type, entity_id, year, dimension_type, dimension_value)
    );
    CREATE TABLE performance_summary_contributors (
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, year INTEGER NOT NULL, author_id TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id, year, author_id)
    );
    CREATE TABLE venue_dimension (venue_id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE location_dimension (location_code TEXT PRIMARY KEY, name TEXT NOT NULL, region TEXT);
    CREATE VIRTUAL TABLE authors_fts USING fts5(author_id UNINDEXED, name, orcid, tokenize='trigram');
    CREATE VIRTUAL TABLE institutions_fts USING fts5(inst_id UNINDEXED, display_name, ror, location_code, tokenize='trigram');
"""

INDEXES = """
    CREATE INDEX idx_perf_summary_inst_year ON performance_summary(entity_type, year, total_fractional_score DESC);
    CREATE INDEX idx_perf_summary_dimensions_filter
      ON performance_summary_dimensions(entity_type, dimension_type, dimension_value, year);
"""


def load_facts(conn):
    """The facts, in a fixed order so every sum adds in the same order: institution rows (with is_named, False for
    placeholder authors, whose credit counts for institutions but who are not researchers), researcher rows (one per
    researcher and paper, placeholders left out), the institutions and the paper topics."""
    text = pl.Utf8
    try:
        placeholder_ids = [r[0] for r in conn.execute("SELECT author_id FROM authors WHERE is_placeholder = 1")]
    except sqlite3.OperationalError:
        placeholder_ids = []
    logger.info(f"Excluding {len(placeholder_ids)} placeholder authors from researcher outputs")
    institution_facts = pl.read_database(
        """SELECT author_id, institution_id, paper_id, year, venue_id, location_code, canonical_author_count,
                  fractional_share, adjusted_fractional_share
           FROM author_institution_paper_facts ORDER BY author_id, institution_id, paper_id""",
        conn, schema_overrides={"author_id": text, "institution_id": text, "paper_id": text, "venue_id": text,
                                "location_code": text},
    ).with_columns(is_named=~pl.col("author_id").is_in(placeholder_ids))
    # Researchers are counted per paper rather than per affiliation: a share counts once however many institutions an
    # author lists, and papers with no affiliation still count. For a researcher, Adjusted Fractional and Fractional
    # are the same thing: their share of each paper.
    researcher_facts = pl.read_database(
        """SELECT p.author_id, p.paper_id, p.fractional_share, f.year, f.venue_id
           FROM author_paper_facts p JOIN paper_facts f ON f.paper_id = p.paper_id ORDER BY p.author_id, p.paper_id""",
        conn, schema_overrides={"author_id": text, "paper_id": text, "venue_id": text},
    ).filter(~pl.col("author_id").is_in(placeholder_ids))
    institutions = pl.read_database(
        "SELECT inst_id, display_name, location_code AS inst_location_code FROM institutions ORDER BY inst_id", conn,
        schema_overrides={"inst_id": text, "display_name": text, "inst_location_code": text})
    paper_topics = pl.read_database("SELECT paper_id, topic_id FROM paper_topics ORDER BY paper_id, topic_id", conn,
                                    schema_overrides={"paper_id": text, "topic_id": text})
    return institution_facts, researcher_facts, institutions, paper_topics


NAMED_FACULTY = pl.col("author_id").filter(pl.col("is_named")).n_unique()


def summary(institution_facts, researcher_facts, institutions, shown) -> pl.DataFrame:
    """performance_summary: per institution and year, and per researcher and year with that year's shown affiliation
    (shown: author_id, year, latest_affiliation, location_code; credit.shown_affiliations_sql)."""
    per_institution = (institution_facts.group_by(["institution_id", "year"]).agg(
            total_fractional_score=pl.col("adjusted_fractional_share").sum(),
            fractional_count=pl.col("fractional_share").sum(),
            paper_count=pl.col("paper_id").n_unique(),
            faculty_count=NAMED_FACULTY)
        .join(institutions, left_on="institution_id", right_on="inst_id", how="left")
        .select(pl.lit("institution").alias("entity_type"), pl.col("institution_id").alias("entity_id"), "year",
                "total_fractional_score", "fractional_count", "paper_count", "faculty_count",
                pl.lit(None).cast(pl.Utf8).alias("latest_affiliation"), pl.col("inst_location_code").alias("location_code")))
    per_researcher = (researcher_facts.group_by(["author_id", "year"]).agg(
            total_fractional_score=pl.col("fractional_share").sum(),
            fractional_count=pl.col("fractional_share").sum(),
            paper_count=pl.col("paper_id").n_unique(),
            faculty_count=pl.lit(1, dtype=pl.UInt32))
        .join(shown, on=["author_id", "year"], how="left")
        .select(pl.lit("researcher").alias("entity_type"), pl.col("author_id").alias("entity_id"), *SUMMARY_COLUMNS[2:]))
    return pl.concat([per_institution, per_researcher], how="vertical").sort(["entity_type", "entity_id", "year"])


def contributors(institution_facts, researcher_facts) -> pl.DataFrame:
    """performance_summary_contributors: the named researchers behind each institution-year, and each researcher-year."""
    per_institution = institution_facts.filter(pl.col("is_named")).select(
        pl.lit("institution").alias("entity_type"), pl.col("institution_id").alias("entity_id"), "year", "author_id")
    per_researcher = researcher_facts.select(
        pl.lit("researcher").alias("entity_type"), pl.col("author_id").alias("entity_id"), "year", "author_id")
    return (pl.concat([per_institution, per_researcher], how="vertical").unique()
            .sort(["entity_type", "entity_id", "year", "author_id"]))


def dimensions(institution_facts, researcher_facts, paper_topics) -> pl.DataFrame:
    """performance_summary_dimensions: each entity's counts per topic, venue and location."""
    def with_value(facts, column):
        return facts.filter(pl.col(column).is_not_null() & (pl.col(column) != ""))
    institution_location = institution_facts.with_columns(cc=pl.col("location_code").fill_null(""))
    # A researcher counts once per paper and location, even with two institutions in that location.
    researcher_location = (institution_facts.filter(pl.col("is_named")).with_columns(cc=pl.col("location_code").fill_null(""))
                          .filter(pl.col("cc") != "").unique(["author_id", "paper_id", "cc"], keep="first", maintain_order=True))
    parts = [
        credit.institution_dimension(with_value(institution_facts.join(paper_topics, on="paper_id"), "topic_id"),
                                     "topic", "topic_id", NAMED_FACULTY),
        credit.researcher_dimension(with_value(researcher_facts.join(paper_topics, on="paper_id"), "topic_id"),
                                    "topic", "topic_id"),
        credit.institution_dimension(with_value(institution_facts, "venue_id"), "venue", "venue_id", NAMED_FACULTY),
        credit.researcher_dimension(with_value(researcher_facts, "venue_id"), "venue", "venue_id"),
        credit.institution_dimension(institution_location.filter(pl.col("cc") != ""), "location", "cc", NAMED_FACULTY),
        credit.researcher_dimension(researcher_location, "location", "cc"),
    ]
    return (pl.concat(parts, how="vertical")
            .sort(["entity_type", "entity_id", "year", "dimension_type", "dimension_value"]))


def write_lookups(serve_conn) -> None:
    """The venue and location lookups: the venues of the scope, the locations of public/config/location_mapping.json."""
    serve_conn.executemany('INSERT INTO venue_dimension VALUES (?, ?)', [(v.openalex_id, v.name) for v in load_scope().venues])
    mapping = load_location_mapping(prefer_staged=True)  # stops the build, naming the fix, if `make locations` has not run
    serve_conn.executemany('INSERT INTO location_dimension VALUES (?, ?, ?)',
                           [(code, d.get('name', code), d.get('region', 'Global')) for code, d in sorted(mapping.items())])


def write_meta_and_search(serve_conn) -> None:
    """performance_summary_meta (staging's counts and data revision) and the name search tables."""
    with open_readonly(STAGING_DB_PATH) as staging:
        papers_count = staging.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
        authorships_count = staging.execute("SELECT COUNT(*) FROM authorships").fetchone()[0]
        row = staging.execute("SELECT revision FROM data_revision WHERE id = 1").fetchone()
    authors = serve_conn.execute(
        "SELECT author_id, name, orcid FROM authors WHERE is_placeholder = 0 AND name IS NOT NULL ORDER BY author_id"
    ).fetchall()
    institutions = serve_conn.execute(
        "SELECT inst_id, display_name, ror, location_code FROM institutions ORDER BY inst_id"
    ).fetchall()
    serve_conn.execute("INSERT INTO performance_summary_meta VALUES (?, ?, ?)",
                       (papers_count, authorships_count, row[0] if row else 0))
    serve_conn.executemany("INSERT INTO authors_fts(author_id, name, orcid) VALUES (?, ?, ?)", authors)
    serve_conn.executemany("INSERT INTO institutions_fts(inst_id, display_name, ror, location_code) VALUES (?, ?, ?, ?)",
                           institutions)
    serve_conn.executescript("""
        INSERT INTO authors_fts(authors_fts) VALUES ('optimize');
        INSERT INTO institutions_fts(institutions_fts) VALUES ('optimize');
    """)


def main() -> None:
    with open_build() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        logger.info("Loading facts...")
        institution_facts, researcher_facts, institutions, paper_topics = load_facts(conn)
        shown = pl.DataFrame(
            [(a, y, name, location) for a, y, _inst, name, location in
             conn.execute(credit.shown_affiliations_sql(per_year=True))],
            schema={"author_id": pl.Utf8, "year": pl.Int64, "latest_affiliation": pl.Utf8, "location_code": pl.Utf8},
            orient="row")

        logger.info("Computing summaries...")
        per_year = summary(institution_facts, researcher_facts, institutions, shown)
        who = contributors(institution_facts, researcher_facts)
        by_dimension = dimensions(institution_facts, researcher_facts, paper_topics)
        del institution_facts, researcher_facts, shown

        logger.info("Writing...")
        conn.executescript(SCHEMA)
        conn.executemany("INSERT INTO performance_summary VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", per_year.iter_rows())
        conn.executemany("INSERT INTO performance_summary_contributors VALUES (?, ?, ?, ?)", who.iter_rows())
        conn.executemany("INSERT INTO performance_summary_dimensions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         by_dimension.iter_rows())
        write_lookups(conn)
        conn.commit()
        del per_year, who, by_dimension
        gc.collect()  # free polars memory before SQLite sorts the indexes and builds the search tables

        logger.info("Creating indexes and search tables...")
        write_meta_and_search(conn)
        conn.executescript(INDEXES)
    logger.info("Performance summary and FTS indices built successfully!")


if __name__ == "__main__":
    main()
