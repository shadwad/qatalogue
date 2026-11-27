import unittest

import _env

_env.init()  # must come first
from pipeline.core.disambiguation import name_tokens, same_name


class SameName(unittest.TestCase):
    def test_initials_agree_with_a_full_given_name_of_that_letter(self):
        self.assertTrue(same_name("Wei Wang", "W. Wang"))
        self.assertTrue(same_name("Mei Chen", "M. Chen"))

    def test_different_given_names_are_different_people(self):
        self.assertFalse(same_name("Wei Wang", "Wen Wang"))
        self.assertFalse(same_name("Mei Chen", "Min Chen"))

    def test_different_family_names_never_match(self):
        self.assertFalse(same_name("Wei Wang", "Wei Li"))

    def test_accents_hyphens_and_order_do_not_matter(self):
        self.assertTrue(same_name("René Dupont", "Rene Dupont"))
        self.assertTrue(same_name("Ming-Hao Li", "Ming Hao Li"))
        self.assertTrue(same_name("Wang, Wei", "Wei Wang"))

    def test_empty_names_match_nothing(self):
        self.assertFalse(same_name("", "Wei Wang"))
        self.assertFalse(same_name(None, None))

    def test_a_hyphenated_family_name_stays_one_token(self):
        self.assertEqual(name_tokens("Elena Garcia-Lopez")[-1], "garcialopez")


if __name__ == "__main__":
    unittest.main()
