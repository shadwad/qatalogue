import type React from 'react';
import { useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { entryId } from '../../hooks/useExplorerData';
import type { ExplorerEntry, SearchScope, ViewMode } from '../../types';
import { EmptyState } from '../ui/EmptyState';
import { LoadFailure } from '../ui/LoadFailure';
import { ExplorerRow } from './ExplorerRow';
import { TopicSearchShortcut } from './PaperSearch';

interface ResultsListProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
  yearsReady: boolean;
  loading: boolean;
  loadingElement: React.ReactNode;
  error: string | null;
  retryLoad: () => void;
  retrying: boolean;
  entries: ExplorerEntry[];
  expandedRows: ReadonlySet<string>;
  toggleRow: (id: string) => void;
  viewMode: ViewMode;
  searchScope: SearchScope;
  setSearchScope: (scope: SearchScope) => void;
  searchQuery: string;
  paperQuery: string;
  paperQueryPending: boolean;
  startYear: number;
  endYear: number;
  topicFilter: string[];
  platformFilter: string[];
  selectedVenues: string[];
  pendingScrollId: string | null;
  onScrolledToPending: () => void;
}

export function ResultsList({
  scrollRef,
  enabled,
  yearsReady,
  loading,
  loadingElement,
  error,
  retryLoad,
  retrying,
  entries,
  expandedRows,
  toggleRow,
  viewMode,
  searchScope,
  setSearchScope,
  searchQuery,
  paperQuery,
  paperQueryPending,
  startYear,
  endYear,
  topicFilter,
  platformFilter,
  selectedVenues,
  pendingScrollId,
  onScrolledToPending,
}: ResultsListProps) {
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: i => entryId(entries[i]),
    // Off while the list isn't showing so React doesn't loop measuring zero-height rows.
    enabled,
    estimateSize: () => {
      const width = scrollRef.current?.clientWidth ?? 0;
      if (width < 672) return 80;
      return window.matchMedia('(pointer: coarse)').matches ? 64 : 56;
    },
    overscan: 10,
  });

  useEffect(() => {
    if (!pendingScrollId || !enabled || loading) return;
    const index = entries.findIndex(e => entryId(e) === pendingScrollId);
    if (index < 0) {
      onScrolledToPending();
      return;
    }
    const frame = requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(index, { align: 'start' });
      onScrolledToPending();
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingScrollId, enabled, loading, entries, rowVirtualizer, onScrolledToPending]);

  if (loading) return <>{loadingElement}</>;
  if (error) {
    return (
      <div className="p-10 lg:p-16">
        <LoadFailure what="The list" onRetry={retryLoad} retrying={retrying} />
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="p-10 lg:p-16 flex flex-col items-center gap-4">
        <EmptyState>
          {paperQuery
            ? `No papers match “${paperQuery}” under these filters.`
            : `No ${viewMode === 'institution' ? 'institutions' : 'researchers'} match these filters.`}
        </EmptyState>
        {searchScope === 'names' && searchQuery.trim().length >= 2 && (
          <TopicSearchShortcut
            query={searchQuery}
            yearsReady={yearsReady}
            startYear={startYear}
            endYear={endYear}
            topics={topicFilter}
            platforms={platformFilter}
            venues={selectedVenues}
            noun={viewMode === 'institution' ? 'institutions' : 'researchers'}
            onSwitch={() => setSearchScope('papers')}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`w-full max-w-screen-2xl mx-auto transition-opacity duration-200 ${paperQueryPending ? 'opacity-50' : ''}`}>
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map(virtualRow => {
          const inst = entries[virtualRow.index];
          const uniqueKey = entryId(inst);
          const isExpanded = expandedRows.has(uniqueKey);

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div data-index={virtualRow.index} ref={rowVirtualizer.measureElement}>
                <ExplorerRow inst={inst} index={virtualRow.index} isExpanded={isExpanded} toggleRow={toggleRow} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
