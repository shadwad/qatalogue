"""
Finds the paper a hand-made entry means. The topic answer key (data/topics/answer_key.json) and the article overrides
(data/article_overrides.json) name papers by OpenAlex id, but OpenAlex changes a paper's id when it merges duplicate
records. Each entry also carries the paper's DOI, so an entry whose id has gone is still found by its DOI.
"""
from __future__ import annotations

import sqlite3


def _norm_doi(doi: str | None) -> str | None:
    doi = (doi or "").strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if doi.startswith(prefix):
            doi = doi[len(prefix):]
    return doi or None


class PaperIds:
    """The papers in staging, by OpenAlex id and by DOI."""

    def __init__(self, conn: sqlite3.Connection):
        self.ids: set[str] = set()
        self.by_doi: dict[str, str] = {}
        for paper_id, doi in conn.execute("SELECT paper_id, doi FROM papers ORDER BY paper_id"):
            self.ids.add(paper_id)
            key = _norm_doi(doi)
            if key and key not in self.by_doi:  # a DOI held by two records goes to the lower id, every time
                self.by_doi[key] = paper_id

    def resolve(self, paper_id: str | None, doi: str | None = None) -> str | None:
        """The current staging id for an entry: its own id if staging still has it, else the paper with its DOI."""
        if paper_id in self.ids:
            return paper_id
        return self.by_doi.get(_norm_doi(doi) or "")

    def doi_of(self, conn: sqlite3.Connection, paper_id: str) -> str | None:
        row = conn.execute("SELECT doi FROM papers WHERE paper_id = ?", (paper_id,)).fetchone()
        return _norm_doi(row[0]) if row else None
