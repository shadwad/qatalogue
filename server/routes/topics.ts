import express from 'express';
import { LRUCache } from 'lru-cache';
import { encodeJsonResponse, sendEncodedJson, type CachedResponse } from '../services/cache';
import { getDb, hasTable, onDatabaseChange } from '../services/db';
import { readPaperFilters, paperFilterWhere } from '../services/paperFilters';
import { locationDetails, sendError } from '../services/utils';

/**
 * GET /api/topics/counts?start_year&end_year&topic&venue&platform&location&paper_query&locationCounts
 *   { topics: { [topicOrSubtopicId]: papers }, platforms: { [platformId]: papers }, venues: { [venueName]: papers }, total }
 * With `locationCounts`, also { locations: { [locationName]: papers }, regions: { [region]: papers } }.
 * Distinct papers per topic, platform and venue under the current filters, plus the papers matching all of them. Each
 * list ignores its own filter, so it shows what selecting an item would give (facet counts). A paper matches a location
 * if at least one author is affiliated there.
 */
const router = express.Router();
const db = getDb();
const cache = new LRUCache<string, CachedResponse>({ max: 300, ttl: 15 * 60 * 1000 });

// Each paper's locations and regions, built once. Counting over these takes milliseconds, where joining every author
// row on each request took about a second, and all the sidebar's lists wait for this response.
type Places = { locations: Set<string>; regions: Set<string> };
let placesCache: Map<string, Places> | null = null;
onDatabaseChange(() => { cache.clear(); placesCache = null; });
function getPlacesByPaper() {
  if (placesCache) return placesCache;
  const next = new Map<string, Places>();
  const rows = db.prepare(`
    SELECT DISTINCT a.paper_id, COALESCE(i.location_code, a.location_code) AS code
    FROM author_institution_paper_facts a
    LEFT JOIN institutions i ON i.inst_id = a.institution_id
  `).all() as { paper_id: string; code: string | null }[];
  for (const { paper_id, code } of rows) {
    const { location, region } = locationDetails(code);
    let places = next.get(paper_id);
    if (!places) next.set(paper_id, places = { locations: new Set(), regions: new Set() });
    places.locations.add(location);
    places.regions.add(region || 'Global');
  }
  placesCache = next;
  return placesCache;
}

router.get('/counts', async (req, res) => {
  try {
    const cached = cache.get(req.originalUrl);
    if (cached) return sendEncodedJson(req, res, cached, 'no-cache');
    const filters = await readPaperFilters(req.query as Record<string, unknown>);
    const base = (skip: 'topics' | 'platforms' | 'venues' | 'locations' | null = null) => paperFilterWhere(filters, skip);

    const t = base('topics');
    const topicRows = db.prepare(`
      SELECT pt.topic_id AS id, COUNT(*) AS n
      FROM paper_facts f JOIN paper_topics pt ON pt.paper_id = f.paper_id
      ${t.where}
      GROUP BY pt.topic_id`).all(...t.params) as { id: string; n: number }[];

    let platformRows: { id: string; n: number }[] = [];
    if (hasTable('paper_platforms')) {
      const p = base('platforms');
      platformRows = db.prepare(`
        SELECT pp.platform_id AS id, COUNT(DISTINCT pp.paper_id) AS n
        FROM paper_facts f JOIN paper_platforms pp ON pp.paper_id = f.paper_id
        ${p.where}
        GROUP BY pp.platform_id`).all(...p.params) as { id: string; n: number }[];
    }
    const v = base('venues');
    const venueRows = db.prepare(`
      SELECT f.venue_name AS id, COUNT(*) AS n FROM paper_facts f ${v.where} AND f.venue_name IS NOT NULL AND f.venue_name <> '' GROUP BY f.venue_name`).all(...v.params) as { id: string; n: number }[];

    const a = base();
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM paper_facts f ${a.where}`).get(...a.params) as { n: number }).n;

    // Asked for only by Statistics, whose location list counts papers. The list elsewhere counts its own entries.
    let locationCounts = {};
    const includeLocationCounts = req.query.locationCounts === '1' || req.query.locationCounts === 'true';
    if (includeLocationCounts) {
      const l = base('locations');
      const papers = db.prepare(`SELECT f.paper_id FROM paper_facts f ${l.where}`).pluck().all(...l.params) as string[];
      const places = getPlacesByPaper();
      const byLocation: Record<string, number> = {};
      const regions: Record<string, number> = {};
      for (const id of papers) {
        const place = places.get(id);
        if (!place) continue;
        place.locations.forEach(c => { byLocation[c] = (byLocation[c] ?? 0) + 1; });
        place.regions.forEach(r => { regions[r] = (regions[r] ?? 0) + 1; });
      }
      locationCounts = { locations: byLocation, regions };
    }

    const body = {
      topics: Object.fromEntries(topicRows.map(r => [r.id, r.n])),
      platforms: Object.fromEntries(platformRows.map(r => [r.id, r.n])),
      venues: Object.fromEntries(venueRows.map(r => [r.id, r.n])),
      ...locationCounts,
      total,
    };
    const encoded = encodeJsonResponse(body);
    cache.set(req.originalUrl, encoded);
    return sendEncodedJson(req, res, encoded, 'no-cache');
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
