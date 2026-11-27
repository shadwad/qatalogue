import cldrNames from 'cldr-localenames-full/main/en/territories.json';
import containment from 'cldr-core/supplemental/territoryContainment.json';

/**
 * Location display names and UN M49 region groupings read from the pinned Unicode CLDR packages
 * (`cldr-localenames-full` and `cldr-core`). ISO numeric map lookups live in `shared/locationNumeric.ts`
 * so the eager bundle avoids `codeMappings.json`. Uses CLDR's `-alt-short` label when present.
 */
const NAMES = cldrNames.main.en.localeDisplayNames.territories as Record<string, string>;

/** Codes CLDR lists that are not places a paper can be from: groupings, the EU, private-use and exceptional codes. */
const NOT_LOCATIONS = new Set(['AC', 'CP', 'CQ', 'DG', 'EA', 'EU', 'EZ', 'IC', 'TA', 'UN', 'QO', 'ZZ', 'XA', 'XB']);
const PLACE = /^[A-Z]{2}$/;

export const shortName = (code: string): string | undefined => NAMES[`${code}-alt-short`] ?? NAMES[code];

type Containment = Record<string, { _contains?: string[] }>;
const parents = new Map<string, string[]>();
for (const [group, { _contains = [] }] of Object.entries(containment.supplemental.territoryContainment as Containment)) {
  for (const child of _contains) {
    const list = parents.get(child);
    if (list) list.push(group);
    else parents.set(child, [group]);
  }
}
const ancestors = (code: string): Set<string> => {
  const seen = new Set<string>();
  const queue = [code];
  while (queue.length) for (const parent of parents.get(queue.pop()!) ?? []) if (!seen.has(parent)) { seen.add(parent); queue.push(parent); }
  return seen;
};

const regionCache = new Map<string, string>();
let cachedLocationCodes: string[] | null = null;

/**
 * The continent grouping used by the filters, charts and map. CLDR's groupings are the UN M49 ones: Africa 002, Asia 142,
 * Europe 150, Oceania 009, North America 003 (with Central America and the Caribbean), South America 005. Antarctica has
 * none here. '' means no region.
 */
export const regionOf = (code: string): string => {
  const cached = regionCache.get(code);
  if (cached !== undefined) return cached;
  let region = '';
  if (code !== 'AQ') {
    const up = ancestors(code);
    for (const [group, label] of [['003', 'North America'], ['005', 'South America'], ['002', 'Africa'], ['142', 'Asia'], ['150', 'Europe'], ['009', 'Oceania']] as const) {
      if (up.has(group)) { region = label; break; }
    }
  }
  regionCache.set(code, region);
  return region;
};

/** Every two-letter code with a CLDR name and a place in the world groupings, for the map and the tests. */
export const locationCodes = (): string[] => {
  cachedLocationCodes ??= Object.keys(NAMES)
    .filter(code => PLACE.test(code) && !NOT_LOCATIONS.has(code) && (regionOf(code) !== '' || code === 'AQ'))
    .sort();
  return [...cachedLocationCodes];
};

const isLocationCode = (code: string) => PLACE.test(code) && !NOT_LOCATIONS.has(code) && shortName(code) !== undefined;

/** Return `{ name, region }` for each valid code; throws if any code has no CLDR mapping. */
export function describeLocations(codes: Iterable<string>): Record<string, { name: string; region: string }> {
  const out: Record<string, { name: string; region: string }> = {};
  const unknown: string[] = [];
  for (const code of [...new Set(codes)].sort()) {
    const name = shortName(code);
    if (name === undefined || !isLocationCode(code)) unknown.push(code);
    else out[code] = { name, region: regionOf(code) };
  }
  if (unknown.length) throw new Error(`No CLDR name for location code(s): ${unknown.join(', ')}`);
  return out;
}

export const allLocations = () => describeLocations(locationCodes());
