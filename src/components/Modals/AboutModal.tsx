import React, { lazy, Suspense, useState } from 'react';
import { ChevronRight, ExternalLink as ExternalIcon, Mail, Scale, type LucideIcon } from 'lucide-react';
import { CONTROL_FOCUS } from '../ui/Controls';
import { Github } from '../../lib/icons';
import { InfoModal } from './InfoModal';
import { aoeTimestamp } from '../Explorer/SiteFooter';
import { mailto } from '../../config/correctionLink';
import { PROJECT } from '../../config/projectCredit';
import { SITE_CONFIG, type SiteConfig } from '../../config/siteConfig';
import { SITE_MODALS, type SiteModalEntry } from '../../config/siteExtras';

const LicenseModal = lazy(() => import('./LicenseModal'));

const TERM = 'font-display text-xs font-bold uppercase tracking-wider text-on-surface-variant';
const ROW = `${CONTROL_FOCUS} flex min-h-12 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 text-left text-sm font-medium text-on-surface no-underline transition-colors hover:bg-on-surface/5`;

const RowContent: React.FC<{ icon: LucideIcon; label: string; external?: boolean }> = ({ icon: Icon, label, external }) => (
  <>
    <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
    <span className="flex-1">{label}</span>
    {external
      ? <><ExternalIcon className="h-3.5 w-3.5 text-on-surface-variant" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></>
      : <ChevronRight className="h-4 w-4 text-on-surface-variant" aria-hidden="true" />}
  </>
);

/** Mobile About dialog. */
export const AboutModal: React.FC<{
  generatedAt?: string | null;
  onClose: () => void;
  config?: SiteConfig;
  modals?: readonly SiteModalEntry[];
}> = ({ generatedAt, onClose, config = SITE_CONFIG, modals = SITE_MODALS }) => {
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);
  const beforeLicense = modals.filter(m => m.slot === 'before-license');
  const afterLicense = modals.filter(m => m.slot === 'after-license');
  const hasContactModal = modals.some(m => m.id === 'contact');
  const activeModal = open && open !== 'license' ? modals.find(m => m.id === open) : undefined;
  const syncText = generatedAt ? aoeTimestamp(generatedAt) : '';

  return (
    <InfoModal title="About" onClose={onClose}>
      <p className="m-0 text-base leading-relaxed text-on-surface">
        An open bibliometric explorer for quantum information science and technology.
      </p>

      <dl className="m-0 grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-3">
        <dt className={TERM}>Created by</dt>
        <dd className="m-0 text-sm text-on-surface">
          <a href={PROJECT.creatorUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline underline-offset-2">{PROJECT.creator}</a>
        </dd>
        {config.author && config.author.name !== PROJECT.creator && (
          <>
            <dt className={TERM}>Published by</dt>
            <dd className="m-0 text-sm text-on-surface">
              {config.author.url
                ? <a href={config.author.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline underline-offset-2">{config.author.name}</a>
                : config.author.name}
            </dd>
          </>
        )}
        <dt className={TERM}>Data synced</dt>
        <dd className="m-0 font-mono text-xs text-on-surface">{syncText ? `${syncText} AOE` : 'Awaiting sync'}</dd>
        <dt className={TERM}>Version</dt>
        <dd className="m-0 font-mono text-xs text-on-surface">{__APP_VERSION__}</dd>
      </dl>

      <nav aria-label="Site information">
        <ul className="m-0 list-none divide-y divide-outline overflow-hidden rounded-2xl border border-outline p-0">
          {beforeLicense.map(m => (
            <li key={m.id}>
              <button type="button" onClick={() => setOpen(m.id)} aria-haspopup="dialog" className={ROW}>
                <RowContent icon={m.icon} label={m.label} />
              </button>
            </li>
          ))}
          {config.contactEmail && !hasContactModal && (
            <li>
              <a href={mailto('Qatalogue', '', config.contactEmail)} className={ROW}>
                <RowContent icon={Mail} label="Contact" />
              </a>
            </li>
          )}
          {config.sourceUrl && (
            <li>
              <a href={config.sourceUrl} target="_blank" rel="noopener noreferrer" className={ROW}>
                <RowContent icon={Github} label="Source code on GitHub" external />
              </a>
            </li>
          )}
          <li><button type="button" onClick={() => setOpen('license')} aria-haspopup="dialog" className={ROW}><RowContent icon={Scale} label="License" /></button></li>
          {afterLicense.map(m => (
            <li key={m.id}>
              <button type="button" onClick={() => setOpen(m.id)} aria-haspopup="dialog" className={ROW}>
                <RowContent icon={m.icon} label={m.label} />
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {config.author && <p className="m-0 text-xs text-on-surface-variant">© {config.copyrightYear ? `${config.copyrightYear} ` : ''}{config.author.name}</p>}

      <Suspense fallback={null}>
        {open === 'license' && <LicenseModal onClose={close} />}
        {activeModal && <activeModal.Component onClose={close} />}
      </Suspense>
    </InfoModal>
  );
};

export default AboutModal;
