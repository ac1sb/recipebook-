// Free, no-key search across popular food blogs. Most of them run WordPress,
// whose built-in search API (/wp-json/wp/v2/posts?search=) we query directly.
// Matching posts are then opened and read like any imported recipe link.
import { fetchWithTimeout } from '../http.js';
import { fromUrl } from './webpage.js';
import { parseQuery, relevance } from '../relevance.js';

export const SITES = [
  'www.budgetbytes.com', 'sallysbakingaddiction.com', 'www.recipetineats.com', 'natashaskitchen.com', 'www.spendwithpennies.com',
  'www.onceuponachef.com', 'downshiftology.com', 'www.gimmesomeoven.com', 'www.inspiredtaste.net', 'cafedelites.com',
  'www.addapinch.com', 'therecipecritic.com', 'tastesbetterfromscratch.com', 'www.jocooks.com', 'www.dinneratthezoo.com',
  'www.wellplated.com', 'www.skinnytaste.com', 'www.loveandlemons.com', 'cookieandkate.com', 'pinchofyum.com',
  'www.feelgoodfoodie.net', 'www.momontimeout.com', 'www.thewholesomedish.com', 'www.lecremedelacrumb.com',
  'www.allthehealthythings.com', 'www.halfbakedharvest.com', 'www.twopeasandtheirpod.com', 'www.averiecooks.com',
  'www.tasteofhome.com', 'damndelicious.net', 'www.simplyrecipes.com', 'www.seriouseats.com', 'www.thepioneerwoman.com',
];

export const info = { id: 'blogs', name: `Food blogs (${SITES.length} sites)`, needsKey: false, enabled: () => true };

// Roundups and meal plans aren't single recipes.
const NOT_A_RECIPE = /^\s*\d+\+?\s|\b(recipes|ideas|meal plans?|round-?up|ways to|what to (make|eat)|menu|gift guide|favorites|this and that|week of)\b/i;

const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/<[^>]+>/g, '').trim();

async function searchSite(site, query, timeout) {
  const params = new URLSearchParams({ search: query, per_page: '10', orderby: 'relevance', _fields: 'link,title' });
  const res = await fetchWithTimeout(`https://${site}/wp-json/wp/v2/posts?${params}`, { timeout, headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const posts = await res.json().catch(() => []);
  return Array.isArray(posts) ? posts.map((p) => ({ site, url: p.link, title: decode(p.title?.rendered) })).filter((p) => p.url && p.title) : [];
}

// Runs fn over items with at most `n` at a time.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
    }
  }));
  return out;
}

export async function search(query, { limit = 16, perSite = 2 } = {}) {
  const terms = parseQuery(query);
  const searchText = terms.map((t) => t.word).join(' ') || query;
  const found = await Promise.allSettled(SITES.map((s) => searchSite(s, searchText, 7000)));

  // Pick the posts whose titles best match the search, a couple per site so results stay varied.
  const candidates = found
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((p) => !NOT_A_RECIPE.test(p.title))
    .map((p) => ({ ...p, rel: relevance({ title: p.title }, terms, query) }))
    .filter((p) => p.rel.matched.length >= Math.ceil(terms.length / 2))
    .sort((a, b) => Number(b.rel.full) - Number(a.rel.full) || b.rel.score - a.rel.score);
  const perHost = new Map();
  const picked = candidates.filter((p) => {
    const n = perHost.get(p.site) || 0;
    if (n >= perSite) return false;
    perHost.set(p.site, n + 1);
    return true;
  }).slice(0, Math.round(limit * 1.5));

  const pages = await pool(picked, 8, (p) => fromUrl(p.url, { timeout: 9000 }));
  return pages
    .filter((p) => p.ok && p.v.ingredients.length)
    .map((p) => p.v)
    .slice(0, limit);
}
