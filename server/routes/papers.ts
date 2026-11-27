import express from 'express';
import { getDb } from '../services/db';
import { excludePlaceholders } from '../services/placeholders';
import { sendCachedDetail, sendDetailFromCache } from '../services/cache';
import { InputError, queryId, round9, sendError } from '../services/utils';
import { addPaging, readListFilters } from '../services/listFilters';
import { addFactFilters } from '../services/paperFilters';

interface PaperRow {
  paper_id: string;
  title: string | null;
  year: number | null;
  venue_id: string | null;
  venue_name: string | null;
  topics: string | null;
  total_authors: number | null;
  doi: string | null;
  score_share: number;
  canonical_author_count: number;
}

const router = express.Router();
const db = getDb();

router.get('/', async (req, res) => {
  try {
    if (sendDetailFromCache(req, res)) return;
    const instId = queryId(req.query.inst_id, 'inst_id');
    const authorId = queryId(req.query.author_id, 'author_id');
    if (!instId && !authorId) throw new InputError('inst_id or author_id required');
    const f = await readListFilters(req.query as Record<string, unknown>);

    // A researcher's own papers: one row per paper, including papers with no affiliation, matching their totals.
    if (authorId && !instId) {
      const researcherParams: unknown[] = [authorId];
      let researcherQuery = `
        SELECT p.*, apf.fractional_share AS score_share, apf.canonical_author_count AS canonical_author_count
        FROM paper_facts p
        JOIN author_paper_facts apf ON apf.paper_id = p.paper_id
        WHERE apf.author_id = ?${excludePlaceholders('apf.author_id')}
      `;
      // A paper matches a location when the researcher was affiliated there on that paper.
      researcherQuery = addFactFilters(researcherQuery, researcherParams, f, 'p', placeholders =>
        `EXISTS (SELECT 1 FROM author_institution_paper_facts a2i LEFT JOIN institutions i ON i.inst_id = a2i.institution_id
          WHERE a2i.paper_id = p.paper_id AND a2i.author_id = apf.author_id
          AND UPPER(COALESCE(i.location_code, a2i.location_code, '')) IN (${placeholders}))`);
      researcherQuery += f.metricMode === 'total_count'
        ? ' ORDER BY p.year DESC, p.paper_id'
        : ` ORDER BY p.year DESC, ${round9('apf.fractional_share')} DESC, p.paper_id`;
      researcherQuery = addPaging(researcherQuery, researcherParams, f);
      const researcherPapers = db.prepare(researcherQuery).all(...researcherParams) as PaperRow[];
      return sendCachedDetail(req, res, { papers: researcherPapers });
    }

    let query = `
      SELECT p.*, SUM(a2i.adjusted_fractional_share) as score_share,
        MAX(a2i.canonical_author_count) AS canonical_author_count
      FROM paper_facts p
      JOIN author_institution_paper_facts a2i ON a2i.paper_id = p.paper_id
      LEFT JOIN institutions i ON i.inst_id = a2i.institution_id
      WHERE a2i.institution_id = ?
    `;
    const params: unknown[] = [instId];

    if (authorId) {
      query += ` AND a2i.author_id = ?${excludePlaceholders('a2i.author_id')}`;
      params.push(authorId);
    }
    query = addFactFilters(query, params, f, 'a2i', "UPPER(COALESCE(i.location_code, a2i.location_code, ''))");

    const orderBy = f.metricMode === 'total_count'
      ? 'p.year DESC, p.paper_id'
      : f.metricMode === 'frac_count'
        ? `p.year DESC, ${round9('MAX(a2i.fractional_share)')} DESC, p.paper_id`
        : `p.year DESC, ${round9('SUM(a2i.adjusted_fractional_share)')} DESC, p.paper_id`;
    query += ` GROUP BY p.paper_id ORDER BY ${orderBy}`;
    query = addPaging(query, params, f);

    const papers = db.prepare(query).all(...params) as PaperRow[];
    sendCachedDetail(req, res, { papers });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
