import { blankChart, decodeSpec, encodeSpec, FORMS, keysOf, type ChartSpec, type Field, type Form } from '../../../shared/chart';

export type Dimension = 'topic' | 'subtopic' | 'platform' | 'venue' | 'region';

const HEATMAP_ROWS: Dimension[] = ['topic', 'subtopic', 'platform', 'venue', 'region'];
const CATEGORY_BY: Dimension[] = ['topic', 'subtopic', 'platform', 'venue', 'region'];
const TRENDS_BY: Dimension[] = ['topic', 'platform', 'venue', 'region'];

/** Only valid pairs are offered: never one dimension twice, and never a subtopic against its own parent level. */
function heatmapColumns(rows: Dimension): Dimension[] {
  return CATEGORY_BY.filter(d => d !== rows && !(d === 'topic' && rows === 'subtopic') && !(d === 'subtopic' && rows === 'topic'));
}

type EntityKind = 'institution' | 'researcher';
export type EntityRef = { kind: EntityKind; id: string };

export type Figure = { id: number; type: 'custom'; vars: ChartSpec; wide?: boolean };
export const MAX_FIGURES = 6;
export const chartChoices = keysOf(FORMS).filter(form => form !== 'dot')
  .map(value => ({ value, label: value === 'bar' ? 'Bar / dot plot' : FORMS[value] }));

let nextId = 1;

export function newChart(form: Form): Figure {
  return { id: nextId++, type: 'custom', vars: blankChart(form) };
}

function decodeValues(value: string, maximum: number): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (Array.isArray(parsed) && parsed.length <= maximum && parsed.every(item => typeof item === 'string' && item.length <= 300)) {
      return [...new Set(parsed)];
    }
  } catch { /* Ignore malformed selections in a shared link. */ }
  return undefined;
}

// Legacy chart links retain their fields, scale, selected series and percentage base.
function readChart(text: string): ChartSpec | null {
  if (text.startsWith('chart.')) return decodeSpec(text.slice(6).split('.'));
  const [type, a, b, c, ...rest] = text.split('.');
  const by = a as Dimension;
  const measure = b === 'papers' || b === 'share';
  if (type === 'heatmap' && HEATMAP_ROWS.includes(by) && heatmapColumns(by).includes(b as Dimension) && (c === 'papers' || c === 'share' || c === 'rowShare')) {
    return { ...blankChart('heatmap'), row: by, split: b as Dimension, value: c === 'share' ? 'seriesShare' : c };
  }
  if (type === 'category' && CATEGORY_BY.includes(by) && measure && (c === 'bar' || c === 'dot')) {
    const comparison = rest[0] as Dimension;
    const series = rest.length === 2 && heatmapColumns(by).includes(comparison) ? decodeValues(rest[1], 2) : undefined;
    return { ...blankChart(c), row: by, split: series ? comparison : '', series, value: series && b === 'share' ? 'seriesShare' : b };
  }
  if (type === 'trends' && TRENDS_BY.includes(by) && measure) {
    return { ...blankChart('line'), row: 'year', split: by, panels: c === 'independent' ? c : 'shared',
      series: rest.length === 1 ? decodeValues(rest[0], 100) : undefined, value: b === 'share' ? 'rowShare' : b };
  }
  return null;
}

export function decodeFigures(values: string[]): Figure[] {
  if (values.includes('none')) return [];
  const figures: Figure[] = [];
  for (const value of values) {
    const wide = value.endsWith('~wide');
    const vars = readChart(wide ? value.slice(0, -5) : value);
    if (vars) figures.push({ id: nextId++, type: 'custom', vars, ...(wide && { wide }) });
    if (figures.length === MAX_FIGURES) break;
  }
  return figures;
}

export function encodeFigures(figures: Figure[]): string[] {
  return figures.map(f => `chart.${encodeSpec(f.vars)}${f.wide ? '~wide' : ''}`);
}

export const FIGURE_GAP = 16;

type FigureSlot = { figure: Figure; width: string };

type LayoutContent = { labels: (dimension: Dimension) => readonly string[]; years: number };

function preferredWidth(figure: Figure, { labels, years }: LayoutContent): number {
  const matrixWidth = (rowLabels: readonly string[], columns: number, shortColumns = false) => {
    const rowWidth = Math.min(320, Math.max(4, ...rowLabels.map(label => label.length)) * 6 + 8);
    return Math.max(400, 36 + rowWidth + (shortColumns ? 45 : 95) * columns);
  };
  const { form, row, split, series, panels } = figure.vars;
  const categoryLabels = (field: Field | '') => CATEGORY_BY.includes(field as Dimension) ? labels(field as Dimension) : [];
  const available = split === 'year' ? years : split === 'reach' ? 3 : categoryLabels(split).length;
  const count = series ? Math.min(available, series.length) : available;
  if (form === 'heatmap') return matrixWidth(categoryLabels(row), count, split === 'year');
  if (form === 'histogram' || (form === 'line' && panels)) return count > 2 ? 580 : 420;
  return count > 6 ? 540 : count > 1 ? 470 : 400;
}

/** Pair adjacent charts only when both fit. Every card keeps its natural height and stays in the saved order. */
export function layoutFigures(figures: Figure[], panelWidth: number, content: LayoutContent): FigureSlot[] {
  const usable = panelWidth - FIGURE_GAP;
  const slots: FigureSlot[] = [];
  for (let i = 0; i < figures.length; i++) {
    const figure = figures[i];
    const next = figures[i + 1];
    if (next && !figure.wide && !next.wide) {
      const firstMin = preferredWidth(figure, content);
      const secondMin = preferredWidth(next, content);
      if (firstMin + secondMin <= usable) {
        const first = Math.max(firstMin, Math.min(Math.floor(usable / 2), usable - secondMin));
        slots.push({ figure, width: `${first}px` }, { figure: next, width: `calc(100% - ${first + FIGURE_GAP}px)` });
        i++;
        continue;
      }
    }
    slots.push({ figure, width: '100%' });
  }
  return slots;
}
