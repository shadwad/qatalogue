import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ControlSelect } from '../ui/Controls';
import { chartChoices } from './figureConfig';
import { SeriesPicker } from './SeriesPicker';
import { useElementWidth, useIsVisible } from '../../hooks/useElementSize';
import { assignSeriesSlots, BIN_WIDTHS, CHART_FIELDS, configureChart, FORMS, keysOf, MEASURES, measures, metricLabel, needsSplit, scatterMetrics, supportsReference, rowFields, splitFields, type ChartData, type ChartSpec, type Field, type Metric, type PaperGroup } from '../../../shared/chart';
import { ChartPlots } from './ChartPlots';
import { FigureError, FigureFrame, FigureLoading, FigureMessage, FigureSelect, type FigureChrome } from './FigureFrame';
import { platformCoverage, useAxisItems, useFigureStats, usePartialYear, useSelectedYears, type AxisItem } from './useCrosstab';
import type { FigureSelection } from './useFigureSelection';
import { useExplorerContext } from '../../context/ExplorerContext';
import { captureElement, exportDate, filterSummary, imageFileName, prepareImageFonts, saveImage } from '../../lib/imageExport';
import { HelpHint, HintItem } from '../ui/HelpHint';

const reachLabels = { single: 'Single institution', multi: 'Multi-institution', cross: 'Multi-location' };
/** More series than this (of a category) can't be told apart by color (the 5 series colors, index.css), and
 * faceted histograms become a wall of panels. */
const SERIES_LIMIT = 5;
/** A count axis ends where this share of the papers is covered: authors per paper reach the thousands. */
const AXIS_COVERAGE = 0.99;
const countUnits = { authors: 'authors', institutions: 'institutions', locations: 'locations' } as const;
/** Fields whose values can't be set from the sidebar, so a click on their marks can't filter. */
const unfilterable = (field: Field | '') => field === 'reach' || field === 'authors' || field === 'institutions' || field === 'locations';

/**
 * Where a count axis ends: the bin covering AXIS_COVERAGE of the papers, and how many papers lie beyond it. Without it a
 * few huge collaborations would stretch the axis over thousands of nearly empty bins.
 */
function countAxisEnd(totals: Record<string, number>) {
  const bins = Object.entries(totals).map(([start, papers]) => [Number(start), papers] as const).sort((a, b) => a[0] - b[0]);
  const all = bins.reduce((sum, [, papers]) => sum + papers, 0);
  let covered = 0;
  for (const [start, papers] of bins) {
    covered += papers;
    if (covered >= all * AXIS_COVERAGE) return { last: start, beyond: all - covered };
  }
  return { last: bins.at(-1)?.[0] ?? 0, beyond: 0 };
}
const fieldOptions = (fields: Field[]) => fields.map(value => ({ value, label: CHART_FIELDS[value].label }));
const metricOptions = (metrics: Metric[], row: Field | '' = '', split: Field | '' = '') =>
  metrics.map(value => ({ value, label: metricLabel(value, row, split) }));

function axisItems(field: Field | '', totals: Record<string, number>, bin: number, years: number[], categories: ReturnType<typeof useAxisItems>, last?: number): AxisItem[] {
  switch (field) {
    case '': return [{ id: '', label: 'All matching papers' }];
    case 'year': return years.map(y => ({ id: String(y), label: String(y) }));
    case 'reach': return keysOf(reachLabels).map(id => ({ id, label: reachLabels[id] }));
    case 'authors': case 'institutions': case 'locations': {
      const max = last ?? Math.max(0, ...Object.keys(totals).map(Number));
      const items: AxisItem[] = [];
      for (let start = 1; start <= max; start += bin) {
        items.push({ id: String(start), label: bin === 1 ? String(start) : `${start}–${start + bin - 1}` });
      }
      return items;
    }
    default: return categories(field);
  }
}

interface CustomChartProps extends FigureChrome {
  vars: ChartSpec;
  onChange: (spec: ChartSpec) => void;
}

export const CustomChart: React.FC<CustomChartProps> = ({ vars, onChange, onSelect, onInspect, ...chrome }) => {
  const ref = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(bodyRef);
  const visible = useIsVisible(ref);
  const [table, setTable] = useState(false);
  const { form, row, split, value, bin, xMetric } = vars;
  const categories = useAxisItems();
  const years = useSelectedYears();
  const partialYear = usePartialYear();
  const ready = !!row && (!needsSplit(form) || !!split);
  const numericRow = row && CHART_FIELDS[row].kind === 'number';
  const { data, error, isFetching, refetch } = useFigureStats<ChartData>('chart', { row, split, bin: String(numericRow ? bin : 1), ...(vars.reference ? { reference: '1' } : {}) }, ready && visible);
  const axisEnd = numericRow && data ? countAxisEnd(data.rowTotals) : undefined;
  const rows = axisItems(row, data?.rowTotals ?? {}, bin, years, categories, axisEnd?.last);
  const available = axisItems(split, data?.colTotals ?? {}, 1, years, categories);
  // Many categories as series (57 subtopics, say) start as the largest few; the picker can show any or all.
  const capped = !vars.series && !!data && form !== 'heatmap' && !!split && CHART_FIELDS[split].kind === 'category' && available.length > SERIES_LIMIT;
  const shownSeries = vars.series ?? (capped
    ? [...available].sort((a, b) => (data!.colTotals[b.id] ?? 0) - (data!.colTotals[a.id] ?? 0)).slice(0, SERIES_LIMIT).map(item => item.id)
    : undefined);
  const shownSet = shownSeries ? new Set(shownSeries) : null;
  const columns = shownSet ? available.filter(c => shownSet.has(c.id)) : available;
  // Colors follow the series: each keeps its slot while shown, so showing or hiding one never repaints the others. The
  // slots start over when the series field changes (other entities). Kept from the last committed render.
  const slotsRef = useRef<{ split: Field | ''; slots: ReadonlyMap<string, number> }>({ split, slots: new Map() });
  const shownKey = columns.map(c => c.id).join('\u0000');
  // Only once the data is in: until then every series counts as shown (the largest few aren't known yet), and handing them
  // all slots would leave the survivors with slots past the palette.
  const slots = useMemo(
    () => data ? assignSeriesSlots(slotsRef.current.split === split ? slotsRef.current.slots : new Map(), columns.map(c => c.id)) : slotsRef.current.slots,
    [shownKey, split, !!data],
  );
  useEffect(() => { slotsRef.current = { split, slots }; }, [split, slots]);
  const edit = (change: Partial<ChartSpec>) => onChange(configureChart(vars, change));
  const rowLabel = row ? CHART_FIELDS[row].label : '';
  const splitLabel = split ? CHART_FIELDS[split].label : '';
  const groupRole = form === 'scatter' ? 'One point per' : form === 'heatmap' ? 'Rows' : form === 'histogram' ? 'Variable' : form === 'line' ? 'Horizontal axis' : 'Group by';
  const splitRole = form === 'heatmap' ? 'Columns' : form === 'stack' ? 'Stack by' : 'Series';
  const grouping = [rowLabel, splitLabel].filter(Boolean).join(' and ').toLowerCase();
  const title = !ready ? FORMS[form] : form === 'scatter'
    ? `${MEASURES[value]} vs. ${MEASURES[xMetric].toLowerCase()}`
    : `${value === 'rowShare' || value === 'seriesShare' ? 'Paper share' : MEASURES[value]} by ${grouping}`;

  // A mark filters only when the shared sidebar can express every field it represents.
  const rowLabelById = new Map(rows.map(item => [item.id, item.label]));
  const columnLabelById = new Map(columns.map(item => [item.id, item.label]));
  const filterAction = (r: string, c: string) => {
    const label = [rowLabelById.get(r), split ? columnLabelById.get(c) : undefined].filter(Boolean).join(' · ');
    const selection: FigureSelection = { values: [], label };
    for (const [field, id] of [[row, r], [split, c]] as const) {
      if (!field) continue;
      if (field === 'year') selection.year = Number(id);
      else if (field === 'reach' || field === 'authors' || field === 'institutions' || field === 'locations') return undefined;
      else selection.values.push({ dimension: field, id });
    }
    return () => onSelect(selection);
  };

  const markAction = (r: string, c: string) => {
    const filter = filterAction(r, c);
    if (form !== 'heatmap' || !onInspect || !row || !split) return filter;
    const groups: PaperGroup[] = [{ field: row, id: r }, { field: split, id: c }];
    const title = [rowLabelById.get(r), columnLabelById.get(c)].join(' · ');
    return () => onInspect({ title, groups, bin, applyFilters: filter });
  };

  const body = () => {
    if (!ready) return null;
    if (error) return <FigureError onRetry={() => refetch()} retrying={isFetching} />;
    if (!data) return <FigureLoading />;
    if (!data.papers) return <FigureMessage>No papers match these filters.</FigureMessage>;
    if (!data.shown) return <FigureMessage>{data.platformTagged === 0 ? platformCoverage(0, data.papers) : `None of the matching papers have values for ${grouping || 'the chosen fields'}.`}</FigureMessage>;
    if (!columns.length) return <FigureMessage>{vars.series?.length === 0
      ? `No ${form === 'heatmap' ? 'columns' : 'series'} are selected. Choose some under ${form === 'heatmap' ? 'Visible columns' : 'Visible series'}.`
      : `None of the chosen ${form === 'heatmap' ? 'columns' : 'series'} have papers here.`}</FigureMessage>;
    const usesMean = (m: Metric) => m === 'authors' || m === 'locations' || m === 'institutions';
    // Below the chart: facts about this chart's data (what it leaves out, and why).
    const notes: string[] = [];
    if (data.platformTagged !== undefined) notes.push(platformCoverage(data.platformTagged, data.papers));
    if (data.shown < data.papers && data.shown !== data.platformTagged) {
      notes.push(`${data.shown.toLocaleString()} of ${data.papers.toLocaleString()} papers have the grouping fields.`);
    }
    if (axisEnd && axisEnd.beyond > 0 && (row === 'authors' || row === 'institutions' || row === 'locations')) {
      notes.push(`${axisEnd.beyond.toLocaleString()} ${axisEnd.beyond === 1 ? 'paper has' : 'papers have'} more than ${(axisEnd.last + bin - 1).toLocaleString()} ${countUnits[row]} and ${axisEnd.beyond === 1 ? 'is' : 'are'} off the axis.`);
    }
    if (capped) notes.push(`Showing the ${SERIES_LIMIT} largest of ${available.length} ${splitLabel.toLowerCase()}s; choose others under Visible series.`);
    // Beside the title, on demand: how to read this kind of chart.
    const help: { term: string; text: string }[] = [];
    const overlapping = [row, split].filter(f => f && CHART_FIELDS[f].multiple).map(f => CHART_FIELDS[f as Field].label.toLowerCase());
    if (overlapping.length) help.push({ term: 'Overlapping groups', text: `A paper with several ${overlapping.map(f => `${f}s`).join(' or ')} counts in each of them, so the groups can add up to more than the papers.` });
    if (usesMean(value) || (form === 'scatter' && usesMean(xMetric))) help.push({ term: 'Means', text: 'Averages leave out papers where the value is missing.' });
    if (form === 'heatmap') help.push({ term: 'Color', text: value === 'papers' ? 'Darker cells hold more papers. The scale is a square root, so small counts stay visible beside large ones.' : 'Darker cells hold higher values, on a linear scale.' });
    if ((form === 'line' || form === 'scatter') && partialYear !== null && (row === 'year' || split === 'year')) {
      help.push({ term: `${partialYear}`, text: `Hollow points${form === 'line' ? ' and dashed lines' : ''} mark ${partialYear}, which isn't over yet.` });
    }
    if (form === 'heatmap' && onInspect) {
      help.push({
        term: 'Clicking a cell',
        text: !unfilterable(row) && !unfilterable(split)
          ? 'Lists its papers, from where you can filter every chart to them.'
          : 'Lists its papers and institutions.',
      });
    } else if (!unfilterable(row) && !unfilterable(split)) {
      help.push({ term: 'Clicking a mark', text: 'Shows only it in every chart, by setting the filters. Undo, above the charts, brings the rest back.' });
    }
    return <>
      <div className="mb-2 flex items-center gap-1">
        <h2 className="m-0 font-display text-sm font-bold">{title}</h2>
        {help.length > 0 && <HelpHint label={`How to read ${title}`} align="left">
          {help.map((item, i) => <HintItem key={item.term} term={item.term} last={i === help.length - 1}>{item.text}</HintItem>)}
        </HelpHint>}
      </div>
      {width > 0 && <ChartPlots spec={vars} data={data} rows={rows} columns={columns} width={width}
        partialYear={partialYear} table={table} busy={isFetching} action={markAction} seriesSlot={id => slots.get(id) ?? 0} />}
      {notes.length > 0 && <p className="mt-2 text-xs text-on-surface-variant">{notes.join(' ')}</p>}
    </>;
  };
  // The image is the chart as shown: its title, marks and notes, with the filters and date in a caption below.
  const { startYear, endYear, selectedTopics, selectedPlatforms, topicFilter, platformFilter, topicName, platformName, selectedVenues, selectedLocations, paperQuery } = useExplorerContext();
  const canSave = ready && !!data && !error && !isFetching && data.papers > 0 && data.shown > 0 && columns.length > 0 && width > 0;
  const save = async () => {
    const node = bodyRef.current;
    if (!node || !data) return;
    const style = getComputedStyle(node);
    const surface = style.getPropertyValue('--surface').trim();
    const ink = style.getPropertyValue('--on-surface').trim();
    const scale = Math.max(2, window.devicePixelRatio || 1);
    const image = await captureElement(node, { scale, background: surface });
    const filters = filterSummary({
      startYear, endYear,
      topics: selectedTopics.map(topicName), topicsMatchAll: !!topicFilter[0]?.includes('+'),
      platforms: selectedPlatforms.map(platformName), platformsMatchAll: !!platformFilter[0]?.includes('+'),
      venues: selectedVenues, locations: selectedLocations, paperQuery,
    });
    await saveImage(image, {
      scale, margin: 16, surface, ink, fileName: imageFileName(title),
      caption: {
        headline: `${data.papers.toLocaleString()} matching ${data.papers === 1 ? 'paper' : 'papers'}`,
        detail: `${filters} · Exported ${exportDate()}`,
      },
    });
  };
  const download = { save: canSave ? save : undefined, prepare: () => { if (bodyRef.current) prepareImageFonts(bodyRef.current).catch(() => {}); } };

  return <FigureFrame ref={ref} {...chrome} title={title} download={download}
    typeControl={<ControlSelect aria-label="Chart type" value={form === 'dot' ? 'bar' : form}
      className="font-semibold"
      onChange={e => edit({ form: e.target.value as ChartSpec['form'] })}>
      {chartChoices.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
    </ControlSelect>}
    isTable={table} onToggleTable={() => setTable(on => !on)} controls={<>
      {(form === 'bar' || form === 'dot') && <FigureSelect label="Marks" value={form} onChange={next => edit({ form: next })}
        options={[{ value: 'bar', label: 'Bars' }, { value: 'dot', label: 'Dots' }]} />}
      <FigureSelect<Field | ''> required label={groupRole} value={row} onChange={next => edit({ row: next })}
        options={[{ value: '', label: 'Choose field…' }, ...fieldOptions(rowFields(form))]} />
      <FigureSelect<Field | ''> required={needsSplit(form)} label={splitRole} value={split} onChange={next => edit({ split: next })}
        options={[{ value: '', label: needsSplit(form) ? 'Choose field…' : 'None' }, ...fieldOptions(splitFields(form, row))]} />
      {split && (available.length > 1 || vars.series !== undefined) && (
        <SeriesPicker label={form === 'heatmap' ? 'Visible columns' : 'Visible series'}
          available={available} selected={shownSeries}
          // "Select all" means all, not back to the largest few.
          onChange={series => edit({ series: series ?? (capped ? available.map(item => item.id) : undefined) })} />
      )}
      {form === 'scatter' && <FigureSelect<Metric> label="X measure" value={xMetric} onChange={next => edit({ xMetric: next })}
        options={metricOptions(scatterMetrics(row, bin).filter(m => m !== value))} />}
      <FigureSelect<Metric> label={form === 'scatter' ? 'Y measure' : 'Measure'} value={value} onChange={next => edit({ value: next })}
        options={metricOptions(measures(form, split, row, bin), row, split)} />
      {supportsReference(vars) && <FigureSelect label="Annual baseline" value={vars.reference ? 'reference' : 'filtered'}
        onChange={base => edit({ reference: base === 'reference' || undefined })}
        options={[{ value: 'filtered', label: 'All active filters' }, { value: 'reference', label: 'Before topic selections' }]} />}
      {numericRow && <FigureSelect label="Bin width" value={String(bin)} onChange={n => edit({ bin: Number(n) })}
        options={BIN_WIDTHS.map(n => ({ value: String(n), label: String(n) }))} />}
      {form === 'line' && split && <FigureSelect<'combined' | 'shared' | 'independent'> label="Panels" value={vars.panels ?? 'combined'}
        onChange={panels => edit({ panels: panels === 'combined' ? undefined : panels })}
        options={[{ value: 'combined', label: 'One plot' }, { value: 'shared', label: 'Separate, shared scale' }, { value: 'independent', label: 'Separate, individual scales' }]} />}
    </>}>
    <div ref={bodyRef} className="min-w-0 w-full">{body()}</div>
  </FigureFrame>;
};
