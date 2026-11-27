"""
Pure attribution and shown-affiliation rules used by build_canonical_facts.py and
build_performance_summary.py (verified in tests/pipeline/test_credit.py).

  Fractional         1 / number of canonical authors on the paper.
  Adjusted           fractional share split equally across each author's canonical institutions on the paper.
  Shown affiliation  an author's primary institution in their latest active year (ordered by paper count,
                     total credit, then lowest id) and modal location code (alphabetical on ties).

Outputs are sorted deterministically so identical staging inputs produce identical tables.
"""
from __future__ import annotations

import polars as pl

AUTHOR_PAPER_COLUMNS = ["author_id", "paper_id", "canonical_author_count", "fractional_share", "total_authors"]
AUTHOR_INSTITUTION_COLUMNS = ["author_id", "institution_id", "paper_id", "year", "venue_id", "location_code",
                              "canonical_author_count", "fractional_share", "adjusted_fractional_share"]


def one_over(column: str) -> pl.Expr:
    """1 / column, treating a missing or zero count as one."""
    return 1.0 / pl.col(column).fill_null(1).replace(0, 1)


def canonical_authorships(authorships: pl.DataFrame, authors: pl.DataFrame) -> pl.DataFrame:
    """Each authorship with canonical_author_id, the person its author record belongs to (itself when unmerged).
    authors: author_id, canonical_author_id (placeholders already their own, see build_canonical_facts.load_staging)."""
    return authorships.join(authors, on="author_id", how="left").with_columns(
        canonical_author_id=pl.col("canonical_author_id").fill_null(pl.col("author_id")))


def author_counts(a_c: pl.DataFrame) -> pl.DataFrame:
    """paper_id, canonical_author_count: the distinct people on each paper."""
    return a_c.group_by("paper_id").agg(canonical_author_count=pl.col("canonical_author_id").n_unique())


def author_paper_facts(a_c: pl.DataFrame, papers: pl.DataFrame) -> pl.DataFrame:
    """One row per person and paper, with their Fractional share. Papers with no affiliation count too."""
    return (a_c.join(author_counts(a_c), on="paper_id", how="left")
            .join(papers.select(["paper_id", "total_authors"]), on="paper_id", how="left")
            .group_by(["canonical_author_id", "paper_id"]).agg(
                canonical_author_count=pl.col("canonical_author_count").first(),
                total_authors=pl.col("total_authors").first())
            .with_columns(fractional_share=one_over("canonical_author_count"))
            .rename({"canonical_author_id": "author_id"})
            .select(AUTHOR_PAPER_COLUMNS)
            .sort(["author_id", "paper_id"]))


def author_institution_paper_facts(a_c: pl.DataFrame, papers: pl.DataFrame, institutions: pl.DataFrame) -> pl.DataFrame:
    """One row per person, institution and paper, with the Fractional and Adjusted shares.

    The institution is the corrected one if merge_entities.py moved the row, else OpenAlex's (or a recovered one), then its
    canonical institution after merges. location_code is that institution record's location; when merged records
    disagree, the alphabetically first. institutions: inst_id, canonical_inst_id, location_code."""
    rows = (a_c.with_columns(base_inst_id=pl.col("corrected_institution_id").fill_null(pl.col("openalex_institution_id")))
            .join(institutions, left_on="base_inst_id", right_on="inst_id", how="left")
            .with_columns(institution_id=pl.col("canonical_inst_id").fill_null(pl.col("base_inst_id")))
            .filter(pl.col("institution_id").is_not_null())
            .join(papers.select(["paper_id", "year", "venue_id"]), on="paper_id", how="left")
            .join(author_counts(a_c), on="paper_id", how="left"))
    institution_counts = rows.group_by(["canonical_author_id", "paper_id"]).agg(
        institution_count=pl.col("institution_id").n_unique())
    return (rows.group_by(["canonical_author_id", "institution_id", "paper_id"]).agg(
                year=pl.col("year").first(),
                venue_id=pl.col("venue_id").first(),
                location_code=pl.col("location_code").drop_nulls().sort().first(),
                canonical_author_count=pl.col("canonical_author_count").first())
            .join(institution_counts, on=["canonical_author_id", "paper_id"], how="left")
            .with_columns(fractional_share=one_over("canonical_author_count"))
            .with_columns(adjusted_fractional_share=pl.col("fractional_share") / pl.col("institution_count"))
            .rename({"canonical_author_id": "author_id"})
            .select(AUTHOR_INSTITUTION_COLUMNS)
            .sort(["author_id", "institution_id", "paper_id"]))


def shown_affiliations_sql(per_year: bool) -> str:
    """SQL over the build's author_institution_paper_facts and institutions: author_id, year, institution_id,
    display_name, location_code of each researcher's shown affiliation (the rule above), in their latest year or, with
    per_year, in every year. Credit is compared at 9 decimals, so two equal halves of a paper tie as they should."""
    latest = "" if per_year else """
          JOIN (SELECT author_id, MAX(year) AS year FROM per_inst GROUP BY author_id) l
            ON l.author_id = p.author_id AND l.year = p.year"""
    return f"""
        WITH rows AS (
          SELECT a.author_id, COALESCE(a.year, 0) AS year, a.institution_id, a.paper_id, a.adjusted_fractional_share,
                 NULLIF(a.location_code, '') AS location_code
          FROM author_institution_paper_facts a JOIN institutions i ON i.inst_id = a.institution_id
        ), per_inst AS (
          SELECT author_id, year, institution_id, COUNT(DISTINCT paper_id) AS papers,
                 ROUND(SUM(adjusted_fractional_share), 9) AS credit
          FROM rows GROUP BY author_id, year, institution_id
        ), ranked AS (
          SELECT p.author_id, p.year, p.institution_id,
                 ROW_NUMBER() OVER (PARTITION BY p.author_id, p.year
                                    ORDER BY p.papers DESC, p.credit DESC, p.institution_id) AS rn
          FROM per_inst p{latest}
        ), locations AS (
          SELECT author_id, year, institution_id, location_code,
                 ROW_NUMBER() OVER (PARTITION BY author_id, year, institution_id
                                    ORDER BY COUNT(*) DESC, location_code) AS rn
          FROM rows WHERE location_code IS NOT NULL
          GROUP BY author_id, year, institution_id, location_code
        )
        SELECT r.author_id, r.year, r.institution_id, i.display_name, COALESCE(c.location_code, i.location_code)
        FROM ranked r
        JOIN institutions i ON i.inst_id = r.institution_id
        LEFT JOIN locations c ON c.author_id = r.author_id AND c.year = r.year AND c.institution_id = r.institution_id
                             AND c.rn = 1
        WHERE r.rn = 1
        ORDER BY r.author_id, r.year"""


# The performance_summary_dimensions rows, one spec per (entity, dimension): (dimension_type, the column holding the
# value). Institutions sum the Adjusted share; researchers count each paper once, so their Adjusted is their Fractional.
DIMENSION_COLUMNS = ["entity_type", "entity_id", "year", "dimension_type", "dimension_value",
                     "total_count", "fractional_count", "adjusted_fractional_count", "paper_count", "faculty_count"]


def institution_dimension(facts: pl.DataFrame, dimension_type: str, value: str, named_faculty: pl.Expr) -> pl.DataFrame:
    """Per institution, year and value of a dimension (facts already restricted to rows with a value)."""
    return (facts.group_by(["institution_id", "year", value]).agg(
                total_count=pl.col("paper_id").n_unique(),
                fractional_count=one_over("canonical_author_count").sum(),
                adjusted_fractional_count=pl.col("adjusted_fractional_share").sum(),
                paper_count=pl.col("paper_id").n_unique(),
                faculty_count=named_faculty)
            .select(pl.lit("institution").alias("entity_type"), pl.col("institution_id").alias("entity_id"), "year",
                    pl.lit(dimension_type).alias("dimension_type"), pl.col(value).alias("dimension_value"),
                    *DIMENSION_COLUMNS[5:]))


def researcher_dimension(facts: pl.DataFrame, dimension_type: str, value: str) -> pl.DataFrame:
    """Per researcher, year and value of a dimension (facts: one row per researcher, paper and value)."""
    return (facts.group_by(["author_id", "year", value]).agg(
                total_count=pl.col("paper_id").n_unique(),
                fractional_count=pl.col("fractional_share").sum(),
                adjusted_fractional_count=pl.col("fractional_share").sum(),
                paper_count=pl.col("paper_id").n_unique(),
                faculty_count=pl.col("author_id").n_unique())
            .select(pl.lit("researcher").alias("entity_type"), pl.col("author_id").alias("entity_id"), "year",
                    pl.lit(dimension_type).alias("dimension_type"), pl.col(value).alias("dimension_value"),
                    *DIMENSION_COLUMNS[5:]))
