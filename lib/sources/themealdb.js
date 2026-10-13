import { fetchJson } from '../http.js';

const BASE = 'https://www.themealdb.com/api/json/v1/1';
const CATEGORIES = ['beef', 'breakfast', 'chicken', 'dessert', 'goat', 'lamb', 'miscellaneous', 'pasta', 'pork', 'seafood', 'side', 'starter', 'vegan', 'vegetarian'];

export const info = { id: 'themealdb', name: 'TheMealDB', needsKey: false, enabled: () => true };

function splitSteps(text = '') {
  return text
    .split(/\r?\n+/)
    .map((s) => s.replace(/^(step\s*\d+[:.)]?|\d+[.)])\s*/i, '').trim())
    .filter((s) => s.length > 2 && !/^step\s*\d+$/i.test(s));
}

export function normalize(meal) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = meal[`strIngredient${i}`]?.trim();
    if (!name) continue;
    const measure = meal[`strMeasure${i}`]?.trim();
    ingredients.push(measure ? `${measure} ${name}` : name);
  }
  return {
    id: `themealdb:${meal.idMeal}`,
    source: 'themealdb',
    sourceName: 'TheMealDB',
    title: meal.strMeal,
    image: meal.strMealThumb,
    url: meal.strSource || `https://www.themealdb.com/meal/${meal.idMeal}`,
    ingredients,
    steps: splitSteps(meal.strInstructions),
    totalTime: null,
    servings: null,
    description: [meal.strArea, meal.strCategory].filter(Boolean).join(' · '),
    tags: (meal.strTags || '').split(',').map((t) => t.trim()).filter(Boolean),
  };
}

async function lookup(id) {
  const data = await fetchJson(`${BASE}/lookup.php?i=${encodeURIComponent(id)}`);
  return data.meals?.[0] ? normalize(data.meals[0]) : null;
}

export async function search(query, { limit = 12 } = {}) {
  const q = query.trim().toLowerCase();
  const results = new Map();
  const byName = await fetchJson(`${BASE}/search.php?s=${encodeURIComponent(q)}`);
  for (const m of byName.meals || []) results.set(m.idMeal, normalize(m));

  // Fall back to category / main-ingredient / per-word matches for broader "type of dish" queries.
  if (results.size < limit) {
    const words = q.split(/\s+/).filter((w) => w.length > 2);
    const lookups = [];
    const category = CATEGORIES.find((c) => q.includes(c) || c.startsWith(q.replace(/s$/, '')));
    if (category) lookups.push(`${BASE}/filter.php?c=${encodeURIComponent(category)}`);
    lookups.push(`${BASE}/filter.php?i=${encodeURIComponent(q.replace(/\s+/g, '_'))}`);
    for (const w of words) if (w !== q) lookups.push(`${BASE}/search.php?s=${encodeURIComponent(w)}`, `${BASE}/filter.php?i=${encodeURIComponent(w.replace(/s$/, ''))}`);

    const lists = await Promise.allSettled(lookups.map((u) => fetchJson(u)));
    const ids = [];
    for (const r of lists) {
      if (r.status !== 'fulfilled') continue;
      for (const m of r.value.meals || []) {
        if (results.has(m.idMeal) || ids.includes(m.idMeal)) continue;
        if (m.strInstructions) results.set(m.idMeal, normalize(m));
        else ids.push(m.idMeal);
      }
    }
    const needed = ids.slice(0, Math.max(0, limit - results.size));
    const full = await Promise.allSettled(needed.map(lookup));
    for (const r of full) if (r.status === 'fulfilled' && r.value) results.set(r.value.id.split(':')[1], r.value);
  }
  return [...results.values()].slice(0, limit);
}

export async function get(id) {
  return lookup(id);
}
