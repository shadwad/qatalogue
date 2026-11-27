import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DatasetMeta, LocationMapping, Taxonomy, VenueConfig } from '../types';

const nameCache = new WeakMap<Taxonomy, Map<string, string>>();
export function taxonomyNames(t: Taxonomy | null): Map<string, string> {
  if (!t) return new Map();
  let m = nameCache.get(t);
  if (!m) {
    m = new Map();
    for (const T of t.topics) {
      m.set(T.id, T.name);
      for (const S of T.subtopics) m.set(S.id, S.name);
    }
    nameCache.set(t, m);
  }
  return m;
}

interface ConfigBundle {
  taxonomy: Taxonomy;
  venues: VenueConfig[];
  locationMapping: LocationMapping;
}

export function useExplorerConfig() {
  // Year range of the loaded dataset (not hard-coded): slider bounds, defaults, Reset and the URL all follow it.
  const { data: meta, error: metaError, refetch: refetchMeta, isFetching: metaFetching } = useQuery<DatasetMeta>({
    queryKey: ['meta'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/meta', { signal });
      if (!res.ok) throw new Error('Dataset metadata request failed');
      return (await res.json()) as DatasetMeta;
    },
    staleTime: Infinity,
  });

  const { data: configData, error: configError, refetch: refetchConfig, isFetching: configFetching } = useQuery<ConfigBundle>({
    queryKey: ['configData'],
    queryFn: async ({ signal }) => {
      const [topicsRes, venuesRes, locationRes] = await Promise.all([
        fetch('/config/taxonomy.json', { signal }),
        fetch('/config/venues.json', { signal }),
        fetch('/config/location_mapping.json', { signal }),
      ]);
      if (!topicsRes.ok) throw new Error('Topic list request failed');
      if (!venuesRes.ok) throw new Error('Venues metadata request failed');
      if (!locationRes.ok) throw new Error('Location mapping request failed');

      return {
        taxonomy: (await topicsRes.json()) as Taxonomy,
        venues: (await venuesRes.json()) as VenueConfig[],
        locationMapping: (await locationRes.json()) as LocationMapping,
      };
    },
    staleTime: Infinity,
  });

  const yearMin = meta?.year_min ?? null;
  const yearMax = meta?.year_max ?? null;
  const yearsReady = yearMin !== null && yearMax !== null;
  const taxonomy: Taxonomy | null = configData?.taxonomy ?? null;

  /** Display name for a topic or subtopic id ("topic" or "topic/subtopic"). */
  const topicName = useCallback((id: string) => taxonomyNames(taxonomy).get(id) ?? id, [taxonomy]);
  const platformName = useCallback((id: string) => taxonomy?.platforms.find(p => p.id === id)?.name ?? id, [taxonomy]);
  const availableVenues = useMemo(
    () => (configData?.venues ?? []).map(v => v.name).sort((a, b) => a.localeCompare(b)),
    [configData],
  );
  const locationMapping = useMemo<LocationMapping>(() => configData?.locationMapping ?? {}, [configData]);

  return {
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
  };
}
