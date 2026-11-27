import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip } from '../ui/Tooltip';
import type { AxisItem } from './useCrosstab';
import { rowLabelWidth, useAxisLabelMetrics, widestLabel } from './useAxisLabelMetrics';

// Above this tint the cell's text switches from the surface ink to the on-primary ink.
const TEXT_FLIP = 0.75;
// Neither ink reaches 4.5:1 inside this band, in either theme, so fills skip it.
const AVOID_BAND = [0.7, 0.85] as const;
// The faintest non-zero cell stays visibly different from an empty one.
const MIN_TINT = 0.12;
const LEGEND_STOPS = 8;

// Allow long headings to wrap at this width. Short headings stay horizontal whenever they fit.
const LEVEL_HEADER_WIDTH = 93;
const MIN_COLUMN_WIDTH = 43;
const CELL_GAP = 2;
const TALL_GRID_ROWS = 12;
const GRID_MAX_HEIGHT = 560;
/** Below this the figure's note and legend stack, and cells get shorter. */
const WIDE_GRID = 620;

/** One hue from the surface to the primary color. Using the theme's colors makes dark mode its own ramp. */
const tint = (t: number) => {
  const inBand = t > AVOID_BAND[0] && t < AVOID_BAND[1];
  const snapped = !inBand ? t : t < TEXT_FLIP ? AVOID_BAND[0] : AVOID_BAND[1];
  return `color-mix(in oklab, var(--primary) ${(snapped * 100).toFixed(1)}%, var(--surface))`;
};

/** Where a value sits on the color ramp, 0 for none. Counts span orders of magnitude, so a square root keeps small ones visible. */
export const gridIntensity = (value: number, max: number, sqrt: boolean) => {
  if (value <= 0 || max <= 0) return 0;
  return MIN_TINT + (1 - MIN_TINT) * (sqrt ? Math.sqrt(value / max) : value / max);
};

interface HeatLegendProps {
  caption: string;
  linear: boolean;
  max: number;
  format: (value: number) => string;
}

export const HeatLegend: React.FC<HeatLegendProps> = ({ caption, linear, max, format }) => {
  const gradient = Array.from({ length: LEGEND_STOPS }, (_, i) =>
    tint(MIN_TINT + (1 - MIN_TINT) * (i / (LEGEND_STOPS - 1)))).join(', ');
  // The value at the midpoint, which a square-root scale places at a quarter of the maximum.
  // Small counts have no whole number there, so the tick is left out.
  const middle = linear ? max / 2 : max >= 4 ? Math.round(max / 4) : null;
  return (
    <figure className="m-0 w-56 max-w-full shrink-0">
      <figcaption className="mb-1.5 text-xs text-on-surface-variant">{caption}</figcaption>
      <div className="h-2.5 rounded-full" style={{ background: `linear-gradient(to right, ${gradient})` }} aria-hidden="true" />
      <div className="mt-1 flex justify-between font-mono text-[11px] text-on-surface-variant">
        <span>{format(0)}</span>
        {middle !== null && <span>{format(middle)}</span>}
        <span>{format(max)}</span>
      </div>
    </figure>
  );
};

interface GridCell {
  text: string;
  /** Position on the color ramp, from gridIntensity. */
  intensity: number;
  tooltip: React.ReactNode;
  /** Absent when the cell has no papers to filter to, so it isn't a button. */
  onSelect?: () => void;
  selectLabel?: string;
}

interface HeatGridProps {
  caption: string;
  rows: AxisItem[];
  rowNote?: (row: AxisItem) => string;
  columns: AxisItem[];
  width: number;
  dimmed: boolean;
  cell: (row: AxisItem, column: AxisItem) => GridCell;
}

/** The grid of tinted cells. Narrow grids scroll sideways and very tall ones downward, inside the card, under fixed labels. */
export const HeatGrid: React.FC<HeatGridProps> = ({ caption, rows, rowNote, columns, width, dimmed, cell }) => {
  const measureLabel = useAxisLabelMetrics();
  const labelWidth = rowLabelWidth(rows, width, measureLabel);
  const gaps = CELL_GAP * (columns.length + 2);
  const cellMax = Math.min(192, Math.max(64, widestLabel(columns, measureLabel) + 12));
  const maxWidth = labelWidth + cellMax * columns.length + gaps;
  const minWidth = labelWidth + MIN_COLUMN_WIDTH * columns.length + gaps;
  const tableWidth = Math.max(minWidth, Math.min(width, maxWidth));
  const available = (tableWidth - labelWidth - gaps) / Math.max(1, columns.length);
  const tall = rows.length > TALL_GRID_ROWS;
  const cellHeight = tall ? 'h-7' : width < WIDE_GRID ? 'h-9' : 'h-11';

  // Fade only the edges with more cells beyond them.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ right: false, bottom: false });
  const measure = useCallback(() => {
    const e = scrollRef.current;
    if (!e) return;
    const next = {
      right: e.scrollLeft + e.clientWidth < e.scrollWidth - 1,
      bottom: e.scrollTop + e.clientHeight < e.scrollHeight - 1,
    };
    setOverflow(previous => (previous.right === next.right && previous.bottom === next.bottom ? previous : next));
  }, []);
  useEffect(() => {
    const e = scrollRef.current;
    if (!e) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(e);
    if (e.firstElementChild) observer.observe(e.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);
  return (
    <div className="relative" style={{ maxWidth }}>
    {overflow.right && <div className="pointer-events-none absolute inset-y-0 right-0 z-[4] w-8" style={{ background: 'linear-gradient(to right, transparent, var(--surface))' }} aria-hidden="true" data-scroll-fade="right" />}
    {overflow.bottom && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[4] h-8" style={{ background: 'linear-gradient(to bottom, transparent, var(--surface))' }} aria-hidden="true" data-scroll-fade="bottom" />}
    <div ref={scrollRef} onScroll={measure} className="overflow-auto" style={tall ? { maxHeight: GRID_MAX_HEIGHT } : undefined} data-heatmap-scroll>
      <table className={`w-full table-fixed border-separate text-xs transition-opacity duration-200 ${dimmed ? 'opacity-60' : ''}`} style={{ minWidth, borderSpacing: CELL_GAP }}>
        <caption className="sr-only">{caption}</caption>
        <colgroup><col style={{ width: labelWidth }} /></colgroup>
        <thead>
          <tr>
            <td className="sticky left-0 top-0 z-[3] bg-surface" />
            {columns.map(c => (
              <th key={c.id} scope="col" className="sticky top-0 z-[2] bg-surface pb-2 align-bottom text-center font-sans text-[11px] font-semibold leading-snug text-on-surface-variant [overflow-wrap:anywhere]">
                {available >= Math.min(LEVEL_HEADER_WIDTH, measureLabel(c.label) + 4)
                  ? c.label
                  : <div className="mx-auto max-h-[160px] text-left leading-tight" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{c.label}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <th scope="row" className="chart-row-label sticky left-0 z-[1] bg-surface pr-2 text-left font-sans text-[11px] font-semibold leading-tight text-on-surface-variant">
                {r.label}
                {rowNote && <span className="block text-[10px] font-normal">{rowNote(r)}</span>}
              </th>
              {columns.map(c => {
                const { text, intensity, tooltip, onSelect, selectLabel } = cell(r, c);
                const look = 'font-mono text-[11px]';
                return (
                  <td key={c.id} className="p-0">
                    <Tooltip contents content={tooltip}>
                      {!onSelect ? (
                        <div className={`flex ${cellHeight} items-center justify-center rounded bg-on-surface/[0.04] ${look} text-on-surface-variant/70`}
                          style={intensity > 0 ? { backgroundColor: tint(intensity), color: intensity >= TEXT_FLIP ? 'var(--on-primary)' : 'var(--on-surface)' } : undefined}>
                          {text}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={onSelect}
                          aria-label={selectLabel}
                          className={`flex ${cellHeight} w-full cursor-pointer items-center justify-center rounded border-none p-0 ${look} outline-none transition-shadow hover:ring-2 hover:ring-on-surface/60 focus-visible:ring-2 focus-visible:ring-on-surface`}
                          style={{ backgroundColor: tint(intensity), color: intensity >= TEXT_FLIP ? 'var(--on-primary)' : 'var(--on-surface)' }}
                        >
                          {text}
                        </button>
                      )}
                    </Tooltip>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
};
