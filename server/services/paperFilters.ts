import { hasTable } from './db';
import {
  queryNumber,
  readLocationList,
  readStringList,
  normalizeVenueFilters,
  readPlatformFilters,
  addFactDimensionFilters,
  readPaperQuery,
  addPaperSetFilter,
  normalizeLocationFilter,
  InputError,
} from './utils';
import { paperSetJson } from './paperSearch';

/** The sidebar filters as they apply to papers: year, topic, platform, venue, location and topic search. */
export interface PaperFilters {
  startYear?: number;
  endYear?: number;
  topics: string[];
  platforms: string[];
  venues: string[];
  locations: string[];
  paperSet: string | null;
}

/** The filters a paper's own record answers: years, topics, platforms and venues. */
export type PaperRecordFilters = Pick<PaperFilters, 'startYear' | 'endYear' | 'topics' | 'platforms' | 'venues'>;

/** Read the years, topics, platforms and venues from a query string. Throws InputError on an invalid year or a start
 * after the end. Synchronous, so the paper search can use it without resolving a topic search (it has no location or
 * topic-search filter). */
export function readPaperRecordFilters(query: Record<string, unknown>): PaperRecordFilters {
  const startYear = queryNumber(query.start_year, 'start_year', 1900, 2100);
  const endYear = queryNumber(query.end_year, 'end_year', 1900, 2100);
  if (startYear !== undefined && endYear !== undefined && startYear > endYear) {
    throw new InputError('start_year must not be greater than end_year');
  }
  return {
    startYear,
    endYear,
    topics: readStringList(query.topic ?? query.topics),
    platforms: readPlatformFilters(query),
    venues: normalizeVenueFilters(readStringList(query.venue ?? query.venues)),
  };
}

/** Read every filter from a query string: the record filters above, the locations, and the topic search resolved to its
 * papers. */
export async function readPaperFilters(query: Record<string, unknown>): Promise<PaperFilters> {
  const recordFilters = readPaperRecordFilters(query);
  const paperQuery = readPaperQuery(query.paper_query);
  return {
    ...recordFilters,
    locations: readLocationList(query.location).map(normalizeLocationFilter),
    paperSet: paperQuery ? await paperSetJson(paperQuery) : null,
  };
}

/**
 * Appends the paper filters to a query over a fact table aliased `alias` (which has `year`, `venue_id` and `paper_id`):
 * years, topics, venues, platforms and topic search, then location. Tables differ in where a location lives, so
 * `location` is either the SQL expression matched against the location codes, or a function given the placeholders
 * ("?,?") that returns the whole condition.
 */
export function addFactFilters(
  sql: string,
  params: unknown[],
  filters: PaperFilters,
  alias: string,
  location: string | ((placeholders: string) => string),
): string {
  if (filters.startYear !== undefined) { sql += ` AND ${alias}.year >= ?`; params.push(filters.startYear); }
  if (filters.endYear !== undefined) { sql += ` AND ${alias}.year <= ?`; params.push(filters.endYear); }
  sql = addFactDimensionFilters(
    sql,
    params,
    filters.topics,
    filters.venues,
    alias,
    filters.platforms,
    filters.platforms.length ? hasTable('paper_platforms') : true,
  );
  sql = addPaperSetFilter(sql, params, filters.paperSet, alias);
  if (filters.locations.length) {
    const placeholders = filters.locations.map(() => '?').join(',');
    sql += typeof location === 'string' ? ` AND ${location} IN (${placeholders})` : ` AND ${location(placeholders)}`;
    params.push(...filters.locations);
  }
  return sql;
}

/**
 * WHERE clause over `paper_facts f`. A paper matches a location if at least one author is affiliated there.
 * `skip` leaves one filter out, for facet counts that show what selecting an item would give.
 */
export function paperFilterWhere(filters: PaperFilters, skip: 'topics' | 'platforms' | 'venues' | 'locations' | null = null) {
  const params: unknown[] = [];
  const applied: PaperFilters = {
    ...filters,
    topics: skip === 'topics' ? [] : filters.topics,
    platforms: skip === 'platforms' ? [] : filters.platforms,
    venues: skip === 'venues' ? [] : filters.venues,
    locations: skip === 'locations' ? [] : filters.locations,
  };
  const hasUnknown = applied.locations.includes('');
  const where = addFactFilters(' WHERE 1=1', params, applied, 'f',
    placeholders => hasUnknown
      ? `f.paper_id IN (SELECT a.paper_id FROM author_institution_paper_facts a LEFT JOIN institutions i ON i.inst_id = a.institution_id
          WHERE UPPER(COALESCE(i.location_code, a.location_code, '')) IN (${placeholders}) OR COALESCE(i.location_code, a.location_code) IS NULL)`
      : `f.paper_id IN (SELECT a.paper_id FROM author_institution_paper_facts a LEFT JOIN institutions i ON i.inst_id = a.institution_id
          WHERE UPPER(COALESCE(i.location_code, a.location_code, '')) IN (${placeholders}))`);
  return { where, params };
}
