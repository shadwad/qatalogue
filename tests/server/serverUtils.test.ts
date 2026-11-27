import '../helpers/locationsFixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

test('buildFtsQuery escapes special tokens, strips NUL bytes, and never fails FTS5', async () => {
  const { buildFtsQuery } = await import('../../server/services/utils');
  const db = new Database(':memory:');
  db.exec(`
    CREATE VIRTUAL TABLE inst_fts USING fts5(name);
    INSERT INTO inst_fts VALUES ('MIT Quantum Lab'), ('O"Brien Institute'), ('AT&T Labs'), ('C++ Group');
  `);

  for (const blank of ['', '   ', '\0', '  \0  ', null, undefined, ['mit'], { q: 'mit' }]) {
    assert.equal(buildFtsQuery(blank), '', `expected blank query for ${JSON.stringify(blank)}`);
  }

  const queries = [
    'mit',
    'quantum lab',
    '"',
    '"""',
    'O"Brien',
    'AND',
    'OR',
    'NOT',
    'NEAR',
    'name:MIT',
    '^MIT',
    'C++',
    'AT&T',
    '()',
    '***',
    '---',
    'foo\0bar',
    'mit\0 "lab"',
  ];

  for (const raw of queries) {
    const fts = buildFtsQuery(raw);
    assert.ok(fts.length > 0, `expected non-empty FTS query for ${JSON.stringify(raw)}`);
    assert.ok(!fts.includes('\0'), 'NUL bytes must be stripped');
    assert.doesNotThrow(() => db.prepare('SELECT name FROM inst_fts WHERE inst_fts MATCH ?').all(fts));
  }

  const obrien = db.prepare('SELECT name FROM inst_fts WHERE inst_fts MATCH ?').all(buildFtsQuery('O"Brien')) as { name: string }[];
  assert.deepEqual(obrien.map(r => r.name), ['O"Brien Institute']);
  const cpp = db.prepare('SELECT name FROM inst_fts WHERE inst_fts MATCH ?').all(buildFtsQuery('C++')) as { name: string }[];
  assert.deepEqual(cpp.map(r => r.name), ['C++ Group']);
  db.close();
});

test('query parsers reject blank strings, arrays, objects, booleans, NULs, and out-of-range inputs', async () => {
  const {
    InputError,
    queryId,
    queryNumber,
    queryText,
    queryThreshold,
    readLocationList,
    readPaperQuery,
    readStringList,
  } = await import('../../server/services/utils');

  assert.equal(queryNumber(undefined, 'limit', 1, 10), undefined);
  assert.equal(queryNumber('5', 'limit', 1, 10), 5);
  assert.equal(queryNumber(5, 'limit', 1, 10), 5);
  for (const bad of ['', '   ', '1.5', 'abc', '0', '11', true, false, null, ['5'], { a: 1 }]) {
    assert.throws(() => queryNumber(bad, 'limit', 1, 10), InputError, `queryNumber(${JSON.stringify(bad)})`);
  }

  assert.equal(queryThreshold(undefined, 't'), undefined);
  assert.equal(queryThreshold('0.25', 't'), 0.25);
  for (const bad of ['', '   ', '-0.1', 'NaN', 'Infinity', true, null, ['1'], {}]) {
    assert.throws(() => queryThreshold(bad, 't'), InputError, `queryThreshold(${JSON.stringify(bad)})`);
  }

  assert.equal(queryId(undefined, 'inst_id'), undefined);
  assert.equal(queryId('   ', 'inst_id'), undefined);
  assert.equal(queryId(' I1\0 ', 'inst_id', true), 'I1');
  assert.throws(() => queryId(undefined, 'inst_id', true), InputError);
  assert.throws(() => queryId('   ', 'inst_id', true), InputError);
  assert.throws(() => queryId(['I1', 'I2'], 'inst_id', true), InputError);
  assert.throws(() => queryId({ a: 'I1' }, 'inst_id', true), InputError);
  assert.throws(() => queryId('x'.repeat(201), 'inst_id', true), InputError);

  assert.equal(queryText('  hello\0world  ', 'q', 8), 'hellowor');
  assert.equal(queryText('   \0   ', 'q'), undefined);
  assert.throws(() => queryText(['a', 'b'], 'q'), InputError);

  assert.equal(readPaperQuery('a'), undefined);
  assert.equal(readPaperQuery('   a\0  '), undefined);
  assert.equal(readPaperQuery('  quantum\0error  '), 'quantumerror');
  assert.throws(() => readPaperQuery(['quantum', 'optics']), InputError);

  assert.deepEqual(readStringList('a, b, ,c'), ['a', 'b', 'c']);
  assert.deepEqual(readStringList(['a', 'b,c']), ['a', 'b', 'c']);
  assert.throws(() => readStringList({ nested: 'a' }), InputError);
  assert.throws(() => readStringList(['a', { bad: 'b' }]), InputError);
  assert.throws(() => readLocationList({ nested: 'US' }), InputError);
});

test('addFactDimensionFilters handles plain, compound, and degenerate "+" filters without SQL errors', async () => {
  const { addFactDimensionFilters } = await import('../../server/services/utils');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE facts (paper_id TEXT, venue_id TEXT);
    CREATE TABLE paper_topics (paper_id TEXT, topic_id TEXT);
    CREATE TABLE paper_platforms (paper_id TEXT, platform_id TEXT);
    INSERT INTO facts VALUES ('p1', 'v1'), ('p2', 'v1');
    INSERT INTO paper_topics VALUES ('p1', 't1'), ('p1', 't2'), ('p2', 't1');
    INSERT INTO paper_platforms VALUES ('p1', 'superconducting');
  `);

  const run = (topics: string[], venues: string[] = [], platforms: string[] = []) => {
    const params: unknown[] = [];
    const sql = addFactDimensionFilters('SELECT paper_id FROM facts f WHERE 1=1', params, topics, venues, 'f', platforms);
    return (db.prepare(`${sql} ORDER BY paper_id`).all(...params) as { paper_id: string }[]).map(r => r.paper_id);
  };

  assert.deepEqual(run(['t1+t2']), ['p1']);
  assert.deepEqual(run(['+']), []);
  assert.deepEqual(run(['+++'], [], [' + ']), []);
  assert.deepEqual(run(['+', 't1']), ['p1', 'p2']);
  assert.equal(
    addFactDimensionFilters('SELECT paper_id FROM facts f WHERE 1=1', [], [], [], 'f', ['superconducting'], false),
    'SELECT paper_id FROM facts f WHERE 1=1 AND 1 = 0',
  );
  db.close();
});
