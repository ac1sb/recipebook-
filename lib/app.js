// The Borsari Kitchen web app (API + pages). The same app runs on your own
// computer (server.js) and on Cloudflare Workers (worker.js); only the
// storage it's given differs.
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import * as themealdb from './sources/themealdb.js';
import * as spoonacular from './sources/spoonacular.js';
import * as edamam from './sources/edamam.js';
import * as webpage from './sources/webpage.js';
import * as blogs from './sources/blogs.js';
import { analyzeRecipe, adaptIngredients, preferenceDistance, matchesPreference, LEVELS } from './homemade.js';
import { claudeEnabled, searchWeb, suggestAlterations, suggestSubstitutes, describeFeedback } from './claude.js';
import { ruleSubstitutes } from './substitutes.js';
import { ruleBasedAlterations, FEEDBACK_TAGS } from './tweaks.js';
import { withTimes, matchesTime } from './time.js';
import { buildProfile, mergeProfiles, fit, dishQuery } from './profile.js';
import { filterRelevant } from './relevance.js';
import { saveImage, deleteImage, isLocal } from './images.js';

const SOURCES = { themealdb, spoonacular, edamam };

const validPref = (p) => (LEVELS.some((l) => l.id === p) ? p : 'balanced');
const minutes = (v) => (Number(v) > 0 ? Math.min(Number(v), 1440) : null);
const httpError = (status, message) => Object.assign(new Error(message), { status });

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

function profileWishes(profile) {
  if (!profile?.feedbackCount) return '';
  const parts = [];
  if (profile.summary.length) parts.push(`they tend to prefer ${profile.summary.join(', ')}`);
  if (profile.topLikes.length) parts.push(`they rate dishes with ${profile.topLikes.join(', ')} highly`);
  if (profile.topDislikes.length) parts.push(`they rated dishes with ${profile.topDislikes.join(', ')} low`);
  return parts.join('; ');
}

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

const list = (v, max = 200) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, max) : []);

function cleanRecipe(r = {}, newId) {
  if (!r.title || !Array.isArray(r.ingredients)) throw httpError(400, 'A recipe needs a title and ingredients.');
  return {
    id: String(r.id || `custom:${newId()}`),
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

/**
 * store:   library storage (lib/storage/file-store.js or d1-store.js)
 * images:  photo storage (lib/storage/fs-images.js or r2-images.js)
 * password: optional; when set, the whole site asks for it (any username)
 * assets:  handler that serves the files in public/ for non-API requests
 */
export function createApp({ store, images, password = null, assets = null }) {
  const app = new Hono();
  const query = (c) => c.req.query();
  const body = async (c) => (await c.req.json().catch(() => null)) || {};
  const globalProfile = async () => buildProfile(await store.list());
  const requireEntry = async (c) => {
    const entry = await store.get(c.req.param('id'));
    if (!entry) throw httpError(404, 'That recipe is not in your library.');
    return entry;
  };

  // Makes the saved copy self-contained: copies the photo, and fills in the
  // method from the original page if the source didn't include it. Safe to re-run.
  async function archive(id) {
    const entry = await store.get(id);
    if (!entry) return null;
    const r = entry.recipe;
    const patch = {};
    if (!r.steps.length && r.url) {
      const page = await webpage.fromUrl(r.url, { timeout: 10000 }).catch(() => null);
      if (page?.steps.length) patch.steps = page.steps;
      if (!r.image && page?.image) patch.image = page.image;
    }
    const remote = patch.image || r.image;
    if (remote && !isLocal(remote)) {
      try {
        patch.image = await saveImage(remote, images, entry.id);
        patch.originalImage = remote;
      } catch (err) {
        console.warn(`Could not save photo for "${r.title}": ${err.message}`);
      }
    }
    return store.update(id, (e) => {
      Object.assign(e.recipe, patch);
      e.archivedAt = new Date().toISOString();
    });
  }
  app.archive = archive;

  if (password) {
    app.use('*', basicAuth({ verifyUser: (_user, pass) => pass === password, realm: 'The Borsari Kitchen' }));
  }

  // ---------- Status & settings ----------

  app.get('/api/status', async (c) => c.json({
    sources: [
      ...Object.values(SOURCES).map((s) => ({ id: s.info.id, name: s.info.name, needsKey: s.info.needsKey, enabled: s.info.enabled() })),
      { id: 'blogs', name: blogs.info.name, needsKey: false, enabled: true, slow: true },
      { id: 'web', name: 'Whole web (via Claude)', needsKey: true, enabled: claudeEnabled(), slow: true },
    ],
    claude: claudeEnabled(),
    levels: LEVELS,
    feedbackTags: FEEDBACK_TAGS,
    settings: await store.settings(),
  }));

  app.put('/api/settings', async (c) => {
    const b = await body(c);
    const patch = {};
    if ('pref' in b) patch.pref = validPref(b.pref);
    if ('maxPrep' in b) patch.maxPrep = minutes(b.maxPrep);
    if ('maxCook' in b) patch.maxCook = minutes(b.maxCook);
    if ('personalize' in b) patch.personalize = b.personalize !== false;
    return c.json(await store.updateSettings(patch));
  });

  // ---------- Search ----------

  const searchText = (c) => {
    const q = String(query(c).q || '').trim();
    if (!q) throw httpError(400, 'Enter something to search for.');
    return q;
  };

  app.get('/api/search', async (c) => {
    const q = searchText(c);
    const qs = query(c);
    const pref = validPref(qs.pref);
    const times = timeFilters(qs);
    const filtering = Object.values(times).some(Boolean);
    const profile = qs.personalize === '0' ? null : await globalProfile();
    const ids = String(qs.sources || Object.keys(SOURCES).join(',')).split(',');
    // Fetch more when filtering by time so enough recipes are left afterwards.
    const { merged, errors } = await searchSources(q, ids, { limit: filtering ? 30 : 20, times });
    const { kept, dropped } = filterRelevant(dedupe(merged), q);
    const ranked = rank(kept, pref, { profile, times });
    const results = ranked.slice(0, 36);
    return c.json({
      results,
      errors,
      partial: results.filter((r) => !r.relevance.full).length,
      unrelated: dropped,
      filteredOut: kept.length - ranked.length,
      personalized: profile?.feedbackCount ? profile.summary : null,
    });
  });

  // Food blogs take a few seconds (they're searched and read live), so the page asks for them separately.
  app.get('/api/search/blogs', async (c) => {
    const q = searchText(c);
    const qs = query(c);
    const pref = validPref(qs.pref);
    const times = timeFilters(qs);
    const profile = qs.personalize === '0' ? null : await globalProfile();
    const found = dedupe(await blogs.search(q, { limit: 18 }));
    const { kept, dropped } = filterRelevant(found, q, { minFull: 6 });
    const ranked = rank(kept, pref, { profile, times });
    return c.json({ results: ranked, unrelated: dropped, filteredOut: kept.length - ranked.length, sites: new Set(ranked.map((r) => r.sourceName)).size });
  });

  app.get('/api/search/web', async (c) => {
    if (!claudeEnabled()) throw httpError(400, 'Set ANTHROPIC_API_KEY to search the whole web.');
    const q = searchText(c);
    const qs = query(c);
    const pref = validPref(qs.pref);
    const times = timeFilters(qs);
    const profile = qs.personalize === '0' ? null : await globalProfile();
    const found = await searchWeb(q, { pref, limit: 12, times, wishes: profileWishes(profile) });
    const { kept } = filterRelevant(found, q, { minFull: 4 });
    return c.json({ results: rank(kept, pref, { profile, times }) });
  });

  app.get('/api/profile', async (c) => c.json(await globalProfile()));

  app.get('/api/recipe', async (c) => {
    const [source, ...rest] = String(query(c).id || '').split(':');
    const id = rest.join(':');
    const mod = source === 'web' ? webpage : SOURCES[source];
    if (!mod || !id) throw httpError(404, 'Unknown recipe.');
    const recipe = await mod.get(id);
    if (!recipe) throw httpError(404, 'Recipe not found.');
    // Some APIs (Edamam) only give ingredients; try to read the method from the original page.
    if (!recipe.steps.length && recipe.url) {
      const page = await webpage.fromUrl(recipe.url, { timeout: 8000 }).catch(() => null);
      if (page?.steps.length) recipe.steps = page.steps;
    }
    return c.json(withAnalysis(recipe));
  });

  app.post('/api/import', async (c) => c.json(withAnalysis(await webpage.fromUrl(String((await body(c)).url || '').trim()))));

  app.post('/api/adapt', async (c) => {
    const b = await body(c);
    const ingredients = list(b.ingredients);
    // A level id, or an explicit direction: 'scratch' or 'shortcut' (canned / store-bought).
    const pref = ['scratch', 'shortcut'].includes(b.direction) ? b.direction : validPref(b.pref);
    return c.json({ ...adaptIngredients(ingredients, pref), before: analyzeRecipe(ingredients) });
  });

  // Substitutes for ingredients the cook doesn't have.
  app.post('/api/substitute', async (c) => {
    const b = await body(c);
    const ingredients = list(b.ingredients);
    const missing = list(b.missing, 30);
    if (!missing.length) throw httpError(400, 'Pick at least one ingredient you are missing.');
    if (claudeEnabled()) {
      try {
        const subs = await suggestSubstitutes({ title: String(b.title || 'Recipe'), ingredients, steps: list(b.steps, 40), missing });
        // Keep the cook's original lines as keys, in their order.
        const byLine = new Map(subs.map((x) => [x.ingredient.trim(), x]));
        return c.json({
          origin: 'claude',
          substitutions: missing.map((m, i) => ({ ingredient: m, options: (byLine.get(m.trim()) || subs[i] || { options: [] }).options })),
        });
      } catch (err) {
        console.warn(`Claude substitutes failed, using built-in table: ${err.message}`);
      }
    }
    return c.json({ origin: 'rules', substitutions: ruleSubstitutes(missing) });
  });

  // ---------- Library ----------

  app.get('/api/library', async (c) => c.json((await store.list()).map(summary)));

  app.post('/api/library', async (c) => {
    const recipe = cleanRecipe((await body(c)).recipe, store.newId);
    const entry = await store.add(recipe);
    return c.json(detail((await archive(entry.id)) || entry), 201);
  });

  app.get('/api/library/:id', async (c) => c.json(detail(await requireEntry(c))));

  app.delete('/api/library/:id', async (c) => {
    const entry = await store.get(c.req.param('id'));
    if (entry) await deleteImage(entry.recipe.image, images);
    const ok = await store.remove(c.req.param('id'));
    return c.body(null, ok ? 204 : 404);
  });

  // store.update returns null when the entry doesn't exist.
  const updated = (entry) => {
    if (!entry) throw httpError(404, 'That recipe is not in your library.');
    return detail(entry);
  };

  app.post('/api/library/:id/feedback', async (c) => {
    const b = await body(c);
    const entry = await store.update(c.req.param('id'), (e) => {
      const version = e.versions.find((v) => v.id === b.versionId);
      e.feedback.push({
        id: store.newId(),
        date: b.date ? new Date(b.date).toISOString() : new Date().toISOString(),
        versionId: version?.id || null,
        versionTitle: version?.title || 'Original',
        rating: Math.min(5, Math.max(0, Number(b.rating) || 0)) || null,
        tags: list(b.tags, 20),
        comment: String(b.comment || '').slice(0, 2000),
        wouldMakeAgain: typeof b.wouldMakeAgain === 'boolean' ? b.wouldMakeAgain : null,
      });
    });
    return c.json(updated(entry), 201);
  });

  app.delete('/api/library/:id/feedback/:fid', async (c) => {
    const fid = c.req.param('fid');
    return c.json(updated(await store.update(c.req.param('id'), (e) => {
      e.feedback = e.feedback.filter((f) => f.id !== fid);
    })));
  });

  app.post('/api/library/:id/alterations', async (c) => {
    const entry = await requireEntry(c);
    const b = await body(c);
    const pref = validPref(b.pref || (await store.settings()).pref);
    const version = entry.versions.find((v) => v.id === b.versionId) || null;
    const request = String(b.request || '').slice(0, 1000);
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
    const saved = await store.update(entry.id, (e) => {
      e.suggestions = suggestions.map((s) => ({ ...s, id: store.newId(), basedOn, createdAt: new Date().toISOString() }));
    });
    return c.json({ ...updated(saved), note });
  });

  // Other recipes for the same dish, ranked by how well they address this
  // recipe's feedback (and the cook's overall tastes).
  app.post('/api/library/:id/similar', async (c) => {
    const entry = await requireEntry(c);
    const b = await body(c);
    const pref = validPref(b.pref || (await store.settings()).pref);
    const version = entry.versions.find((v) => v.id === (b.versionId ?? entry.favoriteVersionId));
    const reference = withAnalysis(version ? { ...entry.recipe, ingredients: version.ingredients, steps: version.steps } : entry.recipe);
    const library = await store.list();
    const profile = mergeProfiles(buildProfile([entry], { weight: 1.5 }), buildProfile(library), 0.5);

    const times = timeFilters(b);
    if (profile.prefs?.quick > 0.3 && reference.totalTime && !times.maxTotal) times.maxTotal = reference.totalTime;
    const q = dishQuery(entry.recipe.title);
    const [{ merged, errors }, fromBlogs] = await Promise.all([
      searchSources(q, Object.keys(SOURCES), { limit: 24, times }),
      blogs.search(q, { limit: 16 }).catch(() => []),
    ]);

    let candidates = [...fromBlogs, ...merged];
    if (b.includeWeb && claudeEnabled()) {
      const wishes = [describeFeedback(entry.feedback), profileWishes(profile)].filter(Boolean).join('\n');
      const web = await searchWeb(q, { pref, limit: 10, times, wishes: `They have cooked "${entry.recipe.title}" and said:\n${wishes}\nLook for versions of this dish that address that feedback.` })
        .catch((err) => (errors.push(`Web: ${err.message}`), []));
      candidates = [...web, ...candidates];
    }

    candidates = filterRelevant(dedupe(candidates), q, { minFull: 6 }).kept;
    const savedIds = new Set(library.map((e) => e.recipe.id));
    const sameTitle = (t) => t.trim().toLowerCase() === entry.recipe.title.trim().toLowerCase();
    const results = rank(candidates.filter((r) => r.id !== entry.recipe.id && !sameTitle(r.title)), pref, { profile, reference, times })
      .map((r) => {
        const diff = r.homemade.score - reference.homemade.score;
        if (pref !== 'shortcut' && diff >= 10) r.fit.reasons.unshift('less processed than yours');
        if (pref === 'shortcut' && r.totalTime && reference.totalTime && r.totalTime < reference.totalTime - 10 && !r.fit.reasons.some((x) => x.includes('quicker'))) r.fit.reasons.push(`${reference.totalTime - r.totalTime} min quicker`);
        return { ...r, inLibrary: savedIds.has(r.id) };
      })
      .sort((a, z) => z.fit.score + z.fit.reasons.length - (a.fit.score + a.fit.reasons.length))
      .slice(0, 12);

    const lookingFor = [...profile.summary];
    if (times.maxTotal) lookingFor.push(`ready in ${times.maxTotal} min or less`);
    if (pref !== 'balanced') lookingFor.push(LEVELS.find((l) => l.id === pref).label.toLowerCase());
    return c.json({ query: q, results, errors, lookingFor, feedbackCount: entry.feedback.length });
  });

  app.post('/api/library/:id/versions', async (c) => {
    const b = await body(c);
    const fromSuggestion = b.suggestionId ? (await store.get(c.req.param('id')))?.suggestions.find((s) => s.id === b.suggestionId) : null;
    const src = fromSuggestion || b;
    if (!Array.isArray(src.ingredients) || !src.ingredients.length) throw httpError(400, 'A version needs ingredients.');
    const entry = await store.update(c.req.param('id'), (e) => {
      e.versions.push({
        id: store.newId(),
        title: String(src.title || `Version ${e.versions.length + 2}`).slice(0, 120),
        summary: String(src.summary || ''),
        why: String(src.why || ''),
        changes: list(src.changes),
        ingredients: list(src.ingredients),
        steps: list(src.steps),
        basedOn: src.basedOn || null,
        origin: src.origin || 'manual',
        createdAt: new Date().toISOString(),
      });
      if (fromSuggestion) e.suggestions = e.suggestions.filter((s) => s.id !== fromSuggestion.id);
    });
    return c.json(updated(entry), 201);
  });

  app.delete('/api/library/:id/versions/:vid', async (c) => {
    const vid = c.req.param('vid');
    return c.json(updated(await store.update(c.req.param('id'), (e) => {
      e.versions = e.versions.filter((v) => v.id !== vid);
      if (e.favoriteVersionId === vid) e.favoriteVersionId = null;
    })));
  });

  app.put('/api/library/:id/favorite', async (c) => {
    const vid = (await body(c)).versionId || null;
    return c.json(updated(await store.update(c.req.param('id'), (e) => {
      e.favoriteVersionId = vid && e.versions.some((v) => v.id === vid) ? vid : null;
    })));
  });

  // ---------- Saved photos, pages, errors ----------

  app.get('/images/:key', async (c) => {
    const img = await images.get(c.req.param('key'));
    if (!img) return c.text('Not found', 404);
    return new Response(img.body, { headers: { 'Content-Type': img.contentType, 'Cache-Control': 'public, max-age=2592000' } });
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));
  if (assets) app.get('*', assets);

  app.onError((err, c) => {
    if (typeof err.getResponse === 'function') return err.getResponse(); // e.g. the password prompt
    const status = err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    return c.json({ error: err.message || 'Something went wrong.' }, status);
  });

  return app;
}
