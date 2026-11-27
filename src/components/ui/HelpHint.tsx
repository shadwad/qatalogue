import React, { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { CONTROL_FOCUS } from './Controls';
import { tooltipCardClass } from './Tooltip';

interface HelpHintProps {
  children: React.ReactNode;
  /** Custom trigger (e.g. a tag). Defaults to the "?" icon used across the sidebar. */
  trigger?: React.ReactNode;
  /** Which edge the popover aligns to. */
  align?: 'left' | 'right';
  /** Which side the popover opens on (use 'top' near the bottom of the viewport). */
  side?: 'top' | 'bottom';
  label?: string;
  className?: string;
  /**
   * Sits beside a section title. The popover anchors to SectionTitle's left edge, not the icon, so it always fits the sidebar:
   * even hidden, a popover past the edge makes the sidebar scroll sideways.
   */
  inline?: boolean;
}

/**
 * The one hover/focus hint style used app-wide: bordered rounded-xl popover, shadow-popover,
 * opens on hover, keyboard focus, or touch tap, and dismisses on Escape or outside press.
 */
export const HelpHint: React.FC<HelpHintProps> = ({ children, trigger, align = 'right', side = 'bottom', label = 'More information', className = '', inline = false }) => {
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  useEffect(() => {
    const node = rootRef.current;
    if (!pinnedOpen && !node) return;
    if (!pinnedOpen) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setPinnedOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPinnedOpen(false);
        setDismissed(true);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [pinnedOpen]);

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPinnedOpen(false); }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setPinnedOpen(false);
          setDismissed(true);
        }
      }}
      className={`group ${inline ? 'static' : 'relative'} flex items-center justify-center ${className}`}
    >
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          setDismissed(false);
          setPinnedOpen(o => !o);
        }}
        aria-label={label}
        aria-expanded={pinnedOpen}
        aria-describedby={tipId}
        className={`${CONTROL_FOCUS} flex items-center justify-center rounded-full border-0 bg-transparent cursor-help ${trigger ? 'p-0' : inline ? 'p-1 -my-1' : 'p-2 -my-2 -mr-2 md:p-1 md:my-0 md:-mr-1'}`}
      >
        {trigger ?? (
          <HelpCircle className="w-4 h-4 md:w-3 md:h-3 text-on-surface-variant group-hover:text-primary group-focus-within:text-primary transition-colors ease-md3" aria-hidden="true" />
        )}
      </button>
      <div
        id={tipId}
        role="tooltip"
        className={`absolute ${align === 'right' && !inline ? 'right-0' : 'left-0'} ${side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} w-[calc(100vw-2rem)] max-w-[304px] md:w-[218px] md:max-w-none transition-opacity duration-200 z-50 cursor-default ${
          pinnedOpen
            ? 'opacity-100 pointer-events-auto'
            : dismissed
              ? 'opacity-0 pointer-events-none'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100'
        }`}
      >
        <div className={tooltipCardClass}>
          {children}
        </div>
      </div>
    </div>
  );
};

/** A labelled entry inside a HelpHint ("Term" + explanation). */
export const HintItem: React.FC<{ term: string; children: React.ReactNode; last?: boolean }> = ({ term, children, last }) => (
  <div className={`${last ? '' : 'mb-2'} flex flex-col gap-0.5`}>
    <span className="font-semibold text-on-surface-variant">{term}</span>
    <span>{children}</span>
  </div>
);
