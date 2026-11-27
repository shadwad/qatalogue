import unittest

import _env

_env.init()
from pipeline.scripts.measure_merges import score


class Score(unittest.TestCase):
    truth = {"a": "O1", "b": "O1", "c": "O2"}

    def test_a_hidden_record_merged_with_its_own_person_scores_fully(self):
        got = score({"b": "a"}, self.truth, hidden={"a"})
        self.assertEqual((got["recall"], got["precision"]), (1.0, 1.0))

    def test_a_missed_pair_lowers_recall_and_a_wrong_pair_lowers_precision(self):
        self.assertEqual(score({}, self.truth, hidden={"a"})["recall"], 0.0)
        wrong = score({"b": "a", "c": "a"}, self.truth, hidden={"a"})
        # a, b, c merged: (a, b) is right, (a, c) is wrong, and (b, c) is not counted because neither is hidden.
        self.assertEqual((wrong["merged_pairs"], wrong["wrong_pairs"]), (2, 1))
        self.assertAlmostEqual(wrong["precision"], 0.5)

    def test_pairs_with_no_hidden_record_are_not_counted(self):
        self.assertEqual(score({"b": "a"}, self.truth, hidden=set())["merged_pairs"], 0)


if __name__ == "__main__":
    unittest.main()
