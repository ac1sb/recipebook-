import { fetchJson } from '../http.js';
import { parseQuery } from '../relevance.js';

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

// TheMealDB only matches whole names or single ingredients, so a search like
// "chicken noodle soup" is built from several lookups (name, each word, main
// ingredient, category). Meals found by more of them are fetched first, and the
// server then keeps only the ones that really match.
export async function search(query, { limit = 12 } = {}) {
  const q = query.trim().toLowerCase();
  const terms = parseQuery(q);
  const words = [...new Set(terms.flatMap((t) => [t.word, t.key]))];
  const full = new Map(); // id -> normalized recipe
  const hits = new Map(); // id -> { name, terms: Set }

  const lookups = [{ url: `${BASE}/search.php?s=${encodeURIComponent(q)}`, term: '*' }];
  for (const t of terms) {
    lookups.push({ url: `${BASE}/search.php?s=${encodeURIComponent(t.key)}`, term: t.key });
    if (t.kind === 'ingredient') {
      lookups.push({ url: `${BASE}/filter.php?i=${encodeURIComponent(t.key.replace(/\s+/g, '_'))}`, term: t.key });
    }
    const category = CATEGORIES.find((c) => c === t.key || c === `${t.key}s` || c === t.word);
    if (category) lookups.push({ url: `${BASE}/filter.php?c=${encodeURIComponent(category)}`, term: t.key });
  }
  if (words.length > 1) lookups.push({ url: `${BASE}/filter.php?i=${encodeURIComponent(words.join('_'))}`, term: '*' });

  const lists = await Promise.allSettled(lookups.map((l) => fetchJson(l.url)));
  lists.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    for (const m of r.value.meals || []) {
      const h = hits.get(m.idMeal) || { name: m.strMeal, terms: new Set() };
      if (lookups[i].term === '*') terms.forEach((t) => h.terms.add(t.key));
      else h.terms.add(lookups[i].term);
      hits.set(m.idMeal, h);
      if (m.strInstructions && !full.has(m.idMeal)) full.set(m.idMeal, normalize(m));
    }
  });
  // Words in the meal's name count too (e.g. "soup" in "Rosol (Polish Chicken Soup)").
  for (const h of hits.values()) for (const t of terms) if (t.re.test(h.name)) h.terms.add(t.key);

  const ranked = [...hits].sort((a, b) => b[1].terms.size - a[1].terms.size);
  const best = ranked.length ? ranked[0][1].terms.size : 0;
  // Fetch details for the strongest candidates we only have names for.
  const toFetch = ranked
    .filter(([id, h]) => !full.has(id) && h.terms.size >= Math.max(1, best - 1))
    .slice(0, 30)
    .map(([id]) => id);
  const fetched = await Promise.allSettled(toFetch.map(lookup));
  for (const r of fetched) if (r.status === 'fulfilled' && r.value) full.set(r.value.id.split(':')[1], r.value);

  const order = new Map(ranked.map(([id], i) => [id, i]));
  return [...full.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9))
    .map(([, r]) => r)
    .slice(0, Math.max(limit, 40));
}

export async function get(id) {
  return lookup(id);
}
