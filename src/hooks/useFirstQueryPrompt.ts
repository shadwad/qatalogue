import { useState, useEffect, useCallback, useRef } from 'react';
import type { ViewMode } from './useExplorerData';
import { hasUrlState } from './urlState';

// Captured at load, before the explorer starts rewriting the URL.
const openedWithQuery = typeof window !== 'undefined' && hasUrlState();

// Tablets and up; on a phone the filters are a button away and a full-screen prompt would only be in the way.
const TABLET_UP = '(min-width: 768px)';
const storageKey = (view: ViewMode) => `qatalogue:queried:${view}`;

// Fallback memory set when sessionStorage is unavailable (e.g. strict private browsing / StrictMode remounts).
const queriedMemory = new Set<ViewMode>();

function hasQueried(view: ViewMode): boolean {
  if (queriedMemory.has(view)) return true;
  try {
    return sessionStorage.getItem(storageKey(view)) === '1';
  } catch {
    return false;
  }
}

function markQueried(view: ViewMode) {
  queriedMemory.add(view);
  try {
    sessionStorage.setItem(storageKey(view), '1');
  } catch {
    /* sessionStorage blocked: queriedMemory keeps the flag for this page lifetime */
  }
}

/**
 * Tablet and desktop: opens a query prompt the first time each view
 * (institution / researcher) is reached in a browser session.
 * The prompt has its own focus switch, so every view it was open for counts as queried when it closes.
 */
export function useFirstQueryPrompt(viewMode: ViewMode) {
  const [isOpen, setIsOpen] = useState(false);
  const shownFor = useRef(new Set<ViewMode>());

  const firstRunRef = useRef(true);
  useEffect(() => {
    // A shared or reloaded link already carries a query for the view it opens on: don't ask again.
    if (firstRunRef.current) {
      firstRunRef.current = false;
      if (openedWithQuery) { markQueried(viewMode); return; }
    }
    if (!window.matchMedia(TABLET_UP).matches) return;
    if (!hasQueried(viewMode)) {
      shownFor.current.add(viewMode);
      setIsOpen(true);
    }
  }, [viewMode]);

  const confirm = useCallback(() => {
    shownFor.current.add(viewMode);
    shownFor.current.forEach(markQueried);
    shownFor.current.clear();
    setIsOpen(false);
  }, [viewMode]);

  return { isOpen, confirm };
}
