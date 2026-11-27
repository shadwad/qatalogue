import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { projectRoot } from './paths';

export const dbPath = path.resolve(
  process.env.DB_PATH || path.join(projectRoot, 'data', 'serve.db'),
);

type Db = ReturnType<typeof Database>;

/**
 * The served database. The pipeline replaces serve.db wholesale (finalize_build.py moves the new file over the old), so a
 * connection opened at startup would keep reading the old file for as long as the server runs. getDb() returns one
 * handle that always reads the file as it is now: at most once a second it checks whether the file was replaced and, if
 * so, opens the new one, closes the old one and runs the callbacks registered with onDatabaseChange, which empty every
 * cache built from the old data. Routes keep their `const db = getDb()`.
 */
const CHECK_EVERY_MS = 1000;
let current: Db | null = null;
let identity = '';
let generated = new Date(0);
let generation = 0;
let lastCheck = 0;
const tableCache = new Map<string, boolean>();
const listeners: Array<() => void> = [];

/** Runs `fn` after the server has switched to a new serve.db (not on the first connection). */
export function onDatabaseChange(fn: () => void): void {
  listeners.push(fn);
}

/** Monotonic count of database replacements since startup. */
export function databaseGeneration(): number {
  refresh();
  return generation;
}

/** Cached check for whether `name` exists as a table in the active serve.db. */
export function hasTable(name: string): boolean {
  refresh();
  const cached = tableCache.get(name);
  if (cached !== undefined) return cached;
  const exists = Boolean(current?.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  tableCache.set(name, exists);
  return exists;
}

/** When the database being served was built (the file's modification time). */
export function databaseGeneratedAt(): Date {
  refresh();
  return generated;
}

function configureReadonlyConnection(conn: Db): void {
  conn.pragma('temp_store = MEMORY');
  conn.pragma('cache_size = -65536');
  conn.pragma('mmap_size = 268435456');
}

function refresh(): void {
  const now = Date.now();
  if (current && now - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = now;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dbPath);
  } catch (error) {
    if (current) return; // mid-swap or removed: keep serving what is open
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to connect to SQLite database at ${dbPath}: ${detail}`);
  }
  const id = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  if (current && id === identity) return;
  let next: Db;
  try {
    next = new Database(dbPath, { readonly: true });
    try {
      configureReadonlyConnection(next);
    } catch (pragmaError) {
      next.close();
      throw pragmaError;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (current) {
      console.warn(`Could not open the replaced database yet (${detail}); still serving the previous one`);
      return; // identity is unchanged, so the next check tries again
    }
    throw new Error(`Failed to connect to SQLite database at ${dbPath}: ${detail}`);
  }
  const previous = current;
  current = next;
  identity = id;
  generated = stat.mtime;
  if (!previous) {
    console.log('Connected to SQLite database at', dbPath);
    return;
  }
  generation += 1;
  tableCache.clear();
  try {
    previous.close();
  } catch (error) {
    console.warn('Failed to close previous database handle:', error);
  }
  console.log('Database replaced; reloaded', dbPath);
  for (const fn of listeners) {
    try { fn(); } catch (error) { console.error('Cache reset after a database change failed:', error); }
  }
}

const handle = new Proxy({} as Db, {
  get(_target, property) {
    refresh();
    const value: unknown = Reflect.get(current as Db, property);
    return typeof value === 'function' ? value.bind(current) : value;
  },
});

/** Looks for a replaced file now (at most once a second). Called on every API request, so that a response served from a
 * cache, which never touches the database, still notices a new build. */
export function checkDatabase(): void {
  refresh();
}

export function getDb(): Db {
  refresh(); // the first call connects, and fails loudly when it cannot
  return handle;
}

/** Closes the active database handle cleanly for shutdown or test teardown. */
export function closeDb(): void {
  const prev = current;
  current = null;
  identity = '';
  lastCheck = 0;
  tableCache.clear();
  if (!prev) return;
  try {
    prev.close();
  } catch (error) {
    console.warn('Failed to close SQLite database handle:', error);
  }
}
