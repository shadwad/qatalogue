import express from 'express';
import { getDb } from '../services/db';
import { excludePlaceholders } from '../services/placeholders';
import { sendCachedDetail, sendDetailFromCache } from '../services/cache';
import { factMetricExpression, locationDetails, queryId, sendError } from '../services/utils';
import { addPaging, readListFilters } from '../services/listFilters';
import { addFactFilters } from '../services/paperFilters';

interface AuthorInstitutionRow {
  institution_id: string;
  institution_name: string;
  ror: string | null;
  openalex_id: string | null;
  location_code: string | null;
  latest_year: number | null;
  fractional_score: number;
  paper_count: number;
}

const router = express.Router();
const db = getDb();

router.get('/', async (req, res) => {
  try {
    if (sendDetailFromCache(req, res)) return;
    const authorId = queryId(req.query.author_id, 'author_id', true)!;
    const f = await readListFilters(req.query as Record<string, unknown>);

    let query = `
      SELECT
        a2i.institution_id as institution_id,
        MAX(i.display_name) as institution_name,
        MAX(i.ror) as ror,
        MAX(i.openalex_id) as openalex_id,
        MAX(COALESCE(i.location_code, a2i.location_code)) as location_code,
        MAX(a2i.year) as latest_year,
        ${factMetricExpression(f.metricMode, 'a2i', true)} as fractional_score,
        COUNT(DISTINCT a2i.paper_id) as paper_count
      FROM author_institution_paper_facts a2i
      JOIN institutions i ON i.inst_id = a2i.institution_id
      WHERE a2i.author_id = ?${excludePlaceholders('a2i.author_id')}
    `;
    const params: unknown[] = [authorId];
    query = addFactFilters(query, params, f, 'a2i', "UPPER(COALESCE(i.location_code, a2i.location_code, ''))");

    query += `
      GROUP BY a2i.institution_id
      HAVING MAX(i.display_name) IS NOT NULL
      ORDER BY latest_year DESC, institution_name COLLATE NOCASE ASC, a2i.institution_id
    `;
    query = addPaging(query, params, f);

    const rows = db.prepare(query).all(...params) as AuthorInstitutionRow[];
    sendCachedDetail(req, res, {
      institutions: rows.map(row => ({
        ...row,
        ...locationDetails(row.location_code),
      })),
    });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
