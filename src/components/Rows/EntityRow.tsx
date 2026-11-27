import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useExplorerContext } from '../../context/ExplorerContext';
import { LOADING } from '../../lib/messages';
import type { Paper, PapersResponse, ViewMode } from '../../types';
import { LoadFailure } from '../ui/LoadFailure';
import { Shimmer } from '../ui/Shimmer';
import { Tooltip } from '../ui/Tooltip';
import {
  detailFilterSignature,
  fetchDetail,
  listColumns,
  metricShortPrefix,
  ROW_NUMBER_CLASS,
  type DetailFilterParams,
} from './utils';

const loadPaperList = () => import('./PaperList');
const PaperList = lazy(loadPaperList);

const ROW_FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export interface RowChildItem {
  id: string;
  name: string;
  link: string | null;
  profileLabel: 'author' | 'institution';
  score: number;
}

interface EntityRowProps {
  viewMode: ViewMode;
  uniqueKey: string;
  index: number;
  isExpanded: boolean;
  toggleRow: (uniqueKey: string) => void;
  primaryName: string;
  primaryLink: string | null;
  primaryProfileLabel: 'institution' | 'author';
  secondaryText: string;
  score: number;
  childrenNoun: 'Researchers' | 'Institutions';
  includeLocations: boolean;
  canFetchChildren: boolean;
  fetchChildren: (filters: DetailFilterParams, signal: AbortSignal) => Promise<RowChildItem[]>;
  buildPapersUrl: (childId: string, filters: DetailFilterParams) => URL;
}

export const EntityRow: React.FC<EntityRowProps> = React.memo(({
  viewMode,
  uniqueKey,
  index,
  isExpanded,
  toggleRow,
  primaryName,
  primaryLink,
  primaryProfileLabel,
  secondaryText,
  score,
  childrenNoun,
  includeLocations,
  canFetchChildren,
  fetchChildren,
  buildPapersUrl,
}) => {
  const {
    metricMode,
    topicFilter,
    platformFilter,
    selectedVenues,
    selectedLocations,
    startYear,
    endYear,
    facultyMinContribution,
    paperQuery,
  } = useExplorerContext();

  const filters = useMemo<DetailFilterParams>(() => ({
    metricMode,
    startYear,
    endYear,
    facultyMinContribution,
    topicFilter,
    platformFilter,
    selectedVenues,
    selectedLocations,
    paperQuery,
  }), [
    metricMode,
    startYear,
    endYear,
    facultyMinContribution,
    topicFilter,
    platformFilter,
    selectedVenues,
    selectedLocations,
    paperQuery,
  ]);
  const filterKey = detailFilterSignature(filters, includeLocations);

  const [children, setChildren] = useState<RowChildItem[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [papersFailed, setPapersFailed] = useState<Record<string, boolean>>({});
  const [expandedChildren, setExpandedChildren] = useState<Record<string, boolean>>({});
  const [childPapers, setChildPapers] = useState<Record<string, Paper[]>>({});

  const paperControllers = useRef(new Map<string, AbortController>());
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const fetchChildrenRef = useRef(fetchChildren);
  fetchChildrenRef.current = fetchChildren;

  const abortAllPaperControllers = useCallback(() => {
    for (const controller of paperControllers.current.values()) {
      controller.abort();
    }
    paperControllers.current.clear();
  }, []);

  useEffect(() => abortAllPaperControllers, [abortAllPaperControllers]);

  const loadChildPapers = async (childId: string) => {
    setPapersFailed(prev => ({ ...prev, [childId]: false }));
    const requestUrl = buildPapersUrl(childId, filtersRef.current);
    const controller = new AbortController();
    paperControllers.current.get(childId)?.abort();
    paperControllers.current.set(childId, controller);
    try {
      const json = await fetchDetail<PapersResponse>(requestUrl, controller.signal);
      if (!controller.signal.aborted) {
        setChildPapers(prev => ({ ...prev, [childId]: Array.isArray(json.papers) ? json.papers : [] }));
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setPapersFailed(prev => ({ ...prev, [childId]: true }));
      }
    } finally {
      if (paperControllers.current.get(childId) === controller) {
        paperControllers.current.delete(childId);
      }
    }
  };

  const toggleChild = (childId: string) => {
    const isOpening = !expandedChildren[childId];
    setExpandedChildren(prev => ({ ...prev, [childId]: isOpening }));
    if (isOpening) {
      void loadPaperList();
      if (!childPapers[childId]) void loadChildPapers(childId);
    }
  };

  // Expanded sub-lists belong to the entity and filter state they were fetched under.
  const lastContextKey = useRef(`${uniqueKey}\u0000${filterKey}`);
  useEffect(() => {
    const nextKey = `${uniqueKey}\u0000${filterKey}`;
    if (lastContextKey.current === nextKey) return;
    lastContextKey.current = nextKey;
    abortAllPaperControllers();
    setChildren([]);
    setDetailError(false);
    setChildPapers({});
    setPapersFailed({});
    setExpandedChildren({});
  }, [uniqueKey, filterKey, abortAllPaperControllers]);

  useEffect(() => {
    if (!isExpanded || !canFetchChildren) {
      abortAllPaperControllers();
      return undefined;
    }
    const controller = new AbortController();
    const fetchDetails = async () => {
      setLoadingDetails(true);
      setDetailError(false);
      try {
        const items = await fetchChildrenRef.current(filtersRef.current, controller.signal);
        if (!controller.signal.aborted) setChildren(items);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setDetailError(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingDetails(false);
      }
    };
    void fetchDetails();
    return () => controller.abort();
  }, [isExpanded, canFetchChildren, uniqueKey, filterKey, detailAttempt, abortAllPaperControllers]);

  const desktopName = primaryName.length > 60 ? `${primaryName.slice(0, 60)}…` : primaryName;
  const primaryProfileTooltip = primaryProfileLabel === 'institution' ? 'View institution profile' : 'View author profile';

  return (
    <React.Fragment>
      <div
        className={`h-auto min-h-[5rem] py-3 @2xl/results:h-14 pointer-coarse:@2xl/results:h-16 @2xl/results:min-h-0 @2xl/results:py-0 grid ${listColumns(viewMode, metricMode !== 'none')} px-4 @2xl/results:px-6 @5xl/results:px-10 border-b border-outline-variant items-center transition-all duration-500 ease-[var(--ease-spring-gentle)] hover:bg-surface-variant cursor-pointer press-scale-sm ${
          isExpanded
            ? 'bg-surface-variant border-l-4 border-l-primary pl-[12px] @2xl/results:pl-[20px] @5xl/results:pl-[calc(2.5rem-4px)]'
            : ''
        }`}
        onClick={() => toggleRow(uniqueKey)}
      >
        <span className={ROW_NUMBER_CLASS}>{(index + 1).toLocaleString()}</span>
        <div className="font-semibold text-sm pointer-coarse:@2xl/results:text-base pr-2 @2xl/results:pr-4 text-on-surface leading-relaxed min-w-0 py-1 @2xl/results:py-2 flex flex-col justify-center">
          {/* Compact: the name is running text, in full, with the link after its last word. Columns: one truncated line. */}
          <div className="min-w-0 @2xl/results:flex @2xl/results:flex-nowrap @2xl/results:items-center @2xl/results:gap-2">
            <Tooltip contents content={primaryName}>
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={(e) => { e.stopPropagation(); toggleRow(uniqueKey); }}
                className={`${ROW_FOCUS} inline text-left align-middle break-words font-semibold text-inherit bg-transparent border-0 p-0 cursor-pointer rounded-sm @2xl/results:block @2xl/results:min-w-0 @2xl/results:break-normal @2xl/results:truncate`}
              >
                <span className="@2xl/results:hidden">{primaryName}</span>
                <span className="hidden @2xl/results:inline">{desktopName}</span>
              </button>
            </Tooltip>
            {primaryLink && (
              <Tooltip content={primaryProfileTooltip} className="shrink-0 ml-2 @2xl/results:ml-0">
                <a
                  href={primaryLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${ROW_FOCUS} rounded-sm text-on-surface-variant hover:text-primary transition-colors inline-flex items-center justify-center p-3 -m-3 align-middle relative -top-0.5 whitespace-nowrap`}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`${primaryName}: ${primaryProfileLabel} profile (opens in a new tab)`}
                >
                  <ExternalLink aria-hidden="true" size={16} className="@2xl/results:w-3.5 @2xl/results:h-3.5 pointer-coarse:w-4 pointer-coarse:h-4" />
                </a>
              </Tooltip>
            )}
          </div>
          <div className="@2xl/results:hidden text-xs text-on-surface-variant font-sans mt-1 flex justify-between items-center gap-2">
            <span className="truncate pr-2">{secondaryText}</span>
            {metricMode !== 'none' && (
              <span className="shrink-0">
                {metricShortPrefix(metricMode)} Count: <span className="font-mono">{Number(score).toFixed(2)}</span>
              </span>
            )}
          </div>
        </div>

        <div className="text-xs text-on-surface-variant h-full items-center min-w-0 pr-2 @2xl/results:pr-4 hidden @2xl/results:flex">
          <Tooltip content={secondaryText}>
            <div className="line-clamp-2 leading-tight break-words">
              {secondaryText}
            </div>
          </Tooltip>
        </div>

        {metricMode !== 'none' && (
          <div className="hidden @2xl/results:flex text-right font-mono text-xs h-full items-center justify-end pl-2">
            {Number(score).toFixed(2)}
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="bg-surface-variant px-4 @2xl/results:px-6 @5xl/results:px-10 py-6 @2xl/results:py-8 pl-6 @2xl/results:pl-12 @5xl/results:pl-[calc(2.5rem+80px)] border-b border-outline-variant">
          <div className="flex flex-col gap-2">
            {detailError ? (
              <div className="px-4 pb-4"><LoadFailure what={childrenNoun} size="inline" onRetry={() => setDetailAttempt(n => n + 1)} /></div>
            ) : loadingDetails ? (
              <div className="px-4 pb-4">
                <Shimmer as="div" className="w-fit font-mono text-xs uppercase tracking-wider">{LOADING.detail}</Shimmer>
              </div>
            ) : children.length === 0 ? (
              <div className="px-4 pb-4 text-xs text-on-surface-variant">No {childrenNoun.toLowerCase()} match these filters.</div>
            ) : (
              children.map(item => (
                <div key={item.id} className="flex flex-col pb-2">
                  <div
                    className="flex justify-between text-sm items-start cursor-pointer group press-scale-sm rounded-sm"
                    onClick={(e) => { e.stopPropagation(); toggleChild(item.id); }}
                  >
                    <div className="text-on-surface-variant pr-4 leading-relaxed flex items-center">
                      <button
                        type="button"
                        aria-expanded={Boolean(expandedChildren[item.id])}
                        onClick={(e) => { e.stopPropagation(); toggleChild(item.id); }}
                        className={`${ROW_FOCUS} inline-flex items-center text-left text-inherit bg-transparent border-0 p-0 cursor-pointer rounded-sm`}
                      >
                        <span className="text-on-surface-variant/50 group-hover:text-primary transition-colors">
                          {expandedChildren[item.id] ? <ChevronUp size={14} className="mr-2 inline" aria-hidden="true" /> : <ChevronDown size={14} className="mr-2 inline" aria-hidden="true" />}
                        </span>
                        <Tooltip content={item.name}>
                          <span className="inline align-middle group-hover:text-on-surface transition-colors">
                            {item.name}
                          </span>
                        </Tooltip>
                      </button>
                      {item.link && (
                        <Tooltip content={item.profileLabel === 'institution' ? 'View institution profile' : 'View author profile'}>
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${ROW_FOCUS} rounded-sm hover:text-primary transition-colors inline-flex items-center justify-center p-3 -m-3 align-middle relative -top-0.5 ml-2`}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`${item.name}: ${item.profileLabel} profile (opens in a new tab)`}
                          >
                            <ExternalLink aria-hidden="true" size={14} />
                          </a>
                        </Tooltip>
                      )}
                    </div>
                    {metricMode !== 'none' && (
                      <span className="font-mono text-xs group-hover:text-on-surface transition-colors">
                        {Number(item.score).toFixed(2)}
                      </span>
                    )}
                  </div>
                  {expandedChildren[item.id] && (
                    <Suspense
                      fallback={
                        <Shimmer as="div" className="w-fit font-mono text-[11px] uppercase tracking-wider mt-3 ml-6">
                          {LOADING.detail}
                        </Shimmer>
                      }
                    >
                      <PaperList
                        papers={childPapers[item.id]}
                        failed={Boolean(papersFailed[item.id])}
                        metricMode={metricMode}
                        onRetry={() => void loadChildPapers(item.id)}
                      />
                    </Suspense>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </React.Fragment>
  );
});
