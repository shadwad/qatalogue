import express, { type Express } from 'express';
import path from 'path';
import fs from 'fs';
import { gunzipSync } from 'zlib';
import { acceptsGzip } from './services/cache';
import { distDirectory, publicDirectory, sendError } from './services/utils';

import institutionEntriesRouter from './routes/institutionEntries';
import researcherEntriesRouter from './routes/researcherEntries';
import facultyRouter from './routes/faculty';
import institutionsRouter from './routes/institutions';
import papersRouter from './routes/papers';
import networkRouter from './routes/network';
import metaRouter from './routes/meta';
import searchRouter from './routes/search';
import topicsRouter from './routes/topics';
import statsRouter from './routes/stats';
import { checkDatabase } from './services/db';

export interface AppOptions {
  dev?: boolean;
  port?: number;
  mountExtras?: (app: Express) => void;
}

/** Builds the Express application without starting a listener. */
export async function createApp({ dev = false, port = 3000, mountExtras }: AppOptions = {}): Promise<Express> {
  const app = express();
  app.disable('x-powered-by');

  app.get('/default-summary/:view.json.gz', async (req, res) => {
    try {
      if (req.params.view !== 'institutions' && req.params.view !== 'researchers') {
        return res.status(404).json({ error: 'Unknown default summary view' });
      }
      const assetPath = path.join(publicDirectory, `default-${req.params.view}.json.gz`);
      let raw: Buffer;
      try {
        raw = await fs.promises.readFile(assetPath);
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
          return res.status(404).json({ error: 'Default summary unavailable' });
        }
        throw error;
      }
      res.set('Cache-Control', 'no-cache').set('Vary', 'Accept-Encoding');
      if (acceptsGzip(req)) {
        return res.set('Content-Encoding', 'gzip').type('application/json').send(raw);
      }
      return res.type('application/json').send(gunzipSync(raw));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.use('/api', (_req, _res, next) => { checkDatabase(); next(); });
  app.use('/api/entries/institutions', institutionEntriesRouter);
  app.use('/api/entries/researchers', researcherEntriesRouter);
  app.use('/api/faculty', facultyRouter);
  app.use('/api/institutions', institutionsRouter);
  app.use('/api/papers', papersRouter);
  app.use('/api/network', networkRouter);
  app.use('/api/meta', metaRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/topics', topicsRouter);
  app.use('/api/stats', statsRouter);
  mountExtras?.(app);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : 500;
    const type = typeof err === 'object' && err !== null && 'type' in err ? String((err as { type: unknown }).type) : '';
    if (type === 'entity.parse.failed' || (err instanceof SyntaxError && status === 400)) {
      res.status(400).json({ error: 'Invalid JSON request body' });
      return;
    }
    if (type === 'entity.too.large' || status === 413) {
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
    sendError(res, err);
  });

  if (dev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      // Vite's live-reload socket sits a fixed distance above the site's port (24678, its default, beside 3000), so two
      // servers on different ports don't collide.
      server: { middlewareMode: true, hmr: { port: port + 21678 } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve generated pipeline config live from public/config before static dist/ so `make all` updates take effect without a rebuild.
    app.use('/config', express.static(path.join(publicDirectory, 'config'), {
      setHeaders: res => res.set('Cache-Control', 'no-cache'),
    }));
    app.use('/config', (_req, res) => res.status(404).json({ error: 'Not found' }));
    app.use('/assets', express.static(path.join(distDirectory, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }));
    app.use('/assets', (_req, res) => res.status(404).end());
    app.use(express.static(distDirectory, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-cache');
      },
    }));
    app.get('*', (_req, res) => {
      res.set('Cache-Control', 'no-cache').sendFile(path.join(distDirectory, 'index.html'));
    });
  }

  return app;
}
