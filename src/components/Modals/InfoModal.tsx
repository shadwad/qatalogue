import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { CONTROL_FOCUS } from '../ui/Controls';
import { Tooltip } from '../ui/Tooltip';
import { useAnimatedClose } from '../../hooks/useAnimatedClose';
import { useDialog } from '../../hooks/useDialog';

export const INFO_SECTION_TITLE = 'm-0 mb-2 font-display text-xs font-bold uppercase tracking-wider text-primary';
export const INFO_TEXT = 'm-0 text-sm leading-relaxed text-on-surface-variant';
export const INFO_LINK = 'text-on-surface-variant hover:text-primary transition-colors underline underline-offset-2 decoration-outline';

export const ExternalLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className={INFO_LINK}>{children}</a>
);

/** Portal-rendered modal shell with fixed header and scrolling body. */
export const InfoModal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const { close, overlayClass, cardClass, onAnimationEnd } = useAnimatedClose(onClose);
  useDialog(cardRef, close);
  const titleId = `info-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return createPortal(
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 glass-overlay ${overlayClass}`} onClick={close}>
      <div ref={cardRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e => e.stopPropagation()} onAnimationEnd={onAnimationEnd}
        className={`flex max-h-[85dvh] w-full max-w-[640px] flex-col overflow-hidden border border-outline bg-surface shadow-popover ${cardClass}`}>
        <div className="flex shrink-0 items-center justify-between border-b border-outline px-6 py-5 md:px-12 md:py-6">
          <h2 id={titleId} className="m-0 font-display text-xl font-extrabold uppercase tracking-tight text-on-surface md:text-2xl">{title}</h2>
          <Tooltip contents content="Close">
            <button type="button" onClick={close} aria-label="Close"
              className={`${CONTROL_FOCUS} flex cursor-pointer items-center justify-center rounded-full border border-transparent bg-transparent p-2 text-on-surface shadow-interactive transition-colors hover:bg-on-surface/5 press-scale`}>
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 md:px-12">
          <div className="flex flex-col gap-8">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
