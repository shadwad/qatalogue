import fs from 'fs';
import path from 'path';
import { LRUCache } from 'lru-cache';
import { projectRoot } from './utils';

type PipelineOptions = NonNullable<Parameters<typeof import('@huggingface/transformers').pipeline>[2]>;
type ModelDtype = PipelineOptions['dtype'];

/** Same file the pipeline embeds papers with, so query and paper vectors are comparable. */
export const embeddingConfig: {
  model: string; revision: string; dtype: ModelDtype; pooling: 'cls' | 'mean'; maxLength: number; dim: number;
  queryPrefix: string; cacheDir: string;
} = JSON.parse(fs.readFileSync(path.join(projectRoot, 'pipeline', 'config', 'embedding.json'), 'utf8'));
if (!/^[0-9a-f]{40}$/.test(embeddingConfig.revision ?? '')) {
  throw new Error(`embedding.json: revision must be a full commit hash of the model repository, got ${embeddingConfig.revision}`);
}
/** model@revision, as the pipeline stores it with the paper vectors: the search index must have been built with it. */
export const embeddingId = `${embeddingConfig.model}@${embeddingConfig.revision}`;

type Extractor = (texts: string[], opts: Record<string, unknown>) => Promise<{ data: Float32Array; dims: number[] }>;
let extractor: Promise<Extractor> | null = null;

function loadExtractor(): Promise<Extractor> {
  if (!extractor) {
    extractor = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = path.resolve(projectRoot, embeddingConfig.cacheDir);
      env.allowLocalModels = false;
      const t0 = Date.now();
      const ex = await pipeline('feature-extraction', embeddingConfig.model, {
        revision: embeddingConfig.revision,
        dtype: embeddingConfig.dtype,
      });
      console.log(`Query embedder ready (${embeddingId}, ${Date.now() - t0} ms)`);
      return ex as unknown as Extractor;
    })();
    extractor.catch(() => { extractor = null; }); // allow a retry after a failed load
  }
  return extractor;
}

const queryCache = new LRUCache<string, Float32Array>({ max: 1000 });

/** L2-normalised query vector (with the model's query instruction prefix). */
export async function embedQuery(text: string): Promise<Float32Array> {
  const cacheKey = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const cached = queryCache.get(cacheKey);
  if (cached) return cached;
  const ex = await loadExtractor();
  const out = await ex([embeddingConfig.queryPrefix + text], {
    pooling: embeddingConfig.pooling, normalize: true, truncation: true, max_length: embeddingConfig.maxLength,
  });
  const vec = Float32Array.from(out.data);
  if (vec.length !== embeddingConfig.dim) {
    throw new Error(`Query embedder returned dim ${vec.length}, config says ${embeddingConfig.dim}`);
  }
  queryCache.set(cacheKey, vec);
  return vec;
}

export function warmEmbedder(): Promise<unknown> {
  return loadExtractor().catch((err: unknown) => console.error('Query embedder failed to load:', err instanceof Error ? err.message : err));
}
