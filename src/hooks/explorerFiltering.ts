import {
  isResearcherEntry,
  type ExplorerEntry,
  type FilterMatch,
  type LocationCounts,
  type MetricMode,
  type SortColumn,
  type SortDirection,
  type ViewMode,
} from '../types';

const alphabetical = new Intl.Collator(undefined, { sensitivity: 'base' });
const round9 = (value: number) => Math.round(value * 1e9) / 1e9;

export const entryId = (entry: ExplorerEntry): string =>
  isResearcherEntry(entry) ? entry.author_id : (entry.institution_id || entry.institution_name);

export const entryName = (entry: ExplorerEntry): string =>
  isResearcherEntry(entry) ? entry.author_name : entry.institution_name;

export const entrySecondary = (entry: ExplorerEntry): string =>
  (isResearcherEntry(entry) ? entry.latest_affiliation : entry.location) ?? '';

export function matchesSearch(entry: ExplorerEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = isResearcherEntry(entry)
    ? [entry.author_name, entry.location, entry.latest_affiliation]
    : [entry.institution_name, entry.location];
  return fields.some(s => typeof s === 'string' && s.toLowerCase().includes(q));
}

export function filterValues(selected: readonly string[], match: FilterMatch): string[] {
  const sorted = [...selected].sort();
  return match === 'all' && sorted.length >= 2 ? [sorted.join('+')] : sorted;
}

export function thresholdCaps(
  viewMode: ViewMode,
  metricMode: MetricMode,
): { indvMax: number; indvStep: number; instMax: number; instStep: number; avgMax: number; avgStep: number } {
  let indvMax = 2.0, indvStep = 0.05;
  let instMax = 30.0, instStep = 1.0;
  let avgMax = 2.5, avgStep = 0.05;

  if (viewMode === 'researcher') {
    if (metricMode === 'frac_count' || metricMode === 'adj_frac_count') {
      indvMax = 3.0;
      indvStep = 0.1;
    } else {
      indvMax = 10.0;
      indvStep = 1.0;
    }
  } else if (metricMode === 'frac_count') {
    indvMax = 3.0;
    indvStep = 0.1;
    instMax = 45.0;
    instStep = 1.0;
    avgMax = 3.5;
    avgStep = 0.1;
  } else if (metricMode === 'total_count' || metricMode === 'none') {
    indvMax = 10.0;
    indvStep = 1.0;
    instMax = 85.0;
    instStep = 1.0;
    avgMax = 6.0;
    avgStep = 0.5;
  }

  return { indvMax, indvStep, instMax, instStep, avgMax, avgStep };
}

export function filterThresholdedEntries(
  entries: readonly ExplorerEntry[],
  opts: {
    viewMode: ViewMode;
    facultyMinContribution: number;
    institutionMinContribution: number;
    avgContributionMin: number;
  },
): ExplorerEntry[] {
  return entries.filter(entry => {
    if (!entryName(entry).trim()) return false;
    const score = Number(entry.total_fractional_score ?? 0);
    const scoreR9 = round9(score);

    if (opts.viewMode === 'institution') {
      if (opts.institutionMinContribution > 0 && scoreR9 < opts.institutionMinContribution) {
        return false;
      }
      if (opts.avgContributionMin > 0) {
        const coreFaculty = isResearcherEntry(entry) ? 1 : Number(entry.core_faculty_count ?? 0);
        if (coreFaculty <= 0 || round9(score / coreFaculty) < opts.avgContributionMin) {
          return false;
        }
      }
    } else if (opts.facultyMinContribution > 0 && scoreR9 < opts.facultyMinContribution) {
      return false;
    }

    return true;
  });
}

export function filterByLocations(entries: readonly ExplorerEntry[], selectedLocations: readonly string[]): ExplorerEntry[] {
  if (selectedLocations.length === 0) return [...entries];
  const selected = new Set(selectedLocations);
  return entries.filter(entry => selected.has(entry.location || 'Unknown'));
}

export function computeLocationCounts(entries: readonly ExplorerEntry[]): LocationCounts {
  const locations: Record<string, number> = {};
  const regions: Record<string, number> = {};
  for (const entry of entries) {
    const location = entry.location || 'Unknown';
    const region = entry.region || 'Global';
    locations[location] = (locations[location] ?? 0) + 1;
    regions[region] = (regions[region] ?? 0) + 1;
  }
  return { locations, regions };
}

export function filterAndSortEntries(
  entries: readonly ExplorerEntry[],
  nameQuery: string,
  sortConfig: { column: SortColumn; direction: SortDirection },
): ExplorerEntry[] {
  const filtered = nameQuery.trim()
    ? entries.filter(entry => matchesSearch(entry, nameQuery))
    : [...entries];

  const compareByName = (a: ExplorerEntry, b: ExplorerEntry) => alphabetical.compare(entryName(a), entryName(b));
  filtered.sort((a, b) => {
    const order = sortConfig.column === 'score'
      ? round9(Number(a.total_fractional_score ?? 0)) - round9(Number(b.total_fractional_score ?? 0))
      : sortConfig.column === 'secondary'
        ? alphabetical.compare(entrySecondary(a), entrySecondary(b))
        : compareByName(a, b);
    return order ? (sortConfig.direction === 'asc' ? order : -order) : compareByName(a, b);
  });

  return filtered;
}

export function selectNetworkEntries(entries: readonly ExplorerEntry[], k: number): ExplorerEntry[] {
  return [...entries]
    .sort((a, b) => round9(Number(b.total_fractional_score ?? 0)) - round9(Number(a.total_fractional_score ?? 0)))
    .slice(0, k);
}
