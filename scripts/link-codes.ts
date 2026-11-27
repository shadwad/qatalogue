/**
 * Appends missing IDs to the append-only code lists in shared/linkCodes.ts.
 *
 *   npm run link-codes            append missing IDs
 *   npm run link-codes -- --check list missing IDs, change nothing, exit 1 if any are missing
 *
 * Each short-link code is the ID's index in its list, so entries must only ever be appended.
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface TaxonomyFile {
  topics: { id: string; subtopics?: { id: string }[] }[];
  platforms: { id: string }[];
}

interface ScopeFile {
  venues: { name: string }[];
}

const args = process.argv.slice(2);
for (const arg of args) {
  if (arg !== '--check') throw new Error(`Unknown argument: ${arg}`);
}
const checkOnly = args.includes('--check');

const root = new URL('../', import.meta.url);
const readJson = <T>(relPath: string): T => JSON.parse(readFileSync(new URL(relPath, root), 'utf8')) as T;
const taxonomy = readJson<TaxonomyFile>('data/taxonomy.json');
const { venues } = readJson<ScopeFile>('pipeline/config/scope.json'); // source of public/config/venues.json

const wanted: Record<string, string[]> = {
  TOPICS: taxonomy.topics.map(t => t.id),
  SUBTOPICS: taxonomy.topics.flatMap(t => (t.subtopics ?? []).map(s => `${t.id}/${s.id}`)),
  PLATFORMS: taxonomy.platforms.map(p => p.id),
  VENUES: venues.map(v => v.name),
};

const file = new URL('shared/linkCodes.ts', root);
let text = readFileSync(file, 'utf8');
const added: string[] = [];
for (const [name, ids] of Object.entries(wanted)) {
  const list = new RegExp(`(export const ${name} = \\[\\r?\\n)([\\s\\S]*?)(\\] as const;)`);
  const match = list.exec(text);
  if (!match) throw new Error(`${name} is not in shared/linkCodes.ts`);
  const have = new Set<string>(JSON.parse(`[${match[2].trim().replace(/,$/, '')}]`) as string[]);
  const missing = [...new Set(ids)].filter(id => !have.has(id));
  added.push(...missing.map(id => `${name}: ${id}`));
  if (missing.length) {
    const appended = missing.map(id => `  ${JSON.stringify(id)},\n`).join('');
    text = text.replace(list, (_, open: string, body: string, close: string) => `${open}${body}${appended}${close}`);
  }
}

if (!added.length) console.log('Every id already has a code.');
else if (checkOnly) {
  console.log(`These ids have no short-link code:\n  ${added.join('\n  ')}\nRun: npm run link-codes`);
  process.exit(1);
} else {
  writeFileSync(file, text);
  console.log(`Appended ${added.length} code${added.length === 1 ? '' : 's'} to shared/linkCodes.ts:\n  ${added.join('\n  ')}`);
}
