/**
 * Explorer state <-> URL query string, so a reload restores the view and a link reproduces it.
 * Only non-default values are written, keeping links short. Unknown or invalid values are ignored.
 *
 *   section=charts  fig=heatmap.topic.platform.papers  fig=trends.region.share  fig=none   (section=statistics, the view's
 *   earlier name, still opens it)
 *   view=researcher  display=network  layout=force  k=500
 *   metric=frac_count  from=2018  to=2024
 *   tmatch=all  pmatch=all (papers must have all the selected topics or platforms, not any)
 *   topic=…&topic=… (taxonomy ids)  platform=…  venue=…  location=…  q=…  scope=papers (q searches paper topics, not names)
 *   imin=0.5 (individual threshold)  inst=10  avg=1.5
 *   sort=institution:asc
 */
import { expandSearch, SHORT_KEYS } from '../../shared/shortLink';
import { decodeFigures, encodeFigures, newChart, type Figure } from '../components/Statistics/figureConfig';
import type { DisplayMode, FilterMatch, MetricMode, NetworkLayout, SearchScope, Section, SortColumn, SortDirection, ViewMode } from '../types';

/** Outer limits for parsing only; the real range comes from the data (/api/meta) and is applied by the explorer. */
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

export interface UrlState {
  section: Section;
  figures: Figure[];
  view: ViewMode;
  display: DisplayMode;
  layout: NetworkLayout;
  k: number;
  metric: MetricMode;
  from: number;
  to: number;
  topics: string[];
  platforms: string[];
  topicMatch: FilterMatch;
  platformMatch: FilterMatch;
  venues: string[];
  locations: string[];
  q: string;
  scope: SearchScope;
  imin: number;
  inst: number;
  avg: number;
  sort: { column: SortColumn; direction: SortDirection };
}

export const defaultMetric = (view: ViewMode): MetricMode => view === 'institution' ? 'adj_frac_count' : 'frac_count';

export const defaultSort = (metric: MetricMode): UrlState['sort'] =>
  metric === 'none' ? { column: 'institution', direction: 'asc' } : { column: 'score', direction: 'desc' };

export const URL_DEFAULTS: UrlState = {
  section: 'explore', figures: [], view: 'institution', display: 'list', layout: 'map', k: 1000 /* = NETWORK_K_DEFAULT (max cap) */, metric: defaultMetric('institution'),
  from: NaN, to: NaN, topics: [], platforms: [], topicMatch: 'any', platformMatch: 'any', venues: [], locations: [], q: '', scope: 'names',
  imin: 0, inst: 0, avg: 0, sort: defaultSort(defaultMetric('institution')),
};

const METRICS: MetricMode[] = ['none', 'adj_frac_count', 'frac_count', 'total_count'];
const SORT_COLUMNS: SortColumn[] = ['institution', 'secondary', 'score'];

const num = (v: string | null, min: number, max: number): number | undefined => {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

let liveSearch: string | null = null;
export const setLiveSearch = (search: string | null) => { liveSearch = search; };
export const getLiveSearch = () => liveSearch;

/** Read state from the current URL, falling back to defaults field by field. */
export function readUrlState(search: string = typeof window !== 'undefined' ? window.location.search : ''): UrlState {
  const p = new URLSearchParams(expandSearch(search)); // a short link ("Copy link") is spelled out first
  const figures = p.getAll('fig');
  const s: UrlState = {
    ...URL_DEFAULTS,
    figures: figures.length ? decodeFigures(figures) : [newChart('bar')],
  };
  // The view is named Charts; links from when it was Statistics still open it.
  if (p.get('section') === 'charts' || p.get('section') === 'statistics') s.section = 'statistics';
  if (p.get('view') === 'researcher') s.view = 'researcher';
  if (p.get('display') === 'network') s.display = 'network';
  if (p.get('layout') === 'force') s.layout = 'force';
  s.k = Math.round(num(p.get('k'), 1, 10000) ?? s.k);
  const metric = p.get('metric') as MetricMode | null;
  s.metric = metric && METRICS.includes(metric) ? metric : defaultMetric(s.view);
  if (s.view === 'researcher' && s.metric === 'adj_frac_count') s.metric = 'frac_count'; // not offered for researchers
  s.sort = defaultSort(s.metric);
  // NaN = "not in the URL": the explorer fills it with the dataset's first/last year.
  const from = num(p.get('from'), YEAR_MIN, YEAR_MAX);
  const to = num(p.get('to'), YEAR_MIN, YEAR_MAX);
  s.from = from === undefined ? NaN : Math.round(from);
  s.to = to === undefined ? NaN : Math.round(to);
  if (s.from > s.to) [s.from, s.to] = [s.to, s.from];
  s.topics = p.getAll('topic').filter(Boolean);
  s.platforms = p.getAll('platform').filter(Boolean);
  if (p.get('tmatch') === 'all') s.topicMatch = 'all';
  if (p.get('pmatch') === 'all') s.platformMatch = 'all';
  s.venues = p.getAll('venue').filter(Boolean);
  s.locations = p.getAll('location').filter(Boolean);
  s.q = p.get('q') ?? '';
  if (p.get('scope') === 'papers') s.scope = 'papers';
  if (s.section === 'statistics' && s.q.trim()) s.scope = 'papers'; // the only search Statistics has, so it is left out of the link
  s.imin = s.metric === 'none' ? 0 : (num(p.get('imin'), 0, 1000) ?? 0);
  s.inst = s.metric === 'none' ? 0 : (num(p.get('inst'), 0, 100000) ?? 0);
  s.avg = s.metric === 'none' ? 0 : (num(p.get('avg'), 0, 1000) ?? 0);
  const [col, dir] = (p.get('sort') ?? '').split(':');
  if (SORT_COLUMNS.includes(col as SortColumn) && (dir === 'asc' || dir === 'desc') && (col !== 'score' || s.metric !== 'none')) {
    s.sort = { column: col as SortColumn, direction: dir };
  }
  return s;
}

/** True when the page was opened with any explorer parameter (i.e. a shared or reloaded query). */
export function hasUrlState(search: string = typeof window !== 'undefined' ? window.location.search : ''): boolean {
  const keys = ['section', 'fig', 'view', 'display', 'layout', 'k', 'metric', 'from', 'to', 'topic', 'platform', 'tmatch', 'pmatch', 'venue', 'location', 'q', 'scope', 'imin', 'inst', 'avg', 'sort', ...SHORT_KEYS];
  const p = new URLSearchParams(search);
  return keys.some(k => p.has(k));
}

/** Build the query string for a state (non-default values only; years are default when they span the data). */
export function toSearch(s: UrlState, yearBounds: { min: number; max: number }): string {
  const p = new URLSearchParams();
  const d = URL_DEFAULTS;
  if (s.section !== d.section) p.set('section', s.section === 'statistics' ? 'charts' : s.section);
  if (s.section === 'statistics') {
    if (s.figures.length === 0) p.set('fig', 'none');
    else encodeFigures(s.figures).forEach(f => p.append('fig', f));
  } else {
    if (s.view !== d.view) p.set('view', s.view);
    if (s.display !== d.display) p.set('display', s.display);
    if (s.display === 'network' && s.view === 'institution' && s.layout !== d.layout) p.set('layout', s.layout);
    const viewCap = s.view === 'institution' ? 500 : 1000;
    if (s.display === 'network' && s.k < viewCap) p.set('k', String(s.k));
    if (s.metric !== defaultMetric(s.view)) p.set('metric', s.metric);
  }
  if (Number.isFinite(s.from) && s.from !== yearBounds.min) p.set('from', String(s.from));
  if (Number.isFinite(s.to) && s.to !== yearBounds.max) p.set('to', String(s.to));
  [...s.topics].sort().forEach(t => p.append('topic', t));
  [...s.platforms].sort().forEach(t => p.append('platform', t));
  if (s.topicMatch === 'all' && s.topics.length >= 2) p.set('tmatch', 'all');
  if (s.platformMatch === 'all' && s.platforms.length >= 2) p.set('pmatch', 'all');
  [...s.venues].sort().forEach(v => p.append('venue', v));
  [...s.locations].sort().forEach(c => p.append('location', c));
  if (s.q.trim()) p.set('q', s.q.trim());
  if (s.section !== 'statistics' && s.scope !== d.scope) p.set('scope', s.scope);
  if (s.section !== 'statistics' && s.metric !== 'none') {
    if (s.imin > 0) p.set('imin', String(+s.imin.toFixed(4)));
    if (s.inst > 0) p.set('inst', String(+s.inst.toFixed(4)));
    if (s.avg > 0) p.set('avg', String(+s.avg.toFixed(4)));
  }
  if (s.section !== 'statistics') {
    const sort = defaultSort(s.metric);
    if (s.sort.column !== sort.column || s.sort.direction !== sort.direction) {
      p.set('sort', `${s.sort.column}:${s.sort.direction}`);
    }
  }
  const str = p.toString();
  return str ? `?${str}` : '';
}
