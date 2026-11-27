import express from 'express';
import { queryNumber, queryText, sendError } from '../services/utils';
import { analyse, applyFilters, paperAt } from '../services/paperSearch';
import { readPaperRecordFilters } from '../services/paperFilters';

/**
 * GET /api/search/papers?q=...&start_year&end_year&topic&venue&platform&limit&offset
 *   { query, expansions, total, results: [{ paper_id, title, year, venue_name, doi, matched_in, meaning, pinned }], took_ms }
 * `matched_in` lists the fields containing every query word; `meaning` marks matches found by meaning alone
 * (no field contains every query word). Abstracts are used for matching but never returned.
 */
const router = express.Router();

router.get('/papers', async (req, res) => {
  const t0 = Date.now();
  try {
    const q = queryText(req.query.q, 'q', 300) ?? '';
    const limit = queryNumber(req.query.limit, 'limit', 1, 200) ?? 20;
    const offset = queryNumber(req.query.offset, 'offset', 0, 100000) ?? 0;
    const filters = readPaperRecordFilters(req.query as Record<string, unknown>);
    if (q.length < 2) return res.json({ query: q, expansions: [], total: 0, results: [], took_ms: 0 });

    const analysis = await analyse(q);
    const matches = applyFilters(analysis, filters);
    const results = matches.slice(offset, offset + limit).flatMap(m => {
      const p = paperAt(m.row, analysis);
      if (!p) return [];
      return [{ paper_id: p.paper_id, title: p.title, year: p.year, venue_name: p.venue_name, doi: p.doi,
        matched_in: m.reasons, meaning: m.meaning, pinned: m.pinned }];
    });
    res.set('Cache-Control', 'no-cache').json({
      query: q, expansions: analysis.expansions, total: matches.length, results, took_ms: Date.now() - t0,
    });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
