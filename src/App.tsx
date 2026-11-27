import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Filter } from 'lucide-react';
import { ListCaution } from './components/Explorer/ListCaution';
import { MobileTabBar, PhoneViewSwitch } from './components/Explorer/MobileTabBar';
import { ResultsList } from './components/Explorer/ResultsList';
import { ResultsNavigation, showsLayout, type ResultsView } from './components/Explorer/ResultsNavigation';
import { SiteCredit, SyncStatus } from './components/Explorer/SiteFooter';
import { SiteHeader } from './components/Explorer/SiteHeader';
import { QueryPromptModal, type QueryPromptNavigation } from './components/Modals/QueryPromptModal';
import { ListHeader } from './components/Rows/ListHeader';
import { Sidebar } from './components/Sidebar/Sidebar';
import { CONTROL_BUTTON, CONTROL_FOCUS } from './components/ui/Controls';
import { CopyLinkButton } from './components/ui/CopyLinkButton';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { LoadFailure } from './components/ui/LoadFailure';
import { Shimmer } from './components/ui/Shimmer';
import { useExplorerContext } from './context/ExplorerContext';
import { entryId, type ViewMode } from './hooks/useExplorerData';
import { useFirstQueryPrompt } from './hooks/useFirstQueryPrompt';
import { usePendingSwitch } from './hooks/usePendingSwitch';
import { useResponsiveShell } from './hooks/useResponsiveShell';
import { useTheme } from './hooks/useTheme';
import { LOADING } from './lib/messages';

// Loaded on demand so List-only visitors don't pay for d3 + graphology, chart views, or info modals.
const NetworkView = lazy(() => import('./components/Network/NetworkView'));
const StatisticsView = lazy(() => import('./components/Statistics/StatisticsView'));
const AboutModal = lazy(() => import('./components/Modals/AboutModal'));
const MethodologyModal = lazy(() => import('./components/Modals/MethodologyModal'));

const FILTER_BUTTON = `${CONTROL_BUTTON} shrink-0`;

function ResultsLoading({ view }: { view: ResultsView }) {
  return (
    <div role="status" className={view === 'network' ? 'flex flex-1 items-center justify-center' : 'flex justify-center p-10 lg:p-16'}>
      <Shimmer as="div" className="font-mono text-sm uppercase tracking-wider">
        {view === 'statistics' ? LOADING.charts : view === 'network' ? LOADING.network : LOADING.list}
      </Shimmer>
    </div>
  );
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [isMethodologyOpen, setMethodologyOpen] = useState(false);
  const [isAboutOpen, setAboutOpen] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const {
    isSidebarOpen,
    setIsSidebarOpen,
    isDockOpen,
    setDockOpen,
    isTabletUp,
    isScrolled,
    setIsScrolled,
    isResultsAtTop,
    compactFiltersRef,
    mobileSidebarScrollRef,
    handleResultsScroll,
  } = useResponsiveShell(parentRef);

  const {
    generatedAt,
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    searchScope,
    setSearchScope,
    nameQuery,
    paperQuery,
    paperQueryPending,
    loading,
    error,
    retryLoad,
    retrying,
    yearsReady,
    selectedLocations,
    sortConfig,
    handleSort,
    expandedRows,
    toggleRow,
    filteredAndSortedEntries,
    taxonomy,
    topicName,
    platformName,
    selectedTopics,
    selectedPlatforms,
    topicFilter,
    platformFilter,
    selectedVenues,
    startYear,
    endYear,
    setFacultyMinContribution,
    setInstitutionMinContribution,
    setAvgContributionMin,
    metricMode,
    displayMode,
    setDisplayMode,
    section,
    setSection,
    locationMapping,
    activeFilterCount,
    networkEntries,
    networkTotal,
    networkLayout,
    networkLayoutChoice,
    setNetworkLayout,
  } = useExplorerContext();

  const queryPrompt = useFirstQueryPrompt(viewMode);
  const showStatistics = section === 'statistics';
  const showNetwork = !showStatistics && displayMode === 'network';
  const resultsView: ResultsView = showStatistics ? 'statistics' : showNetwork ? 'network' : 'list';
  const [openingView, setOpeningView] = useState<ResultsView | null>(null);
  const isOpeningView = openingView === resultsView;

  useEffect(() => {
    if (!openingView) return;
    // Leave a paint between selecting the tab and mounting results, even when their data is cached.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setOpeningView(null));
    });
    return () => cancelAnimationFrame(frame);
  }, [openingView]);

  const selectResultsView = (next: ResultsView) => {
    if (next === resultsView) return;
    setOpeningView(next);
    setSection(next === 'statistics' ? 'statistics' : 'explore');
    if (next !== 'statistics') setDisplayMode(next);
    if (parentRef.current) parentRef.current.scrollTop = 0;
  };

  // Switches show their new value at once. The results show the loading message until the new value has rendered.
  const focusSwitch = usePendingSwitch(viewMode, (next: ViewMode) => {
    setViewMode(next);
    if (searchScope === 'names') setSearchQuery('');
    setFacultyMinContribution(0);
    setInstitutionMinContribution(0);
    setAvgContributionMin(0);
  });
  const shownFocus = focusSwitch.shown;
  const isSwitchingFocus = focusSwitch.switching;
  const selectFocus = (next: ViewMode) => {
    focusSwitch.select(next);
    if (parentRef.current) parentRef.current.scrollTop = 0;
  };
  const layoutSwitch = usePendingSwitch(networkLayoutChoice, setNetworkLayout);

  const navigation: QueryPromptNavigation = {
    view: resultsView,
    onViewChange: selectResultsView,
    focus: shownFocus,
    onFocusChange: selectFocus,
    layout: layoutSwitch.shown,
    onLayoutChange: layoutSwitch.select,
  };

  const phoneViewSwitch = (besideButtons = false) => (
    <PhoneViewSwitch
      view={showNetwork ? 'network' : 'list'}
      onViewChange={selectResultsView}
      layout={layoutSwitch.shown}
      onLayoutChange={layoutSwitch.select}
      showLayout={showsLayout(resultsView, shownFocus)}
      besideButtons={besideButtons}
    />
  );

  // Clicking a node opens that entry in the list: switch back, expand it, scroll to it.
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const handleScrolledToPending = useCallback(() => setPendingScrollId(null), []);
  const handleNetworkSelect = (id: string) => {
    if (!filteredAndSortedEntries.some(e => entryId(e) === id)) setSearchQuery('');
    if (!expandedRows.has(id)) toggleRow(id);
    selectResultsView('list');
    setPendingScrollId(id);
  };

  const rowNumberDigits = Math.max(3, filteredAndSortedEntries.length.toLocaleString().length);
  const rowNumberWidth = `calc(${rowNumberDigits * 0.5}rem + var(--list-number-gutter))`;

  return (
    <div className="flex flex-col h-[100dvh] max-w-[2560px] mx-auto w-full overflow-hidden bg-background text-on-background relative">
      <SiteHeader
        inert={isSidebarOpen}
        isTabletUp={isTabletUp}
        yearsReady={yearsReady}
        shouldCollapseMobileActions={isScrolled}
        isResultsAtTop={isResultsAtTop}
        showStatistics={showStatistics}
        viewMode={viewMode}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchScope={searchScope}
        setSearchScope={setSearchScope}
        startYear={startYear}
        endYear={endYear}
        topicFilter={topicFilter}
        platformFilter={platformFilter}
        selectedVenues={selectedVenues}
        theme={theme}
        toggleTheme={toggleTheme}
        onScrollTop={() => {
          const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          parentRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
          setIsScrolled(false);
        }}
        onOpenAbout={() => setAboutOpen(true)}
        onOpenMethodology={() => setMethodologyOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden relative min-h-0">
        <div
          id="docked-filters"
          className={`hidden ${isDockOpen ? 'md:block' : ''} w-[320px] xl:w-[clamp(400px,22vw,480px)] shrink-0 border-r border-outline-variant bg-surface-variant h-full z-10`}
        >
          <Sidebar onClose={() => setDockOpen(false)} closeLabel="Hide filters" />
        </div>

        <div
          id="compact-filters"
          ref={compactFiltersRef}
          role="dialog"
          aria-label="Filters"
          aria-modal={isSidebarOpen}
          inert={!isSidebarOpen}
          className={`absolute inset-y-0 left-0 z-40 flex w-full flex-col overflow-hidden bg-surface-variant shadow-popover transition-transform duration-300 ease-[var(--ease-spring-gentle)] md:hidden ${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar
            className="border-r-0 flex-1 min-h-0"
            onClose={() => setIsSidebarOpen(false)}
            scrollContainerRef={mobileSidebarScrollRef}
            onScroll={handleResultsScroll}
          />
          <div className="shrink-0 border-t border-outline bg-surface px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className={`${CONTROL_FOCUS} w-full min-h-12 rounded-full bg-primary text-on-primary font-display text-xs font-bold uppercase tracking-wider shadow-interactive press-scale cursor-pointer`}
            >
              {showStatistics || loading
                ? 'Show results'
                : `Show ${filteredAndSortedEntries.length.toLocaleString()} ${viewMode === 'institution' ? 'institutions' : 'researchers'}`}
            </button>
          </div>
        </div>

        {/* The `results` container: the list's columns follow its width, which the docked filters change (Rows/utils.ts). */}
        <main
          inert={isSidebarOpen}
          className="@container/results flex-1 overflow-hidden relative flex flex-col w-full h-full min-h-0 [--list-number-gutter:0.75rem] md:[--list-number-gutter:1.5rem]"
          style={{ '--list-number-width': rowNumberWidth } as React.CSSProperties}
        >
          <div className="max-md:hidden">
            <ResultsNavigation
              {...navigation}
              actions={
                <>
                  <button
                    type="button"
                    aria-expanded={isDockOpen}
                    aria-controls="docked-filters"
                    onClick={() => setDockOpen(true)}
                    className={`${FILTER_BUTTON} ${isDockOpen ? 'md:hidden' : ''}`}
                  >
                    <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only @md:not-sr-only">Filters</span>
                  </button>
                  <CopyLinkButton />
                </>
              }
            />
          </div>

          {showNetwork && (isOpeningView || isSwitchingFocus || loading) && <ResultsLoading view="network" />}
          {showNetwork && !isOpeningView && !isSwitchingFocus && !loading && error && (
            <div className="p-10 lg:p-16"><LoadFailure what="The network" onRetry={retryLoad} retrying={retrying} /></div>
          )}
          {showNetwork && !isOpeningView && !isSwitchingFocus && !loading && !error && (
            <ErrorBoundary>
              <Suspense fallback={<ResultsLoading view="network" />}>
                <NetworkView
                  key={viewMode}
                  entries={networkEntries}
                  viewMode={viewMode}
                  metricMode={metricMode}
                  layout={networkLayout}
                  searchQuery={nameQuery}
                  paperQuery={paperQuery}
                  total={networkTotal}
                  startYear={startYear}
                  endYear={endYear}
                  selectedTopics={selectedTopics}
                  selectedPlatforms={selectedPlatforms}
                  topicFilter={topicFilter}
                  platformFilter={platformFilter}
                  topicName={topicName}
                  platformName={platformName}
                  selectedVenues={selectedVenues}
                  selectedLocations={selectedLocations}
                  locationMapping={locationMapping}
                  theme={theme}
                  onSelect={handleNetworkSelect}
                  controls={phoneViewSwitch(true)}
                  switching={layoutSwitch.switching}
                />
              </Suspense>
            </ErrorBoundary>
          )}

          {resultsView === 'list' && !isSwitchingFocus && (
            <>
              <ListHeader viewMode={viewMode} metricMode={metricMode} sort={sortConfig} onSort={handleSort} phoneControls={phoneViewSwitch()} />
              <ListCaution viewMode={viewMode} onOpenMethodology={() => setMethodologyOpen(true)} />
            </>
          )}

          <div
            ref={parentRef}
            className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] px-2 md:px-0 md:pr-1.5 lg:pr-0 lg:mr-2.5 ${showNetwork ? 'hidden' : ''}`}
            onScroll={handleResultsScroll}
          >
            {showNetwork ? null : isOpeningView || (isSwitchingFocus && !showStatistics) ? (
              <ResultsLoading view={resultsView} />
            ) : showStatistics && error && (!yearsReady || !taxonomy) ? (
              <div className="p-10 lg:p-16"><LoadFailure what="The charts" onRetry={retryLoad} retrying={retrying} /></div>
            ) : showStatistics && (!yearsReady || !taxonomy) ? (
              <ResultsLoading view="statistics" />
            ) : showStatistics ? (
              <ErrorBoundary>
                <Suspense fallback={<ResultsLoading view="statistics" />}>
                  <StatisticsView scrollRef={parentRef} />
                </Suspense>
              </ErrorBoundary>
            ) : (
              <ResultsList
                scrollRef={parentRef}
                enabled={resultsView === 'list' && !isOpeningView}
                yearsReady={yearsReady}
                loading={loading}
                loadingElement={<ResultsLoading view="list" />}
                error={error}
                retryLoad={retryLoad}
                retrying={retrying}
                entries={filteredAndSortedEntries}
                expandedRows={expandedRows}
                toggleRow={toggleRow}
                viewMode={viewMode}
                searchScope={searchScope}
                setSearchScope={setSearchScope}
                searchQuery={searchQuery}
                paperQuery={paperQuery}
                paperQueryPending={paperQueryPending}
                startYear={startYear}
                endYear={endYear}
                topicFilter={topicFilter}
                platformFilter={platformFilter}
                selectedVenues={selectedVenues}
                pendingScrollId={pendingScrollId}
                onScrolledToPending={handleScrolledToPending}
              />
            )}
          </div>
        </main>
      </div>

      <MobileTabBar
        view={resultsView}
        focus={shownFocus}
        onShowList={next => {
          if (resultsView !== 'list') selectResultsView('list');
          if (next !== shownFocus) selectFocus(next);
        }}
        onShowStatistics={() => selectResultsView('statistics')}
        onOpenFilters={() => setIsSidebarOpen(true)}
        filterCount={activeFilterCount}
        hidden={isSidebarOpen}
      />

      <footer
        inert={isSidebarOpen}
        className="site-footer hidden md:flex pl-6 pr-[46px] lg:pl-10 lg:pr-[66px] py-4 border-t-2 border-outline flex-row justify-between items-center gap-x-4 gap-y-2 flex-wrap bg-surface shrink-0"
      >
        <SyncStatus generatedAt={generatedAt} />
        <SiteCredit />
      </footer>

      {queryPrompt.isOpen && (
        <QueryPromptModal navigation={navigation} onConfirm={queryPrompt.confirm} />
      )}
      {isMethodologyOpen && (
        <Suspense fallback={null}>
          <MethodologyModal onClose={() => setMethodologyOpen(false)} />
        </Suspense>
      )}
      {isAboutOpen && (
        <Suspense fallback={null}>
          <AboutModal generatedAt={generatedAt} onClose={() => setAboutOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
