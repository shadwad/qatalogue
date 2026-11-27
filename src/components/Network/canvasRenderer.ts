import { polygonHull } from 'd3-polygon';
import { curveCatmullRomClosed, line } from 'd3-shape';
import type { ZoomTransform } from 'd3-zoom';
import { entryId, entryName } from '../../hooks/useExplorerData';
import type { ExplorerEntry, NetworkLayout } from '../../types';
import type { GraphAnalysis } from './graph';
import {
  HOVER_LABEL_COUNT,
  LABEL_COUNT,
  MAP_LABEL_COUNT,
  mapNodeRadius,
  type GeoPosition,
  type NetworkColours,
  type NetworkMapPaths,
  type SimLink,
  type SimNode,
} from './types';

export interface DrawNetworkCanvasParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  transform: ZoomTransform;
  layout: NetworkLayout;
  theme: 'light' | 'dark';
  entries: readonly ExplorerEntry[];
  nodes: Map<string, SimNode>;
  links: readonly SimLink[];
  analysis: GraphAnalysis;
  positions: Record<string, GeoPosition>;
  colours: NetworkColours;
  mapPaths: NetworkMapPaths;
  mapFitK: number;
  hoveredId: string | null;
  selectedId: string | null;
  searchActive: boolean;
  searchMatch: ReadonlySet<string>;
}

/** Draws all layers (map basemap, community hulls, edges, nodes, priority labels) onto the 2D canvas. */
export function drawNetworkCanvas({
  ctx,
  width,
  height,
  dpr,
  transform: t,
  layout,
  theme,
  entries,
  nodes: nodesMap,
  links,
  analysis,
  positions,
  colours,
  mapPaths,
  mapFitK,
  hoveredId,
  selectedId,
  searchActive,
  searchMatch,
}: DrawNetworkCanvasParams): boolean {
  const mapMode = layout === 'map';
  if (mapMode && !mapPaths.land) return false;
  const nodes = [...nodesMap.values()].filter(n => !(mapMode && n.unplaced));
  if (!mapMode && nodes.length === 0) return false;

  const hovered = hoveredId ?? selectedId;
  const hoodSet = hovered ? new Set([hovered, ...(analysis.neighbours.get(hovered)?.keys() ?? [])]) : null;
  const visible = (id: string) => !searchActive || searchMatch.has(id);
  const nodeAlpha = (id: string) => {
    if (hoodSet) return hoodSet.has(id) ? 1 : 0.06;
    return visible(id) ? 1 : 0.1;
  };
  const colourOf = (id: string) => {
    const slot = analysis.stats.get(id)?.slot;
    return slot === null || slot === undefined ? colours.neutral : colours.palette[slot];
  };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);

  // 0. Map layout: ocean tint, graticule, then land with a coastline stroke.
  if (mapMode && mapPaths.land) {
    const dark = theme === 'dark';
    if (mapPaths.sphere) {
      ctx.globalAlpha = dark ? 0.06 : 0.05;
      ctx.fillStyle = colours.primary;
      ctx.fill(mapPaths.sphere);
    }
    if (mapPaths.graticule) {
      ctx.globalAlpha = dark ? 0.08 : 0.07;
      ctx.strokeStyle = colours.ink;
      ctx.lineWidth = 0.5 / t.k;
      ctx.stroke(mapPaths.graticule);
    }
    const highlight = mapPaths.selectedLand;
    if (highlight) {
      ctx.globalAlpha = dark ? 0.04 : 0.035;
      ctx.fillStyle = colours.ink;
      ctx.fill(mapPaths.land);
      ctx.globalAlpha = dark ? 0.1 : 0.08;
      ctx.strokeStyle = colours.ink;
      ctx.lineWidth = 0.5 / t.k;
      ctx.stroke(mapPaths.land);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colours.surface;
      ctx.fill(highlight);
      ctx.globalAlpha = dark ? 0.16 : 0.12;
      ctx.fillStyle = colours.primary;
      ctx.fill(highlight);
      ctx.save();
      ctx.clip(highlight);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = colours.primary;
      ctx.lineWidth = 0.6 / t.k;
      ctx.stroke(mapPaths.land);
      ctx.restore();
    } else {
      ctx.globalAlpha = 1;
      ctx.fillStyle = colours.surface;
      ctx.shadowColor = dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(29, 23, 32, 0.12)';
      ctx.shadowBlur = 6 * dpr;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1.5 * dpr;
      ctx.fill(mapPaths.land);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.globalAlpha = dark ? 0.09 : 0.07;
      ctx.fillStyle = colours.ink;
      ctx.fill(mapPaths.land);
      ctx.globalAlpha = dark ? 0.28 : 0.22;
      ctx.strokeStyle = colours.ink;
      ctx.lineWidth = 0.6 / t.k;
      ctx.stroke(mapPaths.land);
    }
    if (mapPaths.sphere) {
      ctx.globalAlpha = dark ? 0.22 : 0.18;
      ctx.lineWidth = 0.8 / t.k;
      ctx.stroke(mapPaths.sphere);
    }
  }

  // 1. Community hulls (Force layout only; around the visible cohort).
  if (!hoodSet && !mapMode) {
    const bySlot = new Map<number, [number, number][]>();
    for (const n of nodes) {
      const slot = analysis.stats.get(n.id)?.slot;
      if (slot === null || slot === undefined || !visible(n.id) || n.x === undefined) continue;
      const pad = n.r + 10;
      const pts = bySlot.get(slot) ?? [];
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        pts.push([n.x + Math.cos(ang) * pad, n.y! + Math.sin(ang) * pad]);
      }
      bySlot.set(slot, pts);
    }
    const hullPath = line().curve(curveCatmullRomClosed.alpha(0.5)).context(ctx);
    for (const [slot, pts] of bySlot) {
      if (pts.length < 24) continue; // fewer than 3 nodes
      const hull = polygonHull(pts);
      if (!hull) continue;
      ctx.beginPath();
      hullPath(hull);
      ctx.globalAlpha = theme === 'dark' ? 0.1 : 0.08;
      ctx.fillStyle = colours.palette[slot];
      ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1 / t.k;
      ctx.strokeStyle = colours.palette[slot];
      ctx.stroke();
    }
  }

  // 2. Edges — straight in Force, gently curved in Map so long-distance ties read as arcs.
  const segment = (s: SimNode, d: SimNode) => {
    ctx.beginPath();
    ctx.moveTo(s.x!, s.y!);
    if (mapMode) {
      const mx = (s.x! + d.x!) / 2, my = (s.y! + d.y!) / 2;
      const dx = d.x! - s.x!, dy = d.y! - s.y!;
      ctx.quadraticCurveTo(mx - dy * 0.18, my + dx * 0.18, d.x!, d.y!);
    } else {
      ctx.lineTo(d.x!, d.y!);
    }
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  for (const l of links) {
    const s = l.source as SimNode, d = l.target as SimNode;
    if (s.x === undefined || d.x === undefined) continue;
    if (mapMode && (s.unplaced || d.unplaced)) continue;
    const inHood = hoodSet && (s.id === hovered || d.id === hovered);
    let alpha: number;
    if (hoodSet) alpha = inHood ? 0.85 : 0.02;
    else if (mapMode) alpha = visible(s.id) && visible(d.id) ? 0.04 + 0.22 * l.w : 0.02;
    else if (l.within) alpha = visible(s.id) && visible(d.id) ? 0.2 + 0.45 * l.w : 0.03;
    else alpha = visible(s.id) && visible(d.id) ? 0.06 + 0.2 * l.w : 0.02;
    ctx.globalAlpha = alpha;
    const slot = !mapMode && l.within ? analysis.stats.get(s.id)?.slot : null;
    ctx.strokeStyle = inHood ? colours.primary : slot === null || slot === undefined ? colours.ink : colours.palette[slot];
    ctx.lineWidth = mapMode
      ? (0.4 + 1.4 * l.w) / t.k
      : Math.max((l.within ? 0.5 + 2.5 * l.w : 0.4 + 1.2 * l.w), 0.6 / t.k);
    segment(s, d);
  }
  // Hover: also show ties outside the backbone.
  if (hovered && hoodSet) {
    const hn = nodesMap.get(hovered);
    if (hn?.x !== undefined && !(mapMode && hn.unplaced)) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = colours.primary;
      ctx.lineWidth = 0.8 / t.k;
      for (const other of analysis.neighbours.get(hovered)!.keys()) {
        const on = nodesMap.get(other);
        if (!on || on.x === undefined || (mapMode && on.unplaced)) continue;
        segment(hn, on);
      }
    }
  }

  // 3. Nodes (black outline in both themes separates overlaps and gives relief).
  const radiusOf = (n: SimNode) => (mapMode ? mapNodeRadius(n.r, t.k, mapFitK) : n.r);
  for (const n of nodes) {
    if (n.x === undefined) continue;
    const r = radiusOf(n);
    const approximate = mapMode && positions[n.id]?.[2] === 'location';
    ctx.globalAlpha = nodeAlpha(n.id);
    ctx.beginPath();
    ctx.arc(n.x, n.y!, r, 0, Math.PI * 2);
    if (approximate) {
      ctx.fillStyle = colours.surface;
      ctx.fill();
      ctx.lineWidth = Math.max(r * 0.35, 1.2 / t.k);
      ctx.strokeStyle = colourOf(n.id);
      ctx.stroke();
    } else {
      ctx.fillStyle = colourOf(n.id);
      ctx.fill();
      ctx.lineWidth = 1 / t.k;
      ctx.strokeStyle = '#000000';
      ctx.stroke();
    }
    if (n.fx != null && !mapMode) {
      ctx.globalAlpha = nodeAlpha(n.id);
      ctx.beginPath();
      ctx.arc(n.x, n.y!, r + 3 / t.k, 0, Math.PI * 2);
      ctx.lineWidth = 1 / t.k;
      ctx.strokeStyle = colours.ink;
      ctx.stroke();
    }
  }

  // Selected node: primary ring.
  const sel = selectedId ? nodesMap.get(selectedId) : undefined;
  if (sel && sel.x !== undefined && !(mapMode && sel.unplaced)) {
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(sel.x, sel.y!, radiusOf(sel) + 4 / t.k, 0, Math.PI * 2);
    ctx.lineWidth = 2 / t.k;
    ctx.strokeStyle = colours.primary;
    ctx.stroke();
  }

  // 4. Labels: the few with the highest output, or the focused node and its strongest ties.
  const labelled = new Set<string>();
  if (hovered) {
    labelled.add(hovered);
    [...(analysis.neighbours.get(hovered)?.entries() ?? [])]
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, HOVER_LABEL_COUNT)
      .forEach(([id]) => labelled.add(id));
  } else {
    for (const e of entries.slice(0, mapMode ? MAP_LABEL_COUNT : LABEL_COUNT)) {
      const id = entryId(e);
      if (visible(id)) labelled.add(id);
    }
    if (searchActive && searchMatch.size <= 25) searchMatch.forEach(id => labelled.add(id));
  }
  const fontPx = 11 / t.k;
  ctx.font = `600 ${fontPx}px "Inter Variable", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  const maxChars = width < 500 ? 22 : 34;
  const pad = 2 / t.k;
  const placed: { left: number; top: number; right: number; bottom: number }[] = [];
  for (const id of labelled) {
    const n = nodesMap.get(id);
    if (!n || n.x === undefined || (mapMode && n.unplaced)) continue;
    let text = entryName(n.entry);
    if (text.length > maxChars) text = text.slice(0, maxChars - 2) + '…';
    const y = n.y! + radiusOf(n) + 3 / t.k;
    const halfWidth = ctx.measureText(text).width / 2;
    const box = { left: n.x - halfWidth - pad, top: y - pad, right: n.x + halfWidth + pad, bottom: y + fontPx * 1.25 + pad };
    if (placed.some(b => box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top)) continue;
    placed.push(box);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3 / t.k;
    ctx.strokeStyle = colours.surface;
    ctx.strokeText(text, n.x, y);
    ctx.fillStyle = colours.ink;
    ctx.fillText(text, n.x, y);
  }
  ctx.globalAlpha = 1;
  return true;
}
