// Field roles and cardinality are shared by the chart editor and the statistics API.
export const CHART_FIELDS = {
  year: { label: 'Publication year', kind: 'ordered', multiple: false },
  topic: { label: 'Topic', kind: 'category', multiple: true },
  subtopic: { label: 'Subtopic', kind: 'category', multiple: true },
  platform: { label: 'Platform', kind: 'category', multiple: true },
  venue: { label: 'Venue', kind: 'category', multiple: false },
  region: { label: 'Region', kind: 'category', multiple: true },
  reach: { label: 'Collaboration reach', kind: 'category', multiple: false },
  authors: { label: 'Authors per paper', kind: 'number', multiple: false },
  institutions: { label: 'Institutions per paper', kind: 'number', multiple: false },
  locations: { label: 'Locations per paper', kind: 'number', multiple: false },
} as const;

export const FORMS = {
  bar: 'Bar chart', dot: 'Dot plot', line: 'Line chart', stack: 'Stacked bars',
  heatmap: 'Heatmap', histogram: 'Histogram', scatter: 'Scatter plot',
} as const;

export const MEASURES = {
  papers: 'Paper count', authors: 'Mean authors per paper', institutions: 'Mean institutions per paper',
  locations: 'Mean locations per paper', share: 'Share of matching papers',
  rowShare: 'Share within row', seriesShare: 'Share within series',
} as const;

export type Field = keyof typeof CHART_FIELDS;
export type Form = keyof typeof FORMS;
export type Metric = keyof typeof MEASURES;
export type NumericField = 'authors' | 'institutions' | 'locations';
export const BIN_WIDTHS = [1, 2, 5, 10] as const;
export type ChartSpec = {
  form: Form; row: Field | ''; split: Field | ''; value: Metric; xMetric: Metric; bin: number;
  series?: string[]; reference?: boolean; panels?: 'shared' | 'independent';
};

/**
 * One character for each form, field, measure and panel setting, used only to shorten shared links (shortLink.ts). Typed as
 * a Record over the lists above, so adding a form, field or measure without choosing its code is a compile error. Keep every
 * code unique within its list and never change one that has shipped: links already shared carry it.
 */
export const FORM_CODES: Record<Form, string> = { bar: '0', dot: '1', line: '2', stack: '3', heatmap: '4', histogram: '5', scatter: '6' };
export const FIELD_CODES: Record<Field, string> = {
  year: '0', topic: '1', subtopic: '2', platform: '3', venue: '4', region: '5', reach: '6', authors: '7', institutions: '8', locations: '9',
};
export const METRIC_CODES: Record<Metric, string> = {
  papers: '0', authors: '1', institutions: '2', locations: '3', share: '4', rowShare: '5', seriesShare: '6',
};
export const PANEL_CODES: Record<NonNullable<ChartSpec['panels']>, string> = { shared: '0', independent: '1' };

export const keysOf = <T extends object>(obj: T) => Object.keys(obj) as (keyof T)[];
export const isField = (s: unknown): s is Field => typeof s === 'string' && Object.hasOwn(CHART_FIELDS, s);
export const isForm = (s: unknown): s is Form => typeof s === 'string' && Object.hasOwn(FORMS, s);
export const isShare = (m: Metric) => m === 'share' || m === 'rowShare' || m === 'seriesShare';
const numericMetrics: Metric[] = ['papers', 'authors', 'institutions', 'locations'];
export const blankChart = (form: Form): ChartSpec => ({ form, row: '', split: '', value: 'papers', xMetric: 'authors', bin: 1 });

export function rowFields(form: Form) {
  return keysOf(CHART_FIELDS).filter(field => {
    const kind = CHART_FIELDS[field].kind;
    if (form === 'histogram') return kind === 'number';
    if (form === 'line') return kind !== 'category';
    return true;
  });
}

export function splitFields(form: Form, row: Field | '') {
  return keysOf(CHART_FIELDS).filter(field => {
    if (field === row || CHART_FIELDS[field].kind === 'number') return false;
    if ((row === 'topic' && field === 'subtopic') || (row === 'subtopic' && field === 'topic')) return false;
    return form !== 'stack' || !CHART_FIELDS[field].multiple;
  });
}

export function scatterMetrics(row: Field | '', bin: number) {
  return numericMetrics.filter(m => bin !== 1 || m !== row);
}

export function measures(form: Form, split: Field | '', row: Field | '' = '', bin = 1): Metric[] {
  if (form === 'scatter') return scatterMetrics(row, bin);
  const result: Metric[] = ['papers', 'share'];
  if (split && form !== 'histogram') result.push('rowShare');
  if (split && form !== 'stack') result.push('seriesShare');
  if (form !== 'stack' && form !== 'histogram') result.push(...numericMetrics.filter(m => m !== 'papers' && (bin !== 1 || m !== row)));
  return result;
}

export function metricLabel(metric: Metric, row: Field | '', split: Field | '') {
  const field = metric === 'rowShare' ? row : metric === 'seriesShare' ? split : '';
  if (!field) return MEASURES[metric];
  if (field === 'reach') return 'Share within each collaboration group';
  if (CHART_FIELDS[field].kind === 'number') return `Share within each group of ${CHART_FIELDS[field].label.toLowerCase()}`;
  return `Share of each ${field === 'year' ? 'year' : CHART_FIELDS[field].label.toLowerCase()}'s papers`;
}

export function supportsReference(spec: ChartSpec) {
  return spec.row === 'year' && (spec.split === 'topic' || spec.split === 'subtopic') && spec.value === 'rowShare';
}

export const needsSplit = (form: Form) => form === 'heatmap' || form === 'stack';

// Keep compatible bindings on edits and on loading old or hand-edited URLs.
export function configureChart(previous: ChartSpec, edit: Partial<ChartSpec>): ChartSpec {
  const next = { ...previous, ...edit };
  // A topic-by-year heatmap can become a year-by-topic line chart. Transpose
  // the percentage base too. A selected subset belongs to its original axis.
  if (edit.form && next.row && next.split && !next.series
    && (!rowFields(next.form).includes(next.row) || !splitFields(next.form, next.row).includes(next.split))
    && rowFields(next.form).includes(next.split) && splitFields(next.form, next.split).includes(next.row)) {
    [next.row, next.split] = [next.split, next.row];
    if (next.value === 'rowShare') next.value = 'seriesShare';
    else if (next.value === 'seriesShare') next.value = 'rowShare';
  }
  if (next.row && !rowFields(next.form).includes(next.row)) next.row = '';
  if (next.split && !splitFields(next.form, next.row).includes(next.split)) next.split = '';
  if (!next.split || next.split !== previous.split) next.series = undefined;
  if (next.form === 'histogram' && next.split && !edit.value && (!previous.split || (edit.form === 'histogram' && previous.form !== 'histogram'))) next.value = 'seriesShare';
  if (!supportsReference(next)) delete next.reference;
  if (!measures(next.form, next.split, next.row, next.bin).includes(next.value)) next.value = 'papers';
  const axes = next.form === 'scatter' ? scatterMetrics(next.row, next.bin) : numericMetrics;
  if (!axes.includes(next.xMetric) || next.xMetric === next.value) {
    next.xMetric = axes.includes(previous.value) && previous.value !== next.value
      ? previous.value : axes.find(metric => metric !== next.value)!;
  }
  return next;
}

export const encodeSeries = (series: string[]) =>
  encodeURIComponent(JSON.stringify(series)).replaceAll('.', '%2E').replaceAll('~', '%7E');

export function encodeSpec(spec: ChartSpec) {
  const parts = [spec.form, spec.row, spec.split, spec.value, spec.xMetric, String(spec.bin), spec.panels ?? ''];
  if (spec.series) parts.push(encodeSeries(spec.series));
  if (spec.reference) {
    if (!spec.series) parts.push('');
    parts.push('reference');
  }
  return parts.join('.');
}

export function decodeSpec(parts: string[]): ChartSpec | null {
  const [form, row, split, value, xMetric, bin, panels, selection] = parts;
  if (!isForm(form) || (row !== '' && !isField(row)) || (split !== '' && !isField(split))) return null;
  if (!Object.hasOwn(MEASURES, value) || !Object.hasOwn(MEASURES, xMetric) || !/^[1-9]\d*$/.test(bin ?? '') || !BIN_WIDTHS.some(n => n === Number(bin))) return null;
  let series: string[] | undefined;
  if (selection) {
    try {
      const parsed: unknown = JSON.parse(decodeURIComponent(selection));
      if (!Array.isArray(parsed) || parsed.length > 200 || !parsed.every(s => typeof s === 'string' && s.length <= 300)) return null;
      series = Array.from(new Set(parsed));
    } catch { return null; }
  }
  const spec: ChartSpec = {
    form, row, split, value: value as Metric, xMetric: xMetric as Metric, bin: Number(bin), series,
    panels: panels === 'shared' || panels === 'independent' ? panels : undefined,
  };
  if (parts[8] === 'reference') spec.reference = true;
  return configureChart(spec, {});
}

export interface ChartCell {
  row: string; col: string; papers: number;
  authors: number | null; institutions: number | null; locations: number | null;
}
export interface ChartData {
  cells: ChartCell[]; rowTotals: Record<string, number>; colTotals: Record<string, number>;
  papers: number; shown: number; platformTagged?: number; taggedByRow?: Record<string, number>;
}

export function chartValue(data: ChartData, cell: ChartCell | undefined, row: string, col: string, metric: Metric): number | null {
  const papers = cell?.papers ?? 0;
  if (metric === 'papers') return papers;
  if (metric === 'authors' || metric === 'institutions' || metric === 'locations') return cell?.[metric] ?? null;
  const base = metric === 'share' ? data.papers : metric === 'rowShare' ? data.rowTotals[row] : data.colTotals[col];
  return base ? papers / base : null;
}

/**
 * Which color slot each shown series gets, so a color follows its series rather than its position: series still shown keep
 * their slots, hidden ones free theirs, and newly shown ones take the lowest free slots in the order given. Showing or
 * hiding one series therefore never repaints the others.
 */
export function assignSeriesSlots(previous: ReadonlyMap<string, number>, shown: readonly string[]): Map<string, number> {
  const next = new Map<string, number>();
  for (const id of shown) {
    const slot = previous.get(id);
    if (slot !== undefined) next.set(id, slot);
  }
  const used = new Set(next.values());
  let free = 0;
  for (const id of shown) {
    if (next.has(id)) continue;
    while (used.has(free)) free++;
    next.set(id, free);
    used.add(free);
  }
  return next;
}

export type PaperGroup = { field: Field; id: string };
export const EVIDENCE_PAGE_SIZE = 25;
export interface EvidencePage {
  total: number;
  papers?: { paper_id: string; title: string; year: number; venue_name: string; doi: string | null }[];
  institutions?: { id: string; name: string; papers: number; ror: string | null }[];
}
