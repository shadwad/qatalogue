import { useEffect, useMemo, useRef, useState } from 'react';
import { geoGraticule10, geoPath, type GeoPermissibleObjects, type GeoProjection, type GeoSphere } from 'd3-geo';
import { geoRobinson } from 'd3-geo-projection';
import type { LocationMapping } from '../../types';
import {
  focusedRegions,
  loadLand,
  loadRegionsLand,
  loadRegionsOutline,
  outsideRegionViews,
  regionProjection,
  regionsOfLocations,
} from './regions';
import { MAP_HALF_H, MAP_HALF_W, type GeoPosition } from './types';

const SPHERE: GeoSphere = { type: 'Sphere' };

interface UseNetworkMapParams {
  isMap: boolean;
  ids: readonly string[];
  idsKey: string;
  hasEdgeData: boolean;
  positions: Record<string, GeoPosition>;
  selectedLocations: readonly string[];
  locationMapping: LocationMapping;
  onPathsReady: () => void;
}

export function useNetworkMap({
  isMap,
  ids,
  idsKey,
  hasEdgeData,
  positions,
  selectedLocations,
  locationMapping,
  onPathsReady,
}: UseNetworkMapParams) {
  const [land, setLand] = useState<GeoPermissibleObjects | null>(null);
  const [landFailed, setLandFailed] = useState(false);

  const worldBoxRef = useRef<[number, number, number, number]>([-MAP_HALF_W, MAP_HALF_W, -MAP_HALF_H, MAP_HALF_H]);
  const spherePathRef = useRef<Path2D | null>(null);
  const graticulePathRef = useRef<Path2D | null>(null);
  const landPathRef = useRef<Path2D | null>(null);
  const selectedLandPathRef = useRef<Path2D | null>(null);

  const onPathsReadyRef = useRef(onPathsReady);
  onPathsReadyRef.current = onPathsReady;

  useEffect(() => {
    if (!isMap || land || landFailed) return;
    let alive = true;
    loadLand()
      .then(f => { if (alive) setLand(f); })
      .catch(() => { if (alive) setLandFailed(true); }); // Browsers keep a failed import, so only a reload can retry it.
    return () => { alive = false; };
  }, [isMap, land, landFailed]);

  const regionKey = focusedRegions(selectedLocations, locationMapping).join('|');
  // A focused map frames its regions whole, and any selected institution outside them.
  const [regionsOutline, setRegionsOutline] = useState<{ key: string; points: [number, number][] } | null>(null);
  useEffect(() => {
    if (!isMap || !regionKey || regionsOutline?.key === regionKey) return;
    let alive = true;
    loadRegionsOutline(regionKey.split('|'))
      .then(points => { if (alive) setRegionsOutline({ key: regionKey, points }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isMap, regionKey, regionsOutline]);

  const regions = useMemo(() => (regionKey ? regionKey.split('|') : []), [regionKey]);
  const farPoints = useMemo(() => {
    const points = new Map<string, [number, number]>();
    if (!hasEdgeData) return points;
    for (const id of ids) {
      const pos = positions[id];
      if (!pos || !regions.length || !outsideRegionViews(regions, [pos[1], pos[0]])) continue;
      points.set(`${pos[1].toFixed(1)},${pos[0].toFixed(1)}`, [pos[1], pos[0]]);
    }
    return points;
  }, [hasEdgeData, positions, idsKey, regions]);

  const outlineReady = regionsOutline?.key === regionKey;
  // Tint the regions of selected locations over the world basemap.
  const highlightKey = regionsOfLocations(selectedLocations, locationMapping).join('|');
  const [highlightLand, setHighlightLand] = useState<{ key: string; shape: GeoPermissibleObjects } | null>(null);
  useEffect(() => {
    if (!isMap || !highlightKey || highlightLand?.key === highlightKey) return;
    let alive = true;
    loadRegionsLand(highlightKey.split('|'))
      .then(shape => { if (alive) setHighlightLand({ key: highlightKey, shape }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isMap, highlightKey, highlightLand]);

  const selectedLand = highlightKey && highlightLand?.key === highlightKey ? highlightLand.shape : null;
  const frameKey = `${regionKey}#${outlineReady ? 'whole' : ''}#${[...farPoints.keys()].sort().join(';')}`;
  const projection: GeoProjection = useMemo(() => {
    const extent: [[number, number], [number, number]] = [[-MAP_HALF_W, -MAP_HALF_H], [MAP_HALF_W, MAP_HALF_H]];
    if (!regionKey) return geoRobinson().fitExtent(extent, SPHERE);
    return regionProjection(regions, extent, [...(outlineReady ? regionsOutline!.points : []), ...farPoints.values()]);
  }, [frameKey]);

  // Ocean outline and 10 deg graticule depend only on the projection, so build them once the map is shown.
  useEffect(() => {
    if (!isMap) return;
    const path = geoPath(projection);
    const sphere = path(SPHERE);
    const [[x0, y0], [x1, y1]] = path.bounds(SPHERE);
    worldBoxRef.current = [Math.min(x0, -MAP_HALF_W), Math.max(x1, MAP_HALF_W), Math.min(y0, -MAP_HALF_H), Math.max(y1, MAP_HALF_H)];
    const grat = path(geoGraticule10());
    spherePathRef.current = sphere ? new Path2D(sphere) : null;
    graticulePathRef.current = grat ? new Path2D(grat) : null;
  }, [isMap, projection]);

  useEffect(() => {
    if (!isMap) return;
    const path = geoPath(projection);
    const d = land ? path(land) : null;
    const selected = selectedLand ? path(selectedLand) : null;
    landPathRef.current = d ? new Path2D(d) : null;
    selectedLandPathRef.current = selected ? new Path2D(selected) : null;
    onPathsReadyRef.current();
  }, [isMap, land, selectedLand, projection]);

  return {
    landFailed,
    projection,
    frameKey,
    worldBoxRef,
    spherePathRef,
    graticulePathRef,
    landPathRef,
    selectedLandPathRef,
  };
}
