"""
The credit rules on a dataset small enough to work out by hand, through the real build scripts, and two of the rules
alone (pipeline/core/credit.py).

Institutions: X (I1, US), Y (I2, DE), Y2 (I3, merged into Y), Z (I4, FR). People: Alice Smith (A, with a second record
A2, "A. Smith", merged into A), Bob Jones (B), Carol Wu (C), and a placeholder author "Anonymous" (P).
  P1 2024  A at X; B at X and Y; C with no institution        3 people: 1/3 each; B's third split between X and Y
  P2 2024  A at X; A2 (A again) at Z; C at Y2 (= Y)            2 people: 1/2 each; A's half split between X and Z
  P3 2023  C with no institution, Z recovered from the string; P at X     2 people: 1/2 each
  P4 2024  A at X, a review                                    not served
  P5 2015  A at X, before the scope's first year               not served
"""
import gzip
import json
import os
import sqlite3
import unittest

import polars as pl

import _env
from pipeline.core import credit
from pipeline.core.publish import DEFAULT_INSTITUTIONS, DEFAULT_RESEARCHERS, PUBLIC_DIR
from pipeline.db.connection import SERVE_TMP_PATH, get_staging_connection

VENUE = "S4210195673"  # PRX Quantum, in the scope


def stage():
    _env.fresh_staging()
    with get_staging_connection() as conn:
        conn.executemany("INSERT INTO institutions (inst_id, display_name, location_code, canonical_inst_id) VALUES (?, ?, ?, ?)",
                         [("I1", "Institute X", "US", None), ("I2", "Institute Y", "DE", None),
                          ("I3", "Institute Y (old record)", "DE", "I2"), ("I4", "Institute Z", "FR", None)])
        conn.executemany("INSERT INTO authors (author_id, name, canonical_author_id) VALUES (?, ?, ?)",
                         [("A", "Alice Smith", None), ("A2", "A. Smith", "A"), ("B", "Bob Jones", None),
                          ("C", "Carol Wu", None), ("P", "Anonymous", None)])
        conn.executemany("INSERT INTO papers (paper_id, title, year, venue_id, venue_name, total_authors) VALUES (?, ?, ?, ?, ?, ?)",
                         [("P1", "One", 2024, VENUE, "PRX Quantum", 3), ("P2", "Two", 2024, VENUE, "PRX Quantum", 3),
                          ("P3", "Three", 2023, VENUE, "PRX Quantum", 2), ("P4", "A review", 2024, VENUE, "PRX Quantum", 1),
                          ("P5", "Too early", 2015, VENUE, "PRX Quantum", 1)])
        conn.executemany("INSERT INTO authorships (paper_id, author_id, openalex_author_id, openalex_institution_id) VALUES (?, ?, ?, ?)",
                         [("P1", "A", "A", "I1"), ("P1", "B", "B", "I1"), ("P1", "B", "B", "I2"), ("P1", "C", "C", None),
                          ("P2", "A", "A", "I1"), ("P2", "A2", "A2", "I4"), ("P2", "C", "C", "I3"),
                          ("P3", "C", "C", None), ("P3", "P", "P", "I1"),
                          ("P4", "A", "A", "I1"), ("P5", "A", "A", "I1")])
        conn.execute("INSERT INTO recovered_affiliations VALUES ('P3', 'C', 'I4', 'Institute Z, Paris', 'same string')")
        conn.executescript("""
            CREATE TABLE paper_classes (paper_id TEXT, kind TEXT, is_research INTEGER, reason TEXT);
            INSERT INTO paper_classes VALUES ('P1', 'research', 1, ''), ('P2', 'research', 1, ''), ('P3', 'research', 1, ''),
                                             ('P4', 'review', 0, 'publisher type');
            CREATE TABLE paper_subtopics (paper_id TEXT, topic_id TEXT, subtopic_id TEXT, confidence REAL, rank INTEGER);
            INSERT INTO paper_subtopics VALUES ('P1', 't1', 's1', 0.9, 0), ('P2', 't1', 's2', 0.8, 0);
            CREATE TABLE paper_platforms (paper_id TEXT, platform_id TEXT, evidence TEXT);
        """)
        conn.commit()


def build():
    from pipeline.scripts import build_canonical_facts, build_default_summary, build_performance_summary
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    build_canonical_facts.main()
    build_performance_summary.main()
    build_default_summary.main()
    return sqlite3.connect(f"file:{SERVE_TMP_PATH}?mode=ro", uri=True)


def default_list(name):
    with gzip.open(os.path.join(PUBLIC_DIR, name + ".tmp")) as handle:
        return json.loads(handle.read())["entries"]


class Build(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        stage()
        cls.db = build()

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def rows(self, sql, *args):
        return self.db.execute(sql, args).fetchall()

    def test_a_duplicate_copy_of_a_paper_is_served_once(self):
        with get_staging_connection() as conn:
            conn.execute("INSERT INTO papers (paper_id, title, year, venue_id, venue_name, total_authors) VALUES ('P1b', 'One', 2024, ?, 'PRX Quantum', 3)", (VENUE,))
            conn.execute("INSERT INTO authorships (paper_id, author_id, openalex_author_id, openalex_institution_id) VALUES ('P1b', 'A', 'A', 'I1')")
            conn.execute("INSERT INTO duplicate_papers VALUES ('P1b', 'P1', '10.1/one')")
            conn.commit()
        try:
            db = build()
            try:
                self.assertEqual(db.execute("SELECT paper_id FROM paper_facts ORDER BY 1").fetchall(), [("P1",), ("P2",), ("P3",)])
                self.assertEqual(db.execute("SELECT COUNT(*) FROM author_paper_facts WHERE paper_id = 'P1b'").fetchone()[0], 0)
            finally:
                db.close()
        finally:
            with get_staging_connection() as conn:
                conn.execute("DELETE FROM duplicate_papers"); conn.execute("DELETE FROM authorships WHERE paper_id = 'P1b'")
                conn.execute("DELETE FROM papers WHERE paper_id = 'P1b'"); conn.commit()
            build().close()

    def test_only_research_papers_inside_the_scope_are_served(self):
        self.assertEqual(self.rows("SELECT paper_id FROM paper_facts ORDER BY 1"), [("P1",), ("P2",), ("P3",)])

    def test_fractional_shares_count_each_person_once(self):
        got = {(a, p): (n, round(s, 9)) for a, p, n, s in
               self.rows("SELECT author_id, paper_id, canonical_author_count, fractional_share FROM author_paper_facts")}
        self.assertEqual(got, {("A", "P1"): (3, 0.333333333), ("B", "P1"): (3, 0.333333333), ("C", "P1"): (3, 0.333333333),
                               ("A", "P2"): (2, 0.5), ("C", "P2"): (2, 0.5), ("C", "P3"): (2, 0.5), ("P", "P3"): (2, 0.5)})

    def test_adjusted_shares_split_among_an_authors_institutions_after_merges(self):
        got = {(a, i, p): (round(s, 9), cc) for a, i, p, s, cc in self.rows(
            "SELECT author_id, institution_id, paper_id, adjusted_fractional_share, location_code FROM author_institution_paper_facts")}
        self.assertEqual(got, {
            ("A", "I1", "P1"): (0.333333333, "US"), ("B", "I1", "P1"): (0.166666667, "US"), ("B", "I2", "P1"): (0.166666667, "DE"),
            ("A", "I1", "P2"): (0.25, "US"), ("A", "I4", "P2"): (0.25, "FR"),   # A2 is A: one person, two institutions
            ("C", "I2", "P2"): (0.5, "DE"),                                     # I3 merged into I2
            ("C", "I4", "P3"): (0.5, "FR"),                                     # recovered from the printed string
            ("P", "I1", "P3"): (0.5, "US"),                                     # a placeholder still counts for X
        })

    def test_institution_summaries(self):
        got = {(e, y): (round(t, 9), round(f, 9), n, fac) for e, y, t, f, n, fac in self.rows(
            """SELECT entity_id, year, total_fractional_score, fractional_count, paper_count, faculty_count
               FROM performance_summary WHERE entity_type = 'institution'""")}
        self.assertEqual(got, {("I1", 2024): (0.75, 1.166666667, 2, 2), ("I1", 2023): (0.5, 0.5, 1, 0),  # P is no researcher
                               ("I2", 2024): (0.666666667, 0.833333333, 2, 2),
                               ("I4", 2024): (0.25, 0.5, 1, 1), ("I4", 2023): (0.5, 0.5, 1, 1)})

    def test_researcher_summaries_leave_placeholders_out(self):
        got = {(e, y): (round(t, 9), n) for e, y, t, n in self.rows(
            "SELECT entity_id, year, total_fractional_score, paper_count FROM performance_summary WHERE entity_type = 'researcher'")}
        self.assertEqual(got, {("A", 2024): (0.833333333, 2), ("B", 2024): (0.333333333, 1),
                               ("C", 2024): (0.833333333, 2), ("C", 2023): (0.5, 1)})

    def test_dimensions(self):
        def dim(entity, kind):
            return {(e, y, v): (t, round(f, 9), round(a, 9)) for e, y, v, t, f, a in self.rows(
                """SELECT entity_id, year, dimension_value, total_count, fractional_count, adjusted_fractional_count
                   FROM performance_summary_dimensions WHERE entity_type = ? AND dimension_type = ?""", entity, kind)}
        self.assertEqual(dim("institution", "venue")[("I1", 2024, VENUE)], (2, 1.166666667, 0.75))
        self.assertEqual(dim("institution", "topic")[("I1", 2024, "t1")], (2, 1.166666667, 0.75))
        self.assertEqual(dim("institution", "topic")[("I1", 2024, "t1/s2")], (1, 0.5, 0.25))
        # A researcher counts once per paper and location: A was in the US on P1 and P2, and in France on P2.
        locations = dim("researcher", "location")
        self.assertEqual({k: v for k, v in locations.items() if k[0] == "A"},
                         {("A", 2024, "US"): (2, 0.833333333, 0.833333333), ("A", 2024, "FR"): (1, 0.5, 0.5)})

    def test_the_shown_affiliation_follows_the_rule(self):
        got = dict((a, (n, c)) for a, n, c in self.rows("SELECT author_id, latest_affiliation, latest_location_code FROM authors"))
        self.assertEqual(got["A"], ("Institute X", "US"))   # 2 papers at X in 2024, 1 at Z
        self.assertEqual(got["B"], ("Institute X", "US"))   # X and Y tie on papers and credit: the lower id
        self.assertEqual(got["C"], ("Institute Y", "DE"))   # latest year 2024: Y (through its merged record)
        per_year = dict(((e, y), a) for e, y, a in self.rows(
            "SELECT entity_id, year, latest_affiliation FROM performance_summary WHERE entity_type = 'researcher'"))
        self.assertEqual(per_year[("C", 2023)], "Institute Z")

    def test_the_default_lists_rank_by_score_then_id_and_show_the_same_affiliation(self):
        researchers = default_list(DEFAULT_RESEARCHERS)
        self.assertTrue(all(r.get("type") == "researcher" for r in researchers))
        self.assertEqual([(r["author_id"], r["latest_affiliation"], r["location"]) for r in researchers],
                         [("C", "Institute Y", "Germany"), ("A", "Institute X", "United States"),
                          ("B", "Institute X", "United States")])
        institutions = default_list(DEFAULT_INSTITUTIONS)
        self.assertEqual([(i["institution_id"], round(i["total_fractional_score"], 9)) for i in institutions],
                         [("I1", 1.25), ("I4", 0.75), ("I2", 0.666666667)])

    def test_two_builds_of_the_same_data_are_identical(self):
        first = list(self.db.iterdump())
        again = build()
        try:
            self.assertEqual(list(again.iterdump()), first)
        finally:
            again.close()


class Rules(unittest.TestCase):
    def test_merged_institution_records_that_disagree_take_the_first_location_alphabetically(self):
        a_c = pl.DataFrame({"paper_id": ["P", "P"], "author_id": ["A", "A"], "canonical_author_id": ["A", "A"],
                            "openalex_institution_id": ["I8", "I9"], "corrected_institution_id": [None, None]},
                           schema_overrides={"corrected_institution_id": pl.Utf8})
        papers = pl.DataFrame({"paper_id": ["P"], "year": [2024], "venue_id": ["V"], "total_authors": [1]})
        institutions = pl.DataFrame({"inst_id": ["I8", "I9"], "canonical_inst_id": ["I9", None], "location_code": ["US", "CA"]})
        facts = credit.author_institution_paper_facts(a_c, papers, institutions)
        self.assertEqual(facts.select("institution_id", "location_code", "adjusted_fractional_share").rows(), [("I9", "CA", 1.0)])

    def test_credit_that_differs_only_by_rounding_is_a_tie(self):
        db = sqlite3.connect(":memory:")
        try:
            db.executescript("""
                CREATE TABLE institutions (inst_id TEXT, display_name TEXT, location_code TEXT);
                INSERT INTO institutions VALUES ('I1', 'One', 'US'), ('I2', 'Two', 'FR');
                CREATE TABLE author_institution_paper_facts (author_id, institution_id, paper_id, year, location_code,
                                                              adjusted_fractional_share);
            """)
            # 0.1 + 0.2 is 0.30000000000000004 in floating point; 0.3 is 0.3. Mathematically equal, so I1 wins on its id.
            db.executemany("INSERT INTO author_institution_paper_facts VALUES (?, ?, ?, ?, ?, ?)",
                           [("A", "I2", "p1", 2024, "FR", 0.1), ("A", "I2", "p2", 2024, "FR", 0.2),
                            ("A", "I1", "p3", 2024, "US", 0.3), ("A", "I1", "p4", 2024, None, 0.0)])
            self.assertEqual(db.execute(credit.shown_affiliations_sql(per_year=False)).fetchall(),
                             [("A", 2024, "I1", "One", "US")])
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
