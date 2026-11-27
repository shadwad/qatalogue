import React, { lazy, Suspense, useState } from 'react';
import { CONTROL_FOCUS } from '../ui/Controls';
import { mailto } from '../../config/correctionLink';
import { SITE_CONFIG, type SiteConfig } from '../../config/siteConfig';
import { SITE_MODALS, type SiteModalEntry } from '../../config/siteExtras';

const LicenseModal = lazy(() => import('../Modals/LicenseModal'));

const FOOTER_TEXT = 'font-display text-xs font-bold uppercase tracking-wider text-on-surface-variant';
const FOOTER_LINK = `rounded-sm text-primary hover:underline ${CONTROL_FOCUS}`;
const FOOTER_BUTTON = `cursor-pointer border-none bg-transparent p-0 font-[inherit] uppercase tracking-[inherit] ${FOOTER_LINK}`;

/** The build time in Anywhere on Earth (UTC−12), "YYYY-MM-DD HH:MM". */
export const aoeTimestamp = (iso: string) => {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? '' : new Date(ms - 12 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 16);
};

/** When the served data was built, or that it is still loading. */
export function SyncStatus({ generatedAt }: { generatedAt?: string | null }) {
  const timestamp = generatedAt ? aoeTimestamp(generatedAt) : '';
  return (
    <div className={`${FOOTER_TEXT} flex items-center justify-center text-center`}>
      <span className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
      {timestamp ? (
        <>
          Last Sync:
          <span className="relative -top-[0.17px] mx-1.5 font-mono text-[11px]">{timestamp}</span>
          AOE
        </>
      ) : (
        'Awaiting Sync'
      )}
    </div>
  );
}

/** Footer credit, links, and modal triggers. */
export function SiteCredit({
  config = SITE_CONFIG,
  modals = SITE_MODALS,
}: {
  config?: SiteConfig;
  modals?: readonly SiteModalEntry[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);
  const button = (name: string, label: string) => (
    <button type="button" onClick={() => setOpen(name)} aria-haspopup="dialog" className={FOOTER_BUTTON}>{label}</button>
  );
  const beforeLicense = modals.filter(m => m.slot === 'before-license');
  const afterLicense = modals.filter(m => m.slot === 'after-license');
  const hasContactModal = modals.some(m => m.id === 'contact');
  const activeModal = open && open !== 'license' ? modals.find(m => m.id === open) : undefined;

  const items: React.ReactNode[] = [
    config.author && (
      <span key="credit">
        © {config.copyrightYear}{config.copyrightYear ? ' ' : ''}
        {config.author.url
          ? <a href={config.author.url} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK}>{config.author.name}</a>
          : config.author.name}
      </span>
    ),
    ...beforeLicense.map(m => <span key={m.id}>{button(m.id, m.label)}</span>),
    config.contactEmail && !hasContactModal && (
      <a key="contact" href={mailto('Qatalogue', '', config.contactEmail)} className={FOOTER_LINK}>Contact</a>
    ),
    config.sourceUrl && <a key="github" href={config.sourceUrl} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK}>GitHub</a>,
    <span key="license">{button('license', 'License')}</span>,
    ...afterLicense.map(m => <span key={m.id}>{button(m.id, m.label)}</span>),
  ].filter(Boolean);

  return (
    <div className={`${FOOTER_TEXT} flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center`}>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          {item}
        </React.Fragment>
      ))}
      <Suspense fallback={null}>
        {open === 'license' && <LicenseModal onClose={close} />}
        {activeModal && <activeModal.Component onClose={close} />}
      </Suspense>
    </div>
  );
}
