import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useExplorerContext } from '../../context/ExplorerContext';
import type { Dimension } from './figureConfig';

export interface AxisItem { id: string; label: string }

export const platformCoverage = (tagged: number, matching: number) => {
  const share = (matching ? tagged / matching : 0).toLocaleString(undefined, { style: 'percent', maximumFractionDigits: 1 });
  return `Platform tags on ${tagged.toLocaleString()} of ${matching.toLocaleString()} papers (${share}).`;
};

export const REGION_ORDER = ['Africa', 'Asia', 'Europe', 'Oceania', 'North America', 'South America'];

/**
 * A figure's numbers from /api/stats under the sidebar filters. Waits until `enabled`, so off-screen figures do no work.
 * Keeps the last result while filters change, but never shows one variable's numbers under another's labels.
 */
export function useFigureStats<T>(path: string, params: Record<string, string | string[]>, enabled: boolean) {
  const { yearsReady, startYear, endYear, topicFilter: topics, platformFilter: platforms, selectedVenues, selectedLocations, paperQuery } = useExplorerContext();
  const venues = [...selectedVenues].sort();
  const locations = [...selectedLocations].sort();

  const paramsKey = JSON.stringify(params);

  return useQuery<T>({
    queryKey: ['stats', path, paramsKey, startYear, endYear, topics, platforms, venues, locations, paperQuery],
    enabled: yearsReady && enabled,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === path && previousQuery?.queryKey[2] === paramsKey ? previous : undefined,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const url = new URL(`/api/stats/${path}`, window.location.origin);
      for (const [key, value] of Object.entries(params)) {
        (Array.isArray(value) ? value : [value]).forEach(v => url.searchParams.append(key, v));
      }
      url.searchParams.set('start_year', String(startYear));
      url.searchParams.set('end_year', String(endYear));
      topics.forEach(t => url.searchParams.append('topic', t));
      platforms.forEach(p => url.searchParams.append('platform', p));
      venues.forEach(v => url.searchParams.append('venue', v));
      locations.forEach(c => url.searchParams.append('location', c));
      if (paperQuery) url.searchParams.set('paper_query', paperQuery);
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Statistics request failed (${res.status})`);
      return res.json();
    },
  });
}

/** The years in the selected range. */
export function useSelectedYears(): number[] {
  const { startYear, endYear } = useExplorerContext();
  return useMemo(() => {
    const list: number[] = [];
    for (let y = startYear; y <= endYear; y++) list.push(y);
    return list;
  }, [startYear, endYear]);
}

/** The year of the last data sync is still under way, so its counts are incomplete. Null if it isn't in the range. */
export function usePartialYear(): number | null {
  const { startYear, endYear, data } = useExplorerContext();
  const generated = data?.metadata?.generated_at ? new Date(data.metadata.generated_at) : null;
  const sync = generated && !Number.isNaN(generated.getTime()) ? generated : new Date();
  const year = sync.getFullYear();
  return year >= startYear && year <= endYear ? year : null;
}

/**
 * The values of a dimension, in their fixed order and never sorted by size. A filter narrows them to what was picked,
 * since a paper filtered in by one platform would otherwise also fill the rows of its other platforms.
 */
export function useAxisItems() {
  const { taxonomy, availableVenues, selectedTopics, selectedPlatforms, selectedVenues, selectedLocations, locationMapping } = useExplorerContext();
  const venueKey = availableVenues.join('|');

  return useCallback((dimension: Dimension): AxisItem[] => {
    const topics = taxonomy?.topics ?? [];
    switch (dimension) {
      case 'topic': {
        const parents = new Set(selectedTopics.map(t => t.split('/')[0]));
        return topics.filter(t => parents.size === 0 || parents.has(t.id)).map(t => ({ id: t.id, label: t.name }));
      }
      case 'subtopic':
        return topics.flatMap(t => t.subtopics
          .filter(s => selectedTopics.length === 0 || selectedTopics.includes(t.id) || selectedTopics.includes(s.id))
          .map(s => ({ id: s.id, label: s.name })));
      case 'platform':
        return (taxonomy?.platforms ?? [])
          .filter(p => selectedPlatforms.length === 0 || selectedPlatforms.includes(p.id))
          .map(p => ({ id: p.id, label: p.name }));
      case 'venue':
        return availableVenues
          .filter(v => selectedVenues.length === 0 || selectedVenues.includes(v))
          .map(v => ({ id: v, label: v }));
      case 'region': {
        const picked = new Set<string>();
        for (const details of Object.values(locationMapping)) {
          if (selectedLocations.includes(details.name) && details.region) picked.add(details.region);
        }
        return REGION_ORDER.filter(r => picked.size === 0 || picked.has(r)).map(r => ({ id: r, label: r }));
      }
    }
  }, [taxonomy, venueKey, selectedTopics, selectedPlatforms, selectedVenues, selectedLocations, locationMapping]);
}
