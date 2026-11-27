import express from 'express';
import { getDb } from '../services/db';
import { excludePlaceholders } from '../services/placeholders';
import { sendCachedDetail, sendDetailFromCache } from '../services/cache';
import { factMetricExpression, queryId, round9, sendError } from '../services/utils';
import { addPaging, readListFilters } from '../services/listFilters';
import { addFactFilters } from '../services/paperFilters';

interface FacultyRow {
  author_id: string;
  author_name: string | null;
  orcid: string | null;
  openalex_id: string | null;
  fractional_score: number;
  paper_count: number;
}

const router = express.Router();
const db = getDb();

router.get('/', async (req, res) => {
  try {
    if (sendDetailFromCache(req, res)) return;
    const instId = queryId(req.query.inst_id, 'inst_id', true)!;
    const f = await readListFilters(req.query as Record<string, unknown>);
    const metricExpr = factMetricExpression(f.metricMode, 'a2i', true);

    let query = `
      SELECT
        a2i.author_id as author_id,
        MAX(auth.name) as author_name,
        MAX(auth.orcid) as orcid,
        MAX(auth.author_id) as openalex_id,
        ${metricExpr} as fractional_score,
        COUNT(DISTINCT a2i.paper_id) as paper_count
      FROM author_institution_paper_facts a2i
      JOIN authors auth ON auth.author_id = a2i.author_id
      LEFT JOIN institutions i ON i.inst_id = a2i.institution_id
      WHERE a2i.institution_id = ?${excludePlaceholders('a2i.author_id')}
    `;
    const params: unknown[] = [instId];
    query = addFactFilters(query, params, f, 'a2i', "UPPER(COALESCE(i.location_code, a2i.location_code, ''))");

    query += `
      GROUP BY a2i.author_id
    `;
    if (f.individualThreshold !== undefined) {
      query += ` HAVING ${round9(metricExpr)} >= ?`;
      params.push(f.individualThreshold);
    }
    query += `
      ORDER BY ${round9(metricExpr)} DESC, a2i.author_id
    `;
    query = addPaging(query, params, f);

    const faculty = db.prepare(query).all(...params) as FacultyRow[];
    sendCachedDetail(req, res, { faculty });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
