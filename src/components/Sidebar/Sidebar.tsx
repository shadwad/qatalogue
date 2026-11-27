import React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileText, Landmark, User, X, type LucideIcon } from 'lucide-react';
import { useExplorerContext } from '../../context/ExplorerContext';
import { matchesSearch, NETWORK_K_DEFAULT, type MetricMode } from '../../hooks/useExplorerData';
import { Tooltip } from '../ui/Tooltip';
import { CONTROL_FOCUS } from '../ui/Controls';
import { AttributionSection } from './AttributionSection';
import { FilterAccordion } from './FilterAccordion';
import { LocationTree } from './LocationTree';
import { NetworkSizeControl } from './NetworkSizeControl';
import { ResetButton } from './ResetButton';
import { ThresholdSection } from './ThresholdSection';
import { PlatformFacet, TopicTree, type TopicCounts } from './TopicTree';
import { YearRangeSection } from './YearRangeSection';

interface SidebarProps {
  className?: string;
  onClose?: () => void;
  /** What the close button says (tooltip and screen readers). */
  closeLabel?: string;
  scrollContainerRef?: React.Ref<HTMLDivElement>;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
  /** Rendered inside a modal card: drops the side border and fills the parent. */
  embedded?: boolean;
}

/** Header figure: a symbol, how many match the current filters, and how many exist. */
const SelectionTotal: React.FC<{ icon: LucideIcon; selected?: number; total?: number; unit: string }> = ({ icon: Icon, selected, total, unit }) => {
  const text = selected === undefined ? undefined : `${selected.toLocaleString()}${total === undefined ? '' : ` of ${total.toLocaleString()}`} ${unit} match the current filters`;
  return (
    <Tooltip contents content={`${unit.charAt(0).toUpperCase()}${unit.slice(1)} subject to filters, of all in the dataset`}>
      <span role="img" aria-label={text ?? unit} className="flex items-center gap-1.5 font-mono text-xs tracking-normal normal-case">
        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="text-primary font-bold">{selected === undefined ? '–' : selected.toLocaleString()}</span>
        {total !== undefined && (
          <span className="-ml-[3px] font-normal text-on-surface-variant/70 md:@max-sm/sidebar:hidden">
            <span className="mr-[3.6px]">/</span>{total.toLocaleString()}
          </span>
        )}
      </span>
    </Tooltip>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  className,
  onClose,
  closeLabel = 'Close filters',
  scrollContainerRef,
  onScroll,
  embedded = false,
}) => {
  const {
    metricMode, setMetricMode, viewMode, nameQuery,
    data, selectedLocations, setSelectedLocations, toggleLocation, clearLocations,
    taxonomy, selectedTopics, setSelectedTopics, selectedPlatforms, setSelectedPlatforms,
    topicMatch, setTopicMatch, platformMatch, setPlatformMatch, topicFilter, platformFilter,
    paperQuery, availableVenues, selectedVenues, setSelectedVenues,
    startYear, setStartYear, endYear, setEndYear,
    facultyMinContribution, setFacultyMinContribution,
    institutionMinContribution, setInstitutionMinContribution,
    avgContributionMin, setAvgContributionMin,
    filteredAndSortedEntries,
    displayMode, effectiveNetworkK, networkKMax, networkTotal, setNetworkK, networkEntries,
    attributionPulse, isFiltered, resetFilters, yearMin, yearMax, yearsReady,
    datasetTotals, locationCounts, section, locationMapping, loading, error, configError,
  } = useExplorerContext();

  const listsLoading = !taxonomy && !configError;
  const isStatistics = section === 'statistics';
  const isNetwork = !isStatistics && displayMode === 'network';

  // Paper counts for the topic, platform, venue and location lists (each under the other filters).
  const { data: topicCounts, isError: topicCountsFailed } = useQuery<TopicCounts>({
    queryKey: ['topic-counts', startYear, endYear, topicFilter, platformFilter, [...selectedVenues].sort(), [...selectedLocations].sort(), paperQuery, isStatistics],
    enabled: yearsReady,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const url = new URL('/api/topics/counts', window.location.origin);
      url.searchParams.set('start_year', String(startYear));
      url.searchParams.set('end_year', String(endYear));
      topicFilter.forEach(t => url.searchParams.append('topic', t));
      platformFilter.forEach(p => url.searchParams.append('platform', p));
      [...selectedVenues].sort().forEach(v => url.searchParams.append('venue', v));
      [...selectedLocations].sort().forEach(c => url.searchParams.append('location', c));
      if (paperQuery) url.searchParams.set('paper_query', paperQuery);
      if (isStatistics) url.searchParams.set('locationCounts', '1');
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Topic counts failed (${res.status})`);
      return res.json();
    },
  });

  // A topic includes all of its subtopics: picking a topic drops its subtopics, and picking a subtopic replaces its parent.
  const toggleTopic = (id: string) => {
    setSelectedTopics(prev => {
      if (prev.includes(id)) return prev.filter(t => t !== id);
      const parent = id.includes('/') ? id.split('/')[0] : null;
      if (parent) return [...prev.filter(t => t !== parent), id];
      return [...prev.filter(t => !t.startsWith(id + '/')), id];
    });
  };

  const resetModelThresholds = () => {
    setFacultyMinContribution(0);
    setInstitutionMinContribution(0);
    setAvgContributionMin(0);
  };

  const handleSelectMetric = (newMode: MetricMode) => {
    if (newMode !== metricMode) {
      setMetricMode(newMode);
      resetModelThresholds();
    }
  };

  const filteredCount = filteredAndSortedEntries.length;
  const noun = viewMode === 'institution' ? 'INSTITUTIONS' : 'RESEARCHERS';
  const entityNoun = noun.charAt(0) + noun.slice(1).toLowerCase();
  const EntityIcon = viewMode === 'institution' ? Landmark : User;
  const searchActive = nameQuery.trim().length > 0;
  const matchesInNetwork = isNetwork && searchActive
    ? networkEntries.filter(e => matchesSearch(e, nameQuery)).length
    : 0;
  const fmt = (n: number) => n.toLocaleString();

  return (
    <aside
      className={`@container/sidebar ${embedded ? '' : 'border-r border-outline h-full'} flex flex-col bg-surface-variant z-10 ${className ?? ''}`}
    >
      <div className="shrink-0 bg-surface px-4 md:px-6 md:@sm/sidebar:px-10 h-[53px] border-b border-outline">
        <div className="relative flex items-center h-full">
          <div className="flex-1 min-w-4" aria-hidden="true" />
          <div className="w-full min-w-0 max-w-[348px] md:max-w-[388px] lg:max-w-[336px] 2xl:max-w-[388px] font-display text-xs font-bold tracking-wider uppercase text-on-surface-variant flex items-center">
            {isNetwork && searchActive ? (
              <span>
                <span className="text-primary font-bold font-mono mr-1.5">{fmt(filteredCount)}</span>
                {filteredCount === 1 ? 'MATCH' : 'MATCHES'}
                <span className="mx-1.5">·</span>
                <span className="text-primary font-bold font-mono mr-1.5">{fmt(matchesInNetwork)}</span>
                OF {fmt(networkEntries.length)} SHOWN
              </span>
            ) : (
              <span className={`grid ${isStatistics ? 'grid-cols-1' : 'grid-cols-[calc(50%+6.6px)_1fr]'} w-full whitespace-nowrap`}>
                {!isStatistics && <SelectionTotal icon={EntityIcon} selected={!data ? undefined : isNetwork ? networkTotal : filteredCount} total={datasetTotals?.[viewMode]} unit={noun.toLowerCase()} />}
                <SelectionTotal icon={FileText} selected={topicCounts?.total} total={datasetTotals?.paper} unit="papers" />
              </span>
            )}
          </div>
          <div className={`flex-1 ${onClose ? 'min-w-[72px]' : 'min-w-11'}`} aria-hidden="true" />
          <div className="absolute inset-y-0 right-0 flex items-center gap-1">
            <div className="w-7 h-7">
              {isFiltered && (
                <ResetButton
                  size="large"
                  label="Reset filters"
                  description="Reset filters: clear search, years, topics, venues, locations, thresholds, and attribution model"
                  className="animate-modal-in"
                  onReset={resetFilters}
                />
              )}
            </div>
            {onClose && (
              <Tooltip contents content={closeLabel}>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={closeLabel}
                  className={`${CONTROL_FOCUS} bg-transparent border-none p-2 -mr-2 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5 transition-colors cursor-pointer shadow-interactive press-scale`}
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        className={`flex-1 overflow-y-auto ${onClose ? 'max-md:pb-8' : ''}`}
      >
        <div className="p-4 md:p-6 md:@sm/sidebar:p-10 flex flex-col gap-6 [&>*+*]:border-t [&>*+*]:border-outline [&>*+*]:pt-6">
          {isNetwork && (
            <NetworkSizeControl
              viewMode={viewMode}
              value={effectiveNetworkK}
              max={networkKMax}
              total={networkTotal}
              onCommit={setNetworkK}
              defaultK={NETWORK_K_DEFAULT}
            />
          )}

          <YearRangeSection
            yearsReady={yearsReady}
            yearMin={yearMin}
            yearMax={yearMax}
            startYear={startYear}
            endYear={endYear}
            error={error}
            onStartYearChange={setStartYear}
            onEndYearChange={setEndYear}
            onReset={() => { setStartYear(yearMin!); setEndYear(yearMax!); }}
          />

          {!isStatistics && (
            <AttributionSection
              viewMode={viewMode}
              metricMode={metricMode}
              isNetwork={isNetwork}
              attributionPulse={attributionPulse}
              onSelectMetric={handleSelectMetric}
            />
          )}

          {!isStatistics && metricMode !== 'none' && (
            <ThresholdSection
              viewMode={viewMode}
              metricMode={metricMode}
              networkTotal={networkTotal}
              facultyMinContribution={facultyMinContribution}
              institutionMinContribution={institutionMinContribution}
              avgContributionMin={avgContributionMin}
              onFacultyMinChange={setFacultyMinContribution}
              onInstitutionMinChange={setInstitutionMinContribution}
              onAvgMinChange={setAvgContributionMin}
              onReset={resetModelThresholds}
              entityIcon={EntityIcon}
              entityNoun={entityNoun}
            />
          )}

          <TopicTree
            taxonomy={taxonomy}
            loading={listsLoading}
            selected={selectedTopics}
            counts={topicCounts}
            onToggle={toggleTopic}
            onClear={() => setSelectedTopics([])}
            match={topicMatch}
            onMatchChange={setTopicMatch}
          />
          <PlatformFacet
            taxonomy={taxonomy}
            loading={listsLoading}
            selected={selectedPlatforms}
            counts={topicCounts}
            onToggle={id => setSelectedPlatforms(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]))}
            onClear={() => setSelectedPlatforms([])}
            match={platformMatch}
            onMatchChange={setPlatformMatch}
          />

          <FilterAccordion
            title="VENUE"
            loading={listsLoading}
            failed={!taxonomy && !listsLoading}
            items={availableVenues}
            selectedItems={selectedVenues}
            onToggleItem={venue => {
              setSelectedVenues(prev => (prev.includes(venue) ? prev.filter(v => v !== venue) : [...prev, venue]));
            }}
            onClear={() => setSelectedVenues([])}
            counts={topicCounts?.venues}
          />

          <LocationTree
            isStatistics={isStatistics}
            entityNoun={entityNoun}
            entityIcon={EntityIcon}
            data={data}
            topicCounts={topicCounts}
            topicCountsFailed={topicCountsFailed}
            loading={loading}
            error={error}
            locationMapping={locationMapping}
            selectedLocations={selectedLocations}
            locationCounts={locationCounts}
            onToggleLocation={toggleLocation}
            onSetSelectedLocations={setSelectedLocations}
            onClearLocations={clearLocations}
          />
        </div>
      </div>
    </aside>
  );
};
