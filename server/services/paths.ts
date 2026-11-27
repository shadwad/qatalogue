import fs from 'fs';
import path from 'path';

function findRootFrom(start: string): string | null {
  let dir = start;
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Resolves the repository or runtime root regardless of entrypoint nesting depth. */
function findProjectRoot(): string {
  if (process.env.PROJECT_ROOT) return path.resolve(process.env.PROJECT_ROOT);
  const entryDir = path.dirname(path.resolve(process.argv[1] || process.cwd()));
  return findRootFrom(entryDir) ?? findRootFrom(process.cwd()) ?? path.dirname(entryDir);
}

export const projectRoot = findProjectRoot();
export const publicDirectory = path.join(projectRoot, 'public');
export const distDirectory = path.join(projectRoot, 'dist', 'client');
