import { chartValue, CHART_FIELDS, FORMS, isShare, metricLabel as labelForMetric, MEASURES, type ChartCell, type ChartData, type ChartSpec, type Metric } from '../../../shared/chart';
import { gridIntensity, HeatGrid, HeatLegend } from './HeatGrid';
import { DataTable } from './DataTable';
import { EmptyState } from '../ui/EmptyState';
import { CONTROL_FOCUS } from '../ui/Controls';
import type { AxisItem } from './useCrosstab';
import { horizontalTicks, panelLayout } from './plotLayout';
import { useAxisLabelMetrics } from './useAxisLabelMetrics';

interface Props {
  spec: ChartSpec;
  data: ChartData;
  rows: AxisItem[];
  columns: AxisItem[];
  width: number;
  partialYear: number | null;
  table: boolean;
  busy: boolean;
  action: (row: string, col: string) => (() => void) | undefined;
  /** Each series' color slot (assignSeriesSlots), so its color stays when others are shown or hidden. Without it, the
   * series' position. */
  seriesSlot?: (id: string) => number;
}

// Five series colors per theme (index.css; charts show 5 series by default). Further series get rotating hues, which
// can't all be told apart: the legend and the table view carry the identities.
const SERIES_COLORS = ['var(--primary)', 'var(--chart-second)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const color = (i: number) => SERIES_COLORS[i] ?? `hsl(${(i * 137.5) % 360} 58% 46%)`;
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });
const display = (value: number | null, metric: Metric) => value === null ? '–' : (isShare(metric) ? percentFormat : numberFormat).format(value);

export function ChartPlots({ spec, data, rows, columns, width, partialYear, table, busy, action, seriesSlot }: Props) {
  const ink = (c: AxisItem) => color(seriesSlot ? seriesSlot(c.id) : columns.indexOf(c));
  const { form, value: metric, row, split, xMetric } = spec;
  const measureTick = useAxisLabelMetrics('tick', !table && (form === 'line' || form === 'histogram' || form === 'scatter'));
  const cells = new Map<string, Map<string, ChartCell>>();
  for (const cell of data.cells) {
    const series = cells.get(cell.row) ?? new Map<string, ChartCell>();
    series.set(cell.col, cell);
    cells.set(cell.row, series);
  }
  const value = (r: string, c: string, m = metric) => chartValue(data, cells.get(r)?.get(c), r, c, m);
  const label = (r: AxisItem, c: AxisItem) => [r.label, split && c.label].filter(Boolean).join(' · ');
  const activate = (r: string, c: string) => cells.get(r)?.get(c)?.papers ? action(r, c) : undefined;
  if (!row) return null;
  const rowLabel = CHART_FIELDS[row].label;
  const colLabel = split ? CHART_FIELDS[split].label : '';
  const metricLabel = labelForMetric(metric, row, split);
  const showCoverage = form === 'heatmap' && split === 'platform' && !!data.taggedByRow;
  const coverage = (id: string) => {
    const total = data.rowTotals[id] ?? 0;
    const tagged = data.taggedByRow?.[id] ?? 0;
    return total ? `${tagged.toLocaleString()}/${total.toLocaleString()} tagged` : 'No papers';
  };
  const plottable = (r: string, c: string) => cells.get(r)?.has(c) && value(r, c) !== null
    && (form !== 'scatter' || value(r, c, xMetric) !== null);
  const includedColumns = (r: string) => form === 'scatter' ? columns.filter(c => plottable(r, c.id)) : columns;
  const maxValue = (m: Metric) => Math.max(0, ...rows.flatMap(r => includedColumns(r.id).map(c => value(r.id, c.id, m) ?? 0)));
  const maximum = maxValue(metric);

  if (table) {
    const headers = [rowLabel, ...(showCoverage ? ['Platform coverage'] : []), ...(split ? [colLabel] : []), ...(form === 'scatter' ? [MEASURES[xMetric]] : []), metricLabel];
    return <DataTable caption={`${metricLabel} by ${rowLabel.toLowerCase()}`}
      columns={headers.map((header, i) => ({ label: header, numeric: i >= (split ? 2 : 1) + Number(showCoverage) }))}
      rows={rows.flatMap(r => includedColumns(r.id).map(c => {
        const inspect = form === 'heatmap' ? activate(r.id, c.id) : undefined;
        return [
        r.label, ...(showCoverage ? [coverage(r.id)] : []), ...(split ? [c.label] : []), ...(form === 'scatter' ? [display(value(r.id, c.id, xMetric), xMetric)] : []),
        inspect
          ? <button type="button" className={`text-primary underline ${CONTROL_FOCUS}`} onClick={inspect} aria-label={`View papers · ${label(r, c)}`}>{display(value(r.id, c.id), metric)}</button>
          : display(value(r.id, c.id), metric),
        ];
      }))} />;
  }

  const hasValues = rows.some(r => columns.some(c => plottable(r.id, c.id)));
  if (!hasValues) return <EmptyState size="inline">This measure has no values for these papers.</EmptyState>;

  if (form === 'heatmap') {
    const counts = metric === 'papers';
    return <>
      <div className="mb-3"><HeatLegend caption={counts ? 'Paper count (square-root color scale)' : metricLabel} linear={!counts} max={maximum} format={v => display(v, metric)} /></div>
      <HeatGrid caption={`${rowLabel} by ${colLabel}, ${metricLabel}`} rows={rows} rowNote={showCoverage ? r => coverage(r.id) : undefined} columns={columns} width={width} dimmed={busy}
        cell={(r, c) => {
          const v = value(r.id, c.id);
          const tooltip = `${label(r, c)} · ${metricLabel}: ${display(v, metric)}`;
          return { text: display(v, metric), intensity: gridIntensity(v ?? 0, maximum, counts), tooltip, selectLabel: `View papers · ${tooltip}`, onSelect: activate(r.id, c.id) };
        }} />
    </>;
  }

  const legend = split && <ul aria-label="Series" className="mb-3 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs">
    {columns.map(c => <li key={c.id} className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: ink(c) }} />{c.label}</li>)}
  </ul>;

  if (form === 'bar' || form === 'dot' || form === 'stack') {
    const stack = form === 'stack';
    const stackMax = stack ? Math.max(0, ...rows.map(r => columns.reduce((sum, c) => sum + (value(r.id, c.id) ?? 0), 0))) : 0;
    const scale = isShare(metric) ? 1 : (stack ? stackMax : maximum);
    return <>{legend}<div className={`chart-rows max-h-[600px] gap-y-2 overflow-auto pr-1 ${stack ? 'chart-rows-stack' : ''}`}>
      {rows.map(r => (
        <div key={r.id} className="chart-row text-xs">
          <span className="chart-row-label">{r.label}</span>
          <div className={stack ? 'flex min-w-0 items-center bg-on-surface/5' : 'col-span-2 grid grid-cols-subgrid gap-y-1'}>
            {columns.map((c) => {
              const v = value(r.id, c.id);
              const position = `${scale && v !== null ? v / scale * 100 : 0}%`;
              const tooltip = `${label(r, c)} · ${metricLabel}: ${display(v, metric)}`;
              const select = activate(r.id, c.id);
              const Mark = select ? 'button' : 'span';
              if (stack) return v ? <Mark key={c.id} type={select ? 'button' : undefined} aria-label={tooltip} title={tooltip} role={select ? undefined : 'img'} onClick={select}
                className={`${CONTROL_FOCUS} h-5 min-w-0 transition-opacity enabled:cursor-pointer enabled:hover:opacity-75`} style={{ width: position, background: ink(c) }} /> : null;
              return <Mark key={c.id} type={select ? 'button' : undefined} aria-label={tooltip} title={tooltip} role={select ? undefined : 'img'} onClick={select}
                className={`${CONTROL_FOCUS} chart-row rounded-sm py-0.5 transition-colors enabled:cursor-pointer enabled:hover:bg-on-surface/5`}>
                <span className="relative flex h-2.5 rounded-sm bg-on-surface/5">
                  {v !== null && (form === 'bar'
                    ? <span className="h-full rounded-sm" style={{ width: position, background: ink(c) }} />
                    : <span className="absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full" style={{ left: position, background: ink(c) }} />)}
                </span>
                <span className="whitespace-nowrap text-right font-mono">{display(v, metric)}</span>
              </Mark>;
            })}
          </div>
        </div>
      ))}
    </div>{stack && <p className="mt-2 text-right text-xs text-on-surface-variant">Scale 0 to {display(scale, metric)}</p>}</>;
  }

  const facet = (form === 'histogram' || (form === 'line' && spec.panels)) && columns.length > 1;
  const panels = facet ? columns.map(c => [c]) : [columns];
  const minPanelWidth = form === 'line' && rows.length <= 10 ? 236 : 310;
  const { across, panelWidth } = panelLayout(panels.length, width, minPanelWidth, 16);
  const fractions = [0, 0.5, 1];
  const xMaximum = form === 'scatter' ? maxValue(xMetric) : 0;
  const xLabels = form === 'scatter' ? fractions.map(f => display(xMaximum * f, xMetric)) : rows.map(r => r.label);
  const tickWidths = xLabels.map(measureTick);
  const peaks = panels.map(series => spec.panels === 'independent' && form === 'line'
    ? Math.max(0, ...rows.map(r => value(r.id, series[0].id) ?? 0)) : maximum);
  const yLabelWidth = Math.max(0, ...peaks.flatMap(peak => fractions.map(f => measureTick(display(peak * f, metric)))));
  const left = Math.ceil(Math.max(yLabelWidth + 7, (tickWidths[0] ?? 0) / 2 + 2));
  const rightInset = Math.ceil(Math.max(6, (tickWidths.at(-1) ?? 0) / 2 + 2));

  function plot(series: AxisItem[], index: number) {
    const scatter = form === 'scatter';
    const histogram = form === 'histogram';
    const chartWidth = Math.max(panelWidth, left + rightInset + (histogram ? rows.length * 2 : 1));
    const height = facet ? 150 : Math.min(265, Math.max(180, Math.round(panelWidth / 2)));
    const right = chartWidth - rightInset, top = 24, bottom = height - 36;
    const domainMax = peaks[index];
    const y = (v: number) => bottom - (v / (domainMax || 1)) * (bottom - top);
    const x = (v: number) => left + (v / (xMaximum || 1)) * (right - left);
    const binWidth = (right - left) / Math.max(1, rows.length);
    const position = (i: number) => histogram ? left + (i + 0.5) * binWidth : left + (rows.length > 1 ? i / (rows.length - 1) : 0.5) * (right - left);
    const tickX = scatter ? (i: number) => left + fractions[i] * (right - left) : position;
    const plotLabel = `${FORMS[form]}, ${metricLabel} by ${scatter ? MEASURES[xMetric] : rowLabel}`;
    return <div key={series[0]?.id} className={facet ? 'grid min-w-0 row-span-2 grid-rows-subgrid gap-y-1' : 'min-w-0'}>
      {facet && <p className="self-end text-xs font-semibold [overflow-wrap:anywhere]">{series[0].label}</p>}
      <div className="overflow-x-auto">
        <svg width={chartWidth} height={height} role="group" aria-label={plotLabel} className="block font-mono text-[10px] text-on-surface-variant">
          <text x={left} y={12} fill="currentColor">{metricLabel}</text>
          {fractions.map(f => <g key={f}>
            <line x1={left} x2={right} y1={bottom - f * (bottom - top)} y2={bottom - f * (bottom - top)} stroke="var(--outline)" />
            <text x={left - 5} y={bottom - f * (bottom - top) + 3} textAnchor="end" fill="currentColor">{display(domainMax * f, metric)}</text>
          </g>)}
          {horizontalTicks(tickWidths, tickX).map(i => <text key={i} x={tickX(i)} y={bottom + 14} textAnchor="middle" fill="currentColor">{xLabels[i]}</text>)}
          <text x={(left + right) / 2} y={height - 6} textAnchor="middle" fill="currentColor">{scatter ? MEASURES[xMetric] : rowLabel}</text>
          {series.map(c => {
            const stroke = facet ? 'var(--primary)' : ink(c);
            let previous: { x: number; y: number } | null = null;
            return <g key={c.id}>{rows.map((r, i) => {
              const v = value(r.id, c.id);
              const xv = scatter ? value(r.id, c.id, xMetric) : i;
              if (v === null || xv === null || (scatter && !cells.get(r.id)?.has(c.id))) { previous = null; return null; }
              const cx = scatter ? x(xv) : position(i), cy = y(v);
              const start = previous;
              previous = { x: cx, y: cy };
              const partial = (row === 'year' && +r.id === partialYear) || (split === 'year' && +c.id === partialYear);
              const tooltip = [label(r, c), scatter && `${MEASURES[xMetric]}: ${display(xv, xMetric)}`, `${metricLabel}: ${display(v, metric)}`].filter(Boolean).join(' · ');
              const select = activate(r.id, c.id);
              return <g key={r.id}>
                {form === 'line' && start && <line x1={start.x} y1={start.y} x2={cx} y2={cy} stroke={stroke} strokeWidth="2" strokeDasharray={partial ? '4 3' : undefined} />}
                <g role={select ? 'button' : 'img'} tabIndex={select ? 0 : undefined} aria-label={tooltip} onClick={select}
                  onKeyDown={select ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } } : undefined}
                  className={select ? 'cursor-pointer' : undefined}>
                  <title>{tooltip}</title>
                  {histogram ? <rect x={cx - binWidth / 2} width={binWidth >= 4 ? binWidth - 1 : binWidth} y={cy} height={bottom - cy} fill={stroke} />
                    : <circle cx={cx} cy={cy} r={scatter ? 4 : 3} stroke={stroke} fill={partial ? 'var(--surface)' : stroke} />}
                </g>
              </g>;
            })}</g>;
          })}
        </svg>
      </div>
    </div>;
  }
  return <>{!facet && legend}<div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${across}, minmax(0,1fr))` }}>{panels.map(plot)}</div></>;
}
