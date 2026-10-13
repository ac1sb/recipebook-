// Learns what the cook likes from their feedback, and scores other recipes
// by how well they fit: milder or spicier, quicker, lighter, less salty,
// and with the ingredients and cuisines they rate highly.

const FEATURES = {
  spicy: /\b(chil(i|e|li)e?s?|cayenne|jalape\w*|serrano|sriracha|hot sauce|red pepper flakes|chipotle|habanero|curry paste|gochujang|harissa|sambal|tabasco)\b/i,
  salty: /\b(soy sauce|fish sauce|bouillon|bacon|olives|capers|anchov\w*|parmesan|feta|salt pork|ham|miso|pancetta)\b/i,
  sweet: /\b(sugar|honey|maple|syrup|molasses|condensed milk|chocolate|caramel|jam)\b/i,
  rich: /\b(cream|butter|cheese|bacon|sausage|lard|mayonnaise|mayo|ghee|coconut cream)\b/i,
  bold: /\b(garlic|ginger|lemon|lime|vinegar|cumin|paprika|basil|cilantro|parsley|mint|chil(i|e|li)|mustard|herbs?|zest|smoked)\b/i,
};

const LABELS = {
  spicy: ['milder', 'spicier'],
  salty: ['less salty', 'saltier'],
  sweet: ['less sweet', 'sweeter'],
  rich: ['lighter', 'richer'],
  bold: ['more subtle', 'more flavorful'],
};

// Feedback tag -> preference nudges (negative = wants less of that feature).
const TAG_EFFECTS = {
  'Too spicy': { spicy: -1 },
  'Not spicy enough': { spicy: 1 },
  'Too salty': { salty: -1 },
  'Too bland': { bold: 1 },
  'Too sweet': { sweet: -1 },
  'Not sweet enough': { sweet: 1 },
  'Too heavy / greasy': { rich: -1 },
  'Took too long': { quick: 1 },
  'Too many dishes': { quick: 0.5 },
  "Kids didn't like it": { spicy: -0.5, bold: -0.3 },
};

const MAIN_INGREDIENTS = ['chicken', 'beef', 'pork', 'lamb', 'turkey', 'salmon', 'fish', 'shrimp', 'tofu', 'beans', 'lentils', 'chickpeas',
  'pasta', 'noodles', 'rice', 'potato', 'mushroom', 'eggplant', 'cauliflower', 'broccoli', 'spinach', 'cheese', 'egg', 'sausage', 'squash', 'corn'];
const CUISINES = ['italian', 'mexican', 'indian', 'chinese', 'thai', 'japanese', 'french', 'greek', 'spanish', 'korean', 'vietnamese', 'moroccan',
  'american', 'british', 'mediterranean', 'middle eastern', 'cajun', 'caribbean', 'jamaican', 'turkish', 'filipino', 'irish', 'polish'];

function text(recipe) {
  return [recipe.title, recipe.description, ...(recipe.tags || []), ...(recipe.ingredients || [])].join(' \n ').toLowerCase();
}

export function features(recipe) {
  const out = {};
  for (const [k, re] of Object.entries(FEATURES)) {
    const hits = (recipe.ingredients || []).filter((i) => re.test(i)).length;
    out[k] = Math.min(hits, 3) / 3; // 0..1
  }
  return out;
}

export function tokens(recipe) {
  const t = text(recipe);
  const found = new Set();
  for (const w of [...MAIN_INGREDIENTS, ...CUISINES]) if (new RegExp(`\\b${w}(e?s)?\\b`).test(t)) found.add(w);
  return found;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// entries: library entries ({ recipe, versions, feedback }). Newer feedback counts more.
export function buildProfile(entries = [], { weight = 1 } = {}) {
  const prefs = { spicy: 0, salty: 0, sweet: 0, rich: 0, bold: 0, quick: 0 };
  const likes = new Map();
  const dislikes = new Map();
  const tagCounts = new Map();
  const all = entries.flatMap((e) => e.feedback.map((f) => ({ f, e })));
  all.sort((a, b) => String(b.f.date).localeCompare(String(a.f.date)));

  all.forEach(({ f, e }, i) => {
    const w = weight * Math.pow(0.9, i);
    for (const tag of f.tags || []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      for (const [k, v] of Object.entries(TAG_EFFECTS[tag] || {})) prefs[k] += v * w;
    }
    const liked = f.rating >= 4 || f.wouldMakeAgain === true || (f.tags || []).includes('Kids loved it');
    // A low rating that the notes already explain ("Too spicy") is about that
    // problem, not the ingredients, so it doesn't count against them.
    const explained = (f.tags || []).some((t) => TAG_EFFECTS[t]);
    const disliked = ((f.rating && f.rating <= 2) || f.wouldMakeAgain === false) && !explained;
    if (liked || disliked) {
      const version = e.versions?.find((v) => v.id === f.versionId);
      const r = version ? { ...e.recipe, ingredients: version.ingredients } : e.recipe;
      const target = liked ? likes : dislikes;
      for (const t of tokens(r)) target.set(t, (target.get(t) || 0) + w);
    }
  });

  for (const k of Object.keys(prefs)) prefs[k] = Math.max(-2, Math.min(2, prefs[k]));
  const summary = [];
  for (const [k, v] of Object.entries(prefs)) {
    if (Math.abs(v) < 0.5) continue;
    if (k === 'quick') summary.push('quicker recipes');
    else summary.push(`${LABELS[k][v > 0 ? 1 : 0]} food`);
  }
  const topLikes = [...likes].filter(([t]) => !dislikes.has(t) || dislikes.get(t) < likes.get(t)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
  const topDislikes = [...dislikes].filter(([t]) => !likes.has(t) || likes.get(t) < dislikes.get(t)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);

  return {
    feedbackCount: all.length,
    prefs,
    likes: Object.fromEntries([...likes].filter(([t]) => topLikes.includes(t))),
    dislikes: Object.fromEntries([...dislikes].filter(([t]) => topDislikes.includes(t))),
    summary,
    topLikes,
    topDislikes,
    commonNotes: [...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${t} (${plural(n, 'time')})`),
  };
}

export function mergeProfiles(primary, secondary, secondaryWeight = 0.5) {
  if (!secondary?.feedbackCount) return primary;
  if (!primary?.feedbackCount) return secondary;
  const prefs = {};
  for (const k of Object.keys(primary.prefs)) prefs[k] = primary.prefs[k] + secondary.prefs[k] * secondaryWeight;
  const mergeMap = (a, b) => {
    const m = { ...a };
    for (const [k, v] of Object.entries(b)) m[k] = (m[k] || 0) + v * secondaryWeight;
    return m;
  };
  return { ...primary, prefs, likes: mergeMap(primary.likes, secondary.likes), dislikes: mergeMap(primary.dislikes, secondary.dislikes) };
}

// Scores a recipe against a profile. With a reference recipe, compares to it
// ("15 min quicker than …") instead of judging in absolute terms.
// Returns { score, reasons, warnings }; score is roughly -10..10.
export function fit(recipe, profile, reference = null) {
  const reasons = [];
  const warnings = [];
  if (!profile?.feedbackCount) return { score: 0, reasons, warnings };
  let score = 0;
  const f = features(recipe);
  const ref = reference ? features(reference) : null;

  for (const k of Object.keys(FEATURES)) {
    const want = profile.prefs[k];
    if (Math.abs(want) < 0.3) continue;
    const [less, more] = LABELS[k];
    if (ref) {
      const diff = f[k] - ref[k];
      score += want * diff * 6;
      if (Math.abs(diff) >= 0.3) {
        if (Math.sign(diff) === Math.sign(want)) reasons.push(`${diff > 0 ? more : less} than yours`);
        else warnings.push(`${diff > 0 ? more : less} than yours`);
      }
    } else {
      // Absolute: wanting "less" rewards recipes without the feature; "more" rewards having it.
      const centered = f[k] - 0.34;
      score += want * centered * 4;
      if (want < 0 && f[k] === 0) reasons.push(less);
      else if (want < 0 && f[k] >= 0.66) warnings.push(more);
      else if (want > 0 && f[k] >= 0.66) reasons.push(more);
    }
  }

  const want = profile.prefs.quick;
  if (want > 0.3 && recipe.totalTime) {
    if (reference?.totalTime) {
      const saved = reference.totalTime - recipe.totalTime;
      score += want * Math.max(-3, Math.min(3, saved / 15));
      if (saved >= 10) reasons.push(`${saved} min quicker`);
      else if (saved <= -15) warnings.push(`${-saved} min longer`);
    } else {
      score += want * Math.max(-2, Math.min(2, (45 - recipe.totalTime) / 20));
      if (recipe.totalTime <= 30) reasons.push(`quick (${recipe.totalTime} min)`);
      else if (recipe.totalTime >= 90) warnings.push(`takes ${recipe.totalTime} min`);
    }
  }

  // When comparing versions of the same dish, shared ingredients aren't a signal.
  const refTokens = reference ? tokens(reference) : new Set();
  const has = new Set([...tokens(recipe)].filter((t) => !refTokens.has(t)));
  const liked = [...has].filter((t) => profile.likes[t]);
  const disliked = [...has].filter((t) => profile.dislikes[t]);
  score += liked.reduce((s, t) => s + Math.min(profile.likes[t], 2), 0);
  score -= disliked.reduce((s, t) => s + Math.min(profile.dislikes[t], 2), 0);
  if (liked.length) reasons.push(`${liked.slice(0, 2).join(' & ')}, which you rated highly`);
  if (disliked.length) warnings.push(`${disliked[0]}, which you rated low`);

  return { score: Math.round(score * 10) / 10, reasons: reasons.slice(0, 3), warnings: warnings.slice(0, 2) };
}

// Turns a recipe title into a search query for "other versions of this dish".
export function dishQuery(title = '') {
  const cleaned = title
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(the|best|easy|easiest|simple|quick|classic|ultimate|perfect|homemade|my|our|favorite|famous|amazing|authentic|healthy|grandma'?s|mom'?s|recipe|ever|style|copycat|\d+[- ]minute|one[- ]pot)\b/g, ' ')
    .replace(/[^a-z\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || title;
}
