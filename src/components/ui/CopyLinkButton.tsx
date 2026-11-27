import { useEffect, useRef, useState } from 'react';
import { Check, Link } from 'lucide-react';
import { CONTROL_BUTTON } from './Controls';
import { getLiveSearch } from '../../hooks/urlState';
import { toShortSearch } from '../../../shared/shortLink';

type State = 'idle' | 'done' | 'failed';
const RESET_MS = 2500;

/** The address of the page as it is now, in the short spelling (shared/shortLink.ts). Read at click time so it is never stale. */
const shareUrl = () => `${window.location.origin}${window.location.pathname}${toShortSearch(getLiveSearch() ?? window.location.search)}`;

/** Copies a link to the current view. The clipboard needs a secure page (https or localhost), so failure is shown, not hidden. */
export function CopyLinkButton({ className = '' }: { className?: string }) {
  const [state, setState] = useState<State>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setState('done');
    } catch {
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), RESET_MS);
  };

  const Icon = state === 'done' ? Check : Link;
  const label = state === 'done' ? 'Link copied' : state === 'failed' ? 'Couldn’t copy' : 'Copy link';
  return (
    <>
      <button type="button" onClick={copy} className={`${CONTROL_BUTTON} shrink-0 ${className}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only @md:not-sr-only">{label}</span>
      </button>
      {/* Beside the button, not inside it: a button's contents are not announced as they change. */}
      <span className="sr-only" role="status">{state === 'idle' ? '' : label}</span>
    </>
  );
}

/**
 * Phones: opens the device's own share sheet (messages, mail, apps) where the browser has one, and otherwise copies the
 * link as the results bar's button does. Closing the sheet without sharing is not an error. `state` is for the caller's
 * feedback: it is `done` or `failed` for a moment after a copy.
 */
export function useShareLink() {
  const [state, setState] = useState<State>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const share = async () => {
    const url = shareUrl();
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: document.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setState('done');
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return; // the person closed the share sheet
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), RESET_MS);
  };
  return { share, state };
}
