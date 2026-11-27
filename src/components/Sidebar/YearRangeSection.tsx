import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { LOADING } from '../../lib/messages';
import { CONTROL_FOCUS } from '../ui/Controls';
import { Shimmer } from '../ui/Shimmer';
import { SliderFrame, SLIDER_VALUE_CLASS } from './RangeSlider';
import { ResetButton, SectionSymbols } from './ResetButton';

const YEAR_THUMB_CLASS =
  'absolute w-full appearance-none bg-transparent pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-interactive [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:shadow-interactive [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer';

interface YearRangeSectionProps {
  yearsReady: boolean;
  yearMin: number | null;
  yearMax: number | null;
  startYear: number;
  endYear: number;
  error: string | null;
  onStartYearChange: (year: number) => void;
  onEndYearChange: (year: number) => void;
  onReset: () => void;
}

export function YearRangeSection({
  yearsReady,
  yearMin,
  yearMax,
  startYear,
  endYear,
  error,
  onStartYearChange,
  onEndYearChange,
  onReset,
}: YearRangeSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const yearSpan = Math.max(1, (yearMax ?? 1) - (yearMin ?? 0));

  return (
    <div className="shrink-0">
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded(!isExpanded)}
          className={`${CONTROL_FOCUS} rounded-sm flex items-center gap-1.5 font-display text-xs font-bold tracking-wider uppercase text-on-surface-variant hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-1 -m-1 press-scale-sm`}
        >
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
          YEAR RANGE
        </button>
        {yearsReady && (startYear !== yearMin || endYear !== yearMax) && (
          <SectionSymbols reset={<ResetButton label="Reset year range" onReset={onReset} />} />
        )}
      </div>
      {isExpanded && !yearsReady && (
        <div className="w-full px-4 max-w-[380px] md:max-w-[420px] lg:max-w-[368px] 2xl:max-w-[420px] mx-auto">
          {error
            ? <div className="font-mono text-xs uppercase tracking-wider text-on-surface-variant">Could not load</div>
            : <Shimmer as="div" className="w-fit font-mono text-xs uppercase tracking-wider">{LOADING.list}</Shimmer>}
        </div>
      )}
      {isExpanded && yearsReady && (
        <div className="w-full px-4 max-w-[380px] md:max-w-[420px] lg:max-w-[368px] 2xl:max-w-[420px] mx-auto">
          <SliderFrame
            label="Selected"
            value={<span className={SLIDER_VALUE_CLASS}>{startYear} &ndash; {endYear}</span>}
            ends={[yearMin, yearMax]}
          >
            <div className="absolute w-full h-1 bg-outline rounded-full"></div>
            <div
              className="absolute h-1 bg-primary rounded-full"
              style={{
                left: `${((startYear - yearMin!) / yearSpan) * 100}%`,
                right: `${100 - ((endYear - yearMin!) / yearSpan) * 100}%`,
              }}
            ></div>
            <input
              type="range"
              min={yearMin!}
              max={yearMax!}
              step="1"
              value={startYear}
              aria-label="Start year"
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                onStartYearChange(val);
                if (val > endYear) onEndYearChange(val);
              }}
              className={`${YEAR_THUMB_CLASS} ${startYear === yearMax && endYear === yearMax ? 'z-40' : 'z-20'}`}
            />
            <input
              type="range"
              min={yearMin!}
              max={yearMax!}
              step="1"
              value={endYear}
              aria-label="End year"
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (val < startYear) {
                  onStartYearChange(val);
                  onEndYearChange(val);
                } else {
                  onEndYearChange(val);
                }
              }}
              className={`${YEAR_THUMB_CLASS} z-30`}
            />
          </SliderFrame>
        </div>
      )}
    </div>
  );
}
