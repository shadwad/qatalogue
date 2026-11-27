import React from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

export const CONTROL_FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const CONTROL_SURFACE = 'rounded-full border border-outline bg-surface text-on-surface-variant shadow-interactive transition-colors ease-[var(--ease-spring)] hover:border-primary/40 hover:text-on-surface';
// On a touch screen (pointer-coarse) controls grow towards the 44px a fingertip needs; a mouse keeps the compact sizes.
export const CONTROL_BUTTON = `${CONTROL_SURFACE} ${CONTROL_FOCUS} inline-flex min-h-8 pointer-coarse:min-h-11 pointer-coarse:min-w-11 cursor-pointer items-center justify-center gap-1.5 px-2.5 text-xs leading-4 press-scale disabled:cursor-default disabled:opacity-50`;
export const SELECT_HEIGHT = 'h-8 pointer-coarse:h-11';
export const SEGMENT_GROUP = 'inline-flex gap-0.5 rounded-full border border-outline bg-surface p-0.5 shadow-interactive';
/** Segment buttons set their own mouse height (min-h-7); this raises it on touch. */
export const SEGMENT_BUTTON = `${CONTROL_FOCUS} inline-flex cursor-pointer items-center justify-center gap-1 rounded-full text-xs transition-all duration-300 ease-[var(--ease-spring)] press-scale pointer-coarse:min-h-10`;
export const SEGMENT_ACTIVE = 'bg-on-surface/10 text-on-surface';
export const SEGMENT_INACTIVE = 'text-on-surface-variant hover:bg-on-surface/5 hover:text-on-surface';

const SELECT_ICON = 'pointer-events-none absolute top-1/2 -translate-y-1/2 text-on-surface-variant peer-disabled:opacity-50';

type ControlSelectProps = React.ComponentProps<'select'> & { leadingIcon?: LucideIcon };

/** Keeps the native select's keyboard handling and chooses a chevron that matches the site's other menus. */
export function ControlSelect({ className = '', leadingIcon: LeadingIcon, ...props }: ControlSelectProps) {
  return (
    <span className={`relative inline-flex ${SELECT_HEIGHT} min-w-0 max-w-full items-center`}>
      <select {...props} className={`control-select peer ${CONTROL_SURFACE} ${CONTROL_FOCUS} h-full min-w-0 max-w-full cursor-pointer whitespace-nowrap py-0 pr-7 text-left text-xs leading-4 [field-sizing:content] disabled:cursor-default disabled:opacity-50 ${LeadingIcon ? 'pl-8' : 'pl-2.5'} ${className}`} />
      {LeadingIcon && <LeadingIcon className={`${SELECT_ICON} left-2.5 h-3.5 w-3.5`} aria-hidden="true" />}
      <ChevronDown className={`${SELECT_ICON} right-2.5 h-3 w-3`} aria-hidden="true" />
    </span>
  );
}
