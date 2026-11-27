import { useState } from 'react';
import { Info, X } from 'lucide-react';
import type { ViewMode } from '../../hooks/useExplorerData';
import { LIST_CAUTION } from '../../lib/messages';
import { CONTROL_FOCUS } from '../ui/Controls';
import { CORRECTION_HREF } from '../../config/correctionLink';

interface ListCautionProps {
  viewMode: ViewMode;
  onOpenMethodology: () => void;
}

const storageKey = (view: ViewMode) => `qatalogue:caution-dismissed:${view}`;

function wasDismissed(view: ViewMode): boolean {
  try {
    return sessionStorage.getItem(storageKey(view)) === '1';
  } catch {
    return false;
  }
}

/**
 * A one-line note under the list's column headings. Dismissed per list (institutions and researchers have different
 * wording) and remembered for this browser session only, so it returns on the next visit; if storage is unavailable it also returns on the next load.
 */
export function ListCaution({ viewMode, onOpenMethodology }: ListCautionProps) {
  // Which lists were dismissed, read once per list so switching views doesn't re-read storage on every render.
  const [dismissed, setDismissed] = useState<Partial<Record<ViewMode, boolean>>>({});
  const isDismissed = dismissed[viewMode] ?? wasDismissed(viewMode);
  if (isDismissed) return null;

  const dismiss = () => {
    setDismissed(current => ({ ...current, [viewMode]: true }));
    try {
      sessionStorage.setItem(storageKey(viewMode), '1');
    } catch {
      /* storage unavailable (private mode etc.) — the note reappears next load */
    }
  };

  return (
    <p role="note" className="flex shrink-0 items-start gap-2 border-b border-outline-variant bg-surface px-4 py-2 text-xs leading-snug text-on-surface-variant @2xl/results:px-6 @5xl/results:px-10">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {LIST_CAUTION[viewMode]}{' '}
        <button type="button" onClick={onOpenMethodology} className={`${CONTROL_FOCUS} cursor-pointer font-semibold underline underline-offset-2 hover:text-primary`}>
          Methodology
        </button>
        {CORRECTION_HREF && (
          <>
            {' · '}
            <a href={CORRECTION_HREF} className={`${CONTROL_FOCUS} font-semibold underline underline-offset-2 hover:text-primary`}>
              Email a correction
            </a>
          </>
        )}
      </span>
      <button type="button" onClick={dismiss} aria-label="Dismiss this note"
        className={`${CONTROL_FOCUS} -my-1 -mr-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full hover:text-primary`}>
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </p>
  );
}
