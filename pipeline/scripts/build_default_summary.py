#!/usr/bin/env python3
"""The first screen of each list (institutions, researchers) as compressed files the site loads before asking the API.
A researcher shows the same affiliation as everywhere else on the site (authors.latest_affiliation, the rule in
pipeline/core/credit.py); scores that tie are ordered by id, so two builds give the same file."""
import datetime
import gzip
import io
import json
import os
from pipeline.core.locations import load_location_mapping
from pipeline.core.publish import DEFAULT_INSTITUTIONS, DEFAULT_RESEARCHERS, PUBLIC_DIR
from pipeline.core.logger import setup_pipeline_logger
from pipeline.db.connection import SERVE_TMP_PATH, open_build

logger = setup_pipeline_logger("build_default", "build_default.log")


def write_asset(name: str, rows: list[dict]) -> None:
    """Written as <name>.tmp; finalize_build.py moves it into place together with serve.db, after the check."""
    path = os.path.join(PUBLIC_DIR, name + ".tmp")
    ts_ms = os.stat(SERVE_TMP_PATH).st_mtime_ns // 1_000_000
    db_mtime = datetime.datetime.fromtimestamp(ts_ms / 1000, tz=datetime.timezone.utc)
    generated_at = db_mtime.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    with gzip.GzipFile(path, mode="wb", mtime=0) as gz:
        with io.TextIOWrapper(gz, encoding="utf-8") as handle:
            json.dump({
                "entries": rows,
                "metadata": {"generated_at": generated_at}
            }, handle, separators=(",", ":"))


def main() -> None:
    location_mapping = load_location_mapping(prefer_staged=True)  # stops the build, naming the fix, if `make locations` has not run
    with open_build() as conn:
        institutions = conn.execute("""
          SELECT s.entity_id AS institution_id, MAX(i.display_name) AS institution_name,
                 MAX(i.location_code) AS location_code,
                 MAX(i.ror) AS ror, MAX(i.openalex_id) AS openalex_id,
                 SUM(s.total_fractional_score) AS total_fractional_score,
                 SUM(s.paper_count) AS paper_count,
                 (SELECT COUNT(DISTINCT c.author_id) FROM performance_summary_contributors c
                  WHERE c.entity_type = 'institution' AND c.entity_id = s.entity_id) AS core_faculty_count
          FROM performance_summary s
          LEFT JOIN institutions i ON i.inst_id = s.entity_id
          WHERE s.entity_type = 'institution'
          GROUP BY s.entity_id
          HAVING MAX(i.display_name) IS NOT NULL AND TRIM(MAX(i.display_name)) <> ''
          ORDER BY ROUND(SUM(s.total_fractional_score), 9) DESC, s.entity_id
        """).fetchall()
        researchers = conn.execute("""
          SELECT s.entity_id AS author_id, MAX(a.name) AS author_name,
                 MAX(a.orcid) AS orcid, MAX(a.author_id) AS openalex_id,
                 SUM(s.total_fractional_score) AS total_fractional_score,
                 SUM(s.paper_count) AS paper_count,
                 MAX(s.year) AS max_year,
                 MAX(a.latest_affiliation) AS latest_affiliation,
                 MAX(a.latest_location_code) AS location_code
          FROM performance_summary s
          LEFT JOIN authors a ON a.author_id = s.entity_id
          WHERE s.entity_type = 'researcher'
          GROUP BY s.entity_id
          HAVING MAX(a.name) IS NOT NULL AND TRIM(MAX(a.name)) <> ''
          ORDER BY ROUND(SUM(s.total_fractional_score), 9) DESC, s.entity_id
        """).fetchall()
    institution_rows = [
        dict(zip(
            ("institution_id", "institution_name", "location_code",
             "ror", "openalex_id",
             "total_fractional_score", "paper_count", "core_faculty_count"),
            row,
        ))
        for row in institutions
    ]
    researcher_rows = [
        dict(zip(
            ("author_id", "author_name", "orcid", "openalex_id", "total_fractional_score",
             "paper_count", "max_year", "latest_affiliation", "location_code"),
            row,
        ))
        for row in researchers
    ]
    for row in researcher_rows:
        row["type"] = "researcher"  # as in /api/entries/researchers
    for row in institution_rows + researcher_rows:
        code = str(row.get("location_code") or "").strip().upper()
        details = location_mapping.get(code, {})
        row["location"] = details.get("name") or (code or "Unknown")
        row["region"] = details.get("region") or "Global"
    write_asset(DEFAULT_INSTITUTIONS, institution_rows)
    write_asset(DEFAULT_RESEARCHERS, researcher_rows)
    logger.info(
        f"Default summary assets built: institutions={len(institution_rows)} "
        f"researchers={len(researcher_rows)}"
    )


if __name__ == "__main__":
    main()
