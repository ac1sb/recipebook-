// Runs The Borsari Kitchen on your own computer: `npm start`.
// The library is saved in data/library.json and photos in data/images/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './lib/app.js';
import { createFileStore } from './lib/storage/file-store.js';
import { createFsImages } from './lib/storage/fs-images.js';
import { claudeEnabled } from './lib/claude.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.RECIPEBOOK_DATA || path.join(here, 'data', 'library.json');
const store = createFileStore(dataFile);

export const app = createApp({
  store,
  images: createFsImages(path.join(path.dirname(dataFile), 'images')),
  password: process.env.APP_PASSWORD || null,
  assets: serveStatic({ root: path.relative(process.cwd(), path.join(here, 'public')) || '.' }),
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  // Recipes saved before photos were kept: copy them now, in the background.
  store.list().then(async (entries) => {
    for (const e of entries) if (!e.archivedAt) await app.archive(e.id).catch(() => {});
  });
  serve({ fetch: app.fetch, port }, () => {
    console.log(`The Borsari Kitchen is running at http://localhost:${port}`);
    console.log(`Claude features: ${claudeEnabled() ? 'on' : 'off (set ANTHROPIC_API_KEY to enable)'}`);
  });
}
