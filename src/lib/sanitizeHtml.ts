import DOMPurify from 'dompurify';

/** Sanitizes HTML/MathML fragments in paper titles while stripping unsafe markup. */
export function sanitizePaperTitle(title: string | null | undefined): string {
  return DOMPurify.sanitize(title || '', { USE_PROFILES: { mathMl: true, html: true } });
}
