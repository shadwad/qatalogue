import React from 'react';
import { RotateCcw } from 'lucide-react';
import { CONTROL_FOCUS } from '../ui/Controls';
import { Tooltip } from '../ui/Tooltip';

interface ResetButtonProps {
  /** What it does, for the tooltip and screen readers ("Reset year range"). */
  label: string;
  /** Longer screen-reader description, when the label alone is not enough. */
  description?: string;
  /** "large" is the reset-all button in the sidebar header; "small" is a section's own. */
  size?: 'small' | 'large';
  className?: string;
  onReset: () => void;
}

/** The one reset control. Reset-all is a round button, like the app's other actions; a section's is a plain symbol, like its ? hint. */
export const ResetButton: React.FC<ResetButtonProps> = ({ label, description, size = 'small', className = '', onReset }) => (
  <Tooltip contents content={label} align={size === 'small' ? 'end' : 'center'}>
    <button
      type="button"
      onClick={onReset}
      aria-label={description ?? label}
      className={`${CONTROL_FOCUS} flex items-center justify-center shrink-0 cursor-pointer press-scale ${
        size === 'large'
          ? 'p-1.5 rounded-full bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface shadow-interactive'
          : '-my-1 p-1 rounded-sm bg-transparent border-none text-on-surface-variant hover:text-primary transition-colors'
      } ${className}`}
    >
      <RotateCcw className={size === 'large' ? 'w-3.5 h-3.5' : 'w-3 h-3'} aria-hidden="true" />
    </button>
  </Tooltip>
);

/** A section header's right-hand symbols: the count symbol, then the reset in a fixed column so it appearing moves nothing. */
export const SectionSymbols: React.FC<{ symbol?: React.ReactNode; reset?: React.ReactNode }> = ({ symbol, reset }) => (
  <div className="flex items-center gap-5 md:gap-4">
    {symbol}
    <div className="w-4 md:w-3 flex items-center justify-center">{reset}</div>
  </div>
);

/** A section's title with its ? hint beside it, padded a little further than ordinary text. */
export const SectionTitle: React.FC<{ title: React.ReactNode; hints?: React.ReactNode }> = ({ title, hints }) => (
  <div className="relative flex-1 flex items-center min-w-0">
    {title}
    {hints && <div className="flex items-center gap-2 ml-3">{hints}</div>}
  </div>
);
