/**
 * Paper search: word matching (SQLite FTS5 / BM25) and meaning matching (bge-small vectors) combined.
 *
 * Which papers count as a match (tuned for precision on QIST queries). With `gap` = best vector score minus
 * this paper's vector score, a paper matches when:
 *   - it contains the query as a phrase (title, abstract or keywords)       and gap <= 0.22, or
 *   - its title or keywords contain every query word                        and gap <= 0.19, or
 *   - its text contains every query word somewhere                          and gap <= 0.12, or
 *   - its meaning is very close to the best match (gap <= 0.05), provided the best match is itself
 *     a reasonable meaning match (score >= 0.70), or
 *   - its title contains the whole query (a pasted title; pinned to the top).
 * The gap limits stop generic words ("quantum", "learning") from pulling in unrelated papers.
 * Matches are ordered by reciprocal rank fusion of the BM25 and vector rankings.
 */
import fs from 'fs';
import path from 'path';
import { LRUCache } from 'lru-cache';
import { databaseGeneration, getDb, hasTable, onDatabaseChange } from './db';
import { publicDirectory, UnavailableError } from './utils';
import { embedQuery, embeddingConfig, embeddingId } from './embedder';

const RULES = { phraseGap: 0.22, titleKeywordsGap: 0.19, allWordsGap: 0.12, meaningGap: 0.05, meaningFloor: 0.70, rrfK: 60 };
const STOP = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'in', 'into',
  'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'using', 'via', 'what', 'when', 'which', 'with']);
const MAX_QUERY_TERMS = 12;

const acronyms: Record<string, string> = (() => {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(publicDirectory, 'config', 'search_acronyms.json'), 'utf8'));
    return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k.toLowerCase(), String(v)]));
  } catch { return {}; }
})();

const EMPTY_STRINGS: readonly string[] = [];
const EMPTY_ROW_SET: ReadonlySet<number> = new Set<number>();

interface PaperMeta { paper_id: string; title: string; year: number | null; venue_id: string | null; venue_name: string | null; doi: string | null; topics: readonly string[]; platforms: readonly string[] }
/** One row of paper_index joined to its paper; topics and platforms are joined with \x1f. */
type IndexRow = Omit<PaperMeta, 'topics' | 'platforms'> & {
  row: number; vec: Buffer | null; vec_scale: number; topics: string | null; platforms: string | null;
};
interface Index { n: number; dim: number; vecs: Int8Array; scales: Float32Array; hasVec: Uint8Array; papers: PaperMeta[] }

let index: Index | null = null;

function loadIndex(): Index {
  if (index) return index;
  const db = getDb();
  if (!hasTable('paper_index') || !hasTable('paper_index_meta')) {
    throw new UnavailableError('Paper search index not built yet (run: make all).');
  }
  const meta = Object.fromEntries((db.prepare('SELECT key, value FROM paper_index_meta').all() as { key: string; value: string }[]).map(r => [r.key, r.value]));
  if (meta.model !== embeddingId || Number(meta.dim) !== embeddingConfig.dim
      || (meta.dtype && meta.dtype !== String(embeddingConfig.dtype))
      || (meta.pooling && meta.pooling !== embeddingConfig.pooling)) {
    throw new UnavailableError(`Paper vectors were built with ${meta.model}/${meta.dim}/${meta.dtype ?? '?'}/${meta.pooling ?? '?'}, but the server is configured for ${embeddingId}/${embeddingConfig.dim}/${String(embeddingConfig.dtype)}/${embeddingConfig.pooling}. Re-run make all.`);
  }
  const hasPlatforms = hasTable('paper_platforms');
  const n = Number(db.prepare('SELECT COALESCE(MAX(row), 0) FROM paper_index').pluck().get() ?? 0);
  const dim = embeddingConfig.dim;
  const vecs = new Int8Array(n * dim), scales = new Float32Array(n), hasVec = new Uint8Array(n);
  const papers: PaperMeta[] = new Array(n);
  const stmt = db.prepare(`
    SELECT i.row, i.paper_id, i.vec, i.vec_scale, f.title, f.year, f.venue_id, f.venue_name, f.doi,
      (SELECT group_concat(pt.topic_id, char(31)) FROM paper_topics pt WHERE pt.paper_id = i.paper_id) AS topics,
      ${hasPlatforms ? "(SELECT group_concat(pp.platform_id, char(31)) FROM paper_platforms pp WHERE pp.paper_id = i.paper_id)" : 'NULL'} AS platforms
    FROM paper_index i JOIN paper_facts f ON f.paper_id = i.paper_id ORDER BY i.row`);
  let loaded = 0;
  let vecCount = 0;
  for (const r of stmt.iterate() as Iterable<IndexRow>) {
    loaded++;
    const i = r.row - 1;
    if (i < 0 || i >= n) continue;
    if (r.vec && r.vec.byteLength === dim) {
      vecs.set(new Int8Array(r.vec.buffer, r.vec.byteOffset, dim), i * dim);
      scales[i] = r.vec_scale; hasVec[i] = 1;
      vecCount++;
    }
    papers[i] = { paper_id: r.paper_id, title: r.title, year: r.year, venue_id: r.venue_id, venue_name: r.venue_name, doi: r.doi,
      topics: r.topics ? String(r.topics).split('\x1f') : EMPTY_STRINGS,
      platforms: r.platforms ? String(r.platforms).split('\x1f') : EMPTY_STRINGS };
  }
  index = { n, dim, vecs, scales, hasVec, papers };
  console.log(`Paper search index loaded: ${loaded} papers, ${vecCount} vectors`);
  return index;
}

// ---------- query parsing ----------
const tokens = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const quote = (words: string[]) => `"${words.join(' ').replace(/"/g, '')}"`;

interface ParsedQuery { terms: string[]; allTokens: string[]; expansions: { acronym: string; expansion: string }[]; denseText: string }

function parse(q: string): ParsedQuery {
  const allTokens = tokens(q).slice(0, 40);
  const terms = [...new Set(allTokens.filter(t => !STOP.has(t)))].slice(0, MAX_QUERY_TERMS);
  const expansions = terms.filter(t => acronyms[t]).map(t => ({ acronym: t.toUpperCase(), expansion: acronyms[t] }));
  const denseText = expansions.length ? `${q.trim()} (${expansions.map(e => e.expansion).join('; ')})` : q.trim();
  return { terms, allTokens, expansions, denseText };
}

/** FTS5 expression for one query term: the word, or the word OR its acronym expansion as a phrase. */
const termExpr = (t: string) => {
  const alt = acronyms[t] ? tokens(acronyms[t]) : [];
  return alt.length ? `(${quote([t])} OR ${quote(alt)})` : quote([t]);
};

/** The query as a phrase; with acronyms, every acronym/expansion variant (at most 2 acronyms are varied). */
function phraseExpr(terms: string[]): string {
  let variants: string[][] = [[]];
  let varied = 0;
  for (const t of terms) {
    const parsedAlt = acronyms[t] && varied < 2 ? tokens(acronyms[t]) : [];
    const alt = parsedAlt.length ? parsedAlt : null;
    if (alt) varied++;
    variants = variants.flatMap(v => (alt ? [[...v, t], [...v, ...alt]] : [[...v, t]]));
  }
  return variants.map(quote).join(' OR ');
}

// ---------- search ----------
/** reasons: fields containing every query word; meaning: matched by meaning alone (no field has all the words). */
export interface Match { row: number; reasons: string[]; meaning: boolean; pinned: boolean }
export interface Analysis { terms: string[]; expansions: ParsedQuery['expansions']; matches: Match[]; bestScore: number; papers?: readonly PaperMeta[]; idsJson?: string }

const analysisCache = new LRUCache<string, Analysis>({ max: 300, ttl: 30 * 60 * 1000 });

// A replaced database means new papers, rows and vectors: drop the index and every analysis, and load the new index
// in the background so the first search after a rebuild does not wait for it.
onDatabaseChange(() => {
  index = null;
  analysisCache.clear();
  setImmediate(warmPaperSearch);
});

export function analyse(rawQuery: string): Promise<Analysis> {
  return runAnalysis(rawQuery, true);
}

async function runAnalysis(rawQuery: string, allowRetry: boolean): Promise<Analysis> {
  const key = rawQuery.trim().toLowerCase().replace(/\s+/g, ' ');
  const cached = analysisCache.get(key);
  if (cached) return cached;
  const idx = loadIndex();
  const gen = databaseGeneration();
  const pq = parse(rawQuery);
  if (!pq.terms.length) return { terms: [], expansions: [], matches: [], bestScore: 0 };

  const db = getDb();
  // A query FTS5 cannot parse matches nothing; any other error (missing table, damaged index) is a real failure.
  const malformed = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return /fts5: syntax error|unterminated string|no such column/i.test(message);
  };
  const matchStmt = db.prepare('SELECT rowid AS r FROM paper_search WHERE paper_search MATCH ?');
  const rowsOf = (expr: string): Set<number> => {
    try {
      return new Set((matchStmt.all(expr) as { r: number }[]).map(x => x.r));
    } catch (error) {
      if (malformed(error)) return new Set();
      throw error;
    }
  };
  const all = pq.terms.map(termExpr).join(' AND ');
  const allWords = rowsOf(all);
  const phrase = pq.terms.length === 1 ? allWords : rowsOf(phraseExpr(pq.terms));
  const titleKeywords = allWords.size ? rowsOf(`{title keywords} : (${all})`) : EMPTY_ROW_SET;
  const inTitle = titleKeywords.size ? rowsOf(`{title} : (${all})`) : EMPTY_ROW_SET;
  const inKeywords = titleKeywords.size ? rowsOf(`{keywords} : (${all})`) : EMPTY_ROW_SET;
  const inAbstract = allWords.size ? rowsOf(`{abstract} : (${all})`) : EMPTY_ROW_SET;
  const pinned = pq.allTokens.length >= 4 ? rowsOf(`{title} : ${quote(pq.allTokens)}`) : EMPTY_ROW_SET;
  const anyExpr = pq.terms.map(termExpr).join(' OR ');
  const bm25Rank = new Map<number, number>();
  try {
    (db.prepare('SELECT rowid AS r FROM paper_search WHERE paper_search MATCH ? ORDER BY bm25(paper_search, 4.0, 1.0, 2.0, 1.0) LIMIT 2000').all(anyExpr) as { r: number }[])
      .forEach((x, i) => bm25Rank.set(x.r, i));
  } catch (error) {
    if (!malformed(error)) throw error; // a malformed query has no lexical ranking
  }

  // Meaning: one dot product per paper against int8 vectors (4x unrolled); fall back to keyword FTS if embedder fails.
  let qv: Float32Array | null = null;
  try {
    qv = await embedQuery(pq.denseText);
  } catch (error) {
    console.warn('Query embedder unavailable; falling back to keyword search:', error instanceof Error ? error.message : error);
  }
  if (databaseGeneration() !== gen && allowRetry) {
    return runAnalysis(rawQuery, false);
  }
  const { n, dim, vecs, scales, hasVec } = idx;
  const scores = new Float32Array(n).fill(-1);
  let best = -1;
  if (qv) {
    const dim4 = dim & ~3;
    for (let i = 0; i < n; i++) {
      if (!hasVec[i]) continue;
      let d0 = 0, d1 = 0, d2 = 0, d3 = 0;
      const o = i * dim;
      let j = 0;
      for (; j < dim4; j += 4) {
        d0 += qv[j] * vecs[o + j];
        d1 += qv[j + 1] * vecs[o + j + 1];
        d2 += qv[j + 2] * vecs[o + j + 2];
        d3 += qv[j + 3] * vecs[o + j + 3];
      }
      let d = d0 + d1 + d2 + d3;
      for (; j < dim; j++) d += qv[j] * vecs[o + j];
      const s = d * scales[i];
      scores[i] = s;
      if (s > best) best = s;
    }
  }

  const matched: { i: number; m: Match }[] = [];
  for (let i = 0; i < n; i++) {
    const row = i + 1;
    const gap = qv && hasVec[i] ? best - scores[i] : 0;
    const isPinned = pinned.has(row);
    const meaning = Boolean(qv) && hasVec[i] === 1 && best >= RULES.meaningFloor && gap <= RULES.meaningGap;
    const ok = isPinned || meaning
      || (phrase.has(row) && gap <= RULES.phraseGap)
      || (titleKeywords.has(row) && gap <= RULES.titleKeywordsGap)
      || (allWords.has(row) && gap <= RULES.allWordsGap);
    if (!ok) continue;
    const reasons = [inTitle.has(row) && 'title', inKeywords.has(row) && 'keywords', inAbstract.has(row) && 'abstract',
      phrase.has(row) && !inTitle.has(row) && !inKeywords.has(row) && !inAbstract.has(row) && 'text'].filter(Boolean) as string[];
    matched.push({ i, m: { row, reasons, meaning: reasons.length === 0, pinned: isPinned } });
  }

  // Order: pinned titles first, then reciprocal rank fusion of dense and lexical rankings (or lexical rank when offline).
  const byDense = [...matched].sort((a, b) => scores[b.i] - scores[a.i]);
  const denseRank = new Map(byDense.map((x, r) => [x.i, r]));
  const byLex = matched.filter(x => bm25Rank.has(x.m.row)).sort((a, b) => bm25Rank.get(a.m.row)! - bm25Rank.get(b.m.row)!);
  const lexRank = new Map(byLex.map((x, r) => [x.i, r]));
  const fused = (x: { i: number; m: Match }) => (qv ? 1 / (RULES.rrfK + 1 + denseRank.get(x.i)!) : 0)
    + (lexRank.has(x.m.row) ? 1 / (RULES.rrfK + 1 + lexRank.get(x.m.row)!) : 0);
  matched.sort((a, b) => Number(b.m.pinned) - Number(a.m.pinned) || fused(b) - fused(a));

  const result: Analysis = { terms: pq.terms, expansions: pq.expansions, matches: matched.map(x => x.m), bestScore: best, papers: idx.papers };
  if (qv && databaseGeneration() === gen) analysisCache.set(key, result);
  return result;
}

export interface SearchFilters { startYear?: number; endYear?: number; topics?: string[]; venues?: string[]; platforms?: string[] }

export function applyFilters(a: Analysis, f: SearchFilters): Match[] {
  const papers = a.papers ?? loadIndex().papers;
  // Any of the plain values, or all the parts of a compound one such as "a+b".
  const matches = (wanted: string[] | undefined, have: readonly string[]) => !wanted?.length
    || wanted.some(w => {
      if (!w.includes('+')) return have.includes(w);
      const parts = w.split('+').map(part => part.trim()).filter(Boolean);
      return parts.length > 0 && parts.every(part => have.includes(part));
    });
  const venues = f.venues?.length ? new Set(f.venues) : null;
  return a.matches.filter(m => {
    const p = papers[m.row - 1];
    if (!p) return false;
    if (f.startYear !== undefined && (p.year ?? 0) < f.startYear) return false;
    if (f.endYear !== undefined && (p.year ?? 9999) > f.endYear) return false;
    if (venues && !(p.venue_id && venues.has(p.venue_id))) return false;
    if (!matches(f.topics, p.topics)) return false;
    if (!matches(f.platforms, p.platforms)) return false;
    return true;
  });
}

export const paperAt = (row: number, analysis?: Analysis): PaperMeta | undefined =>
  (analysis?.papers ?? loadIndex().papers)[row - 1];

/**
 * The matching papers for a search, as a JSON array of paper ids, for SQL filters of the form
 * `paper_id IN (SELECT value FROM json_each(?))`. Year/topic/venue filters are left to the caller's query.
 */
export async function paperSetJson(query: string): Promise<string> {
  const a = await analyse(query);
  if (!a.idsJson) a.idsJson = JSON.stringify(a.matches.map(m => paperAt(m.row, a)?.paper_id).filter((id): id is string => Boolean(id)));
  return a.idsJson;
}

export function warmPaperSearch(): void {
  try { loadIndex(); } catch (err) { console.warn('Paper search unavailable:', err instanceof Error ? err.message : err); }
}
