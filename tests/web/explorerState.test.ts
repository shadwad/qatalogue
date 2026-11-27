import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeLocationCounts,
  entryId,
  entryName,
  entrySecondary,
  filterAndSortEntries,
  filterByLocations,
  filterThresholdedEntries,
  filterValues,
  matchesSearch,
  selectNetworkEntries,
  thresholdCaps,
} from '../../src/hooks/explorerFiltering';
import {
  BoundedCache,
  buildDetailUrl,
  detailCache,
  detailFilterSignature,
  getAuthorLink,
  getInstitutionLink,
  paperMetricScore,
  syncDetailCacheGeneration,
  type DetailFilterParams,
} from '../../src/components/Rows/utils';
import type { InstitutionEntry, ResearcherEntry } from '../../src/types';

const inst = (overrides: Partial<InstitutionEntry> = {}): InstitutionEntry => ({
  institution_id: 'I1',
  institution_name: 'Alpha Institute',
  location_code: 'US',
  ror: null,
  openalex_id: 'I1',
  total_fractional_score: 10,
  core_faculty_count: 5,
  paper_count: 12,
  location: 'US',
  region: 'North America',
  ...overrides,
});

const res = (overrides: Partial<ResearcherEntry> = {}): ResearcherEntry => ({
  type: 'researcher',
  author_id: 'A1',
  author_name: 'Alice Smith',
  orcid: null,
  openalex_id: 'A1',
  total_fractional_score: 2.5,
  paper_count: 4,
  max_year: 2024,
  latest_affiliation: 'Alpha Institute',
  location_code: 'US',
  location: 'US',
  region: 'North America',
  ...overrides,
});

test('entry accessors, search matching, filterValues, and thresholdCaps handle institutions and researchers', () => {
  const i = inst({ institution_id: 'I42', institution_name: 'Beta Lab', location: 'Germany', region: 'Europe' });
  const r = res({ author_id: 'A99', author_name: 'Bob Jones', latest_affiliation: 'ETH Zurich', location: 'Switzerland', region: 'Europe' });

  assert.equal(entryId(i), 'I42');
  assert.equal(entryName(i), 'Beta Lab');
  assert.equal(entrySecondary(i), 'Germany');
  assert.equal(entryId(r), 'A99');
  assert.equal(entryName(r), 'Bob Jones');
  assert.equal(entrySecondary(r), 'ETH Zurich');

  assert.equal(matchesSearch(i, 'beta'), true);
  assert.equal(matchesSearch(i, 'germany'), true);
  assert.equal(matchesSearch(i, 'zurich'), false);
  assert.equal(matchesSearch(r, 'zurich'), true);
  assert.equal(matchesSearch(r, 'switz'), true);
  assert.equal(matchesSearch(r, ''), true);

  assert.deepEqual(filterValues(['b', 'a'], 'any'), ['a', 'b']);
  assert.deepEqual(filterValues(['b', 'a'], 'all'), ['a+b']);
  assert.deepEqual(filterValues(['a'], 'all'), ['a']);

  assert.deepEqual(thresholdCaps('institution', 'adj_frac_count'), {
    indvMax: 2.0, indvStep: 0.05, instMax: 30.0, instStep: 1.0, avgMax: 2.5, avgStep: 0.05,
  });
  assert.deepEqual(thresholdCaps('institution', 'frac_count'), {
    indvMax: 3.0, indvStep: 0.1, instMax: 45.0, instStep: 1.0, avgMax: 3.5, avgStep: 0.1,
  });
  assert.deepEqual(thresholdCaps('researcher', 'total_count'), {
    indvMax: 10.0, indvStep: 1.0, instMax: 30.0, instStep: 1.0, avgMax: 2.5, avgStep: 0.05,
  });
});

test('filterThresholdedEntries enforces thresholds including zero-faculty average guard and 9-decimal rounding', () => {
  const list = [
    inst({ institution_id: 'I1', institution_name: 'Pass All', total_fractional_score: 0.9999999999, core_faculty_count: 2 }),
    inst({ institution_id: 'I2', institution_name: 'No Named Faculty', total_fractional_score: 5, core_faculty_count: 0 }),
    inst({ institution_id: 'I3', institution_name: '   ', total_fractional_score: 20, core_faculty_count: 4 }),
    inst({ institution_id: 'I4', institution_name: 'Low Avg', total_fractional_score: 1, core_faculty_count: 10 }),
  ];

  const instOut = filterThresholdedEntries(list, {
    viewMode: 'institution',
    facultyMinContribution: 0,
    institutionMinContribution: 1,
    avgContributionMin: 0.5,
  });
  assert.deepEqual(instOut.map(entryId), ['I1']);

  // core_faculty_count === 0 is excluded whenever average threshold > 0
  const avgOnly = filterThresholdedEntries(list, {
    viewMode: 'institution',
    facultyMinContribution: 0,
    institutionMinContribution: 0,
    avgContributionMin: 0.1,
  });
  assert.deepEqual(avgOnly.map(entryId), ['I1', 'I4']);

  const rList = [
    res({ author_id: 'A1', total_fractional_score: 0.4999999999 }),
    res({ author_id: 'A2', total_fractional_score: 0.49 }),
  ];
  assert.deepEqual(
    filterThresholdedEntries(rList, {
      viewMode: 'researcher',
      facultyMinContribution: 0.5,
      institutionMinContribution: 0,
      avgContributionMin: 0,
    }).map(entryId),
    ['A1'],
  );
});

test('filterByLocations, computeLocationCounts, filterAndSortEntries, and selectNetworkEntries work deterministically', () => {
  const items = [
    inst({ institution_id: 'I1', institution_name: 'Zeta', total_fractional_score: 5, location: 'Germany', region: 'Europe' }),
    inst({ institution_id: 'I2', institution_name: 'Alpha', total_fractional_score: 5, location: 'US', region: 'North America' }),
    inst({ institution_id: 'I3', institution_name: 'Beta', total_fractional_score: 8, location: '', region: '' }),
  ];

  assert.deepEqual(computeLocationCounts(items), {
    locations: { Germany: 1, US: 1, Unknown: 1 },
    regions: { Europe: 1, 'North America': 1, Global: 1 },
  });
  assert.deepEqual(filterByLocations(items, ['Unknown']).map(entryId), ['I3']);
  assert.deepEqual(filterByLocations(items, []).length, 3);

  // Score ties break alphabetically ascending regardless of direction
  assert.deepEqual(filterAndSortEntries(items, '', { column: 'score', direction: 'desc' }).map(entryId), ['I3', 'I2', 'I1']);
  assert.deepEqual(filterAndSortEntries(items, '', { column: 'institution', direction: 'asc' }).map(entryId), ['I2', 'I3', 'I1']);
  assert.deepEqual(selectNetworkEntries(items, 2).map(entryId), ['I3', 'I1']);
});

test('BoundedCache evicts LRU entries and expires by TTL, and syncDetailCacheGeneration resets on new builds', () => {
  const cache = new BoundedCache<number>(2, 60_000);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1); // promotes 'a' so 'b' is least recently used
  cache.set('c', 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);

  // TTL expiry
  const shortCache = new BoundedCache<string>(4, 50);
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    shortCache.set('k', 'v');
    assert.equal(shortCache.get('k'), 'v');
    now += 60;
    assert.equal(shortCache.get('k'), undefined);
    assert.equal(shortCache.size, 0);
  } finally {
    Date.now = originalNow;
  }

  detailCache.clear();
  syncDetailCacheGeneration('2026-01-01T00:00:00Z');
  detailCache.set('u1', { ok: true });
  syncDetailCacheGeneration('2026-01-01T00:00:00Z');
  assert.deepEqual(detailCache.get('u1'), { ok: true });
  syncDetailCacheGeneration(undefined);
  assert.deepEqual(detailCache.get('u1'), { ok: true });
  syncDetailCacheGeneration('2026-01-02T00:00:00Z');
  assert.equal(detailCache.size, 0);
});

test('Row helpers build canonical URLs, signatures, profile links, and paper scores', () => {
  const filters: DetailFilterParams = {
    metricMode: 'frac_count',
    startYear: 2020,
    endYear: 2024,
    facultyMinContribution: 0.5,
    topicFilter: ['t1'],
    platformFilter: ['p1'],
    selectedVenues: ['Venue B', 'Venue A'],
    selectedLocations: ['US', 'DE'],
    paperQuery: 'spin',
  };

  const withLoc = buildDetailUrl('/api/faculty', { inst_id: 'I1' }, filters, true, 'http://example.test');
  const withoutLoc = buildDetailUrl('/api/institutions', { author_id: 'A1' }, filters, false, 'http://example.test');

  assert.deepEqual(withLoc.searchParams.getAll('location'), ['DE', 'US']);
  assert.deepEqual(withLoc.searchParams.getAll('venue'), ['Venue A', 'Venue B']);
  assert.equal(withLoc.searchParams.get('inst_id'), 'I1');
  assert.deepEqual(withoutLoc.searchParams.getAll('location'), []);
  assert.equal(withoutLoc.searchParams.get('author_id'), 'A1');
  // Only the faculty route thresholds by contribution; the others ignore thresholds, so they are not sent.
  assert.equal(withLoc.searchParams.get('individual_threshold'), '0.5');
  assert.equal(withoutLoc.searchParams.has('individual_threshold'), false);
  assert.equal(withLoc.searchParams.has('institutional_threshold'), false);
  assert.equal(withLoc.searchParams.has('average_threshold'), false);

  const changedThreshold = { ...filters, facultyMinContribution: 0.9 };
  assert.notEqual(detailFilterSignature(filters, true), detailFilterSignature(changedThreshold, true));
  assert.equal(detailFilterSignature(filters, false), detailFilterSignature(changedThreshold, false));

  const changedLoc = { ...filters, selectedLocations: ['FR'] };
  assert.notEqual(detailFilterSignature(filters, true), detailFilterSignature(changedLoc, true));
  assert.equal(detailFilterSignature(filters, false), detailFilterSignature(changedLoc, false));

  assert.equal(getInstitutionLink({ ror: '0123', institution_id: 'I1' }), 'https://ror.org/0123');
  assert.equal(getInstitutionLink({ ror: null, openalex_id: null, institution_id: 'NO_INST_1' }), null);
  assert.equal(getInstitutionLink({ ror: null, openalex_id: null, institution_id: 'I42' }), 'https://openalex.org/I42');

  assert.equal(getAuthorLink({ orcid: '0000-0001', author_id: 'A1' }), 'https://orcid.org/0000-0001');
  assert.equal(getAuthorLink({ orcid: null, openalex_id: 'NO_ID_1', author_id: 'NO_ID_1' }), null);
  assert.equal(getAuthorLink({ orcid: null, openalex_id: null, author_id: 'A77' }), 'https://openalex.org/A77');

  const samplePaper = { paper_id: 'W1', title: 'T', year: 2024, venue_name: 'V', score_share: 0.25, canonical_author_count: 2 };
  assert.equal(paperMetricScore(samplePaper, 'adj_frac_count'), 0.25);
  assert.equal(paperMetricScore(samplePaper, 'frac_count'), 0.5);
  assert.equal(paperMetricScore(samplePaper, 'total_count'), 1);
});

test('filterAndSortEntries and selectNetworkEntries round scores to 9 decimals before ordering', () => {
  const alpha = inst({ institution_id: 'I1', institution_name: 'Alpha Institute', total_fractional_score: 10 });
  const zetaNoise = inst({ institution_id: 'I2', institution_name: 'Zeta Institute', total_fractional_score: 10 + 1e-11 });
  const zetaSig = inst({ institution_id: 'I3', institution_name: 'Zeta Institute', total_fractional_score: 10 + 1e-8 });

  // Sub-1e-9 float noise ties and falls back to alphabetical name order rather than flipping rank.
  assert.deepEqual(
    filterAndSortEntries([zetaNoise, alpha], '', { column: 'score', direction: 'desc' }).map(entryId),
    ['I1', 'I2'],
  );
  assert.deepEqual(
    filterAndSortEntries([alpha, zetaSig], '', { column: 'score', direction: 'desc' }).map(entryId),
    ['I3', 'I1'],
  );

  // Top-k selection keeps server tie order when difference is below 1e-9, and promotes >= 1e-8 deltas.
  assert.deepEqual(selectNetworkEntries([alpha, zetaNoise], 1).map(entryId), ['I1']);
  assert.deepEqual(selectNetworkEntries([alpha, zetaSig], 1).map(entryId), ['I3']);
});
