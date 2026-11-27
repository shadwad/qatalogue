import React from 'react';

/**
 * The text around a slider comes in three kinds, each with one style. Words are sans, numbers are mono.
 * - Name: what the row is (SliderFrame's label, and words beside the numbers, such as "First").
 * - Controlled value: what the slider sets. The only blue text in the row.
 * - Context: numbers that give the value meaning, such as totals, counts and the track's end values.
 */
export const SLIDER_NAME_CLASS = 'font-sans text-xs font-normal text-on-surface-variant';
export const SLIDER_VALUE_CLASS = 'font-mono text-xs font-bold text-primary';
const SLIDER_CONTEXT_CLASS = 'font-mono text-[11px] font-normal text-on-surface-variant/70';

/** The one slider layout: label and value above the track, the track's end values below. */
export const SliderFrame: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  ends?: [React.ReactNode, React.ReactNode];
  children?: React.ReactNode;
}> = ({ label, value, ends, children }) => (
  <div className="flex flex-col gap-1">
    <div className={`${children ? 'mb-2 ' : ''}flex justify-between items-baseline gap-3`}>
      <span className={SLIDER_NAME_CLASS}>{label}</span>
      <span className="flex items-baseline gap-1.5">{value}</span>
    </div>
    {children && <div className="relative w-full h-4 flex items-center">{children}</div>}
    {ends && (
      <div className={`flex justify-between w-full mt-1.5 ${SLIDER_CONTEXT_CLASS}`}>
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    )}
  </div>
);

/** A single-thumb track. */
export const SliderInput: React.FC<Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>> = props => (
  <input
    {...props}
    type="range"
    className="w-full h-1 bg-outline rounded-full appearance-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-interactive [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-full [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:shadow-interactive [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-none"
  />
);

interface RangeSliderProps {
  label: string;
  value: number;
  min?: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

/** Name on the left, the value it sets on the right, the track's end values below. */
export const RangeSlider: React.FC<RangeSliderProps> = ({ label, value, min = 0, max, step, onChange }) => (
  <SliderFrame
    label={label}
    value={<span className={SLIDER_VALUE_CLASS}>{value.toFixed(2)}</span>}
    ends={[min.toFixed(2), max.toFixed(2)]}
  >
    <SliderInput min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} aria-label={label} />
  </SliderFrame>
);
