import type React from 'react';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { LinkedPairs, NetworkEdge } from './graph';
import type { ExplorerEntry, LocationMapping, MetricMode, NetworkLayout, ViewMode } from '../../types';

export type GeoPosition = [lat: number, lng: number, precision: 'city' | 'location', city: string | null];

export interface SimNode extends SimulationNodeDatum {
  id: string;
  entry: ExplorerEntry;
  r: number;
  /** Projected geographic anchor (Map layout). */
  gx?: number;
  gy?: number;
  /** No coordinates -> not drawn in Map layout. */
  unplaced?: boolean;
}

export type SimLink = SimulationLinkDatum<SimNode> & {
  edge: NetworkEdge;
  w: number;
  /** Both ends in the same community. */
  within: boolean;
};

export interface Point {
  x: number;
  y: number;
}

export interface NetworkColours {
  palette: readonly string[];
  neutral: string;
  ink: string;
  surface: string;
  primary: string;
}

export interface NetworkMapPaths {
  sphere: Path2D | null;
  graticule: Path2D | null;
  land: Path2D | null;
  selectedLand: Path2D | null;
}

export interface NetworkViewProps {
  entries: ExplorerEntry[];
  viewMode: ViewMode;
  metricMode: MetricMode;
  layout: NetworkLayout; // 'map' only ever arrives for institutions
  searchQuery: string;
  /** Topics mode: only papers matching this search count as shared papers. */
  paperQuery?: string;
  total: number;
  startYear: number;
  endYear: number;
  selectedTopics: string[];
  selectedPlatforms?: string[];
  /** What to request: as selected, or "a+b" for papers that must have both. */
  topicFilter?: string[];
  platformFilter?: string[];
  /** Display names for topic and platform ids (captions). */
  topicName?: (id: string) => string;
  platformName?: (id: string) => string;
  selectedVenues: string[];
  /** Location filter. The Map layout shows only the regions these locations are in, centred on them. */
  selectedLocations?: string[];
  locationMapping?: LocationMapping;
  theme: 'light' | 'dark';
  onSelect: (id: string) => void;
  /** A layout switch is waiting to be applied: show the loading message over the current drawing. */
  switching?: boolean;
  /** Phones: the view and layout switches (which tablets and desktops have in the results bar), at the top left. */
  controls?: React.ReactNode;
}

export const PREWARM_TICKS = 300;
export const MAX_ZOOM = 12;
// The view can't leave the content by more than this (world units). Zooming out stops at the fit: exactly for the map,
// a little past it for the graph, whose outline is uneven and benefits from room around it.
export const VIEW_MARGIN = 40;
export const GRAPH_MIN_ZOOM_OF_FIT = 0.8;
// Graph layout: community ties pull harder and sit closer than ties between communities, and each node is drawn to its
// community's anchor.
export const WITHIN_TIE = { distance: 0.7, strength: 1.3 };
export const BETWEEN_TIE = { distance: 1.5, strength: 0.35 };
export const ANCHOR_STRENGTH = 0.12;
export const MAP_SETTLE_TICKS = 160;
export const LABEL_COUNT = 10;
export const HOVER_LABEL_COUNT = 8;
export const TWEEN_MS = 650;
// Map layout lives in a fixed world box (simulation units); the zoom transform scales it to the screen.
export const MAP_HALF_W = 1200;
export const MAP_HALF_H = 620;

// Map nodes: screen radius = MAP_R_BASE + MAP_R_SCALE*r at the world-fit zoom, growing only with sqrt(zoom).
export const MAP_R_BASE = 1.5;
export const MAP_R_SCALE = 0.45;
export const MAP_COLLIDE_ZOOM = 8;
export const MAP_LABEL_COUNT = 6;

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** World-unit radius of a node drawn in Map layout at zoom `zoomK`. */
export const mapNodeRadius = (r: number, zoomK: number, mapFitK: number): number =>
  (MAP_R_BASE + MAP_R_SCALE * r) / Math.sqrt(zoomK * mapFitK);

/** 0.051 -> "5.1%", 0.62 -> "62%". Never rounds a share that isn't 0 or 1 to 0% or 100%. */
export function sharePercent(share: number): string {
  if (share <= 0) return '0%';
  if (share >= 1 - 1e-9) return '100%';
  const percent = share * 100;
  if (percent < 0.1) return '<0.1%';
  return percent < 9.95 ? `${percent.toFixed(1)}%` : `${Math.min(99, Math.round(percent))}%`;
}

/**
 * The entry card's one line on its collaborators in view and the share of pairs among them whose strongest link runs
 * through it. With fewer than two there are no pairs.
 */
export const keyLinkLine = (collaborators: number, linked: LinkedPairs | null): string =>
  !linked || collaborators < 2
    ? `No pairs to link, ${collaborators.toLocaleString()} collaborator${collaborators === 1 ? '' : 's'} in view`
    : `Strongest link for ${sharePercent(linked.share)} of pairs among its ${collaborators.toLocaleString()} collaborators in view`;
