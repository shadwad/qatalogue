import { Check, ChartBellCurve, Filter, Landmark, Share2, User, type LucideIcon } from 'lucide-react';
import { useShareLink } from '../ui/CopyLinkButton';
import { CONTROL_FOCUS, SEGMENT_ACTIVE, SEGMENT_BUTTON, SEGMENT_GROUP, SEGMENT_INACTIVE } from '../ui/Controls';
import { LAYOUTS, RESULT_VIEWS, type ResultsView } from './ResultsNavigation';
import type { DisplayMode, NetworkLayout, ViewMode } from '../../hooks/useExplorerData';

interface MobileTabBarProps {
  view: ResultsView;
  focus: ViewMode;
  /** Shows the list of institutions or researchers. */
  onShowList: (focus: ViewMode) => void;
  onShowStatistics: () => void;
  onOpenFilters: () => void;
  /** Kinds of filter set, shown on the Filters tab. */
  filterCount: number;
  /** Hidden while the filter screen is open: its own bar ("Show N results") is then the one at the bottom. */
  hidden?: boolean;
}

interface TabProps {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
  badge?: number;
  ariaLabel?: string;
}

function Tab({ label, icon: Icon, active = false, onClick, badge, ariaLabel }: TabProps) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} aria-label={ariaLabel}
      className={`${CONTROL_FOCUS} relative flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors press-scale ${
        active ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>
      <span className={`relative flex h-7 w-12 items-center justify-center rounded-full transition-colors ${active ? 'bg-primary/12' : ''}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
        {badge !== undefined && badge > 0 && (
          <span aria-hidden="true"
            className="absolute -right-0.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-bold leading-none text-on-primary">
            {badge}
          </span>
        )}
      </span>
      {label}
    </button>
  );
}

/**
 * Phones only: the results switches and the filters, along the bottom where a thumb reaches them. Takes the place of
 * the results bar (ResultsNavigation), which tablets and desktops keep.
 */
export function MobileTabBar({ view, focus, onShowList, onShowStatistics, onOpenFilters, filterCount, hidden }: MobileTabBarProps) {
  const listing = view !== 'statistics';
  const { share, state } = useShareLink();
  return (
    <nav aria-label="Results" hidden={hidden}
      className="md:hidden shrink-0 border-t border-outline bg-surface px-2 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] flex items-stretch gap-1 z-20">
      <Tab label="Institutions" icon={Landmark} active={listing && focus === 'institution'} onClick={() => onShowList('institution')} />
      <Tab label="Researchers" icon={User} active={listing && focus === 'researcher'} onClick={() => onShowList('researcher')} />
      <Tab label="Charts" icon={ChartBellCurve} active={!listing} onClick={onShowStatistics} />
      <Tab label="Filters" icon={Filter} onClick={onOpenFilters} badge={filterCount}
        ariaLabel={filterCount > 0 ? `Filters, ${filterCount} set` : 'Filters'} />
      <Tab label={state === 'done' ? 'Copied' : state === 'failed' ? 'Not copied' : 'Share'} icon={state === 'done' ? Check : Share2}
        onClick={share} ariaLabel="Share a link to this view" />
      {/* Beside the buttons, not inside one: a button's contents are not announced as they change. */}
      <span className="sr-only" role="status">{state === 'done' ? 'Link copied' : state === 'failed' ? 'Couldn’t copy the link' : ''}</span>
    </nav>
  );
}

interface PhoneViewSwitchProps {
  view: DisplayMode;
  onViewChange: (view: DisplayMode) => void;
  layout: NetworkLayout;
  onLayoutChange: (layout: NetworkLayout) => void;
  /** Only the institution network has a choice of layout (showsLayout in ResultsNavigation). */
  showLayout: boolean;
  /** Shares its row with other buttons (the network's PNG and Fit), so keeps to icons until 480px rather than 400px. */
  besideButtons?: boolean;
}

// While the words are hidden, each button is a circle round its icon (28px, 40px on touch) rather than a padded pill.
// Written out per breakpoint so Tailwind sees the classes; the breakpoints match the words' (below).
const ICON_ONLY = 'max-[400px]:size-7 max-[400px]:pointer-coarse:size-10 max-[400px]:px-0';
const ICON_ONLY_BESIDE_BUTTONS = 'max-[480px]:size-7 max-[480px]:pointer-coarse:size-10 max-[480px]:px-0';

function Segments<T extends string>({ label, value, choices, onChange, besideButtons }: {
  label: string; value: T; choices: readonly { value: T; label: string; icon: LucideIcon }[]; onChange: (value: T) => void;
  besideButtons?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={`${SEGMENT_GROUP} shrink-0`}>
      {choices.map(choice => (
        <button key={choice.value} type="button" aria-pressed={value === choice.value} onClick={() => onChange(choice.value)}
          className={`${SEGMENT_BUTTON} min-h-7 px-2.5 font-semibold ${besideButtons ? ICON_ONLY_BESIDE_BUTTONS : ICON_ONLY} ${value === choice.value ? SEGMENT_ACTIVE : SEGMENT_INACTIVE}`}>
          <choice.icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          {/* The narrowest phones keep the icons; the words stay for screen readers. Beside the network's buttons the
              words are shown from 480px. */}
          <span className={besideButtons ? 'max-[480px]:sr-only' : 'max-[400px]:sr-only'}>{choice.label}</span>
        </button>
      ))}
    </div>
  );
}

const DISPLAYS = RESULT_VIEWS.filter(option => option.value !== 'statistics') as readonly { value: DisplayMode; label: string; icon: LucideIcon }[];

/**
 * Phones: List or Network for the institutions or researchers the tab bar shows, and the institution network's layout.
 * Drawn in the list's sort row and over the network, where tablets and desktops have the results bar.
 */
export function PhoneViewSwitch({ view, onViewChange, layout, onLayoutChange, showLayout, besideButtons }: PhoneViewSwitchProps) {
  return (
    <>
      <Segments label="Results view" value={view} choices={DISPLAYS} onChange={onViewChange} besideButtons={besideButtons} />
      {showLayout && <Segments label="Network layout" value={layout} choices={LAYOUTS} onChange={onLayoutChange} besideButtons={besideButtons} />}
    </>
  );
}
