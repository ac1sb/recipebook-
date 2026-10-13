// Prep and cook times. Uses the source's numbers when it has them and
// estimates from the ingredients and method when it doesn't.

const DURATION = /(\d+(?:\.\d+)?|an?|one|two|three|four|five|ten|fifteen|twenty|thirty|forty|forty-five|ninety)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|h\b|minutes?|mins?|m\b)/gi;
const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, ninety: 90 };
// Waiting time that isn't hands-on prep or cooking.
const PASSIVE = /\b(marinate|marinade|chill|refrigerate|fridge|freeze|rest|soak|rise|proof|stand|set aside|cool|overnight)\b/i;
const NOT_COOKING = /\b(knead|whisk|mix|stir together|beat|chop|slice|dice|massage)\b/i;

function minutesIn(raw) {
  const text = raw
    .replace(/(\d+)\s+1\/2|(\d+)\s*½/g, (_, a, b) => `${a ?? b}.5`)
    .replace(/(^|\s)(?:1\/2|½)(?=\s)/g, '$10.5')
    .replace(/(^|\s)(?:1\/4|¼)(?=\s)/g, '$10.25');
  let total = 0;
  for (const m of text.matchAll(DURATION)) {
    const n = Number(m[2] ?? (WORDS[m[1].toLowerCase()] ?? m[1]));
    if (!Number.isFinite(n)) continue;
    total += /^h/i.test(m[3]) ? n * 60 : n;
  }
  return total;
}

export function estimateTimes(recipe) {
  let cook = 0;
  let inactive = 0;
  let prepFromSteps = 0;
  for (const step of recipe.steps || []) {
    const mins = minutesIn(step);
    if (/\bovernight\b/i.test(step)) inactive += 480;
    if (!mins) continue;
    if (PASSIVE.test(step)) inactive += mins;
    else if (NOT_COOKING.test(step) && !/\b(cook|bake|roast|simmer|boil|fry|grill|saut[eé])/i.test(step)) prepFromSteps += mins;
    else cook += mins;
  }
  // No times written in the method: guess from how it's cooked.
  if (!cook) {
    const method = (recipe.steps || []).join(' ');
    if (/\b(braise|stew|slow cook|simmer)/i.test(method)) cook = 45;
    else if (/\b(bake|roast|oven)/i.test(method)) cook = 30;
    else if (/\b(fry|saut[eé]|grill|boil|sear|cook|toast|heat)/i.test(method)) cook = 15;
  }
  // Hands-on prep: roughly 2 minutes per ingredient plus setup.
  const n = (recipe.ingredients || []).length;
  const prep = Math.min(60, Math.round((5 + n * 2 + prepFromSteps) / 5) * 5);
  return { prep, cook: Math.min(cook, 600), inactive };
}

const positive = (v) => (Number(v) > 0 ? Math.round(Number(v)) : null);

// Fills prepTime/cookTime/totalTime and marks which ones were estimated.
export function withTimes(recipe) {
  let prep = positive(recipe.prepTime);
  let cook = positive(recipe.cookTime);
  const total = positive(recipe.totalTime);
  const estimated = { prep: false, cook: false };
  if (prep == null || cook == null) {
    const est = estimateTimes(recipe);
    if (prep == null && cook != null && total) prep = Math.max(0, total - cook);
    if (cook == null && prep != null && total) cook = Math.max(0, total - prep - est.inactive);
    if (prep == null) {
      prep = total ? Math.min(est.prep, total) : est.prep;
      estimated.prep = true;
    }
    if (cook == null) {
      cook = total ? Math.max(0, total - prep - est.inactive) || est.cook : est.cook;
      estimated.cook = true;
    }
  }
  // "15-minute chicken burgers": trust the title over a rough estimate.
  const titled = Number(String(recipe.title || '').match(/\b(\d{1,3})[- ]min(ute)?s?\b/i)?.[1]);
  if (titled && !total && (estimated.prep || estimated.cook) && prep + cook > titled) {
    const ratio = titled / (prep + cook);
    prep = Math.max(1, Math.round(prep * ratio));
    cook = titled - prep;
  }
  return {
    ...recipe,
    prepTime: prep,
    cookTime: cook,
    totalTime: total || prep + cook || null,
    timeEstimated: estimated.prep || estimated.cook,
  };
}

export function matchesTime(recipe, { maxPrep, maxCook, maxTotal } = {}) {
  if (maxPrep && recipe.prepTime > maxPrep) return false;
  if (maxCook && recipe.cookTime > maxCook) return false;
  if (maxTotal && recipe.totalTime > maxTotal) return false;
  return true;
}
