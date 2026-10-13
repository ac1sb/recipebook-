// Reads a recipe from any web page that publishes schema.org Recipe data
// (nearly every major recipe site and food blog does, for Google rich results).
import { assertPublicUrl, fetchWithTimeout, BROWSER_UA } from '../http.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', eacute: 'é', egrave: 'è' };

export function decode(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+\d*);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRecipe(node) {
  const t = node?.['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
}

function findRecipe(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (isRecipe(node)) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const r = findRecipe(node[key], depth + 1);
    if (r) return r;
  }
  return null;
}

function imageOf(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) {
    // Prefer the largest listed image when objects carry dimensions.
    const objs = img.filter((i) => typeof i === 'object' && i?.url);
    if (objs.length) return objs.sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0))[0].url;
    return imageOf(img[0]);
  }
  return img.url || img.contentUrl || null;
}

function stepsOf(ins) {
  if (!ins) return [];
  if (typeof ins === 'string') {
    const text = ins.includes('<') ? ins.replace(/<\/(p|li|br)>|<br\s*\/?>/gi, '\n') : ins;
    return text.split(/\n+/).map(decode).filter(Boolean);
  }
  if (Array.isArray(ins)) return ins.flatMap(stepsOf);
  if (ins['@type'] === 'HowToSection' || ins.itemListElement) {
    const inner = stepsOf(ins.itemListElement);
    return ins.name ? [`— ${decode(ins.name)} —`, ...inner] : inner;
  }
  return [decode(ins.text || ins.name || '')].filter(Boolean);
}

export function isoMinutes(d) {
  if (!d || typeof d !== 'string') return null;
  const m = d.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const mins = (Number(m[1]) || 0) * 1440 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
  return mins || null;
}

function siteName(url, html) {
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  if (og) return decode(og[1]);
  return new URL(url).hostname.replace(/^www\./, '');
}

export function parseRecipeHtml(html, url) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let recipe = null;
  for (const [, raw] of blocks) {
    try {
      recipe = findRecipe(JSON.parse(raw.trim().replace(/[\u0000-\u001f]+/g, ' ')));
    } catch {
      continue;
    }
    if (recipe) break;
  }
  if (!recipe) return null;

  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const ingredients = (recipe.recipeIngredient || recipe.ingredients || []).map(decode).filter(Boolean);
  const yieldRaw = Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : recipe.recipeYield;
  let image = imageOf(recipe.image) || ogImage || null;
  if (image) {
    try {
      image = new URL(decode(image), url).href;
    } catch {
      image = null;
    }
  }
  return {
    id: `web:${Buffer.from(url).toString('base64url')}`,
    source: 'web',
    sourceName: siteName(url, html),
    title: decode(recipe.name) || 'Untitled recipe',
    image,
    url,
    ingredients,
    steps: stepsOf(recipe.recipeInstructions),
    prepTime: isoMinutes(recipe.prepTime),
    cookTime: isoMinutes(recipe.cookTime),
    totalTime: isoMinutes(recipe.totalTime) || ((isoMinutes(recipe.prepTime) || 0) + (isoMinutes(recipe.cookTime) || 0)) || null,
    servings: yieldRaw ? decode(yieldRaw) : null,
    description: decode(recipe.description).slice(0, 300),
    tags: [recipe.recipeCategory, recipe.recipeCuisine].flat().filter(Boolean).map(decode).slice(0, 4),
  };
}

// Fetch a page, re-checking every redirect hop so imports can't reach private hosts.
async function fetchPage(rawUrl, timeout) {
  let url = rawUrl;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(url);
    const headers = { Accept: 'text/html,application/xhtml+xml' };
    let res = await fetchWithTimeout(url, { timeout, redirect: 'manual', headers });
    // Some sites only block one kind of client; retry once looking like a browser.
    if (res.status === 403) res = await fetchWithTimeout(url, { timeout, redirect: 'manual', headers: { ...headers, 'User-Agent': BROWSER_UA } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url).href;
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`${new URL(url).hostname} responded ${res.status}`), { status: 502 });
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html')) throw Object.assign(new Error('That link is not a web page.'), { status: 400 });
    return { html: await res.text(), url };
  }
  throw Object.assign(new Error('Too many redirects.'), { status: 502 });
}

export async function fromUrl(rawUrl, { timeout = 12000 } = {}) {
  const { html, url } = await fetchPage(rawUrl, timeout);
  const recipe = parseRecipeHtml(html, url);
  if (!recipe) {
    throw Object.assign(new Error('Could not find a recipe on that page (it has no schema.org Recipe data).'), { status: 422 });
  }
  return recipe;
}

export async function get(id) {
  return fromUrl(Buffer.from(id, 'base64url').toString());
}
