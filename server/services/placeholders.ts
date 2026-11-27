import { getDb, onDatabaseChange } from './db';

/**
 * Placeholder authors ("Anonymous", …), flagged by the pipeline (authors.is_placeholder).
 * They still count towards institution scores, but are not researchers: route queries that read the
 * fact tables directly use these helpers to keep them out of researcher lists and faculty counts.
 * (The precomputed performance_summary tables already exclude them.)
 */
let cachedIds: string[] | null = null;
onDatabaseChange(() => { cachedIds = null; });

function placeholderIds(): string[] {
  if (cachedIds === null) {
    try {
      cachedIds = (getDb().prepare('SELECT author_id FROM authors WHERE is_placeholder = 1').all() as { author_id: string }[])
        .map(r => r.author_id);
    } catch {
      cachedIds = []; // older serve.db without the column
    }
  }
  return cachedIds;
}

const sqlList = () => placeholderIds().map(id => `'${id.replace(/'/g, "''")}'`).join(',');

/** `AND <column> NOT IN (…placeholders)` — or nothing when there are none. */
export function excludePlaceholders(column: string): string {
  return placeholderIds().length ? ` AND ${column} NOT IN (${sqlList()})` : '';
}

/** COUNT(DISTINCT <column>) that ignores placeholder authors (for faculty counts). */
export function namedAuthorCount(column: string): string {
  return placeholderIds().length
    ? `COUNT(DISTINCT CASE WHEN ${column} IN (${sqlList()}) THEN NULL ELSE ${column} END)`
    : `COUNT(DISTINCT ${column})`;
}
