"""
People who asked not to be listed (data/suppressions.json), on the hand-worked dataset of test_credit.py: A (Alice Smith,
with a second record A2 merged into her) is the one suppressed, B and C stay listed. Her credit must stay in every total;
her name, ORCID and affiliations must be nowhere, whichever of her records the request names.
"""
import gzip
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

import _env

_env.init()
from pipeline.core import suppressions
from pipeline.core.publish import DEFAULT_RESEARCHERS, PUBLIC_DIR
from pipeline.db.connection import SERVE_TMP_PATH, get_staging_connection
from pipeline.scripts import check_build
from test_credit import build, stage

ORCID = "0000-0002-1825-0097"


def write_entries(*entries) -> str:
    path = Path(tempfile.mkdtemp(prefix="suppressions-", dir=_env.SCRATCH)) / "suppressions.json"
    path.write_text(json.dumps({"authors": list(entries)}))
    return str(path)


class Reading(unittest.TestCase):
    def test_ids_are_read_from_bare_ids_and_urls(self):
        self.assertEqual(suppressions.normalise_orcid("https://orcid.org/0000-0002-1825-009x"), "0000-0002-1825-009X")
        self.assertEqual(suppressions.normalise_orcid(ORCID), ORCID)
        self.assertIsNone(suppressions.normalise_orcid("not an orcid"))
        self.assertEqual(suppressions.normalise_openalex("https://openalex.org/a5012345678/"), "A5012345678")
        self.assertIsNone(suppressions.normalise_openalex("two words"))

    def test_a_missing_file_means_nobody(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertEqual(suppressions.load(Path(td) / "none.json").entries, [])

    def test_invalid_entries_raise_value_error(self):
        for bad in ({"orchid": ORCID}, {}, {"orcid": "12345"}, {"openalex": "two words"}, "A5"):
            with self.assertRaises(ValueError, msg=bad):
                suppressions.load(write_entries(bad))
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "s.json"
            path.write_text("{not json")
            with self.assertRaises(ValueError):
                suppressions.load(path)
            path.write_text('{"authors": "A5"}')
            with self.assertRaises(ValueError):
                suppressions.load(path)


class Suppressed(unittest.TestCase):
    """Built once per request, by ORCID or by the id of either of her records."""

    def setUp(self):
        stage()
        with get_staging_connection() as conn:
            conn.execute("UPDATE authors SET orcid = ? WHERE author_id = 'A2'", (ORCID,))
            conn.commit()
        self.addCleanup(os.environ.__setitem__, "SUPPRESSIONS_PATH", os.environ["SUPPRESSIONS_PATH"])

    def built(self, *entries):
        os.environ["SUPPRESSIONS_PATH"] = write_entries(*entries)
        db = build()
        self.addCleanup(db.close)
        return db

    def baseline(self):
        os.environ["SUPPRESSIONS_PATH"] = write_entries()
        db = build()
        try:
            return {r[0:2]: r[2:] for r in db.execute(
                "SELECT entity_id, year, total_fractional_score, paper_count FROM performance_summary"
                " WHERE entity_type = 'institution'")}
        finally:
            db.close()

    def assert_alice_is_not_listed(self, db):
        self.assertEqual(db.execute("SELECT name, orcid, latest_affiliation, latest_location_code, is_placeholder"
                                    " FROM authors WHERE author_id = 'A'").fetchone(), (None, None, None, None, 1))
        self.assertEqual(db.execute("SELECT COUNT(*) FROM authors_fts WHERE author_id = 'A'").fetchone()[0], 0)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM performance_summary WHERE entity_type = 'researcher'"
                                    " AND entity_id = 'A'").fetchone()[0], 0)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM performance_summary_dimensions WHERE entity_type = 'researcher'"
                                    " AND entity_id = 'A'").fetchone()[0], 0)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM performance_summary_contributors WHERE author_id = 'A'").fetchone()[0], 0)
        with gzip.open(os.path.join(PUBLIC_DIR, DEFAULT_RESEARCHERS + ".tmp")) as handle:
            listed = json.loads(handle.read())["entries"]
        self.assertEqual(sorted(e["author_id"] for e in listed), ["B", "C"])
        self.assertTrue(all(e["author_name"] for e in listed))

    def test_by_the_orcid_of_a_merged_record(self):
        db = self.built({"orcid": f"https://orcid.org/{ORCID}"})
        self.assert_alice_is_not_listed(db)

    def test_by_the_id_of_a_merged_record_or_of_the_person(self):
        for entry in ({"openalex": "A2"}, {"openalex": "A"}):
            self.assert_alice_is_not_listed(self.built(entry))

    def test_everyone_else_stays_listed(self):
        db = self.built({"orcid": ORCID})
        self.assertEqual(db.execute("SELECT author_id, name, is_placeholder FROM authors WHERE author_id IN ('B', 'C')"
                                    " ORDER BY 1").fetchall(), [("B", "Bob Jones", 0), ("C", "Carol Wu", 0)])

    def test_her_credit_still_counts_for_institutions_and_papers(self):
        before = self.baseline()
        db = self.built({"orcid": ORCID})
        after = {r[0:2]: r[2:] for r in db.execute(
            "SELECT entity_id, year, total_fractional_score, paper_count FROM performance_summary WHERE entity_type = 'institution'")}
        self.assertEqual(after, before)
        self.assertGreater(db.execute("SELECT COUNT(*) FROM author_paper_facts WHERE author_id = 'A'").fetchone()[0], 0)

    def test_she_is_not_counted_as_listed_faculty(self):
        db = self.built({"orcid": ORCID})
        self.assertEqual(db.execute("SELECT faculty_count FROM performance_summary WHERE entity_type = 'institution'"
                                    " AND entity_id = 'I1' AND year = 2024").fetchone()[0], 1)  # B only; was A and B


class Checked(unittest.TestCase):
    def setUp(self):
        stage()
        with get_staging_connection() as conn:
            conn.execute("UPDATE authors SET orcid = ? WHERE author_id = 'A2'", (ORCID,))
            conn.commit()
        self.addCleanup(os.environ.__setitem__, "SUPPRESSIONS_PATH", os.environ["SUPPRESSIONS_PATH"])

    def run_check(self, built_with, checked_with):
        os.environ["SUPPRESSIONS_PATH"] = write_entries(*built_with)
        build().close()
        os.environ["SUPPRESSIONS_PATH"] = write_entries(*checked_with)
        failures, notes = [], []
        with get_staging_connection() as staging, sqlite3.connect(f"file:{SERVE_TMP_PATH}?mode=ro", uri=True) as serve:
            check_build.check_suppressions(staging, serve, failures, notes, public_dir=PUBLIC_DIR)
        return failures, notes

    def test_a_clean_build_passes_and_an_entry_matching_nothing_is_reported(self):
        failures, notes = self.run_check([{"orcid": ORCID}], [{"orcid": ORCID}, {"openalex": "A99"}])
        self.assertEqual(failures, [])
        self.assertIn("2 entries, 1 person(s) not listed; 1 entry matches nothing in staging", notes[0])

    def test_a_build_that_forgot_the_list_fails(self):
        failures, _ = self.run_check([], [{"orcid": ORCID}])
        self.assertTrue(any("still have a name" in f for f in failures), failures)
        self.assertTrue(any("name search" in f for f in failures), failures)
        self.assertTrue(any("default researcher summary" in f for f in failures), failures)
        self.assertFalse(any("Alice" in f or ORCID in f for f in failures))  # counts only, never who

    def test_an_invalid_list_fails_the_check(self):
        failures, _ = self.run_check([], [{"orchid": ORCID}])
        self.assertEqual(len(failures), 1)


if __name__ == "__main__":
    unittest.main()
