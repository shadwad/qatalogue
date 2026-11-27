/** Optional site configuration loaded from site.config.json at build time. */
import { PROJECT } from './projectCredit';

export interface RawSiteConfig {
  author?: { name?: string; url?: string };
  copyrightYear?: number;
  contactEmail?: string;
  repositoryUrl?: string;
}

export interface SiteConfig {
  author?: { name: string; url?: string };
  copyrightYear?: number;
  contactEmail?: string;
  repositoryUrl?: string;
  sourceUrl?: string;
  issuesUrl?: string;
}

declare const __SITE_CONFIG__: Record<string, unknown> | undefined;

/** Raw __SITE_CONFIG__ object injected at build time. */
export const RAW_SITE_CONFIG: Record<string, unknown> =
  typeof __SITE_CONFIG__ !== 'undefined' && __SITE_CONFIG__ && typeof __SITE_CONFIG__ === 'object'
    ? __SITE_CONFIG__
    : {};

export const parseText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Accept http(s) URLs only. */
export const parseLink = (value: unknown): string | undefined => {
  const address = parseText(value);
  return address && /^https?:\/\/\S+$/i.test(address) ? address : undefined;
};

export const parseEmail = (value: unknown): string | undefined => {
  const address = parseText(value);
  return address && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : undefined;
};

export function parseSiteConfig(rawInput: unknown): SiteConfig {
  const raw = rawInput && typeof rawInput === 'object' ? (rawInput as RawSiteConfig) : {};
  const authorName = parseText(raw.author?.name);
  const author = authorName ? { name: authorName, url: parseLink(raw.author?.url) } : undefined;
  const copyrightYear =
    typeof raw.copyrightYear === 'number' && Number.isInteger(raw.copyrightYear) ? raw.copyrightYear : undefined;
  const contactEmail = parseEmail(raw.contactEmail);
  const repositoryUrl = parseLink(raw.repositoryUrl);
  const sourceUrl = repositoryUrl ?? (PROJECT.repositoryUrl || undefined);
  const issuesUrl = repositoryUrl ? `${repositoryUrl.replace(/\/+$/, '')}/issues/new` : undefined;
  return { author, copyrightYear, contactEmail, repositoryUrl, sourceUrl, issuesUrl };
}

export const SITE_CONFIG = parseSiteConfig(RAW_SITE_CONFIG);

export const AUTHOR = SITE_CONFIG.author;
export const CONTACT_EMAIL = SITE_CONFIG.contactEmail;
export const REPOSITORY_URL = SITE_CONFIG.repositoryUrl;
/** Repository link shown in the footer and About dialog. */
export const SOURCE_URL = SITE_CONFIG.sourceUrl;
/** Issue tracker URL derived from `repositoryUrl`. */
export const ISSUES_URL = SITE_CONFIG.issuesUrl;
