#!/usr/bin/env node
/**
 * Embed every staged paper (title + abstract, or title + keywords when there is no abstract)
 * into staging.paper_embeddings, using the model in pipeline/config/embedding.json.
 *
 * Runs on CPU. Resumable and incremental: each batch is committed as it finishes, and papers whose
 * text and model are unchanged are skipped, so Ctrl-C and rerun is safe.
 *
 *   node pipeline/scripts/embed_papers.mjs [--limit N] [--threads N]
 *   STAGING_DB_PATH=... to point at another staging database.
 */
import { pipeline, env } from '@huggingface/transformers';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

function parsePositiveInt(raw, flag) {
  if (!raw || !/^\d+$/.test(raw)) throw new Error(`${flag} requires a positive integer`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${flag} requires a positive integer`);
  return n;
}

function parseArgs(argv) {
  let limit = Infinity;
  let threads;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit') limit = parsePositiveInt(argv[++i], '--limit');
    else if (arg.startsWith('--limit=')) limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    else if (arg === '--threads') threads = parsePositiveInt(argv[++i], '--threads');
    else if (arg.startsWith('--threads=')) threads = parsePositiveInt(arg.slice('--threads='.length), '--threads');
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { limit, threads };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { limit, threads } = parseArgs(process.argv.slice(2));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline/config/embedding.json'), 'utf8'));
if (!/^[0-9a-f]{40}$/.test(cfg.revision ?? '')) throw new Error(`embedding.json: revision must be a full commit hash, got ${cfg.revision}`);
/** model@revision: stored with each vector, so a vector made by other weights is re-embedded, never trusted. */
const modelId = `${cfg.model}@${cfg.revision}`;
const BATCH = 32;

env.cacheDir = path.resolve(ROOT, cfg.cacheDir);
env.allowLocalModels = false;

const dbPath = process.env.STAGING_DB_PATH || path.join(ROOT, 'data/staging.db');

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014',
};
const unescapeHtml = (input) => {
  let text = input || '';
  for (let pass = 0; pass < 3; pass++) {
    const next = text
      .replace(/&#(\d+);/g, (_, dec) => {
        const cp = Number(dec);
        return Number.isSafeInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : _;
      })
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        const cp = parseInt(hex, 16);
        return Number.isSafeInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : _;
      })
      .replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash);/gi, (_, name) => NAMED_ENTITIES[name.toLowerCase()]);
    if (next === text) break;
    text = next;
  }
  return text;
};
const strip = (s) => unescapeHtml(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** The exact text that gets embedded. Uses "title. abstract" (or title + keywords when no abstract is available). */
function paperText(r) {
  const title = strip(r.title);
  const abstract = strip(r.abstract_openalex) || strip(r.arxiv_abstract);
  if (abstract) return `${cfg.documentPrefix}${title}. ${abstract}`;
  let kw = [];
  try { kw = JSON.parse(r.keywords || '[]').map((k) => k[0]).filter(Boolean); } catch { /* no keywords */ }
  return `${cfg.documentPrefix}${title}.${kw.length ? ' Keywords: ' + kw.join('; ') + '.' : ''}`;
}

const hash = (text) => createHash('sha1')
  .update(modelId + '|' + cfg.dtype + '|' + cfg.pooling + (cfg.maxLength === 512 ? '' : '|' + cfg.maxLength) + '|' + text)
  .digest('hex');

async function main() {
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS paper_embeddings (
      paper_id TEXT PRIMARY KEY, model TEXT NOT NULL, text_hash TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL)`);

    const rows = db.prepare(`
      SELECT p.paper_id, p.title, t.abstract_openalex, t.arxiv_abstract, t.keywords, e.text_hash
      FROM papers p
      LEFT JOIN paper_text t USING (paper_id)
      LEFT JOIN paper_embeddings e USING (paper_id)`).all();

    const noText = rows.filter((r) => r.abstract_openalex == null && r.arxiv_abstract == null && r.keywords == null).length;
    if (noText > rows.length * 0.5) {
      console.warn(`Warning: ${noText}/${rows.length} papers have no enrichment yet. Run enrich_papers.py first for good vectors.`);
    }

    const todo = [];
    let upToDate = 0;
    for (const r of rows) {
      const text = paperText(r);
      const h = hash(text);
      if (r.text_hash === h) upToDate++;
      else if (todo.length < limit) todo.push({ id: r.paper_id, text, h });
    }
    console.log(`${rows.length} papers; ${upToDate} already up to date; ${todo.length} to embed with ${modelId} (${cfg.dtype}).`);
    if (!todo.length) return;

    console.log('Loading model (downloads ~35 MB on first run)...');
    const extractor = await pipeline('feature-extraction', cfg.model, {
      revision: cfg.revision,
      dtype: cfg.dtype,
      ...(threads ? { session_options: { intraOpNumThreads: threads } } : {}),
    });

    const upsert = db.prepare(`INSERT INTO paper_embeddings (paper_id, model, text_hash, dim, vec) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(paper_id) DO UPDATE SET model=excluded.model, text_hash=excluded.text_hash, dim=excluded.dim, vec=excluded.vec`);
    const writeBatch = db.transaction((items, data, dim) => {
      items.forEach((it, j) => {
        const v = data.subarray(j * dim, (j + 1) * dim);
        upsert.run(it.id, modelId, it.h, dim, Buffer.from(v.buffer, v.byteOffset, v.byteLength));
      });
    });

    let stopping = false;
    process.on('SIGINT', () => { if (stopping) process.exit(130); stopping = true; console.log('\nStopping after this batch (progress is saved)...'); });

    const t0 = Date.now();
    let done = 0, lastLog = 0;
    for (let i = 0; i < todo.length && !stopping; i += BATCH) {
      const items = todo.slice(i, i + BATCH);
      const out = await extractor(items.map((it) => it.text), {
        pooling: cfg.pooling, normalize: true, truncation: true, max_length: cfg.maxLength,
      });
      const dim = out.dims[1];
      if (dim !== cfg.dim) throw new Error(`Model returned dim ${dim}, config says ${cfg.dim}`);
      writeBatch(items, Float32Array.from(out.data), dim);
      done += items.length;
      const secs = (Date.now() - t0) / 1000;
      if (secs - lastLog >= 30 || done === todo.length) {
        lastLog = secs;
        const rate = done / Math.max(secs, 1e-6);
        console.log(`  ${done}/${todo.length}  ${rate.toFixed(1)} papers/s  ~${((todo.length - done) / rate / 60).toFixed(0)} min left`);
      }
    }
    const secs = (Date.now() - t0) / 1000;
    console.log(`${stopping ? 'Stopped' : 'Done'}: embedded ${done} papers in ${(secs / 60).toFixed(1)} min on ${threads || os.cpus().length} threads.`);
  } finally {
    db.close();
  }
}

await main();
