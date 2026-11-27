import { useRef, useState } from 'react';
import { BookOpenText, FileText, Info, Landmark, Moon, Sun, User, X } from 'lucide-react';
import type { SearchScope, ViewMode } from '../../types';
import { CONTROL_FOCUS, SEGMENT_ACTIVE, SEGMENT_BUTTON, SEGMENT_INACTIVE } from '../ui/Controls';
import { Tooltip } from '../ui/Tooltip';
import { PaperSearch } from './PaperSearch';

interface HeaderBlob {
  type: string;
  backgroundColor: string;
  size: string;
  top: string;
  left: string;
  delay: string;
  duration: string;
}

function makeHeaderBlobs(): HeaderBlob[] {
  const types = ['blob-primary', 'blob-secondary'];
  return Array.from({ length: Math.floor(Math.random() * 5) + 3 }, () => {
    const mixPercentage = Math.floor(Math.random() * 11) + 10;
    return {
      type: types[Math.floor(Math.random() * types.length)],
      backgroundColor: `color-mix(in oklab, var(--base-blob-color, var(--primary)) ${mixPercentage}%, var(--surface))`,
      size: `${Math.floor(Math.random() * 21) + 15}%`,
      top: `${Math.floor(Math.random() * 100)}%`,
      left: `${Math.floor(Math.random() * 100)}%`,
      delay: `-${Math.random() * 10}s`,
      duration: `${Math.floor(Math.random() * 5) + 8}s`,
    };
  });
}

interface SiteHeaderProps {
  inert: boolean;
  isTabletUp: boolean;
  yearsReady: boolean;
  shouldCollapseMobileActions: boolean;
  isResultsAtTop: boolean;
  showStatistics: boolean;
  viewMode: ViewMode;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchScope: SearchScope;
  setSearchScope: (scope: SearchScope) => void;
  startYear: number;
  endYear: number;
  topicFilter: string[];
  platformFilter: string[];
  selectedVenues: string[];
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  onScrollTop: () => void;
  onOpenAbout: () => void;
  onOpenMethodology: () => void;
}

export function SiteHeader({
  inert,
  isTabletUp,
  yearsReady,
  shouldCollapseMobileActions,
  isResultsAtTop,
  showStatistics,
  viewMode,
  searchQuery,
  setSearchQuery,
  searchScope,
  setSearchScope,
  startYear,
  endYear,
  topicFilter,
  platformFilter,
  selectedVenues,
  theme,
  toggleTheme,
  onScrollTop,
  onOpenAbout,
  onOpenMethodology,
}: SiteHeaderProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [headerBlobs] = useState<HeaderBlob[]>(makeHeaderBlobs);

  return (
    <header
      inert={inert}
      className={`site-header px-fluid lg:py-8 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:items-center md:flex md:flex-row md:flex-nowrap md:py-6 justify-between md:items-center lg:items-end border-b-2 border-outline shrink-0 relative z-20 bg-surface bg-grain transition-all duration-500 ease-[var(--ease-spring-gentle)] md:gap-5 ${
        shouldCollapseMobileActions ? 'max-md:gap-0 max-md:py-2' : 'max-md:gap-3 max-md:py-4'
      }`}
    >
      {headerBlobs.map((blob, i) => (
        <div
          key={i}
          className={`header-blob ${blob.type}`}
          style={{
            backgroundColor: blob.backgroundColor,
            width: blob.size,
            aspectRatio: '1 / 1',
            top: blob.top,
            left: blob.left,
            animationDelay: blob.delay,
            animationDuration: blob.duration,
          }}
        />
      ))}

      <div
        className={`site-brand flex flex-col w-full md:w-auto relative z-20 flex-none md:flex-1 min-w-0 md:min-w-min order-1 transition-all duration-300 max-md:overflow-hidden ${
          shouldCollapseMobileActions ? 'max-md:max-h-0 max-md:opacity-0' : 'max-md:max-h-40 max-md:opacity-100'
        }`}
      >
        <h1 className="m-0 font-logo font-normal text-fluid-logo uppercase tracking-tight leading-none flex justify-between items-center w-full break-words md:whitespace-nowrap">
          <span className="flex items-center gap-1.5 sm:gap-2">
            <img src="/qatalogue.svg" alt="" className="h-[1.02em] w-auto" />
            <span>QATALOGUE</span>
          </span>
        </h1>
        <div
          className={`site-subtitle max-md:hidden text-sm text-on-surface-variant font-sans leading-relaxed overflow-hidden transition-all duration-300 ${
            isResultsAtTop
              ? 'mt-2 max-h-20 opacity-100'
              : 'max-lg:mt-0 max-lg:max-h-0 max-lg:opacity-0 lg:mt-2 lg:max-h-20 lg:opacity-100'
          }`}
        >
          An Open Bibliometric Explorer for Quantum Information Science and Technology
        </div>
      </div>

      <div className="flex flex-row items-center max-md:self-end md:self-auto w-full md:w-auto md:flex-[0_1_500px] md:min-w-[16rem] justify-end relative z-20 transition-all duration-300 gap-0 md:gap-4 max-md:order-4 md:order-2 lg:order-2 max-md:col-span-2">
        <button
          type="button"
          aria-label="Back to the top"
          tabIndex={shouldCollapseMobileActions ? 0 : -1}
          aria-hidden={!shouldCollapseMobileActions}
          onClick={onScrollTop}
          className={`md:hidden shrink-0 flex items-center justify-start overflow-hidden border-0 bg-transparent p-0 cursor-pointer rounded-sm ${CONTROL_FOCUS} transition-all duration-300 ${
            shouldCollapseMobileActions ? 'w-9 mr-2 opacity-100' : 'w-0 mr-0 opacity-0 pointer-events-none'
          }`}
        >
          <img src="/qatalogue.svg" alt="" className="h-8 w-8 max-w-none" />
        </button>

        <div className="relative z-20 w-full max-w-full flex-shrink min-w-0 transition-all duration-500 ease-[var(--ease-spring-gentle)]">
          <div className="absolute inset-y-1 left-1 z-10 flex items-center gap-0.5" role="group" aria-label="Search by">
            {(showStatistics ? (['papers'] as const) : (['names', 'papers'] as const)).map(scope => {
              const Icon = scope === 'papers' ? FileText : viewMode === 'institution' ? Landmark : User;
              const label = scope === 'names'
                ? `Search ${viewMode === 'institution' ? 'institutions' : 'researchers'} by name`
                : 'Search topics (count only matching papers)';
              return (
                <Tooltip key={scope} contents content={label}>
                  <button
                    type="button"
                    onClick={() => { setSearchScope(scope); searchInputRef.current?.focus(); }}
                    aria-pressed={searchScope === scope}
                    aria-label={label}
                    className={`${SEGMENT_BUTTON} h-full aspect-square ${searchScope === scope ? SEGMENT_ACTIVE : SEGMENT_INACTIVE}`}
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </Tooltip>
              );
            })}
            <span aria-hidden="true" className="ml-1 h-5 w-px bg-outline" />
          </div>

          <input
            ref={searchInputRef}
            type="text"
            aria-label={searchScope === 'names' ? `Search ${viewMode === 'institution' ? 'institutions' : 'researchers'} by name` : 'Search a topic'}
            placeholder={searchScope === 'names' ? `Search ${viewMode === 'institution' ? 'institutions' : 'researchers'}...` : 'Search papers by topic...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full h-10 pointer-coarse:h-12 bg-surface border border-outline rounded-full ${
              showStatistics ? 'pl-[3.25rem] pointer-coarse:pl-[3.75rem]' : 'pl-[5.5rem] pointer-coarse:pl-[6.5rem]'
            } ${
              searchScope === 'papers' && searchQuery.trim().length >= 2 ? 'pr-24 sm:pr-36' : 'pr-10'
            } text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary transition-all ease-[var(--ease-spring)] shadow-interactive focus-glow`}
          />

          {searchQuery && (
            <Tooltip contents content="Clear search">
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className={`${CONTROL_FOCUS} absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-transparent border-none text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5 transition-colors press-scale`}
                aria-label="Clear search"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </Tooltip>
          )}

          {searchScope === 'papers' && (
            <PaperSearch
              query={searchQuery}
              yearsReady={yearsReady}
              showStatistics={showStatistics}
              startYear={startYear}
              endYear={endYear}
              topics={topicFilter}
              platforms={platformFilter}
              venues={selectedVenues}
            />
          )}
        </div>
      </div>

      <div
        inert={shouldCollapseMobileActions && !isTabletUp}
        className={`flex items-center md:w-auto md:shrink-0 justify-end transition-all duration-300 overflow-hidden gap-2 sm:gap-4 order-2 md:order-3 lg:order-3 ${
          shouldCollapseMobileActions
            ? 'max-md:max-h-0 max-md:opacity-0 md:max-h-[100px] md:opacity-100 md:overflow-visible'
            : 'max-h-[100px] opacity-100 overflow-visible'
        }`}
      >
        <Tooltip contents content="About Qatalogue">
          <button
            type="button"
            onClick={onOpenAbout}
            aria-haspopup="dialog"
            aria-label="About Qatalogue"
            className={`${CONTROL_FOCUS} md:hidden bg-surface border border-outline text-on-surface w-10 h-10 rounded-full cursor-pointer hover:bg-surface-variant transition-colors flex items-center justify-center shadow-interactive press-scale`}
          >
            <Info className="w-4 h-4" aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip contents content="Methodology">
          <button
            type="button"
            onClick={onOpenMethodology}
            aria-haspopup="dialog"
            aria-label="Methodology"
            className={`${CONTROL_FOCUS} bg-surface border border-outline text-on-surface w-10 h-10 rounded-full cursor-pointer hover:bg-surface-variant transition-colors flex items-center justify-center shadow-interactive press-scale`}
          >
            <BookOpenText className="w-4 h-4" aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip contents content={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
          <button
            type="button"
            onClick={toggleTheme}
            className={`${CONTROL_FOCUS} bg-surface border border-outline text-on-surface w-10 h-10 rounded-full cursor-pointer hover:bg-surface-variant transition-colors flex items-center justify-center shadow-interactive press-scale`}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
