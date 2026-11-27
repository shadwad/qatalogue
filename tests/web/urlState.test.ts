import assert from 'node:assert/strict';
import test from 'node:test';
import { readUrlState, toSearch } from '../../src/hooks/urlState';

const years = { min: 2020, max: 2026 };

test('links without a model use the attribution default for their focus', () => {
  for (const [search, metric] of [['', 'adj_frac_count'], ['?view=researcher', 'frac_count']] as const) {
    const state = readUrlState(search);
    assert.equal(state.metric, metric);
    assert.equal(toSearch({ ...state, from: years.min, to: years.max }, years), search);
  }
});

test('shared links keep explicit models, including None', () => {
  for (const search of ['?metric=none', '?metric=frac_count', '?view=researcher&metric=total_count', '?display=network&metric=none']) {
    const state = readUrlState(search);
    assert.equal(state.metric, new URLSearchParams(search).get('metric'));
    assert.equal(toSearch({ ...state, from: years.min, to: years.max }, years), search);
  }
  assert.equal(readUrlState('?view=researcher&metric=adj_frac_count').metric, 'frac_count');
  assert.equal(readUrlState('?metric=invalid').metric, 'adj_frac_count');
});

test('list sort defaults to descending count or alphabetical for None', () => {
  for (const search of ['', '?view=researcher', '?metric=total_count']) {
    assert.deepEqual(readUrlState(search).sort, { column: 'score', direction: 'desc' });
  }
  assert.deepEqual(readUrlState('?metric=none').sort, { column: 'institution', direction: 'asc' });
  assert.deepEqual(readUrlState('?metric=none&sort=score:asc').sort, { column: 'institution', direction: 'asc' });
});

test('shared lists keep explicit sorts for columns available under their model', () => {
  for (const [search, column, direction] of [
    ['?sort=score%3Aasc', 'score', 'asc'],
    ['?sort=institution%3Aasc', 'institution', 'asc'],
    ['?metric=none&sort=secondary%3Adesc', 'secondary', 'desc'],
  ] as const) {
    const state = readUrlState(search);
    assert.deepEqual(state.sort, { column, direction });
    assert.equal(toSearch({ ...state, from: years.min, to: years.max }, years), search);
  }
});

test('charts links omit explore-only parameters and default paper search scope', () => {
  const state = readUrlState('?section=charts&fig=trends.region.share&view=researcher&display=network&k=50&metric=none&imin=1&inst=2&avg=3&sort=institution:asc&q=spin');
  assert.equal(state.section, 'statistics');
  assert.equal(state.scope, 'papers');
  assert.equal(toSearch({ ...state, from: years.min, to: years.max }, years), '?section=charts&fig=chart.line.year.region.rowShare.authors.1.shared&q=spin');
});

test('metric=none zeroes hidden thresholds, NaN years stay omitted, and network k respects view caps', () => {
  const none = readUrlState('?metric=none&imin=2&inst=3&avg=1');
  assert.equal(none.imin, 0);
  assert.equal(none.inst, 0);
  assert.equal(none.avg, 0);
  assert.equal(toSearch({ ...none, imin: 5, inst: 5, avg: 5, from: NaN, to: NaN }, years), '?metric=none');

  const instNet = { ...readUrlState('?display=network&k=500'), from: years.min, to: years.max };
  assert.equal(toSearch(instNet, years), '?display=network');
  assert.equal(toSearch({ ...instNet, k: 499 }, years), '?display=network&k=499');

  const resNet = { ...readUrlState('?view=researcher&display=network&k=1000'), from: years.min, to: years.max };
  assert.equal(toSearch(resNet, years), '?view=researcher&display=network');
  assert.equal(toSearch({ ...resNet, k: 500 }, years), '?view=researcher&display=network&k=500');
});
