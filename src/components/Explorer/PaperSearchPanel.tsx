import React from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';
import { LOADING } from '../../lib/messages';
import { sanitizePaperTitle } from '../../lib/sanitizeHtml';
import { paperLink } from '../../types';
import { CONTROL_FOCUS } from '../ui/Controls';
import { HelpHint } from '../ui/HelpHint';
import { Shimmer } from '../ui/Shimmer';
import { Tooltip } from '../ui/Tooltip';
import type { PaperSearchResponse } from './PaperSearch';

const FIELD_LABEL: Record<string, string> = { title: 'Title', keywords: 'Keywords', abstract: 'Abstract', text: 'Text' };

interface PaperSearchPanelProps {
  panelRef: React.RefObject<HTMLDivElement | null>;
  panelId: string;
  anchor: { top: number; left: number; width: number };
  current: PaperSearchResponse;
  total: number;
  limit: number;
  isFetching: boolean;
  isError: boolean;
  showStatistics?: boolean;
  onClose: () => void;
  onLoadMore: () => void;
}

const PAGE = 20;

/** Portalled dropdown listing matching papers and highlighting matched fields. */
export const PaperSearchPanel: React.FC<PaperSearchPanelProps> = ({
  panelRef,
  panelId,
  anchor,
  current,
  total,
  limit,
  isFetching,
  isError,
  showStatistics = false,
  onClose,
  onLoadMore,
}) =>
  createPortal(
    <div
      ref={panelRef}
      id={panelId}
      role="region"
      aria-label="Matching papers"
      style={{ top: anchor.top, left: anchor.left, width: anchor.width, maxHeight: `min(70vh, ${Math.max(240, window.innerHeight - anchor.top - 16)}px)` }}
      className="fixed z-[60] bg-surface border border-outline rounded-xl shadow-popover flex flex-col"
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-outline">
        <div className="text-xs text-on-surface-variant leading-relaxed min-w-0">
          <span className="font-mono text-primary font-bold">{total.toLocaleString()}</span>{' '}
          {total === 1 ? 'paper matches' : 'papers match'} <span className="text-on-surface break-words">“{current.query}”</span>
          <div className="text-[11px] opacity-80">
            {showStatistics
              ? 'Charts are computed from these papers (before location filters).'
              : 'The list and network are computed from these papers.'}
          </div>
          {current.expansions.length > 0 && (
            <div className="text-[11px] opacity-80">
              {current.expansions.map(e => `${e.acronym} = ${e.expansion}`).join(' · ')}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <HelpHint label="How paper search works">
            Papers match on the words in their title, keywords, and abstract, and on meaning, so papers with different wording still appear. Results follow the current filters.
          </HelpHint>
          <Tooltip contents content="Close paper results">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close paper results"
              className={`${CONTROL_FOCUS} w-7 h-7 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5 press-scale`}
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>

      <ol className="overflow-y-auto px-4 py-2 flex flex-col">
        {current.results.map(p => {
          const link = paperLink(p);
          return (
            <li key={p.paper_id} className="py-2.5 border-b border-outline/60 last:border-b-0">
              <Tooltip contents content={link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/link text-sm text-on-surface hover:text-primary transition-colors leading-snug inline"
                >
                  <span dangerouslySetInnerHTML={{ __html: sanitizePaperTitle(p.title) }} />
                  <ExternalLink className="inline w-3 h-3 ml-1 -mt-0.5 opacity-0 group-hover/link:opacity-70 transition-opacity" aria-hidden="true" />
                </a>
              </Tooltip>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-on-surface-variant">
                <span>{p.venue_name}{p.year != null && <> <span className="font-mono opacity-80">({p.year})</span></>}</span>
                <span className="flex gap-1">
                  {(p.meaning ? ['meaning'] : p.matched_in).map(f => (
                    <span key={f} className="px-1.5 py-px rounded-full border border-outline text-[10px] leading-4 font-mono uppercase tracking-wider opacity-80">
                      {f === 'meaning' ? 'Related' : FIELD_LABEL[f] ?? f}
                    </span>
                  ))}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {current.results.length < total && (
        <div className="px-4 py-2.5 border-t border-outline flex items-center justify-between text-xs text-on-surface-variant">
          <span className="font-mono">{current.results.length.toLocaleString()} of {total.toLocaleString()}</span>
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetching || (!isError && limit >= 200)}
            className={`${CONTROL_FOCUS} px-3 py-1 rounded-full border border-outline bg-surface hover:bg-on-surface/5 text-on-surface transition-colors press-scale disabled:opacity-50`}
          >
            {isError && !isFetching
              ? 'More could not load. Try again'
              : limit >= 200
                ? 'Showing the 200 closest matches'
                : isFetching
                  ? <Shimmer className="font-mono uppercase tracking-wider">{LOADING.search}</Shimmer>
                  : `Show ${Math.min(PAGE, total - current.results.length)} more`}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );

export default PaperSearchPanel;
