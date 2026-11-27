import React, { useRef } from 'react';
import { X, type LucideIcon } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import { Sidebar } from '../Sidebar/Sidebar';
import { CONTROL_FOCUS, SEGMENT_ACTIVE, SEGMENT_BUTTON, SEGMENT_GROUP, SEGMENT_INACTIVE } from '../ui/Controls';
import {
  FOCUSES, LAYOUTS, RESULT_VIEWS, showsFocus, showsLayout, type ResultsNavigationProps,
} from '../Explorer/ResultsNavigation';
import { useAnimatedClose } from '../../hooks/useAnimatedClose';
import { useDialog } from '../../hooks/useDialog';
import { LIST_CAUTION } from '../../lib/messages';

/** The results bar's switches, without its extra actions. */
export type QueryPromptNavigation = Omit<ResultsNavigationProps, 'actions'>;

interface QueryPromptModalProps {
  navigation: QueryPromptNavigation;
  onConfirm: () => void;
}

interface PromptChoiceProps<T extends string> {
  label: string;
  accessibleLabel?: string;
  value: T;
  choices: readonly { value: T; label: string; icon: LucideIcon }[];
  onChange: (value: T) => void;
  primary?: boolean;
}

/** One of the results bar's switches, with its title always shown: the prompt has the room the bar lacks. */
function PromptChoice<T extends string>({ label, accessibleLabel = label, value, choices, onChange, primary = false }: PromptChoiceProps<T>) {
  return (
    // One row of the switches' grid (below): the label in the second column, the switch in the third. A subgrid, so the
    // group stays a real element for screen readers while its parts line up with the other rows'.
    <div role="group" aria-label={accessibleLabel}
      className="col-span-5 grid grid-cols-subgrid items-center @max-[21rem]/switches:flex @max-[21rem]/switches:flex-col @max-[21rem]/switches:items-stretch @max-[21rem]/switches:gap-1.5">
      <span className="col-start-2 justify-self-start pr-5 font-display text-xs font-bold uppercase tracking-wider text-on-surface-variant" aria-hidden="true">{label}</span>
      <div className={`${SEGMENT_GROUP} col-start-3 justify-self-stretch`}>
        {choices.map(choice => {
          const active = value === choice.value;
          return (
            // 30px buttons make the switch 36px with its padding and border: the Query button's height. On touch the
            // buttons are 40px (SEGMENT_BUTTON), the switch 46px, and the Query button grows to match.
            <button key={choice.value} type="button" aria-pressed={active} onClick={() => onChange(choice.value)}
              className={`${SEGMENT_BUTTON} flex-1 min-h-[1.875rem] px-2.5 font-semibold ${active
                ? primary ? 'bg-primary text-on-primary shadow-interactive' : SEGMENT_ACTIVE
                : SEGMENT_INACTIVE}`}>
              <choice.icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const QueryPromptModal: React.FC<QueryPromptModalProps> = ({ navigation, onConfirm }) => {
  const { view, onViewChange, focus, onFocusChange, layout, onLayoutChange } = navigation;
  const { close, overlayClass, cardClass, onAnimationEnd } = useAnimatedClose(onConfirm);

  const cardRef = useRef<HTMLDivElement>(null);
  useDialog(cardRef, close);

  const subject = view === 'statistics' ? 'Papers' : focus === 'institution' ? 'Institutions' : 'Researchers';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 glass-overlay ${overlayClass}`}
      onClick={close}
    >
      <div
        ref={cardRef}
        className={`bg-surface border border-outline max-w-[640px] w-full h-[85vh] flex flex-col overflow-hidden shadow-popover ${cardClass}`}
        onClick={e => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
        role="dialog"
        aria-modal="true"
        aria-labelledby="query-prompt-title"
      >
        <div className="shrink-0 flex justify-between items-center border-b border-outline px-10 py-6">
          <div
            id="query-prompt-title"
            className="font-display font-extrabold text-xl tracking-tight uppercase text-on-surface"
          >
            Query {subject}
          </div>
          <Tooltip contents content="Close">
            <button
              type="button"
              className={`${CONTROL_FOCUS} bg-transparent border border-transparent text-on-surface p-2 rounded-full cursor-pointer hover:bg-on-surface/5 transition-colors flex items-center justify-center shadow-interactive press-scale`}
              onClick={close}
              aria-label="Close"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>

        {/* 5-column subgrid centers switches along the sidebar column axis, collapsing to stacked rows below 21rem. */}
        <div className="@container/switches shrink-0 border-b border-outline px-10 py-5 overflow-hidden [scrollbar-gutter:stable]">
        <div className="grid grid-cols-[minmax(0,1.25rem)_minmax(max-content,1fr)_max-content_minmax(0,1fr)_minmax(0,1.25rem)] items-center gap-y-3 @max-[21rem]/switches:flex @max-[21rem]/switches:flex-col @max-[21rem]/switches:items-stretch @max-[21rem]/switches:gap-y-4">
          <PromptChoice label="View" accessibleLabel="Results view" value={view} primary onChange={onViewChange} choices={RESULT_VIEWS} />
          {showsFocus(view) && <PromptChoice label="Focus" value={focus} choices={FOCUSES} onChange={onFocusChange} />}
          {showsLayout(view, focus) && (
            <PromptChoice label="Layout" accessibleLabel="Network layout" value={layout} choices={LAYOUTS} onChange={onLayoutChange} />
          )}
        </div>
        </div>

        <Sidebar embedded className="flex-1 min-h-0" />

        <div className="shrink-0 border-t border-outline px-10 py-5 flex items-center justify-between gap-6 bg-surface">
          <p className="text-xs leading-snug text-on-surface-variant">{view === 'statistics' ? LIST_CAUTION.institution : LIST_CAUTION[focus]}</p>
          <button
            type="button"
            onClick={close}
            className={`${CONTROL_FOCUS} bg-primary text-on-primary font-display font-bold text-xs tracking-wider uppercase inline-flex items-center justify-center h-9 pointer-coarse:h-[2.875rem] px-8 rounded-full cursor-pointer transition-all duration-300 ease-[var(--ease-spring)] shadow-interactive press-scale`}
          >
            Query
          </button>
        </div>
      </div>
    </div>
  );
};
