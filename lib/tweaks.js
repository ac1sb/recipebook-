// Rule-based alterations used when Claude is not configured.
import { adaptIngredients, LEVELS } from './homemade.js';

export const FEEDBACK_TAGS = [
  'Perfect as is', 'Too salty', 'Too bland', 'Too spicy', 'Not spicy enough', 'Too sweet', 'Not sweet enough',
  'Too dry', 'Too watery', 'Too heavy / greasy', 'Overcooked', 'Undercooked', 'Took too long', 'Too many dishes',
  'Kids loved it', 'Kids didn\'t like it',
];

const FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125 };

function parseQty(str) {
  const m = str.match(/^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+\s*[½⅓⅔¼¾⅛]?|[½⅓⅔¼¾⅛])/);
  if (!m) return null;
  const raw = m[1].trim();
  let value = 0;
  for (const part of raw.split(/\s+/)) {
    if (part.includes('/')) {
      const [a, b] = part.split('/').map(Number);
      value += a / b;
    } else {
      const frac = part.match(/[½⅓⅔¼¾⅛]/)?.[0];
      value += (parseFloat(part) || 0) + (frac ? FRACTIONS[frac] : 0);
    }
  }
  return { value, length: m[0].length };
}

function formatQty(v) {
  const whole = Math.floor(v + 1e-9);
  const rest = v - whole;
  const nice = Object.entries(FRACTIONS).find(([, f]) => Math.abs(f - rest) < 0.05);
  if (rest < 0.05) return String(whole || 0);
  if (nice) return `${whole ? whole : ''}${nice[0]}`;
  return v.toFixed(1).replace(/\.0$/, '');
}

// Things you count rather than measure get rounded to whole numbers.
const COUNTED = /^\s*(cloves?|large|medium|small|whole|eggs?|onions?|chil(i|e|li)e?s?|jalape\w*|peppers?|lemons?|limes?|bay leaves|slices?|strips?|pieces?)\b/i;

export function scaleLine(line, factor) {
  const q = parseQty(line);
  if (!q) return null;
  const rest = line.slice(q.length).trimStart();
  let value = q.value * factor;
  if (COUNTED.test(rest)) value = Math.max(1, Math.round(value));
  else if (value < 1) value = Object.values(FRACTIONS).reduce((best, f) => (Math.abs(f - value) < Math.abs(best - value) ? f : best));
  else value = Math.round(value * 4) / 4;
  return `${formatQty(value)} ${rest}`;
}

const RULES = {
  'Too salty': {
    match: /\b(salt|soy sauce|fish sauce|bouillon|parmesan|capers)\b/i,
    factor: 0.7,
    note: 'Cut salt and salty ingredients by about a third; use low-sodium broth/soy sauce and salt to taste at the end.',
  },
  'Too bland': {
    add: ['1 Tbsp lemon juice or vinegar, added at the end', 'Extra garlic and fresh herbs to finish'],
    match: /\b(salt|garlic|cumin|paprika|chili powder|oregano|thyme|pepper)\b/i,
    factor: 1.3,
    note: 'Season in layers: bump spices by ~30%, brown aromatics well, and finish with acid and fresh herbs.',
  },
  'Too spicy': {
    match: /\b(chil(i|e|li)|cayenne|jalape|sriracha|hot sauce|red pepper flakes|curry paste|chipotle|habanero)\b/i,
    factor: 0.5,
    note: 'Halve the heat sources and seed the fresh chiles; serve with yogurt or sour cream.',
  },
  'Not spicy enough': {
    match: /\b(chil(i|e|li)|cayenne|jalape|sriracha|hot sauce|red pepper flakes|chipotle)\b/i,
    factor: 1.5,
    add: ['½ tsp red pepper flakes or 1 minced fresh chile'],
    note: 'Increase heat by ~50% and add a fresh chile for brightness.',
  },
  'Too sweet': {
    match: /\b(sugar|honey|maple|syrup|molasses|sweetened)\b/i,
    factor: 0.75,
    add: ['Pinch of salt and a squeeze of lemon to balance'],
    note: 'Reduce sweeteners by a quarter and balance with salt or acid.',
  },
  'Not sweet enough': {
    match: /\b(sugar|honey|maple|syrup)\b/i,
    factor: 1.2,
    note: 'Increase sweeteners by ~20%.',
  },
  'Too dry': {
    add: ['Extra ½ cup broth or sauce', '1 Tbsp butter or olive oil'],
    note: 'Add more liquid/fat, cook 5–10 minutes less, and rest meat before slicing. For lean meat, brine 30 minutes in salted water first.',
  },
  'Too watery': {
    note: 'Simmer uncovered 10 more minutes to reduce, or stir in a slurry of 1 Tbsp cornstarch + 2 Tbsp cold water.',
  },
  'Too heavy / greasy': {
    match: /\b(butter|oil|cream|cheese|bacon|sausage)\b/i,
    factor: 0.7,
    add: ['A bright side salad or pickled onions to serve'],
    note: 'Reduce butter/oil/cream by ~30%, drain rendered fat, and add something acidic or fresh.',
  },
  'Overcooked': { note: 'Reduce cooking time by ~20% and check doneness early (use a thermometer for meat).' },
  'Undercooked': { note: 'Increase cooking time by ~20%, cut pieces smaller, or lower the heat and cook longer for even doneness.' },
  'Took too long': { shortcut: true, note: 'Use shortcuts for the slowest components (see swaps) and prep ahead.' },
  'Too many dishes': { note: 'Combine steps into one pan/pot where possible, and measure dry ingredients into one bowl.' },
  "Kids didn't like it": {
    match: /\b(chil(i|e|li)|cayenne|jalape|red pepper flakes|curry)\b/i,
    factor: 0.4,
    note: 'Tone down heat and strong flavors; serve sauces/toppings on the side so everyone can customize.',
  },
};

function applyRule(ingredients, rule) {
  const changes = [];
  const out = ingredients.map((line) => {
    if (!rule.match || !rule.factor || !rule.match.test(line)) return line;
    const scaled = scaleLine(line, rule.factor);
    if (scaled && scaled !== line) {
      changes.push(`${line} → ${scaled}`);
      return scaled;
    }
    return line;
  });
  for (const a of rule.add || []) {
    out.push(a);
    changes.push(`Add: ${a}`);
  }
  return { ingredients: out, changes };
}

export function ruleBasedAlterations({ recipe, version, feedback = [], pref = 'balanced' }) {
  const current = version || recipe;
  const latest = feedback[feedback.length - 1];
  const tags = [...new Set(feedback.slice(-3).flatMap((f) => f.tags || []))].filter((t) => RULES[t]);
  const results = [];

  if (tags.length) {
    let ingredients = [...current.ingredients];
    const changes = [];
    const notes = [];
    for (const tag of tags) {
      const r = applyRule(ingredients, RULES[tag]);
      ingredients = r.ingredients;
      changes.push(...r.changes);
      notes.push(`${tag}: ${RULES[tag].note}`);
    }
    results.push({
      title: `Fix: ${tags.slice(0, 3).join(', ').toLowerCase()}`,
      summary: 'Adjusts quantities and technique based on your recent notes.',
      why: notes.join(' '),
      changes: [...changes, ...notes],
      ingredients,
      steps: [...current.steps, ...notes.map((n) => `Tip — ${n}`)],
      difficulty: 'same',
      origin: 'rules',
    });
  }

  const wantsShortcut = tags.includes('Took too long') || tags.includes('Too many dishes');
  const directions = wantsShortcut ? ['shortcut'] : pref === 'shortcut' ? ['shortcut', 'scratch'] : ['scratch', 'shortcut'];
  for (const dir of directions) {
    const adapted = adaptIngredients(current.ingredients, dir);
    if (!adapted.changes.length) continue;
    const level = LEVELS.find((l) => l.id === dir);
    results.push({
      title: dir === 'scratch' ? 'More homemade' : 'Quicker with shortcuts',
      summary: dir === 'scratch'
        ? 'Replaces canned, jarred, boxed and processed products with homemade components.'
        : 'Swaps time-consuming homemade components for good store-bought ones.',
      why: `${level.desc}${latest?.rating ? ` Your last rating was ${latest.rating}/5.` : ''}`,
      changes: adapted.changes.map((c) => `${c.label}: ${c.to}`),
      ingredients: adapted.ingredients,
      steps: [...current.steps],
      difficulty: dir === 'scratch' ? 'more involved' : 'easier',
      origin: 'rules',
    });
  }

  if (!results.length) {
    results.push({
      title: 'Keep it as is',
      summary: 'Nothing obvious to change from your notes. Add feedback tags (e.g. "Too bland") for targeted tweaks.',
      why: 'Add an ANTHROPIC_API_KEY to get creative, feedback-specific alterations from Claude.',
      changes: [],
      ingredients: [...current.ingredients],
      steps: [...current.steps],
      difficulty: 'same',
      origin: 'rules',
    });
  }
  return results.slice(0, 3);
}
