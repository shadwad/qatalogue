import fs from 'fs';
import path from 'path';
import type { Response } from 'express';
import { onDatabaseChange } from './db';
import { publicDirectory } from './paths';

export { projectRoot, publicDirectory, distDirectory } from './paths';

export const validMetricModes = new Set(['none', 'adj_frac_count', 'frac_count', 'total_count']);
type LocationMappingEntry = { name: string; region: string };
// Generated from the data (scripts/build-locations.ts, `make locations`), so a fresh clone does not have it.
const locationMappingPath = process.env.LOCATION_MAPPING_PATH ?? path.join(publicDirectory, 'config', 'location_mapping.json');
export const locationMapping: Record<string, LocationMappingEntry> = Object.create(null);
const locationCodeByName = new Map<string, string>();
const venueIdByName = new Map<string, string>();

function loadLocationMapping(initial: boolean): void {
  let parsed: Record<string, LocationMappingEntry>;
  try {
    parsed = JSON.parse(fs.readFileSync(locationMappingPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message = `${locationMappingPath} is missing or unreadable (${detail}). It is generated from the data: run \`make locations\`, or \`npm run locations -- --all\` before the first build.`;
    if (initial) throw new Error(message);
    console.warn(`Could not reload location mapping (${detail}); keeping previous mapping`);
    return;
  }
  for (const key of Object.keys(locationMapping)) delete locationMapping[key];
  Object.assign(locationMapping, parsed);
  locationCodeByName.clear();
  for (const [code, details] of Object.entries(locationMapping)) {
    locationCodeByName.set(details.name.toUpperCase(), code);
  }
}
loadLocationMapping(true);
onDatabaseChange(() => loadLocationMapping(false));

// The venue list follows the scope of the build being served (finalize_build.py writes it with the database), so it is
// read again whenever the database is replaced.
function loadVenueNames(): void {
  try {
    const venuesCatalog = JSON.parse(
      fs.readFileSync(path.join(publicDirectory, 'config', 'venues.json'), 'utf8'),
    ) as Array<{ name?: string; openalex_id?: string }>;
    venueIdByName.clear();
    for (const venue of venuesCatalog) {
      if (venue.name && venue.openalex_id) venueIdByName.set(venue.name.trim().toUpperCase(), venue.openalex_id);
    }
  } catch {
    // Venue names remain valid filter values when the optional catalog is unavailable.
  }
}
loadVenueNames();
onDatabaseChange(loadVenueNames);

/** A request the client got wrong (bad parameter): answered with 400 and the message. */
export class InputError extends Error {}
/** A feature that cannot work until the pipeline has built its data: answered with 503 and the message. */
export class UnavailableError extends Error {}

/** Answers a failed request: 400 for InputError, 503 for UnavailableError, otherwise a logged 500 without the details. */
export function sendError(res: Response, error: unknown): void {
  if (error instanceof InputError) { res.status(400).json({ error: error.message }); return; }
  if (error instanceof UnavailableError) { res.status(503).json({ error: error.message }); return; }
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
}

export function normalizeLocationFilter(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'UNKNOWN') return '';
  return locationMapping[normalized] ? normalized : (locationCodeByName.get(normalized) ?? normalized);
}

export function locationDetails(code: unknown): { location: string; region: string } {
  const normalizedCode = String(code ?? '').trim().toUpperCase();
  const details = locationMapping[normalizedCode];
  return {
    location: details?.name ?? (normalizedCode || 'Unknown'),
    region: details?.region ?? 'Global',
  };
}

export const round9 = (expression: string) => `ROUND(${expression}, 9)`;

export function queryNumber(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) {
    throw new InputError(`${name} must be an integer between ${min} and ${max}`);
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new InputError(`${name} must be an integer between ${min} and ${max}`);
  }
  return number;
}

export function queryThreshold(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) {
    throw new InputError(`${name} must be a non-negative number`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new InputError(`${name} must be a non-negative number`);
  }
  return number;
}

export function queryId(value: unknown, name: string, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new InputError(`${name} required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new InputError(`${name} must be a string`);
  const trimmed = value.replace(/\0/g, '').trim();
  if (!trimmed) {
    if (required) throw new InputError(`${name} required`);
    return undefined;
  }
  if (trimmed.length > 200) throw new InputError(`Invalid ${name}`);
  return trimmed;
}

export function queryText(value: unknown, name: string, maxLength = 300): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new InputError(`${name} must be a string`);
  const trimmed = value.replace(/\0/g, '').trim().slice(0, maxLength);
  return trimmed || undefined;
}

export function readStringList(value: unknown): string[] {
  if (value === undefined) return [];
  const rawValues = Array.isArray(value) ? value : [value];
  return rawValues
    .flatMap(entry => {
      if (typeof entry !== 'string') throw new InputError('Filter values must be strings');
      return entry.split(',');
    })
    .map(entry => entry.trim())
    .filter(Boolean);
}

/**
 * The location filter's values. Like `readStringList`, but a value that is itself a location name or code is kept whole: some
 * names contain a comma ("Name, Qualifier"), which a plain split would cut in two. Any other value is still read as a
 * comma-separated list, so "US,DE" keeps working.
 */
export function readLocationList(value: unknown): string[] {
  if (value === undefined) return [];
  const rawValues = Array.isArray(value) ? value : [value];
  return rawValues.flatMap(entry => {
    if (typeof entry !== 'string') throw new InputError('Filter values must be strings');
    const text = entry.trim();
    const key = text.toUpperCase();
    return locationMapping[key] || locationCodeByName.has(key) ? [text] : readStringList(text);
  });
}

export function normalizeVenueFilters(values: string[]): string[] {
  return values.map(value => venueIdByName.get(value.trim().toUpperCase()) ?? value);
}

export function splitSearchTerms(searchParam: unknown): { ftsQuery: string; shortTerms: string[] } {
  if (typeof searchParam !== 'string' && typeof searchParam !== 'number') {
    return { ftsQuery: '', shortTerms: [] };
  }
  const words = String(searchParam).replace(/\0/g, '').trim().split(/\s+/).filter(Boolean);
  const longWords: string[] = [];
  const shortTerms: string[] = [];
  for (const word of words) {
    if (Array.from(word).length >= 3) longWords.push(word);
    else shortTerms.push(word.toLowerCase());
  }
  const ftsQuery = longWords.map(word => `"${word.replace(/"/g, '""')}"*`).join(' ');
  return { ftsQuery, shortTerms };
}

export function buildFtsQuery(searchParam: unknown): string {
  if (typeof searchParam !== 'string' && typeof searchParam !== 'number') return '';
  return String(searchParam)
    .replace(/\0/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => `"${word.replace(/"/g, '""')}"*`)
    .join(' ');
}

export function factMetricExpression(metricMode: string | undefined, alias: string = 'a2i', hasAdjustedShare: boolean = true): string {
  switch (metricMode) {
    case 'total_count':
      return `COUNT(DISTINCT ${alias}.paper_id)`;
    case 'frac_count':
      return `SUM(${alias}.fractional_share)`;
    case 'adj_frac_count':
    default:
      return hasAdjustedShare ? `SUM(${alias}.adjusted_fractional_share)` : `SUM(${alias}.fractional_share)`;
  }
}

/** Hardware-platform filter values (ids such as "superconducting"), from `platform`/`platforms`. */
export function readPlatformFilters(query: Record<string, unknown>): string[] {
  return readStringList(query.platform ?? query.platforms);
}

/**
 * Topic, venue and platform filters on a fact table aliased `alias`. Topics are taxonomy ids ("topic" or
 * "topic/subtopic"), platforms are ids from paper_platforms. A paper matches if it carries any of them, or all the
 * parts of a compound value such as "a+b".
 */
export function addFactDimensionFilters(query: string, params: unknown[], topics: string[], venues: string[], alias: string = 'a2i', platforms: string[] = [], hasPlatformsTable: boolean = true) {
  if (platforms.length) {
    if (!hasPlatformsTable) return `${query} AND 1 = 0`;
    query = addAnyOrAll(query, params, platforms, 'paper_platforms', 'pp', 'platform_id', alias);
  }
  query = addAnyOrAll(query, params, topics, 'paper_topics', 'pt', 'topic_id', alias);
  if (venues.length) {
    query += ` AND ${alias}.venue_id IN (${venues.map(() => '?').join(',')})`;
    params.push(...venues);
  }
  return query;
}

/** A compound filter value, "a+b": a paper must have all of its parts. Plain values mean any of them. */
export const isCompoundFilter = (value: string) => value.includes('+');

function addAnyOrAll(query: string, params: unknown[], values: string[], table: string, short: string, column: string, alias: string) {
  if (!values.length) return query;
  const exists = (condition: string) => `EXISTS (SELECT 1 FROM ${table} ${short} WHERE ${short}.paper_id = ${alias}.paper_id AND ${short}.${column} ${condition})`;
  const plain = values.filter(v => !isCompoundFilter(v));
  const parts: string[] = [];
  if (plain.length) {
    parts.push(exists(`IN (${plain.map(() => '?').join(',')})`));
    params.push(...plain);
  }
  for (const compound of values.filter(isCompoundFilter)) {
    const members = compound.split('+').map(m => m.trim()).filter(Boolean);
    if (!members.length) {
      parts.push('1 = 0');
      continue;
    }
    parts.push(`(${members.map(() => exists('= ?')).join(' AND ')})`);
    params.push(...members);
  }
  return parts.length ? `${query} AND (${parts.join(' OR ')})` : query;
}

/** `paper_query` (topic search): the trimmed text, or undefined when absent/too short to search. */
export function readPaperQuery(value: unknown): string | undefined {
  const q = queryText(value, 'paper_query', 300);
  return q && q.length >= 2 ? q : undefined;
}

/** Restrict a fact query to a set of papers (JSON array of ids, from paperSetJson). */
export function addPaperSetFilter(query: string, params: unknown[], paperSet: string | null | undefined, alias: string = 'a2i') {
  if (!paperSet) return query;
  params.push(paperSet);
  return query + ` AND ${alias}.paper_id IN (SELECT value FROM json_each(?))`;
}
