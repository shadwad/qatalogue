/** Shared status, empty-state, and failure copy used across Explorer, Network, and Statistics views. */
export const LOADING = {
  /** The institution or researcher list, and the sidebar's counts: looking at the system. */
  list: 'Observing…',
  /** The Charts view and each chart: taking measurements. */
  charts: 'Measuring…',
  /** Building the collaboration network: linking the nodes. */
  network: 'Entangling…',
  /** Redrawing the network for new filters or another layout. */
  layout: 'Projecting…',
  /** A row's details, the part of the system that belongs to one entry (a partial trace). */
  detail: 'Tracing…',
  /** The paper search, getting through to the papers. */
  search: 'Tunnelling…',
  /** Saving a chart as an image. */
  image: 'Imaging…',
  /** A retry in progress. */
  retry: 'Trying again…',
} as const;

/** Nothing matches: an empty state. */
export const EMPTY_HEADLINE = 'Vacuum state';
/** Something could not load. */
export const FAILURE_HEADLINE = 'Decoherence';

/** Concise scope disclaimers shown alongside result lists and the query prompt. */
export const LIST_CAUTION = {
  institution: 'Counts of papers in the selected journals, not a measure of quality or impact. Work elsewhere is not included.',
  researcher: 'Counts of papers in the selected journals, not a measure of quality or impact. Authors are matched automatically, so some records mix up or split people.',
} as const;
