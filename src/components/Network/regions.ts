/**
 * Region focus for the Map layout: when the location filter selects locations, the map is reprojected and framed around
 * their regions, with the rest of the world still drawn as context.
 */
import { geoArea, geoDistance, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import { geoRobinson } from 'd3-geo-projection';
import { feature, merge, neighbors } from 'topojson-client';
import type { GeometryCollection, MultiPolygon, Polygon, Topology } from 'topojson-specification';
import { regionOf as regionOfCode } from '../../../shared/locationNames';
import type { LocationMapping } from '../../types';

type LonLat = [number, number];

/** What each region's map frames: [west, south, east, north] in degrees. Land outside it may still be drawn. */
const REGION_VIEWS: Record<string, [number, number, number, number]> = {
  Africa: [-20, -36, 60, 38],
  Asia: [25, -11, 150, 55],
  Europe: [-25, 34, 55, 71], // Frame western extent for the Europe view
  Oceania: [110, -48, 180, -5],
  'North America': [-170, 7, -50, 72],
  'South America': [-82, -56, -34, 13],
};
const ALL_REGIONS = Object.keys(REGION_VIEWS);
const MAX_FOCUSED_REGIONS = 3; // more than this is close to the whole world, which the world map shows better

/** The regions to focus for the selected locations; [] means show the whole world. */
export function focusedRegions(selectedLocations: readonly string[], locationMapping: LocationMapping): string[] {
  if (selectedLocations.length === 0) return [];
  const regionOf = new Map(Object.values(locationMapping).map(c => [c.name, c.region]));
  const regions = [...new Set(selectedLocations.map(c => regionOf.get(c) ?? ''))];
  if (regions.some(r => !ALL_REGIONS.includes(r)) || regions.length > MAX_FOCUSED_REGIONS) return [];
  return regions.sort();
}

/** The middle of the shortest stretch of longitude holding every point, so a span across the 180° line stays whole. */
function centralLongitude(points: LonLat[]) {
  const lons = points.map(p => ((p[0] + 540) % 360) - 180).sort((x, y) => x - y);
  let gapEnd = 0, widest = lons[0] + 360 - lons[lons.length - 1];
  for (let i = 1; i < lons.length; i++) {
    if (lons[i] - lons[i - 1] > widest) { widest = lons[i] - lons[i - 1]; gapEnd = i; }
  }
  const start = lons[gapEnd];
  return start + (360 - widest) / 2;
}

/**
 * The world map's Robinson, re-centred on the regions' longitude (north stays up) and framed on their views plus
 * `selection`: whatever is selected must be in view, even if it lies outside its region's usual frame.
 */
export function regionProjection(regions: string[], extent: [[number, number], [number, number]], selection: LonLat[] = []): GeoProjection {
  const frame: LonLat[] = [...selection];
  for (const region of regions) {
    const [w, s, e, n] = REGION_VIEWS[region];
    for (let i = 0; i <= 8; i++) {
      const lon = w + ((e - w) * i) / 8;
      const lat = s + ((n - s) * i) / 8;
      frame.push([lon, s], [lon, n], [w, lat], [e, lat]);
    }
  }
  return geoRobinson().rotate([-centralLongitude(frame), 0]).fitExtent(extent, { type: 'MultiPoint', coordinates: frame });
}

/** Whether a point lies outside the given regions' usual frames (and so has to widen the map). */
export function outsideRegionViews(regions: string[], [lon, lat]: LonLat) {
  return !regions.some(region => {
    const [w, s, e, n] = REGION_VIEWS[region];
    return lon >= w && lon <= e && lat >= s && lat <= n;
  });
}

type CountryProps = { name?: string };
type CountryGeometry = Polygon<CountryProps> | MultiPolygon<CountryProps>;
type WorldAtlasTopology = Topology<{
  countries: GeometryCollection<CountryProps>;
  land: GeometryCollection<CountryProps>;
}>;

// Shared 50m world topology (contains both `countries` and merged `land`); loaded once on first Map use.
let atlasPromise: Promise<WorldAtlasTopology> | null = null;
function loadAtlas(): Promise<WorldAtlasTopology> {
  atlasPromise ??= import('world-atlas/countries-50m.json')
    .then(m => (m.default ?? m) as unknown as WorldAtlasTopology)
    .catch(err => {
      atlasPromise = null;
      throw err;
    });
  return atlasPromise;
}

// World land geometry: derived once from the shared 50m atlas on first use of the Map layout.
let landPromise: Promise<GeoPermissibleObjects> | null = null;
export function loadLand(): Promise<GeoPermissibleObjects> {
  landPromise ??= loadAtlas()
    .then(topo => feature(topo, topo.objects.land) as GeoPermissibleObjects)
    .catch(err => {
      landPromise = null;
      throw err;
    });
  return landPromise;
}

// ISO numeric -> alpha-2 lookup (loads cldr codeMappings.json only when region focus/highlight runs).
let numericLookupPromise: Promise<(id: string | number | undefined) => string | undefined> | null = null;
function loadAlpha2OfNumeric() {
  numericLookupPromise ??= import('../../../shared/locationNumeric')
    .then(m => m.alpha2OfNumeric)
    .catch(err => {
      numericLookupPromise = null;
      throw err;
    });
  return numericLookupPromise;
}

const MAINLAND_REACH_DEGREES = 5;
const MAINLAND_SAMPLE = 200;

/** The regions the selected locations are in. */
export function regionsOfLocations(selectedLocations: readonly string[], locationMapping: LocationMapping) {
  const regionOf = new Map(Object.values(locationMapping).map(c => [c.name, c.region]));
  return [...new Set(selectedLocations.map(c => regionOf.get(c) ?? ''))].filter(r => ALL_REGIONS.includes(r)).sort();
}

/** Shapes for the given regions, matched by ISO numeric id with un-indexed adjacent shapes inferred from topology neighbors. */
function regionGeometries(
  topo: WorldAtlasTopology,
  regions: string[],
  alpha2OfNumeric: (id: string | number | undefined) => string | undefined,
): CountryGeometry[] {
  const wanted = new Set(regions);
  const geoms = topo.objects.countries.geometries;
  const baseRegion = geoms.map(g => {
    const code = alpha2OfNumeric(g.id);
    return code ? regionOfCode(code) : '';
  });
  let adj: number[][] | null = null;
  return geoms.filter((g, i): g is CountryGeometry => {
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return false;
    let region = baseRegion[i];
    if (!region && g.id === undefined) {
      adj ??= neighbors(geoms);
      region = adj[i].map(j => baseRegion[j]).find(Boolean) ?? '';
    }
    return wanted.has(region);
  });
}

/**
 * Points outlining the given regions: each location's mainland, including land just off it or split by the 180° line.
 * Outlying islands are left out unless an institution sits there: they would stretch the frame across an ocean.
 */
export async function loadRegionsOutline(regions: string[]): Promise<LonLat[]> {
  const [topo, alpha2OfNumeric] = await Promise.all([loadAtlas(), loadAlpha2OfNumeric()]);
  const out: LonLat[] = [];
  for (const g of regionGeometries(topo, regions, alpha2OfNumeric)) {
    const shape = g.type === 'Polygon' ? feature(topo, g) : feature(topo, g);
    const polygons = (
      shape.geometry.type === 'Polygon' ? [shape.geometry.coordinates] : shape.geometry.coordinates
    ) as LonLat[][][];
    const areaOf = (rings: LonLat[][]) => geoArea({ type: 'Polygon', coordinates: rings });
    const main = polygons.reduce((best, rings) => (areaOf(rings) > areaOf(best) ? rings : best));
    const step = Math.max(1, Math.floor(main[0].length / MAINLAND_SAMPLE));
    const coast = main[0].filter((_, i) => i % step === 0);
    const reach = (MAINLAND_REACH_DEGREES * Math.PI) / 180;
    for (const rings of polygons) {
      const near = rings === main || rings[0].some(p => coast.some(c => geoDistance(p, c) <= reach));
      if (near) out.push(...rings[0].filter((_, i) => i % step === 0));
    }
  }
  return out;
}

/**
 * The given regions' land merged into one shape.
 */
export async function loadRegionsLand(regions: string[]) {
  const [topo, alpha2OfNumeric] = await Promise.all([loadAtlas(), loadAlpha2OfNumeric()]);
  return merge(topo, regionGeometries(topo, regions, alpha2OfNumeric));
}
