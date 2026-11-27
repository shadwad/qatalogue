import json
import unittest

import _env
from pipeline.db.connection import get_staging_connection
from pipeline.stages.affiliations import known_strings, normalized, organization, recover_affiliations


def add_row(conn, paper, author, string=None, inst=None, strings=None):
    conn.execute("""INSERT INTO authorships (paper_id, author_id, raw_affiliation_string, openalex_institution_id,
                                             raw_affiliation_strings) VALUES (?, ?, ?, ?, ?)""",
                 (paper, author, string, inst, json.dumps(strings) if strings is not None else None))


class Strings(unittest.TestCase):
    def test_normalized_ignores_case_accents_spacing_and_punctuation(self):
        self.assertEqual(normalized("Universität  Nordstadt,\nINF 229"), "universitat nordstadt inf 229")
        self.assertEqual(normalized(None), "")

    def test_organization_is_the_text_before_the_first_comma(self):
        self.assertEqual(organization("Apex Quantum Center, Pasadena, CA"), "apex quantum center")


class KnownStrings(unittest.TestCase):
    def setUp(self):
        _env.fresh_staging()

    def rows(self, agreeing, other):
        with get_staging_connection() as conn:
            for i in range(agreeing):
                add_row(conn, f"p{i}", "a", "North Tech, Cambridge", "I1")
            for i in range(other):
                add_row(conn, f"q{i}", "a", "North Tech, Cambridge", "I2")
            conn.commit()
            return known_strings(conn)

    def test_a_string_counts_when_90_percent_of_its_uses_agree(self):
        self.assertEqual(self.rows(9, 1), {"north tech cambridge": ["I1"]})

    def test_a_string_that_names_two_institutions_is_left_out(self):
        self.assertEqual(self.rows(8, 2), {"north tech cambridge": []})

    def test_minimum_uses_applies_to_organizations(self):
        with get_staging_connection() as conn:
            add_row(conn, "p1", "a", "Helios Systems, Boulder", "I9")
            add_row(conn, "p2", "a", "Helios Systems, Colorado", "I9")
            conn.commit()
            self.assertEqual(known_strings(conn, key=organization, min_uses=3), {})
            self.assertEqual(known_strings(conn, key=organization, min_uses=2), {"helios systems": ["I9"]})


class Recover(unittest.TestCase):
    def setUp(self):
        _env.fresh_staging()
        with get_staging_connection() as conn:
            for i in range(3):
                add_row(conn, f"p{i}", "a", "Helios Systems, Boulder, CO", "I1")
            add_row(conn, "p10", "x", None, None, ["Helios Systems, Boulder, CO"])                       # same string
            add_row(conn, "p11", "y", None, None, ["Helios Systems, Berkeley, California 94710"])        # same organization
            add_row(conn, "p12", "z", None, None, ["Somewhere Unknown Lab, Nowhere"])                    # nothing known
            conn.commit()

    def test_rows_without_an_institution_get_it_from_their_printed_string(self):
        counts = recover_affiliations(use_apis=False)
        self.assertEqual((counts["same string"], counts["same organization"]), (1, 1))
        self.assertEqual((counts["rows recovered"], counts["rows not recovered"]), (2, 1))
        with get_staging_connection() as conn:
            got = conn.execute("SELECT paper_id, inst_id, method FROM recovered_affiliations ORDER BY paper_id").fetchall()
        self.assertEqual(got, [("p10", "I1", "same string"), ("p11", "I1", "same organization")])

    def test_running_it_again_gives_the_same_table(self):
        recover_affiliations(use_apis=False)
        with get_staging_connection() as conn:
            first = conn.execute("SELECT * FROM recovered_affiliations ORDER BY 1, 2, 3").fetchall()
        recover_affiliations(use_apis=False)
        with get_staging_connection() as conn:
            self.assertEqual(conn.execute("SELECT * FROM recovered_affiliations ORDER BY 1, 2, 3").fetchall(), first)


if __name__ == "__main__":
    unittest.main()
