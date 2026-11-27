import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { NETWORK_PALETTE } from './palette';

export interface NetworkEdge {
  source: string;
  target: string;
  papers: number;
  weight: number;
}

export interface NodeStats {
  community: number;
  /** Categorical palette slot (0–6), or null for small/overflow communities drawn neutral. */
  slot: number | null;
  degree: number;
}

/** How much a node links its own collaborators to each other. */
export interface LinkedPairs {
  /** Pairs among its collaborators. */
  pairs: number;
  /** Of those pairs, the share whose strongest link runs through it, from 0 to 1. */
  share: number;
}

export interface GraphAnalysis {
  stats: Map<string, NodeStats>;
  /** Edges used for layout + drawing: each node's strongest ties (keeps dense institution graphs legible). */
  backbone: NetworkEdge[];
  /** All edges per node, for hover neighbourhoods and the inspector. */
  neighbours: Map<string, Map<string, NetworkEdge>>;
  communityCount: number;
  /** Where each community sits in the graph layout: strongly tied communities end up side by side. */
  anchors: Map<number, { x: number; y: number }>;
  /** See linkedPairsOf. Null for a node with fewer than two collaborators. */
  linkedPairs: (id: string) => LinkedPairs | null;
}

// One slot per colour in ./palette.ts. Smaller / overflow communities are drawn in its neutral.
const SLOT_COUNT = NETWORK_PALETTE.light.length;
const MIN_COLOURED_COMMUNITY = 3;
const BACKBONE_PER_NODE = 6;

// Deterministic RNG so Louvain gives the same communities for the same graph.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lays out the communities themselves as a small force graph, sized by membership and tied by the edges between them. */
function communityAnchors(members: Map<number, string[]>, backbone: NetworkEdge[], communityOf: (id: string) => number) {
  const between = new Map<string, { a: number; b: number; weight: number }>();
  for (const e of backbone) {
    const a = communityOf(e.source), b = communityOf(e.target);
    if (a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const tie = between.get(key);
    if (tie) tie.weight += e.weight; else between.set(key, { a, b, weight: e.weight });
  }
  const maxWeight = Math.max(...[...between.values()].map(t => t.weight), 1e-9);
  type AnchorNode = SimulationNodeDatum & { id: number; r: number };
  // Largest first on a spiral, so the result doesn't depend on the order communities were found in.
  const nodes: AnchorNode[] = [...members.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
    .map(([id, m], i) => ({ id, r: Math.sqrt(m.length) * 7, x: Math.cos(i) * 50 * Math.sqrt(i + 1), y: Math.sin(i) * 50 * Math.sqrt(i + 1) }));
  const links = [...between.values()].map(t => ({ source: t.a, target: t.b, w: Math.sqrt(t.weight / maxWeight) }));
  const sim = forceSimulation(nodes)
    .randomSource(mulberry32(42))
    .force('link', forceLink<AnchorNode, { source: number | AnchorNode; target: number | AnchorNode; w: number }>(links)
      .id(d => d.id)
      .distance(l => ((l.source as AnchorNode).r + (l.target as AnchorNode).r) * (1.6 - 0.6 * l.w))
      .strength(l => 0.05 + 0.3 * l.w))
    .force('charge', forceManyBody().strength(-120))
    .force('collide', forceCollide<AnchorNode>(d => d.r + 8))
    .force('x', forceX(0).strength(0.03))
    .force('y', forceY(0).strength(0.03))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();
  return new Map(nodes.map(n => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}

const sameWeight = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, a, b);

/**
 * For each node: of the pairs among its collaborators, the share whose strongest link runs through it.
 * A link through a third node is as strong as the weaker of its two ties. For collaborators X and Y of a node, the node gets the
 * pair when the link through it beats both X and Y's own tie and the link through every other partner they share. Links that tie
 * for strongest split the pair between them.
 * Worked out per node when first asked for, since only the hover card and the screen-reader text show it.
 */
function linkedPairsOf(neighbours: Map<string, Map<string, NetworkEdge>>) {
  const ids = [...neighbours.keys()];
  const index = new Map(ids.map((id, i) => [id, i]));
  // Each node's ties as numbers, strongest first, built on the first lookup: a big hub has tens of thousands of pairs to check.
  let tieNodes: Int32Array[] = [];
  let tieWeights: Float64Array[] = [];
  const buildTies = () => {
    for (const id of ids) {
      const ties = [...neighbours.get(id)!.entries()].sort((a, b) => b[1].weight - a[1].weight);
      tieNodes.push(Int32Array.from(ties, ([other]) => index.get(other)!));
      tieWeights.push(Float64Array.from(ties, ([, e]) => e.weight));
    }
  };
  // One collaborator's tie weights by node, filled in while its pairs are checked; 0 where there is no tie.
  const row = new Float64Array(ids.length);
  const known = new Map<string, LinkedPairs | null>();

  return (id: string): LinkedPairs | null => {
    if (known.has(id)) return known.get(id)!;
    const p = index.get(id);
    let result: LinkedPairs | null = null;
    if (p !== undefined && neighbours.get(id)!.size >= 2) {
      if (tieNodes.length === 0) buildTies();
      const partners = tieNodes[p], toPartner = tieWeights[p];
      let linked = 0;
      for (let i = 0; i < partners.length; i++) {
        const x = partners[i], xNodes = tieNodes[x], xWeights = tieWeights[x];
        for (let k = 0; k < xNodes.length; k++) row[xNodes[k]] = xWeights[k];
        for (let j = i + 1; j < partners.length; j++) {
          const y = partners[j];
          const through = Math.min(toPartner[i], toPartner[j]);
          const direct = row[y];
          if (direct > through && !sameWeight(direct, through)) continue;
          let strongest = sameWeight(direct, through) ? 2 : 1;
          // Other partners X and Y share. Y's ties come strongest first, and once they are weaker than the link through this
          // node, no later partner can match it.
          const yNodes = tieNodes[y], yWeights = tieWeights[y];
          let beaten = false;
          for (let k = 0; k < yNodes.length; k++) {
            const toY = yWeights[k];
            if (toY < through && !sameWeight(toY, through)) break;
            const z = yNodes[k], toX = row[z];
            if (z === p || toX === 0) continue;
            const link = Math.min(toX, toY);
            if (link > through && !sameWeight(link, through)) { beaten = true; break; }
            if (sameWeight(link, through)) strongest++;
          }
          if (!beaten) linked += 1 / strongest;
        }
        for (let k = 0; k < xNodes.length; k++) row[xNodes[k]] = 0;
      }
      const pairs = partners.length * (partners.length - 1) / 2;
      result = { pairs, share: linked / pairs };
    }
    known.set(id, result);
    return result;
  };
}

/**
 * @param previousSlots node → slot from the last render, so colours follow communities
 *                      across filter changes instead of being repainted by size.
 */
export function analyseGraph(
  nodeIds: string[],
  edges: NetworkEdge[],
  previousSlots: Map<string, number | null>,
): GraphAnalysis {
  const graph = new Graph({ type: 'undirected', allowSelfLoops: false });
  for (const id of nodeIds) graph.addNode(id);
  const neighbours = new Map<string, Map<string, NetworkEdge>>(nodeIds.map(id => [id, new Map()]));
  for (const e of edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
    graph.mergeEdge(e.source, e.target, { weight: e.weight });
    neighbours.get(e.source)!.set(e.target, e);
    neighbours.get(e.target)!.set(e.source, e);
  }

  const communities = graph.size > 0
    ? louvain(graph, { getEdgeWeight: 'weight', rng: mulberry32(42) })
    : Object.fromEntries(nodeIds.map((id, i) => [id, i]));

  // Group members by community, largest first.
  const members = new Map<number, string[]>();
  for (const id of nodeIds) {
    const c = communities[id];
    const list = members.get(c);
    if (list) list.push(id); else members.set(c, [id]);
  }
  const ordered = [...members.entries()].sort((a, b) => b[1].length - a[1].length);

  // Slot assignment: inherit the slot most of a community's members had before; else next free slot.
  const slotOf = new Map<number, number | null>();
  const taken = new Set<number>();
  const eligible = ordered.filter(([, m]) => m.length >= MIN_COLOURED_COMMUNITY).slice(0, SLOT_COUNT);
  for (const [c, m] of eligible) {
    const votes = new Map<number, number>();
    for (const id of m) {
      const s = previousSlots.get(id);
      if (s !== undefined && s !== null && !taken.has(s)) votes.set(s, (votes.get(s) ?? 0) + 1);
    }
    let best: number | null = null; let bestVotes = 0;
    for (const [s, v] of votes) if (v > bestVotes) { best = s; bestVotes = v; }
    if (best !== null) { slotOf.set(c, best); taken.add(best); }
  }
  for (const [c] of eligible) {
    if (slotOf.has(c)) continue;
    for (let s = 0; s < SLOT_COUNT; s++) if (!taken.has(s)) { slotOf.set(c, s); taken.add(s); break; }
  }

  const stats = new Map<string, NodeStats>();
  for (const id of nodeIds) {
    stats.set(id, {
      community: communities[id],
      slot: slotOf.get(communities[id]) ?? null,
      degree: neighbours.get(id)!.size,
    });
  }

  // Backbone: keep an edge if it is among the strongest few ties of either endpoint.
  const keep = new Set<NetworkEdge>();
  for (const [, ns] of neighbours) {
    [...ns.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, BACKBONE_PER_NODE)
      .forEach(e => keep.add(e));
  }

  const backbone = [...keep];
  return {
    stats, backbone, neighbours, communityCount: members.size,
    anchors: communityAnchors(members, backbone, id => communities[id]),
    linkedPairs: linkedPairsOf(neighbours),
  };
}
