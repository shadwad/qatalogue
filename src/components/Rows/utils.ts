import type { MetricMode, Paper, ViewMode } from '../../types';

export const ROW_NUMBER_CLASS = '-ml-1 pr-[var(--list-number-gutter)] text-left font-mono text-xs font-normal tabular-nums text-on-surface-variant md:-ml-2';

/**
 * The list's grid tracks. They follow the width of the results area (the `results` container in App.tsx), not the
 * window's, so the columns adapt when the filters sidebar is docked beside them: the compact two-column layout below
 * 42rem, the full columns above, wider ones from 64rem. ListHeader uses the same tracks.
 *
 * A researcher's affiliation gets more room on desktop, up to 30% of the row so names keep theirs in a narrow window.
 * Location names are short and don't need it.
 */
export const listColumns = (viewMode: ViewMode, hasScore: boolean) => {
  const compact = 'grid-cols-[var(--list-number-width)_minmax(0,1fr)]';
  const wide = hasScore
    ? '@2xl/results:grid-cols-[var(--list-number-width)_minmax(0,1fr)_minmax(120px,150px)_100px] @5xl/results:grid-cols-[var(--list-number-width)_minmax(0,1fr)_minmax(150px,250px)_120px]'
    : '@2xl/results:grid-cols-[var(--list-number-width)_minmax(0,1fr)_minmax(120px,150px)] @5xl/results:grid-cols-[var(--list-number-width)_minmax(0,1fr)_minmax(150px,250px)]';
  if (viewMode === 'institution') return `${compact} ${wide}`;
  const affiliation = hasScore
    ? '@3xl/results:grid-cols-[var(--list-number-width)_minmax(0,1fr)_minmax(120px,min(30%,250px))_100px]'
    : '@3xl/results:grid-cols-[var(--list-number-width)_minmax(0,1fr)_minmax(120px,min(30%,250px))]';
  return `${compact} ${wide} ${affiliation}`;
};

export class BoundedCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (Date.now() >= hit.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.maxSize <= 0) return;
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxSize) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

const DETAIL_CACHE_MAX = 300;
const DETAIL_CACHE_TTL_MS = 10 * 60 * 1000;
export const detailCache = new BoundedCache<unknown>(DETAIL_CACHE_MAX, DETAIL_CACHE_TTL_MS);

let lastGeneratedAt: string | undefined;

export function syncDetailCacheGeneration(generatedAt: string | undefined): void {
  if (!generatedAt) return;
  if (lastGeneratedAt !== undefined && lastGeneratedAt !== generatedAt) {
    detailCache.clear();
  }
  lastGeneratedAt = generatedAt;
}

export async function fetchDetail<T>(url: URL, signal: AbortSignal): Promise<T> {
  const cacheKey = url.toString();
  const cached = detailCache.get(cacheKey);
  if (cached !== undefined) return cached as T;
  const response = await fetch(cacheKey, { signal });
  if (!response.ok) throw new Error(`HTTP error ${response.status}`);
  const json = (await response.json()) as T;
  detailCache.set(cacheKey, json);
  return json;
}

const appendFilterParams = (url: URL, key: string, values: readonly string[] = []) => {
  values.forEach(value => {
    if (value) url.searchParams.append(key, value);
  });
};

export interface DetailFilterParams {
  metricMode: MetricMode;
  startYear: number | undefined;
  endYear: number | undefined;
  facultyMinContribution: number;
  topicFilter: readonly string[];
  platformFilter: readonly string[];
  selectedVenues: readonly string[];
  selectedLocations: readonly string[];
  paperQuery: string;
}

export function buildDetailUrl(
  endpoint: string,
  entityParams: Record<string, string | undefined>,
  filters: DetailFilterParams,
  includeLocations: boolean,
  origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
): URL {
  const url = new URL(endpoint, origin);
  for (const [key, value] of Object.entries(entityParams)) {
    if (value) url.searchParams.set(key, value);
  }
  url.searchParams.set('metric_mode', filters.metricMode);
  // Only the researchers an institution counts are thresholded by the server; the other detail routes ignore thresholds.
  if (endpoint === '/api/faculty') url.searchParams.set('individual_threshold', String(filters.facultyMinContribution));
  if (filters.startYear !== undefined) url.searchParams.set('start_year', String(filters.startYear));
  if (filters.endYear !== undefined) url.searchParams.set('end_year', String(filters.endYear));
  appendFilterParams(url, 'topic', filters.topicFilter);
  appendFilterParams(url, 'platform', filters.platformFilter);
  appendFilterParams(url, 'venue', [...filters.selectedVenues].sort());
  if (filters.paperQuery) url.searchParams.set('paper_query', filters.paperQuery);
  if (includeLocations) appendFilterParams(url, 'location', [...filters.selectedLocations].sort());
  return url;
}

export function detailFilterSignature(filters: DetailFilterParams, includeLocations: boolean): string {
  return JSON.stringify([
    filters.metricMode,
    filters.startYear ?? null,
    filters.endYear ?? null,
    includeLocations ? filters.facultyMinContribution : 0,
    filters.topicFilter,
    filters.platformFilter,
    [...filters.selectedVenues].sort(),
    includeLocations ? [...filters.selectedLocations].sort() : null,
    filters.paperQuery || '',
  ]);
}

export function getInstitutionLink(institution: {
  ror?: string | null;
  openalex_id?: string | null;
  institution_id?: string | null;
} | null | undefined): string | null {
  if (!institution) return null;
  if (institution.ror) return `https://ror.org/${institution.ror}`;
  if (institution.openalex_id && !institution.openalex_id.startsWith('NO_INST_')) {
    return `https://openalex.org/${institution.openalex_id}`;
  }
  if (institution.institution_id?.startsWith('I')) {
    return `https://openalex.org/${institution.institution_id}`;
  }
  return null;
}

export function getAuthorLink(author: {
  orcid?: string | null;
  openalex_id?: string | null;
  author_id?: string | null;
} | null | undefined): string | null {
  if (!author) return null;
  if (author.orcid) return `https://orcid.org/${author.orcid}`;
  if (author.openalex_id && !author.openalex_id.startsWith('NO_ID_')) {
    return `https://openalex.org/${author.openalex_id}`;
  }
  if (author.author_id?.startsWith('A')) {
    return `https://openalex.org/${author.author_id}`;
  }
  return null;
}

export const metricShortPrefix = (metricMode: MetricMode): string =>
  metricMode === 'adj_frac_count' ? 'AF' : metricMode === 'frac_count' ? 'F' : 'T';

export function paperMetricScore(paper: Paper, metricMode: MetricMode): number {
  if (metricMode === 'total_count') return 1;
  if (metricMode === 'frac_count') {
    return paper.canonical_author_count ? 1 / paper.canonical_author_count : paper.score_share;
  }
  return paper.score_share;
}
