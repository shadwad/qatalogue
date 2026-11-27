import React, { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { CONTROL_FOCUS } from '../ui/Controls';
import { Tooltip } from '../ui/Tooltip';

const loadPaperSearchPanel = () => import('./PaperSearchPanel');
const PaperSearchPanel = lazy(loadPaperSearchPanel);
const EMPTY_LIST: string[] = [];

interface PaperResult {
  paper_id: string; title: string; year: number | null; venue_name: string | null; doi: string | null;
  matched_in: string[]; meaning: boolean; pinned: boolean;
}
export interface PaperSearchResponse {
  query: string; total: number; results: PaperResult[]; expansions: { acronym: string; expansion: string }[]; took_ms: number;
}

interface PaperSearchProps {
  query: string;
  yearsReady: boolean;
  showStatistics?: boolean;
  startYear: number;
  endYear: number;
  topics: string[];
  platforms?: string[];
  venues: string[];
}

const PAGE = 20;

/** One query definition, so the panel and the empty-state shortcut share a cache entry. */
function paperSearchOptions(q: string, startYear: number, endYear: number, topics: string[], venues: string[], limit: number, enabled: boolean, platforms: string[] = []) {
  return {
    queryKey: ['paper-search', q, startYear, endYear, [...topics].sort(), [...venues].sort(), [...platforms].sort(), limit],
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<PaperSearchResponse> => {
      const url = new URL('/api/search/papers', window.location.origin);
      url.searchParams.set('q', q);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('start_year', String(startYear));
      url.searchParams.set('end_year', String(endYear));
      [...topics].sort().forEach(t => url.searchParams.append('topic', t));
      [...venues].sort().forEach(v => url.searchParams.append('venue', v));
      [...platforms].sort().forEach(p => url.searchParams.append('platform', p));
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Paper search failed (${res.status})`);
      return res.json();
    },
  };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/**
 * Paper matches for the search bar's text: a count button that sits inside the search field, and a
 * panel of those papers under it. Uses the same year/topic/venue filters as the list.
 */
export const PaperSearch: React.FC<PaperSearchProps> = ({ query, yearsReady, showStatistics = false, startYear, endYear, topics, platforms = EMPTY_LIST, venues }) => {
  const q = useDebounced(query.trim().slice(0, 300), 300);
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => { setLimit(PAGE); }, [q, startYear, endYear, topics, platforms, venues]);
  useEffect(() => { if (!query.trim()) setOpen(false); }, [query]);

  const enabled = yearsReady && q.length >= 2;
  const { data, isFetching, isError, refetch } = useQuery(paperSearchOptions(q, startYear, endYear, topics, venues, limit, enabled, platforms));

  // The panel is portalled to <body> (the header clips overflow), positioned under the search field.
  useLayoutEffect(() => {
    if (!open) return;
    const field = rootRef.current?.parentElement;
    if (!field) return;
    const place = () => {
      const r = field.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 360), window.innerWidth - 32);
      const left = Math.min(Math.max(16, r.right - width), window.innerWidth - width - 16);
      setAnchor({ top: r.bottom + 8, left, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);

  // Close on outside click and Escape (restoring focus on Escape).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const current = enabled && data && data.query.trim() === q ? data : null;
  const total = current?.total ?? 0;

  // Prefetch panel + DOMPurify chunk as soon as matching papers exist so opening the dropdown is instant.
  useEffect(() => {
    if (current && total > 0) void loadPaperSearchPanel();
  }, [current, total]);

  if (!enabled || (!isError && !current && !isFetching)) return null;
  // Nothing to show and the request failed: the count button becomes the way to try again.
  const failed = isError && !current && !isFetching;
  if (current && total === 0) return null;

  return (
    <div ref={rootRef} className="contents">
      {/* Count button, inside the search field (left of the clear button). */}
      <Tooltip contents content={failed ? 'Search results could not load. Select to try again.' : !current ? 'Searching papers' : open ? 'Hide matching papers' : 'Show matching papers'}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { if (failed) refetch(); else setOpen(o => !o); }}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={failed ? 'Search results could not load. Try again.' : undefined}
        disabled={!current && !failed}
        className={`${CONTROL_FOCUS} absolute right-10 top-1/2 -translate-y-1/2 flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-mono transition-colors press-scale ${open ? 'border-primary text-primary bg-primary/5' : 'border-outline text-on-surface-variant bg-surface hover:text-on-surface hover:bg-on-surface/5'} ${!current ? 'opacity-60' : ''}`}
      >
        <FileText className="w-3 h-3" aria-hidden="true" />
        {failed ? <span className="font-sans">Could not load</span> : current ? <span>{total.toLocaleString()} <span className="hidden sm:inline font-sans">{total === 1 ? 'paper' : 'papers'}</span></span> : <span className="animate-pulse">…</span>}
      </button>
      </Tooltip>

      {open && current && anchor && (
        <Suspense fallback={null}>
          <PaperSearchPanel
            panelRef={panelRef}
            panelId={panelId}
            anchor={anchor}
            current={current}
            total={total}
            limit={limit}
            isFetching={isFetching}
            isError={isError}
            showStatistics={showStatistics}
            onClose={() => { setOpen(false); triggerRef.current?.focus(); }}
            onLoadMore={() => { if (isError) refetch(); else setLimit(l => Math.min(200, l + PAGE)); }}
          />
        </Suspense>
      )}
    </div>
  );
};

/**
 * Names mode found no researcher/institution with this name: offer to count the papers matching it instead
 * (shown only when some papers match).
 */
export const TopicSearchShortcut: React.FC<PaperSearchProps & { noun: string; onSwitch: () => void }> = ({
  query, yearsReady, startYear, endYear, topics, platforms = [], venues, noun, onSwitch,
}) => {
  const q = useDebounced(query.trim().slice(0, 300), 300);
  const { data } = useQuery(paperSearchOptions(q, startYear, endYear, topics, venues, PAGE, yearsReady && q.length >= 2, platforms));
  const total = data && data.query.trim() === q ? data.total : 0;
  if (!total) return null;
  return (
    <div className="mt-6 flex flex-col items-center gap-3 normal-case tracking-normal font-sans">
      <p className="text-sm text-on-surface-variant">No {noun} named “{q}”, but {total.toLocaleString()} {total === 1 ? 'paper matches' : 'papers match'} it as a topic.</p>
      <button
        type="button"
        onClick={onSwitch}
        className={`${CONTROL_FOCUS} flex items-center gap-2 px-4 py-2 rounded-full border border-outline bg-surface text-sm text-on-surface shadow-interactive hover:bg-on-surface/5 transition-colors press-scale`}
      >
        <FileText className="w-4 h-4" aria-hidden="true" />
        Show {noun} from these {total.toLocaleString()} papers
      </button>
    </div>
  );
};
