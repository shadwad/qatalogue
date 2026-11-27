import path from 'path';
import { createApp } from './app';
import { closeDb } from './services/db';
import { warmPaperSearch } from './services/paperSearch';
import { warmEmbedder } from './services/embedder';

async function startServer() {
  // PORT picks the port, so a second server (a test, a trial build) can run beside the usual one; without it, 3000.
  const requested = process.env.PORT;
  const isBundled = path.basename(process.argv[1] || '') === 'server.cjs';
  const dev = process.env.NODE_ENV ? process.env.NODE_ENV !== 'production' : !isBundled;
  const maxPort = dev ? 43857 : 65535;
  const PORT = requested ? Number(requested) : 3000;
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > maxPort) {
    throw new Error(`PORT must be a whole number from 1 to ${maxPort}, got "${requested}"`);
  }
  const HOST = process.env.HOST || '0.0.0.0';
  const rawWarmupHost = HOST === '0.0.0.0' || HOST === '::' || HOST === '' ? '127.0.0.1' : HOST;
  const warmupHost = rawWarmupHost.includes(':') && !rawWarmupHost.startsWith('[') ? `[${rawWarmupHost}]` : rawWarmupHost;

  const app = await createApp({ dev, port: PORT });

  let warmupTimer: NodeJS.Timeout | undefined;
  const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // Load the paper search index and query model in the background (first search would otherwise wait ~1-2 s).
    warmPaperSearch();
    warmEmbedder();

    // Warm up cache for default requests
    warmupTimer = setTimeout(async () => {
      console.log('Warming up cache...');
      try {
        const metaRes = await fetch(`http://${warmupHost}:${PORT}/api/meta`);
        if (!metaRes.ok) throw new Error(`Meta HTTP ${metaRes.status}`);
        const meta = (await metaRes.json()) as { year_min: number; year_max: number };
        await Promise.all([
          fetch(`http://${warmupHost}:${PORT}/api/entries/institutions?start_year=${meta.year_min}&end_year=${meta.year_max}&metric_mode=adj_frac_count`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }),
          fetch(`http://${warmupHost}:${PORT}/api/entries/researchers?start_year=${meta.year_min}&end_year=${meta.year_max}&metric_mode=frac_count`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }),
        ]);
        console.log('Cache warmed up!');
      } catch (err) {
        console.error('Cache warm up failed:', err instanceof Error ? err.message : err);
      }
    }, 1000);
    warmupTimer.unref();
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (warmupTimer) clearTimeout(warmupTimer);
    console.log(`Received ${signal}; shutting down gracefully...`);
    const force = setTimeout(() => {
      closeDb();
      process.exit(1);
    }, 10_000);
    force.unref();
    server.closeIdleConnections?.();
    server.close(() => {
      clearTimeout(force);
      closeDb();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch(err => {
  console.error(err);
  process.exit(1);
});
