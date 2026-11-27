import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Undo2 } from 'lucide-react';
import { CONTROL_BUTTON, ControlSelect } from '../ui/Controls';
import { useExplorerContext } from '../../context/ExplorerContext';
import { useElementWidth } from '../../hooks/useElementSize';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { LoadFailure } from '../ui/LoadFailure';
import { FORMS, isForm } from '../../../shared/chart';
import { PaperEvidence, type EvidenceSelection } from './PaperEvidence';
import { CustomChart } from './CustomChart';
import { FigureMessage } from './FigureFrame';
import { focusAddedChart } from './figureViewport';
import { chartChoices, FIGURE_GAP, layoutFigures, MAX_FIGURES, newChart, type Dimension, type Figure } from './figureConfig';
import { useAxisItems } from './useCrosstab';
import { useFigureSelection } from './useFigureSelection';

interface StatisticsViewProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

/** Charts scroll inside the results panel alongside the persistent filter controls. */
const StatisticsView: React.FC<StatisticsViewProps> = ({ scrollRef }) => {
  const { figures, setFigures, startYear, endYear } = useExplorerContext();
  const axisItems = useAxisItems();
  const { select, undo, canUndo, label: selectionLabel } = useFigureSelection();
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [evidence, setEvidence] = useState<EvidenceSelection | null>(null);
  const expanded = figures.find(f => f.id === expandedId) ?? null;
  useEffect(() => {
    if (!expanded || evidence) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpandedId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, evidence]);

  const slots = useMemo(() => layoutFigures(expanded ? [expanded] : figures, width, {
    labels: (dimension: Dimension) => axisItems(dimension).map(item => item.label),
    years: endYear - startYear + 1,
  }), [expanded, figures, width, axisItems, startYear, endYear]);
  const update = (next: Figure) => setFigures(prev => prev.map(f => (f.id === next.id ? next : f)));
  const remove = (id: number) => {
    setFigures(prev => prev.filter(f => f.id !== id));
    setExpandedId(current => current === id ? null : current);
  };
  const addedId = useRef<number | null>(null);
  const add = (choice: string) => {
    if (figures.length >= MAX_FIGURES || !isForm(choice)) return;
    const figure = newChart(choice);
    addedId.current = figure.id;
    setExpandedId(null);
    setFigures(prev => prev.length >= MAX_FIGURES ? prev : [...prev, figure]);
  };
  useLayoutEffect(() => {
    if (addedId.current === null) return;
    const card = containerRef.current?.querySelector<HTMLElement>(`[data-chart-id="${addedId.current}"]`);
    const panel = scrollRef.current;
    if (!card || !panel) return;
    addedId.current = null;
    focusAddedChart(panel, card, toolbarRef.current?.offsetHeight ?? 0);
  }, [figures, width, scrollRef]);
  const move = (id: number, offset: number) => setFigures(prev => {
    const index = prev.findIndex(figure => figure.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= prev.length) return prev;
    const next = [...prev];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  return (
    <div className="mx-auto w-full max-w-[2400px] px-2 pb-2 md:px-6 md:pb-6">
      <div ref={toolbarRef} className="sticky top-0 z-20 flex min-h-[52px] flex-wrap items-center justify-end gap-2 bg-background py-2.5" data-selection-strip>
        {/* After a click on a chart has narrowed the filters: what they now show, and the way back, at the left where the eye
            goes first. Add chart holds the right edge; the buttons that come and go sit to its left. */}
        <div role="status" className="mr-auto flex min-w-0 items-center">
          {canUndo && (
            <div className="flex min-w-0 items-center gap-2 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-3.5 pr-0.5 text-xs text-on-surface">
              <span className="min-w-0 truncate">Showing <span className="font-semibold">{selectionLabel ?? 'your chart selection'}</span></span>
              <button type="button" onClick={undo} className={`${CONTROL_BUTTON} shrink-0`} aria-label={`Undo: stop showing only ${selectionLabel ?? 'your chart selection'}`}>
                <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
                Undo
              </button>
            </div>
          )}
        </div>
        {figures.length > 0 && (
          <button type="button" className={CONTROL_BUTTON} onClick={() => { setExpandedId(null); setFigures([]); }}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Clear charts
          </button>
        )}
        <ControlSelect
          aria-label="Add chart"
          leadingIcon={Plus}
          value=""
          disabled={figures.length >= MAX_FIGURES}
          onChange={event => add(event.target.value)}
          className="font-semibold"
        >
          <option value="" disabled>{figures.length >= MAX_FIGURES ? 'Chart limit reached' : 'Add chart'}</option>
          {chartChoices.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </ControlSelect>
      </div>
      {evidence && <PaperEvidence selection={evidence} onClose={() => setEvidence(null)} />}
      <div ref={containerRef} className="w-full">
        {figures.length === 0 && <FigureMessage>No charts yet. Choose one from Add chart.</FigureMessage>}
        {figures.length > 0 && width > 0 && (
          <div className="flex flex-wrap items-start" style={{ gap: FIGURE_GAP }}>
            {slots.map(({ figure, width: cardWidth }, i) => (
              <div key={figure.id} className="min-w-0 max-w-full" style={{ width: cardWidth }} data-figure={figure.type} data-chart-id={figure.id}>
                <ErrorBoundary fallback={
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-outline bg-surface px-4 py-6">
                    <LoadFailure what={`This ${FORMS[figure.vars.form].toLowerCase()}`} size="inline" />
                    <button type="button" onClick={() => remove(figure.id)} className={CONTROL_BUTTON}>Remove chart</button>
                  </div>
                }>
                  <CustomChart vars={figure.vars} onChange={vars => update({ ...figure, vars })}
                    onClose={() => remove(figure.id)}
                    onToggleExpand={figures.length > 1 ? () => setExpandedId(id => id === figure.id ? null : figure.id) : undefined}
                    isExpanded={expandedId === figure.id}
                    layout={expanded || figures.length < 2 ? undefined : {
                      wide: !!figure.wide,
                      onToggleWide: () => update({ ...figure, wide: !figure.wide }),
                      onEarlier: i > 0 ? () => move(figure.id, -1) : undefined,
                      onLater: i + 1 < slots.length ? () => move(figure.id, 1) : undefined,
                    }}
                    onSelect={select} onInspect={setEvidence} />
                </ErrorBoundary>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StatisticsView;
