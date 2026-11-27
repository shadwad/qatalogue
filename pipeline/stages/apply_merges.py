from pipeline.db.connection import open_staging

def flatten_chains_in_memory(merges: dict) -> dict:
    parent = {}
    for src, dst in merges.items():
        if src not in parent: parent[src] = src
        if dst not in parent: parent[dst] = dst
        parent[src] = dst
        
    def find(i):
        path = []
        visited = set()
        while parent.get(i, i) != i:
            if i in visited:
                break
            visited.add(i)
            path.append(i)
            i = parent.get(i, i)
        for node in path:
            parent[node] = i
        return i
        
    final_merges = {}
    for src in merges:
        dst = find(src)
        if src != dst:
            final_merges[src] = dst
    return final_merges

def _prepare_merges(existing: dict[str, str], merges: dict[str, str], flatten: bool) -> tuple[dict[str, str], list[str]]:
    if not flatten:
        return merges, []
    targets = set(merges.values())
    cleared = [k for k in existing if k in targets]
    combined = {k: v for k, v in existing.items() if k not in targets} | merges
    final = flatten_chains_in_memory(combined)
    return final, cleared


def apply_inst_merges(merges, flatten=True):
    if not merges:
        return
    with open_staging() as conn:
        c = conn.cursor()
        existing = (dict(c.execute("SELECT inst_id, canonical_inst_id FROM institutions WHERE canonical_inst_id IS NOT NULL").fetchall())
                    if flatten else {})
        final, cleared = _prepare_merges(existing, merges, flatten)
        cleared = [k for k in cleared if k not in final]
        if cleared:
            c.executemany("UPDATE institutions SET canonical_inst_id = NULL WHERE inst_id = ?", [(k,) for k in cleared])
        c.executemany("UPDATE institutions SET canonical_inst_id = ? WHERE inst_id = ?", [(p, ch) for ch, p in final.items()])
        conn.execute("UPDATE data_revision SET revision = revision + 1 WHERE id = 1")


def apply_author_merges(merges, flatten=True):
    if not merges:
        return
    from pipeline.core.placeholders import is_placeholder_name
    with open_staging() as conn:
        c = conn.cursor()
        existing = (dict(c.execute("SELECT author_id, canonical_author_id FROM authors WHERE canonical_author_id IS NOT NULL").fetchall())
                    if flatten else {})
        final, cleared = _prepare_merges(existing, merges, flatten)
        placeholders = {
            author_id for author_id, name in c.execute("SELECT author_id, name FROM authors")
            if is_placeholder_name(name)
        }
        final = {child: parent for child, parent in final.items()
                 if child not in placeholders and parent not in placeholders}
        cleared = [k for k in cleared if k not in final]
        if cleared:
            c.executemany("UPDATE authors SET canonical_author_id = NULL WHERE author_id = ?", [(k,) for k in cleared])
        c.executemany("UPDATE authors SET canonical_author_id = ? WHERE author_id = ?", [(p, ch) for ch, p in final.items()])
        conn.execute("UPDATE data_revision SET revision = revision + 1 WHERE id = 1")


def apply_paper_local_merges(merges):
    if not merges:
        return
    with open_staging() as conn:
        conn.executemany("""
            UPDATE authorships
            SET corrected_institution_id = ?
            WHERE paper_id = ? AND author_id = ? AND COALESCE(corrected_institution_id, openalex_institution_id) = ?
        """, [(good_id, p_id, a_id, bad_inst) for p_id, a_id, bad_inst, good_id in merges])
        conn.execute("UPDATE data_revision SET revision = revision + 1 WHERE id = 1")


def apply_author_inst_merges(merges):
    if not merges:
        return
    with open_staging() as conn:
        conn.executemany("""
            UPDATE authorships
            SET corrected_institution_id = ?
            WHERE author_id = ? AND COALESCE(corrected_institution_id, openalex_institution_id) = ?
        """, [(good_id, a_id, bad_inst) for a_id, bad_inst, good_id in merges])
        conn.execute("UPDATE data_revision SET revision = revision + 1 WHERE id = 1")
