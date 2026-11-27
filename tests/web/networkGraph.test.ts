import assert from 'node:assert/strict';
import test from 'node:test';
import { analyseGraph, type NetworkEdge } from '../../src/components/Network/graph';

/** Builds the analysis from [source, target, weight] ties. */
function linkedPairs(ties: [string, string, number][]) {
  const ids = [...new Set(ties.flatMap(([a, b]) => [a, b]))];
  const edges: NetworkEdge[] = ties.map(([source, target, weight]) => ({ source, target, papers: 1, weight }));
  return analyseGraph(ids, edges, new Map()).linkedPairs;
}

test('a node gets the pair when it is the only link between two collaborators', () => {
  const of = linkedPairs([['P', 'X', 2], ['P', 'Y', 1]]);
  assert.deepEqual(of('P'), { pairs: 1, share: 1 });
});

test('a link through a node is as strong as its weaker tie', () => {
  // The link through P is 1, so a direct tie of 0.5 loses to it and one of 1.5 beats it.
  assert.equal(linkedPairs([['P', 'X', 4], ['P', 'Y', 1], ['X', 'Y', 0.5]])('P')!.share, 1);
  assert.equal(linkedPairs([['P', 'X', 4], ['P', 'Y', 1], ['X', 'Y', 1.5]])('P')!.share, 0);
});

test('another shared partner with a stronger link takes the pair', () => {
  const of = linkedPairs([['P', 'X', 1], ['P', 'Y', 1], ['Z', 'X', 2], ['Z', 'Y', 3]]);
  // Pairs among P's collaborators: X–Y, which Z links at 2. Z's collaborators are X and Y too, so Z gets it.
  assert.equal(of('P')!.share, 0);
  assert.equal(of('Z')!.share, 1);
});

test('links that tie for strongest split the pair', () => {
  assert.equal(linkedPairs([['P', 'X', 1], ['P', 'Y', 1], ['X', 'Y', 1]])('P')!.share, 0.5);
  assert.equal(linkedPairs([['P', 'X', 1], ['P', 'Y', 2], ['Z', 'X', 1], ['Z', 'Y', 1]])('P')!.share, 0.5);
  // A direct tie and another partner both tie with P: a third each.
  assert.ok(Math.abs(linkedPairs([['P', 'X', 1], ['P', 'Y', 1], ['X', 'Y', 1], ['Z', 'X', 1], ['Z', 'Y', 1]])('P')!.share - 1 / 3) < 1e-12);
});

test('the share counts every pair among the collaborators', () => {
  // P links X–Y and X–W; Y and W publish together more strongly than through P.
  const of = linkedPairs([['P', 'X', 1], ['P', 'Y', 1], ['P', 'W', 1], ['Y', 'W', 2]]);
  const result = of('P')!;
  assert.equal(result.pairs, 3);
  assert.ok(Math.abs(result.share - 2 / 3) < 1e-12);
});

test('fewer than two collaborators has no pairs', () => {
  const of = linkedPairs([['P', 'X', 1]]);
  assert.equal(of('P'), null);
});
