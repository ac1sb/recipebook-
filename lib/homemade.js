// Scores how processed vs. "from scratch" a recipe is, and suggests swaps in
// either direction: processed/packaged product -> homemade, or homemade -> shortcut.
// Rules have a kind: 'packaged' (canned, boxed, jarred, store-bought) or
// 'processed' (industrially processed foods such as deli meat or margarine).

// weight: how much the product counts against "homemade" (1 = typical canned
// item, 2 = a whole component like a cake mix, 0.5 = minor/commonly accepted).
const CONVENIENCE_RULES = [
  // Mixes, packets, boxed meals
  { re: /\b(cake|brownie|muffin|cookie|cornbread|biscuit) mix\b/i, label: 'Boxed baking mix', weight: 2,
    scratch: 'Make the base from flour, sugar, baking powder, salt, butter and eggs (about 10 extra minutes).' },
  { re: /\b(bisquick|pancake mix|baking mix)\b/i, label: 'Baking mix', weight: 1.5,
    scratch: 'For 1 cup mix: 1 cup flour + 1½ tsp baking powder + ¼ tsp salt + 1 Tbsp cold butter, rubbed in.' },
  { re: /\b(taco|fajita|chili|ranch|italian dressing|onion soup|gravy|stroganoff|sloppy joe) (seasoning|mix|packet|envelope)\b|\bseasoning (packet|mix|envelope)\b|\b(envelope|packet) (of )?[\w ]*mix\b/i, label: 'Seasoning packet', weight: 1,
    scratch: 'Blend your own: e.g. taco = 1 Tbsp chili powder, 1½ tsp cumin, 1 tsp paprika, ½ tsp each garlic powder, onion powder, oregano, salt.' },
  { re: /\b(boxed|box of) (mac(aroni)? (and|&) cheese|stuffing|rice pilaf)\b|\bstove ?top stuffing\b|\bhamburger helper\b/i, label: 'Boxed side', weight: 2,
    scratch: 'Cook the starch yourself and season with butter, broth, herbs and cheese.' },
  { re: /\binstant (rice|potato(es)?|mashed potato(es)?|pudding|oats|noodles?)\b|\bpotato flakes\b/i, kind: 'processed', label: 'Instant product', weight: 1,
    scratch: 'Use the whole ingredient (regular rice, real potatoes, cooked pudding from milk, sugar, cornstarch and egg).' },
  { re: /\b(jell-?o|gelatin dessert)\b/i, kind: 'processed', label: 'Flavored gelatin', weight: 1,
    scratch: 'Bloom unflavored gelatin in fruit juice and sweeten to taste.' },

  // Soups & sauces
  { re: /\bcream of (mushroom|chicken|celery|potato) soup\b|\bcondensed [\w ]*soup\b/i, label: 'Condensed soup', weight: 1.5,
    scratch: 'Per can: melt 3 Tbsp butter, whisk in 3 Tbsp flour, add 1¼ cups milk or broth plus sautéed mushrooms/celery/chicken; simmer until thick.' },
  { re: /\b(jarred|store[- ]bought|prepared)?\s*(pasta|spaghetti|marinara|tomato basil|vodka|alfredo) sauce\b|\bjar(red)? (of )?(marinara|alfredo|salsa|pesto)\b|\bragu\b|\bprego\b/i, label: 'Jarred sauce', weight: 1,
    scratch: 'Simmer canned/fresh tomatoes with olive oil, garlic, onion, salt and basil for 20–30 min (alfredo: butter, cream, parmesan).' },
  { re: /\b(jarred|store[- ]bought|prepared) (salsa|pesto|gravy|curry paste|enchilada sauce|bbq sauce|barbecue sauce)\b|\benchilada sauce\b|\b(bbq|barbecue|teriyaki|stir[- ]fry) sauce\b|\bcurry paste\b/i, label: 'Bottled sauce', weight: 0.75,
    scratch: 'Make it fresh — most of these are 5–10 minutes of whisking or blending pantry staples.' },
  { re: /\b(salad dressing|ranch dressing|italian dressing|thousand island)\b/i, label: 'Bottled dressing', weight: 0.5,
    scratch: 'Whisk oil, vinegar or lemon, mustard, salt, pepper and herbs (ranch: mayo + buttermilk + dill, chives, garlic).' },
  { re: /\b(bouillon|stock cubes?|broth cubes?|better than bouillon|base paste)\b/i, label: 'Bouillon', weight: 0.75,
    scratch: 'Simmer bones or vegetable scraps with onion, carrot, celery and bay leaf 1–4 hours for stock.' },
  { re: /\b(canned|boxed|carton|store[- ]bought|low[- ]sodium)\s+[\w ]*(broth|stock)\b|\bcans? (of )?[\w ]*(broth|stock)\b/i, label: 'Store-bought broth', weight: 0.5,
    scratch: 'Simmer bones or vegetable scraps with onion, carrot, celery and bay leaf 1–4 hours for stock.' },

  // Canned goods
  { re: /\b(canned|tinned|can|cans|tins?)\b[^,;]*\b(beans?|chickpeas|garbanzos?|lentils)\b|\b(beans?|chickpeas|lentils)\b[^,;]*\b(canned|tinned|drained and rinsed|rinsed and drained)\b/i, label: 'Canned beans', weight: 1,
    scratch: 'Cook dried beans: ~½ cup dried = one 15-oz can. Soak overnight, then simmer 1–2 hours with salt and a bay leaf.' },
  { re: /\b(canned|tinned|can|cans|tins?)\b[^,;]*\btomato(es)?\b|\btomato (paste|puree|purée)\b|\b(rotel|ro-tel)\b|\bcrushed tomatoes\b|\bdiced tomatoes\b/i, label: 'Canned tomatoes', weight: 0.75,
    scratch: 'Use ripe fresh tomatoes: score, blanch 30 s, peel and chop (~2½ lb fresh = one 28-oz can). Cook down for paste.' },
  { re: /\b(canned|tinned|can|cans)\b[^,;]*\b(corn|peas|green beans|carrots|mushrooms|potatoes|spinach|artichoke)/i, label: 'Canned vegetables', weight: 0.75,
    scratch: 'Use fresh or frozen vegetables and cook them briefly yourself.' },
  { re: /\b(canned|tinned|can|cans)\b[^,;]*\b(chicken|tuna|salmon|crab|ham|chili)\b/i, label: 'Canned protein', weight: 1,
    scratch: 'Poach or roast the fresh protein and shred/flake it.' },
  { re: /\b(canned|can|cans|tin)\b[^,;]*\b(pumpkin|fruit cocktail|peaches|pears|pineapple|cherry pie filling|pie filling|apple pie filling)\b|\bpie filling\b|\bpumpkin pur[ée]e\b/i, label: 'Canned fruit / filling', weight: 1,
    scratch: 'Cook fresh fruit with sugar, lemon and a little cornstarch; roast and purée pumpkin or squash.' },
  { re: /\bsweetened condensed milk\b/i, label: 'Condensed milk', weight: 0.5,
    scratch: 'Simmer 2 cups milk with ⅔ cup sugar, stirring, until reduced to about 1¼ cups.' },
  { re: /\bevaporated milk\b/i, label: 'Evaporated milk', weight: 0.5,
    scratch: 'Gently simmer 2¼ cups milk until reduced to 1 cup.' },
  { re: /\b(canned|can of)\b[^,;]*\b(soup|chili|gravy)\b/i, label: 'Canned soup', weight: 1,
    scratch: 'Build a quick soup or sauce from broth, aromatics and a roux.' },

  // Doughs and bakery items
  { re: /\b(refrigerated|store[- ]bought|pre[- ]?made|ready[- ]made|frozen|prepared) [\w ]*(pie crusts?|pie shells?|pastry|puff pastry|pizza dough|bread dough|biscuits|crescent rolls|cookie dough|phyllo|filo)\b|\b(crescent rolls|pillsbury|graham cracker crust|pie shell|puff pastry|phyllo|filo)\b/i, label: 'Ready-made dough', weight: 1.5,
    scratch: 'Make the dough: pie crust = 1¼ cups flour, ½ cup cold butter, pinch salt, 3–4 Tbsp ice water. Rest 30 min.' },
  { re: /\b(store[- ]bought|prepared|packaged)?\s*(bread ?crumbs|panko|croutons|tortillas?|taco shells|tostada shells|pita|naan|hamburger buns|hot dog buns)\b/i, label: 'Packaged bread item', weight: 0.5,
    scratch: 'Make it: blitz stale bread for crumbs, toast cubes for croutons, or press flour/masa tortillas.' },
  { re: /\b(cool ?whip|whipped topping|aerosol whipped cream)\b/i, kind: 'processed', label: 'Whipped topping', weight: 0.75,
    scratch: 'Whip 1 cup cold heavy cream with 1–2 Tbsp sugar and a little vanilla.' },
  { re: /\b(velveeta|processed cheese|cheese whiz|cheez whiz|american cheese|nacho cheese sauce)\b/i, kind: 'processed', label: 'Processed cheese', weight: 1,
    scratch: 'Make a cheese sauce: butter + flour roux, milk, then melt in shredded cheddar.' },
  { re: /\b(pre[- ]?shredded|bagged shredded)\b/i, label: 'Pre-shredded', weight: 0.25,
    scratch: 'Shred it fresh from the block (it melts better).' },

  // Prepared proteins & frozen meals
  { re: /\brotisserie chicken\b/i, label: 'Rotisserie chicken', weight: 1,
    scratch: 'Roast or poach chicken thighs/breasts yourself and shred.' },
  { re: /\bfrozen\b[^,;]*\b(meatballs|hash browns|tater tots|french fries|fries|chicken nuggets|ravioli|dumplings|potstickers|waffles)\b/i, kind: 'processed', label: 'Frozen prepared food', weight: 1.5,
    scratch: 'Make the component from raw ingredients (grated potatoes, ground meat, fresh pasta dough).' },
  { re: /\bfrozen\b[^,;]*\b(vegetables|veggies|peas|corn|spinach|broccoli|mixed veg|stir[- ]fry)/i, label: 'Frozen vegetables', weight: 0.25,
    scratch: 'Use fresh vegetables, blanched or sautéed.' },

  // Processed foods (not just packaging)
  { kind: 'processed', re: /\b(hot ?dogs?|frankfurters?|bologna|salami|pepperoni|deli (meat|turkey|ham|chicken|slices)|lunch ?meat|luncheon meat|spam|vienna sausages?|imitation crab|surimi|chicken nuggets|fish (sticks|fingers)|corned beef hash)\b/i, label: 'Processed meat', weight: 1,
    scratch: 'Use fresh meat or fish you season yourself (e.g. roast a turkey breast for slicing, make patties from ground meat).' },
  { kind: 'processed', re: /\b(bacon|ham|smoked sausages?|kielbasa|chorizo|breakfast sausage|sausage links|pancetta|prosciutto)\b/i, label: 'Cured / processed meat', weight: 0.5,
    scratch: 'Use fresh pork or chicken with smoked paprika and herbs, or season ground pork yourself for sausage.' },
  { kind: 'processed', re: /\b(margarine|vegetable shortening|shortening|crisco|vegetable spread|butter substitute|non-?dairy creamer|coffee creamer|coffee whitener)\b/i, label: 'Processed fat', weight: 0.75,
    scratch: 'Use real butter, olive oil, lard or cream.' },
  { kind: 'processed', re: /\b(high[- ]fructose corn syrup|corn syrup|artificial sweetener|splenda|aspartame|sucralose|sugar[- ]free syrup)\b/i, label: 'Processed sweetener', weight: 0.5,
    scratch: 'Use sugar, honey or maple syrup.' },
  { kind: 'processed', re: /\b(oreos?|ritz|nilla wafers?|vanilla wafers|graham crackers?|potato chips|tortilla chips|doritos|fritos|cheetos|corn ?flakes|rice krispies|cereal|pretzels|marshmallows?|marshmallow fluff|candy|m&ms?|snickers|twix|butterfingers?|cool ranch)\b/i, label: 'Store-bought snack', weight: 0.75,
    scratch: 'Make a simple homemade stand-in (crushed homemade shortbread or oat crumble, toasted oats, baked tortilla strips).' },
  { kind: 'processed', re: /\b(top ramen|ramen (noodle )?(packets?|packages?)|cup noodles|frozen (lasagna|pizza|dinners?|entrees?|burritos)|tv dinners?|lunchables)\b/i, label: 'Ready meal', weight: 2,
    scratch: 'Cook the dish from its basic ingredients — noodles, sauce, vegetables and protein.' },
  { kind: 'processed', re: /\b(cola|coca-cola|coke|sprite|7-?up|dr\.? pepper|ginger ale|root beer|soda pop|energy drink|kool-?aid|tang)\b/i, label: 'Soft drink', weight: 0.5,
    scratch: 'Use broth, juice, or sugar plus a splash of vinegar for the same sweet-tangy effect.' },
  { kind: 'processed', re: /\b(food colou?ring|artificial(ly)? flavou?r(ed|ing)?|imitation vanilla|liquid smoke|msg|monosodium glutamate|sprinkles)\b/i, label: 'Additive', weight: 0.25,
    scratch: 'Skip it, or use a natural alternative (real vanilla, smoked paprika, beet juice for color).' },
  { kind: 'processed', re: /\b(nutella|store[- ]bought (hummus|guacamole|tzatziki|dip|frosting|icing)|canned frosting|tub of frosting|easy cheese|spray cheese|cheese spread|string cheese|flavou?red yogurt|fruit yogurt)\b/i, label: 'Processed spread / dip', weight: 0.75,
    scratch: 'Make it fresh — buttercream, hummus, guacamole and plain yogurt with fruit take minutes.' },

  // Jarred aromatics & condiments
  { re: /\b(jarred|jar|pre[- ]?minced|bottled)\b[^,;]*\b(garlic|ginger)\b|\b(garlic|ginger) paste\b/i, label: 'Jarred garlic/ginger', weight: 0.25,
    scratch: 'Mince fresh garlic or grate fresh ginger.' },
  { re: /\b(bottled|store[- ]bought)\b[^,;]*\b(lemon|lime) juice\b/i, label: 'Bottled citrus juice', weight: 0.25,
    scratch: 'Squeeze fresh lemons or limes.' },
  { re: /\b(french[- ]fried|crispy fried|canned fried) onions\b/i, label: 'Canned fried onions', weight: 1,
    scratch: 'Thinly slice onions, toss in seasoned flour and shallow-fry or bake until crisp.' },
  { re: /\b(broth|stock)\b/i, label: 'Broth (usually store-bought)', weight: 0.25,
    scratch: 'Simmer bones or vegetable scraps with onion, carrot, celery and bay leaf 1–4 hours for stock.' },
  { re: /\b(ketchup|mayonnaise|mayo)\b/i, kind: 'processed', label: 'Condiment', weight: 0.25,
    scratch: 'Optional: whisk your own mayo (yolk, mustard, lemon, oil) or simmer ketchup from tomatoes, vinegar and sugar.' },
  // Anything else sold in a can, tin, jar or box.
  { re: /\b(cans?|tins?|jars?|box(es)?|canned|jarred|boxed)\b/i, label: 'Canned / jarred product', weight: 0.75,
    scratch: 'Look for a fresh or homemade version of this ingredient.' },
];

// Homemade ingredient -> shortcut (for people who want less work).
const SHORTCUT_RULES = [
  { re: /\bdried\b[^,;]*\b(black|kidney|pinto|cannellini|navy|great northern|white|garbanzo)?\s*(beans|chickpeas)\b/i, label: 'Dried beans',
    shortcut: 'Use canned beans, drained and rinsed (one 15-oz can ≈ ½ cup dried). Saves the overnight soak and 1–2 hours.' },
  { re: /\b(fresh|ripe|plum|roma|vine)\b[^,;]*\btomato(es)?\b(?![^,;]*\b(slice|garnish|salad)\b)/i, label: 'Fresh tomatoes',
    shortcut: 'Use canned diced or crushed tomatoes (one 28-oz can ≈ 2½ lb fresh).' },
  { re: /\b(chicken|beef|veal|turkey) (bones|carcass)\b|\bhomemade\b.*\b(stock|broth)\b/i, label: 'Homemade stock',
    shortcut: 'Use a carton of low-sodium broth or bouillon base.' },
  { re: /\b(whole )?(pumpkin|butternut squash|sugar pumpkin)\b(?![^,;]*(pur[ée]e|canned))/i, label: 'Whole pumpkin/squash',
    shortcut: 'Use canned pumpkin purée or pre-cut squash.' },
  { re: /\b\d+\s*(cloves?)\b[^,;]*\bgarlic\b|\bgarlic cloves?\b/i, label: 'Fresh garlic',
    shortcut: 'Use jarred minced garlic (½ tsp ≈ 1 clove).' },
  { re: /\b(fresh )?ginger root\b|\bpiece (of )?(fresh )?ginger\b|\bfresh ginger\b/i, label: 'Fresh ginger',
    shortcut: 'Use ginger paste from a tube or jar.' },
  { re: /\bchicken (breasts?|thighs?)\b[^,;]*\b(cooked|shredded|poached)\b|\b(cooked|shredded) chicken\b/i, label: 'Cooked chicken',
    shortcut: 'Use a store rotisserie chicken, shredded.' },
  { re: /\bpuff pastry\b|\bshortcrust\b|\b(pie|tart) (crust|pastry|dough)\b/i, label: 'Pastry',
    shortcut: 'Use store-bought refrigerated pie crust or frozen puff pastry.' },
  { re: /\bpizza dough\b|\bbread dough\b/i, label: 'Dough',
    shortcut: 'Use a ball of store-bought pizza dough.' },
  { re: /\b(lemon|lime)s?\b[^,;]*\bjuice(d)?\b|\bjuice of \d* ?(lemon|lime)s?\b/i, label: 'Fresh citrus juice',
    shortcut: 'Use bottled lemon/lime juice.' },
  { re: /\bheavy (cream|whipping cream)\b[^,;]*\bwhipped\b/i, label: 'Whipped cream',
    shortcut: 'Use whipped topping or aerosol whipped cream.' },
  { re: /\b(block of )?(cheddar|mozzarella|monterey jack|colby|parmesan|parmigiano)\b[^,;]*\b(grated|shredded)\b/i, label: 'Grated cheese',
    shortcut: 'Use pre-shredded cheese from a bag.' },
  { re: /\b(onions?|carrots?|celery|bell peppers?)\b.*\b(diced|chopped|minced)\b/i, label: 'Chopped vegetables',
    shortcut: 'Buy pre-chopped (fresh or frozen) mirepoix or veggie mixes.' },
  { re: /\b\d+[^,;]*\btomato(es)?\b[^;]*\b(chopped|diced|peeled|crushed|seeded|quartered|grated)\b/i, label: 'Fresh tomatoes',
    shortcut: 'Use canned diced or crushed tomatoes (one 14-oz can ≈ 4 medium tomatoes).' },
  { re: /\b(dried|dry)\b[^,;]*\blentils\b/i, label: 'Dried lentils',
    shortcut: 'Use canned lentils, drained and rinsed (one 15-oz can ≈ ⅔ cup dried); add near the end of cooking.' },
  { re: /\b(fresh|ears? of|cobs? of)\b[^,;]*\bcorn\b|\bcorn (on the cob|kernels cut)/i, label: 'Fresh corn',
    shortcut: 'Use canned (drained) or frozen corn kernels (one 15-oz can ≈ 2 ears).' },
  { re: /\bfresh\b[^,;]*\b(green beans|peas)\b|\bgreen beans\b[^,;]*\btrimmed\b/i, label: 'Fresh green beans / peas',
    shortcut: 'Use canned (drained) or frozen green beans or peas.' },
  { re: /\b(fresh|baby)\b[^,;]*\bspinach\b/i, label: 'Fresh spinach',
    shortcut: 'Use frozen chopped spinach, thawed and squeezed dry (10 oz frozen ≈ 1 lb fresh).' },
  { re: /\b(fresh|ripe)\b[^,;]*\b(peach(es)?|pineapple|pears?|cherries|apricots?|mandarins?)\b/i, label: 'Fresh fruit',
    shortcut: 'Use canned fruit, drained (or canned pie filling for pies and cobblers).' },
  { re: /\bfresh\b[^,;]*\b(crab|crabmeat)\b|\blump crab\b/i, label: 'Fresh crab',
    shortcut: 'Use canned lump crab meat, drained.' },
  { re: /\b(button|cremini|white|baby bella)?\s*mushrooms?\b[^;]*\b(sliced|chopped)\b/i, label: 'Fresh mushrooms',
    shortcut: 'Use canned sliced mushrooms, drained (one 4-oz can ≈ 1 cup sliced fresh).' },
  { re: /\b(roasted|roast)\b[^,;]*\b(red )?(bell )?peppers?\b/i, label: 'Roasted peppers',
    shortcut: 'Use jarred roasted red peppers, drained.' },
  { re: /\bcooked (white |brown |jasmine |basmati )?rice\b/i, label: 'Cooked rice',
    shortcut: 'Use microwave or instant rice.' },
  { re: /\bfresh\b[^,;]*\b(parsley|basil|thyme|oregano|rosemary|dill|cilantro|sage|tarragon)\b/i, label: 'Fresh herbs',
    shortcut: 'Use dried herbs — about ⅓ of the amount (1 Tbsp fresh ≈ 1 tsp dried).' },
  { re: /\b(homemade|home-made|from scratch)\b/i, label: 'Homemade component',
    shortcut: 'Use a good store-bought version.' },
];

// Things that are canned/jarred but almost nobody makes at home; don't count them.
const IGNORE = /\b(coconut milk|anchov(y|ies)|capers|olives|chipotles? in adobo|fish sauce|soy sauce|worcestershire|hot sauce|sriracha|mustard|vinegar|oil|honey|maple syrup|vanilla|baking (soda|powder)|yeast|chocolate chips|cocoa)\b/i;

// How processed the cook is happy for a recipe to be (ids kept stable for saved settings).
export const LEVELS = [
  { id: 'shortcut', label: 'Convenience OK', min: 0, desc: 'Canned, boxed, frozen and processed products are fine — fast and easy.' },
  { id: 'balanced', label: 'Lightly processed', min: 55, desc: 'Some canned or packaged staples are fine, but mostly real ingredients.' },
  { id: 'mostly', label: 'Mostly whole foods', min: 75, desc: 'Minimal processed food; only basic pantry staples from a can or jar.' },
  { id: 'scratch', label: 'From scratch', min: 90, desc: 'Whole, unprocessed ingredients — make everything you reasonably can.' },
];

const TARGET = { shortcut: 40, balanced: 70, mostly: 85, scratch: 100 };

export function classifyIngredient(text) {
  const s = String(text || '');
  if (!s.trim()) return null;
  const saysHomemade = /\b(homemade|home-made|from scratch)\b/i.test(s);
  for (const rule of saysHomemade ? [] : CONVENIENCE_RULES) {
    if (rule.re.test(s)) {
      const kind = rule.kind || 'packaged';
      if (kind === 'packaged' && IGNORE.test(s) && rule.weight <= 0.75 && !/\b(sauce|soup|mix)\b/i.test(s)) return null;
      return { type: 'convenience', kind, label: rule.label, weight: rule.weight, tip: rule.scratch };
    }
  }
  for (const rule of SHORTCUT_RULES) {
    if (rule.re.test(s)) return { type: 'homemade', label: rule.label, tip: rule.shortcut };
  }
  return null;
}

export function analyzeRecipe(ingredients = []) {
  const items = ingredients.map((text) => ({ text, flag: classifyIngredient(text) }));
  const count = Math.max(items.length, 1);
  const load = items.reduce((sum, i) => sum + (i.flag?.type === 'convenience' ? i.flag.weight : 0), 0);
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - load / count))));
  const convenienceCount = items.filter((i) => i.flag?.type === 'convenience').length;
  const processedCount = items.filter((i) => i.flag?.kind === 'processed').length;
  return { score, level: levelFor(score), convenienceCount, processedCount, items };
}

export function levelFor(score) {
  if (score >= 90) return 'From scratch';
  if (score >= 75) return 'Mostly whole foods';
  if (score >= 55) return 'Lightly processed';
  return 'Highly processed';
}

// Lower is a better match for the preference.
export function preferenceDistance(score, pref) {
  const target = TARGET[pref] ?? TARGET.balanced;
  if (pref === 'shortcut') return Math.max(0, score - target) * 0.5; // anything easy is fine
  return Math.abs(score - target);
}

export function matchesPreference(score, pref) {
  const level = LEVELS.find((l) => l.id === pref);
  return !level || score >= level.min;
}

// Rewrite an ingredient list toward the chosen preference using the rule tables.
// pref is a level id, or a direction: 'scratch' (everything homemade) or 'shortcut' (canned / store-bought).
export function adaptIngredients(ingredients = [], pref = 'balanced') {
  const changes = [];
  const toScratch = pref === 'scratch' || pref === 'mostly';
  const toShortcut = pref === 'shortcut' || pref === 'canned';
  const adapted = ingredients.map((text) => {
    const flag = classifyIngredient(text);
    if (!flag) return text;
    const minorWeight = pref === 'mostly' ? 1 : 0; // "mostly" keeps minor conveniences
    if (toScratch && flag.type === 'convenience' && flag.weight > minorWeight - 0.01) {
      changes.push({ from: text, to: flag.tip, label: flag.label, direction: 'scratch' });
      return `${text}  →  make it yourself: ${flag.tip}`;
    }
    if (toShortcut && flag.type === 'homemade') {
      changes.push({ from: text, to: flag.tip, label: flag.label, direction: 'shortcut' });
      return `${text}  →  store-bought: ${flag.tip}`;
    }
    return text;
  });
  return { ingredients: adapted, changes };
}
