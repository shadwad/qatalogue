import { useMemo, useState } from 'react';
import { useExplorerContext } from '../../context/ExplorerContext';
import type { FilterMatch } from '../../hooks/useExplorerData';
import type { Dimension } from './figureConfig';

/** What a click on a figure picks: the values it stands for, and a year if it was on a time axis. */
export interface FigureSelection {
  values: { dimension: Dimension; id: string }[];
  year?: number;
  /** Several values of one dimension mean papers with all of them, as in an overlap cell. */
  matchAll?: boolean;
  /** What was clicked, in words ("Error correction & mitigation · 2021"), for the toolbar's "Showing …" beside Undo. */
  label?: string;
}

interface FilterSnapshot {
  topics: string[];
  platforms: string[];
  topicMatch: FilterMatch;
  platformMatch: FilterMatch;
  venues: string[];
  locations: string[];
  startYear: number;
  endYear: number;
}

const keyOf = (s: FilterSnapshot) => JSON.stringify([
  [...s.topics].sort(), [...s.platforms].sort(), s.topicMatch, s.platformMatch, [...s.venues].sort(), [...s.locations].sort(), s.startYear, s.endYear,
]);

/**
 * Figures as filters: a click replaces the filters for the values it picked and leaves the others alone. Each click can
 * be undone until the filters are changed some other way, since Undo would then discard that change.
 */
export function useFigureSelection() {
  const {
    selectedTopics, setSelectedTopics, selectedPlatforms, setSelectedPlatforms, selectedVenues, setSelectedVenues,
    topicMatch, setTopicMatch, platformMatch, setPlatformMatch,
    selectedLocations, setSelectedLocations, startYear, setStartYear, endYear, setEndYear, locationMapping,
  } = useExplorerContext();
  const [history, setHistory] = useState<{ before: FilterSnapshot; after: FilterSnapshot; label?: string }[]>([]);

  const current: FilterSnapshot = useMemo(() => ({
    topics: selectedTopics, platforms: selectedPlatforms, topicMatch, platformMatch, venues: selectedVenues, locations: selectedLocations, startYear, endYear,
  }), [selectedTopics, selectedPlatforms, topicMatch, platformMatch, selectedVenues, selectedLocations, startYear, endYear]);

  const apply = (s: FilterSnapshot) => {
    setSelectedTopics(s.topics);
    setSelectedPlatforms(s.platforms);
    setTopicMatch(s.topicMatch);
    setPlatformMatch(s.platformMatch);
    setSelectedVenues(s.venues);
    setSelectedLocations(s.locations);
    setStartYear(s.startYear);
    setEndYear(s.endYear);
  };

  const last = history[history.length - 1];
  const canUndo = !!last && keyOf(last.after) === keyOf(current);

  const select = (selection: FigureSelection) => {
    const next = { ...current };
    const ofDimensions = (...dimensions: Dimension[]) => selection.values.filter(v => dimensions.includes(v.dimension)).map(v => v.id);
    const topics = ofDimensions('topic', 'subtopic');
    const platforms = ofDimensions('platform');
    if (topics.length) { next.topics = topics; next.topicMatch = selection.matchAll ? 'all' : 'any'; }
    if (platforms.length) { next.platforms = platforms; next.platformMatch = selection.matchAll ? 'all' : 'any'; }
    for (const { dimension, id } of selection.values) {
      if (dimension === 'topic' || dimension === 'subtopic' || dimension === 'platform') continue;
      else if (dimension === 'venue') next.venues = [id];
      else {
        next.locations = Object.values(locationMapping)
          .filter(details => details.region === id)
          .map(details => details.name);
      }
    }
    if (selection.year !== undefined) {
      next.startYear = selection.year;
      next.endYear = selection.year;
    }
    if (keyOf(next) === keyOf(current)) return;
    const entry = { before: current, after: next, label: selection.label };
    // Entries that Undo can no longer reach (the filters changed another way since) are dropped.
    setHistory(previous => (canUndo ? [...previous, entry] : [entry]));
    apply(next);
  };

  const undo = () => {
    if (!canUndo) return;
    apply(last.before);
    setHistory(previous => previous.slice(0, -1));
  };

  return { select, undo, canUndo, label: canUndo ? last.label : undefined };
}
