import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, createLucideIcon } from 'lucide-react';
import type { MetricMode, ViewMode } from '../../types';
import { CONTROL_FOCUS } from '../ui/Controls';
import { HelpHint, HintItem } from '../ui/HelpHint';
import { SectionTitle } from './ResetButton';

/** The "required" mark. Lucide has no such icon; this one matches the ? hint circle. */
const CircledAsterisk = createLucideIcon('circled-asterisk', [
  ['circle', { cx: '12', cy: '12', r: '10', key: 'circle' }],
  ['path', { d: 'M12 7v10', key: 'vertical' }],
  ['path', { d: 'M16.33 9.5 7.67 14.5', key: 'rising' }],
  ['path', { d: 'm7.67 9.5 8.66 5', key: 'falling' }],
]);

interface AttributionSectionProps {
  viewMode: ViewMode;
  metricMode: MetricMode;
  isNetwork: boolean;
  attributionPulse: number;
  onSelectMetric: (mode: MetricMode) => void;
}

export function AttributionSection({
  viewMode,
  metricMode,
  isNetwork,
  attributionPulse,
  onSelectMetric,
}: AttributionSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isAttrPulsing, setIsAttrPulsing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstPulseRef = useRef(attributionPulse);

  useEffect(() => {
    if (attributionPulse === firstPulseRef.current) return;
    setIsAttrPulsing(true);
    const t = window.setTimeout(() => setIsAttrPulsing(false), 900);
    return () => window.clearTimeout(t);
  }, [attributionPulse]);

  // While the menu is open: a press outside, or Escape, closes it.
  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && event.target instanceof Node && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setIsDropdownOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [isDropdownOpen]);

  const metricOptions: { value: MetricMode; label: string }[] = [
    { value: 'none', label: 'None' },
    ...(viewMode !== 'researcher' ? [{ value: 'adj_frac_count' as const, label: 'Adjusted Fractional' }] : []),
    { value: 'frac_count', label: 'Fractional' },
    { value: 'total_count', label: 'Total' },
  ];

  const closeMenu = () => {
    setIsDropdownOpen(false);
    triggerRef.current?.focus();
  };

  const openMenu = () => {
    setIsDropdownOpen(true);
    // Focus the selected option (or the first enabled one) once the menu is drawn.
    requestAnimationFrame(() => {
      const options = dropdownRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)');
      const selected = dropdownRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]:not(:disabled)');
      (selected ?? options?.[0])?.focus();
    });
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      setIsDropdownOpen(false);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')];
    if (!options.length) return;
    if (event.key === 'Home') { options[0].focus(); return; }
    if (event.key === 'End') { options[options.length - 1].focus(); return; }
    const at = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (at + 1) % options.length : (at <= 0 ? options.length - 1 : at - 1);
    options[next].focus();
  };

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
                className={`${CONTROL_FOCUS} rounded-sm flex items-center gap-1.5 font-display text-xs font-bold tracking-wider uppercase text-on-surface-variant hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-1 -m-1 press-scale-sm`}
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
                ATTRIBUTION MODEL
              </button>
            }
            hints={
              <>
                <HelpHint inline label="About attribution models">
                  <HintItem term="None">Alphabetical by default, with counts hidden</HintItem>
                  {viewMode !== 'researcher' && <HintItem term="Adjusted Fractional (AF)">Credit split equally among a paper's authors, then among each author's institutions</HintItem>}
                  <HintItem term="Fractional (F)">Credit split equally among a paper's authors</HintItem>
                  <HintItem term="Total (T)" last>Full credit to every author and institution on a paper</HintItem>
                </HelpHint>
                {isNetwork && (
                  <HelpHint
                    inline
                    label="Required: why an attribution model is needed"
                    className="p-1 -my-1"
                    trigger={<CircledAsterisk className="animate-modal-in w-4 h-4 md:w-3 md:h-3 text-primary" aria-hidden="true" />}
                  >
                    Network view needs a model because it picks and sizes entries by their counts.
                  </HelpHint>
                )}
              </>
            }
          />
        </div>
      </div>
      {isExpanded && (
        <div className="flex justify-center w-full px-4">
          <div className="relative w-full max-w-[380px] md:max-w-[420px] lg:max-w-[368px] 2xl:max-w-[420px] mx-auto">
            <div ref={dropdownRef} className="relative w-full">
              <button
                ref={triggerRef}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isDropdownOpen}
                aria-label={`Attribution model: ${metricOptions.find(o => o.value === metricMode)?.label ?? 'None'}`}
                className={`${CONTROL_FOCUS} w-full bg-surface border border-outline rounded-full px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface hover:border-primary/40 transition-colors ease-[var(--ease-spring)] cursor-pointer flex justify-between items-center shadow-interactive press-scale ${isAttrPulsing ? 'animate-attr-pop' : ''}`}
                onClick={() => (isDropdownOpen ? closeMenu() : openMenu())}
              >
                <span>{metricOptions.find(o => o.value === metricMode)?.label || 'None'}</span>
                <svg aria-hidden="true" className={`w-3 h-3 text-on-surface-variant transition-transform duration-300 ease-[var(--ease-spring)] ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                </svg>
              </button>
              {isDropdownOpen && (
                <div
                  role="listbox"
                  aria-label="Attribution model options"
                  onKeyDown={onMenuKeyDown}
                  className="absolute top-full left-0 mt-1 w-full bg-surface border border-outline rounded-xl z-50 overflow-hidden shadow-popover"
                >
                  {metricOptions.map(option => {
                    const isDisabled = isNetwork && option.value === 'none';
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={metricMode === option.value}
                        disabled={isDisabled}
                        className={`${CONTROL_FOCUS} w-full text-left px-3 py-2 text-xs border-none transition-colors ease-[var(--ease-spring)] ${
                          isDisabled
                            ? 'bg-transparent cursor-not-allowed text-on-surface-variant/50 flex justify-between items-center gap-2'
                            : `cursor-pointer press-scale-sm ${metricMode === option.value ? 'bg-primary/10 text-primary font-semibold' : 'bg-transparent text-on-surface hover:bg-on-surface/5'}`
                        }`}
                        onClick={() => {
                          onSelectMetric(option.value);
                          closeMenu();
                        }}
                      >
                        {option.label}
                        {isDisabled && <span className="italic text-[11px]">Not available in Network</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
