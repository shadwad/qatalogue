import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Minus, type LucideIcon } from 'lucide-react';
import type { EntriesResponse, LocationCounts, LocationMapping } from '../../types';
import { CONTROL_FOCUS } from '../ui/Controls';
import { ListFailure } from '../ui/LoadFailure';
import { Tooltip } from '../ui/Tooltip';
import { ResetButton, SectionSymbols, SectionTitle } from './ResetButton';
import { SearchField } from './SearchField';
import { CountSymbol, FILTER_LIST_CLASS, FilterCount, ListLoading, type TopicCounts } from './TopicTree';

const REGION_ORDER = ['Africa', 'Asia', 'Europe', 'Oceania', 'North America', 'South America', 'Global'];

interface LocationTreeProps {
  isStatistics: boolean;
  entityNoun: string;
  entityIcon: LucideIcon;
  data: EntriesResponse | undefined;
  topicCounts: TopicCounts | undefined;
  topicCountsFailed: boolean;
  loading: boolean;
  error: string | null;
  locationMapping: LocationMapping;
  selectedLocations: string[];
  locationCounts: LocationCounts;
  onToggleLocation: (location: string) => void;
  onSetSelectedLocations: React.Dispatch<React.SetStateAction<string[]>>;
  onClearLocations: () => void;
}

export function LocationTree({
  isStatistics,
  entityNoun,
  entityIcon,
  data,
  topicCounts,
  topicCountsFailed,
  loading,
  error,
  locationMapping,
  selectedLocations,
  locationCounts,
  onToggleLocation,
  onSetSelectedLocations,
  onClearLocations,
}: LocationTreeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set());
  const selectedSet = useMemo(() => new Set(selectedLocations), [selectedLocations]);

  // Statistics counts papers, so its list comes from the paper counts rather than from the entries of the list view.
  const paperLocations = isStatistics ? topicCounts?.locations : undefined;
  const locationHierarchy = useMemo(() => {
    const hierarchy = new Map<string, Set<string>>();
    const regionOf = new Map(Object.values(locationMapping).map(c => [c.name, c.region]));
    const add = (region: string, location: string) => {
      if (!hierarchy.has(region)) hierarchy.set(region, new Set<string>());
      hierarchy.get(region)!.add(location);
    };
    if (paperLocations) {
      Object.keys(paperLocations).forEach(location => add(regionOf.get(location) || 'Global', location));
    } else if (data?.entries) {
      data.entries.forEach(inst => add(inst.region || 'Global', inst.location || inst.location_code || 'Unknown'));
    } else {
      return [];
    }
    // Keep active location filters visible even when other filters temporarily narrow their count to 0.
    selectedLocations.forEach(loc => add(regionOf.get(loc) || 'Global', loc));
    return Array.from(hierarchy.entries())
      .map(([region, locationsSet]) => {
        const locations = Array.from(locationsSet).sort();
        return { region, locations, allLocations: locations };
      })
      .sort((a, b) => {
        const indexA = REGION_ORDER.indexOf(a.region);
        const indexB = REGION_ORDER.indexOf(b.region);
        return (indexA === -1 ? REGION_ORDER.length : indexA) - (indexB === -1 ? REGION_ORDER.length : indexB);
      });
  }, [data, paperLocations, locationMapping, selectedLocations]);

  const locationsToDisplay = useMemo(() => {
    if (!searchQuery) return locationHierarchy;
    const lowerQuery = searchQuery.toLowerCase();
    return locationHierarchy
      .map(node => {
        if (node.region.toLowerCase().includes(lowerQuery)) return node;
        const matchingLocations = node.locations.filter(c => c.toLowerCase().includes(lowerQuery));
        return matchingLocations.length > 0 ? { ...node, locations: matchingLocations } : null;
      })
      .filter((node): node is { region: string; locations: string[]; allLocations: string[] } => node !== null);
  }, [locationHierarchy, searchQuery]);

  useEffect(() => {
    if (searchQuery) {
      setExpandedRegions(new Set(locationsToDisplay.map(l => l.region)));
    }
  }, [searchQuery, locationsToDisplay]);

  const toggleRegion = (locationsInRegion: string[]) => {
    const allSelected = locationsInRegion.every(c => selectedSet.has(c));
    if (allSelected) {
      onSetSelectedLocations(prev => prev.filter(c => !locationsInRegion.includes(c)));
    } else {
      onSetSelectedLocations(prev => {
        const next = new Set(prev);
        locationsInRegion.forEach(c => next.add(c));
        return Array.from(next);
      });
    }
  };

  const toggleRegionExpand = (region: string) => {
    setExpandedRegions(prev => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  };

  const unitLabel = isStatistics ? 'papers' : entityNoun.toLowerCase();

  return (
    <div className="flex flex-col shrink-0">
      <div className="flex justify-between items-center mb-4 shrink-0">
        <SectionTitle
          title={
            <button
              type="button"
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded(!isExpanded)}
              className={`${CONTROL_FOCUS} rounded-sm flex items-center gap-1.5 font-display text-xs font-bold tracking-wider uppercase text-on-surface-variant hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-1 -m-1 press-scale-sm`}
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
              LOCATION
            </button>
          }
        />
        <SectionSymbols
          symbol={isExpanded && (isStatistics
            ? <CountSymbol hint="Papers with an author in each location, subject to other filters" />
            : <CountSymbol icon={entityIcon} hint={`${entityNoun} per location, subject to other filters`} />)}
          reset={selectedLocations.length > 0 && (
            <ResetButton
              label="Reset location filter"
              description={`Reset location filter (${selectedLocations.length} selected)`}
              onReset={onClearLocations}
            />
          )}
        />
      </div>

      {isExpanded && (
        <React.Fragment>
          <SearchField
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search locations..."
            label="Search locations"
            clearLabel="Clear location search"
          />
          <div className={`${FILTER_LIST_CLASS} gap-1`}>
            {locationHierarchy.length === 0 && (error || topicCountsFailed) ? (
              <ListFailure />
            ) : locationHierarchy.length === 0 && (loading || (isStatistics && !paperLocations)) ? (
              <ListLoading />
            ) : locationsToDisplay.length === 0 ? (
              <div className="text-on-surface-variant text-xs py-4 text-center">No locations match</div>
            ) : (
              locationsToDisplay.map(node => {
                const allSelected = node.allLocations.every(c => selectedSet.has(c));
                const someSelected = node.allLocations.some(c => selectedSet.has(c));
                const isIndeterminate = someSelected && !allSelected;
                const regionExpanded = expandedRegions.has(node.region);

                return (
                  <div key={node.region} className="flex flex-col">
                    <div className="flex items-start">
                      <Tooltip contents content={regionExpanded ? 'Hide locations' : 'Show locations'}>
                        <button
                          type="button"
                          onClick={() => toggleRegionExpand(node.region)}
                          aria-expanded={regionExpanded}
                          aria-label={`${regionExpanded ? 'Hide' : 'Show'} locations in ${node.region}`}
                          className={`${CONTROL_FOCUS} mt-1.5 w-5 h-5 flex items-center justify-center rounded text-on-surface-variant hover:text-primary bg-transparent border-none cursor-pointer shrink-0`}
                        >
                          {regionExpanded ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                        </button>
                      </Tooltip>

                      <label className={`flex-1 min-w-0 flex items-start gap-3 cursor-pointer group text-xs leading-snug py-2 px-2 rounded-md transition-colors ease-[var(--ease-spring)] press-scale-sm ${allSelected ? 'bg-primary/10' : 'hover:bg-on-surface/5'}`}>
                        <input
                          ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                          type="checkbox"
                          className="peer sr-only"
                          checked={allSelected}
                          aria-checked={isIndeterminate ? 'mixed' : allSelected}
                          onChange={() => toggleRegion(node.allLocations)}
                        />
                        <div aria-hidden="true" className={`mt-[2px] w-3.5 h-3.5 squircle-sm flex items-center justify-center border transition-colors ease-[var(--ease-spring)] shrink-0 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary ${allSelected || isIndeterminate ? 'bg-primary border-primary text-on-primary' : 'border-outline group-hover:border-primary'}`}>
                          {allSelected && <Check size={10} strokeWidth={3} />}
                          {isIndeterminate && <Minus size={10} strokeWidth={3} />}
                        </div>
                        <span className={`flex-1 break-words ${allSelected || isIndeterminate ? 'text-primary font-bold' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
                          {node.region}
                        </span>
                        <FilterCount
                          count={isStatistics ? (paperLocations && (topicCounts?.regions?.[node.region] ?? 0)) : (locationCounts.regions[node.region] ?? 0)}
                          unit={unitLabel}
                        />
                      </label>
                    </div>

                    {regionExpanded && (
                      <div className="ml-5 border-l border-outline/70 flex flex-col gap-0.5 my-0.5">
                        {node.locations.map(location => {
                          const isSelected = selectedSet.has(location);
                          return (
                            <label
                              key={location}
                              className={`flex items-start gap-3 cursor-pointer group text-xs leading-snug py-2 pl-3 pr-2 rounded-md transition-colors ease-[var(--ease-spring)] press-scale-sm ${isSelected ? 'bg-primary/10' : 'hover:bg-on-surface/5'}`}
                            >
                              <input
                                type="checkbox"
                                className="peer sr-only"
                                checked={isSelected}
                                onChange={() => onToggleLocation(location)}
                              />
                              <div aria-hidden="true" className={`mt-[2px] w-3.5 h-3.5 squircle-sm flex items-center justify-center border transition-colors ease-[var(--ease-spring)] shrink-0 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary ${isSelected ? 'bg-primary border-primary text-on-primary' : 'border-outline group-hover:border-primary'}`}>
                                {isSelected && <Check size={10} strokeWidth={3} />}
                              </div>
                              <span className={`flex-1 break-words ${isSelected ? 'text-primary font-bold' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
                                {location}
                              </span>
                              <FilterCount
                                count={isStatistics ? (paperLocations && (paperLocations[location] ?? 0)) : (locationCounts.locations[location] ?? 0)}
                                unit={unitLabel}
                              />
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}
