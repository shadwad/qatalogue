/**
 * Imported first by every test that loads server code: public/config/location_mapping.json is generated from the data, so a
 * fresh clone doesn't have it. This writes the mapping for every location to a scratch folder and points the server at it
 * (LOCATION_MAPPING_PATH), so tests need no build and touch no file of the project.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allLocations } from '../../shared/locationNames';

const dir = mkdtempSync(path.join(os.tmpdir(), 'qatalogue-locations-'));
const file = path.join(dir, 'location_mapping.json');
writeFileSync(file, JSON.stringify(allLocations()));
process.env.LOCATION_MAPPING_PATH = file;
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
export const locationMappingPath = file;
