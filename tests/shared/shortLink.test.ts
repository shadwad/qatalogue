import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readUrlState, toSearch, URL_DEFAULTS } from '../../src/hooks/urlState';
import { PLATFORMS, SUBTOPICS, TOPICS, VENUES } from '../../shared/linkCodes';
import {
  blankChart, decodeSpec, encodeSpec, FIELD_CODES, FORM_CODES, METRIC_CODES, PANEL_CODES,
} from '../../shared/chart';
import { codeFor, expandSearch, toShortSearch } from '../../shared/shortLink';
import { allLocations, shortName } from '../../shared/locationNames';

const years = { min: 2020, max: 2026 };
const taxonomy: {
  topics: { id: string; subtopics?: { id: string }[] }[];
  platforms: { id: string }[];
} = JSON.parse(readFileSync(new URL('../../data/taxonomy.json', import.meta.url), 'utf8'));
const venues: { name: string }[] = JSON.parse(readFileSync(new URL('../../pipeline/config/scope.json', import.meta.url), 'utf8')).venues; // the source of public/config/venues.json

test('the code tables never repeat an id', () => {
  for (const table of [TOPICS, SUBTOPICS, PLATFORMS, VENUES]) assert.equal(new Set(table).size, table.length);
});

test('every topic, subtopic, platform and venue has a code (run `npm run link-codes` to append new ones)', () => {
  const missing = [
    ...taxonomy.topics.filter(t => !(TOPICS as readonly string[]).includes(t.id)).map(t => t.id),
    ...taxonomy.topics.flatMap(t => (t.subtopics ?? []).map(s => `${t.id}/${s.id}`)).filter(id => !(SUBTOPICS as readonly string[]).includes(id)),
    ...taxonomy.platforms.filter(p => !(PLATFORMS as readonly string[]).includes(p.id)).map(p => p.id),
    ...venues.filter(v => !(VENUES as readonly string[]).includes(v.name)).map(v => v.name),
  ];
  assert.deepEqual(missing, []);
});

test('chart codes are single characters and never repeat within a list', () => {
  for (const codes of [FORM_CODES, FIELD_CODES, METRIC_CODES, PANEL_CODES]) {
    const values = Object.values(codes);
    assert.ok(values.every(code => /^[0-9A-Z]$/.test(code)));
    assert.equal(new Set(values).size, values.length);
  }
});

test('location codes are two capitals, no two share a name, and no name is a different location\'s code', () => {
  const mapping = allLocations();
  assert.ok(Object.keys(mapping).every(iso => /^[A-Z]{2}$/.test(iso)));
  assert.equal(new Set(Object.values(mapping).map(c => c.name)).size, Object.keys(mapping).length, 'two locations share a name');
  // A two-capital value is read as a code, so a name like "UK" must not be another location's code ("US" is its own).
  for (const [code, { name }] of Object.entries(mapping)) if (/^[A-Z]{2}$/.test(name) && name in mapping) assert.equal(name, code);
});

test('codes already shared never change meaning', () => {
  // If this fails, an entry was moved or removed: put it back and append instead.
  assert.equal(codeFor('t', 'information-theory-and-foundations'), '_t0');
  assert.equal(codeFor('v', 'PRX Quantum'), '_v0');
  assert.equal(codeFor('v', 'Physical Review Letters'), '_v1');
});

test('a long link round-trips through the short form', () => {
  const state = {
    ...URL_DEFAULTS, from: years.min, to: years.max, view: 'researcher' as const,
    topics: ['algorithms-and-computation', 'metrology-and-sensing'], platforms: ['photonic'],
    venues: ['Nature', 'Physical Review A'], locations: [shortName('US')!, 'Germany'], q: 'surface code', imin: 2,
  };
  const long = toSearch(state, years);
  const short = toShortSearch(long);
  assert.ok(short.length < long.length);
  assert.ok(!short.includes('topic=') && !short.includes('venue='));
  assert.equal(expandSearch(short), long);
  const withoutIds = (search: string) => ({ ...readUrlState(search), figures: [] }); // figure ids count up per parse
  assert.deepEqual(withoutIds(short), withoutIds(long));
});

test('chart links with picked series round-trip', () => {
  const figure = (series: string[]) => `chart.${encodeSpec({ ...blankChart('bar'), row: 'venue', series })}`;
  for (const series of [['Nature', 'Science'], ['algorithms-and-computation'], ['Nature', 'not-a-known-id']]) {
    const long = `?${new URLSearchParams({ fig: figure(series) })}`;
    const short = toShortSearch(long);
    assert.equal(expandSearch(short), long);
    assert.deepEqual(readUrlState(short).figures.map(f => f.vars), readUrlState(long).figures.map(f => f.vars));
  }
  const all = toShortSearch(`?${new URLSearchParams({ fig: figure(['Nature', 'Science']) })}`);
  assert.ok(all.includes('*_v'), 'known picks are written as codes');
});

test('the topic filter takes canonical slash-qualified subtopic ids too', () => {
  assert.ok(SUBTOPICS[0].includes('/'));
  const long = `?${new URLSearchParams({ topic: SUBTOPICS[0] })}`;
  assert.equal(toShortSearch(long), '?T=_s0');
  assert.equal(expandSearch('?T=_s0'), long);

  const chartLong = `?${new URLSearchParams({
    fig: `chart.${encodeSpec({ ...blankChart('bar'), row: 'year', split: 'subtopic', series: [SUBTOPICS[0], SUBTOPICS[1]] })}`,
  })}`;
  const chartShort = toShortSearch(chartLong);
  assert.ok(chartShort.includes('*_s0*_s1'));
  assert.equal(expandSearch(chartShort), chartLong);
});

test('ids without a code pass through unchanged', () => {
  const long = '?topic=a-topic-added-later&venue=A+New+Journal';
  assert.equal(toShortSearch(long), '?T=a-topic-added-later&V=A+New+Journal');
  assert.equal(expandSearch(toShortSearch(long)), long);
});

test('codes this site does not know are dropped, and the rest of the link still opens', () => {
  assert.equal(expandSearch('?V=_vzz&view=researcher'), '?view=researcher');
  assert.equal(expandSearch('?T=_v1&view=researcher'), '?view=researcher'); // a venue code under the topic key
  assert.deepEqual(readUrlState('?V=_vzz&view=researcher').venues, []);
});

test('links without a short key are left exactly as they were', () => {
  for (const search of ['', '?view=researcher', '?topic=photonic&venue=Nature&sort=score%3Aasc']) assert.equal(expandSearch(search), search);
});

test('locations are written as ISO codes, and unknown ones pass through or drop', () => {
  assert.equal(toShortSearch('?location=US&location=Germany'), '?L=USDE');
  assert.equal(expandSearch('?L=USDE'), '?location=US&location=Germany');
  assert.equal(expandSearch('?L=USZZDE'), '?location=US&location=Germany'); // an unknown code is dropped alone
  assert.equal(toShortSearch('?location=UK&location=Bosnia'), '?L=GBBA'); // CLDR's short names: the codes are GB and BA
  assert.equal(expandSearch('?L=GBBA'), '?location=UK&location=Bosnia');
  assert.equal(toShortSearch('?location=Atlantis'), '?L=Atlantis');
  assert.equal(expandSearch('?L=Atlantis'), '?location=Atlantis');
  assert.equal(expandSearch('?L=ZZ&view=researcher'), '?view=researcher');
  assert.equal(toShortSearch('?location=Atlantis&location=Germany'), '?L=DE&L=Atlantis');
});

test('a chart spec without picked series is shortened and restored', () => {
  for (const form of ['bar', 'line', 'heatmap', 'histogram'] as const) {
    const long = `?${new URLSearchParams({ fig: `chart.${encodeSpec({ ...blankChart(form), row: 'topic', split: 'venue' })}~wide` })}`;
    const short = toShortSearch(long);
    assert.ok(short.length < long.length && !short.includes('venue'));
    assert.equal(expandSearch(short), long);
  }
  assert.equal(expandSearch('?F=chart.Z.1..0.0.1.'), ''); // a form code from a newer site: the chart is dropped
});

test('values of one key share it, in order', () => {
  const long = `?${new URLSearchParams([['topic', TOPICS[0]], ['topic', TOPICS[3]], ['venue', VENUES[2]], ['venue', VENUES[0]]])}`;
  assert.equal(toShortSearch(long), '?T=_t0_t3&V=_v2_v0');
  assert.equal(expandSearch('?T=_t0_t3&V=_v2_v0'), long);
  assert.equal(expandSearch('?T=_t0_tzz_t3'), `?${new URLSearchParams([['topic', TOPICS[0]], ['topic', TOPICS[3]]])}`);
  assert.equal(expandSearch('?V=_t0'), ''); // a topic code under the venue key
});

test('years and sort are one parameter each', () => {
  assert.equal(toShortSearch('?from=2020&to=2026'), '?Y=2020-2026');
  assert.equal(toShortSearch('?from=2020'), '?Y=2020-');
  assert.equal(toShortSearch('?to=2024'), '?Y=-2024');
  assert.equal(expandSearch('?Y=2020-2026'), '?from=2020&to=2026');
  assert.equal(expandSearch('?Y=-2024'), '?to=2024');
  assert.equal(expandSearch('?Y=garbage&view=researcher'), '?view=researcher');
  assert.equal(toShortSearch('?sort=score%3Aasc'), '?S=score.asc');
  assert.equal(expandSearch('?S=score.asc'), '?sort=score%3Aasc');
  assert.equal(expandSearch('?S=nonsense'), '');
  const state = { ...URL_DEFAULTS, from: years.min, to: years.max, view: 'researcher' as const, sort: { column: 'institution' as const, direction: 'asc' as const } };
  const long = toSearch({ ...state, from: 2021 }, years);
  assert.deepEqual(readUrlState(toShortSearch(long)).sort, state.sort);
  assert.equal(readUrlState(toShortSearch(long)).from, 2021);
});

test('chart specs with reference baseline, independent panels, or empty series round-trip', () => {
  for (const overrides of [
    { row: 'year' as const, split: 'topic' as const, value: 'rowShare' as const, reference: true },
    { row: 'year' as const, split: 'topic' as const, panels: 'independent' as const },
    { row: 'venue' as const, series: [] as string[] },
  ]) {
    const long = `?${new URLSearchParams({ fig: `chart.${encodeSpec({ ...blankChart('line'), ...overrides })}` })}`;
    const short = toShortSearch(long);
    assert.equal(expandSearch(short), long);
    assert.deepEqual(readUrlState(short).figures.map(f => f.vars), readUrlState(long).figures.map(f => f.vars));
  }
});

test('decodeSpec rejects non-canonical bin widths with whitespace or leading zeros', () => {
  for (const badBin of [' 1 ', '01', '3', '']) {
    assert.equal(decodeSpec(['bar', 'year', '', 'papers', 'authors', badBin, '']), null);
  }
  assert.ok(decodeSpec(['bar', 'year', '', 'papers', 'authors', '2', '']) !== null);
});
