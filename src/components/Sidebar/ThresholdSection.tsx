import { useState } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { thresholdCaps } from '../../hooks/explorerFiltering';
import type { MetricMode, ViewMode } from '../../types';
import { HelpHint, HintItem } from '../ui/HelpHint';
import { RangeSlider, SliderFrame, SLIDER_VALUE_CLASS } from './RangeSlider';
import { ResetButton, SectionSymbols, SectionTitle } from './ResetButton';
import { CountSymbol } from './TopicTree';

interface ThresholdSectionProps {
  viewMode: ViewMode;
  metricMode: MetricMode;
  networkTotal: number;
  facultyMinContribution: number;
  institutionMinContribution: number;
  avgContributionMin: number;
  onFacultyMinChange: (value: number) => void;
  onInstitutionMinChange: (value: number) => void;
  onAvgMinChange: (value: number) => void;
  onReset: () => void;
  entityIcon: LucideIcon;
  entityNoun: string;
}

export function ThresholdSection({
  viewMode,
  metricMode,
  networkTotal,
  facultyMinContribution,
  institutionMinContribution,
  avgContributionMin,
  onFacultyMinChange,
  onInstitutionMinChange,
  onAvgMinChange,
  onReset,
  entityIcon,
  entityNoun,
}: ThresholdSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { indvMax, indvStep, instMax, instStep, avgMax, avgStep } = thresholdCaps(viewMode, metricMode);

  return (
    <div className="shrink-0">
      <div className="font-display text-xs font-bold tracking-wider uppercase text-on-surface-variant mb-4 relative">
        <div className="flex items-center justify-between w-full">
          <SectionTitle
            title={
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-1.5 font-display text-xs font-bold tracking-wider uppercase text-on-surface-variant hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-1 -m-1 press-scale-sm"
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
                MODEL THRESHOLD
              </button>
            }
            hints={
              <HelpHint inline label="About model thresholds">
                <div className="mb-2">Minimum contribution, measured with the chosen attribution model</div>
                <HintItem term="Individual" last={viewMode !== 'institution'}>
                  {viewMode === 'institution' ? 'Only researchers with at least this count toward their institution' : 'Researchers with at least this'}
                </HintItem>
                {viewMode === 'institution' && (
                  <>
                    <HintItem term="Institutional">Institutions with at least this in total</HintItem>
                    <HintItem term="Adjusted Average" last>Institutions where those researchers average at least this</HintItem>
                  </>
                )}
              </HelpHint>
            }
          />
          <SectionSymbols
            symbol={isExpanded && <CountSymbol icon={entityIcon} hint={`${entityNoun} kept by all thresholds together, subject to other filters`} />}
            reset={(facultyMinContribution > 0 || institutionMinContribution > 0 || avgContributionMin > 0) && (
              <ResetButton label="Reset model thresholds" onReset={onReset} />
            )}
          />
        </div>
      </div>

      {isExpanded && (
        <div className="flex flex-col gap-7 w-full px-4 max-w-[380px] md:max-w-[420px] lg:max-w-[368px] 2xl:max-w-[420px] mx-auto">
          <SliderFrame
            label="Selected"
            value={<span className={SLIDER_VALUE_CLASS}>{networkTotal.toLocaleString()}</span>}
          />
          <div className="flex flex-col gap-5">
            <RangeSlider
              label="Individual"
              value={facultyMinContribution}
              min={0}
              max={indvMax}
              step={indvStep}
              onChange={onFacultyMinChange}
            />

            {viewMode === 'institution' && (
              <>
                <RangeSlider
                  label="Institutional"
                  value={institutionMinContribution}
                  min={0}
                  max={instMax}
                  step={instStep}
                  onChange={onInstitutionMinChange}
                />

                <RangeSlider
                  label="Adjusted Average"
                  value={avgContributionMin}
                  min={0}
                  max={avgMax}
                  step={avgStep}
                  onChange={onAvgMinChange}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
