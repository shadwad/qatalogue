import express from 'express';
import { BIN_WIDTHS, CHART_FIELDS, EVIDENCE_PAGE_SIZE, isField, splitFields, type EvidencePage, type Field } from '../../shared/chart';
import { summarizeChart } from '../services/chartSummary';
import { LRUCache } from 'lru-cache';
import { encodeJsonResponse, sendEncodedJson, type CachedResponse } from '../services/cache';
import { getDb, onDatabaseChange } from '../services/db';
import { readPaperFilters, paperFilterWhere } from '../services/paperFilters';
import { InputError, queryNumber, sendError } from '../services/utils';
import {
  getAffiliationsByPaper, getTeamSizeByPaper, getValuesByPaper, papersOfEntity, readEntities,
} from '../services/statsData';

/**
 * The Statistics view: GET /api/stats/chart and /api/stats/evidence.
 */
type EvidencePaperRow = NonNullable<EvidencePage['papers']>[number];
type EvidenceInstitutionRow = NonNullable<EvidencePage['institutions']>[number];

const router = express.Router();
const db = getDb();
const cache = new LRUCache<string, CachedResponse>({ max: 300, ttl: 15 * 60 * 1000 });
onDatabaseChange(() => cache.clear());

// All chart forms consume the same aggregates. Changing marks or measures can reuse the response.
router.get('/chart', async (req, res) => {
  try {
    const cached = cache.get(req.originalUrl);
    if (cached) return sendEncodedJson(req, res, cached, 'no-cache');
    const row = req.query.row;
    const split = req.query.split ?? '';
    const bin = queryNumber(req.query.bin, 'bin', 1, 10) ?? 1;
    if (!isField(row)) throw new InputError('Unknown grouping field');
    if (split !== '' && (!isField(split) || !splitFields('bar', row).includes(split))) throw new InputError('Invalid series field');
    if (!BIN_WIDTHS.some(value => value === bin)) throw new InputError('Invalid bin width');

    const filters = await readPaperFilters(req.query as Record<string, unknown>);
    const { where, params } = paperFilterWhere(filters);
    const ids = db.prepare(`SELECT f.paper_id FROM paper_facts f ${where}`).pluck().all(...params) as string[];
    const sizes = getTeamSizeByPaper();
    const affiliations = getAffiliationsByPaper();
    const dimensions = new Map<Field, Map<string, string[]>>();
    for (const field of [row, split] as const) {
      if (field && field !== 'reach' && CHART_FIELDS[field].kind !== 'number') dimensions.set(field, getValuesByPaper(field));
    }
    const data = summarizeChart({
      ids, row, split, bin,
      counts: id => {
        const aff = affiliations.get(id);
        return { authors: sizes.get(id) || null, institutions: aff?.institutions || null, locations: aff?.locations || null };
      },
      categories: (field, id) => {
        if (field === 'reach') {
          const aff = affiliations.get(id);
          return aff ? [aff.reach] : [];
        }
        return dimensions.get(field)?.get(id) ?? [];
      },
    });
    if (req.query.reference === '1' && row === 'year' && (split === 'topic' || split === 'subtopic') && filters.topics.length) {
      const baseline = paperFilterWhere(filters, 'topics');
      const totals = db.prepare(`SELECT f.year, COUNT(*) AS n FROM paper_facts f ${baseline.where} AND f.year IS NOT NULL GROUP BY f.year`).all(...baseline.params) as { year: number; n: number }[];
      data.rowTotals = Object.fromEntries(totals.map(r => [r.year, r.n]));
    }
    const encoded = encodeJsonResponse(data);
    cache.set(req.originalUrl, encoded);
    return sendEncodedJson(req, res, encoded, 'no-cache');
  } catch (error) {
    sendError(res, error);
  }
});

// Intersect each selected mark with the existing paper filters, even when the sidebar
// cannot express the intersection (two regions, collaboration reach, or an exact bin).
router.get('/evidence', async (req, res) => {
  try {
    const fields = [req.query.field, req.query.secondField];
    const values = [req.query.value, req.query.secondValue];
    const bin = queryNumber(req.query.bin, 'bin', 1, 10) ?? 1;
    const page = queryNumber(req.query.page, 'page', 0, 1_000_000) ?? 0;
    const view = req.query.view ?? 'papers';
    if (!BIN_WIDTHS.some(n => n === bin)) throw new InputError('Invalid page or bin');
    if (view !== 'papers' && view !== 'institutions') throw new InputError('Invalid evidence view');
    const predicates: ((id: string) => boolean)[] = [];
    for (const [i, field] of fields.entries()) {
      const value = values[i];
      if (field === undefined && value === undefined) continue;
      if (!isField(field) || typeof value !== 'string' || value.length > 300) throw new InputError('Invalid paper group');
      if (field === 'reach') {
        if (!['single', 'multi', 'cross'].includes(value)) throw new InputError('Invalid collaboration reach');
        const aff = getAffiliationsByPaper();
        predicates.push(id => aff.get(id)?.reach === value);
      } else if (field === 'authors' || field === 'institutions' || field === 'locations') {
        const start = Number(value);
        if (value.trim() === '' || !Number.isSafeInteger(start) || start < 1) throw new InputError('Invalid numerical group');
        const sizes = field === 'authors' ? getTeamSizeByPaper() : undefined;
        const aff = field === 'authors' ? undefined : getAffiliationsByPaper();
        predicates.push(id => {
          const n = field === 'authors' ? sizes?.get(id) : aff?.get(id)?.[field];
          return n !== undefined && n >= start && n < start + bin;
        });
      } else {
        const categories = getValuesByPaper(field);
        predicates.push(id => categories.get(id)?.includes(value) === true);
      }
    }
    const { where, params } = paperFilterWhere(await readPaperFilters(req.query as Record<string, unknown>));
    const entities = readEntities(req.query.entity);
    if (entities.length > 1) throw new InputError('Choose one research profile');
    const entity = entities[0];
    const extra = entity ? papersOfEntity(entity.kind) : '';
    if (entity) params.push(entity.id);
    const candidates = db.prepare(`SELECT f.paper_id FROM paper_facts f ${where} ${extra}`).pluck().all(...params) as string[];
    const ids = candidates.filter(id => predicates.every(matches => matches(id)));
    res.set('Cache-Control', 'no-cache');
    if (ids.length === 0) return res.json(view === 'papers' ? { total: 0, papers: [] } : { total: 0, institutions: [] });
    const membership = 'IN (SELECT value FROM json_each(?))';
    const input = JSON.stringify(ids);
    const offset = page * EVIDENCE_PAGE_SIZE;
    if (view === 'papers') {
      const papers = db.prepare(`SELECT paper_id, title, year, venue_name, doi FROM paper_facts WHERE paper_id ${membership}
        ORDER BY year DESC, title COLLATE NOCASE, paper_id LIMIT ? OFFSET ?`).all(input, EVIDENCE_PAGE_SIZE, offset) as EvidencePaperRow[];
      return res.json({ total: ids.length, papers });
    }
    const from = `FROM author_institution_paper_facts a JOIN institutions i ON i.inst_id = a.institution_id WHERE a.paper_id ${membership} AND i.display_name IS NOT NULL`;
    const total = Number(db.prepare(`SELECT COUNT(DISTINCT i.inst_id) ${from}`).pluck().get(input) ?? 0);
    const institutions = db.prepare(`SELECT i.inst_id AS id, i.display_name AS name, i.ror, COUNT(DISTINCT a.paper_id) AS papers
      ${from} GROUP BY i.inst_id ORDER BY i.display_name COLLATE NOCASE, i.inst_id LIMIT ? OFFSET ?`).all(input, EVIDENCE_PAGE_SIZE, offset) as EvidenceInstitutionRow[];
    res.json({ total, institutions });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
