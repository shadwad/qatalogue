import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation } from 'd3-force';
import { entryId } from '../../hooks/explorerFiltering';
import type { ExplorerEntry, NetworkLayout } from '../../types';
import type { GraphAnalysis } from './graph';
import {
  ANCHOR_STRENGTH,
  BETWEEN_TIE,
  MAP_COLLIDE_ZOOM,
  mapNodeRadius,
  WITHIN_TIE,
  type GeoPosition,
  type SimLink,
  type SimNode,
} from './types';

export function buildNetworkNodes({
  entries,
  prevNodes,
  positions,
  projection,
  layout,
  analysis,
  isFresh,
}: {
  entries: readonly ExplorerEntry[];
  prevNodes: Map<string, SimNode>;
  positions: Record<string, GeoPosition>;
  projection: (coordinates: [number, number]) => [number, number] | null;
  layout: NetworkLayout;
  analysis: GraphAnalysis;
  isFresh: boolean;
}): Map<string, SimNode> {
  const maxScore = Math.max(...entries.map(e => Number(e.total_fractional_score ?? 0)), 1e-9);
  const next = new Map<string, SimNode>();

  for (const e of entries) {
    const id = entryId(e);
    const r = 3 + 13 * Math.sqrt(Math.max(Number(e.total_fractional_score ?? 0), 0) / maxScore);
    const old = prevNodes.get(id);
    const node: SimNode = old ? Object.assign(old, { entry: e, r }) : { id, entry: e, r };
    const pos = positions[id];
    const projected = pos ? projection([pos[1], pos[0]]) : null;
    node.gx = projected?.[0];
    node.gy = projected?.[1];
    node.unplaced = !projected;
    next.set(id, node);
  }

  // New nodes: Map -> at their anchor; Force -> beside their strongest placed collaborator.
  const spread = Math.sqrt(entries.length) * 12;
  for (const n of next.values()) {
    if (n.x !== undefined) continue;
    if (layout === 'map' && !n.unplaced) {
      n.x = n.gx;
      n.y = n.gy;
      continue;
    }
    const ties = [...(analysis.neighbours.get(n.id)?.values() ?? [])].sort((a, b) => b.weight - a.weight);
    const anchor = ties.map(t => next.get(t.source === n.id ? t.target : t.source)).find(m => m?.x !== undefined);
    if (anchor && !isFresh) {
      n.x = anchor.x! + (Math.random() - 0.5) * 20;
      n.y = anchor.y! + (Math.random() - 0.5) * 20;
    } else {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * spread;
      n.x = Math.cos(a) * d;
      n.y = Math.sin(a) * d;
    }
  }
  return next;
}

export function buildNetworkLinks(
  analysis: GraphAnalysis,
  nodes: Map<string, SimNode>,
  layout: NetworkLayout,
): SimLink[] {
  const maxW = Math.max(...analysis.backbone.map(e => e.weight), 1e-9);
  const drawableEdges = layout === 'map'
    ? analysis.backbone.filter(edge => nodes.get(edge.source)?.unplaced === false && nodes.get(edge.target)?.unplaced === false)
    : analysis.backbone;
  return drawableEdges.map(edge => ({
    source: edge.source,
    target: edge.target,
    edge,
    w: Math.sqrt(edge.weight / maxW),
    within: analysis.stats.get(edge.source)?.community === analysis.stats.get(edge.target)?.community,
  }));
}

export function createNetworkSimulation({
  nodes,
  links,
  layout,
  analysis,
  mapFitK,
}: {
  nodes: SimNode[];
  links: SimLink[];
  layout: NetworkLayout;
  analysis: GraphAnalysis;
  mapFitK: number;
}): Simulation<SimNode, SimLink> {
  if (layout === 'map') {
    const collideK = MAP_COLLIDE_ZOOM * mapFitK;
    // Geo-anchored: strong pull to the true location, collision fans out crowded cities.
    return forceSimulation<SimNode, SimLink>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id(d => d.id).strength(0))
      .force('x', forceX<SimNode>(d => d.gx ?? 0).strength(0.6))
      .force('y', forceY<SimNode>(d => d.gy ?? 0).strength(0.6))
      .force('collide', forceCollide<SimNode>(d => mapNodeRadius(d.r, collideK, mapFitK) + 0.3).strength(0.85))
      .stop();
  }

  const anchorOf = (axis: 'x' | 'y') => (n: SimNode) =>
    analysis.anchors.get(analysis.stats.get(n.id)?.community ?? -1)?.[axis] ?? 0;

  return forceSimulation<SimNode, SimLink>(nodes)
    .force('link', forceLink<SimNode, SimLink>(links).id(d => d.id)
      .distance(l => (18 + 40 * (1 - l.w)) * (l.within ? WITHIN_TIE : BETWEEN_TIE).distance)
      .strength(l => (0.08 + 0.5 * l.w) * (l.within ? WITHIN_TIE : BETWEEN_TIE).strength))
    .force('charge', forceManyBody<SimNode>().strength(-45).distanceMax(500))
    .force('collide', forceCollide<SimNode>(d => d.r + 1.5))
    .force('x', forceX<SimNode>(anchorOf('x')).strength(ANCHOR_STRENGTH))
    .force('y', forceY<SimNode>(anchorOf('y')).strength(ANCHOR_STRENGTH))
    .stop();
}
