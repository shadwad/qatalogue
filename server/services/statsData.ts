/**
 * Per-paper lookups and entity filters for the statistics routes (server/routes/stats.ts), cached per database build.
 */
import { getDb, hasTable, onDatabaseChange } from './db';
import { excludePlaceholders } from './placeholders';
import { InputError } from './utils';

const db = getDb();

export type DimensionKey = 'topic' | 'subtopic' | 'platform' | 'venue' | 'region' | 'year';

// Each dimension as (paper_id, value), one row per distinct pair. paper_topics holds topics and subtopics together;
// subtopic ids are "topic/subtopic". A paper is in a region if at least one author is affiliated there.
const DIMENSIONS: Record<DimensionKey, string> = {
  topic: "SELECT paper_id, topic_id AS value FROM paper_topics WHERE topic_id NOT LIKE '%/%'",
  subtopic: "SELECT paper_id, topic_id AS value FROM paper_topics WHERE topic_id LIKE '%/%'",
  platform: 'SELECT DISTINCT paper_id, platform_id AS value FROM paper_platforms',
  venue: "SELECT paper_id, venue_name AS value FROM paper_facts WHERE venue_name <> ''",
  region: `SELECT DISTINCT a.paper_id, d.region AS value
    FROM author_institution_paper_facts a
    LEFT JOIN institutions i ON i.inst_id = a.institution_id
    JOIN location_dimension d ON UPPER(d.location_code) = UPPER(COALESCE(i.location_code, a.location_code))
    WHERE d.region <> ''`,
  year: 'SELECT paper_id, CAST(year AS TEXT) AS value FROM paper_facts WHERE year IS NOT NULL',
};

// Each paper's values for a dimension.
const valuesCache = new Map<string, Map<string, string[]>>();
export function getValuesByPaper(dimension: string): Map<string, string[]> {
  if (!Object.hasOwn(DIMENSIONS, dimension)) throw new InputError('Unknown dimension');
  let map = valuesCache.get(dimension);
  if (!map) {
    map = new Map();
    const ready = (dimension !== 'platform' || hasTable('paper_platforms'))
      && (dimension !== 'region' || hasTable('location_dimension'));
    if (ready) {
      const rows = db.prepare(DIMENSIONS[dimension as DimensionKey]).all() as { paper_id: string; value: string }[];
      for (const { paper_id, value } of rows) {
        const list = map.get(paper_id);
        if (list) list.push(value);
        else map.set(paper_id, [value]);
      }
    }
    valuesCache.set(dimension, map);
  }
  return map;
}

export type Reach = 'single' | 'multi' | 'cross';
// Per paper, over all of its authors rather than only those matching a filter: pairing it with the filtered papers is
// far cheaper than aggregating the authorships on every request.
export interface PaperAffiliations { institutions: number; locations: number; reach: Reach }
let affiliationsByPaper: Map<string, PaperAffiliations> | null = null;
export function getAffiliationsByPaper(): Map<string, PaperAffiliations> {
  if (!affiliationsByPaper) {
    const rows = db.prepare(`
      SELECT paper_id AS id, COUNT(DISTINCT institution_id) AS institutions, COUNT(DISTINCT NULLIF(location_code, '')) AS locations
      FROM author_institution_paper_facts GROUP BY paper_id`).all() as { id: string; institutions: number; locations: number }[];
    affiliationsByPaper = new Map(rows.map(({ id, institutions, locations }) => [id, {
      institutions, locations, reach: institutions === 1 ? 'single' : locations >= 2 ? 'cross' : 'multi',
    }]));
  }
  return affiliationsByPaper;
}

// Authors per paper, with merged author records counted once.
let teamSizeByPaper: Map<string, number> | null = null;
export function getTeamSizeByPaper(): Map<string, number> {
  if (!teamSizeByPaper) {
    const rows = db.prepare('SELECT paper_id AS id, MAX(canonical_author_count) AS n FROM author_paper_facts GROUP BY paper_id').all() as { id: string; n: number }[];
    teamSizeByPaper = new Map(rows.map(r => [r.id, r.n]));
  }
  return teamSizeByPaper;
}

onDatabaseChange(() => { valuesCache.clear(); affiliationsByPaper = null; teamSizeByPaper = null; });

const MAX_ENTITIES = 1;
const ENTITY_ID = /^[A-Za-z0-9_]+$/;

export interface EntityQuery { kind: 'institution' | 'researcher'; id: string }

/** The `entity` parameter: at most one "institution:<id>" or "researcher:<id>". */
export function readEntities(value: unknown): EntityQuery[] {
  const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
  if (list.length > MAX_ENTITIES) throw new InputError(`At most ${MAX_ENTITIES} entities allowed`);
  return list.map(item => {
    if (typeof item !== 'string') throw new InputError('entity must be institution:<id> or researcher:<id>');
    const parts = item.split(':');
    if (parts.length !== 2) throw new InputError('entity must be institution:<id> or researcher:<id>');
    const [kind, id] = parts;
    if ((kind !== 'institution' && kind !== 'researcher') || !id || !ENTITY_ID.test(id)) {
      throw new InputError('entity must be institution:<id> or researcher:<id>');
    }
    return { kind, id };
  });
}

/** A condition on `paper_facts f` keeping one entity's papers; takes the entity's id as its parameter. */
export const papersOfEntity = (kind: EntityQuery['kind']) => kind === 'institution'
  ? 'AND f.paper_id IN (SELECT paper_id FROM author_institution_paper_facts WHERE institution_id = ?)'
  : `AND f.paper_id IN (SELECT paper_id FROM author_paper_facts WHERE author_id = ?${excludePlaceholders('author_id')})`;
