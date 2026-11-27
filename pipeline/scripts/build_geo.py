#!/usr/bin/env python3
"""Attach city-level coordinates to institutions (for the institution network's Map layout).

Source: ROR organisation records (`locations[0].geonames_details` in ROR v2, `addresses[0]` in v1),
read from the existing ROR cache and fetched for any institution not yet cached.
Institutions with no usable ROR location fall back to their location's centre (the mean of that
location's located institutions) and are marked precision='location'.

Writes table `institution_geo(inst_id, lat, lng, city, precision)` into serve.db.tmp (run before finalize_build.py).

Usage:
  PYTHONPATH=. python3 pipeline/scripts/build_geo.py              # cache + live ROR for misses
  PYTHONPATH=. python3 pipeline/scripts/build_geo.py --cache-only # no network calls
"""
import argparse
import json
import sqlite3
from collections import defaultdict

from pipeline.clients.ror_client import bare_ror_id, extract_ror_coords
from pipeline.core.logger import setup_pipeline_logger
from pipeline.db.connection import SERVE_TMP_PATH, open_build, open_cache

logger = setup_pipeline_logger("build_geo", "build_geo.log")


def load_cached_profiles() -> dict[str, dict]:
    try:
        with open_cache() as conn:
            rows = conn.execute(
                "SELECT url, response FROM ror_api_cache WHERE url LIKE 'https://api.ror.org/organizations/%' "
                "AND url NOT LIKE '%?%'"
            ).fetchall()
    except sqlite3.OperationalError:
        rows = []
    profiles = {}
    for url, response in rows:
        try:
            profiles[url.rsplit("/", 1)[-1]] = json.loads(response)
        except (TypeError, json.JSONDecodeError):
            continue
    return profiles


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cache-only", action="store_true", help="Do not call the ROR API for uncached institutions")
    args = parser.parse_args()

    logger.info(f"Writing institution_geo into {SERVE_TMP_PATH}")
    with open_build() as conn:
        institutions = conn.execute(
            "SELECT inst_id, ror, location_code FROM institutions WHERE inst_id IS NOT NULL"
        ).fetchall()

        profiles = load_cached_profiles()
        logger.info(f"{len(institutions)} institutions; {len(profiles)} cached ROR profiles")

        missing = sorted({rid for _, ror, _ in institutions if (rid := bare_ror_id(ror)) and rid not in profiles})
        if missing and not args.cache_only:
            from pipeline.clients.ror_client import get_ror_profile  # rate-limited + caches its responses
            logger.info(f"Fetching {len(missing)} uncached ROR profiles...")
            for i, rid in enumerate(missing, 1):
                record = get_ror_profile(rid)
                if record:
                    profiles[rid] = record
                if i % 50 == 0:
                    logger.info(f"  {i}/{len(missing)}")
        elif missing:
            logger.info(f"--cache-only: skipping {len(missing)} uncached ROR profiles (location fallback)")

        rows: dict[str, tuple[float, float, str | None, str]] = {}
        by_location: dict[str, list[tuple[float, float]]] = defaultdict(list)
        for inst_id, ror, location in institutions:
            loc = extract_ror_coords(profiles.get(bare_ror_id(ror) or ""))
            if loc:
                lat, lng, city = loc
                rows[inst_id] = (lat, lng, city, "city")
                if location:
                    by_location[location.upper()].append((lat, lng))

        centres = {
            c: (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
            for c, pts in by_location.items()
        }
        fallback = unplaced = 0
        for inst_id, _, location in institutions:
            if inst_id in rows:
                continue
            centre = centres.get((location or "").upper())
            if centre:
                rows[inst_id] = (centre[0], centre[1], None, "location")
                fallback += 1
            else:
                unplaced += 1

        conn.execute("DROP TABLE IF EXISTS institution_geo")
        conn.execute("""
            CREATE TABLE institution_geo (
                inst_id TEXT PRIMARY KEY,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                city TEXT,
                precision TEXT NOT NULL CHECK (precision IN ('city', 'location'))
            )
        """)
        conn.executemany(
            "INSERT INTO institution_geo (inst_id, lat, lng, city, precision) VALUES (?, ?, ?, ?, ?)",
            [(k, *v) for k, v in rows.items()],
        )
    logger.info(
        f"institution_geo: {len(rows) - fallback} city-level, {fallback} location-level, {unplaced} unplaced"
    )


if __name__ == "__main__":
    main()
