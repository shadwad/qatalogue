import React from 'react';
import { EMPTY_HEADLINE } from '../../lib/messages';

interface EmptyStateProps {
  /** The plain line: what is empty and, where there is one, what to do about it. */
  children: React.ReactNode;
  /** `panel` for a whole panel, `inline` inside a chart or a card. */
  size?: 'panel' | 'inline';
}

/** Nothing to show: the "Vacuum state" headline over a plain explanation (messages.ts), the counterpart of LoadFailure. */
export const EmptyState: React.FC<EmptyStateProps> = ({ children, size = 'panel' }) => (
  <div role="status" className={`flex flex-col items-center text-center ${size === 'panel' ? 'gap-3' : 'gap-1.5 px-3 py-5'}`}>
    <div className={`font-mono uppercase tracking-wider text-on-surface-variant ${size === 'panel' ? 'text-sm' : 'text-xs'}`}>{EMPTY_HEADLINE}</div>
    <div className={`m-0 max-w-prose text-on-surface-variant ${size === 'panel' ? 'text-sm' : 'text-xs'}`}>{children}</div>
  </div>
);
