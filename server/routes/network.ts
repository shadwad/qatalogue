import express from 'express';
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { getDb, hasTable, onDatabaseChange } from '../services/db';
import {
  normalizeVenueFilters,
  addFactDimensionFilters,
  readPaperQuery,
  addPaperSetFilter,
  queryNumber,
  InputError,
  sendError,
} from '../services/utils';
import { paperSetJson } from '../services/paperSearch';
import { encodeJsonResponse, sendEncodedJson, type CachedResponse } from '../services/cache';
import { excludePlaceholders } from '../services/placeholders';
import { getAffiliationsByPaper } from '../services/statsData';

/**
 * POST /api/network
 * Body: { view: 'researcher' | 'institution', ids: string[], start_year?, end_year?, topics?: string[], venues?: string[], platforms?: string[],
 *         paper_query?: string }   (topic search: only papers matching it count as shared papers)
 * Returns co-authorship edges among `ids` only:
 *   { edges: [{ source, target, papers, weight }], positions?: { [id]: [lat, lng, precision, city] } }
 * `positions` is included for the institution view only (Map layout).
 *
 * weight = Σ over shared papers of 1 / (k − 1), where k is the number of co-authors
 * (researchers) or distinct institutions (institutions) on that paper. A 2-party paper
 * counts 1; a 100-author consortium paper barely registers — same spirit as the
 * fractional attribution models.
 */

const router = express.Router();
const db = getDb();

const NETWORK_MAX_IDS = { researcher: 1000, institution: 500 } as const;

const networkCache = new LRUCache<string, CachedResponse>({ max: 200, ttl: 15 * 60 * 1000 });
onDatabaseChange(() => networkCache.clear());

function readBodyStringList(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InputError(`${name} must be an array of strings`);
  return value.map(item => {
    if (typeof item !== 'string') throw new InputError(`${name} must contain only strings`);
    return item.trim();
  }).filter(Boolean);
}

const asYear = (v: unknown, name: string): number | undefined =>
  v === undefined || v === null ? undefined : queryNumber(v, name, 1900, 2100);

type Edge = { source: string; target: string; papers: number; weight: number };
type Position = [lat: number, lng: number, precision: 'city' | 'location', city: string | null];

// Coordinates for the institution Map layout (table built by pipeline/scripts/build_geo.py; optional).
function institutionPositions(ids: string[]): Record<string, Position> {
  if (!hasTable('institution_geo')) return {};
  const rows = db.prepare(`
    WITH ids AS (SELECT value AS id FROM json_each(?))
    SELECT g.inst_id, g.lat, g.lng, g.precision, g.city
    FROM ids JOIN institution_geo g ON g.inst_id = ids.id
  `).all(JSON.stringify(ids)) as { inst_id: string; lat: number; lng: number; precision: 'city' | 'location'; city: string | null }[];
  return Object.fromEntries(rows.map(r => [r.inst_id, [r.lat, r.lng, r.precision, r.city]]));
}

function researcherEdges(ids: string[], startYear: number | undefined, endYear: number | undefined, topics: string[], venues: string[], paperSet: string | null, platforms: string[]): Edge[] {
  const params: unknown[] = [JSON.stringify(ids)];
  let filters = '';
  if (startYear !== undefined) { filters += ' AND p.year >= ?'; params.push(startYear); }
  if (endYear !== undefined) { filters += ' AND p.year <= ?'; params.push(endYear); }
  filters = addFactDimensionFilters(filters, params, topics, venues, 'p', platforms, platforms.length ? hasTable('paper_platforms') : true);
  filters = addPaperSetFilter(filters, params, paperSet, 'p');

  return db.prepare(`
    WITH ids AS (SELECT value AS id FROM json_each(?)),
    ap AS MATERIALIZED (
      SELECT apf.author_id, apf.paper_id, apf.canonical_author_count AS k
      FROM ids
      JOIN author_paper_facts apf ON apf.author_id = ids.id
      JOIN paper_facts p ON p.paper_id = apf.paper_id
      WHERE 1=1${excludePlaceholders('apf.author_id')} ${filters}
    )
    SELECT a.author_id AS source, b.author_id AS target,
      COUNT(*) AS papers, SUM(1.0 / MAX(a.k - 1, 1)) AS weight
    FROM ap a JOIN ap b ON a.paper_id = b.paper_id AND a.author_id < b.author_id
    GROUP BY a.author_id, b.author_id
    ORDER BY a.author_id, b.author_id
  `).all(...params) as Edge[];
}

function institutionEdges(ids: string[], startYear: number | undefined, endYear: number | undefined, topics: string[], venues: string[], paperSet: string | null, platforms: string[]): Edge[] {
  const params: unknown[] = [JSON.stringify(ids)];
  let filters = '';
  if (startYear !== undefined) { filters += ' AND a2i.year >= ?'; params.push(startYear); }
  if (endYear !== undefined) { filters += ' AND a2i.year <= ?'; params.push(endYear); }
  filters = addFactDimensionFilters(filters, params, topics, venues, 'a2i', platforms, platforms.length ? hasTable('paper_platforms') : true);
  filters = addPaperSetFilter(filters, params, paperSet, 'a2i');

  const rows = db.prepare(`
    WITH ids AS (SELECT value AS id FROM json_each(?))
    SELECT DISTINCT a2i.institution_id AS inst, a2i.paper_id AS paper
    FROM ids JOIN author_institution_paper_facts a2i ON a2i.institution_id = ids.id
    WHERE 1=1 ${filters}
  `).all(...params) as { inst: string; paper: string }[];

  // Pair institutions per paper in JS — far cheaper than a SQL self-join here.
  const byPaper = new Map<string, string[]>();
  for (const { inst, paper } of rows) {
    const list = byPaper.get(paper);
    if (list) list.push(inst); else byPaper.set(paper, [inst]);
  }
  const affiliations = getAffiliationsByPaper();
  const edges = new Map<string, Edge>();
  for (const [paper, insts] of byPaper) {
    if (insts.length < 2) continue;
    const m = affiliations.get(paper)?.institutions ?? insts.length;
    const w = 1 / Math.max(m - 1, 1);
    insts.sort();
    for (let i = 0; i < insts.length; i++) {
      for (let j = i + 1; j < insts.length; j++) {
        const key = `${insts[i]}|${insts[j]}`;
        const e = edges.get(key);
        if (e) { e.papers += 1; e.weight += w; }
        else edges.set(key, { source: insts[i], target: insts[j], papers: 1, weight: w });
      }
    }
  }
  return [...edges.values()].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
}

router.post('/', express.json({ limit: '512kb' }), async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw new InputError('Request body must be a JSON object');
    }
    const body = req.body as Record<string, unknown>;
    const view = body.view;
    if (view !== 'researcher' && view !== 'institution') throw new InputError('view must be researcher or institution');
    const ids = [...new Set(readBodyStringList(body.ids, 'ids'))];
    if (ids.length === 0) return res.json({ edges: [] });
    if (ids.length > NETWORK_MAX_IDS[view]) throw new InputError(`At most ${NETWORK_MAX_IDS[view]} ids allowed for ${view}`);
    const startYear = asYear(body.start_year, 'start_year');
    const endYear = asYear(body.end_year, 'end_year');
    if (startYear !== undefined && endYear !== undefined && startYear > endYear) {
      throw new InputError('start_year must not be greater than end_year');
    }
    const topics = readBodyStringList(body.topics, 'topics').sort();
    const venues = normalizeVenueFilters(readBodyStringList(body.venues, 'venues')).sort();
    const platforms = readBodyStringList(body.platforms, 'platforms').sort();
    const paperQuery = readPaperQuery(body.paper_query);

    const key = createHash('sha1')
      .update(JSON.stringify([view, [...ids].sort(), startYear, endYear, topics, venues, platforms, paperQuery?.toLowerCase() ?? null]))
      .digest('hex');
    let payload = networkCache.get(key);
    if (!payload) {
      const paperSet = paperQuery ? await paperSetJson(paperQuery) : null;
      const edges = view === 'researcher'
        ? researcherEdges(ids, startYear, endYear, topics, venues, paperSet, platforms)
        : institutionEdges(ids, startYear, endYear, topics, venues, paperSet, platforms);
      const positions = view === 'institution' ? institutionPositions(ids) : undefined;
      payload = encodeJsonResponse({ edges, positions });
      networkCache.set(key, payload);
    }
    return sendEncodedJson(req, res, payload);
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
