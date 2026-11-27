import express from 'express';
import { gunzipSync, gzipSync } from 'zlib';
import { LRUCache } from 'lru-cache';
import { databaseGeneratedAt, onDatabaseChange } from './db';

export interface CachedResponse {
  body: Buffer;
  compressed: boolean;
}

const COMPRESS_MIN_BYTES = 1024;
const entriesCache = new LRUCache<string, CachedResponse>({ max: 500, ttl: 30 * 60 * 1000 });
const detailCache = new LRUCache<string, CachedResponse>({ max: 5000, ttl: 15 * 60 * 1000 });
onDatabaseChange(() => { entriesCache.clear(); detailCache.clear(); });

export function acceptsGzip(req: express.Request): boolean {
  // Unit tests may pass a minimal mock request without headers; preserve gzip default there.
  if (req.headers === undefined) return true;
  return /\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''));
}

export function encodeJsonResponse(payload: unknown, alwaysCompress = false): CachedResponse {
  const raw = Buffer.from(JSON.stringify(payload));
  if (alwaysCompress || raw.length >= COMPRESS_MIN_BYTES) {
    return { body: gzipSync(raw), compressed: true };
  }
  return { body: raw, compressed: false };
}

export function sendEncodedJson(
  req: express.Request,
  res: express.Response,
  encoded: CachedResponse,
  cacheControl?: string,
): express.Response {
  if (cacheControl) res.set('Cache-Control', cacheControl);
  if (encoded.compressed) {
    res.set('Vary', 'Accept-Encoding');
    if (acceptsGzip(req)) {
      return res.set('Content-Encoding', 'gzip').type('application/json').send(encoded.body);
    }
    return res.type('application/json').send(gunzipSync(encoded.body));
  }
  return res.type('application/json').send(encoded.body);
}

/** Answers from the entries cache if this URL is in it; true when it did. Lets a route skip its queries. */
export const sendEntriesFromCache = (req: express.Request, res: express.Response): boolean => {
  const cached = entriesCache.get(req.originalUrl);
  if (!cached) return false;
  sendEncodedJson(req, res, cached, 'no-cache');
  return true;
};

export const sendCachedEntries = (req: express.Request, res: express.Response, entries: unknown[]) => {
  const key = req.originalUrl;
  const cached = entriesCache.get(key);
  if (cached) return sendEncodedJson(req, res, cached, 'no-cache');
  const encoded = encodeJsonResponse({
    entries,
    metadata: { generated_at: databaseGeneratedAt().toISOString() },
  }, true);
  entriesCache.set(key, encoded);
  return sendEncodedJson(req, res, encoded, 'no-cache');
};

/** Answers from the detail cache if this URL is in it; true when it did. */
export const sendDetailFromCache = (req: express.Request, res: express.Response): boolean => {
  const cached = detailCache.get(req.originalUrl);
  if (!cached) return false;
  sendEncodedJson(req, res, cached, 'no-cache');
  return true;
};

export const sendCachedDetail = (req: express.Request, res: express.Response, payload: object) => {
  const key = req.originalUrl;
  const cached = detailCache.get(key);
  if (cached) return sendEncodedJson(req, res, cached, 'no-cache');
  const encoded = encodeJsonResponse(payload);
  detailCache.set(key, encoded);
  return sendEncodedJson(req, res, encoded, 'no-cache');
};
