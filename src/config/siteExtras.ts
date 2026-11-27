import type { ComponentType, LazyExoticComponent } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface SiteModalEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  slot: 'before-license' | 'after-license';
  Component: ComponentType<{ onClose: () => void }> | LazyExoticComponent<ComponentType<{ onClose: () => void }>>;
}

/** Optional extra footer and About dialogs. */
export const SITE_MODALS: readonly SiteModalEntry[] = [];
