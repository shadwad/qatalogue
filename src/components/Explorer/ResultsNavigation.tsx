import React from 'react';
import { ChartBellCurve, Globe, GraphStar, Landmark, List, User, Waypoints, type LucideIcon } from 'lucide-react';
import { SEGMENT_ACTIVE, SEGMENT_BUTTON, SEGMENT_GROUP, SEGMENT_INACTIVE } from '../ui/Controls';
import type { DisplayMode, NetworkLayout, ViewMode } from '../../hooks/useExplorerData';

export type ResultsView = DisplayMode | 'statistics';

export const RESULT_VIEWS = [
  { value: 'list', label: 'List', icon: List },
  { value: 'network', label: 'Network', icon: Waypoints },
  { value: 'statistics', label: 'Charts', icon: ChartBellCurve },
] as const;

export const FOCUSES = [
  { value: 'institution', label: 'Institutions', icon: Landmark },
  { value: 'researcher', label: 'Researchers', icon: User },
] as const;

export const LAYOUTS = [
  { value: 'map', label: 'Map', icon: Globe },
  { value: 'force', label: 'Graph', icon: GraphStar },
] as const;

/** Statistics counts papers, so there is no institution or researcher focus to choose. */
export const showsFocus = (view: ResultsView) => view !== 'statistics';
/** Only the institution network has a choice of layout; researchers are always drawn as a graph. */
export const showsLayout = (view: ResultsView, focus: ViewMode) => view === 'network' && focus === 'institution';

// Narrow bars drop the icons and keep the words; the icons show from 54rem (864px), where all four groups fit.
const OPTION_ICON = 'hidden h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5 @min-[54rem]:block';
// Each switch's title, shown once the bar is wide enough. The group's label already names it for screen readers.
const CHOICE_TITLE = 'hidden font-display text-xs font-bold uppercase tracking-wider text-on-surface-variant @4xl:inline';

interface ChoiceProps<T extends string> {
  label: string;
  accessibleLabel?: string;
  value: T;
  choices: readonly { value: T; label: string; icon: LucideIcon }[];
  onChange: (value: T) => void;
}

function ResultsChoice<T extends string>({ label, accessibleLabel = label, value, choices, onChange }: ChoiceProps<T>) {
  return (
    <div role="group" aria-label={accessibleLabel} className="flex shrink-0 items-center gap-2 border-r border-outline-variant pr-1 sm:pr-2">
      <span className={CHOICE_TITLE} aria-hidden="true">{label}</span>
      <div className={SEGMENT_GROUP}>
        {choices.map(choice => (
          <button key={choice.value} type="button" aria-pressed={value === choice.value} onClick={() => onChange(choice.value)}
            className={`${SEGMENT_BUTTON} min-h-7 px-1.5 font-semibold sm:px-2.5 ${value === choice.value ? SEGMENT_ACTIVE : SEGMENT_INACTIVE}`}>
            <choice.icon aria-hidden="true" className={OPTION_ICON} />
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ResultsNavigationProps {
  view: ResultsView;
  onViewChange: (view: ResultsView) => void;
  focus: ViewMode;
  onFocusChange: (focus: ViewMode) => void;
  layout: NetworkLayout;
  onLayoutChange: (layout: NetworkLayout) => void;
  actions: React.ReactNode;
}

// The right padding matches the header's, so the view switch ends under the theme toggle. Below 340px there is no room for it.
export function ResultsNavigation({ view, onViewChange, focus, onFocusChange, layout, onLayoutChange, actions }: ResultsNavigationProps) {
  return (
    <div className="@container shrink-0 border-b border-outline bg-surface">
      <div className="flex min-h-[52px] items-center gap-1 overflow-x-auto whitespace-nowrap py-2 pl-2 pr-fluid max-[340px]:pl-1.5 max-[340px]:pr-2! sm:gap-2 md:pl-4 @4xl:pl-6">
        {actions}
        {/* The view switch holds the right edge. The choices that come and go with the view sit to its left, so it never moves under the pointer. */}
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {showsLayout(view, focus) && (
          <ResultsChoice label="Layout" accessibleLabel="Network layout" value={layout} choices={LAYOUTS} onChange={onLayoutChange} />
        )}
        {showsFocus(view) && <ResultsChoice label="Focus" value={focus} choices={FOCUSES} onChange={onFocusChange} />}
        <div className="flex shrink-0 items-center gap-2">
          <span className={CHOICE_TITLE} aria-hidden="true">View</span>
          <nav aria-label="Results view" className={`${SEGMENT_GROUP} shrink-0`}>
            {RESULT_VIEWS.map(option => (
              <button key={option.value} type="button" aria-pressed={view === option.value} onClick={() => onViewChange(option.value)}
                className={`${SEGMENT_BUTTON} min-h-7 px-1.5 font-semibold sm:px-2.5 ${view === option.value
                  ? 'bg-primary text-on-primary shadow-interactive' : SEGMENT_INACTIVE}`}>
                <option.icon aria-hidden="true" className={OPTION_ICON} />
                {option.label}
              </button>
            ))}
          </nav>
        </div>
        </div>
      </div>
    </div>
  );
}
