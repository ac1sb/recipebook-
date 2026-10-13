import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as themealdb from './lib/sources/themealdb.js';
import * as spoonacular from './lib/sources/spoonacular.js';
import * as edamam from './lib/sources/edamam.js';
import * as webpage from './lib/sources/webpage.js';
import * as blogs from './lib/sources/blogs.js';
import { analyzeRecipe, adaptIngredients, preferenceDistance, matchesPreference, LEVELS } from './lib/homemade.js';
import { claudeEnabled, searchWeb, suggestAlterations, describeFeedback } from './lib/claude.js';
import { ruleBasedAlterations, FEEDBACK_TAGS } from './lib/tweaks.js';
import { withTimes, matchesTime } from './lib/time.js';
import { buildProfile, mergeProfiles, fit, dishQuery } from './lib/profile.js';
import { filterRelevant } from './lib/relevance.js';
import { createStore } from './lib/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = { themealdb, spoonacular, edamam };
const store = createStore(process.env.RECIPEBOOK_DATA || path.join(here, 'data', 'library.json'));

export const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(here, 'public')));

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const validPref = (p) => (LEVELS.some((l) => l.id === p) ? p : 'balanced');
const minutes = (v) => (Number(v) > 0 ? Math.min(Number(v), 1440) : null);

function withAnalysis(recipe) {
  return { ...withTimes(recipe), homemade: analyzeRecipe(recipe.ingredients) };
}

function timeFilters(q = {}) {
  return { maxPrep: minutes(q.maxPrep), maxCook: minutes(q.maxCook), maxTotal: minutes(q.maxTotal) };
}

// Best matches first: recipes that match every searched word, then (within
// those) how well they match, the processing level, how well the recipe fits
// the cook's feedback (when a profile is given), and the source's own order.
function rank(recipes, pref, { profile = null, reference = null, times = {} } = {}) {
  return recipes
    .map(withAnalysis)
    .filter((r) => matchesTime(r, times))
    .map((r, i) => {
      const f = fit(r, profile, reference);
      const processing = preferenceDistance(r.homemade.score, pref);
      const rel = r.relevance ? (r.relevance.full ? 0 : 1000) - r.relevance.score * 4 : 0;
      return { ...r, matchesPreference: matchesPreference(r.homemade.score, pref), fit: f, _d: rel + processing - f.score * 4 + i * 0.5 };
    })
    .sort((a, b) => a._d - b._d)
    .map(({ _d, ...r }) => r);
}

async function globalProfile() {
  return buildProfile(await store.list());
}

// The same recipe can come from several sources; keep the first copy.
function dedupe(recipes) {
  const seen = new Set();
  return recipes.filter((r) => {
    const key = (r.url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '') || r.title.toLowerCase();
    const titleKey = r.title.toLowerCase().replace(/[^a-z]/g, '');
    if (seen.has(key) || seen.has(titleKey)) return false;
    seen.add(key);
    seen.add(titleKey);
    return true;
  });
}

async function searchSources(q, ids, { limit = 12, times = {} } = {}) {
  const active = Object.values(SOURCES).filter((s) => ids.includes(s.info.id) && s.info.enabled());
  const maxTotal = times.maxTotal || (times.maxPrep && times.maxCook ? times.maxPrep + times.maxCook : null);
  const settled = await Promise.allSettled(active.map((s) => s.search(q, { limit, maxTotal })));
  const errors = [];
  const lists = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    errors.push(`${active[i].info.name}: ${r.reason.message}`);
    return [];
  });
  // Interleave sources so one provider doesn't crowd out the others before ranking.
  const merged = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) merged.push(l[i]);
  return { merged, errors };
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
    // Only keep times that came from the source; estimates are recomputed on read.
    prepTime: r.timeEstimated ? null : Number(r.prepTime) || null,
    cookTime: r.timeEstimated ? null : Number(r.cookTime) || null,
    totalTime: r.timeEstimated ? null : Number(r.totalTime) || null,
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
      { id: 'blogs', name: blogs.info.name, needsKey: false, enabled: true, slow: true },
      { id: 'web', name: 'Whole web (via Claude)', needsKey: true, enabled: claudeEnabled(), slow: true },
    ],
    claude: claudeEnabled(),
    levels: LEVELS,
    feedbackTags: FEEDBACK_TAGS,
    settings: await store.settings(),
  });
}));

app.put('/api/settings', wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if ('pref' in b) patch.pref = validPref(b.pref);
  if ('maxPrep' in b) patch.maxPrep = minutes(b.maxPrep);
  if ('maxCook' in b) patch.maxCook = minutes(b.maxCook);
  if ('personalize' in b) patch.personalize = b.personalize !== false;
  res.json(await store.updateSettings(patch));
}));

// ---------- Search ----------

app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Enter something to search for.' });
  const pref = validPref(req.query.pref);
  const times = timeFilters(req.query);
  const filtering = Object.values(times).some(Boolean);
  const profile = req.query.personalize === '0' ? null : await globalProfile();
  const ids = String(req.query.sources || Object.keys(SOURCES).join(',')).split(',');
  // Fetch more when filtering by time so enough recipes are left afterwards.
  const { merged, errors } = await searchSources(q, ids, { limit: filtering ? 30 : 20, times });
  const { kept, dropped } = filterRelevant(dedupe(merged), q);
  const ranked = rank(kept, pref, { profile, times });
  const results = ranked.slice(0, 36);
  res.json({
    results,
    errors,
    partial: results.filter((r) => !r.relevance.full).length,
    unrelated: dropped,
    filteredOut: kept.length - ranked.length,
    personalized: profile?.feedbackCount ? profile.summary : null,
  });
}));

// Food blogs take a few seconds (they're searched and read live), so the page asks for them separately.
app.get('/api/search/blogs', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Enter something to search for.' });
  const pref = validPref(req.query.pref);
  const times = timeFilters(req.query);
  const profile = req.query.personalize === '0' ? null : await globalProfile();
  const found = dedupe(await blogs.search(q, { limit: 18 }));
  const { kept, dropped } = filterRelevant(found, q, { minFull: 6 });
  const ranked = rank(kept, pref, { profile, times });
  res.json({ results: ranked, unrelated: dropped, filteredOut: kept.length - ranked.length, sites: new Set(ranked.map((r) => r.sourceName)).size });
}));

app.get('/api/search/web', wrap(async (req, res) => {
  if (!claudeEnabled()) return res.status(400).json({ error: 'Set ANTHROPIC_API_KEY to search the whole web.' });
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Enter something to search for.' });
  const pref = validPref(req.query.pref);
  const times = timeFilters(req.query);
  const profile = req.query.personalize === '0' ? null : await globalProfile();
  const found = await searchWeb(q, { pref, limit: 12, times, wishes: profileWishes(profile) });
  const { kept } = filterRelevant(found, q, { minFull: 4 });
  res.json({ results: rank(kept, pref, { profile, times }) });
}));

function profileWishes(profile) {
  if (!profile?.feedbackCount) return '';
  const parts = [];
  if (profile.summary.length) parts.push(`they tend to prefer ${profile.summary.join(', ')}`);
  if (profile.topLikes.length) parts.push(`they rate dishes with ${profile.topLikes.join(', ')} highly`);
  if (profile.topDislikes.length) parts.push(`they rated dishes with ${profile.topDislikes.join(', ')} low`);
  return parts.join('; ');
}

app.get('/api/profile', wrap(async (_req, res) => {
  res.json(await globalProfile());
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

const pickTimes = (r) => ({ prepTime: r.prepTime, cookTime: r.cookTime, totalTime: r.totalTime, timeEstimated: r.timeEstimated });

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
    ...pickTimes(withTimes(entry.recipe)),
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
  const args = { recipe: entry.recipe, version, feedback: entry.feedback, pref, request, tastes: profileWishes(await globalProfile()) };

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

// Other recipes for the same dish, ranked by how well they address this
// recipe's feedback (and the cook's overall tastes).
app.post('/api/library/:id/similar', wrap(async (req, res) => {
  const entry = await requireEntry(req, res);
  if (!entry) return;
  const b = req.body || {};
  const pref = validPref(b.pref || (await store.settings()).pref);
  const version = entry.versions.find((v) => v.id === (b.versionId ?? entry.favoriteVersionId));
  const reference = withAnalysis(version ? { ...entry.recipe, ingredients: version.ingredients, steps: version.steps } : entry.recipe);
  const library = await store.list();
  const profile = mergeProfiles(buildProfile([entry], { weight: 1.5 }), buildProfile(library), 0.5);

  const times = timeFilters(b);
  if (profile.prefs?.quick > 0.3 && reference.totalTime && !times.maxTotal) times.maxTotal = reference.totalTime;
  const query = dishQuery(entry.recipe.title);
  const [{ merged, errors }, fromBlogs] = await Promise.all([
    searchSources(query, Object.keys(SOURCES), { limit: 24, times }),
    blogs.search(query, { limit: 16 }).catch(() => []),
  ]);

  let candidates = [...fromBlogs, ...merged];
  if (b.includeWeb && claudeEnabled()) {
    const wishes = [describeFeedback(entry.feedback), profileWishes(profile)].filter(Boolean).join('\n');
    const web = await searchWeb(query, { pref, limit: 10, times, wishes: `They have cooked "${entry.recipe.title}" and said:\n${wishes}\nLook for versions of this dish that address that feedback.` })
      .catch((err) => (errors.push(`Web: ${err.message}`), []));
    candidates = [...web, ...merged];
  }

  candidates = filterRelevant(dedupe(candidates), query, { minFull: 6 }).kept;
  const savedIds = new Set(library.map((e) => e.recipe.id));
  const sameTitle = (t) => t.trim().toLowerCase() === entry.recipe.title.trim().toLowerCase();
  const results = rank(candidates.filter((r) => r.id !== entry.recipe.id && !sameTitle(r.title)), pref, { profile, reference, times })
    .map((r) => {
      const diff = r.homemade.score - reference.homemade.score;
      if (pref !== 'shortcut' && diff >= 10) r.fit.reasons.unshift('less processed than yours');
      if (pref === 'shortcut' && r.totalTime && reference.totalTime && r.totalTime < reference.totalTime - 10 && !r.fit.reasons.some((x) => x.includes('quicker'))) r.fit.reasons.push(`${reference.totalTime - r.totalTime} min quicker`);
      return { ...r, inLibrary: savedIds.has(r.id) };
    })
    .sort((a, b) => b.fit.score + b.fit.reasons.length - (a.fit.score + a.fit.reasons.length))
    .slice(0, 12);

  const lookingFor = [...profile.summary];
  if (times.maxTotal) lookingFor.push(`ready in ${times.maxTotal} min or less`);
  if (pref !== 'balanced') lookingFor.push(LEVELS.find((l) => l.id === pref).label.toLowerCase());
  res.json({ query, results, errors, lookingFor, feedbackCount: entry.feedback.length });
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
