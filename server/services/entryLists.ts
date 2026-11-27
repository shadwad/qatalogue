/**
 * The institution and researcher lists (GET /api/entries/institutions, /researchers).
 *
 * Each list has several ways to the same numbers, chosen for speed:
 *   summary    performance_summary, one row per entity and year: no topic, venue, platform or topic-search filter
 *   dimension  performance_summary_dimensions: one venue filter (any number of venues, which never overlap) or one topic
 *   threshold  (institutions) the facts, with the researchers an institution counts filtered by their own contribution
 *   facts      the fact tables, for everything else
 * institutionPath()/researcherPath() pick one; every path must give the same entries for a request it can answer, which
 * tests/server/serverLists.test.ts checks on a built database. Ties on score are ordered by id, so pages never overlap.
 */
import { LRUCache } from 'lru-cache';
import { checkDatabase, getDb, hasTable, onDatabaseChange } from './db';
import { addPaging, ListFilters, MetricMode } from './listFilters';
import { excludePlaceholders, namedAuthorCount } from './placeholders';
import { addFactFilters } from './paperFilters';
import {
  addFactDimensionFilters, factMetricExpression, isCompoundFilter, locationDetails, round9, splitSearchTerms,
} from './utils';

const db = getDb();

interface FtsIdRow {
  id: string;
}

interface InstitutionDbRow {
  institution_id: string;
  institution_name: string;
  location_code: string | null;
  ror: string | null;
  openalex_id: string | null;
  total_fractional_score: number;
  paper_count: number;
  core_faculty_count?: number;
  fts_rank?: number;
}

interface InstitutionThresholdDbRow {
  institution_id: string;
  institution_name: string;
  location_code: string | null;
  ror: string | null;
  openalex_id: string | null;
  paper_count: number;
  core_faculty_count: number;
  af_score: number;
  f_score: number;
  t_score: number;
}

export interface InstitutionEntry {
  institution_id: string;
  institution_name: string;
  location_code: string | null;
  ror: string | null;
  openalex_id: string | null;
  total_fractional_score: number;
  core_faculty_count: number;
  paper_count: number;
  fts_rank?: number;
  location: string;
  region: string;
}

interface ResearcherDbRow {
  author_id: string;
  author_name: string;
  orcid: string | null;
  openalex_id: string | null;
  total_fractional_score: number;
  paper_count: number;
  max_year: number | null;
  latest_affiliation: string | null;
  location_code: string | null;
  fts_rank?: number;
}

export interface ResearcherEntry extends ResearcherDbRow {
  location: string;
  region: string;
  type: 'researcher';
}

/** Scores are compared and ordered at 9 decimals. The paths add the same shares in different orders (per year, per row),
 * so equal scores can differ in the last digit; unrounded, ties would order by that noise instead of by id, and an
 * entity exactly at a threshold could be in on one path and out on another. */
const r9 = round9;

/** Each metric as a column of each table. */
const SUMMARY_METRIC: Record<MetricMode, string> = {
  none: 'total_fractional_score', adj_frac_count: 'total_fractional_score', frac_count: 'fractional_count', total_count: 'paper_count',
};
const DIMENSION_METRIC: Record<MetricMode, string> = {
  none: 'adjusted_fractional_count', adj_frac_count: 'adjusted_fractional_count', frac_count: 'fractional_count', total_count: 'total_count',
};

let hasSummary: boolean | null = null;
const distinctResearchersCache = new LRUCache<string, Map<string, number>>({ max: 128, ttl: 30 * 60 * 1000 });
onDatabaseChange(() => {
  hasSummary = null;
  distinctResearchersCache.clear();
});

/** Whether the build wrote the summary tables (older databases did not). */
function summaryBuilt(): boolean {
  checkDatabase();
  if (hasSummary === null) {
    try {
      hasSummary = hasTable('performance_summary_meta')
        && Boolean(db.prepare('SELECT 1 FROM performance_summary_meta').get());
    } catch {
      hasSummary = false;
    }
  }
  return hasSummary;
}

/** The one dimension a request filters on, when its pre-computed rows can be summed: any venues (a paper has one
 * venue), or one plain topic (several topics overlap, since a paper can carry several). */
function summableDimension(f: ListFilters): { type: 'topic' | 'venue'; values: string[] } | undefined {
  if (f.locations.length) return undefined;
  if (f.venues.length && !f.topics.length) return { type: 'venue', values: f.venues };
  if (f.topics.length === 1 && !f.venues.length && !isCompoundFilter(f.topics[0])) return { type: 'topic', values: f.topics };
  return undefined;
}

const yearRange = (column: string, f: ListFilters, params: unknown[]) => {
  let sql = '';
  if (f.startYear !== undefined) { sql += ` AND ${column} >= ?`; params.push(f.startYear); }
  if (f.endYear !== undefined) { sql += ` AND ${column} <= ?`; params.push(f.endYear); }
  return sql;
};

const anyOf = (expression: string, values: string[], params: unknown[]) => {
  params.push(...values);
  return ` AND (${values.map(() => `${expression} = ?`).join(' OR ')})`;
};

function shortTermFilters(shortTerms: readonly string[], columns: readonly string[], params: unknown[]): string {
  let sql = '';
  for (const term of shortTerms) {
    sql += ` AND (${columns.map(col => `INSTR(LOWER(COALESCE(${col}, '')), ?) > 0`).join(' OR ')})`;
    for (let i = 0; i < columns.length; i++) params.push(term);
  }
  return sql;
}

/** Ids matching the >=3-char FTS search terms, or null without any. */
function searchIds(ftsQuery: string, table: 'institutions_fts' | 'authors_fts', column: string): string[] | null {
  if (!ftsQuery) return null;
  return (db.prepare(`SELECT ${column} AS id FROM ${table} WHERE ${table} MATCH ? LIMIT 10000`).all(ftsQuery) as FtsIdRow[])
    .map(r => r.id);
}

// ---------- institutions ----------

/**
 * Distinct named researchers per institution under the year and paper filters. The one denominator for Adjusted
 * Average on every path: the pre-computed tables only hold yearly counts, which can't be summed or compared.
 */
function distinctResearchers(f: ListFilters, topics: string[], venues: string[]): Map<string, number> {
  const key = JSON.stringify([f.startYear ?? null, f.endYear ?? null, [...topics].sort(), [...venues].sort()]);
  const cached = distinctResearchersCache.get(key);
  if (cached) return cached;

  let rows: { id: string; n: number }[];
  if (!topics.length && !venues.length && hasTable('performance_summary_contributors')) {
    const params: unknown[] = [];
    let sql = "SELECT c.entity_id AS id, COUNT(DISTINCT c.author_id) AS n FROM performance_summary_contributors c WHERE c.entity_type = 'institution'";
    sql += yearRange('c.year', f, params);
    rows = db.prepare(`${sql} GROUP BY c.entity_id`).all(...params) as { id: string; n: number }[];
  } else if (topics.length === 1 && !venues.length && !isCompoundFilter(topics[0])) {
    const params: unknown[] = [topics[0]];
    let sql = `SELECT a2i.institution_id AS id, ${namedAuthorCount('a2i.author_id')} AS n
      FROM paper_topics pt JOIN author_institution_paper_facts a2i ON a2i.paper_id = pt.paper_id
      WHERE pt.topic_id = ?`;
    sql += yearRange('a2i.year', f, params);
    rows = db.prepare(`${sql} GROUP BY a2i.institution_id`).all(...params) as { id: string; n: number }[];
  } else {
    const params: unknown[] = [];
    let sql = `SELECT a2i.institution_id AS id, ${namedAuthorCount('a2i.author_id')} AS n FROM author_institution_paper_facts a2i WHERE 1=1`;
    sql += yearRange('a2i.year', f, params);
    sql = addFactDimensionFilters(sql, params, topics, venues, 'a2i');
    rows = db.prepare(`${sql} GROUP BY a2i.institution_id`).all(...params) as { id: string; n: number }[];
  }
  const map = new Map(rows.map(r => [r.id, r.n]));
  distinctResearchersCache.set(key, map);
  return map;
}

const institutionEntry = (r: InstitutionDbRow & { core_faculty_count: number }): InstitutionEntry => ({
  ...r,
  ...locationDetails(r.location_code),
});

function institutionsFromSummary(f: ListFilters): InstitutionEntry[] {
  const metric = SUMMARY_METRIC[f.metricMode];
  const { ftsQuery, shortTerms } = splitSearchTerms(f.search);
  const params: unknown[] = [];
  const columns = `s.entity_id AS institution_id, MAX(i.display_name) AS institution_name, MAX(i.location_code) AS location_code,
      MAX(i.ror) AS ror, MAX(i.openalex_id) AS openalex_id, SUM(s.${metric}) AS total_fractional_score, SUM(s.paper_count) AS paper_count`;
  let sql = ftsQuery
    ? `SELECT ${columns}, MIN(fts.rank) AS fts_rank FROM institutions_fts fts JOIN performance_summary s ON s.entity_id = fts.inst_id
       LEFT JOIN institutions i ON i.inst_id = s.entity_id WHERE s.entity_type = 'institution' AND fts.institutions_fts MATCH ?`
    : `SELECT ${columns} FROM performance_summary s LEFT JOIN institutions i ON i.inst_id = s.entity_id WHERE s.entity_type = 'institution'`;
  if (ftsQuery) params.push(ftsQuery);
  sql += shortTermFilters(shortTerms, ['i.display_name', 'i.ror', 'i.location_code'], params);
  if (f.locations.length) sql += anyOf("UPPER(COALESCE(i.location_code, ''))", f.locations, params);
  sql += yearRange('s.year', f, params);
  sql += " GROUP BY s.entity_id HAVING MAX(i.display_name) IS NOT NULL AND TRIM(MAX(i.display_name)) <> ''";
  if (f.institutionalThreshold !== undefined) { sql += ` AND ${r9(`SUM(s.${metric})`)} >= ?`; params.push(f.institutionalThreshold); }
  if (f.averageThreshold !== undefined) {
    sql += ` AND ROUND(CAST(SUM(s.${metric}) AS REAL) / NULLIF((
        SELECT COUNT(DISTINCT c.author_id) FROM performance_summary_contributors c
        WHERE c.entity_type = 'institution' AND c.entity_id = s.entity_id${yearRange('c.year', f, params)}), 0), 9) >= ?`;
    params.push(f.averageThreshold);
  }
  sql += ftsQuery ? ` ORDER BY MIN(fts.rank) - SUM(s.${metric}) ASC, s.entity_id` : ` ORDER BY ${r9(`SUM(s.${metric})`)} DESC, s.entity_id`;
  const rows = db.prepare(addPaging(sql, params, f)).all(...params) as InstitutionDbRow[];
  if (!rows.length) return [];
  const researchers = distinctResearchers(f, [], []);
  return rows.map(r => institutionEntry({ ...r, core_faculty_count: researchers.get(r.institution_id) ?? 0 }));
}

function institutionsFromDimension(f: ListFilters): InstitutionEntry[] {
  const dimension = summableDimension(f)!;
  const metric = DIMENSION_METRIC[f.metricMode];
  const params: unknown[] = [dimension.type, ...dimension.values];
  let sql = `
    SELECT d.entity_id AS institution_id, MAX(i.display_name) AS institution_name, MAX(i.location_code) AS location_code,
      MAX(i.ror) AS ror, MAX(i.openalex_id) AS openalex_id, SUM(d.${metric}) AS total_fractional_score, SUM(d.paper_count) AS paper_count
    FROM performance_summary_dimensions d LEFT JOIN institutions i ON i.inst_id = d.entity_id
    WHERE d.entity_type = 'institution' AND d.dimension_type = ? AND d.dimension_value IN (${dimension.values.map(() => '?').join(',')})`;
  sql += yearRange('d.year', f, params);
  sql += " GROUP BY d.entity_id HAVING MAX(i.display_name) IS NOT NULL AND TRIM(MAX(i.display_name)) <> ''";
  if (f.institutionalThreshold !== undefined) { sql += ` AND ${r9(`SUM(d.${metric})`)} >= ?`; params.push(f.institutionalThreshold); }
  sql += ` ORDER BY ${r9(`SUM(d.${metric})`)} DESC, d.entity_id`;
  const rows = db.prepare(addPaging(sql, params, f)).all(...params) as InstitutionDbRow[];
  if (!rows.length) return [];
  const researchers = distinctResearchers(f, f.topics, f.venues);
  return rows.map(r => institutionEntry({ ...r, core_faculty_count: researchers.get(r.institution_id) ?? 0 }));
}

/** The facts each path below starts from: one row per author, institution and paper under the filters. */
function institutionFactFilters(f: ListFilters, ids: string[] | null, shortTerms: readonly string[], params: unknown[]): string {
  let sql = '';
  if (ids) { sql += ' AND a2i.institution_id IN (SELECT value FROM json_each(?))'; params.push(JSON.stringify(ids)); }
  sql += shortTermFilters(shortTerms, ['i.display_name', 'i.ror', 'i.location_code'], params);
  return addFactFilters(sql, params, f, 'a2i', "UPPER(COALESCE(i.location_code, a2i.location_code, ''))");
}

/** With thresholds: an institution counts only the researchers whose own contribution reaches individual_threshold. */
function institutionsWithThresholds(f: ListFilters): InstitutionEntry[] {
  const { ftsQuery, shortTerms } = splitSearchTerms(f.search);
  const ids = searchIds(ftsQuery, 'institutions_fts', 'inst_id');
  if (ids && !ids.length) return [];
  const contribution = f.metricMode === 'total_count' ? 't_score' : f.metricMode === 'frac_count' ? 'f_score' : 'af_score';
  // Aggregates are spelled out wherever they are compared: a bare af_score would also name the column being summed.
  const total = { af_score: 'SUM(r.af_score)', f_score: 'SUM(r.f_score)', t_score: 'COUNT(DISTINCT r.paper_id)' }[contribution];
  const own = { af_score: 'SUM(af_score)', f_score: 'SUM(f_score)', t_score: 'SUM(t_score)' }[contribution];
  const params: unknown[] = [];
  let sql = `
    WITH relationships AS (
      SELECT a2i.institution_id, a2i.author_id, a2i.paper_id, a2i.year, a2i.adjusted_fractional_share AS af_score,
        a2i.fractional_share AS f_score, 1.0 AS t_score, MAX(i.display_name) AS institution_name,
        MAX(COALESCE(i.location_code, a2i.location_code)) AS location_code, MAX(i.ror) AS ror, MAX(i.openalex_id) AS openalex_id
      FROM author_institution_paper_facts a2i LEFT JOIN institutions i ON i.inst_id = a2i.institution_id
      WHERE 1=1${institutionFactFilters(f, ids, shortTerms, params)}
      GROUP BY a2i.institution_id, a2i.author_id, a2i.paper_id
    ),
    qualified AS (
      SELECT institution_id, author_id FROM relationships GROUP BY institution_id, author_id
      HAVING 1=1`;
  if (f.individualThreshold !== undefined) { sql += ` AND ${r9(own)} >= ?`; params.push(f.individualThreshold); }
  sql += `
    )
    SELECT r.institution_id, MAX(r.institution_name) AS institution_name, MAX(r.location_code) AS location_code,
      MAX(r.ror) AS ror, MAX(r.openalex_id) AS openalex_id, COUNT(DISTINCT r.paper_id) AS paper_count,
      ${namedAuthorCount('r.author_id')} AS core_faculty_count,
      SUM(r.af_score) AS af_score, SUM(r.f_score) AS f_score, COUNT(DISTINCT r.paper_id) AS t_score
    FROM relationships r JOIN qualified q ON q.institution_id = r.institution_id AND q.author_id = r.author_id
    GROUP BY r.institution_id
    HAVING MAX(r.institution_name) IS NOT NULL AND TRIM(MAX(r.institution_name)) <> ''`;
  if (f.institutionalThreshold !== undefined) { sql += ` AND ${r9(total)} >= ?`; params.push(f.institutionalThreshold); }
  if (f.averageThreshold !== undefined) {
    sql += ` AND ${r9(`CAST(${total} AS REAL) / NULLIF(${namedAuthorCount('r.author_id')}, 0)`)} >= ?`;
    params.push(f.averageThreshold);
  }
  sql += ` ORDER BY ${r9(total)} DESC, r.institution_id`;
  const rows = db.prepare(addPaging(sql, params, f)).all(...params) as InstitutionThresholdDbRow[];
  return rows.map(row => institutionEntry({
    institution_id: row.institution_id, institution_name: row.institution_name, location_code: row.location_code,
    ror: row.ror, openalex_id: row.openalex_id, total_fractional_score: row[contribution],
    core_faculty_count: row.core_faculty_count, paper_count: row.paper_count,
  }));
}

function institutionsFromFacts(f: ListFilters): InstitutionEntry[] {
  const { ftsQuery, shortTerms } = splitSearchTerms(f.search);
  const ids = searchIds(ftsQuery, 'institutions_fts', 'inst_id');
  if (ids && !ids.length) return [];
  const params: unknown[] = [];
  const sql = `
    SELECT a2i.institution_id AS institution_id, MAX(i.display_name) AS institution_name,
      MAX(COALESCE(i.location_code, a2i.location_code)) AS location_code, MAX(i.ror) AS ror, MAX(i.openalex_id) AS openalex_id,
      ${factMetricExpression(f.metricMode, 'a2i', true)} AS total_fractional_score,
      ${namedAuthorCount('a2i.author_id')} AS core_faculty_count, COUNT(DISTINCT a2i.paper_id) AS paper_count
    FROM author_institution_paper_facts a2i LEFT JOIN institutions i ON i.inst_id = a2i.institution_id
    WHERE 1=1${institutionFactFilters(f, ids, shortTerms, params)}
    GROUP BY a2i.institution_id HAVING MAX(i.display_name) IS NOT NULL AND TRIM(MAX(i.display_name)) <> ''
    ORDER BY ${r9(factMetricExpression(f.metricMode, 'a2i', true))} DESC, a2i.institution_id`;
  return (db.prepare(addPaging(sql, params, f)).all(...params) as Array<InstitutionDbRow & { core_faculty_count: number }>)
    .map(institutionEntry);
}

export const institutionPaths = {
  summary: institutionsFromSummary,
  dimension: institutionsFromDimension,
  threshold: institutionsWithThresholds,
  facts: institutionsFromFacts,
};
export type InstitutionPath = keyof typeof institutionPaths;

export function institutionPath(f: ListFilters): InstitutionPath {
  const thresholds = f.individualThreshold !== undefined || f.institutionalThreshold !== undefined || f.averageThreshold !== undefined;
  const built = summaryBuilt();
  if (built && !f.topics.length && !f.venues.length && !f.platforms.length && !f.paperSet
      && f.individualThreshold === undefined
      && (f.averageThreshold === undefined || hasTable('performance_summary_contributors'))) {
    return 'summary';
  }
  if (built && summableDimension(f) && !f.paperSet && !f.platforms.length && !f.search &&
      f.averageThreshold === undefined && f.individualThreshold === undefined) {
    return 'dimension';
  }
  return thresholds ? 'threshold' : 'facts';
}

export const institutionList = (f: ListFilters): InstitutionEntry[] => institutionPaths[institutionPath(f)](f);

// ---------- researchers ----------

const researcherEntry = (r: ResearcherDbRow): ResearcherEntry => ({ ...r, ...locationDetails(r.location_code), type: 'researcher' });

function researchersFromSummary(f: ListFilters): ResearcherEntry[] {
  const metric = SUMMARY_METRIC[f.metricMode];
  const { ftsQuery, shortTerms } = splitSearchTerms(f.search);
  const params: unknown[] = [];
  const columns = `s.entity_id AS author_id, MAX(a.name) AS author_name, MAX(a.orcid) AS orcid, MAX(a.author_id) AS openalex_id,
      SUM(s.${metric}) AS total_fractional_score, SUM(s.paper_count) AS paper_count, MAX(s.year) AS max_year,
      MAX(a.latest_affiliation) AS latest_affiliation, MAX(a.latest_location_code) AS location_code`;
  let sql = ftsQuery
    ? `SELECT ${columns}, MIN(fts.rank) AS fts_rank FROM authors_fts fts JOIN performance_summary s ON s.entity_id = fts.author_id
       LEFT JOIN authors a ON a.author_id = s.entity_id WHERE s.entity_type = 'researcher' AND fts.authors_fts MATCH ?`
    : `SELECT ${columns} FROM performance_summary s LEFT JOIN authors a ON a.author_id = s.entity_id WHERE s.entity_type = 'researcher'`;
  if (ftsQuery) params.push(ftsQuery);
  sql += shortTermFilters(shortTerms, ['a.name', 'a.orcid'], params);
  sql += yearRange('s.year', f, params);
  if (f.locations.length) sql += anyOf("UPPER(COALESCE(a.latest_location_code, ''))", f.locations, params);
  sql += " GROUP BY s.entity_id HAVING MAX(a.name) IS NOT NULL AND TRIM(MAX(a.name)) <> ''";
  if (f.individualThreshold !== undefined) { sql += ` AND ${r9(`SUM(s.${metric})`)} >= ?`; params.push(f.individualThreshold); }
  sql += ftsQuery ? ` ORDER BY MIN(fts.rank) - SUM(s.${metric}) ASC, s.entity_id` : ` ORDER BY ${r9(`SUM(s.${metric})`)} DESC, s.entity_id`;
  return (db.prepare(addPaging(sql, params, f)).all(...params) as ResearcherDbRow[]).map(researcherEntry);
}

function researchersFromDimension(f: ListFilters): ResearcherEntry[] {
  const dimension = summableDimension(f)!;
  const metric = DIMENSION_METRIC[f.metricMode];
  const params: unknown[] = [dimension.type, ...dimension.values];
  let sql = `
    SELECT d.entity_id AS author_id, MAX(a.name) AS author_name, MAX(a.orcid) AS orcid, MAX(a.author_id) AS openalex_id,
      SUM(d.${metric}) AS total_fractional_score, SUM(d.paper_count) AS paper_count, MAX(d.year) AS max_year,
      MAX(a.latest_affiliation) AS latest_affiliation, MAX(a.latest_location_code) AS location_code
    FROM performance_summary_dimensions d LEFT JOIN authors a ON a.author_id = d.entity_id
    WHERE d.entity_type = 'researcher' AND d.dimension_type = ? AND d.dimension_value IN (${dimension.values.map(() => '?').join(',')})`;
  sql += yearRange('d.year', f, params);
  sql += " GROUP BY d.entity_id HAVING MAX(a.name) IS NOT NULL AND TRIM(MAX(a.name)) <> ''";
  if (f.individualThreshold !== undefined) { sql += ` AND ${r9(`SUM(d.${metric})`)} >= ?`; params.push(f.individualThreshold); }
  sql += ` ORDER BY ${r9(`SUM(d.${metric})`)} DESC, d.entity_id`;
  return (db.prepare(addPaging(sql, params, f)).all(...params) as ResearcherDbRow[]).map(researcherEntry);
}

/** One row per researcher and paper, so a share counts once however many affiliations they list, and papers with no
 * affiliation still count. "None" orders by the same share as Fractional. */
function researchersFromFacts(f: ListFilters): ResearcherEntry[] {
  const { ftsQuery, shortTerms } = splitSearchTerms(f.search);
  const ids = searchIds(ftsQuery, 'authors_fts', 'author_id');
  if (ids && !ids.length) return [];
  const score = f.metricMode === 'total_count' ? 'COUNT(*)' : 'SUM(apf.fractional_share)';
  const params: unknown[] = [];
  let sql = `
    SELECT apf.author_id AS author_id, MAX(auth.name) AS author_name, MAX(auth.orcid) AS orcid, MAX(auth.author_id) AS openalex_id,
      ${score} AS total_fractional_score, COUNT(*) AS paper_count, MAX(f.year) AS max_year,
      MAX(auth.latest_affiliation) AS latest_affiliation, MAX(auth.latest_location_code) AS location_code
    FROM author_paper_facts apf JOIN paper_facts f ON f.paper_id = apf.paper_id JOIN authors auth ON auth.author_id = apf.author_id
    WHERE 1=1${excludePlaceholders('apf.author_id')}`;
  if (ids) { sql += ' AND apf.author_id IN (SELECT value FROM json_each(?))'; params.push(JSON.stringify(ids)); }
  sql += shortTermFilters(shortTerms, ['auth.name', 'auth.orcid'], params);
  sql = addFactFilters(sql, params, f, 'f', "UPPER(COALESCE(auth.latest_location_code, ''))");
  sql += " GROUP BY apf.author_id HAVING MAX(auth.name) IS NOT NULL AND TRIM(MAX(auth.name)) <> ''";
  if (f.individualThreshold !== undefined) { sql += ` AND ${r9(score)} >= ?`; params.push(f.individualThreshold); }
  sql += ` ORDER BY ${r9(score)} DESC, apf.author_id`;
  return (db.prepare(addPaging(sql, params, f)).all(...params) as ResearcherDbRow[]).map(researcherEntry);
}

export const researcherPaths = {
  summary: researchersFromSummary,
  dimension: researchersFromDimension,
  facts: researchersFromFacts,
};
export type ResearcherPath = keyof typeof researcherPaths;

export function researcherPath(f: ListFilters): ResearcherPath {
  const built = summaryBuilt();
  if (built && !f.topics.length && !f.venues.length && !f.platforms.length && !f.paperSet) return 'summary';
  if (built && summableDimension(f) && !f.paperSet && !f.platforms.length && !f.search) return 'dimension';
  return 'facts';
}

export const researcherList = (f: ListFilters): ResearcherEntry[] => researcherPaths[researcherPath(f)](f);
