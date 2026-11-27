import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Open dialogs, newest last. A pop-up can open another (the methodology's License, say): only the top one takes keys. */
const openDialogs: HTMLElement[] = [];

/**
 * Shared modal behaviour for every pop-out:
 * - Esc closes it,
 * - Tab / Shift+Tab stay inside it,
 * - focus moves into it on open and returns to the previously focused element on close.
 * With one dialog over another, only the top one answers Esc and Tab.
 */
export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled = true) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null);

    // Focus the dialog itself (not its first button) so no focus ring flashes on open;
    // the first Tab then moves into its controls.
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
    node.style.outline = 'none';
    node.focus({ preventScroll: true });
    openDialogs.push(node);

    const onKeyDown = (e: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== node) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node || !node.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || active === node || !node.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = openDialogs.indexOf(node);
      if (index !== -1) openDialogs.splice(index, 1);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [ref, enabled]);
}
