import codeMappings from 'cldr-core/supplemental/codeMappings.json';
import { locationCodes } from './locationNames';

/** ISO 3166-1 numeric code (as the map's shapes carry it) to alpha-2. */
const NUMERIC_TO_ALPHA2 = new Map<string, string>();
const CURRENT = new Set(locationCodes()); // Exclude retired ISO codes that share a numeric code.
for (const [code, { _numeric }] of Object.entries(codeMappings.supplemental.codeMappings as Record<string, { _numeric?: string }>)) {
  if (_numeric && CURRENT.has(code)) NUMERIC_TO_ALPHA2.set(_numeric.padStart(3, '0'), code);
}

export const alpha2OfNumeric = (id: string | number | undefined): string | undefined =>
  id === undefined ? undefined : NUMERIC_TO_ALPHA2.get(String(id).padStart(3, '0'));
