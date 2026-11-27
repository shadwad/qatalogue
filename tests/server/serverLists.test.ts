import { locationMappingPath } from '../helpers/locationsFixture';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { gunzipSync } from 'node:zlib';
import type { InstitutionEntry, InstitutionPath, ResearcherEntry, ResearcherPath } from '../../server/services/entryLists';
import type { ListFilters } from '../../server/services/listFilters';
import { buildFixtureServeDb } from '../helpers/fixtureDb';

/**
 * The institution and researcher lists answer a request through one of several paths (server/services/entryLists.ts:
 * pre-computed summaries, per-dimension rows, the facts). Every path that can answer a request must give the same
 * entries. Runs on the hand-worked dataset of tests/pipeline/test_credit.py, built into a served database by the
 * Python pipeline; LIST_CHECK_DB=<serve.db> runs the same checks on a real build.
 */
let dbPath = process.env.LIST_CHECK_DB;
if (!dbPath) {
  const fixture = buildFixtureServeDb('qatalogue-lists-');
  dbPath = fixture.dbPath;
  after(fixture.cleanup);
}
process.env.DB_PATH = dbPath;

const r9 = (x: unknown) => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : x);
const institutionView = (rows: readonly InstitutionEntry[]) => rows.map(r => [r.institution_id, r9(r.total_fractional_score), r.paper_count, r.core_faculty_count]);
const researcherView = (rows: readonly ResearcherEntry[]) => rows.map(r => [r.author_id, r9(r.total_fractional_score), r.paper_count, r.latest_affiliation, r.location_code, r.max_year]);
const asSet = (rows: unknown[][]) => rows.map(r => JSON.stringify(r)).sort();

test('every path that can answer a request gives the same entries', async () => {
  const lists = await import('../../server/services/entryLists');
  const { readListFilters } = await import('../../server/services/listFilters');
  const { getDb } = await import('../../server/services/db');
  const db = getDb();
  const venue = (db.prepare('SELECT venue_id FROM paper_facts GROUP BY venue_id ORDER BY COUNT(*) DESC LIMIT 1').get() as { venue_id: string }).venue_id;
  const topic = (db.prepare("SELECT topic_id FROM paper_topics WHERE topic_id NOT LIKE '%/%' GROUP BY topic_id ORDER BY COUNT(*) DESC LIMIT 1").get() as { topic_id: string }).topic_id;
  const years = db.prepare('SELECT MIN(year) AS lo, MAX(year) AS hi FROM paper_facts').get() as { lo: number; hi: number };
  const location = (db.prepare("SELECT location_code FROM institutions WHERE location_code IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1").get() as { location_code: string }).location_code;
  const name = String((db.prepare("SELECT display_name FROM institutions ORDER BY inst_id LIMIT 1").get() as { display_name: string }).display_name).split(' ')[0];
  const authorName = String((db.prepare("SELECT name FROM authors WHERE author_id NOT LIKE 'NO_%' AND name <> 'Anonymous' ORDER BY author_id LIMIT 1").get() as { name: string }).name).split(' ')[0];
  const median = (sql: string) => {
    const xs = (db.prepare(sql).all() as { x: number }[]).map(r => r.x).sort((a, b) => a - b);
    return xs[Math.floor(xs.length / 2)];
  };
  const institutionMedian = median("SELECT SUM(total_fractional_score) AS x FROM performance_summary WHERE entity_type = 'institution' GROUP BY entity_id");
  const researcherMedian = median("SELECT SUM(total_fractional_score) AS x FROM performance_summary WHERE entity_type = 'researcher' GROUP BY entity_id");

  const institutionCases: { query: Record<string, string>; expect: InstitutionPath; also: InstitutionPath[]; ordered?: boolean }[] = [
    { query: {}, expect: 'summary', also: ['facts'] },
    { query: { start_year: String(years.hi), end_year: String(years.hi) }, expect: 'summary', also: ['facts'] },
    { query: { metric_mode: 'frac_count' }, expect: 'summary', also: ['facts'] },
    { query: { metric_mode: 'total_count' }, expect: 'summary', also: ['facts'] },
    { query: { location }, expect: 'summary', also: ['facts'] },
    { query: { venue }, expect: 'dimension', also: ['facts'] },
    { query: { venue, metric_mode: 'frac_count', start_year: String(years.hi) }, expect: 'dimension', also: ['facts'] },
    { query: { topic }, expect: 'dimension', also: ['facts'] },
    { query: { institutional_threshold: String(institutionMedian) }, expect: 'summary', also: ['threshold'] },
    { query: { average_threshold: '0.05' }, expect: 'summary', also: ['threshold'] },
    { query: { metric_mode: 'total_count', average_threshold: '0.5' }, expect: 'summary', also: ['threshold'] },
    { query: { venue, institutional_threshold: String(institutionMedian) }, expect: 'dimension', also: ['threshold'] },
    { query: { search: name }, expect: 'summary', also: ['facts'], ordered: false },   // search ranks by match, facts by score
    { query: { search: name.slice(0, 1) }, expect: 'summary', also: ['facts'], ordered: false },
    { query: { search: name.slice(0, 2) }, expect: 'summary', also: ['facts'], ordered: false },
  ];
  for (const c of institutionCases) {
    const f = await readListFilters(c.query);
    assert.equal(lists.institutionPath(f), c.expect, `path for ${JSON.stringify(c.query)}`);
    const want = institutionView(lists.institutionPaths[c.expect](f));
    assert.ok(want.length > 0, `no entries for ${JSON.stringify(c.query)}`);
    for (const other of c.also) {
      const got = institutionView(lists.institutionPaths[other](f));
      if (c.ordered === false) assert.deepEqual(asSet(got), asSet(want), `${other} vs ${c.expect} for ${JSON.stringify(c.query)}`);
      else assert.deepEqual(got, want, `${other} vs ${c.expect} for ${JSON.stringify(c.query)}`);
    }
  }

  const researcherCases: { query: Record<string, string>; expect: ResearcherPath; also: ResearcherPath[]; ordered?: boolean }[] = [
    { query: {}, expect: 'summary', also: ['facts'] },
    { query: { start_year: String(years.lo), end_year: String(years.lo) }, expect: 'summary', also: ['facts'] },
    { query: { metric_mode: 'total_count' }, expect: 'summary', also: ['facts'] },
    { query: { venue }, expect: 'dimension', also: ['facts'] },
    { query: { topic }, expect: 'dimension', also: ['facts'] },
    { query: { individual_threshold: String(researcherMedian) }, expect: 'summary', also: ['facts'] },
    { query: { venue, individual_threshold: String(researcherMedian) }, expect: 'dimension', also: ['facts'] },
    { query: { search: authorName }, expect: 'summary', also: ['facts'], ordered: false },
    { query: { search: authorName.slice(0, 1) }, expect: 'summary', also: ['facts'], ordered: false },
    { query: { search: authorName.slice(0, 2) }, expect: 'summary', also: ['facts'], ordered: false },
  ];
  for (const c of researcherCases) {
    const f = await readListFilters(c.query);
    assert.equal(lists.researcherPath(f), c.expect, `path for ${JSON.stringify(c.query)}`);
    const want = researcherView(lists.researcherPaths[c.expect](f));
    assert.ok(want.length > 0, `no entries for ${JSON.stringify(c.query)}`);
    for (const other of c.also) {
      const got = researcherView(lists.researcherPaths[other](f));
      if (c.ordered === false) assert.deepEqual(asSet(got), asSet(want), `${other} vs ${c.expect} for ${JSON.stringify(c.query)}`);
      else assert.deepEqual(got, want, `${other} vs ${c.expect} for ${JSON.stringify(c.query)}`);
    }
  }
});

test('pages do not overlap, and an offset works without a limit', async () => {
  const lists = await import('../../server/services/entryLists');
  const { readListFilters } = await import('../../server/services/listFilters');
  const listReaders: Array<(f: ListFilters) => readonly (InstitutionEntry | ResearcherEntry)[]> = [
    lists.institutionList,
    lists.researcherList,
  ];
  for (const list of listReaders) {
    const all = list(await readListFilters({}));
    const id = (r: InstitutionEntry | ResearcherEntry) => 'institution_id' in r ? r.institution_id : r.author_id;
    const half = Math.max(1, Math.floor(all.length / 2));
    const first = list(await readListFilters({ limit: String(half) }));
    const rest = list(await readListFilters({ offset: String(half) }));
    assert.deepEqual([...first, ...rest].map(id), all.map(id));
  }
});

test('bad parameters are rejected before any query', async () => {
  const { readListFilters } = await import('../../server/services/listFilters');
  const { InputError } = await import('../../server/services/utils');
  for (const query of [{ start_year: 'abc' }, { start_year: '2025', end_year: '2021' }, { metric_mode: 'bogus' },
    { limit: '0' }, { offset: '-1' }, { individual_threshold: '-2' }, { average_threshold: 'x' }]) {
    await assert.rejects(readListFilters(query), InputError, JSON.stringify(query));
  }
});

test('pipeline default summaries match server entry lists and serve.db generated_at', { skip: Boolean(process.env.LIST_CHECK_DB) }, async () => {
  const lists = await import('../../server/services/entryLists');
  const { readListFilters } = await import('../../server/services/listFilters');
  const { databaseGeneratedAt } = await import('../../server/services/db');
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qatalogue-summary-parity-'));
  try {
    const finalDb = path.join(scratch, 'serve.db');
    const tmpDb = `${finalDb}.tmp`;
    const publicDir = path.join(scratch, 'public');
    const logDir = path.join(scratch, 'logs');
    fs.mkdirSync(publicDir, { recursive: true });
    fs.copyFileSync(dbPath!, tmpDb);
    const venvPython = path.join(repoRoot, '.venv', 'bin', 'python3');
    const python = process.env.PYTHON || (fs.existsSync(venvPython) ? venvPython : 'python3');
    execFileSync(
      python,
      ['-c', 'from pipeline.scripts import build_default_summary, finalize_build; build_default_summary.main(); finalize_build.finalize()'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PYTHONPATH: repoRoot,
          SERVE_DB_PATH: finalDb,
          PUBLIC_DIR: publicDir,
          LOCATION_MAPPING_PATH: locationMappingPath,
          PIPELINE_LOG_DIR: logDir,
          PIPELINE_CONSOLE_LEVEL: 'WARNING',
        },
        stdio: 'pipe',
      },
    );

    const instPayload = JSON.parse(gunzipSync(fs.readFileSync(path.join(publicDir, 'default-institutions.json.gz'))).toString('utf8')) as {
      entries: InstitutionEntry[];
      metadata: { generated_at: string };
    };
    const resPayload = JSON.parse(gunzipSync(fs.readFileSync(path.join(publicDir, 'default-researchers.json.gz'))).toString('utf8')) as {
      entries: Array<ResearcherEntry & { type?: string }>;
      metadata: { generated_at: string };
    };

    const expectedFinalStamp = fs.statSync(finalDb).mtime.toISOString();
    assert.ok(instPayload.metadata.generated_at.endsWith('Z'));
    assert.equal(instPayload.metadata.generated_at, expectedFinalStamp);
    assert.equal(resPayload.metadata.generated_at, expectedFinalStamp);
    assert.equal(databaseGeneratedAt().toISOString(), fs.statSync(dbPath!).mtime.toISOString());

    const serverInsts = lists.institutionList(await readListFilters({}));
    const serverRes = lists.researcherList(await readListFilters({}));
    assert.deepEqual(institutionView(instPayload.entries), institutionView(serverInsts));
    assert.deepEqual(researcherView(resPayload.entries), researcherView(serverRes));
    assert.ok(resPayload.entries.every(entry => entry.type === 'researcher'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
