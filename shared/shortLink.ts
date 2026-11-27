import { encodeSeries, FIELD_CODES, FORM_CODES, METRIC_CODES, PANEL_CODES } from './chart';
import { PLATFORMS, SUBTOPICS, TOPICS, VENUES } from './linkCodes';
import { locationCodes, shortName } from './locationNames';

/**
 * Stateless URL query shortener for shared links (`expandSearch` restores keys for `hooks/urlState.ts`).
 *
 * Encodings:
 * - `topic` -> `T`, `platform` -> `P`, `venue` -> `V` using append-only base-36 indices (`_t0`, `_p0`, `_v0`) in `linkCodes.ts`
 * - `location` -> `L` as concatenated ISO 3166-1 alpha-2 codes from `locationNames.ts`
 * - `from`/`to` -> `Y` (`from-to`), `sort` -> `S` (`col.dir`), `fig` -> `F` via single-char field tables in `chart.ts`
 *
 * Unknown values stay readable in place; unknown future codes are ignored while preserving valid parameters.
 */

type Kind = 't' | 's' | 'p' | 'v';
const TABLES: Record<Kind, readonly string[]> = { t: TOPICS, s: SUBTOPICS, p: PLATFORMS, v: VENUES };
const LOOKUP = Object.fromEntries((Object.keys(TABLES) as Kind[]).map(kind => [kind, new Map(TABLES[kind].map((id, i) => [id, i]))])) as Record<Kind, Map<string, number>>;

/** Long key → [short key, the kinds of id its values are]. The topic filter takes subtopics too. */
const ID_KEYS: Record<string, readonly [string, string]> = { topic: ['T', 'ts'], platform: ['P', 'p'], venue: ['V', 'v'] };
const LONG_ID_KEY = Object.fromEntries(Object.entries(ID_KEYS).map(([long, [short, kinds]]) => [short, [long, kinds] as const]));
/** Every key only the short form uses, for telling a short link from a long one. */
export const SHORT_KEYS = [...Object.values(ID_KEYS).map(([short]) => short), 'L', 'F', 'Y', 'S'];

const CODE = /^_([tspv])([0-9a-z]+)$/;
const CODES = /^(_[tspv][0-9a-z]+)+$/;

export const codeFor = (kind: Kind, id: string): string | undefined => {
  const index = LOOKUP[kind].get(id);
  return index === undefined ? undefined : `_${kind}${index.toString(36)}`;
};

const decodeCode = (text: string): { kind: Kind; id: string | undefined } | null => {
  const match = CODE.exec(text);
  if (!match) return null;
  const kind = match[1] as Kind;
  return { kind, id: TABLES[kind][parseInt(match[2], 36)] };
};

/** The id a code stands for: undefined for a code the tables don't know, null when the text isn't a code at all. */
const idFor = (text: string): string | undefined | null => {
  const decoded = decodeCode(text);
  return decoded ? decoded.id : null;
};

const coded = (kinds: string, id: string) => ([...kinds] as Kind[]).map(kind => codeFor(kind, id)).find(Boolean);

// Locations are stored by name; the short form writes the ISO code, which is always two capitals.
let locationTables: { byCode: Readonly<Record<string, string>>; byName: Map<string, string> } | null = null;
function getLocationTables() {
  if (!locationTables) {
    const byCode: Record<string, string> = Object.fromEntries(locationCodes().map(iso => [iso, shortName(iso)!]));
    const byName = new Map(Object.entries(byCode).map(([iso, name]) => [name, iso]));
    locationTables = { byCode, byName };
  }
  return locationTables;
}
const ISO_LIST = /^([A-Z]{2})+$/;

// A chart's words by position in `chart.<form>.<row>.<split>.<value>.<xMetric>.<bin>.<panels>.<series>` (see `encodeSpec`,
// shared/chart.ts). The bin is a number and stays as it is.
const invert = (codes: Readonly<Record<string, string>>) => new Map(Object.entries(codes).map(([word, code]) => [code, word]));
const SPEC_WORDS: readonly (Readonly<Record<string, string>> | undefined)[] = [FORM_CODES, FIELD_CODES, FIELD_CODES, METRIC_CODES, METRIC_CODES, undefined, PANEL_CODES];
const SPEC_WORDS_INVERSE = SPEC_WORDS.map(codes => codes && invert(codes));
const SERIES_AT = 8; // the index of the series in the dot-separated figure, "chart" being 0
const SERIES_LIST = '*';

function shortenFigure(value: string): string {
  const wide = value.endsWith('~wide');
  const parts = (wide ? value.slice(0, -5) : value).split('.');
  if (parts[0] !== 'chart') return value;
  SPEC_WORDS.forEach((codes, i) => { if (codes && parts[i + 1]) parts[i + 1] = codes[parts[i + 1]] ?? parts[i + 1]; });
  if (parts[SERIES_AT]) {
    try {
      const series: unknown = JSON.parse(decodeURIComponent(parts[SERIES_AT]));
      if (Array.isArray(series) && series.length) {
        const codes = series.map(item => typeof item === 'string' ? coded('tspv', item) : undefined);
        if (!codes.some(code => code === undefined)) parts[SERIES_AT] = SERIES_LIST + codes.join(SERIES_LIST);
      }
    } catch { /* leave the picks as they are */ }
  }
  return parts.join('.') + (wide ? '~wide' : '');
}

function expandFigure(value: string): string | null {
  const wide = value.endsWith('~wide');
  const parts = (wide ? value.slice(0, -5) : value).split('.');
  if (parts[0] !== 'chart') return value;
  for (let i = 0; i < SPEC_WORDS_INVERSE.length; i++) {
    const inverse = SPEC_WORDS_INVERSE[i];
    if (!inverse || !parts[i + 1]) continue;
    const word = inverse.get(parts[i + 1]);
    if (word !== undefined) parts[i + 1] = word;
    else if (/^[0-9A-Z]$/.test(parts[i + 1])) return null; // a code from a newer site version: the chart can't be drawn as meant
  }
  const list = parts[SERIES_AT];
  if (list?.startsWith(SERIES_LIST)) {
    const ids = list.slice(1).split(SERIES_LIST).map(idFor);
    if (ids.some(id => !id)) return null;
    parts[SERIES_AT] = encodeSeries(ids as string[]);
  }
  return parts.join('.') + (wide ? '~wide' : '');
}

const toText = (params: URLSearchParams) => {
  const text = params.toString();
  return text ? `?${text}` : '';
};

/**
 * The short spelling of a query string as `toSearch` writes it ("?topic=…"); a string with nothing to shorten comes back as it
 * was. Values that share a key are written once, at the place the first of them was.
 */
export function toShortSearch(search: string): string {
  const input = new URLSearchParams(search);
  const out = new URLSearchParams();
  const done = new Set<string>();
  for (const [key, value] of input) {
    const ids = ID_KEYS[key];
    if (ids) {
      if (done.has(key)) continue;
      done.add(key);
      const codes: string[] = [];
      const plain: string[] = [];
      for (const id of input.getAll(key)) {
        const code = coded(ids[1], id);
        (code ? codes : plain).push(code ?? id);
      }
      if (codes.length) out.append(ids[0], codes.join(''));
      plain.forEach(id => out.append(ids[0], id));
    } else if (key === 'location') {
      if (done.has(key)) continue;
      done.add(key);
      const { byName } = getLocationTables();
      const names = input.getAll(key);
      const isos = names.map(name => byName.get(name));
      if (isos.some(Boolean)) out.append('L', isos.filter(Boolean).join(''));
      names.filter((_, i) => !isos[i]).forEach(name => out.append('L', name));
    } else if (key === 'from' || key === 'to') {
      if (done.has('years')) continue;
      done.add('years');
      const [from, to] = [input.get('from'), input.get('to')];
      const year = /^\d{1,4}$/;
      if ((from === null || year.test(from)) && (to === null || year.test(to))) out.append('Y', `${from ?? ''}-${to ?? ''}`);
      else { // not a year: leave both as they are, for the parser to ignore
        if (from !== null) out.append('from', from);
        if (to !== null) out.append('to', to);
      }
    } else if (key === 'sort' && /^[a-z]+:(asc|desc)$/.test(value)) out.append('S', value.replace(':', '.'));
    else if (key === 'fig') out.append('F', shortenFigure(value));
    else out.append(key, value);
  }
  return toText(out);
}

/** The full spelling of a short query string. A query with no short key is returned untouched, so existing links are unaffected. */
export function expandSearch(search: string): string {
  const params = new URLSearchParams(search);
  if (!SHORT_KEYS.some(key => params.has(key))) return search;
  const out = new URLSearchParams();
  for (const [key, value] of params) {
    const ids = LONG_ID_KEY[key];
    if (ids) {
      if (!CODES.test(value)) out.append(ids[0], value); // an id with no code, written as it is
      else for (const code of value.split(/(?=_)/)) {
        const decoded = decodeCode(code);
        if (decoded?.id && ids[1].includes(decoded.kind)) out.append(ids[0], decoded.id);
      }
    } else if (key === 'L') {
      if (!ISO_LIST.test(value)) out.append('location', value);
      else {
        const { byCode } = getLocationTables();
        for (const iso of value.match(/../g)!) if (byCode[iso]) out.append('location', byCode[iso]);
      }
    } else if (key === 'Y') {
      const match = /^(\d{1,4})?-(\d{1,4})?$/.exec(value);
      if (match?.[1]) out.append('from', match[1]);
      if (match?.[2]) out.append('to', match[2]);
    } else if (key === 'S') {
      if (/^[a-z]+\.(asc|desc)$/.test(value)) out.append('sort', value.replace('.', ':'));
    } else if (key === 'F') {
      const figure = expandFigure(value);
      if (figure !== null) out.append('fig', figure);
    } else out.append(key, value);
  }
  return toText(out);
}
