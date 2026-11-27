from pipeline.db.connection import open_staging


def get_paper_local_institutions():
    with open_staging() as conn:
        c = conn.cursor()
        c.execute("""
            SELECT
                a.paper_id, 
                COALESCE(auth.canonical_author_id, a.author_id) as author_id, 
                auth.orcid,
                COALESCE(inst.canonical_inst_id, a.corrected_institution_id, a.openalex_institution_id) AS eff_inst,
                inst.display_name, inst.ror
            FROM authorships a
            JOIN authors auth ON a.author_id = auth.author_id
            JOIN institutions inst ON inst.inst_id = COALESCE(a.corrected_institution_id, a.openalex_institution_id)
            WHERE a.paper_id IN (
                SELECT paper_id FROM authorships a2
                LEFT JOIN institutions inst2 ON inst2.inst_id = COALESCE(a2.corrected_institution_id, a2.openalex_institution_id)
                WHERE a2.openalex_institution_id IS NOT NULL AND a2.corrected_institution_id IS NULL
                  AND a2.paper_id NOT IN (SELECT paper_id FROM duplicate_papers)
                GROUP BY paper_id
                HAVING COUNT(DISTINCT COALESCE(inst2.canonical_inst_id, a2.corrected_institution_id, a2.openalex_institution_id)) > 1
            )
              AND a.paper_id NOT IN (SELECT paper_id FROM duplicate_papers)
        """)
        return c.fetchall()


def get_all_institutions():
    with open_staging() as conn:
        c = conn.cursor()
        c.execute("""
            SELECT inst_id, ror, openalex_id, display_name, location_code
            FROM institutions
            WHERE canonical_inst_id IS NULL OR canonical_inst_id = inst_id
            ORDER BY inst_id
        """)
        return c.fetchall()


def get_author_inst_histories():
    with open_staging() as conn:
        c = conn.cursor()
        c.execute("""
            SELECT 
                COALESCE(au.canonical_author_id, a.author_id), 
                COALESCE(i.canonical_inst_id, a.corrected_institution_id, a.openalex_institution_id), 
                MIN(i.display_name),
                MAX(i.location_code),
                COUNT(a.paper_id) as paper_count,
                MAX(i.ror)
            FROM authorships a
            JOIN authors au ON au.author_id = a.author_id
            JOIN institutions i ON i.inst_id = COALESCE(a.corrected_institution_id, a.openalex_institution_id)
            WHERE a.openalex_institution_id IS NOT NULL AND a.paper_id NOT IN (SELECT paper_id FROM duplicate_papers)
            GROUP BY COALESCE(au.canonical_author_id, a.author_id), COALESCE(i.canonical_inst_id, a.corrected_institution_id, a.openalex_institution_id)
        """)
        return c.fetchall()
