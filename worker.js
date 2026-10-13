// Runs The Borsari Kitchen on Cloudflare Workers: `npm run deploy`.
// The library is stored in D1 (binding DB), photos in R2 (binding IMAGES), and
// the pages in public/ are served as static assets (binding ASSETS).
import { createApp } from './lib/app.js';
import { createD1Store } from './lib/storage/d1-store.js';
import { createR2Images } from './lib/storage/r2-images.js';

let cached;

export default {
  async fetch(request, env, ctx) {
    if (!cached) {
      // The shared code reads API keys from process.env (as on Node), so copy
      // the Worker's string variables and secrets there.
      for (const [k, v] of Object.entries(env)) if (typeof v === 'string') process.env[k] = v;
      cached = createApp({
        store: createD1Store(env.DB),
        images: createR2Images(env.IMAGES),
        password: env.APP_PASSWORD || null,
        assets: (c) => env.ASSETS.fetch(c.req.raw),
      });
    }
    return cached.fetch(request, env, ctx);
  },
};
