"""Papers OpenAlex holds twice: which copy is kept, and that the merging and the served build leave the others out."""
import unittest

import _env
from pipeline.db.author_repo import build_author_records
from pipeline.db.connection import get_staging_connection
from pipeline.stages.duplicates import find_duplicate_papers
from pipeline.stages.reset import reset_decisions

VENUE = "S4210195673"   # PRX Quantum, in the scope


def paper(conn, paper_id, doi, year=2024):
    conn.execute("INSERT INTO papers (paper_id, title, year, venue_id, venue_name, doi) VALUES (?, ?, ?, ?, 'PRX Quantum', ?)",
                 (paper_id, paper_id, year, VENUE, doi))


def authors(conn, paper_id, *ids):
    """One authorship per entry: an OpenAlex author id, or None for an author OpenAlex has no id for."""
    for n, openalex_id in enumerate(ids):
        author = openalex_id or f"{paper_id}-anon{n}"
        conn.execute("INSERT OR IGNORE INTO authors (author_id, name) VALUES (?, ?)", (author, f"Name {author}"))
        conn.execute("INSERT INTO authorships (paper_id, author_id, openalex_author_id) VALUES (?, ?, ?)",
                     (paper_id, author, openalex_id))


def set_aside():
    with get_staging_connection() as conn:
        return dict(conn.execute("SELECT paper_id, canonical_paper_id FROM duplicate_papers"))


class Duplicates(unittest.TestCase):
    def setUp(self):
        _env.fresh_staging()

    def test_the_copy_with_more_author_ids_is_kept(self):
        with get_staging_connection() as conn:
            paper(conn, "W1", "10.1/x"); authors(conn, "W1", "A1", None, None)
            paper(conn, "W9", "10.1/X"); authors(conn, "W9", "A1", "A2", "A3")   # the DOI differs only in case
            conn.commit()
        self.assertEqual(find_duplicate_papers(), 1)
        self.assertEqual(set_aside(), {"W1": "W9"})

    def test_a_tie_goes_to_the_lowest_id_and_unique_papers_are_untouched(self):
        with get_staging_connection() as conn:
            paper(conn, "W7", "10.1/y"); authors(conn, "W7", "A1", "A2")
            paper(conn, "W3", "10.1/y"); authors(conn, "W3", "A1", "A2")
            paper(conn, "W5", "10.1/z"); authors(conn, "W5", "A1")
            conn.commit()
        find_duplicate_papers()
        self.assertEqual(set_aside(), {"W7": "W3"})

    def test_a_research_paper_is_kept_over_a_review_with_more_authors(self):
        with get_staging_connection() as conn:
            paper(conn, "W1", "10.1/r"); authors(conn, "W1", "A1")
            paper(conn, "W2", "10.1/r"); authors(conn, "W2", "A1", "A2", "A3")
            conn.execute("CREATE TABLE paper_classes (paper_id TEXT, kind TEXT, is_research INTEGER, reason TEXT)")
            conn.execute("INSERT INTO paper_classes VALUES ('W2', 'review', 0, 'publisher type')")
            conn.commit()
        find_duplicate_papers()
        self.assertEqual(set_aside(), {"W2": "W1"})

    def test_copies_outside_the_scope_are_not_this_stage_s_business(self):
        with get_staging_connection() as conn:
            paper(conn, "W1", "10.1/o", year=2024); authors(conn, "W1", "A1")
            paper(conn, "W2", "10.1/o", year=2010); authors(conn, "W2", "A1")   # before the scope's first year
            conn.commit()
        self.assertEqual(find_duplicate_papers(), 0)

    def test_running_again_gives_the_same_table_and_reset_clears_it(self):
        with get_staging_connection() as conn:
            paper(conn, "W1", "10.1/x"); authors(conn, "W1", "A1")
            paper(conn, "W2", "10.1/x"); authors(conn, "W2", "A1")
            conn.commit()
        find_duplicate_papers()
        first = set_aside()
        find_duplicate_papers()
        self.assertEqual(set_aside(), first)
        self.assertEqual(reset_decisions()["duplicate papers cleared"], 1)
        self.assertEqual(set_aside(), {})

    def test_the_merging_ignores_the_copy(self):
        with get_staging_connection() as conn:
            paper(conn, "W1", "10.1/m"); authors(conn, "W1", "A1", "A2")
            paper(conn, "W2", "10.1/m"); authors(conn, "W2", "A1", None)
            conn.commit()
        find_duplicate_papers()      # keeps W1 (two author ids), sets W2 aside
        records = {r.id: r for r in build_author_records()}
        self.assertEqual(records["A1"].paper_ids, {"W1"})
        self.assertEqual(records["A1"].coauthors, {"A2"})                  # not the copy's anonymous author
        self.assertEqual(records["W2-anon1"].paper_ids, set())             # that author is on no kept paper


if __name__ == "__main__":
    unittest.main()
