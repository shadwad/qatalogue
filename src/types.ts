export type SortColumn = 'institution' | 'secondary' | 'score';
export type SortDirection = 'asc' | 'desc';
export type ViewMode = 'institution' | 'researcher';
export type MetricMode = 'none' | 'adj_frac_count' | 'frac_count' | 'total_count';
export type DisplayMode = 'list' | 'network';
/** Whether a paper must have any of the selected topics or platforms, or all of them. */
export type FilterMatch = 'any' | 'all';
/** The top-level switch: Explore holds List and Network; Statistics holds the figures. */
export type Section = 'explore' | 'statistics';
/** What the search bar searches: researcher/institution names, or paper topics (the list and network count only matching papers). */
export type SearchScope = 'names' | 'papers';
/** Institution network only: anchored to a world map (the default), or a free force layout. */
export type NetworkLayout = 'force' | 'map';

/** The curated topic list (public/config/taxonomy.json, written by pipeline/scripts/assign_topics.py). */
export interface TaxonomySubtopic {
  id: string;
  name: string;
  definition: string;
  search_terms?: string[];
}

export interface TaxonomyTopic {
  id: string;
  name: string;
  definition: string;
  search_terms?: string[];
  subtopics: TaxonomySubtopic[];
}

export interface TaxonomyPlatform {
  id: string;
  name: string;
  definition?: string;
}

export interface Taxonomy {
  topics: TaxonomyTopic[];
  platforms: TaxonomyPlatform[];
}

export interface VenueConfig {
  name: string;
  openalex_id: string;
  requires_topic_filter?: boolean;
}

export interface LocationMappingEntry {
  name: string;
  region: string;
}

export type LocationMapping = Record<string, LocationMappingEntry>;

export interface DatasetMeta {
  year_min: number;
  year_max: number;
  totals: Record<'institution' | 'researcher' | 'paper', number>;
  generated_at?: string;
}

export interface EntriesMetadata {
  generated_at: string;
}

export interface Paper {
  paper_id: string;
  title: string | null;
  year: number | null;
  venue_id?: string | null;
  venue_name: string | null;
  score_share: number;
  total_authors?: number | null;
  canonical_author_count?: number | null;
  topics?: string | string[] | null;
  doi?: string | null;
}

/** Where a paper title links to: its DOI when known, otherwise its OpenAlex record. */
export const paperLink = (p: { paper_id: string; doi?: string | null }) =>
  p.doi
    ? { href: `https://doi.org/${p.doi.split('/').map(encodeURIComponent).join('/')}`, label: 'View paper (DOI)' }
    : { href: `https://openalex.org/${p.paper_id}`, label: 'View paper on OpenAlex' };

export interface FacultyMember {
  author_id: string;
  author_name: string | null;
  orcid: string | null;
  openalex_id: string | null;
  fractional_score: number;
  paper_count: number;
}

export interface InstitutionEntry {
  type?: 'institution';
  institution_id: string;
  institution_name: string;
  location_code: string | null;
  ror: string | null;
  openalex_id: string | null;
  total_fractional_score: number;
  core_faculty_count: number;
  paper_count: number;
  fts_rank?: number;
  location: string;
  region: string;
}

export interface ResearcherInstitution {
  institution_id: string;
  institution_name: string;
  ror: string | null;
  openalex_id: string | null;
  location_code: string | null;
  latest_year: number | null;
  fractional_score: number;
  paper_count: number;
  location: string;
  region: string;
}

export interface ResearcherEntry {
  type: 'researcher';
  author_id: string;
  author_name: string;
  orcid: string | null;
  openalex_id?: string | null;
  total_fractional_score: number;
  paper_count: number;
  max_year: number | null;
  latest_affiliation: string | null;
  location_code: string | null;
  fts_rank?: number;
  location: string;
  region: string;
}

export type ExplorerEntry = InstitutionEntry | ResearcherEntry;

export const isResearcherEntry = (entry: ExplorerEntry): entry is ResearcherEntry => entry.type === 'researcher';

export interface EntriesResponse<T extends ExplorerEntry = ExplorerEntry> {
  entries: T[];
  metadata: EntriesMetadata;
}

export interface FacultyResponse {
  faculty: FacultyMember[];
}

export interface AuthorInstitutionsResponse {
  institutions: ResearcherInstitution[];
}

export interface PapersResponse {
  papers: Paper[];
}

export interface LocationCounts {
  locations: Record<string, number>;
  regions: Record<string, number>;
}
