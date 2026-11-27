/**
 * Generates public/config/location_mapping.json from observed data codes and CLDR metadata (shared/locationNames.ts).
 *
 *   npx tsx scripts/build-locations.ts              codes from data/staging.db (what `make database` uses)
 *   npx tsx scripts/build-locations.ts --all        every location, for a fresh clone with no data yet
 *   npx tsx scripts/build-locations.ts --out FILE   write somewhere else (the existing file is left alone)
 *   npx tsx scripts/build-locations.ts --compare    write nothing; list how the result differs from the current file
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allLocations, describeLocations } from '../shared/locationNames';

interface CliOptions {
  all: boolean;
  compare: boolean;
  staged: boolean;
  out?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { all: false, compare: false, staged: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') opts.all = true;
    else if (arg === '--compare') opts.compare = true;
    else if (arg === '--staged') opts.staged = true;
    else if (arg === '--out') {
      const next = argv[++i];
      if (!next || next.startsWith('-')) throw new Error('--out requires a file path.');
      opts.out = next;
    } else if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length);
      if (!value || value.startsWith('-')) throw new Error('--out requires a file path.');
      opts.out = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opts = parseArgs(process.argv.slice(2));
const publicDirectory = process.env.PUBLIC_DIR ?? path.join(root, 'public');
const baseTarget = opts.out ?? process.env.LOCATION_MAPPING_PATH ?? path.join(publicDirectory, 'config', 'location_mapping.json');
const target = opts.staged && !opts.compare ? `${baseTarget}.tmp` : baseTarget;
const stagingPath = process.env.STAGING_DB_PATH ?? path.join(root, 'data', 'staging.db');

function observedCodes(): string[] {
  if (!existsSync(stagingPath)) throw new Error(`${stagingPath} does not exist. Run \`make import\` first, or use --all to list every location.`);
  const db = new Database(stagingPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`SELECT DISTINCT location_code AS code FROM institutions`).all() as { code: string | null }[];
    return rows.map(r => (r.code ?? '').trim().toUpperCase()).filter(Boolean);
  } finally {
    db.close();
  }
}

const mapping = opts.all ? allLocations() : describeLocations(observedCodes());

if (opts.compare) {
  const current: Record<string, { name: string; region: string }> = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
  const lines: string[] = [];
  for (const [code, next] of Object.entries(mapping)) {
    const before = current[code];
    if (!before) lines.push(`${code}: new (${next.name}, ${next.region || 'no region'})`);
    else {
      if (before.name !== next.name) lines.push(`${code}: name  ${before.name} -> ${next.name}`);
      if (before.region !== next.region) lines.push(`${code}: region  ${before.region || 'none'} -> ${next.region || 'none'}`);
    }
  }
  const gone = Object.keys(current).filter(code => !(code in mapping));
  console.log(`${Object.keys(mapping).length} locations; ${lines.length} difference(s) from ${target}${gone.length ? `; ${gone.length} in the file but not in the data` : ''}`);
  if (lines.length) console.log(lines.join('\n'));
} else {
  mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(mapping, null, 2)}\n`);
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  console.log(`Wrote ${Object.keys(mapping).length} locations to ${target}`);
}
