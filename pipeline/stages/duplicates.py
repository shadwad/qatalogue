"""
Deduplicate OpenAlex works that share a normalized DOI within the configured scope.

Keeps one canonical work per DOI (preferring primary research, then the most authors with OpenAlex IDs,
most total authors, and lowest paper_id) and records extra copies in staging.duplicate_papers so merges
and served tables exclude them. Recomputed on every merge run after reset.py.
"""
from __future__ import annotations

import logging
from collections import defaultdict

from pipeline.core.scope import load_scope
from pipeline.db.connection import open_staging

logger = logging.getLogger("merge.duplicates")


def find_duplicate_papers() -> int:
    """Fills staging.duplicate_papers; returns how many papers were set aside."""
    scope = load_scope()
    with open_staging() as conn:
        conn.execute("DELETE FROM duplicate_papers")
        has_classes = bool(conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'paper_classes'").fetchone())
        research = "COALESCE((SELECT is_research FROM paper_classes c WHERE c.paper_id = p.paper_id), 1)" if has_classes else "1"
        rows = conn.execute(f"""
            SELECT LOWER(p.doi), p.paper_id, {research},
                   COALESCE(SUM(a.openalex_author_id IS NOT NULL AND a.openalex_author_id <> ''), 0), COUNT(a.author_id)
            FROM papers p LEFT JOIN authorships a ON a.paper_id = p.paper_id
            WHERE p.doi IS NOT NULL AND p.doi <> '' AND {scope.papers_sql('p')}
            GROUP BY p.paper_id""").fetchall()
        copies = defaultdict(list)
        for doi, paper_id, is_research, with_id, total in rows:
            copies[doi].append((-int(is_research), -with_id, -total, paper_id))
        found = []
        for doi, group in sorted(copies.items()):
            if len(group) > 1:
                keep = min(group)[3]
                found += [(c[3], keep, doi) for c in sorted(group) if c[3] != keep]
        conn.executemany("INSERT INTO duplicate_papers (paper_id, canonical_paper_id, doi) VALUES (?, ?, ?)", found)
    logger.info(f"  ✓  Duplicate papers set aside: {len(found):,} copies of {len({c for _, c, _ in found}):,} papers")
    return len(found)
