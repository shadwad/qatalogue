import assert from 'node:assert/strict';
import test from 'node:test';
import { geoIdentity } from 'd3-geo';
import { analyseGraph } from '../../src/components/Network/graph';
import {
  focusedRegions,
  loadLand,
  loadRegionsLand,
  loadRegionsOutline,
  outsideRegionViews,
  regionsOfLocations,
} from '../../src/components/Network/regions';
import { buildNetworkLinks, buildNetworkNodes } from '../../src/components/Network/simulation';
import {
  easeInOutCubic,
  keyLinkLine,
  mapNodeRadius,
  sharePercent,
  type GeoPosition,
  type SimNode,
} from '../../src/components/Network/types';
import type { InstitutionEntry } from '../../src/types';

const inst = (id: string, score: number): InstitutionEntry => ({
  institution_id: id,
  institution_name: `Inst ${id}`,
  location_code: 'US',
  ror: null,
  openalex_id: id,
  total_fractional_score: score,
  core_faculty_count: 1,
  paper_count: 1,
  location: 'US',
  region: 'North America',
});

test('network formatting and math helpers behave accurately across edge values', () => {
  assert.equal(sharePercent(0), '0%');
  assert.equal(sharePercent(1), '100%');
  assert.equal(sharePercent(1 - 1e-10), '100%');
  assert.equal(sharePercent(0.0005), '<0.1%');
  assert.equal(sharePercent(0.051), '5.1%');
  assert.equal(sharePercent(0.62), '62%');

  assert.equal(keyLinkLine(0, null), 'No pairs to link, 0 collaborators in view');
  assert.equal(keyLinkLine(1, null), 'No pairs to link, 1 collaborator in view');
  assert.equal(keyLinkLine(3, { pairs: 3, share: 0.333 }), 'Strongest link for 33% of pairs among its 3 collaborators in view');

  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(1), 1);

  assert.ok(mapNodeRadius(10, 4, 1) < mapNodeRadius(10, 1, 1));
});

test('buildNetworkNodes and buildNetworkLinks place geo nodes, preserve positions, and filter unplaced map links', () => {
  const entries = [inst('I1', 100), inst('I2', 25), inst('I3', 10)];
  const analysis = analyseGraph(
    ['I1', 'I2', 'I3'],
    [
      { source: 'I1', target: 'I2', papers: 5, weight: 4 },
      { source: 'I1', target: 'I3', papers: 2, weight: 2 },
    ],
    new Map(),
  );
  const positions: Record<string, GeoPosition> = {
    I1: [42, -71, 'city', 'Cambridge'],
    I2: [52, 13, 'city', 'Berlin'],
    // I3 unplaced
  };
  const proj = geoIdentity();
  const prevNodes = new Map<string, SimNode>([
    ['I1', { id: 'I1', entry: entries[0], r: 1, x: 999, y: 888 }],
  ]);

  const nodes = buildNetworkNodes({
    entries,
    prevNodes,
    positions,
    projection: proj,
    layout: 'map',
    analysis,
    isFresh: false,
  });

  // I1 preserves existing x/y, gets projected gx/gy and scaled r = 16
  assert.equal(nodes.get('I1')!.x, 999);
  assert.equal(nodes.get('I1')!.gx, -71);
  assert.equal(nodes.get('I1')!.gy, 42);
  assert.equal(nodes.get('I1')!.unplaced, false);
  assert.equal(nodes.get('I1')!.r, 16);

  // I2 is placed on map at projected anchor; I3 is marked unplaced
  assert.equal(nodes.get('I2')!.unplaced, false);
  assert.equal(nodes.get('I2')!.x, 13);
  assert.equal(nodes.get('I2')!.y, 52);
  assert.equal(nodes.get('I3')!.unplaced, true);

  // Map links drop edges touching unplaced nodes; Force links keep them
  const mapLinks = buildNetworkLinks(analysis, nodes, 'map');
  assert.equal(mapLinks.length, 1);
  assert.equal(mapLinks[0].edge.source, 'I1');
  assert.equal(mapLinks[0].edge.target, 'I2');

  const forceLinks = buildNetworkLinks(analysis, nodes, 'force');
  assert.equal(forceLinks.length, 2);
});

test('region focus helpers resolve selected regions and out-of-frame points accurately', () => {
  const mapping = {
    US: { name: 'US', region: 'North America' },
    DE: { name: 'Germany', region: 'Europe' },
    FR: { name: 'France', region: 'Europe' },
    JP: { name: 'Japan', region: 'Asia' },
    AU: { name: 'Australia', region: 'Oceania' },
    AQ: { name: 'Antarctica', region: '' },
  };
  assert.deepEqual(focusedRegions([], mapping), []);
  assert.deepEqual(focusedRegions(['Germany', 'France', 'US'], mapping), ['Europe', 'North America']);
  assert.deepEqual(focusedRegions(['Germany', 'US', 'Japan', 'Australia'], mapping), []);
  assert.deepEqual(focusedRegions(['Antarctica'], mapping), []);
  assert.deepEqual(regionsOfLocations(['Antarctica', 'Germany', 'France'], mapping), ['Europe']);
  assert.equal(outsideRegionViews(['Europe'], [13, 52]), false);
  assert.equal(outsideRegionViews(['Europe'], [-71, 42]), true);
});

test('shared atlas loader serves world land and region geometry from countries-50m.json', async () => {
  const land = await loadLand() as { type?: string; features?: unknown[] };
  assert.equal(land.type, 'FeatureCollection');
  assert.ok(Array.isArray(land.features) && land.features.length === 1);

  const [outline, europe] = await Promise.all([
    loadRegionsOutline(['Europe']),
    loadRegionsLand(['Europe']),
  ]);
  assert.ok(outline.length > 50, `expected Europe outline coordinates, got ${outline.length}`);
  assert.equal(europe.type, 'MultiPolygon');
  assert.ok(europe.coordinates.length > 5);
});
