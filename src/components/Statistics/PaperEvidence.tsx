import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { CONTROL_BUTTON, CONTROL_FOCUS } from '../ui/Controls';
import { Tooltip } from '../ui/Tooltip';
import { sanitizePaperTitle } from '../../lib/sanitizeHtml';
import { useAnimatedClose } from '../../hooks/useAnimatedClose';
import { useDialog } from '../../hooks/useDialog';
import { EVIDENCE_PAGE_SIZE, type EvidencePage, type PaperGroup } from '../../../shared/chart';
import { getInstitutionLink } from '../Rows/utils';
import type { EntityRef } from './figureConfig';
import { paperLink } from '../../types';
import { FigureError, FigureLoading, FigureSegmented } from './FigureFrame';
import { useFigureStats } from './useCrosstab';

export interface EvidenceSelection {
  title: string;
  groups: PaperGroup[];
  bin?: number;
  entity?: EntityRef;
  applyFilters?: () => void;
}

// The site's other pop-ups (the query prompt, the methodology): a header with the title and a round close button, a
// scrolling body, and a footer holding the main action. Phones get narrower padding: this one can open there.
const EDGE = 'px-5 md:px-10';
const LINK = `${CONTROL_FOCUS} rounded-sm text-on-surface transition-colors hover:text-primary hover:underline underline-offset-2 decoration-outline`;

/** The papers or institutions behind a chart mark, a page at a time, with the option to filter to them. */
export function PaperEvidence({ selection, onClose }: { selection: EvidenceSelection; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { close, overlayClass, cardClass, onAnimationEnd } = useAnimatedClose(onClose);
  useDialog(ref, close);
  const [view, setView] = useState<'papers' | 'institutions'>('papers');
  const [page, setPage] = useState(0);
  const [first, second] = selection.groups;
  const params: Record<string, string> = { page: String(page), view };
  if (first) { params.field = first.field; params.value = first.id; }
  if (second) { params.secondField = second.field; params.secondValue = second.id; }
  if (selection.entity) params.entity = `${selection.entity.kind}:${selection.entity.id}`;
  if (selection.bin) params.bin = String(selection.bin);
  const { data, error, isFetching, refetch } = useFigureStats<EvidencePage>('evidence', params, true);
  const pages = data ? Math.ceil(data.total / EVIDENCE_PAGE_SIZE) : 0;
  const range = data?.total
    ? `${(page * EVIDENCE_PAGE_SIZE + 1).toLocaleString()}–${Math.min((page + 1) * EVIDENCE_PAGE_SIZE, data.total).toLocaleString()} of ${data.total.toLocaleString()} ${view}`
    : data ? `No matching ${view}` : '';

  return createPortal(
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 glass-overlay ${overlayClass}`} onClick={close}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="evidence-title" onClick={e => e.stopPropagation()} onAnimationEnd={onAnimationEnd}
        className={`flex max-h-[85dvh] w-full max-w-[640px] flex-col overflow-hidden border border-outline bg-surface shadow-popover ${cardClass}`}>
        <header className={`flex shrink-0 items-start justify-between gap-4 border-b border-outline py-5 md:py-6 ${EDGE}`}>
          <div className="min-w-0">
            <h2 id="evidence-title" className="m-0 font-display text-lg font-extrabold uppercase tracking-tight text-on-surface [overflow-wrap:anywhere] md:text-xl">{selection.title}</h2>
            <p className="m-0 mt-1 text-xs text-on-surface-variant">Papers behind this mark, under the current filters</p>
          </div>
          <Tooltip contents content="Close">
            <button type="button" onClick={close} aria-label="Close"
              className={`${CONTROL_FOCUS} flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-transparent p-2 text-on-surface shadow-interactive transition-colors hover:bg-on-surface/5 press-scale`}>
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </Tooltip>
        </header>

        <div className={`flex shrink-0 items-center justify-between gap-3 border-b border-outline py-3 ${EDGE}`}>
          <FigureSegmented label="Show matching records" value={view} onChange={v => { setView(v); setPage(0); }}
            options={[{ value: 'papers', label: 'Papers' }, { value: 'institutions', label: 'Institutions' }]} />
          <span className="text-xs text-on-surface-variant" aria-live="polite">{range}</span>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto py-2 ${EDGE}`}>
          {error ? <FigureError onRetry={() => refetch()} retrying={isFetching} /> : !data ? <FigureLoading /> : (
            <ul className={`m-0 list-none divide-y divide-outline-variant p-0 text-sm transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
              {data.papers?.map(p => <li key={p.paper_id} className="py-2.5">
                <a className={`font-medium ${LINK}`} href={paperLink(p).href} target="_blank" rel="noopener noreferrer" dangerouslySetInnerHTML={{ __html: sanitizePaperTitle(p.title) }} />
                <div className="mt-0.5 text-xs text-on-surface-variant">{p.venue_name}{p.year != null && ` · ${p.year}`}</div>
              </li>)}
              {data.institutions?.map(i => {
                const href = getInstitutionLink({ ror: i.ror, institution_id: i.id });
                return (
                  <li key={i.id} className="flex items-baseline justify-between gap-3 py-2.5">
                    {href
                      ? <a href={href} className={`font-medium ${LINK}`} target="_blank" rel="noopener noreferrer">{i.name}</a>
                      : <span className="font-medium text-on-surface">{i.name}</span>}
                    <span className="shrink-0 font-mono text-xs text-on-surface-variant">{i.papers.toLocaleString()} {i.papers === 1 ? 'paper' : 'papers'}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className={`flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-outline py-4 md:py-5 ${EDGE}`}>
          {pages > 1 ? (
            <div className="flex items-center gap-2" role="group" aria-label="Pages">
              <button type="button" disabled={page === 0} className={CONTROL_BUTTON} onClick={() => setPage(page - 1)} aria-label="Previous page">
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="font-mono text-xs text-on-surface-variant">{page + 1} / {pages}</span>
              <button type="button" disabled={page + 1 >= pages} className={CONTROL_BUTTON} onClick={() => setPage(page + 1)} aria-label="Next page">
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : <span />}
          {selection.applyFilters && (
            <button type="button" onClick={() => { selection.applyFilters?.(); close(); }}
              className={`${CONTROL_FOCUS} ml-auto inline-flex h-9 cursor-pointer items-center justify-center rounded-full bg-primary px-6 font-display text-xs font-bold uppercase tracking-wider text-on-primary shadow-interactive transition-all duration-300 ease-[var(--ease-spring)] press-scale pointer-coarse:h-[2.875rem]`}>
              Apply as filters
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
