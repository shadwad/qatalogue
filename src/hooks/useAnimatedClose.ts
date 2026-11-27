import React, { useState, useEffect, useRef, useCallback } from 'react';

// Must match .animate-modal-out duration in index.css
const EXIT_MS = 180;

/**
 * Plays the modal pop-out animation before actually unmounting.
 * Spread `cardProps` onto the modal card, `overlayClass`/`cardClass` onto their classNames.
 */
export function useAnimatedClose(onClose: () => void) {
  const [isClosing, setIsClosing] = useState(false);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onClose();
  }, [onClose]);

  const close = useCallback(() => setIsClosing(true), []);

  // Fallback in case animationend never fires (e.g. tab hidden)
  useEffect(() => {
    if (!isClosing) return;
    const t = window.setTimeout(finish, EXIT_MS + 60);
    return () => window.clearTimeout(t);
  }, [isClosing, finish]);

  const onAnimationEnd = (e: React.AnimationEvent<HTMLElement>) => {
    if (isClosing && e.target === e.currentTarget) finish();
  };

  return {
    isClosing,
    close,
    overlayClass: isClosing ? 'animate-overlay-out pointer-events-none' : 'animate-overlay-in',
    cardClass: isClosing ? 'animate-modal-out' : 'animate-modal-in',
    onAnimationEnd,
  };
}
