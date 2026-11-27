import React, { forwardRef, useState } from 'react';
import { LoadFailure } from '../ui/LoadFailure';
import { ArrowDown, ArrowUp, Download, FoldHorizontal, Maximize2, Minimize2, Table2, UnfoldHorizontal, X } from 'lucide-react';
import { ControlSelect, SEGMENT_ACTIVE, SEGMENT_BUTTON, SEGMENT_GROUP, SEGMENT_INACTIVE } from '../ui/Controls';
import { Tooltip } from '../ui/Tooltip';
import type { EvidenceSelection } from './PaperEvidence';
import type { FigureSelection } from './useFigureSelection';
import { Shimmer } from '../ui/Shimmer';
import { LOADING } from '../../lib/messages';
import { EmptyState } from '../ui/EmptyState';

/** What every figure receives from the page. */
export interface FigureChrome {
  onClose: () => void;
  onInspect?: (selection: EvidenceSelection) => void;
  /** Absent when this is the only figure, since it already fills the panel. */
  onToggleExpand?: () => void;
  isExpanded: boolean;
  layout?: { wide: boolean; onToggleWide: () => void; onEarlier?: () => void; onLater?: () => void };
  /** Sets the sidebar filters to what was clicked. */
  onSelect: (selection: FigureSelection) => void;
}

interface FigureFrameProps extends Omit<FigureChrome, 'onSelect'> {
  /** States the current variables, which tells two copies of a type apart. */
  title: string;
  typeControl?: React.ReactNode;
  controls: React.ReactNode;
  isTable: boolean;
  onToggleTable: () => void;
  /** Present on cards that can be saved as an image. */
  download?: {
    /** Saves what the card shows. Absent until there is something to save. */
    save?: () => Promise<void>;
    /** Starts the slow part early, when the pointer or focus reaches the button. */
    prepare: () => void;
  };
  children: React.ReactNode;
}

const ICON_BUTTON = `${SEGMENT_BUTTON} h-7 w-7 ${SEGMENT_INACTIVE} aria-pressed:bg-on-surface/10 aria-pressed:text-on-surface`;
export const FIGURE_CONTROL_LABEL = 'flex max-w-full items-center gap-1.5 text-xs text-on-surface-variant';

/** The card around a figure: its label, variable controls, and expand and close buttons. */
export const FigureFrame = forwardRef<HTMLElement, FigureFrameProps>(({ title, typeControl, controls, isTable, onToggleTable, download, children, onClose, onToggleExpand, isExpanded, layout }, ref) => {
  const [saving, setSaving] = useState<'idle' | 'working' | 'failed'>('idle');
  const save = download?.save;
  const onSave = async () => {
    if (!save || saving === 'working') return;
    setSaving('working');
    try {
      await save();
      setSaving('idle');
    } catch (error) {
      console.error(error);
      setSaving('failed');
    }
  };
  const canSave = !!save && saving !== 'working';
  return (
  <section ref={ref} aria-label={title} className="flex min-w-0 flex-col rounded-xl border border-outline bg-surface p-3 md:p-4">
    <header className="flex flex-wrap items-center justify-between gap-2">
      {typeControl ?? <div className="min-w-0 flex-1">
        <h2 className="m-0 font-display text-sm font-bold text-on-surface">{title}</h2>
      </div>}
      <div className="ml-auto flex shrink-0 items-center gap-2">
      {/* Status sits to the left, so the buttons keep their place. */}
      <span role="status" className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
        {saving === 'working' ? <Shimmer>{LOADING.image}</Shimmer> : saving === 'failed' && !isTable ? 'The image could not save' : null}
      </span>
      <div role="group" aria-label="Window controls" className={`${SEGMENT_GROUP} shrink-0`}>
        {layout?.onEarlier && (
          <Tooltip contents content="Move chart earlier">
            <button type="button" onClick={layout.onEarlier} aria-label={`Move ${title} earlier`} className={ICON_BUTTON}>
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        )}
        {layout?.onLater && (
          <Tooltip contents content="Move chart later">
            <button type="button" onClick={layout.onLater} aria-label={`Move ${title} later`} className={ICON_BUTTON}>
              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        )}
        {layout && (
          <Tooltip contents content={layout.wide ? 'Use automatic width' : 'Use full row'}>
            <button type="button" onClick={layout.onToggleWide}
              aria-label={`${layout.wide ? 'Use automatic width for' : 'Use full row for'} ${title}`} className={ICON_BUTTON}>
              {layout.wide ? <FoldHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> : <UnfoldHorizontal className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          </Tooltip>
        )}
        {download && !isTable && (
          <Tooltip contents content={!save ? 'Download as PNG once the chart has data' : saving === 'failed' ? 'Try the download again' : 'Download chart as PNG'}>
            <button type="button" onClick={onSave} onPointerEnter={download.prepare} onFocus={download.prepare}
              aria-label={`Download ${title} as a PNG image`} aria-disabled={!canSave} aria-busy={saving === 'working'}
              className={`${ICON_BUTTON} aria-disabled:cursor-not-allowed aria-disabled:opacity-40`}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        )}
        <Tooltip contents content={isTable ? 'Show figure' : 'Show data as a table'}>
          <button type="button" onClick={onToggleTable} aria-label={isTable ? `Show ${title} as a figure` : `Show ${title} as a table`} aria-pressed={isTable} className={ICON_BUTTON}>
            <Table2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
        {onToggleExpand && (
          <Tooltip contents content={isExpanded ? 'Return to all figures' : 'Expand figure'}>
            <button type="button" onClick={onToggleExpand} aria-label={isExpanded ? 'Return to all figures' : `Expand ${title}`} aria-pressed={isExpanded} className={ICON_BUTTON}>
              {isExpanded ? <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" /> : <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />}
            </button>
          </Tooltip>
        )}
        <Tooltip contents content="Remove figure">
          <button type="button" onClick={onClose} aria-label={`Remove ${title}`} className={ICON_BUTTON}>
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
      </div>
    </header>
    <div className="mb-3 mt-2 flex flex-wrap items-center gap-2">
      {controls}
    </div>
    <div className="min-w-0 flex-1">{children}</div>
  </section>
  );
});
FigureFrame.displayName = 'FigureFrame';

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function FigureSegmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className={`${SEGMENT_GROUP} max-w-full flex-wrap`} role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`${SEGMENT_BUTTON} min-h-7 px-2.5 font-semibold ${value === option.value ? SEGMENT_ACTIVE : SEGMENT_INACTIVE}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface SelectProps<T extends string> {
  label: string;
  value: T;
  required?: boolean;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** A labeled dropdown offering only the valid choices for this figure. */
export function FigureSelect<T extends string>({ label, value, required, options, onChange }: SelectProps<T>) {
  return (
    <label className={FIGURE_CONTROL_LABEL}>
      {label}
      <ControlSelect
        value={value}
        required={required}
        onChange={e => onChange(e.target.value as T)}
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </ControlSelect>
    </label>
  );
}

export const FigureLoading: React.FC = () => (
  <div className="flex justify-center px-3 py-5">
    <Shimmer as="div" className="w-fit font-mono text-xs uppercase tracking-wider">{LOADING.charts}</Shimmer>
  </div>
);

/** A chart (or the Charts view) with nothing to show: the "Vacuum state" headline over a plain line saying why. */
export const FigureMessage: React.FC<{ children: React.ReactNode }> = ({ children }) => <EmptyState size="inline">{children}</EmptyState>;

export const FigureError: React.FC<{ onRetry: () => void; retrying: boolean }> = ({ onRetry, retrying }) => (
  <div className="flex justify-center px-3 py-5"><LoadFailure what="This figure" size="inline" onRetry={onRetry} retrying={retrying} /></div>
);
