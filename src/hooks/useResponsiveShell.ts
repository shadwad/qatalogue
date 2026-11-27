import { useEffect, useRef, useState, type UIEvent } from 'react';
import { useDialog } from './useDialog';

// Phones: how far a scroll must go to hide the header (down) or bring it back (up).
const HEADER_HIDE_PX = 24;
const HEADER_REVEAL_PX = 48;

export function useResponsiveShell(resultsScrollRef: React.RefObject<HTMLDivElement | null>) {
  // Phones: the filters as a full-screen drawer.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // From tablet width: the filters docked beside the results, open from 1024px (landscape) and closed in portrait.
  const [isDockOpen, setDockOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const [isTabletUp, setIsTabletUp] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isResultsAtTop, setIsResultsAtTop] = useState(true);

  const compactFiltersRef = useRef<HTMLDivElement>(null);
  const mobileSidebarScrollRef = useRef<HTMLDivElement>(null);
  const lastResultsScrollTopRef = useRef(0);
  const downwardScrollDistanceRef = useRef(0);
  const upwardScrollDistanceRef = useRef(0);

  useDialog(compactFiltersRef, () => setIsSidebarOpen(false), isSidebarOpen);

  useEffect(() => {
    const tablet = window.matchMedia('(min-width: 768px)');
    const landscape = window.matchMedia('(min-width: 1024px)');
    const syncTablet = () => {
      setIsTabletUp(tablet.matches);
      if (tablet.matches) {
        setIsSidebarOpen(false);
        setIsScrolled(false);
        setIsResultsAtTop(true);
      }
    };
    const resetDock = () => setDockOpen(landscape.matches);
    tablet.addEventListener('change', syncTablet);
    landscape.addEventListener('change', resetDock);
    return () => {
      tablet.removeEventListener('change', syncTablet);
      landscape.removeEventListener('change', resetDock);
    };
  }, []);

  useEffect(() => {
    if (isTabletUp) return;
    const scrollContainer = isSidebarOpen ? mobileSidebarScrollRef.current : resultsScrollRef.current;
    if (!scrollContainer) return;

    const currentScrollTop = scrollContainer.scrollTop;
    const isAtTop = currentScrollTop <= 20;
    lastResultsScrollTopRef.current = currentScrollTop;
    downwardScrollDistanceRef.current = 0;
    upwardScrollDistanceRef.current = 0;
    setIsResultsAtTop(isAtTop);
    setIsScrolled(!isAtTop);
  }, [isSidebarOpen, isTabletUp, resultsScrollRef]);

  // Body scroll locking while the phone drawer is open.
  useEffect(() => {
    document.body.style.overflow = isSidebarOpen && !isTabletUp ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isSidebarOpen, isTabletUp]);

  const handleResultsScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const currentScrollTop = element.scrollTop;
    const previousScrollTop = lastResultsScrollTopRef.current;
    const isAtTop = currentScrollTop <= 20;

    setIsResultsAtTop(isTabletUp || isAtTop);

    if (isTabletUp || isAtTop) {
      setIsScrolled(false);
      lastResultsScrollTopRef.current = currentScrollTop;
      downwardScrollDistanceRef.current = 0;
      upwardScrollDistanceRef.current = 0;
      return;
    }

    // Ignore upward bounce at the very bottom where hiding the header grows the scrollable viewport.
    const isAtEnd = element.scrollHeight - element.clientHeight - currentScrollTop <= 1;
    if (currentScrollTop < previousScrollTop && isAtEnd) {
      downwardScrollDistanceRef.current = 0;
    } else if (currentScrollTop < previousScrollTop) {
      downwardScrollDistanceRef.current = 0;
      upwardScrollDistanceRef.current += previousScrollTop - currentScrollTop;
      if (upwardScrollDistanceRef.current >= HEADER_REVEAL_PX) setIsScrolled(false);
    } else if (currentScrollTop > previousScrollTop) {
      upwardScrollDistanceRef.current = 0;
      downwardScrollDistanceRef.current += currentScrollTop - previousScrollTop;
      if (downwardScrollDistanceRef.current >= HEADER_HIDE_PX) setIsScrolled(true);
    }

    lastResultsScrollTopRef.current = currentScrollTop;
  };

  return {
    isSidebarOpen,
    setIsSidebarOpen,
    isDockOpen,
    setDockOpen,
    isTabletUp,
    isScrolled,
    setIsScrolled,
    isResultsAtTop,
    compactFiltersRef,
    mobileSidebarScrollRef,
    handleResultsScroll,
  };
}
