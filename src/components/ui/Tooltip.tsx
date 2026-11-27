import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The one tooltip card, shared with HelpHint.
 *
 * How tooltip text is written:
 * - Sentence case. Only a complete sentence ends in a full stop; a phrase never does.
 * - Actions start with a verb ("Reset year range"); facts are noun phrases ("Papers per topic, subject to other filters").
 * - A ? hint that lists terms uses HintItem.
 */
export const tooltipCardClass = 'px-3 py-2.5 bg-surface border border-outline rounded-xl text-on-surface-variant text-xs font-sans font-medium leading-relaxed normal-case whitespace-normal text-left tracking-normal shadow-popover';

const OPEN_DELAY_MS = 150;
// Touch has no hover: holding a finger on the trigger this long shows the tooltip, which stays a moment after lifting.
const LONG_PRESS_MS = 500;
const LONG_PRESS_LINGER_MS = 1500;
const LONG_PRESS_SLOP_PX = 10;
const GAP = 6;
const EDGE = 8;

// Only one tooltip at a time, so a count inside a row with its own tooltip replaces the row's.
let closeOpenTooltip: (() => void) | null = null;

interface TooltipProps {
  content?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Adds no box of its own, so the child stays a direct flex or grid item. Needs a single element child. */
  contents?: boolean;
  /** 'end' lines the card's right edge up with the trigger's, so it opens leftward like a ? hint. */
  align?: 'center' | 'end';
}

/**
 * Opens on mouse hover, keyboard focus and a long press on a touch screen. Drawn on the page body, so scrolling lists and
 * dialogs can't clip it.
 */
export const Tooltip: React.FC<TooltipProps> = ({ content, children, className = '', contents, align = 'center' }) => {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  // The press in progress (where it started), and whether it opened the tooltip, so the tap it ends in is not a click.
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const longPressedRef = useRef(false);

  const hideRef = useRef(() => {
    window.clearTimeout(timerRef.current);
    setOpen(false);
    setPlace(null);
    setVisible(false);
  });

  const hide = () => {
    if (closeOpenTooltip === hideRef.current) closeOpenTooltip = null;
    hideRef.current();
  };

  const show = (delay = OPEN_DELAY_MS, onOpen?: () => void) => {
    closeOpenTooltip?.();
    closeOpenTooltip = hideRef.current;
    timerRef.current = window.setTimeout(() => { onOpen?.(); setOpen(true); }, delay);
  };

  const startPress = (e: React.PointerEvent) => {
    hide();
    longPressedRef.current = false;
    if (e.pointerType !== 'touch') return;
    pressRef.current = { x: e.clientX, y: e.clientY };
    // Remember that the press opened the tooltip, once it has.
    show(LONG_PRESS_MS, () => { if (pressRef.current) longPressedRef.current = true; });
  };

  const movePress = (e: React.PointerEvent) => {
    const start = pressRef.current;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP_PX) cancelPress();
  };

  // After a long press the tooltip lingers, then closes; the flag that swallows the ending tap is cleared with it.
  const linger = () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { longPressedRef.current = false; hide(); }, LONG_PRESS_LINGER_MS);
  };

  // The finger moved (a scroll) or the browser took the touch over.
  const cancelPress = () => {
    pressRef.current = null;
    if (longPressedRef.current) linger();
    else hide();
  };

  const endPress = () => {
    if (!pressRef.current) return;
    pressRef.current = null;
    if (longPressedRef.current) linger();
    else hide();
  };

  useEffect(() => () => {
    if (closeOpenTooltip === hideRef.current) closeOpenTooltip = null;
    window.clearTimeout(timerRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = contents ? wrapperRef.current?.firstElementChild : wrapperRef.current;
    const card = cardRef.current;
    if (!anchor || !card) return;
    const a = anchor.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const above = a.top - GAP - c.height;
    const below = a.bottom + GAP;
    // Always below the trigger, unless that would run off the screen and there is room above.
    const top = below + c.height <= window.innerHeight - EDGE || above < EDGE ? below : above;
    const preferred = align === 'end' ? a.right - c.width : a.left + a.width / 2 - c.width / 2;
    const left = Math.min(Math.max(EDGE, preferred), window.innerWidth - EDGE - c.width);
    setPlace({ top: Math.max(EDGE, top), left });
    const frame = requestAnimationFrame(() => setVisible(true));

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        hide();
      }
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (content === undefined || content === null || content === '') return <>{children}</>;

  return (
    <span
      ref={wrapperRef}
      className={contents ? 'contents' : `inline-block max-w-full ${className}`}
      onPointerEnter={e => { if (e.pointerType === 'mouse') show(); }}
      // A finger "leaves" as it lifts; a long press closes on its own timer instead.
      onPointerLeave={e => { if (e.pointerType !== 'touch') hide(); }}
      onPointerDown={startPress}
      onPointerMove={movePress}
      onPointerUp={endPress}
      onPointerCancel={cancelPress}
      // The tap that ends a long press only showed the label: it must not also press the button.
      onClickCapture={e => {
        if (!longPressedRef.current) return;
        longPressedRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      onContextMenu={e => { if (pressRef.current || longPressedRef.current) e.preventDefault(); }}
      onFocus={e => { if (e.target.matches(':focus-visible')) show(); }}
      onBlur={hide}
    >
      {children}
      {open && createPortal(
        <div
          ref={cardRef}
          aria-hidden="true"
          style={{ top: place?.top ?? 0, left: place?.left ?? 0, opacity: visible ? 1 : 0 }}
          className={`fixed z-[100] w-max max-w-xs pointer-events-none transition-opacity duration-200 ${tooltipCardClass}`}
        >
          {content}
        </div>,
        document.body,
      )}
    </span>
  );
};
