// How well a recipe matches what was searched for. Every meaningful word in
// the search ("chicken", "noodle", "soup") has to show up somewhere sensible:
// ingredients words in the title or ingredient list, dish words ("soup",
// "tacos") in the title, tags or method. Synonyms count ("prawn" = "shrimp").

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'with', 'for', 'of', 'in', 'on', 'to', 'my', 'me', 'some', 'easy', 'best', 'quick',
  'simple', 'homemade', 'recipe', 'recipes', 'style', 'classic', 'healthy', 'good', 'great', 'yummy', 'tasty', 'delicious', 'make', 'how']);

// Kinds of dish: matched against the title, tags, description and method, not ingredients
// (a casserole that uses "cream of chicken soup" is not a soup).
const DISHES = {
  soup: ['soup', 'broth', 'chowder', 'bisque', 'pho', 'ramen', 'laksa', 'consomme', 'consommé', 'potage', 'minestrone', 'gumbo', 'caldo', 'sopa',
    'zuppa', 'avgolemono', 'waterzooi', 'rosol', 'rosół', 'tom yum', 'tom kha', 'congee', 'borscht', 'pozole', 'posole', 'mulligatawny'],
  stew: ['stew', 'ragout', 'goulash', 'tagine', 'bourguignon', 'cassoulet', 'hotpot', 'hot pot', 'stifado', 'moqueca', 'bigos', 'navarin'],
  chili: ['chili', 'chilli', 'chile con carne'],
  curry: ['curry', 'korma', 'masala', 'vindaloo', 'jalfrezi', 'madras', 'rogan josh', 'dhansak', 'balti', 'handi', 'dal', 'dhal'],
  taco: ['taco', 'tacos'],
  burrito: ['burrito', 'burritos'],
  enchilada: ['enchilada', 'enchiladas'],
  pie: ['pie', 'pot pie', 'pasty', 'tart', 'galette'],
  cake: ['cake', 'cupcake', 'gateau', 'gâteau', 'torte', 'cheesecake'],
  cookie: ['cookie', 'cookies', 'biscuit', 'biscuits'],
  bread: ['bread', 'loaf', 'focaccia', 'baguette', 'brioche', 'naan', 'roti'],
  casserole: ['casserole', 'bake', 'gratin', 'hotdish', 'traybake'],
  salad: ['salad', 'slaw', 'coleslaw'],
  sandwich: ['sandwich', 'sandwiches', 'sub', 'panini', 'wrap', 'wraps', 'toastie', 'sarnie', 'po boy'],
  burger: ['burger', 'burgers', 'patty', 'patties'],
  pizza: ['pizza', 'flatbread', 'calzone'],
  lasagna: ['lasagna', 'lasagne'],
  'stir fry': ['stir fry', 'stir-fry', 'stirfry', 'stir fried', 'stir-fried'],
  roast: ['roast', 'roasted'],
  pancake: ['pancake', 'pancakes', 'crepe', 'crepes', 'crêpes', 'hotcake'],
  muffin: ['muffin', 'muffins'],
  brownie: ['brownie', 'brownies'],
  dumpling: ['dumpling', 'dumplings', 'gyoza', 'potsticker', 'potstickers', 'pierogi', 'momo', 'wonton', 'wontons'],
  omelette: ['omelette', 'omelet', 'frittata'],
  risotto: ['risotto'],
  kebab: ['kebab', 'kebabs', 'kabob', 'skewer', 'skewers', 'souvlaki', 'shish'],
  meatball: ['meatball', 'meatballs', 'kofta', 'kofte'],
  sauce: ['sauce'],
  dessert: ['dessert', 'pudding', 'cake', 'pie', 'tart', 'cookie', 'mousse', 'ice cream', 'crumble', 'cobbler', 'brownie'],
  breakfast: ['breakfast', 'brunch'],
};

// Ingredient words with their common alternatives.
const INGREDIENTS = {
  chicken: ['chicken', 'poultry', 'hen'],
  beef: ['beef', 'steak', 'brisket', 'sirloin', 'chuck', 'ground beef', 'minced beef', 'beef mince', 'oxtail'],
  pork: ['pork', 'bacon', 'ham', 'sausage', 'chorizo', 'pancetta', 'prosciutto', 'pork belly'],
  lamb: ['lamb', 'mutton'],
  turkey: ['turkey'],
  fish: ['fish', 'salmon', 'cod', 'tuna', 'haddock', 'tilapia', 'halibut', 'trout', 'mackerel', 'sea bass', 'snapper', 'pollock', 'sardines'],
  shrimp: ['shrimp', 'prawn', 'prawns', 'langoustine'],
  seafood: ['seafood', 'shrimp', 'prawn', 'crab', 'lobster', 'mussels', 'clams', 'scallops', 'squid', 'calamari', 'fish', 'salmon', 'cod'],
  pasta: ['pasta', 'spaghetti', 'penne', 'fettuccine', 'linguine', 'macaroni', 'rigatoni', 'tagliatelle', 'orzo', 'ziti', 'fusilli', 'farfalle', 'gnocchi', 'ravioli', 'tortellini', 'lasagna', 'lasagne', 'carbonara', 'bolognese', 'mac and cheese', 'mac n cheese', 'mac & cheese'],
  noodle: ['noodle', 'noodles', 'egg noodles', 'vermicelli', 'ramen', 'udon', 'soba', 'lo mein', 'chow mein', 'rice noodles', 'glass noodles', 'pho'],
  rice: ['rice', 'risotto', 'pilaf', 'pilau', 'biryani', 'paella', 'jambalaya'],
  potato: ['potato', 'potatoes', 'spud', 'spuds'],
  bean: ['bean', 'beans', 'chickpea', 'chickpeas', 'lentil', 'lentils', 'legumes'],
  egg: ['egg', 'eggs'],
  cheese: ['cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'ricotta', 'gruyere', 'brie', 'halloumi', 'paneer'],
  chocolate: ['chocolate', 'cocoa', 'cacao'],
  mushroom: ['mushroom', 'mushrooms', 'porcini', 'shiitake', 'chanterelle'],
  tofu: ['tofu', 'bean curd'],
  vegetable: ['vegetable', 'vegetables', 'veggie', 'veggies', 'veg', 'vegetarian', 'vegan', 'zucchini', 'courgette', 'eggplant', 'aubergine',
    'spinach', 'mushroom', 'bell pepper', 'squash', 'carrot', 'broccoli', 'cauliflower', 'kale'],
  vegetarian: ['vegetarian', 'vegan', 'meatless', 'meat-free', 'veggie'],
  apple: ['apple', 'apples'],
  lemon: ['lemon', 'lemons'],
  pumpkin: ['pumpkin', 'squash'],
};

const ALL = { ...INGREDIENTS, ...DISHES };

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function singular(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|sses|xes|oes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

// "chicken noodle soup" -> [{ word: 'chicken', kind: 'ingredient', variants }, ...]
export function parseQuery(query) {
  const words = String(query).toLowerCase().replace(/[^a-z0-9\sàâçéèêëîïôûùüÿñæœ'-]/g, ' ').split(/\s+/).filter(Boolean);
  const terms = [];
  for (let i = 0; i < words.length; i++) {
    // Two-word dish names first ("stir fry", "pot pie").
    const pair = `${words[i]} ${words[i + 1] || ''}`.trim();
    if (words[i + 1] && ALL[pair]) {
      terms.push(makeTerm(pair));
      i++;
      continue;
    }
    if (STOP.has(words[i]) || words[i].length < 2) continue;
    terms.push(makeTerm(words[i]));
  }
  return terms;
}

function makeTerm(word) {
  const key = ALL[word] ? word : singular(word);
  const kind = DISHES[key] ? 'dish' : 'ingredient';
  const variants = [...new Set([word, key, ...(ALL[key] || [])])];
  // Unicode-aware word boundaries so words like "rosół" or "crêpes" match.
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${variants.map(escapeRe).sort((a, b) => b.length - a.length).join('|')})(e?s)?(?![\\p{L}\\p{N}])`, 'iu');
  return { word, key, kind, variants, re };
}

// Returns { score, matched, missing, full }.
export function relevance(recipe, terms, query = '') {
  const title = String(recipe.title || '').toLowerCase();
  const meta = [recipe.description, ...(recipe.tags || [])].join(' ').toLowerCase();
  // "chicken stock" or "cream of chicken soup" doesn't make a dish a chicken dish.
  const ingredients = (recipe.ingredients || []).join(' \n ').toLowerCase()
    .replace(/\b(chicken|beef|vegetable|veggie|fish|shrimp|pork|turkey|mushroom)\s+(stock|broth|bouillon|base|cubes?|soup|gravy|fat|seasoning|granules|powder|flavou?r(ing)?)\b/g, ' $2')
    .replace(/\bcream of \w+ soup\b/g, ' soup');
  const steps = (recipe.steps || []).join(' \n ').toLowerCase();
  const matched = [];
  const missing = [];
  let score = 0;

  for (const t of terms) {
    let s = 0;
    if (t.re.test(title)) s += 3;
    if (t.re.test(meta)) s += 1.5;
    if (t.kind === 'ingredient') {
      if (t.re.test(ingredients)) s += 2;
    } else {
      // Dish words in the method ("ladle the soup") count a little; in the ingredient list they don't.
      const mentions = steps.match(new RegExp(t.re.source, 'giu'))?.length || 0;
      s += Math.min(mentions * 0.5, 1);
    }
    score += s;
    (s >= 1 ? matched : missing).push(t.word);
  }
  // Everything searched for is right there in the name: the strongest signal.
  if (terms.length && terms.every((t) => t.re.test(title))) score += 5;
  const phrase = String(query).trim().toLowerCase();
  if (phrase && title.includes(phrase)) score += 4;
  return { score, matched, missing, full: missing.length === 0 };
}

// Keeps recipes that match the search: all full matches, plus partial ones
// (labelled) when there aren't many full matches.
export function filterRelevant(recipes, query, { minFull = 8 } = {}) {
  const terms = parseQuery(query);
  if (!terms.length) return { kept: recipes.map((r) => ({ ...r, relevance: { score: 0, matched: [], missing: [], full: true } })), partial: 0, dropped: 0 };
  const scored = recipes.map((r) => ({ ...r, relevance: relevance(r, terms, query) }));
  const full = scored.filter((r) => r.relevance.full);
  const needed = Math.ceil(terms.length / 2);
  const main = terms.find((t) => t.kind === 'ingredient')?.word;
  const missesMain = (r) => (main && r.relevance.missing.includes(main) ? 1 : 0);
  // A partial match must still hit at least half the words, and for multi-word searches the main ingredient/dish.
  const partial = full.length >= minFull
    ? []
    : scored.filter((r) => !r.relevance.full && r.relevance.matched.length >= needed && r.relevance.matched.length > 0)
      // Missing the main ingredient (first one searched) is worse than missing a side detail.
      .sort((a, b) => missesMain(a) - missesMain(b) || b.relevance.matched.length - a.relevance.matched.length || b.relevance.score - a.relevance.score)
      .slice(0, Math.max(0, minFull - full.length));
  return { kept: [...full, ...partial], partial: partial.length, dropped: recipes.length - full.length - partial.length };
}
