/**
 * The filters the list and detail routes read from a query string, parsed and checked in one place: the paper
 * filters (years, topics, platforms, venues, locations, topic search; paperFilters.ts), paging, the metric, the name
 * search and the thresholds. A bad value is an InputError (HTTP 400), found before the topic search runs its model.
 */
import { InputError, queryNumber, queryText, queryThreshold, validMetricModes } from './utils';
import { PaperFilters, readPaperFilters } from './paperFilters';

/** none and adj_frac_count both mean Adjusted Fractional. */
export type MetricMode = 'none' | 'adj_frac_count' | 'frac_count' | 'total_count';

export interface ListFilters extends PaperFilters {
  limit?: number;
  offset: number;
  metricMode: MetricMode;
  /** The name search box (institution or researcher names), as typed. */
  search?: string;
  individualThreshold?: number;
  institutionalThreshold?: number;
  averageThreshold?: number;
}

export async function readListFilters(query: Record<string, unknown>): Promise<ListFilters> {
  const metric = query.metric_mode;
  if (metric !== undefined && (typeof metric !== 'string' || !validMetricModes.has(metric))) {
    throw new InputError('Invalid metric_mode');
  }
  const own = {
    limit: queryNumber(query.limit, 'limit', 1, 1_000_000),
    offset: queryNumber(query.offset, 'offset', 0, 1_000_000_000) ?? 0,
    metricMode: (metric as MetricMode | undefined) ?? 'none',
    search: queryText(query.search, 'search', 300),
    individualThreshold: queryThreshold(query.individual_threshold, 'individual_threshold'),
    institutionalThreshold: queryThreshold(query.institutional_threshold, 'institutional_threshold'),
    averageThreshold: queryThreshold(query.average_threshold, 'average_threshold'),
  };
  return { ...(await readPaperFilters(query)), ...own };
}

/** Appends LIMIT/OFFSET for the filters' page (an offset alone works too) and pushes their values. */
export function addPaging(sql: string, params: unknown[], f: Pick<ListFilters, 'limit' | 'offset'>): string {
  if (f.limit !== undefined) {
    params.push(f.limit);
    if (f.offset > 0) { params.push(f.offset); return `${sql} LIMIT ? OFFSET ?`; }
    return `${sql} LIMIT ?`;
  }
  if (f.offset > 0) { params.push(f.offset); return `${sql} LIMIT -1 OFFSET ?`; }
  return sql;
}
