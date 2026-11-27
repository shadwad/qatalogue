import { locationMappingPath } from '../helpers/locationsFixture';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { allLocations } from '../../shared/locationNames';

// The server reads DB_PATH when db.ts loads, so the test points it at a scratch file first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qatalogue-db-'));
const live = path.join(dir, 'serve.db');
process.env.DB_PATH = live;
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function build(file: string, value: string, withSecondTable = false) {
  const db = new Database(file);
  db.exec(`CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('${value}')`);
  if (withSecondTable) db.exec('CREATE TABLE t2 (id INTEGER PRIMARY KEY)');
  db.close();
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const read = (db: ReturnType<typeof Database>) => (db.prepare('SELECT v FROM t').get() as { v: string }).v;

test('a replaced serve.db is picked up, caches are emptied, and a missing file keeps the old data', async () => {
  build(live, 'old');
  const { closeDb, getDb, hasTable, databaseGeneration, onDatabaseChange, databaseGeneratedAt } = await import('../../server/services/db');
  const { locationDetails } = await import('../../server/services/utils');
  const { sendCachedEntries } = await import('../../server/services/cache');
  let changes = 0;
  onDatabaseChange(() => { changes++; });

  const db = getDb();
  assert.equal(read(db), 'old');
  assert.equal(db.pragma('temp_store', { simple: true }), 2);
  assert.equal(db.pragma('cache_size', { simple: true }), -65536);
  assert.equal(databaseGeneration(), 0);
  assert.equal(hasTable('t'), true);
  assert.equal(hasTable('t2'), false);
  const firstBuild = databaseGeneratedAt().getTime();

  // A cached response for one URL, as the entries routes make them.
  const answer = (entries: unknown[]): unknown[] => {
    let body: Buffer | undefined;
    const res = {
      set: () => res,
      type: () => res,
      send: (b: Buffer) => { body = b; return res; },
    } as unknown as Response;
    sendCachedEntries({ originalUrl: '/api/entries/x' } as unknown as Request, res, entries);
    return (JSON.parse(gunzipSync(body!).toString()) as { entries: unknown[] }).entries;
  };
  assert.deepEqual(answer(['old']), ['old']);
  assert.deepEqual(answer(['ignored: served from the cache']), ['old']);

  // The pipeline's swap: a new file moved over the old one (plus updated location mapping).
  fs.writeFileSync(locationMappingPath, JSON.stringify({ ...allLocations(), ZZ: { name: 'Testland', region: 'Test Region' } }));
  const next = path.join(dir, 'serve.db.tmp');
  build(next, 'new', true);
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(next, later, later);
  fs.renameSync(next, live);
  await pause(1200);

  assert.equal(read(db), 'new', 'the handle taken before the swap now reads the new file');
  assert.equal(changes, 1);
  assert.equal(databaseGeneration(), 1);
  assert.equal(hasTable('t2'), true, 'table-existence cache clears when serve.db swaps');
  assert.deepEqual(locationDetails('ZZ'), { location: 'Testland', region: 'Test Region' });
  assert.ok(databaseGeneratedAt().getTime() > firstBuild, 'generated_at follows the file being served');
  assert.deepEqual(answer(['new']), ['new'], 'the cache holds nothing from the old database');

  // closeDb cleanly closes and lets a subsequent getDb() reconnect without re-firing onDatabaseChange.
  closeDb();
  assert.equal(read(getDb()), 'new');
  assert.equal(changes, 1);

  // The file missing for a moment (mid-swap): keep serving what is open, do not throw.
  fs.renameSync(live, path.join(dir, 'moved.db'));
  await pause(1200);
  assert.equal(read(db), 'new');
  assert.equal(changes, 1);
  assert.equal(databaseGeneration(), 1);
});

test('bad input is a 400, a missing feature a 503, anything else a 500 without details', async () => {
  const { InputError, UnavailableError, sendError, queryId, queryNumber, queryThreshold } = await import('../../server/services/utils');
  const answer = (error: unknown) => {
    const seen: { status?: number; body?: unknown } = {};
    const res = {
      status: (s: number) => { seen.status = s; return res; },
      json: (b: unknown) => { seen.body = b; return res; },
    } as unknown as Response;
    const log = console.error; console.error = () => {};
    try { sendError(res, error); } finally { console.error = log; }
    return seen;
  };
  assert.deepEqual(answer(new InputError('start_year must be a year')), { status: 400, body: { error: 'start_year must be a year' } });
  assert.deepEqual(answer(new UnavailableError('index not built')), { status: 503, body: { error: 'index not built' } });
  assert.deepEqual(answer(new Error('SQLITE_ERROR: no such column secret_col')), { status: 500, body: { error: 'Internal server error' } });

  assert.throws(() => queryNumber('abc', 'start_year', 1900, 2100), InputError);
  assert.throws(() => queryNumber('', 'start_year', 1900, 2100), InputError);
  assert.throws(() => queryNumber('   ', 'start_year', 1900, 2100), InputError);
  assert.throws(() => queryNumber('1800', 'start_year', 1900, 2100), InputError);
  assert.throws(() => queryThreshold('-1', 'individual_threshold'), InputError);
  assert.throws(() => queryThreshold('', 'individual_threshold'), InputError);
  assert.throws(() => queryId(['a', 'b'], 'inst_id', true), InputError);
  assert.equal(queryNumber('2024', 'start_year', 1900, 2100), 2024);
  assert.equal(queryNumber(undefined, 'start_year', 1900, 2100), undefined);
});
