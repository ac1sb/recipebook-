import { fetchJson } from '../http.js';

const BASE = 'https://api.spoonacular.com';
const key = () => process.env.SPOONACULAR_API_KEY;

export const info = { id: 'spoonacular', name: 'Spoonacular', needsKey: true, enabled: () => Boolean(key()) };

function stripHtml(s = '') {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function normalize(r) {
  const steps = (r.analyzedInstructions || []).flatMap((block) => (block.steps || []).map((s) => s.step));
  return {
    id: `spoonacular:${r.id}`,
    source: 'spoonacular',
    sourceName: r.sourceName || r.creditsText || 'Spoonacular',
    title: r.title,
    image: r.image,
    url: r.sourceUrl || r.spoonacularSourceUrl,
    ingredients: (r.extendedIngredients || []).map((i) => i.original),
    steps: steps.length ? steps : stripHtml(r.instructions || '').split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean),
    prepTime: r.preparationMinutes > 0 ? r.preparationMinutes : null,
    cookTime: r.cookingMinutes > 0 ? r.cookingMinutes : null,
    totalTime: r.readyInMinutes || null,
    servings: r.servings || null,
    description: stripHtml(r.summary || '').split('. ').slice(0, 2).join('. '),
    tags: [...(r.dishTypes || []), ...(r.diets || [])],
  };
}

export async function search(query, { limit = 12, maxTotal } = {}) {
  const params = new URLSearchParams({
    ...(maxTotal ? { maxReadyTime: String(maxTotal) } : {}),
    query,
    number: String(limit),
    addRecipeInformation: 'true',
    fillIngredients: 'true',
    instructionsRequired: 'true',
    apiKey: key(),
  });
  const data = await fetchJson(`${BASE}/recipes/complexSearch?${params}`);
  return (data.results || []).map(normalize);
}

export async function get(id) {
  const data = await fetchJson(`${BASE}/recipes/${encodeURIComponent(id)}/information?apiKey=${key()}`);
  return normalize(data);
}
