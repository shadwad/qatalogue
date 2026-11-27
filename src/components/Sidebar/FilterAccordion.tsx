import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { CONTROL_FOCUS } from '../ui/Controls';
import { ListFailure } from '../ui/LoadFailure';
import { ResetButton, SectionSymbols, SectionTitle } from './ResetButton';
import { CountSymbol, FILTER_LIST_CLASS, FilterCount, ListLoading, ToggleSpacer } from './TopicTree';

interface FilterAccordionProps {
  title: string;
  items: string[];
  /** The list is still on its way, as opposed to being empty. */
  loading?: boolean;
  failed?: boolean;
  selectedItems: string[];
  onToggleItem: (item: string) => void;
  onClear: () => void;
  /** Papers per item under the other filters. */
  counts?: Record<string, number>;
  defaultExpanded?: boolean;
}

export const FilterAccordion: React.FC<FilterAccordionProps> = ({
  title, loading, failed,
  items,
  selectedItems,
  onToggleItem,
  onClear,
  counts,
  defaultExpanded = true
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="shrink-0">
      <div className="flex justify-between items-center mb-4">
        <SectionTitle
          title={
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded(!isExpanded)}
          className={`${CONTROL_FOCUS} rounded-sm flex items-center gap-1.5 font-display text-xs font-bold tracking-wider uppercase text-on-surface-variant hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-1 -m-1 press-scale-sm`}
        >
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
          {title}
        </button>
          }
        />
        <SectionSymbols
          symbol={isExpanded && <CountSymbol hint={`Papers per ${title.toLowerCase()}, subject to other filters`} />}
          reset={selectedItems.length > 0 && <ResetButton label={`Reset ${title.toLowerCase()} filter`} description={`Reset ${title.toLowerCase()} filter (${selectedItems.length} selected)`} onReset={onClear} />}
        />
      </div>
      {isExpanded && (
        <div className={`${FILTER_LIST_CLASS} gap-1`}>
          {loading ? (
            <ListLoading />
          ) : failed ? (
            <ListFailure />
          ) : items.length === 0 ? (
            <div className="text-xs text-on-surface-variant italic px-2">
              No {title.toLowerCase()} available
            </div>
          ) : (
            items.map((item) => {
              const isSelected = selectedItems.includes(item);
              const count = counts ? counts[item] ?? 0 : undefined;
              return (
                <div key={item} className="flex items-start">
                <ToggleSpacer />
                <label
                  className={`flex-1 min-w-0 flex items-start gap-3 cursor-pointer group text-xs leading-snug py-2 px-2 rounded-md transition-colors ease-[var(--ease-spring)] press-scale-sm ${
                    isSelected ? "bg-primary/10" : "hover:bg-on-surface/5"
                  } ${count === 0 && !isSelected ? "opacity-50" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={isSelected}
                    onChange={() => onToggleItem(item)}
                  />
                  <div
                    aria-hidden="true"
                    className={`mt-[2px] w-3.5 h-3.5 squircle-sm flex items-center justify-center border transition-colors ease-[var(--ease-spring)] shrink-0 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary ${
                      isSelected ? "bg-primary border-primary text-on-primary" : "border-outline group-hover:border-primary"
                    }`}
                  >
                    {isSelected && <Check size={10} strokeWidth={3} />}
                  </div>
                  <span
                    className={`flex-1 break-words ${
                      isSelected ? "text-primary font-bold" : "text-on-surface-variant group-hover:text-on-surface"
                    }`}
                  >
                    {item}
                  </span>
                  <FilterCount count={count} />
                </label>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
