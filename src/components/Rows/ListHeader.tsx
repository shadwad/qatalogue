import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, HelpCircle } from 'lucide-react';
import type { MetricMode, SortColumn, SortDirection, ViewMode } from '../../hooks/useExplorerData';
import type { UrlState } from '../../hooks/urlState';
import { CONTROL_BUTTON, CONTROL_FOCUS, ControlSelect } from '../ui/Controls';
import { Tooltip, tooltipCardClass } from '../ui/Tooltip';
import { listColumns, ROW_NUMBER_CLASS } from './utils';

const AFFILIATION_HINT = "The researcher's last known affiliation, from their most recent paper in the dataset";
const countLabels = {
  adj_frac_count: { label: 'AF Count', description: 'Adjusted fractional count' },
  frac_count: { label: 'F Count', description: 'Fractional count' },
  total_count: { label: 'T Count', description: 'Total count' },
};

interface SortHeadingProps {
  label: string;
  description?: string;
  direction?: SortDirection;
  onClick: () => void;
}

function SortHeading({ label, description, direction, onClick }: SortHeadingProps) {
  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ChevronsUpDown;
  const order = direction === 'asc' ? ', ascending' : direction === 'desc' ? ', descending' : '';

  return (
    <Tooltip contents align="end" content={description}>
      <button type="button" aria-pressed={direction !== undefined} aria-label={`Sort by ${description ?? label}${order}`} onClick={onClick}
        className={`${CONTROL_FOCUS} inline-flex min-h-8 min-w-0 cursor-pointer items-center gap-1.5 text-left font-display text-sm font-semibold leading-tight transition-colors hover:text-primary ${direction ? 'text-on-surface' : 'text-on-surface-variant'}`}>
        <span className="truncate">{label}</span>
        <Icon className={`size-3 shrink-0 ${direction ? 'text-primary' : 'opacity-60'}`} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

interface ListHeaderProps {
  viewMode: ViewMode;
  metricMode: MetricMode;
  sort: UrlState['sort'];
  onSort: (column: SortColumn) => void;
  /** Phones: drawn at the end of the compact sort row (the List / Network switch). */
  phoneControls?: React.ReactNode;
}

export function ListHeader({ viewMode, metricMode, sort, onSort, phoneControls }: ListHeaderProps) {
  const [isAffiliationHelpOpen, setAffiliationHelpOpen] = useState(false);
  const researcher = viewMode === 'researcher';
  const name = researcher ? 'Researcher' : 'Institution';
  const secondary = researcher ? 'Affiliation' : 'Location';
  const count = metricMode === 'none' ? undefined : countLabels[metricMode];
  const columns = listColumns(viewMode, count !== undefined);
  const directionFor = (column: SortColumn) => sort.column === column ? sort.direction : undefined;
  const DirectionIcon = sort.direction === 'asc' ? ArrowUp : ArrowDown;
  const rowNumber = (
    <span className={ROW_NUMBER_CLASS}>
      <span aria-hidden="true">#</span>
      <span className="sr-only">Row number</span>
    </span>
  );

  useEffect(() => {
    setAffiliationHelpOpen(false);
  }, [viewMode, sort.column]);

  const sortBy = (column: SortColumn) => {
    setAffiliationHelpOpen(false);
    onSort(column);
  };

  return (
    <>
      <div className="sticky top-0 z-10 hidden h-12 shrink-0 border-b border-outline-variant bg-surface @2xl/results:block">
        {/* Match the list's scrollbar gutter and padding so the grid tracks line up. */}
        <div className="h-full overflow-y-auto [scrollbar-gutter:stable] md:pr-1.5 lg:pr-0 lg:mr-2.5">
          <div role="group" aria-label="List sorting" className={`mx-auto grid h-full w-full max-w-screen-2xl items-center px-6 @5xl/results:px-10 ${columns}`}>
            {rowNumber}
            <div className="flex min-w-0 items-center pr-2">
              <SortHeading label={name} direction={directionFor('institution')} onClick={() => sortBy('institution')} />
            </div>
            <div className="flex min-w-0 items-center gap-0.5 pr-2">
              <SortHeading label={secondary} direction={directionFor('secondary')} onClick={() => sortBy('secondary')} />
              {researcher && (
                <Tooltip contents align="end" content={AFFILIATION_HINT}>
                  <span tabIndex={0} aria-label={AFFILIATION_HINT}
                    className={`flex size-6 shrink-0 cursor-help items-center justify-center rounded-full text-on-surface-variant hover:text-primary ${CONTROL_FOCUS}`}>
                    <HelpCircle className="size-3.5" aria-hidden="true" />
                  </span>
                </Tooltip>
              )}
            </div>
            {count && (
              <div className="flex min-w-0 justify-end">
                <SortHeading {...count} direction={directionFor('score')} onClick={() => sortBy('score')} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div role="group" aria-label="List sorting"
        className={`sticky top-0 z-10 grid min-h-12 shrink-0 items-center border-b border-outline-variant bg-surface px-4 py-2 @2xl/results:hidden ${columns}`}>
        {rowNumber}
        <div className="flex min-w-0 items-center gap-1.5">
          <ControlSelect aria-label="Sort by" value={sort.column} onChange={event => sortBy(event.target.value as SortColumn)}>
            <option value="institution">{name}</option>
            <option value="secondary">{secondary}</option>
            {count && <option value="score">Count</option>}
          </ControlSelect>
          <button type="button" onClick={() => sortBy(sort.column)} className={`${CONTROL_BUTTON} shrink-0`}
            aria-label={sort.direction === 'desc' ? 'Sorted descending. Switch to ascending' : 'Sorted ascending. Switch to descending'}>
            <DirectionIcon className="size-3.5 text-primary" aria-hidden="true" />
          </button>
          {researcher && sort.column === 'secondary' && (
            <>
              <button type="button" onClick={() => setAffiliationHelpOpen(open => !open)} className={`${CONTROL_BUTTON} shrink-0`}
                aria-expanded={isAffiliationHelpOpen} aria-label="Explain researcher affiliation">
                <HelpCircle className="size-3.5" aria-hidden="true" />
              </button>
              {isAffiliationHelpOpen && (
                <div className={`absolute right-4 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] ${tooltipCardClass}`}>
                  {AFFILIATION_HINT}
                </div>
              )}
            </>
          )}
          {phoneControls && <div className="ml-auto flex shrink-0 items-center gap-1.5 md:hidden">{phoneControls}</div>}
        </div>
      </div>
    </>
  );
}
