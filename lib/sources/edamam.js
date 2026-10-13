import { fetchJson } from '../http.js';

const BASE = 'https://api.edamam.com/api/recipes/v2';
const creds = () => ({ id: process.env.EDAMAM_APP_ID, key: process.env.EDAMAM_APP_KEY });

export const info = { id: 'edamam', name: 'Edamam', needsKey: true, enabled: () => Boolean(creds().id && creds().key) };

function bestImage(r) {
  return r.images?.LARGE?.url || r.images?.REGULAR?.url || r.image;
}

export function normalize(hit) {
  const r = hit.recipe || hit;
  const id = (r.uri || '').split('#recipe_')[1] || encodeURIComponent(r.url);
  return {
    id: `edamam:${id}`,
    source: 'edamam',
    sourceName: r.source || 'Edamam',
    title: r.label,
    image: bestImage(r),
    url: r.url,
    ingredients: r.ingredientLines || [],
    // Edamam does not license the method; the UI links to the original page
    // and the server tries to pull steps from it when the recipe is opened.
    steps: [],
    totalTime: r.totalTime || null,
    servings: r.yield || null,
    description: [...(r.cuisineType || []), ...(r.dishType || [])].join(' · '),
    tags: [...(r.dietLabels || []), ...(r.healthLabels || []).slice(0, 4)],
  };
}

function headers() {
  // Accounts created after 2023 require a user id header; any stable value works for a personal app.
  return { 'Edamam-Account-User': process.env.EDAMAM_USER || 'recipebook' };
}

export async function search(query, { limit = 12 } = {}) {
  const { id, key } = creds();
  const params = new URLSearchParams({ type: 'public', q: query, app_id: id, app_key: key });
  const data = await fetchJson(`${BASE}?${params}`, { headers: headers() });
  return (data.hits || []).slice(0, limit).map(normalize);
}

export async function get(recipeId) {
  const { id, key } = creds();
  const params = new URLSearchParams({ type: 'public', app_id: id, app_key: key });
  const data = await fetchJson(`${BASE}/${encodeURIComponent(recipeId)}?${params}`, { headers: headers() });
  return normalize(data);
}
