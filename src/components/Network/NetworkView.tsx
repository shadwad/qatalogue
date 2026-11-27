import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { drag as d3drag } from 'd3-drag';
import type { Simulation } from 'd3-force';
import { pointer, select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { Download, Scan } from 'lucide-react';
import { entryId, entryName, entrySecondary, matchesSearch, metricLabel } from '../../hooks/useExplorerData';
import { exportDate, filterSummary, saveImage } from '../../lib/imageExport';
import { LOADING } from '../../lib/messages';
import type { NetworkLayout } from '../../types';
import { CONTROL_BUTTON } from '../ui/Controls';
import { EmptyState } from '../ui/EmptyState';
import { LoadFailure } from '../ui/LoadFailure';
import { Shimmer } from '../ui/Shimmer';
import { Tooltip } from '../ui/Tooltip';
import { drawNetworkCanvas } from './canvasRenderer';
import { analyseGraph, type GraphAnalysis, type NetworkEdge } from './graph';
import { NetworkInspector } from './NetworkInspector';
import { NetworkLegend } from './NetworkLegend';
import { NETWORK_NEUTRAL, NETWORK_PALETTE } from './palette';
import { buildNetworkLinks, buildNetworkNodes, createNetworkSimulation } from './simulation';
import {
  easeInOutCubic,
  GRAPH_MIN_ZOOM_OF_FIT,
  keyLinkLine,
  MAP_HALF_H,
  MAP_HALF_W,
  MAP_R_BASE,
  MAP_R_SCALE,
  MAP_SETTLE_TICKS,
  mapNodeRadius,
  MAX_ZOOM,
  prefersReducedMotion,
  PREWARM_TICKS,
  TWEEN_MS,
  VIEW_MARGIN,
  type GeoPosition,
  type NetworkViewProps,
  type Point,
  type SimLink,
  type SimNode,
} from './types';
import { useNetworkMap } from './useNetworkMap';

type PointerLikeEvent = MouseEvent | PointerEvent | TouchEvent;
const isTouchEvent = (ev: PointerLikeEvent | null | undefined): ev is TouchEvent =>
  Boolean(ev && 'changedTouches' in ev);

export const NetworkView: React.FC<NetworkViewProps> = ({
  entries,
  viewMode,
  metricMode,
  layout,
  searchQuery,
  paperQuery = '',
  total,
  startYear,
  endYear,
  selectedTopics,
  selectedPlatforms = [],
  topicFilter = selectedTopics,
  platformFilter = selectedPlatforms,
  topicName = (id: string) => id,
  platformName = (id: string) => id,
  selectedVenues,
  selectedLocations = [],
  locationMapping = {},
  theme,
  onSelect,
  switching = false,
  controls,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<Map<string, SimNode>>(new Map());
  const linksRef = useRef<SimLink[]>([]);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const slotsRef = useRef<Map<string, number | null>>(new Map());
  const fittedLayoutRef = useRef<NetworkLayout | null>(null);
  const hoveredRef = useRef<string | null>(null);
  /** Clicked node: stays highlighted with its card open until cleared (Esc, empty click, x). */
  const selectedRef = useRef<string | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const layoutRef = useRef<NetworkLayout>(layout);
  const builtLayoutRef = useRef<NetworkLayout | null>(null);
  const builtRegionRef = useRef<string | null>(null);
  /** The user has panned or zoomed: stop refitting when the canvas resizes. */
  const userZoomedRef = useRef(false);
  const nodeDragRef = useRef(false);
  const fitRef = useRef<() => void>(() => {});
  const forcePositionsRef = useRef<Map<string, Point>>(new Map());
  const tweenRef = useRef<number>(0);
  const [mapFitK, setMapFitK] = useState(0.4);
  const mapFitKRef = useRef(0.4);
  const selectNodeRef = useRef<(id: string | null) => void>(() => {});
  layoutRef.current = layout;

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoomK, setZoomK] = useState(1);
  const [kbFocused, setKbFocused] = useState(false);
  const [canvasUnavailable, setCanvasUnavailable] = useState(false);
  const [drawnLayout, setDrawnLayout] = useState<NetworkLayout | null>(null);
  const drawnLayoutRef = useRef<NetworkLayout | null>(null);

  const selectNode = useCallback((id: string | null) => {
    selectedRef.current = id;
    setSelectedId(id);
    drawRef.current();
  }, []);
  selectNodeRef.current = selectNode;

  const isMap = layout === 'map';
  const ids = useMemo(() => entries.map(entryId), [entries]);
  const idsKey = ids.join(',');

  const { data: edgeData, isFetching, isPending, error, refetch } = useQuery({
    queryKey: ['network', viewMode, idsKey, startYear, endYear, topicFilter, platformFilter, [...selectedVenues].sort(), paperQuery],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          view: viewMode,
          ids,
          start_year: startYear,
          end_year: endYear,
          topics: topicFilter,
          venues: selectedVenues,
          platforms: platformFilter,
          ...(paperQuery ? { paper_query: paperQuery } : {}),
        }),
        signal,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP error ${res.status}`);
      return (await res.json()) as { edges: NetworkEdge[]; positions?: Record<string, GeoPosition> };
    },
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
  const positions = useMemo(() => edgeData?.positions ?? {}, [edgeData]);

  const {
    landFailed,
    projection,
    frameKey,
    worldBoxRef,
    spherePathRef,
    graticulePathRef,
    landPathRef,
    selectedLandPathRef,
  } = useNetworkMap({
    isMap,
    ids,
    idsKey,
    hasEdgeData: Boolean(edgeData),
    positions,
    selectedLocations,
    locationMapping,
    onPathsReady: () => drawRef.current(),
  });

  const analysis: GraphAnalysis | null = useMemo(() => {
    if (!edgeData) return null;
    return analyseGraph(ids, edgeData.edges, slotsRef.current);
  }, [edgeData, idsKey]);

  useEffect(() => {
    if (!analysis) return;
    slotsRef.current = new Map([...analysis.stats].map(([id, s]) => [id, s.slot]));
  }, [analysis]);

  const searchActive = searchQuery.trim().length > 0;
  const searchMatch = useMemo(() => {
    const m = new Set<string>();
    if (!searchActive) return m;
    for (const e of entries) if (matchesSearch(e, searchQuery)) m.add(entryId(e));
    return m;
  }, [entries, searchQuery, searchActive]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') selectNode(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, selectNode]);

  useEffect(() => {
    if (selectedRef.current && !ids.includes(selectedRef.current)) selectNode(null);
  }, [idsKey, ids, selectNode]);

  // ---------- drawing ----------
  const colours = useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const primary = v('--primary') || (theme === 'dark' ? '#F97316' : '#4338CA');
    return {
      palette: NETWORK_PALETTE[theme] as readonly string[],
      neutral: NETWORK_NEUTRAL[theme],
      ink: v('--on-surface') || (theme === 'dark' ? '#F4F4F5' : '#1D1720'),
      surface: v('--surface') || (theme === 'dark' ? '#121214' : '#FCFBF8'),
      primary,
    };
  }, [theme]);

  /** What the view frames: the map's box, or every node in the graph. */
  const contentBox = useCallback((): [number, number, number, number] | null => {
    if (layoutRef.current === 'map') return [-MAP_HALF_W, MAP_HALF_W, -MAP_HALF_H, MAP_HALF_H];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodesRef.current.values()) {
      if (n.x === undefined || n.y === undefined) continue;
      minX = Math.min(minX, n.x - n.r); maxX = Math.max(maxX, n.x + n.r);
      minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r);
    }
    return minX === Infinity ? null : [minX, maxX, minY, maxY];
  }, []);

  const fitScale = useCallback(([minX, maxX, minY, maxY]: [number, number, number, number]) => {
    const { w, h } = sizeRef.current;
    return Math.min(4, 0.92 * Math.min(w / Math.max(maxX - minX, 1), h / Math.max(maxY - minY, 1)));
  }, []);

  /** Keep zoom and pan limits on the current content, which moves with dragged nodes, layout changes and resizes. */
  const updateZoomBounds = useCallback(() => {
    const isMapLayout = layoutRef.current === 'map';
    const z = zoomRef.current, box = isMapLayout ? worldBoxRef.current : contentBox();
    if (!z || !box) return;
    const fit = fitScale(box);
    z.scaleExtent([isMapLayout ? fit : fit * GRAPH_MIN_ZOOM_OF_FIT, MAX_ZOOM]);
    z.translateExtent([[box[0] - VIEW_MARGIN, box[2] - VIEW_MARGIN], [box[1] + VIEW_MARGIN, box[3] + VIEW_MARGIN]]);
  }, [contentBox, fitScale, worldBoxRef]);

  const draw = useCallback(() => {
    const ctx = contextRef.current;
    const { w, h } = sizeRef.current;
    const currentLayout = layoutRef.current;
    if (!ctx || !analysis || w <= 0 || h <= 0 || fittedLayoutRef.current !== currentLayout ||
      builtLayoutRef.current !== currentLayout) return;
    updateZoomBounds();
    const drew = drawNetworkCanvas({
      ctx,
      width: w,
      height: h,
      dpr: window.devicePixelRatio || 1,
      transform: transformRef.current,
      layout: currentLayout,
      theme,
      entries,
      nodes: nodesRef.current,
      links: linksRef.current,
      analysis,
      positions,
      colours,
      mapPaths: {
        sphere: spherePathRef.current,
        graticule: graticulePathRef.current,
        land: landPathRef.current,
        selectedLand: selectedLandPathRef.current,
      },
      mapFitK: mapFitKRef.current,
      hoveredId: hoveredRef.current,
      selectedId: selectedRef.current,
      searchActive,
      searchMatch,
    });
    if (drew && drawnLayoutRef.current !== currentLayout) {
      drawnLayoutRef.current = currentLayout;
      setDrawnLayout(currentLayout);
    }
  }, [
    analysis,
    colours,
    entries,
    searchActive,
    searchMatch,
    theme,
    positions,
    updateZoomBounds,
    spherePathRef,
    graticulePathRef,
    landPathRef,
    selectedLandPathRef,
  ]);

  useEffect(() => { drawRef.current = draw; draw(); }, [draw]);

  // ---------- canvas sizing ----------
  useEffect(() => {
    const container = containerRef.current, canvas = canvasRef.current;
    if (!container || !canvas) return;
    contextRef.current = canvas.getContext('2d');
    if (!contextRef.current) {
      setCanvasUnavailable(true);
      return;
    }
    const resize = (width: number, height: number) => {
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w: width, h: height };
      if (width > 0 && height > 0) {
        const nextFitK = Math.max(0.05, 0.92 * Math.min(width / (2 * MAP_HALF_W), height / (2 * MAP_HALF_H)));
        mapFitKRef.current = nextFitK;
        setMapFitK(nextFitK);
      }
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      // The first real size may arrive after the graph is built.
      if (fittedLayoutRef.current !== layoutRef.current || !userZoomedRef.current) fitRef.current();
      else drawRef.current();
    };
    resize(container.clientWidth, container.clientHeight);
    const ro = new ResizeObserver(([entry]) => resize(entry.contentRect.width, entry.contentRect.height));
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const fitToView = useCallback(() => {
    const canvas = canvasRef.current, z = zoomRef.current;
    const { w, h } = sizeRef.current;
    const currentLayout = layoutRef.current;
    if (!canvas || !z || w <= 0 || h <= 0 || nodesRef.current.size === 0 || builtLayoutRef.current !== currentLayout) return;
    const box = contentBox();
    if (!box) return;
    const [minX, maxX, minY, maxY] = box;
    const k = fitScale(box);
    const t = zoomIdentity.translate(w / 2, h / 2).scale(k).translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
    fittedLayoutRef.current = currentLayout;
    z.transform(select(canvas), t);
    userZoomedRef.current = false;
  }, [contentBox, fitScale]);
  fitRef.current = fitToView;

  /** Animate every node from where it is now to `targets`, then hand over to `done`. */
  const tweenTo = useCallback((targets: Map<string, Point>, done: () => void) => {
    cancelAnimationFrame(tweenRef.current);
    const nodes = [...nodesRef.current.values()];
    if (prefersReducedMotion()) {
      for (const n of nodes) { const p = targets.get(n.id); if (p) { n.x = p.x; n.y = p.y; } }
      done();
      return;
    }
    const from = new Map(nodes.map(n => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
    const start = performance.now();
    const step = (now: number) => {
      const p = easeInOutCubic(Math.min(1, (now - start) / TWEEN_MS));
      for (const n of nodes) {
        const a = from.get(n.id)!, b = targets.get(n.id);
        if (!b) continue;
        n.x = a.x + (b.x - a.x) * p;
        n.y = a.y + (b.y - a.y) * p;
      }
      drawRef.current();
      if (p < 1) tweenRef.current = requestAnimationFrame(step);
      else done();
    };
    tweenRef.current = requestAnimationFrame(step);
  }, []);

  // ---------- simulation (rebuilt when the graph or layout changes; positions preserved) ----------
  useEffect(() => {
    if (!analysis || !contextRef.current) return;
    const prev = nodesRef.current;
    const isFresh = prev.size === 0;
    const switching = !isFresh && builtLayoutRef.current !== null && builtLayoutRef.current !== layout;
    const refocusing = !isFresh && !switching && layout === 'map' && builtRegionRef.current !== frameKey;
    const reduced = prefersReducedMotion();

    // Remember Force positions when leaving it, so coming back restores the same picture.
    if (switching && layout === 'map') {
      forcePositionsRef.current = new Map([...prev.values()].map(n => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
    }

    const next = buildNetworkNodes({ entries, prevNodes: prev, positions, projection, layout, analysis, isFresh });
    nodesRef.current = next;
    const links = buildNetworkLinks(analysis, next, layout);

    {
      const { w, h } = sizeRef.current;
      if (w > 0 && h > 0) {
        const nextFitK = Math.max(0.05, 0.92 * Math.min(w / (2 * MAP_HALF_W), h / (2 * MAP_HALF_H)));
        mapFitKRef.current = nextFitK;
        setMapFitK(nextFitK);
      }
    }

    simRef.current?.stop();
    cancelAnimationFrame(tweenRef.current);
    // In Map mode, unplaced nodes sit out of the physics (and the drawing).
    const simNodes = [...next.values()].filter(n => layout === 'force' || !n.unplaced);
    const sim = createNetworkSimulation({ nodes: simNodes, links, layout, analysis, mapFitK: mapFitKRef.current });
    linksRef.current = links;
    simRef.current = sim;

    const settle = (ticks: number) => { sim.alpha(1); for (let i = 0; i < ticks; i++) sim.tick(); sim.alpha(0); };
    let raf = 0;

    if (switching) {
      // Work out where everything ends up, then glide there.
      const current = new Map([...next.values()].map(n => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
      if (layout === 'force') {
        for (const n of next.values()) {
          const saved = forcePositionsRef.current.get(n.id);
          if (saved) { n.x = saved.x; n.y = saved.y; }
          n.fx = null; n.fy = null;
        }
        sim.alpha(0.3); for (let i = 0; i < 60; i++) sim.tick(); sim.alpha(0);
      } else {
        for (const n of simNodes) { n.x = n.gx; n.y = n.gy; n.fx = null; n.fy = null; }
        settle(MAP_SETTLE_TICKS);
      }
      const targets = new Map([...next.values()].map(n => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
      for (const n of next.values()) { const c = current.get(n.id)!; n.x = c.x; n.y = c.y; }
      builtLayoutRef.current = layout;
      tweenTo(targets, () => { drawRef.current(); });
      raf = requestAnimationFrame(() => fitToView());
    } else {
      if (refocusing) {
        // A new region is a new projection: place everything on it and show it whole.
        for (const n of simNodes) { n.x = n.gx; n.y = n.gy; }
        settle(MAP_SETTLE_TICKS);
        raf = requestAnimationFrame(() => fitToView());
      } else if (layout === 'map') {
        settle(isFresh ? MAP_SETTLE_TICKS : 80);
      } else if (isFresh || reduced) {
        // Settle before the first paint so the graph appears calm rather than jiggling into place.
        settle(PREWARM_TICKS);
      } else {
        sim.alpha(0.35);
        for (let i = 0; i < 40; i++) sim.tick();
      }
      sim.on('tick', () => drawRef.current());
      if (layout === 'force' && !isFresh && !reduced) sim.restart();
      builtLayoutRef.current = layout;
      drawRef.current();
      if (fittedLayoutRef.current !== layout) {
        // Deferred: the zoom behaviour is attached by a later effect in this same commit.
        raf = requestAnimationFrame(fitToView);
      }
    }
    builtRegionRef.current = frameKey;
    return () => { sim.stop(); cancelAnimationFrame(raf); cancelAnimationFrame(tweenRef.current); };
  }, [analysis, layout, frameKey]);

  // Refresh node metadata and radii when scores/metric update without rebuilding the simulation.
  useEffect(() => {
    if (nodesRef.current.size === 0) return;
    const max = Math.max(...entries.map(e => Number(e.total_fractional_score ?? 0)), 1e-9);
    for (const e of entries) {
      const node = nodesRef.current.get(entryId(e));
      if (!node) continue;
      node.entry = e;
      node.r = 3 + 13 * Math.sqrt(Math.max(Number(e.total_fractional_score ?? 0), 0) / max);
    }
    drawRef.current();
  }, [entries, metricMode]);

  // ---------- zoom, drag, hover, click ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sel = select(canvas);

    const pointOf = (ev: PointerLikeEvent | null | undefined) =>
      pointer(isTouchEvent(ev) ? (ev.changedTouches[0] ?? ev.touches[0] ?? ev) : ev, canvas);
    const hitSlop = (ev: PointerLikeEvent | null | undefined) => (isTouchEvent(ev) ? 12 : 4);
    const tapSlop = (ev: PointerLikeEvent | null | undefined) => (isTouchEvent(ev) ? 10 : 4);

    const findNode = (ev: PointerLikeEvent | null | undefined): SimNode | undefined => {
      const [mx, my] = pointOf(ev);
      const [x, y] = transformRef.current.invert([mx, my]);
      const mapMode = layoutRef.current === 'map';
      const k = transformRef.current.k;
      let best: SimNode | undefined, bestD = Infinity;
      for (const n of nodesRef.current.values()) {
        if (n.x === undefined || (mapMode && n.unplaced)) continue;
        const d = Math.hypot(n.x - x, n.y! - y);
        const hit = (mapMode ? mapNodeRadius(n.r, k, mapFitKRef.current) : n.r) + hitSlop(ev) / k;
        if (d <= hit && d < bestD) { best = n; bestD = d; }
      }
      return best;
    };

    let zoomRaf = 0;
    const z = d3zoom<HTMLCanvasElement, unknown>()
      .on('zoom', ev => {
        transformRef.current = ev.transform;
        if (ev.sourceEvent) userZoomedRef.current = true;
        drawRef.current();
        if (!zoomRaf) zoomRaf = requestAnimationFrame(() => { zoomRaf = 0; setZoomK(transformRef.current.k); });
      });
    zoomRef.current = z;

    let downAt: [number, number] | null = null;
    const dr = d3drag<HTMLCanvasElement, unknown, SimNode | undefined>()
      .subject(ev => (layoutRef.current === 'map' ? undefined : findNode(ev.sourceEvent as PointerLikeEvent)))
      .on('start', ev => {
        downAt = pointOf(ev.sourceEvent as PointerLikeEvent);
        if (layoutRef.current === 'map' || !ev.subject) return; // geography is fixed: no dragging/pinning on the map
        nodeDragRef.current = true;
        canvas.style.cursor = 'grabbing';
        const n = ev.subject as SimNode;
        n.fx = n.x; n.fy = n.y;
      })
      .on('drag', ev => {
        if (layoutRef.current === 'map' || !ev.subject) return;
        const n = ev.subject as SimNode;
        const [x, y] = transformRef.current.invert(pointOf(ev.sourceEvent as PointerLikeEvent));
        n.fx = x; n.fy = y;
        const sim = simRef.current;
        if (sim && sim.alpha() < 0.1) sim.alphaTarget(0.25).restart();
      })
      .on('end', ev => {
        nodeDragRef.current = false;
        canvas.style.cursor = '';
        const n = ev.subject as SimNode | undefined;
        if (!n) return;
        simRef.current?.alphaTarget(0);
        const sourceEvent = ev.sourceEvent as PointerLikeEvent;
        const up = pointOf(sourceEvent);
        const moved = downAt ? Math.hypot(up[0] - downAt[0], up[1] - downAt[1]) : 0;
        if (moved < tapSlop(sourceEvent)) {
          n.fx = null; n.fy = null; // a click, not a drag: don't pin
          selectNodeRef.current(selectedRef.current === n.id ? null : n.id);
        }
        drawRef.current();
      });

    dr(sel);
    sel.call(z).on('dblclick.zoom', null);
    sel.on('dblclick.unpin', (ev: MouseEvent) => {
      if (layoutRef.current === 'map') return;
      const n = findNode(ev);
      if (n) { n.fx = null; n.fy = null; simRef.current?.alpha(0.2).restart(); }
    });
    sel.on('pointermove.hover', (ev: PointerEvent) => {
      const n = findNode(ev);
      const id = n?.id ?? null;
      if (!nodeDragRef.current) canvas.style.cursor = n ? 'pointer' : '';
      if (id !== hoveredRef.current) {
        hoveredRef.current = id;
        setHoveredId(id);
        drawRef.current();
      }
    });
    sel.on('click.select', (ev: MouseEvent) => {
      if (ev.defaultPrevented) return;
      const n = findNode(ev);
      if (layoutRef.current === 'map' && n) {
        selectNodeRef.current(selectedRef.current === n.id ? null : n.id);
      } else if (!n && selectedRef.current) {
        selectNodeRef.current(null);
      }
    });
    sel.on('pointerleave.hover', () => {
      if (hoveredRef.current) { hoveredRef.current = null; setHoveredId(null); drawRef.current(); }
    });
    return () => { cancelAnimationFrame(zoomRaf); sel.on('.zoom', null).on('.drag', null).on('.hover', null).on('.unpin', null).on('.select', null); };
  }, []);

  // ---------- keyboard ----------
  /** Pan just enough to bring a node back into view (centres it if it is off-screen). */
  const ensureVisible = (n: SimNode) => {
    const canvas = canvasRef.current, z = zoomRef.current;
    if (!canvas || !z || n.x === undefined) return;
    const [sx, sy] = transformRef.current.apply([n.x, n.y!]);
    const { w, h } = sizeRef.current, pad = 80;
    if (sx < pad || sx > w - pad || sy < pad || sy > h - pad) {
      z.translateTo(select(canvas), n.x, n.y!);
    }
  };

  const onCanvasKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current, z = zoomRef.current;
    if (!canvas || !z || !analysis) return;
    const mapMode = layoutRef.current === 'map';
    const usable = (n?: SimNode): n is SimNode => !!n && n.x !== undefined && !(mapMode && n.unplaced);
    const all = [...nodesRef.current.values()].filter(usable);
    const matching = searchActive ? all.filter(n => searchMatch.has(n.id)) : all;
    const pool = matching.length ? matching : all;
    const current = selectedRef.current ? nodesRef.current.get(selectedRef.current) : undefined;
    const startAtTop = () => {
      const poolIds = new Set(pool.map(n => n.id));
      const top = entries.map(entryId).find(id => poolIds.has(id));
      const n = top ? nodesRef.current.get(top) : undefined;
      if (n) { selectNode(n.id); ensureVisible(n); }
    };

    const dirs: Record<string, [number, number]> = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    };
    if (e.key in dirs) {
      e.preventDefault();
      if (!usable(current)) { startAtTop(); return; }
      const [dx, dy] = dirs[e.key];
      const score = (n: SimNode) => {
        const vx = n.x! - current.x!, vy = n.y! - current.y!;
        const d = Math.hypot(vx, vy);
        if (d < 1e-6) return Infinity;
        const cos = (vx * dx + vy * dy) / d;
        return cos < 0.5 ? Infinity : d * (2 - cos);
      };
      const best = (cands: SimNode[]) => {
        let pick: SimNode | undefined, bestScore = Infinity;
        for (const n of cands) { const sc = score(n); if (sc < bestScore) { bestScore = sc; pick = n; } }
        return pick;
      };
      const ties = analysis.neighbours.get(current.id);
      const next = best(pool.filter(n => ties?.has(n.id))) ?? best(pool.filter(n => n.id !== current.id));
      if (next) { selectNode(next.id); ensureVisible(next); }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (usable(current)) onSelect(current.id); else startAtTop();
      return;
    }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); userZoomedRef.current = true; z.scaleBy(select(canvas), 1.3); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); userZoomedRef.current = true; z.scaleBy(select(canvas), 1 / 1.3); return; }
    if (e.key === '0') { e.preventDefault(); fitToView(); }
  };

  // ---------- render ----------
  const entriesById = useMemo(() => new Map(entries.map(e => [entryId(e), e])), [entries]);
  const noun = viewMode === 'institution' ? 'institutions' : 'researchers';
  const focusId = hoveredId ?? selectedId;
  const cardIsSelection = focusId !== null && focusId === selectedId;
  const hoveredEntry = focusId ? entriesById.get(focusId) ?? null : null;
  const hoveredStats = focusId ? analysis?.stats.get(focusId) : undefined;
  const hoveredLinked = focusId && analysis ? analysis.linkedPairs(focusId) : null;
  const hoveredPos = focusId ? positions[focusId] : undefined;
  const strongestTies = focusId && analysis
    ? [...(analysis.neighbours.get(focusId)?.entries() ?? [])]
      .sort((a, b) => b[1].weight - a[1].weight).slice(0, 3)
      .map(([other, e]) => {
        const otherEntry = entriesById.get(other);
        return { id: other, name: otherEntry ? entryName(otherEntry) : '', papers: e.papers };
      })
    : [];
  const hoveredColour = hoveredStats
    ? (hoveredStats.slot === null ? colours.neutral : colours.palette[hoveredStats.slot])
    : undefined;

  const maxScore = Math.max(...entries.map(e => Number(e.total_fractional_score ?? 0)), 0);
  const legend = maxScore > 0
    ? [1, 1 / 4, 1 / 16].map(f => {
        const v = maxScore * f;
        const rWorld = 3 + 13 * Math.sqrt(f);
        const px = isMap
          ? (MAP_R_BASE + MAP_R_SCALE * rWorld) * Math.sqrt(zoomK / mapFitK)
          : rWorld * zoomK;
        const label = v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString();
        return { label, r: Math.min(Math.max(px, 1.5), 14) };
      })
    : [];

  /** Download the current view as a PNG, with a caption strip describing what it shows. */
  const exportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const filters = [
      filterSummary({
        startYear,
        endYear,
        topics: selectedTopics.map(topicName),
        topicsMatchAll: Boolean(topicFilter[0]?.includes('+')),
        platforms: selectedPlatforms.map(platformName),
        platformsMatchAll: Boolean(platformFilter[0]?.includes('+')),
        venues: selectedVenues,
        locations: selectedLocations.map(c => locationMapping[c]?.name ?? c),
        paperQuery,
      }),
      `Exported ${exportDate()}`,
    ].filter(Boolean).join(' · ');
    saveImage(canvas, {
      scale: window.devicePixelRatio || 1,
      surface: colours.surface,
      ink: colours.ink,
      fileName: `qatalogue-${viewMode}-network-${isMap ? 'map-' : ''}${exportDate()}.png`,
      caption: {
        headline: `${entries.length.toLocaleString()} of ${total.toLocaleString()} ${noun} · chosen and sized by ${metricLabel(metricMode)} count${isMap ? ' · world map' : ''}`,
        detail: filters,
      },
    }).catch(err => console.error(err));
  };

  const locationLevel = isMap ? ids.filter(id => positions[id]?.[2] === 'location').length : 0;
  const unplacedCount = isMap && edgeData ? ids.filter(id => !positions[id]).length : 0;
  const hasGrey = analysis ? [...analysis.stats.values()].some(s => s.slot === null) : false;
  const failed = error || canvasUnavailable || (isMap && landFailed);
  const observing = !failed && ids.length > 0 && (switching || isPending || drawnLayout !== layout);

  return (
    <div ref={containerRef} className="relative flex-1 min-h-0 overflow-hidden bg-surface">
      <canvas
        ref={canvasRef}
        tabIndex={observing || failed || ids.length === 0 ? -1 : 0}
        className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
        role="application"
        aria-roledescription="network graph"
        aria-label={`Collaboration network of the ${entries.length} ${noun} with the highest output${isMap ? ' on a world map' : ''}`}
        aria-describedby="network-keyboard-help"
        onKeyDown={onCanvasKeyDown}
        onFocus={e => setKbFocused(e.currentTarget.matches(':focus-visible'))}
        onBlur={() => setKbFocused(false)}
      />
      <p id="network-keyboard-help" className="sr-only">
        Use the arrow keys to move between connected {noun}, Enter to open the selected one in the list,
        plus and minus to zoom, 0 to fit, and Escape to clear the selection.
      </p>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {selectedId && entriesById.get(selectedId) && analysis?.stats.get(selectedId)
          ? (() => {
              const e = entriesById.get(selectedId)!;
              const st = analysis.stats.get(selectedId)!;
              const linked = analysis.linkedPairs(selectedId);
              return `${entryName(e)}${entrySecondary(e) ? `, ${entrySecondary(e)}` : ''}. ${metricLabel(metricMode)} count ${Number(e.total_fractional_score ?? 0).toFixed(2)}. ${keyLinkLine(st.degree, linked).replace('<', 'under ')}.`;
            })()
          : ''}
      </div>

      {observing && (
        <div role="status" className="absolute inset-0 z-20 flex items-center justify-center bg-surface">
          <Shimmer as="div" className="font-mono text-sm uppercase tracking-wider">{LOADING.network}</Shimmer>
        </div>
      )}
      {failed && ids.length > 0 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface p-10">
          {error
            ? <LoadFailure what="The network" onRetry={() => refetch()} retrying={isFetching} />
            : <LoadFailure what={canvasUnavailable ? 'The network canvas' : 'The map'}
                hint={canvasUnavailable ? 'Reload the page to try again.' : 'Check your connection and reload the page.'}
                retryLabel="Reload" onRetry={() => window.location.reload()} />}
        </div>
      )}
      {ids.length === 0 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface p-10">
          <EmptyState>
            No {noun} match these filters. Adjust the filters in the sidebar or search bar.
          </EmptyState>
        </div>
      )}

      {searchActive && searchMatch.size === 0 && ids.length > 0 && (
        <div className="absolute top-4 max-md:top-16 left-1/2 -translate-x-1/2 max-md:w-max max-md:max-w-[calc(100%-1.5rem)] bg-surface/90 border border-outline-variant rounded-xl shadow-popover px-3 py-2 pointer-events-none animate-modal-in">
          <span className="font-display text-[11px] font-bold tracking-wider uppercase text-on-surface-variant">
            No matches among the {entries.length.toLocaleString()} {noun} shown
          </span>
        </div>
      )}

      {controls && <div className="absolute top-3 left-3 z-30 flex items-center gap-2 md:hidden">{controls}</div>}

      {!observing && !failed && ids.length > 0 && (
        <div className="absolute top-3 right-3 md:top-4 md:right-[clamp(1.5rem,4vw,2.5rem)] flex items-center gap-3">
          {isFetching && !isPending && (
            <Shimmer className="font-mono text-[11px] uppercase tracking-wider">{LOADING.layout}</Shimmer>
          )}
          <Tooltip contents content="Download the network as an image">
            <button type="button" onClick={exportPng} className={CONTROL_BUTTON} aria-label="Download the network as a PNG image">
              <Download className="w-3 h-3" aria-hidden="true" /> <span className="max-md:sr-only">PNG</span>
            </button>
          </Tooltip>
          <Tooltip contents content="Fit the network to the view">
            <button type="button" onClick={() => fitToView()} className={CONTROL_BUTTON}>
              <Scan className="w-3 h-3" aria-hidden="true" /> <span className="max-md:sr-only">Fit</span>
            </button>
          </Tooltip>
        </div>
      )}

      {!observing && !failed && ids.length > 0 && focusId && hoveredEntry && hoveredStats && (
        <NetworkInspector
          focusId={focusId}
          entry={hoveredEntry}
          stats={hoveredStats}
          linked={hoveredLinked}
          position={hoveredPos}
          strongestTies={strongestTies}
          colour={hoveredColour}
          cardIsSelection={cardIsSelection}
          isMap={isMap}
          metricMode={metricMode}
          onClearSelection={() => selectNode(null)}
          onOpenInList={onSelect}
        />
      )}

      <NetworkLegend
        metricMode={metricMode}
        isMap={isMap}
        hasGrey={hasGrey}
        locationLevel={locationLevel}
        unplacedCount={unplacedCount}
        neutralColour={colours.neutral}
        legend={legend}
        kbFocused={kbFocused}
      />
    </div>
  );
};

export default NetworkView;
