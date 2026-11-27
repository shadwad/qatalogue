"""
Reset staging decision and derived merge tables prior to `merge_entities.py` so every merge run depends
only on raw OpenAlex data, optional `data/merges.json`, and cached lookups.
"""
from pipeline.db.connection import open_staging


def reset_decisions() -> dict[str, int]:
    """Clear all merge/enrichment decision tables and return updated row counts by step."""
    with open_staging() as conn:
        counts = {
            # Restore any legacy split author ids to their OpenAlex ids.
            "split authorships restored": conn.execute(
                "UPDATE authorships SET author_id = openalex_author_id WHERE author_id IS NOT openalex_author_id").rowcount,
            "split authors removed": conn.execute(
                "DELETE FROM authors WHERE instr(author_id, '_split_') > 0").rowcount,
            "author merges cleared": conn.execute(
                "UPDATE authors SET canonical_author_id = NULL WHERE canonical_author_id IS NOT NULL").rowcount,
            "institution merges cleared": conn.execute(
                "UPDATE institutions SET canonical_inst_id = NULL WHERE canonical_inst_id IS NOT NULL").rowcount,
            "authorship corrections cleared": conn.execute(
                "UPDATE authorships SET corrected_institution_id = NULL WHERE corrected_institution_id IS NOT NULL").rowcount,
            # Clear prior merge rejections so pairs are re-evaluated.
            "remembered rejections cleared": conn.execute("DELETE FROM rejected_merges").rowcount,
            "recovered affiliations cleared": conn.execute("DELETE FROM recovered_affiliations").rowcount,
            "duplicate papers cleared": conn.execute("DELETE FROM duplicate_papers").rowcount,
        }
        conn.execute("UPDATE data_revision SET revision = revision + 1 WHERE id = 1")
    return counts
