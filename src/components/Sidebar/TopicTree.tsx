import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, FileText, type LucideIcon } from 'lucide-react';
import { ListFailure } from '../ui/LoadFailure';
import type { Taxonomy } from '../../hooks/useExplorerData';
import type { FilterMatch } from '../../hooks/useExplorerData';
import { HelpHint } from '../ui/HelpHint';
import { ResetButton, SectionSymbols, SectionTitle } from './ResetButton';
import { SearchField } from './SearchField';
import { Tooltip } from '../ui/Tooltip';
import { Shimmer } from '../ui/Shimmer';
import { CONTROL_FOCUS } from '../ui/Controls';
import { LOADING } from '../../lib/messages';

/** Facet counts from /api/topics/counts (distinct papers under the other filters). */
export interface TopicCounts {
  topics: Record<string, number>;
  platforms: Record<string, number>;
  venues: Record<string, number>;
  /** Only when asked for, by Statistics: papers with an author in each location. */
  locations?: Record<string, number>;
  regions?: Record<string, number>;
  total: number;
}

/** A sidebar list that hasn't loaded yet, lined up with the sliders and search boxes around it. */
export const ListLoading: React.FC = () => (
  <Shimmer as="div" className="w-fit px-4 py-1 font-mono text-xs uppercase tracking-wider">{LOADING.list}</Shimmer>
);

/**
 * The one height limit for a filter card's list: about 12 rows, so Topic and Platform fit whole until a topic is opened,
 * and a cut-off row shows there is more to scroll. The gutter keeps count columns aligned across cards, scrollbar or not.
 */
export const FILTER_LIST_CLASS = 'flex flex-col overflow-y-auto custom-scrollbar max-h-[416px] [scrollbar-gutter:stable]';

/** Stands in for a row's unfold toggle where it has none, so every list's checkboxes sit in one column. */
export const ToggleSpacer: React.FC = () => <span className="w-5 shrink-0" aria-hidden="true" />;

/** The count at the end of a filter row. `unit` is the plural noun, for the tooltip. */
export const FilterCount: React.FC<{ count?: number; unit?: string; className?: string }> = ({ count, unit = 'papers', className = 'font-mono text-[10px] text-on-surface-variant/80 pt-[1px]' }) => (
  <Tooltip contents content={count === undefined ? undefined : `${count.toLocaleString()} ${count === 1 ? unit.replace(/ies$/, 'y').replace(/s$/, '') : unit}`}>
    <span className={`tabular-nums shrink-0 ${className}`}>
      {count === undefined ? '' : count.toLocaleString()}
    </span>
  </Tooltip>
);

/** Says what a list's numbers count: a symbol in the section header, in the column of the other sections' help icons. */
export const CountSymbol: React.FC<{ icon?: LucideIcon; hint: string }> = ({ icon: Icon = FileText, hint }) => (
  <HelpHint
    label={hint}
    className="pl-2 md:pl-1"
    trigger={<Icon className="w-4 h-4 md:w-3 md:h-3 text-on-surface-variant group-hover:text-primary group-focus:text-primary transition-colors ease-md3" aria-hidden="true" />}
  >
    {hint}
  </HelpHint>
);

const Checkbox: React.FC<{ checked: boolean; partial?: boolean }> = ({ checked, partial }) => (
  <span
    aria-hidden="true"
    className={`mt-[2px] w-3.5 h-3.5 squircle-sm flex items-center justify-center border transition-colors ease-[var(--ease-spring)] shrink-0 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary ${
      checked ? 'bg-primary border-primary text-on-primary' : partial ? 'border-primary' : 'border-outline group-hover:border-primary'
    }`}
  >
    {checked && <Check size={10} strokeWidth={3} />}
    {!checked && partial && <span className="w-1.5 h-1.5 rounded-[2px] bg-primary" />}
  </span>
);

interface RowProps {
  id: string;
  label: string;
  hint?: string;
  count?: number;
  checked: boolean;
  partial?: boolean;
  indent?: boolean;
  onToggle: (id: string) => void;
}

const Row: React.FC<RowProps> = ({ id, label, hint, count, checked, partial, indent, onToggle }) => (
  <Tooltip contents content={hint}>
  <label
    className={`flex items-start gap-3 cursor-pointer group text-xs leading-snug py-2 rounded-md transition-colors ease-[var(--ease-spring)] press-scale-sm min-w-0 flex-1 ${
      indent ? 'pl-3 pr-2' : 'px-2'
    } ${checked ? 'bg-primary/10' : 'hover:bg-on-surface/5'} ${count === 0 && !checked ? 'opacity-50' : ''}`}
  >
    <input
      type="checkbox"
      className="peer sr-only"
      checked={checked}
      ref={el => { if (el) el.indeterminate = Boolean(partial && !checked); }}
      aria-checked={partial && !checked ? 'mixed' : checked}
      onChange={() => onToggle(id)}
      aria-description={hint || undefined}
    />
    <Checkbox checked={checked} partial={partial} />
    <span className={`flex-1 min-w-0 break-words ${checked ? 'text-primary font-bold' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
      {label}
    </span>
    <FilterCount count={count} />
  </label>
  </Tooltip>
);

/** With two or more selected: must a paper have any of them, or all of them? */
const MatchSwitch: React.FC<{ noun: string; value: FilterMatch; onChange: (value: FilterMatch) => void }> = ({ noun, value, onChange }) => (
  <div className="mb-2 flex items-center justify-between gap-2 text-xs text-on-surface-variant">
    <span>Papers in</span>
    <div className="flex gap-0.5 rounded-full border border-outline bg-surface p-0.5 shadow-interactive" role="group" aria-label={`Papers matching ${noun}`}>
      {(['any', 'all'] as const).map(option => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={`${CONTROL_FOCUS} rounded-full px-2.5 py-0.5 leading-snug transition-all duration-300 ease-[var(--ease-spring)] press-scale ${value === option ? 'bg-on-surface/10 font-semibold text-on-surface' : 'bg-transparent text-on-surface-variant hover:bg-on-surface/5'}`}
        >
          {option === 'any' ? 'Any of these' : 'All of these'}
        </button>
      ))}
    </div>
  </div>
);

interface TopicTreeProps {
  /** The list is still on its way, as opposed to having failed. */
  loading?: boolean;
  taxonomy: Taxonomy | null;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  counts?: TopicCounts;
  match: FilterMatch;
  onMatchChange: (value: FilterMatch) => void;
}

/**
 * Two-level topic filter: topics expand to their subtopics; each row shows how many papers it has under the
 * other filters. Selecting a topic includes all of its subtopics. A search box narrows the tree.
 */
export const TopicTree: React.FC<TopicTreeProps> = ({ taxonomy, loading, selected, onToggle, onClear, counts, match, onMatchChange }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [toggledInSearch, setToggledInSearch] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const sel = useMemo(() => new Set(selected), [selected]);

  const q = query.trim().toLowerCase();
  useEffect(() => {
    setToggledInSearch(new Set());
  }, [q]);

  const visible = useMemo(() => {
    if (!taxonomy) return [];
    return taxonomy.topics
      .map(T => {
        const hasTerm = (terms?: string[]) => !!terms?.some(t => t.toLowerCase().includes(q));
        const topicHit = !q || T.name.toLowerCase().includes(q) || hasTerm(T.search_terms);
        const subs = T.subtopics.filter(S => topicHit || S.name.toLowerCase().includes(q) || S.definition.toLowerCase().includes(q) || hasTerm(S.search_terms));
        return { T, subs: topicHit ? T.subtopics : subs, show: topicHit || subs.length > 0 };
      })
      .filter(x => x.show);
  }, [taxonomy, q]);

  const toggleOpen = (id: string) => {
    const setter = q ? setToggledInSearch : setOpen;
    setter(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="shrink-0">
      <div className="flex justify-between items-center mb-3">
        <SectionTitle
          title={
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          className={`${CONTROL_FOCUS} flex items-center gap-1.5 font-display text-xs font-bold tracking-wider uppercase text-on-surface-variant hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-1 -m-1 press-scale-sm`}
        >
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
          TOPIC
        </button>
          }
        />
        <SectionSymbols
          symbol={isExpanded && <CountSymbol hint="Papers per topic, subject to other filters; a paper can be in several" />}
          reset={selected.length > 0 && <ResetButton label="Reset topic filter" description={`Reset topic filter (${selected.length} selected)`} onReset={onClear} />}
        />
      </div>
      {isExpanded && (
        <>
          {selected.length >= 2 && <MatchSwitch noun="topics" value={match} onChange={onMatchChange} />}
          <SearchField value={query} onChange={setQuery} placeholder="Find a topic" label="Find a topic" clearLabel="Clear topic search" />
          <div className={`${FILTER_LIST_CLASS} gap-0.5`}>
            {loading && <ListLoading />}
            {!taxonomy && !loading && <ListFailure />}
            {taxonomy && visible.length === 0 && (
              <div className="text-xs text-on-surface-variant italic px-2 py-1">No topic matches “{query}”</div>
            )}
            {visible.map(({ T, subs }) => {
              const expanded = q ? !toggledInSearch.has(T.id) : open.has(T.id);
              const someSub = T.subtopics.some(S => sel.has(S.id));
              return (
                <div key={T.id} className="flex flex-col">
                  <div className="flex items-start">
                    <Tooltip contents content={expanded ? 'Hide subtopics' : 'Show subtopics'}>
                      <button
                        type="button"
                        onClick={() => toggleOpen(T.id)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} subtopics of ${T.name}`}
                        className={`${CONTROL_FOCUS} mt-1.5 w-5 h-5 flex items-center justify-center rounded text-on-surface-variant hover:text-primary bg-transparent border-none cursor-pointer shrink-0`}
                      >
                        {expanded ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                      </button>
                    </Tooltip>
                    <Row id={T.id} label={T.name} hint={T.definition} count={counts?.topics[T.id] ?? (counts ? 0 : undefined)}
                      checked={sel.has(T.id)} partial={!sel.has(T.id) && someSub} onToggle={onToggle} />
                  </div>
                  {expanded && (
                    <div className="ml-5 border-l border-outline/70 flex flex-col gap-0.5 my-0.5">
                      {subs.map(S => (
                        <Row key={S.id} id={S.id} label={S.name} hint={S.definition} indent
                          count={counts?.topics[S.id] ?? (counts ? 0 : undefined)}
                          checked={sel.has(S.id) || sel.has(T.id)} onToggle={onToggle} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

interface PlatformFacetProps {
  /** The list is still on its way, as opposed to having failed. */
  loading?: boolean;
  taxonomy: Taxonomy | null;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  counts?: TopicCounts;
  match: FilterMatch;
  onMatchChange: (value: FilterMatch) => void;
}

/** Hardware-platform filter (papers on any or all of the selected platforms), with counts. */
export const PlatformFacet: React.FC<PlatformFacetProps> = ({ taxonomy, loading, selected, onToggle, onClear, counts, match, onMatchChange }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const platforms = taxonomy?.platforms ?? [];
  return (
    <div className="shrink-0">
      <div className="flex justify-between items-center mb-3">
        <SectionTitle
          title={
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          className={`${CONTROL_FOCUS} flex items-center gap-1.5 font-display text-xs font-bold tracking-wider uppercase text-on-surface-variant hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-1 -m-1 press-scale-sm`}
        >
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
          PLATFORM
        </button>
          }
        />
        <SectionSymbols
          symbol={isExpanded && <CountSymbol hint="Papers per platform, subject to other filters; a paper can use several" />}
          reset={selected.length > 0 && <ResetButton label="Reset platform filter" description={`Reset platform filter (${selected.length} selected)`} onReset={onClear} />}
        />
      </div>
      {isExpanded && selected.length >= 2 && <MatchSwitch noun="platforms" value={match} onChange={onMatchChange} />}
      {isExpanded && (
        <div className={`${FILTER_LIST_CLASS} gap-0.5`}>
          {loading && <ListLoading />}
          {!taxonomy && !loading && <ListFailure />}
          {platforms.map(p => (
            <div key={p.id} className="flex items-start">
              <ToggleSpacer />
              <Row id={p.id} label={p.name} hint={p.definition} count={counts?.platforms[p.id] ?? (counts ? 0 : undefined)}
                checked={selected.includes(p.id)} onToggle={onToggle} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
