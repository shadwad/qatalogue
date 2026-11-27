import unittest

import _env
from pipeline.db.connection import get_staging_connection
from pipeline.stages.reset import reset_decisions


class Reset(unittest.TestCase):
    def test_every_decision_is_cleared_and_openalex_ids_come_back(self):
        _env.fresh_staging()
        with get_staging_connection() as conn:
            conn.execute("INSERT INTO authors (author_id, name, canonical_author_id) VALUES ('A1', 'Wei Wang', 'A0'), "
                         "('A1_split_1', 'Wei Wang', NULL)")
            conn.execute("INSERT INTO authorships (paper_id, author_id, openalex_author_id, corrected_institution_id) "
                         "VALUES ('p1', 'A1_split_1', 'A1', 'I2')")
            conn.execute("INSERT INTO institutions (inst_id, location_code, ror, canonical_inst_id) "
                         "VALUES ('I1', 'US', 'x', 'I9')")
            conn.execute("INSERT INTO rejected_merges (entity_type, id_1, id_2) VALUES ('author', 'A1', 'A5')")
            conn.execute("INSERT INTO recovered_affiliations VALUES ('p1', 'A1', 'I1', 's', 'same string')")
            conn.commit()
        counts = reset_decisions()
        with get_staging_connection() as conn:
            self.assertEqual(conn.execute("SELECT author_id FROM authors").fetchall(), [("A1",)])
            self.assertIsNone(conn.execute("SELECT canonical_author_id FROM authors").fetchone()[0])
            self.assertEqual(conn.execute("SELECT author_id, corrected_institution_id FROM authorships").fetchone(), ("A1", None))
            self.assertEqual(conn.execute("SELECT location_code, ror, canonical_inst_id FROM institutions").fetchone(), ("US", "x", None))
            for table in ("rejected_merges", "recovered_affiliations"):
                self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)
        self.assertEqual(counts["split authors removed"], 1)

    def test_running_it_twice_changes_nothing_the_second_time(self):
        reset_decisions()
        second = reset_decisions()
        self.assertTrue(all(n == 0 for n in second.values()), second)


if __name__ == "__main__":
    unittest.main()
