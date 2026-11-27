import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import { CONTROL_FOCUS } from '../ui/Controls';
import { useAnimatedClose } from '../../hooks/useAnimatedClose';
import { useDialog } from '../../hooks/useDialog';
import { useExplorerContext } from '../../context/ExplorerContext';
import { useQuery } from '@tanstack/react-query';
import { CORRECTION_HREF } from '../../config/correctionLink';
import { ISSUES_URL, SOURCE_URL } from '../../config/siteConfig';

interface MethodologyModalProps {
  onClose: () => void;
}

/** The corpus as the last build served it (public/config/corpus.json, written from pipeline/config/scope.json). */
interface CorpusItem { name: string; openalex_id: string }
interface Corpus { venues: CorpusItem[]; corpus_topics: CorpusItem[] }

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
/** Words below ten, numerals from ten: "eight topics", "16 venues". */
const countOf = (n: number) => COUNT_WORDS[n] ?? n.toLocaleString();

const SourceLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="text-on-surface-variant hover:text-primary transition-colors underline underline-offset-2 decoration-outline">
    {children}
  </a>
);

export const MethodologyModal: React.FC<MethodologyModalProps> = ({ onClose }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const { close, overlayClass, cardClass, onAnimationEnd } = useAnimatedClose(onClose);
  useDialog(contentRef, close);
  const { yearMin, yearMax, yearsReady } = useExplorerContext();
  const { data: corpus, isError: corpusFailed } = useQuery<Corpus>({
    queryKey: ['corpus'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/config/corpus.json', { signal });
      if (!res.ok) throw new Error('Corpus request failed');
      return res.json();
    },
    staleTime: Infinity,
  });

  const renderLinks = (items: CorpusItem[]) => {
    return items.map((item, i) => (
      <React.Fragment key={item.openalex_id}>
        <a
          href={`https://openalex.org/${item.openalex_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-on-surface-variant hover:text-primary transition-colors hover:underline underline-offset-2 decoration-outline italic"
        >
          {item.name}
        </a>
        {i < items.length - 1 ? ", " : ""}
      </React.Fragment>
    ));
  };

  const hasFeedback = Boolean(CORRECTION_HREF || ISSUES_URL);
  const sourceTitle = SOURCE_URL && hasFeedback ? 'Source & Corrections' : SOURCE_URL ? 'Source' : 'Corrections';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 glass-overlay ${overlayClass}`}
      onClick={close}
    >
      <div
        ref={contentRef}
        className={`bg-surface border border-outline max-w-[640px] w-full max-h-[calc(100dvh-2rem)] md:max-h-none md:h-[85vh] flex flex-col overflow-hidden shadow-popover ${cardClass}`}
        onClick={e => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
        role="dialog"
        aria-modal="true"
        aria-labelledby="methodology-title"
      >
        {/* As the site's other pop-ups: the title and its close button stay in view while the text scrolls. */}
        <div className="shrink-0 flex justify-between items-center border-b border-outline px-6 md:px-12 py-5 md:py-6">
          <div id="methodology-title" className="font-display font-extrabold text-xl md:text-2xl tracking-tight uppercase text-on-surface">
            Methodology
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

        <div className="min-h-0 flex-1 overflow-y-auto px-6 md:px-12 py-8">
        <div className="flex flex-col gap-8">
          <section>
            <h3 className="m-0 font-display text-xs font-bold tracking-wider uppercase text-primary mb-2">Scope</h3>
            <p className="m-0 text-sm leading-relaxed text-on-surface-variant mb-4">
              Primary research articles in Quantum Information Science and Technology{yearsReady && <> from {yearMin} through {yearMax}</>}, sourced from <SourceLink href="https://openalex.org">OpenAlex</SourceLink>.
            </p>
            {corpus ? (<>
              <p className="m-0 text-sm leading-relaxed text-on-surface-variant mb-3">
                Selected from {countOf(corpus.venues.length)} venues:
              </p>
              <div className="bg-surface-variant p-4 rounded-md mb-4 text-sm text-on-surface-variant leading-relaxed">
                {renderLinks(corpus.venues)}.
              </div>
              <p className="m-0 text-sm leading-relaxed text-on-surface-variant mb-3">
                Filtered to {countOf(corpus.corpus_topics.length)} OpenAlex topics:
              </p>
              <div className="bg-surface-variant p-4 rounded-md text-sm text-on-surface-variant leading-relaxed">
                {renderLinks(corpus.corpus_topics)}.
              </div>
            </>) : (
              <p className="m-0 text-sm leading-relaxed text-on-surface-variant">
                {corpusFailed ? 'The list of venues and topics couldn’t be loaded.' : 'Loading the list of venues and topics…'}
              </p>
            )}
          </section>

          <section>
            <h3 className="m-0 font-display text-xs font-bold tracking-wider uppercase text-primary mb-2">Processing</h3>
            <p className="m-0 text-sm leading-relaxed text-on-surface-variant mb-3">
              Non-research items (reviews, news, commentary, errata) are excluded using OpenAlex metadata and publisher article types from Springer Nature and APS. Abstracts and subject categories from <SourceLink href="https://arxiv.org">arXiv</SourceLink> are used for topic and hardware-platform assignment (a paper may belong to several) and paper search.
            </p>
            <p className="m-0 text-sm leading-relaxed text-on-surface-variant mb-3">
              Author records are merged using <SourceLink href="https://orcid.org">ORCID</SourceLink>, names, affiliations, and coauthors; institutions are matched to <SourceLink href="https://ror.org">ROR</SourceLink> and grouped by location and world region.
            </p>
            <p className="m-0 text-sm leading-relaxed text-on-surface-variant">
              Upstream metadata and automated matching carry some noise.
            </p>
          </section>

          {(SOURCE_URL || hasFeedback) && (
          <section>
            <h3 className="m-0 font-display text-xs font-bold tracking-wider uppercase text-primary mb-2">{sourceTitle}</h3>
            {SOURCE_URL && (
              <p className={`m-0 text-sm leading-relaxed text-on-surface-variant${hasFeedback ? ' mb-3' : ''}`}>
                Source code is available on <SourceLink href={SOURCE_URL}>GitHub</SourceLink>.
              </p>
            )}
            {hasFeedback && (
              <p className="m-0 text-sm leading-relaxed text-on-surface-variant">
                {CORRECTION_HREF && <>To fix a record, <a href={CORRECTION_HREF} className="text-on-surface-variant hover:text-primary transition-colors underline underline-offset-2 decoration-outline">email a correction</a>.</>}
                {CORRECTION_HREF && ISSUES_URL && ' '}
                {ISSUES_URL && <>For a bug or suggestion, <SourceLink href={ISSUES_URL}>open an issue</SourceLink>.</>}
              </p>
            )}
          </section>
          )}
        </div>

        </div>

      </div>
    </div>
  );
};

export default MethodologyModal;
