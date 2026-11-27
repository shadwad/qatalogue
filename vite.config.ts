import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, type HtmlTagDescriptor, type Plugin } from 'vite';

// Inject __VENUE_COUNT__ from SCOPE_PATH, or from the built corpus (public/config/corpus.json), falling back to scope.json.
function venueCount(scopePath?: string): Plugin {
  return {
    name: 'qatalogue-venue-count',
    transformIndexHtml(html) {
      let count = 'selected';
      const candidates = scopePath
        ? [scopePath]
        : ['public/config/corpus.json', 'pipeline/config/scope.json'];
      for (const rel of candidates) {
        try {
          const parsed = JSON.parse(fs.readFileSync(path.resolve(__dirname, rel), 'utf8'));
          if (Array.isArray(parsed?.venues) && parsed.venues.length > 0) {
            count = String(parsed.venues.length);
            break;
          }
        } catch {
          // Try the next candidate; without any file the descriptions say "selected venues".
        }
      }
      return html.replaceAll('__VENUE_COUNT__', count);
    },
  };
}

// Inject optional canonical, OpenGraph, and touch icon tags.
function siteUrl(address: string): Plugin {
  const url = address.replace(/\/+$/, '');
  return {
    name: 'qatalogue-site-url',
    transformIndexHtml(html) {
      const tags: HtmlTagDescriptor[] = [];
      if (fs.existsSync(path.resolve(__dirname, 'public', 'apple-touch-icon.png'))) {
        tags.push({ tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }, injectTo: 'head' });
      }
      if (url) {
        tags.push(
          { tag: 'link', attrs: { rel: 'canonical', href: `${url}/` }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:url', content: `${url}/` }, injectTo: 'head' },
        );
      }
      if (fs.existsSync(path.resolve(__dirname, 'public', 'social-preview.png'))) {
        const image = `${url}/social-preview.png`;
        tags.push(
          { tag: 'meta', attrs: { property: 'og:image', content: image }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:image:height', content: '630' }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:image:alt', content: 'Qatalogue: an open bibliometric explorer for quantum information science and technology' }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'twitter:image', content: image }, injectTo: 'head' },
        );
      } else {
        tags.push({ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' }, injectTo: 'head' });
      }
      return {
        html,
        tags,
      };
    },
  };
}

// Load optional site.config.json overrides if present.
function siteConfig(): unknown {
  const file = path.resolve(__dirname, 'site.config.json');
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`site.config.json is not valid JSON (${error instanceof Error ? error.message : String(error)}).`);
  }
}

function omitGeneratedPublic(): Plugin {
  return {
    name: 'qatalogue-omit-generated-public',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist', 'client');
      fs.rmSync(path.join(outDir, 'config'), { recursive: true, force: true });
      if (!fs.existsSync(outDir)) return;
      for (const entry of fs.readdirSync(outDir)) {
        if (/^default-.*\.json\.gz(\.tmp)?$/.test(entry) || entry.endsWith('.tmp')) {
          fs.rmSync(path.join(outDir, entry), { force: true });
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  return {
    plugins: [react(), tailwindcss(), venueCount(env.SCOPE_PATH || undefined), siteUrl(env.SITE_URL ?? ''), omitGeneratedPublic()],
    build: {
      outDir: 'dist/client',
      emptyOutDir: true,
      // world-atlas/countries-50m.json (~756 kB raw) is lazy-loaded only for Map view.
      chunkSizeWarningLimit: 800,
    },
    // App version and optional site config constants.
    define: {
      __APP_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version),
      __SITE_CONFIG__: JSON.stringify(siteConfig()),
    },
  };
});
