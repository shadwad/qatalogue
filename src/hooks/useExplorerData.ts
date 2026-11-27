import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defaultMetric, defaultSort, readUrlState, setLiveSearch, toSearch } from './urlState';
import type { Figure } from '../components/Statistics/figureConfig';
import { syncDetailCacheGeneration } from '../components/Rows/utils';
import { taxonomyNames, useExplorerConfig } from './useExplorerConfig';
import {
  computeLocationCounts,
  entryId,
  entryName,
  entrySecondary,
  filterAndSortEntries,
  filterByLocations,
  filterThresholdedEntries,
  filterValues,
  matchesSearch,
  selectNetworkEntries,
  thresholdCaps,
} from './explorerFiltering';
import type {
  DisplayMode,
  EntriesResponse,
  ExplorerEntry,
  FilterMatch,
  MetricMode,
  NetworkLayout,
  SearchScope,
  Section,
  SortColumn,
  SortDirection,
  Taxonomy,
  TaxonomySubtopic,
  TaxonomyTopic,
  ViewMode,
} from '../types';

export { taxonomyNames } from './useExplorerConfig';
export { entryId, entryName, entrySecondary, matchesSearch };
export type {
  DisplayMode,
  FilterMatch,
  MetricMode,
  NetworkLayout,
  SearchScope,
  Section,
  SortColumn,
  SortDirection,
  Taxonomy,
  TaxonomySubtopic,
  TaxonomyTopic,
  ViewMode,
};

export const NETWORK_K_MIN = 50;
export const NETWORK_K_STEP = 25;
export const NETWORK_K_CAP: Record<ViewMode, number> = { researcher: 1000, institution: 500 };
/** Default to the largest cap: the effective size is clamped per view, so both start at their max. */
export const NETWORK_K_DEFAULT = Math.max(...Object.values(NETWORK_K_CAP));

export const metricLabel = (m: MetricMode) =>
  m === 'adj_frac_count' ? 'Adjusted Fractional' : m === 'frac_count' ? 'Fractional' : m === 'total_count' ? 'Total' : 'None';

export function useExplorerData() {
  // Initial state comes from the URL (reload / shared link); everything defaults when absent.
  const [initial] = useState(() => readUrlState());
  const [section, setSection] = useState<Section>(initial.section);
  const [figures, setFigures] = useState<Figure[]>(initial.figures);
  const [viewMode, setViewModeRaw] = useState<ViewMode>(initial.view);
  const [metricChoice, setMetricChoice] = useState<MetricMode>(initial.metric);
  const [sortConfig, setSortConfig] = useState(initial.sort);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(initial.display);
  const [networkK, setNetworkK] = useState<number>(initial.k);
  const [networkLayoutChoice, setNetworkLayout] = useState<NetworkLayout>(initial.layout);
  const setMetricMode = useCallback((metric: MetricMode) => {
    if (metric === metricChoice) return;
    setMetricChoice(metric);
    setSortConfig(defaultSort(metric));
  }, [metricChoice]);
  const setViewMode = useCallback((view: ViewMode) => {
    setViewModeRaw(view);
    setMetricMode(defaultMetric(view));
  }, [setMetricMode]);
  // Network requires a model. Keep the user's None choice for List while Network uses the focus default.
  const needsNetworkMetric = displayMode === 'network' && metricChoice === 'none';
  const metricMode = needsNetworkMetric ? defaultMetric(viewMode) : metricChoice;
  const [attributionPulse, setAttributionPulse] = useState(0);
  useEffect(() => {
    if (needsNetworkMetric) setAttributionPulse(n => n + 1);
  }, [needsNetworkMetric]);

  const [selectedLocations, setSelectedLocations] = useState<string[]>(initial.locations);
  const [selectedTopics, setSelectedTopics] = useState<string[]>(initial.topics);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(initial.platforms);
  const [selectedVenues, setSelectedVenues] = useState<string[]>(initial.venues);
  const sortedVenues = useMemo(() => [...selectedVenues].sort(), [selectedVenues]);
  const [topicMatch, setTopicMatch] = useState<FilterMatch>(initial.topicMatch);
  const [platformMatch, setPlatformMatch] = useState<FilterMatch>(initial.platformMatch);
  // With fewer than two selected the choice means nothing, so the next selection starts from Any again.
  useEffect(() => { if (selectedTopics.length < 2) setTopicMatch('any'); }, [selectedTopics.length]);
  useEffect(() => { if (selectedPlatforms.length < 2) setPlatformMatch('any'); }, [selectedPlatforms.length]);
  // What every request sends: the server reads "a+b" as a paper having both.
  const topicFilter = useMemo(() => filterValues(selectedTopics, topicMatch), [selectedTopics, topicMatch]);
  const platformFilter = useMemo(() => filterValues(selectedPlatforms, platformMatch), [selectedPlatforms, platformMatch]);
  const [searchQuery, setSearchQuery] = useState(initial.q);
  const [searchScope, setSearchScope] = useState<SearchScope>(initial.scope);
  // Names: filter the loaded list in the browser. Topics: the server counts only the matching papers, so the
  // text is debounced (each change recomputes the list) and only sent once it is long enough to search.
  // Figures have no names to search, so Statistics searches paper topics. Explore returns to names if it was
  // switched automatically and nothing has been typed since.
  const autoScopeRef = useRef(false);
  useEffect(() => {
    if (section === 'statistics' && searchScope === 'names') {
      autoScopeRef.current = true;
      setSearchQuery('');
      setSearchScope('papers');
    } else if (section === 'explore' && autoScopeRef.current) {
      autoScopeRef.current = false;
      if (!searchQuery.trim()) setSearchScope('names');
    }
  }, [section, searchScope]);
  const nameQuery = searchScope === 'names' ? searchQuery : '';
  const [paperQuery, setPaperQuery] = useState(() => (initial.scope === 'papers' && initial.q.trim().length >= 2 ? initial.q.trim() : ''));
  useEffect(() => {
    const next = searchScope === 'papers' && searchQuery.trim().length >= 2 ? searchQuery.trim() : '';
    if (next === paperQuery) return;
    const t = window.setTimeout(() => setPaperQuery(next), next ? 400 : 0);
    return () => window.clearTimeout(t);
  }, [searchScope, searchQuery, paperQuery]);

  const {
    meta,
    yearMin,
    yearMax,
    yearsReady,
    taxonomy,
    topicName,
    platformName,
    availableVenues,
    locationMapping,
    metaError,
    configError,
    metaFetching,
    configFetching,
    refetchMeta,
    refetchConfig,
  } = useExplorerConfig();

  // NaN = "not chosen" (not in the URL): resolves cleanly on render once year bounds load.
  const [startYearRaw, setStartYear] = useState<number>(initial.from);
  const [endYearRaw, setEndYear] = useState<number>(initial.to);
  const [startYear, endYear] = useMemo(() => {
    if (!yearsReady) return [0, 0] as const;
    const clamp = (y: number) => Math.min(yearMax!, Math.max(yearMin!, y));
    const lo = Number.isNaN(startYearRaw) ? yearMin! : clamp(startYearRaw);
    const hi = Number.isNaN(endYearRaw) ? yearMax! : clamp(endYearRaw);
    return lo <= hi ? ([lo, hi] as const) : ([hi, lo] as const);
  }, [yearsReady, yearMin, yearMax, startYearRaw, endYearRaw]);
  // Persist normalized bounds back into slider state once bounds load.
  useEffect(() => {
    if (!yearsReady) return;
    setStartYear(startYear);
    setEndYear(endYear);
  }, [yearsReady, startYear, endYear]);

  // Ids/names in a URL that no longer exist in config are dropped.
  useEffect(() => {
    if (!taxonomy) return;
    const names = taxonomyNames(taxonomy);
    setSelectedTopics(prev => (prev.every(t => names.has(t)) ? prev : prev.filter(t => names.has(t))));
    const plats = new Set(taxonomy.platforms.map(p => p.id));
    setSelectedPlatforms(prev => (prev.every(p => plats.has(p)) ? prev : prev.filter(p => plats.has(p))));
  }, [taxonomy]);
  useEffect(() => {
    if (!availableVenues.length) return;
    const venues = new Set(availableVenues);
    setSelectedVenues(prev => (prev.every(v => venues.has(v)) ? prev : prev.filter(v => venues.has(v))));
  }, [availableVenues]);
  useEffect(() => {
    const names = new Set(Object.values(locationMapping).map(entry => entry.name));
    if (!names.size) return;
    setSelectedLocations(prev => (prev.every(loc => loc === 'Unknown' || names.has(loc)) ? prev : prev.filter(loc => loc === 'Unknown' || names.has(loc))));
  }, [locationMapping]);

  // The individual threshold is kept per view; the URL carries the current view's value.
  const [instFacultyMin, setInstFacultyMin] = useState(initial.view === 'institution' ? initial.imin : 0.0);
  const [resFacultyMin, setResFacultyMin] = useState(initial.view === 'researcher' ? initial.imin : 0.0);

  const facultyMinContribution = viewMode === 'institution' ? instFacultyMin : resFacultyMin;
  const setFacultyMinContribution = useCallback((val: number | ((prev: number) => number)) => {
    if (viewMode === 'institution') {
      setInstFacultyMin(val);
    } else {
      setResFacultyMin(val);
    }
  }, [viewMode]);

  const [institutionMinContribution, setInstitutionMinContribution] = useState(initial.view === 'institution' ? initial.inst : 0.0);
  const [avgContributionMin, setAvgContributionMin] = useState(initial.view === 'institution' ? initial.avg : 0.0);

  const hasThresholdFilter = section !== 'statistics' && metricMode !== 'none'
    && (instFacultyMin > 0 || resFacultyMin > 0 || institutionMinContribution > 0 || avgContributionMin > 0);
  const hasMetricFilter = section !== 'statistics' && metricChoice !== defaultMetric(viewMode);

  // Anything the user has narrowed (view, display, layout and network size are choices, not filters).
  const isFiltered =
    searchQuery.trim() !== '' || selectedLocations.length > 0 || selectedTopics.length > 0 || selectedPlatforms.length > 0 ||
    selectedVenues.length > 0 || (yearsReady && (startYear !== yearMin || endYear !== yearMax)) ||
    hasThresholdFilter || hasMetricFilter;
  // How many kinds of filter are set, for the phone's Filters tab. The search is left out: it is always on screen.
  const activeFilterCount = [
    yearsReady && (startYear !== yearMin || endYear !== yearMax),
    selectedTopics.length > 0,
    selectedPlatforms.length > 0,
    selectedVenues.length > 0,
    selectedLocations.length > 0,
    hasThresholdFilter,
    hasMetricFilter,
  ].filter(Boolean).length;

  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedLocations([]);
    setSelectedTopics([]);
    setSelectedPlatforms([]);
    setTopicMatch('any');
    setPlatformMatch('any');
    setSelectedVenues([]);
    setStartYear(yearMin ?? NaN);
    setEndYear(yearMax ?? NaN);
    setInstFacultyMin(0);
    setResFacultyMin(0);
    setInstitutionMinContribution(0);
    setAvgContributionMin(0);
    setMetricMode(defaultMetric(viewMode));
  }, [yearMin, yearMax, viewMode, setMetricMode]);

  const currentSearch = useMemo(() => {
    if (!yearsReady) return null;
    return toSearch({
      section, figures,
      view: viewMode, display: displayMode, layout: networkLayoutChoice, k: networkK,
      metric: metricChoice,
      from: startYear, to: endYear,
      topics: selectedTopics, platforms: selectedPlatforms, topicMatch, platformMatch, venues: selectedVenues, locations: selectedLocations, q: searchQuery, scope: searchScope,
      imin: viewMode === 'institution' ? instFacultyMin : resFacultyMin,
      inst: viewMode === 'institution' ? institutionMinContribution : 0,
      avg: viewMode === 'institution' ? avgContributionMin : 0,
      sort: sortConfig,
    }, { min: yearMin!, max: yearMax! });
  }, [section, figures, viewMode, displayMode, networkLayoutChoice, networkK, metricChoice, startYear, endYear, selectedTopics, selectedPlatforms, topicMatch, platformMatch,
      selectedVenues, selectedLocations, searchQuery, searchScope, instFacultyMin, resFacultyMin, institutionMinContribution,
      avgContributionMin, sortConfig, yearsReady, yearMin, yearMax]);

  // Keep Copy Link synced immediately while debouncing browser history replacement.
  setLiveSearch(currentSearch);
  useEffect(() => () => setLiveSearch(null), []);
  useEffect(() => {
    if (currentSearch === null) return; // years can't be judged default/non-default until the data range is known
    const t = window.setTimeout(() => {
      if (currentSearch !== window.location.search) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${currentSearch}${window.location.hash}`);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [currentSearch]);

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    const { indvMax, instMax, avgMax } = thresholdCaps(viewMode, metricMode);
    setFacultyMinContribution(value => Math.min(value, indvMax));
    setInstitutionMinContribution(value => Math.min(value, instMax));
    setAvgContributionMin(value => Math.min(value, avgMax));
  }, [metricMode, viewMode, setFacultyMinContribution]);

  // The opening view comes from a pre-built file (average and institutional thresholds are applied client-side).
  // Only institutions send the individual threshold to the server; researchers are thresholded in the browser.
  const serverIndividualThreshold = viewMode === 'institution' ? facultyMinContribution : 0;
  const isDefaultRequest = (individual: number) => !paperQuery &&
    startYear === yearMin && endYear === yearMax &&
    selectedTopics.length === 0 && selectedPlatforms.length === 0 && sortedVenues.length === 0 &&
    (viewMode === 'institution'
      ? (metricMode === 'adj_frac_count' || metricMode === 'none') && individual === 0
      : metricMode === 'frac_count' || metricMode === 'none');

  const fetchEntries = async (signal: AbortSignal, individual: number): Promise<EntriesResponse<ExplorerEntry>> => {
    const endpoint = viewMode === 'institution' ? '/api/entries/institutions' : '/api/entries/researchers';
    const url = new URL(endpoint, window.location.origin);
    url.searchParams.set('start_year', startYear.toString());
    url.searchParams.set('end_year', endYear.toString());
    url.searchParams.set('metric_mode', metricMode);

    if (viewMode === 'institution' && individual > 0) {
      url.searchParams.set('individual_threshold', individual.toString());
    }
    topicFilter.forEach(topic => url.searchParams.append('topic', topic));
    platformFilter.forEach(platform => url.searchParams.append('platform', platform));
    sortedVenues.forEach(venue => url.searchParams.append('venue', venue));
    if (paperQuery) url.searchParams.set('paper_query', paperQuery);

    let res: Response | undefined;
    if (isDefaultRequest(individual)) {
      res = await fetch(`/default-summary/${viewMode === 'institution' ? 'institutions' : 'researchers'}.json.gz`, { signal });
      if (res.status === 404) res = undefined; // no pre-built file: ask the API
    }
    res ??= await fetch(url.toString(), { signal });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const payload = (await res.json()) as EntriesResponse<ExplorerEntry>;
    if (viewMode !== 'researcher') return payload;
    return { ...payload, entries: payload.entries.map(e => (e.type === 'researcher' ? e : { ...e, type: 'researcher' as const })) } as EntriesResponse<ExplorerEntry>;
  };

  const entriesKey = [
    'explorerData', viewMode, startYear, endYear, metricMode, serverIndividualThreshold,
    topicFilter, platformFilter, sortedVenues, paperQuery, isDefaultRequest(serverIndividualThreshold),
  ];

  const { data, isLoading: dataLoading, error: dataError, refetch: refetchData, isFetching: dataFetching } = useQuery<EntriesResponse<ExplorerEntry>>({
    queryKey: entriesKey,
    queryFn: ({ signal }) => fetchEntries(signal, serverIndividualThreshold),
    staleTime: 5 * 60 * 1000,
    enabled: yearsReady && section !== 'statistics', // Charts/Statistics does not render explorer entries
  });

  useEffect(() => {
    syncDetailCacheGeneration(data?.metadata?.generated_at ?? meta?.generated_at);
  }, [data?.metadata?.generated_at, meta?.generated_at]);

  // Still loading while the year range is unknown (or while Explore entries are fetching).
  const loading = (!yearsReady && !metaError) || (section !== 'statistics' && dataLoading);
  const activeDataError = section !== 'statistics' ? dataError : null;
  const error = activeDataError ? activeDataError.message
    : configError ? configError.message
    : metaError ? metaError.message : null;
  const retryLoad = () => {
    if (metaError) refetchMeta();
    if (configError) refetchConfig();
    if (activeDataError) refetchData();
  };
  const retrying = !!((metaError && metaFetching) || (configError && configFetching) || (activeDataError && dataFetching));

  const thresholdedEntries = useMemo(
    () => (data?.entries
      ? filterThresholdedEntries(data.entries, {
          viewMode,
          facultyMinContribution,
          institutionMinContribution,
          avgContributionMin,
        })
      : []),
    [data, viewMode, facultyMinContribution, institutionMinContribution, avgContributionMin],
  );

  // Location + threshold filters, but not search (Network view ghosts search misses instead of dropping them).
  const baseFilteredEntries = useMemo(
    () => filterByLocations(thresholdedEntries, selectedLocations),
    [thresholdedEntries, selectedLocations],
  );

  // How many entries each location would show: what ticking it gives, under every filter but location itself.
  const locationCounts = useMemo(
    () => computeLocationCounts(thresholdedEntries),
    [thresholdedEntries],
  );

  const filteredAndSortedEntries = useMemo(
    () => filterAndSortEntries(baseFilteredEntries, nameQuery, sortConfig),
    [baseFilteredEntries, sortConfig, nameQuery],
  );

  // Network nodes: the k highest outputs in the base-filtered list (independent of the list's sort column).
  // Researchers have no coordinates, so their network is always the force layout.
  const networkLayout: NetworkLayout = viewMode === 'institution' ? networkLayoutChoice : 'force';
  const networkTotal = baseFilteredEntries.length;
  const networkKMax = Math.min(NETWORK_K_CAP[viewMode], networkTotal);
  const effectiveNetworkK = Math.max(0, Math.min(networkK, networkKMax));
  const networkEntries = useMemo(
    () => (displayMode === 'network' ? selectNetworkEntries(baseFilteredEntries, effectiveNetworkK) : []),
    [displayMode, baseFilteredEntries, effectiveNetworkK],
  );

  const handleSort = (column: SortColumn) => {
    setSortConfig(current => ({
      column,
      direction: column === current.column
        ? (current.direction === 'asc' ? 'desc' : 'asc')
        : (column === 'score' ? 'desc' : 'asc'),
    }));
  };

  const toggleLocation = (location: string) => {
    setSelectedLocations(prev =>
      prev.includes(location)
        ? prev.filter(c => c !== location)
        : [...prev, location],
    );
  };

  const clearLocations = () => setSelectedLocations([]);

  const toggleRow = useCallback((id: string) => {
    setExpandedRows(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      return newExpanded;
    });
  }, []);

  return {
    data,
    generatedAt: data?.metadata?.generated_at ?? meta?.generated_at,
    configError: configError ? configError.message : null,
    loading,
    error,
    retryLoad,
    retrying,
    section, setSection,
    figures, setFigures,
    viewMode, setViewMode,
    metricMode, setMetricMode,
    displayMode, setDisplayMode,
    networkK, setNetworkK, networkKMax, networkLayout, networkLayoutChoice, setNetworkLayout, effectiveNetworkK, networkTotal, networkEntries,
    attributionPulse,
    isFiltered, activeFilterCount, resetFilters,
    yearMin, yearMax, yearsReady,
    datasetTotals: meta?.totals ?? null, locationCounts,
    taxonomy, topicName, platformName, availableVenues, locationMapping,
    selectedLocations, setSelectedLocations, toggleLocation, clearLocations,
    sortConfig, handleSort,
    expandedRows, toggleRow,
    filteredAndSortedEntries,
    searchQuery, setSearchQuery,
    searchScope, setSearchScope, nameQuery, paperQuery,
    /** Topics mode: the text typed differs from the one the list was computed for (debounce pending). */
    paperQueryPending: searchScope === 'papers' && (searchQuery.trim().length >= 2 ? searchQuery.trim() : '') !== paperQuery,
    selectedTopics, setSelectedTopics,
    selectedPlatforms, setSelectedPlatforms,
    topicMatch, setTopicMatch, platformMatch, setPlatformMatch, topicFilter, platformFilter,
    selectedVenues, setSelectedVenues,
    startYear, setStartYear,
    endYear, setEndYear,
    facultyMinContribution, setFacultyMinContribution,
    institutionMinContribution, setInstitutionMinContribution,
    avgContributionMin, setAvgContributionMin,
  };
}
