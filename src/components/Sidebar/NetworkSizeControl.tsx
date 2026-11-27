import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SLIDER_NAME_CLASS, SLIDER_VALUE_CLASS, SliderFrame, SliderInput } from './RangeSlider';
import { ResetButton, SectionSymbols } from './ResetButton';
import { CONTROL_FOCUS } from '../ui/Controls';
import { Tooltip } from '../ui/Tooltip';
import { NETWORK_K_MIN, NETWORK_K_STEP, type ViewMode } from '../../hooks/useExplorerData';

interface NetworkSizeControlProps {
  viewMode: ViewMode;
  value: number;          // effective k (already clamped)
  max: number;            // min(cap, total)
  total: number;          // entries passing the current filters
  onCommit: (k: number) => void;
  defaultK: number;
}

/** Network size slider: shows the cut-off explicitly and only refetches when the thumb is released. */
export const NetworkSizeControl: React.FC<NetworkSizeControlProps> = ({ viewMode, value, max, total, onCommit, defaultK }) => {
  const [draft, setDraft] = useState(value);
  const [isExpanded, setIsExpanded] = useState(true);
  useEffect(() => setDraft(value), [value]);

  const noun = viewMode === 'institution' ? 'institutions' : 'researchers';
  const snapK = (raw: number) => {
    if (raw >= max - Math.floor(NETWORK_K_STEP / 2)) return max;
    const snapped = NETWORK_K_MIN + Math.round((raw - NETWORK_K_MIN) / NETWORK_K_STEP) * NETWORK_K_STEP;
    return Math.min(max, Math.max(NETWORK_K_MIN, snapped));
  };
  const commit = () => { if (draft !== value) onCommit(draft); };
  const showsAll = total <= NETWORK_K_MIN;

  return (
    <div className="shrink-0">
      <div className="font-display text-xs font-bold tracking-wider uppercase text-on-surface-variant mb-4 relative">
        <div className="flex items-center justify-between w-full">
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded(!isExpanded)}
            className={`${CONTROL_FOCUS} rounded-sm flex items-center gap-1.5 font-display text-xs font-bold tracking-wider uppercase text-on-surface-variant hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-1 -m-1 press-scale-sm`}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
            NETWORK SIZE
          </button>
          <SectionSymbols reset={value < max && <ResetButton label="Reset network size" onReset={() => onCommit(defaultK)} />} />
        </div>
      </div>

      {isExpanded && (
      <div className="w-full px-4 max-w-[380px] md:max-w-[420px] lg:max-w-[368px] 2xl:max-w-[420px] mx-auto">
        <SliderFrame
          label="Selected"
          value={showsAll ? <>
            <span className={SLIDER_NAME_CLASS}>All</span>
            <span className={SLIDER_VALUE_CLASS}>{total.toLocaleString()}</span>
          </> : <>
            <Tooltip contents content="First by research output, measured by the chosen attribution model">
              <span className={SLIDER_NAME_CLASS}>First</span>
            </Tooltip>
            <span className={SLIDER_VALUE_CLASS}>{draft.toLocaleString()}</span>
          </>}
          ends={showsAll ? undefined : [NETWORK_K_MIN.toLocaleString(), max.toLocaleString()]}
        >
          {!showsAll && (
            <SliderInput
              min={NETWORK_K_MIN}
              max={max}
              step={1}
              value={draft}
              aria-label={`Number of ${noun} in the network`}
              onChange={e => setDraft(snapK(parseInt(e.target.value, 10)))}
              onPointerUp={commit}
              onKeyUp={commit}
              onBlur={commit}
            />
          )}
        </SliderFrame>
      </div>
      )}
    </div>
  );
};
