import React from 'react';
import { FAILURE_HEADLINE, LOADING } from '../../lib/messages';
import { CONTROL_FOCUS } from './Controls';

interface LoadFailureProps {
  /** The start of "[what] could not load", such as "The list" or "Papers". */
  what: string;
  /** Follows the loading word it replaces: `panel` for a whole panel, `inline` for part of one, `nested` inside an expanded entry. */
  size?: 'panel' | 'inline' | 'nested';
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  hint?: string;
}

const TITLE = 'font-mono uppercase tracking-wider text-on-surface-variant';
const BUTTON = `${CONTROL_FOCUS} cursor-pointer rounded-full border border-outline bg-surface text-on-surface shadow-interactive transition-colors hover:bg-on-surface/5 press-scale disabled:cursor-default disabled:opacity-60`;

/**
 * The site's one failure message: says what could not load and offers a way forward, with no codes or server text, which
 * stay in the browser's network log. It takes the place of the loading word, at the same size. Where there is room (a
 * panel, a chart) the plain line sits under the "Decoherence" headline (messages.ts); nested in an entry it stands alone.
 */
export const LoadFailure: React.FC<LoadFailureProps> = ({
  what, size = 'panel', onRetry, retrying = false, retryLabel = 'Try again', hint = 'Check your connection and try again.',
}) => {
  const retry = onRetry && (
    <button type="button" onClick={onRetry} disabled={retrying} className={`${BUTTON} ${size === 'panel' ? 'px-4 py-1.5 text-xs' : size === 'inline' ? 'px-3 py-1 text-xs' : 'px-2.5 py-0.5 text-[11px]'}`}>
      {retrying ? LOADING.retry : retryLabel}
    </button>
  );
  if (size === 'nested') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`${TITLE} text-[11px]`}>{what} could not load</span>
        {retry}
      </div>
    );
  }
  if (size === 'inline') {
    return (
      // Left-aligned, where the loading word was (a chart centers it in its own wrapper).
      <div role="alert" className="flex flex-col items-start gap-1.5 text-left">
        <span className={`${TITLE} text-xs`}>{FAILURE_HEADLINE}</span>
        <span className="text-xs text-on-surface-variant">{what} could not load.</span>
        {retry && <div className="mt-1">{retry}</div>}
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-col items-center gap-3 text-center">
      <div className={`${TITLE} text-sm`}>{FAILURE_HEADLINE}</div>
      <p className="m-0 max-w-prose text-sm text-on-surface-variant">{what} could not load. {hint}</p>
      {retry && <div className="mt-1">{retry}</div>}
    </div>
  );
};

/** For a sidebar section. The main panel carries the explanation and the way to try again. */
export const ListFailure: React.FC = () => (
  <div className={`px-4 py-1 text-xs ${TITLE}`}>Could not load</div>
);
