import '../helpers/locationsFixture';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { buildFixtureServeDb } from '../helpers/fixtureDb';

const fixture = buildFixtureServeDb('qatalogue-routes-');
const configDir = path.join(fixture.tempDir, 'pipeline', 'config');
fs.mkdirSync(configDir, { recursive: true });
fs.copyFileSync(path.join(fixture.repoRoot, 'pipeline', 'config', 'embedding.json'), path.join(configDir, 'embedding.json'));
process.env.DB_PATH = fixture.dbPath;
process.env.PROJECT_ROOT = fixture.tempDir;

const { createApp } = await import('../../server/app');
const app = await createApp({ dev: false });
const server = await new Promise<http.Server>((resolve) => {
  const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
});
const { port } = server.address() as { port: number };
const baseUrl = `http://127.0.0.1:${port}`;

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>(resolve => server.close(() => resolve()));
  fixture.cleanup();
});

async function request<T = Record<string, unknown>>(urlPath: string, init?: RequestInit): Promise<{ status: number; headers: Headers; body: T }> {
  const res = await fetch(`${baseUrl}${urlPath}`, init);
  const text = await res.text();
  const body = ((res.headers.get('content-type') ?? '').includes('application/json')
    ? JSON.parse(text)
    : text) as T;
  return { status: res.status, headers: res.headers, body };
}

test('GET /api/meta and unknown /api route return valid JSON', async () => {
  const meta = await request<{ year_min: number; year_max: number; totals: { institution: number; researcher: number; paper: number } }>('/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.year_min, 2023);
  assert.equal(meta.body.year_max, 2024);
  assert.equal(meta.body.totals.institution, 3);
  assert.equal(meta.body.totals.researcher, 3);
  assert.equal(meta.body.totals.paper, 3);

  const missing = await request('/api/does-not-exist');
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: 'Not found' });

  const badSummary = await request('/default-summary/unknown.json.gz');
  assert.equal(badSummary.status, 404);
  assert.deepEqual(badSummary.body, { error: 'Unknown default summary view' });
});

test('GET /default-summary/:view.json.gz returns 404 when unbuilt and negotiates gzip vs plain JSON when present', async () => {
  for (const view of ['institutions', 'researchers'] as const) {
    const missing = await request(`/default-summary/${view}.json.gz`);
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'Default summary unavailable' });
  }

  const publicDir = path.join(fixture.tempDir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  const fixtures = {
    institutions: { entries: [{ institution_id: 'I1', total_fractional_score: 1.25 }], metadata: { generated_at: '2026-06-15T12:00:00Z' } },
    researchers: { entries: [{ type: 'researcher', author_id: 'A', total_fractional_score: 0.83 }], metadata: { generated_at: '2026-06-15T12:00:00Z' } },
  };
  for (const [view, payload] of Object.entries(fixtures)) {
    fs.writeFileSync(path.join(publicDir, `default-${view}.json.gz`), gzipSync(JSON.stringify(payload)));
    const gzipped = await rawGet(`/default-summary/${view}.json.gz`, 'gzip');
    assert.equal(gzipped.status, 200);
    assert.equal(gzipped.headers['content-encoding'], 'gzip');
    assert.equal(gzipped.headers['cache-control'], 'no-cache');
    assert.equal(gzipped.headers['vary'], 'Accept-Encoding');
    assert.deepEqual(JSON.parse(gunzipSync(gzipped.raw).toString('utf8')), payload);

    const plain = await rawGet(`/default-summary/${view}.json.gz`, 'identity');
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.headers['cache-control'], 'no-cache');
    assert.equal(plain.headers['vary'], 'Accept-Encoding');
    assert.deepEqual(JSON.parse(plain.raw.toString('utf8')), payload);
  }
});

test('entries routes handle FTS edge cases, degenerate compound filters, and bad params cleanly', async () => {
  for (const endpoint of ['/api/entries/institutions', '/api/entries/researchers']) {
    const ok = await request<{ entries: unknown[] }>(endpoint);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.entries.length, 3);

    const spaces = await request<{ entries: unknown[] }>(`${endpoint}?search=%20%20%20`);
    assert.equal(spaces.status, 200);
    assert.equal(spaces.body.entries.length, 3);

    const nul = await request<{ entries: unknown[] }>(`${endpoint}?search=foo%00bar`);
    assert.equal(nul.status, 200);
    assert.deepEqual(nul.body.entries, []);

    const keyword = await request(`${endpoint}?search=NOT`);
    assert.equal(keyword.status, 200);

    const emptyCompound = await request<{ entries: unknown[] }>(`${endpoint}?topic=%2B`);
    assert.equal(emptyCompound.status, 200);
    assert.deepEqual(emptyCompound.body.entries, []);

    const dupSearch = await request(`${endpoint}?search=a&search=b`);
    assert.equal(dupSearch.status, 400);

    const blankLimit = await request(`${endpoint}?limit=`);
    assert.equal(blankLimit.status, 400);

    const blankThreshold = await request(`${endpoint}?individual_threshold=`);
    assert.equal(blankThreshold.status, 400);
  }
});

test('detail routes (/api/faculty, /api/institutions, /api/papers) validate params and preserve deterministic order', async () => {
  // Missing / duplicate IDs -> 400 JSON (never 500)
  assert.equal((await request('/api/faculty')).status, 400);
  assert.equal((await request('/api/faculty?inst_id=I1&inst_id=I2')).status, 400);
  assert.equal((await request('/api/institutions')).status, 400);
  assert.equal((await request('/api/institutions?author_id=A&author_id=B')).status, 400);
  assert.equal((await request('/api/papers')).status, 400);
  assert.equal((await request('/api/papers?inst_id=I1&inst_id=I2')).status, 400);
  assert.equal((await request('/api/papers?author_id=A&author_id=B')).status, 400);

  // Faculty for I1: Alice (A) & Bob (B), placeholder Anonymous (P) excluded
  const fac = await request<{ faculty: { author_id: string }[] }>('/api/faculty?inst_id=I1');
  assert.equal(fac.status, 200);
  assert.deepEqual(fac.body.faculty.map(r => r.author_id), ['A', 'B']);

  // Location=Unknown executes cleanly against COALESCE(location_code, '')
  const facUnknown = await request<{ faculty: unknown[] }>('/api/faculty?inst_id=I1&location=Unknown');
  assert.equal(facUnknown.status, 200);
  assert.deepEqual(facUnknown.body.faculty, []);

  // Researcher's institutions (Alice at I1 US and I4 FR; location filter narrows to FR)
  const insts = await request<{ institutions: { institution_id: string }[] }>('/api/institutions?author_id=A');
  assert.equal(insts.status, 200);
  assert.deepEqual(insts.body.institutions.map(r => r.institution_id), ['I1', 'I4']);
  const instsFr = await request<{ institutions: { institution_id: string }[] }>('/api/institutions?author_id=A&location=FR');
  assert.equal(instsFr.status, 200);
  assert.deepEqual(instsFr.body.institutions.map(r => r.institution_id), ['I4']);

  // Papers: researcher-only, institution-only, both, sorted by (year DESC, ROUND(score_share, 9) DESC, paper_id)
  const papersA = await request<{ papers: { paper_id: string }[] }>('/api/papers?author_id=A');
  assert.equal(papersA.status, 200);
  assert.deepEqual(papersA.body.papers.map(r => r.paper_id), ['P2', 'P1']);

  const papersI1 = await request<{ papers: { paper_id: string }[] }>('/api/papers?inst_id=I1');
  assert.equal(papersI1.status, 200);
  assert.deepEqual(papersI1.body.papers.map(r => r.paper_id), ['P1', 'P2', 'P3']);

  const papersAI1 = await request<{ papers: { paper_id: string }[] }>('/api/papers?inst_id=I1&author_id=A&location=US');
  assert.equal(papersAI1.status, 200);
  assert.deepEqual(papersAI1.body.papers.map(r => r.paper_id), ['P1', 'P2']);

  const papersUnknown = await request<{ papers: unknown[] }>('/api/papers?author_id=A&location=Unknown');
  assert.equal(papersUnknown.status, 200);
  assert.deepEqual(papersUnknown.body.papers, []);
});

test('GET /api/topics/counts honors locationCounts=0/false/1 and degenerate compounds', async () => {
  type TopicCountsBody = { total: number; locations?: Record<string, number>; regions?: Record<string, number> };

  const plain = await request<TopicCountsBody>('/api/topics/counts');
  assert.equal(plain.status, 200);
  assert.equal(plain.body.total, 3);
  assert.equal('locations' in plain.body, false);

  const falseFlag = await request<TopicCountsBody>('/api/topics/counts?locationCounts=false');
  assert.equal(falseFlag.status, 200);
  assert.equal('locations' in falseFlag.body, false);

  const zeroFlag = await request<TopicCountsBody>('/api/topics/counts?locationCounts=0');
  assert.equal(zeroFlag.status, 200);
  assert.equal('locations' in zeroFlag.body, false);

  const withLocations = await request<TopicCountsBody>('/api/topics/counts?locationCounts=1');
  assert.equal(withLocations.status, 200);
  assert.ok((withLocations.body.locations?.Germany ?? 0) > 0);
  assert.ok((withLocations.body.locations?.France ?? 0) > 0);
  assert.ok(Object.keys(withLocations.body.locations ?? {}).length >= 3);
  assert.ok(Object.keys(withLocations.body.regions ?? {}).length > 0);

  const emptyCompound = await request<TopicCountsBody>('/api/topics/counts?topic=%2B');
  assert.equal(emptyCompound.status, 200);
  assert.equal(emptyCompound.body.total, 0);
});

test('POST /api/network validates JSON, handles missing institution_geo, and returns deterministic edges', async () => {
  type NetworkBody = { edges: { source: string; target: string }[]; positions?: Record<string, unknown> };
  const postRaw = <T = NetworkBody>(raw: string, contentType = 'application/json') =>
    request<T>('/api/network', { method: 'POST', headers: { 'Content-Type': contentType }, body: raw });

  const malformed = await postRaw('{not json');
  assert.equal(malformed.status, 400);
  assert.ok((malformed.headers.get('content-type') ?? '').includes('application/json'));
  assert.deepEqual(malformed.body, { error: 'Invalid JSON request body' });

  const arrayBody = await postRaw('[]');
  assert.equal(arrayBody.status, 400);

  const badIdsType = await postRaw(JSON.stringify({ view: 'institution', ids: 'I1' }));
  assert.equal(badIdsType.status, 400);

  const badIdElem = await postRaw(JSON.stringify({ view: 'institution', ids: [{}] }));
  assert.equal(badIdElem.status, 400);

  const badYear = await postRaw(JSON.stringify({ view: 'institution', ids: ['I1'], start_year: '' }));
  assert.equal(badYear.status, 400);

  const invertedYears = await postRaw(JSON.stringify({ view: 'institution', ids: ['I1'], start_year: 2024, end_year: 2023 }));
  assert.equal(invertedYears.status, 400);

  const empty = await postRaw(JSON.stringify({ view: 'institution', ids: [] }));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { edges: [] });

  const instNet = await postRaw(JSON.stringify({ view: 'institution', ids: ['I1', 'I2', 'I4'] }));
  assert.equal(instNet.status, 200);
  assert.deepEqual(instNet.body.positions, {});
  assert.equal(instNet.body.edges.length, 3);
  assert.deepEqual(instNet.body.edges.map(e => `${e.source}->${e.target}`), ['I1->I2', 'I1->I4', 'I2->I4']);

  const resNet = await postRaw(JSON.stringify({ view: 'researcher', ids: ['A', 'B', 'C'] }));
  assert.equal(resNet.status, 200);
  assert.deepEqual(resNet.body.edges.map(e => `${e.source}->${e.target}`), ['A->B', 'A->C', 'B->C']);
});

test('GET /api/stats/chart, /api/stats/evidence, and /api/search/papers validate inputs', async () => {
  const chart = await request<{ papers: number; rowTotals: Record<string, number> }>('/api/stats/chart?row=year&split=topic&reference=1&topic=t1');
  assert.equal(chart.status, 200);
  assert.equal(chart.body.papers, 2);
  assert.deepEqual(chart.body.rowTotals, { 2023: 1, 2024: 2 });

  assert.equal((await request('/api/stats/chart?row=unknown')).status, 400);
  assert.equal((await request('/api/stats/chart?row=year&bin=')).status, 400);

  const evidencePapers = await request<{ total: number }>('/api/stats/evidence?field=year&value=2024');
  assert.equal(evidencePapers.status, 200);
  assert.equal(evidencePapers.body.total, 2);

  const evidenceInsts = await request<{ total: number }>('/api/stats/evidence?view=institutions&entity=institution:I1');
  assert.equal(evidenceInsts.status, 200);
  assert.ok(evidenceInsts.body.total >= 1);

  const emptyEvidencePapers = await request('/api/stats/evidence?field=year&value=1999&view=papers');
  assert.equal(emptyEvidencePapers.status, 200);
  assert.deepEqual(emptyEvidencePapers.body, { total: 0, papers: [] });

  const emptyEvidenceInsts = await request('/api/stats/evidence?field=year&value=1999&view=institutions');
  assert.equal(emptyEvidenceInsts.status, 200);
  assert.deepEqual(emptyEvidenceInsts.body, { total: 0, institutions: [] });

  assert.equal((await request('/api/stats/evidence?page=')).status, 400);
  assert.equal((await request('/api/stats/evidence?field=authors&value=%20')).status, 400);
  assert.equal((await request('/api/stats/evidence?entity=institution:I1:extra')).status, 400);
  assert.equal((await request('/api/stats/evidence?field=year')).status, 400);

  const shortSearch = await request<{ results: unknown[] }>('/api/search/papers?q=a');
  assert.equal(shortSearch.status, 200);
  assert.deepEqual(shortSearch.body.results, []);

  assert.equal((await request('/api/search/papers?q=a&limit=0')).status, 400);
  assert.equal((await request('/api/search/papers?q=a&q=b')).status, 400);
  // Fixture DB does not build paper_index -> 503 UnavailableError cleanly as JSON
  const missingIndex = await request<{ error: unknown }>('/api/search/papers?q=quantum');
  assert.equal(missingIndex.status, 503);
  assert.ok(typeof missingIndex.body.error === 'string');
});

function rawGet(urlPath: string, acceptEncoding: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; raw: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}${urlPath}`, { headers: { 'Accept-Encoding': acceptEncoding } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, raw: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
  });
}

test('compression negotiation, cache headers, and disabled x-powered-by work across cold and warm hits', async () => {
  const plain = await rawGet('/api/entries/institutions?cache_probe=1', 'identity');
  assert.equal(plain.status, 200);
  assert.equal(plain.headers['x-powered-by'], undefined);
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.headers['cache-control'], 'no-cache');
  assert.equal(plain.headers['vary'], 'Accept-Encoding');
  const plainJson = JSON.parse(plain.raw.toString('utf8')) as { entries: unknown[] };
  assert.equal(plainJson.entries.length, 3);

  const gzipped = await rawGet('/api/entries/institutions?cache_probe=1', 'gzip, br');
  assert.equal(gzipped.status, 200);
  assert.equal(gzipped.headers['content-encoding'], 'gzip');
  assert.equal(gzipped.headers['cache-control'], 'no-cache');
  assert.equal(gzipped.headers['vary'], 'Accept-Encoding');
  const gzippedJson = JSON.parse(gunzipSync(gzipped.raw).toString('utf8')) as { entries: unknown[] };
  assert.deepEqual(gzippedJson, plainJson);

  for (const urlPath of ['/api/topics/counts', '/api/stats/chart?row=year', '/api/faculty?inst_id=I1']) {
    const cold = await request(urlPath);
    const warm = await request(urlPath);
    assert.equal(cold.status, 200);
    assert.equal(warm.status, 200);
    assert.equal(cold.headers.get('cache-control'), 'no-cache');
    assert.equal(warm.headers.get('cache-control'), 'no-cache');
    assert.equal(cold.headers.get('x-powered-by'), null);
    assert.deepEqual(warm.body, cold.body, `warm cache hit matches cold response for ${urlPath}`);
  }
});

test('/api/meta reports generated_at matching DB mtime, placeholder authors are suppressed, and dist/client isolates server bundle', async () => {
  const { databaseGeneratedAt } = await import('../../server/services/db');
  const meta = await request<{ generated_at?: string }>('/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.generated_at, databaseGeneratedAt().toISOString());

  // Placeholder author 'P' must be excluded from researcher/institution/paper/network/evidence views.
  const pInsts = await request<{ institutions: unknown[] }>('/api/institutions?author_id=P');
  assert.equal(pInsts.status, 200);
  assert.deepEqual(pInsts.body.institutions, []);

  const pPapers = await request<{ papers: unknown[] }>('/api/papers?author_id=P');
  assert.equal(pPapers.status, 200);
  assert.deepEqual(pPapers.body.papers, []);

  const net = await request<{ edges: Array<{ source: string; target: string }> }>('/api/network', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ view: 'researcher', ids: ['A', 'B', 'C', 'P'] }),
  });
  assert.equal(net.status, 200);
  assert.ok(net.body.edges.every(e => e.source !== 'P' && e.target !== 'P'));

  const pEvidence = await request<{ total: number; papers: unknown[] }>('/api/stats/evidence?entity=researcher:P&field=year&value=2023&view=papers');
  assert.equal(pEvidence.status, 200);
  assert.equal(pEvidence.headers.get('cache-control'), 'no-cache');
  assert.deepEqual(pEvidence.body, { total: 0, papers: [] });

  const yearEvidence = await request('/api/stats/evidence?field=year&value=2024&view=papers');
  assert.equal(yearEvidence.status, 200);
  assert.equal(yearEvidence.headers.get('cache-control'), 'no-cache');

  // Production static isolation: dist/server.cjs & maps live outside dist/client; missing config/assets terminate with 404.
  const distDir = path.join(fixture.tempDir, 'dist');
  const clientDir = path.join(distDir, 'client');
  const configPublicDir = path.join(fixture.tempDir, 'public', 'config');
  fs.mkdirSync(clientDir, { recursive: true });
  fs.mkdirSync(configPublicDir, { recursive: true });
  fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><html><body>SPA_SHELL</body></html>');
  fs.writeFileSync(path.join(distDir, 'server.cjs'), '// SERVER_BUNDLE_SECRET');
  fs.writeFileSync(path.join(distDir, 'server.cjs.map'), '{"mappings":"SERVER_MAP_SECRET"}');
  fs.writeFileSync(path.join(configPublicDir, 'venues.json'), '[]');
  try {
    const venuesRes = await request('/config/venues.json');
    assert.equal(venuesRes.status, 200);
    assert.equal(venuesRes.headers.get('cache-control'), 'no-cache');

    const missingConfig = await request('/config/missing.json');
    assert.equal(missingConfig.status, 404);
    assert.deepEqual(missingConfig.body, { error: 'Not found' });

    const missingAsset = await request<string>('/assets/missing.js');
    assert.equal(missingAsset.status, 404);

    const serverBundle = await request<string>('/server.cjs');
    assert.ok(!String(serverBundle.body).includes('SERVER_BUNDLE_SECRET'));

    const serverMap = await request<string>('/server.cjs.map');
    assert.ok(!String(serverMap.body).includes('SERVER_MAP_SECRET'));
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.rmSync(path.join(fixture.tempDir, 'public', 'config'), { recursive: true, force: true });
  }
});
