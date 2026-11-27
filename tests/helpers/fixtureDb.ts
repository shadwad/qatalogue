import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Builds the serve DB test fixture into a scratch directory and returns its path and cleanup callback. */
export function buildFixtureServeDb(prefix: string): { dbPath: string; tempDir: string; repoRoot: string; cleanup: () => void } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempDir, 'serve.db');
  const venvPython = path.join(root, '.venv', 'bin', 'python3');
  const python = process.env.PYTHON || (fs.existsSync(venvPython) ? venvPython : 'python3');
  execFileSync(python, [path.join(root, 'tests', 'pipeline', 'fixture_serve_db.py'), dbPath], {
    cwd: root,
    env: { ...process.env, PYTHONPATH: root },
    stdio: 'pipe',
  });
  return {
    dbPath,
    tempDir,
    repoRoot: root,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}
