import importlib
import math
import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import networkx as nx

import _env

_env.init()
from pipeline.clients.ror_client import bare_ror_id, extract_ror_coords, extract_ror_country
from pipeline.core import audit
from pipeline.core.author import AuthorRecord
from pipeline.db.connection import SERVE_TMP_PATH, get_staging_connection
from pipeline.scripts import build_default_summary, finalize_build
from pipeline.stages import ror_gravity
from pipeline.stages.apply_merges import apply_author_merges, apply_inst_merges
from pipeline.stages.pairwise_scoring import _score_pair, apply_scored_merges
import test_credit


class RorClientAndScoringTests(unittest.TestCase):
    def test_ror_id_country_and_coords_parsing(self):
        self.assertEqual(bare_ror_id(" https://ror.org/04eswfz98/ "), "04eswfz98")
        self.assertEqual(bare_ror_id("04eswfz98"), "04eswfz98")
        self.assertIsNone(bare_ror_id("https://ror.org/"))
        self.assertIsNone(bare_ror_id(""))

        v2 = {"locations": [{"geonames_details": {"country_code": "CH", "lat": 47.37, "lng": 8.54, "name": "Zurich"}}]}
        v1 = {"country": {"country_code": "US"}, "addresses": [{"lat": 42.36, "lng": -71.09, "city": "Cambridge"}]}
        self.assertEqual(extract_ror_country(v2), "CH")
        self.assertEqual(extract_ror_country(v1), "US")
        self.assertIsNone(extract_ror_country({"locations": []}))
        self.assertEqual(extract_ror_coords(v2), (47.37, 8.54, "Zurich"))
        self.assertEqual(extract_ror_coords(v1), (42.36, -71.09, "Cambridge"))
        self.assertIsNone(extract_ror_coords({}))

    def test_score_pair_prefers_shorter_id_before_lexicographic(self):
        a9 = AuthorRecord(id="A9", name="Wei Wang", inst_ids={"I1"})
        a10 = AuthorRecord(id="A10", name="Wei Wang", inst_ids={"I1"})
        cand1 = _score_pair(a9, a10)
        cand2 = _score_pair(a10, a9)
        self.assertIsNotNone(cand1)
        self.assertEqual((cand1.id_keep, cand1.id_merge), ("A9", "A10"))
        self.assertEqual((cand2.id_keep, cand2.id_merge), ("A9", "A10"))

    def test_build_default_summary_imports_without_location_mapping(self):
        with mock.patch.dict(os.environ, {"LOCATION_MAPPING_PATH": "/nonexistent/location_mapping.json"}):
            reloaded = importlib.reload(build_default_summary)
            self.assertTrue(callable(reloaded.main))

    def test_serve_db_indexes_and_analyze_statistics(self):
        test_credit.stage()
        db = test_credit.build()
        try:
            objects = {
                (r[0], r[1])
                for r in db.execute("SELECT type, name FROM sqlite_master")
            }
            self.assertNotIn(("table", "papers_fts"), objects)
            for idx in (
                "idx_author_inst_inst_year_author",
                "idx_paper_facts_venue_year",
                "idx_paper_topics_topic",
                "idx_paper_venues_venue",
                "idx_authors_author_id",
                "idx_institutions_inst_id",
            ):
                self.assertIn(("index", idx), objects, f"missing expected index {idx}")
            for dropped in (
                "idx_author_paper_author",
                "idx_author_inst_author",
                "idx_author_inst_institution",
                "idx_perf_summary_entity",
                "idx_perf_summary_dimensions_entity",
                "idx_perf_summary_contributors_entity",
            ):
                self.assertNotIn(("index", dropped), objects, f"redundant index {dropped} still exists")
        finally:
            db.close()

        with tempfile.TemporaryDirectory(prefix="qatalogue-analyze-") as td:
            copy_db = Path(td) / "serve.db.tmp"
            shutil.copy2(SERVE_TMP_PATH, copy_db)
            finalize_build.leave_wal_mode(str(copy_db))
            conn = sqlite3.connect(copy_db)
            try:
                stat_rows = conn.execute("SELECT COUNT(*) FROM sqlite_stat1").fetchone()[0]
                self.assertGreater(stat_rows, 0)
            finally:
                conn.close()


class UpstreamRefinementsTests(unittest.TestCase):
    def test_manual_override_flattens_chains_and_reversals_without_two_hop_orphans(self):
        _env.fresh_staging()
        with get_staging_connection() as conn:
            conn.executemany(
                "INSERT INTO authors (author_id, name, canonical_author_id) VALUES (?, ?, ?)",
                [("A", "Alice", None), ("B", "Alice B", "A"), ("C", "A. C", "A")],
            )
            conn.executemany(
                "INSERT INTO institutions (inst_id, display_name, canonical_inst_id) VALUES (?, ?, ?)",
                [("I1", "Inst One", None), ("I2", "Inst Two", "I1"), ("I3", "Inst Three", "I1")],
            )
            conn.commit()
        apply_author_merges({"A": "B"}, flatten=True)
        apply_inst_merges({"I1": "I2"}, flatten=True)
        with get_staging_connection() as conn:
            authors = dict(conn.execute("SELECT author_id, canonical_author_id FROM authors").fetchall())
            insts = dict(conn.execute("SELECT inst_id, canonical_inst_id FROM institutions").fetchall())
        self.assertEqual(authors, {"A": "B", "B": None, "C": "B"})
        self.assertEqual(insts, {"I1": "I2", "I2": None, "I3": "I2"})

    def test_ror_gravity_skips_ror_lookups_on_mismatched_names_and_clamps_haversine(self):
        self.assertAlmostEqual(ror_gravity.haversine(10.0, 20.0, -10.0, -160.0), math.pi * 6371, places=3)
        histories = [
            ("A1", "I1", "Alpha University", "US", 5, "01alpha00"),
            ("A1", "I2", "Beta Institute", "CH", 1, "02beta000"),
        ]
        with mock.patch.object(ror_gravity, "get_author_inst_histories", return_value=histories), \
             mock.patch.object(ror_gravity, "get_ror_profile") as mocked_profile:
            self.assertEqual(ror_gravity.run_ror_phases(), [])
            mocked_profile.assert_not_called()

    def test_apply_scored_merges_without_audit_leaves_audit_file_untouched(self):
        Path(audit.AUDIT_FILE).unlink(missing_ok=True)
        authors = [AuthorRecord(id="A1", name="Wei Wang", paper_ids={"p1"}), AuthorRecord(id="A2", name="W. Wang", paper_ids={"p2"})]
        G = nx.Graph()
        G.add_edge("A1", "A2", weight=2.5, reasons=["name_match"])
        merges, _ = apply_scored_merges(G, authors, audit=False)
        self.assertEqual(merges, {"A2": "A1"})
        self.assertFalse(os.path.exists(audit.AUDIT_FILE))

    def test_authors_rescued_from_placeholder_merge_are_indexed_in_authors_fts(self):
        test_credit.stage()
        with get_staging_connection() as conn:
            conn.execute("INSERT INTO authors (author_id, name, canonical_author_id) VALUES ('R', 'Rescued Researcher', 'P')")
            conn.execute("INSERT INTO authorships (paper_id, author_id, openalex_author_id, openalex_institution_id) VALUES ('P1', 'R', 'R', 'I1')")
            conn.commit()
        db = test_credit.build()
        try:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM authors_fts WHERE author_id = 'R'").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM authors_fts WHERE author_id = 'P'").fetchone()[0], 0)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
