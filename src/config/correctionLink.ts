import { CONTACT_EMAIL } from './siteConfig';

/** Mailto link to CONTACT_EMAIL, if configured. */
export const mailto = (subject: string, body = '', address = CONTACT_EMAIL) =>
  address ? `mailto:${address}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}` : undefined;

const CORRECTION_BODY = [
  'Name:',
  'ORCID iD or a link to the record on Qatalogue:',
  '',
  "What's wrong (affiliation, missing papers, two records that are one person, ...):",
  '',
].join('\r\n');

/** Pre-filled correction email link, if CONTACT_EMAIL is set. */
export const CORRECTION_HREF = mailto('Correction to my record', CORRECTION_BODY);
