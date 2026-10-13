import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as themealdb from './lib/sources/themealdb.js';
import * as spoonacular from './lib/sources/spoonacular.js';
import * as edamam from './lib/sources/edamam.js';
import * as webpage from './lib/sources/webpage.js';
import { analyzeRecipe, adaptIngredients, preferenceDistance, matchesPreference, LEVELS } from './lib/homemade.js';
import { claudeEnabled, searchWeb, suggestAlterations } from './lib/claude.js';
import { ruleBasedAlterations, FEEDBACK_TAGS } from './lib/tweaks.js';
import { createStore } from './lib/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = { themealdb, spoonacular, edamam };
const store = createStore(process.env.RECIPEBOOK_DATA || path.join(here, 'data', 'library.json'));

export const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(here, 'public')));

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const validPref = (p) => (LEVELS.some((l) => l.id === p) ? p : 'balanced');

function withAnalysis(recipe) {
  return { ...recipe, homemade: analyzeRecipe(recipe.ingredients) };
}

function rank(recipes, pref) {
  return recipes
    .map((r, i) => ({ r: withAnalysis(r), i }))
    .map(({ r, i }) => ({ ...r, matchesPreference: matchesPreference(r.homemade.score, pref), _d: preferenceDistance(r.homemade.score, pref) + i * 0.5 }))
    .sort((a, b) => a._d - b._d)
    .map(({ _d, ...r }) => r);
}

function cleanRecipe(r = {}) {
  const list = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 200) : []);
  if (!r.title || !Array.isArray(r.ingredients)) {
    throw Object.assign(new Error('A recipe needs a title and ingredients.'), { status: 400 });
  }
  return {
    id: String(r.id || `custom:${store.newId()}`),
    source: String(r.source || 'custom'),
    sourceName: String(r.sourceName || 'My recipe'),
    title: String(r.title).slice(0, 200),
    image: r.image ? String(r.image) : null,
    url: r.url ? String(r.url) : null,
    ingredients: list(r.ingredients),
    steps: list(r.steps),
    totalTime: Number(r.totalTime) || null,
    servings: r.servings ? String(r.servings) : null,
    description: String(r.description || '').slice(0, 1000),
    tags: list(r.tags).slice(0, 10),
  };
}

// ---------- Status & settings ----------

app.get('/api/status', wrap(async (_req, res) => {
  res.json({
    sources: [
      ...Object.values(SOURCES).map((s) => ({ id: s.info.id, name: s.info.name, needsKey: s.info.needsKey, enabled: s.info.enabled() })),
      { id: 'web', name: 'Whole web (via Claude)', needsKey: true, enabled: claudeEnabled() },
    ],
    claude: claudeEnabled(),
    levels: LEVELS,
    feedbackTags: FEEDBACK_TAGS,
    settings: await store.settings(),
  });
}));

app.put('/api/settings', wrap(async (req, res) => {
  res.json(await store.updateSettings({ pref: validPref(req.body?.pref) }));
}));

// ---------- Search ----------

app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Enter something to search for.' });
  const pref = validPref(req.query.pref);
  const wanted = String(req.query.sources || Object.keys(SOURCES).join(',')).split(',');
  const active = Object.values(SOURCES).filter((s) => wanted.includes(s.info.id) && s.info.enabled());

  const settled = await Promise.allSettled(active.map((s) => s.search(q, { limit: 12 })));
  const errors = [];
  const lists = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    errors.push(`${active[i].info.name}: ${r.reason.message}`);
    return [];
  });
  // Interleave sources so one provider doesn't crowd out the others before ranking.
  const merged = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) merged.push(l[i]);
  res.json({ results: rank(merged, pref), errors });
}));

app.get('/api/search/web', wrap(async (req, res) => {
  if (!claudeEnabled()) return res.status(400).json({ error: 'Set ANTHROPIC_API_KEY to search the whole web.' });
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Enter something to search for.' });
  const pref = validPref(req.query.pref);
  res.json({ results: rank(await searchWeb(q, { pref, limit: 10 }), pref) });
}));

app.get('/api/recipe', wrap(async (req, res) => {
  const [source, ...rest] = String(req.query.id || '').split(':');
  const id = rest.join(':');
  const mod = source === 'web' ? webpage : SOURCES[source];
  if (!mod || !id) return res.status(404).json({ error: 'Unknown recipe.' });
  const recipe = await mod.get(id);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
  // Some APIs (Edamam) only give ingredients; try to read the method from the original page.
  if (!recipe.steps.length && recipe.url) {
    const page = await webpage.fromUrl(recipe.url, { timeout: 8000 }).catch(() => null);
    if (page?.steps.length) recipe.steps = page.steps;
  }
  res.json(withAnalysis(recipe));
}));

app.post('/api/import', wrap(async (req, res) => {
  res.json(withAnalysis(await webpage.fromUrl(String(req.body?.url || '').trim())));
}));

app.post('/api/adapt', wrap(async (req, res) => {
  const ingredients = Array.isArray(req.body?.ingredients) ? req.body.ingredients.map(String) : [];
  const pref = validPref(req.body?.pref);
  const adapted = adaptIngredients(ingredients, pref);
  res.json({ ...adapted, before: analyzeRecipe(ingredients) });
}));

// ---------- Library ----------

function summary(entry) {
  const ratings = entry.feedback.map((f) => f.rating).filter(Boolean);
  const fav = entry.versions.find((v) => v.id === entry.favoriteVersionId);
  return {
    id: entry.id,
    sourceId: entry.recipe.id,
    savedAt: entry.savedAt,
    title: entry.recipe.title,
    image: entry.recipe.image,
    sourceName: entry.recipe.sourceName,
    homemade: analyzeRecipe((fav || entry.recipe).ingredients),
    timesMade: entry.feedback.length,
    avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    versions: entry.versions.length,
    lastMade: entry.feedback.at(-1)?.date || null,
  };
}

function detail(entry) {
  return {
    ...entry,
    recipe: withAnalysis(entry.recipe),
    versions: entry.versions.map((v) => ({ ...v, homemade: analyzeRecipe(v.ingredients) })),
    suggestions: entry.suggestions.map((s) => ({ ...s, homemade: analyzeRecipe(s.ingredients) })),
  };
}

async function requireEntry(req, res) {
  const entry = await store.get(req.params.id);
  if (!entry) res.status(404).json({ error: 'That recipe is not in your library.' });
  return entry;
}

app.get('/api/library', wrap(async (_req, res) => {
  res.json((await store.list()).map(summary));
}));

app.post('/api/library', wrap(async (req, res) => {
  const recipe = cleanRecipe(req.body?.recipe);
  const entry = await store.add(recipe);
  res.status(201).json(detail(entry));
}));

app.get('/api/library/:id', wrap(async (req, res) => {
  const entry = await requireEntry(req, res);
  if (entry) res.json(detail(entry));
}));

app.delete('/api/library/:id', wrap(async (req, res) => {
  const ok = await store.remove(req.params.id);
  res.status(ok ? 204 : 404).end();
}));

app.post('/api/library/:id/feedback', wrap(async (req, res) => {
  const b = req.body || {};
  const entry = await store.update(req.params.id, (e) => {
    const version = e.versions.find((v) => v.id === b.versionId);
    e.feedback.push({
      id: store.newId(),
      date: b.date ? new Date(b.date).toISOString() : new Date().toISOString(),
      versionId: version?.id || null,
      versionTitle: version?.title || 'Original',
      rating: Math.min(5, Math.max(0, Number(b.rating) || 0)) || null,
      tags: (Array.isArray(b.tags) ? b.tags : []).map(String).slice(0, 20),
      comment: String(b.comment || '').slice(0, 2000),
      wouldMakeAgain: typeof b.wouldMakeAgain === 'boolean' ? b.wouldMakeAgain : null,
    });
  });
  if (!entry) return res.status(404).json({ error: 'That recipe is not in your library.' });
  res.status(201).json(detail(entry));
}));

app.delete('/api/library/:id/feedback/:fid', wrap(async (req, res) => {
  const entry = await store.update(req.params.id, (e) => {
    e.feedback = e.feedback.filter((f) => f.id !== req.params.fid);
  });
  if (!entry) return res.status(404).json({ error: 'That recipe is not in your library.' });
  res.json(detail(entry));
}));

app.post('/api/library/:id/alterations', wrap(async (req, res) => {
  const entry = await requireEntry(req, res);
  if (!entry) return;
  const pref = validPref(req.body?.pref || (await store.settings()).pref);
  const version = entry.versions.find((v) => v.id === req.body?.versionId) || null;
  const request = String(req.body?.request || '').slice(0, 1000);
  const args = { recipe: entry.recipe, version, feedback: entry.feedback, pref, request };

  let suggestions;
  let note = null;
  if (claudeEnabled()) {
    suggestions = await suggestAlterations(args);
  } else {
    suggestions = ruleBasedAlterations(args);
    note = 'Using built-in rules. Add an ANTHROPIC_API_KEY for smarter, feedback-specific alterations.';
    if (request) note += ' Free-text requests need Claude.';
  }
  const basedOn = version?.id || null;
  const updated = await store.update(entry.id, (e) => {
    e.suggestions = suggestions.map((s) => ({ ...s, id: store.newId(), basedOn, createdAt: new Date().toISOString() }));
  });
  res.json({ ...detail(updated), note });
}));

app.post('/api/library/:id/versions', wrap(async (req, res) => {
  const b = req.body || {};
  const fromSuggestion = b.suggestionId ? (await store.get(req.params.id))?.suggestions.find((s) => s.id === b.suggestionId) : null;
  const src = fromSuggestion || b;
  if (!Array.isArray(src.ingredients) || !src.ingredients.length) {
    return res.status(400).json({ error: 'A version needs ingredients.' });
  }
  const entry = await store.update(req.params.id, (e) => {
    e.versions.push({
      id: store.newId(),
      title: String(src.title || `Version ${e.versions.length + 2}`).slice(0, 120),
      summary: String(src.summary || ''),
      why: String(src.why || ''),
      changes: (src.changes || []).map(String),
      ingredients: src.ingredients.map(String),
      steps: (src.steps || []).map(String),
      basedOn: src.basedOn || null,
      origin: src.origin || 'manual',
      createdAt: new Date().toISOString(),
    });
    if (fromSuggestion) e.suggestions = e.suggestions.filter((s) => s.id !== fromSuggestion.id);
  });
  if (!entry) return res.status(404).json({ error: 'That recipe is not in your library.' });
  res.status(201).json(detail(entry));
}));

app.delete('/api/library/:id/versions/:vid', wrap(async (req, res) => {
  const entry = await store.update(req.params.id, (e) => {
    e.versions = e.versions.filter((v) => v.id !== req.params.vid);
    if (e.favoriteVersionId === req.params.vid) e.favoriteVersionId = null;
  });
  if (!entry) return res.status(404).json({ error: 'That recipe is not in your library.' });
  res.json(detail(entry));
}));

app.put('/api/library/:id/favorite', wrap(async (req, res) => {
  const entry = await store.update(req.params.id, (e) => {
    const vid = req.body?.versionId || null;
    e.favoriteVersionId = vid && e.versions.some((v) => v.id === vid) ? vid : null;
  });
  if (!entry) return res.status(404).json({ error: 'That recipe is not in your library.' });
  res.json(detail(entry));
}));

// ---------- Errors ----------

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`The Borsari Kitchen is running at http://localhost:${port}`);
    console.log(`Claude features: ${claudeEnabled() ? 'on' : 'off (set ANTHROPIC_API_KEY to enable)'}`);
  });
}
