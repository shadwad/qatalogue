from pipeline.db.connection import open_staging

def build_author_records():
    from pipeline.core.author import AuthorRecord
    import logging
    logger = logging.getLogger(__name__)
    logger.info("    [Load] Loading base author records...")
    rows = {}
    with open_staging() as conn:
        c = conn.cursor()
        c.execute("SELECT author_id, name, orcid FROM authors")
        for r in c:
            rows[r[0]] = AuthorRecord(id=r[0], name=r[1], orcid=r[2])

        logger.info("    [Enrich] Enriching concepts and papers...")
        c.execute("""
            SELECT COALESCE(au.canonical_author_id, a.author_id), p.paper_id, p.topics 
            FROM authorships a
            JOIN authors au ON a.author_id = au.author_id
            JOIN papers p ON a.paper_id = p.paper_id
            WHERE a.paper_id NOT IN (SELECT paper_id FROM duplicate_papers)
        """)
        for aid, pid, topics in c:
            if aid in rows:
                rows[aid].paper_ids.add(pid)
                if topics:
                    for t in topics.split(","):
                        if t.strip():
                            rows[aid].concepts.add(t.strip())

        logger.info("    [Enrich] Enriching affiliations...")
        c.execute("""
            SELECT COALESCE(au.canonical_author_id, a.author_id), COALESCE(i.canonical_inst_id, a.openalex_institution_id), COALESCE(ic.canonical_inst_id, a.corrected_institution_id) 
            FROM authorships a
            JOIN authors au ON a.author_id = au.author_id
            LEFT JOIN institutions i ON a.openalex_institution_id = i.inst_id
            LEFT JOIN institutions ic ON a.corrected_institution_id = ic.inst_id
            WHERE a.paper_id NOT IN (SELECT paper_id FROM duplicate_papers)
        """)
        for aid, raw, corr in c:
            if aid in rows:
                if corr: 
                    rows[aid].inst_ids.add(corr)
                elif raw: 
                    rows[aid].inst_ids.add(raw)

        logger.info("    [Enrich] Enriching coauthors...")
        from collections import defaultdict
        paper_to_authors = defaultdict(list)
        c.execute("""SELECT DISTINCT a.paper_id, COALESCE(au.canonical_author_id, a.author_id) AS aid FROM authorships a
                     JOIN authors au ON a.author_id = au.author_id
                     WHERE a.paper_id NOT IN (SELECT paper_id FROM duplicate_papers)
                     ORDER BY a.paper_id, aid""")
        for pid, aid in c:
            paper_to_authors[pid].append(aid)
            
        for pid, authors_list in paper_to_authors.items():
            if len(authors_list) > 1:
                capped_list = authors_list[:100] if len(authors_list) > 100 else authors_list
                for aid in capped_list:
                    if aid in rows:
                        rows[aid].coauthors.update(a for a in capped_list if a != aid)

    return list(rows.values())
