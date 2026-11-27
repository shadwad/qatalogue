import os
import unittest

import _env
from pipeline.db.connection import SERVE_TMP_PATH, connect_build
from pipeline.stages.ror_enrichment import choose_ror


def org(id, name, location, *aliases):
    return {"id": f"https://ror.org/{id}", "names": [{"value": name}] + [{"value": a} for a in aliases],
            "locations": [{"geonames_details": {"country_code": location}}]}


class ChooseRor(unittest.TestCase):
    def test_the_one_exact_name_match_is_taken_with_a_bare_id(self):
        items = [org("04fake001", "QubitCore", "CA"), org("000000000", "QubitCore Labs", "US")]
        self.assertEqual(choose_ror("QubitCore ", items), ("04fake001", "CA"))

    def test_a_name_several_organizations_share_is_left_unresolved(self):
        items = [org("02fake001", "Institute of Quantum Studies", "NP"),
                 org("03fake001", "Institute of Quantum Studies", "KH")]
        self.assertIsNone(choose_ror("Institute of Quantum Studies", items))

    def test_no_exact_match_and_no_name_resolve_nothing(self):
        self.assertIsNone(choose_ror("Somewhere Else", [org("04fake001", "QubitCore", "CA")]))
        self.assertIsNone(choose_ror("", [org("04fake001", "QubitCore", "CA")]))

    def test_an_alias_counts_as_a_name(self):
        self.assertEqual(choose_ror("IPR", [org("03fake002", "Institute of Photonic Research", "ES", "IPR")]),
                         ("03fake002", "ES"))


class BuildDatabase(unittest.TestCase):
    def test_later_build_steps_refuse_to_run_without_the_build_database(self):
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(SERVE_TMP_PATH + suffix):
                os.remove(SERVE_TMP_PATH + suffix)
        with self.assertRaises(FileNotFoundError):
            connect_build()
        self.assertFalse(os.path.exists(SERVE_TMP_PATH))

    def test_the_first_step_creates_it_beside_serve_db(self):
        conn = connect_build(must_exist=False)
        conn.close()
        self.assertTrue(os.path.exists(SERVE_TMP_PATH))
        self.assertEqual(SERVE_TMP_PATH, str(_env.SCRATCH / "serve.db.tmp"))
        os.remove(SERVE_TMP_PATH)


if __name__ == "__main__":
    unittest.main()
