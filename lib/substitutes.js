// Common kitchen substitutions for when an ingredient is missing.
// Order matters: more specific entries come first.

const TABLE = [
  // Specific names that would otherwise match a more general entry below
  { re: /\b(black|white|ground) pepper\b|\bpeppercorns?\b|\bsalt and pepper\b/i, options: ['White pepper', 'A pinch of cayenne or red pepper flakes', 'Leave it out and season at the table'] },
  { re: /\b(kosher |sea |table )?salt\b/i, options: ['Table salt — use about half as much as kosher salt', 'Soy sauce, fish sauce or miso (savory dishes; add gradually)', 'Seasoned salt (reduce other spices)'] },
  { re: /\bpeanut butter\b/i, options: ['Almond butter or cashew butter', 'Sunflower seed butter (nut-free)', 'Tahini'] },
  { re: /\bcoconut milk\b/i, options: ['Heavy cream or half-and-half', 'Evaporated milk', 'Plain yogurt (stir in off the heat)'] },
  { re: /\bsesame oil\b/i, options: ['Neutral oil + a few toasted sesame seeds', 'Peanut oil'] },
  { re: /\begg noodles\b/i, options: ['Any short pasta (fusilli, rotini, small shells)', 'Rice noodles', 'Broken spaghetti or fettuccine'] },
  // Dairy
  { re: /\bbuttermilk\b/i, options: ['Milk + 1 Tbsp lemon juice or white vinegar per cup; let sit 5 minutes', 'Plain yogurt thinned with a little milk (¾ cup yogurt + ¼ cup milk per cup)', 'Sour cream thinned with milk'] },
  { re: /\bheavy (whipping )?cream\b|\bwhipping cream\b|\bdouble cream\b/i, options: ['For cooking: ¾ cup whole milk + ¼ cup melted butter per cup (won\'t whip)', 'Half-and-half (sauces will be a little thinner)', 'Full-fat coconut milk or cream (dairy-free)', 'Evaporated milk'] },
  { re: /\bhalf[- ]and[- ]half\b/i, options: ['½ cup whole milk + ½ cup heavy cream per cup', '1 cup whole milk + 1 Tbsp melted butter'] },
  { re: /\bsour cream\b/i, options: ['Plain Greek yogurt (same amount)', 'Crème fraîche', 'Blended cottage cheese with a squeeze of lemon'] },
  { re: /\b(greek |plain )?yogh?urt\b/i, options: ['Sour cream (same amount)', 'Buttermilk (for baking/marinades)', 'Crème fraîche'] },
  { re: /\bcream cheese\b/i, options: ['Mascarpone', 'Ricotta blended until smooth', 'Strained Greek yogurt (for dips and spreads)'] },
  { re: /\bevaporated milk\b/i, options: ['Simmer 2¼ cups milk down to 1 cup', 'Half-and-half (same amount)'] },
  { re: /\bsweetened condensed milk\b/i, options: ['Simmer 2 cups milk with ⅔ cup sugar until reduced to about 1¼ cups', 'Evaporated milk + sugar to taste'] },
  { re: /\b(whole |skim |2% |low[- ]fat )?milk\b/i, options: ['Half water, half evaporated milk', 'Unsweetened oat, soy or almond milk (same amount)', 'Water + 1 Tbsp butter per cup (for savory dishes)'] },
  { re: /\b(unsalted |salted )?butter\b/i, options: ['Olive oil — use ¾ the amount (savory cooking)', 'Vegetable oil or melted coconut oil — ¾ the amount (baking: slightly denser)', 'Margarine or vegan butter (same amount)'] },
  { re: /\bparmesan|parmigiano|pecorino\b/i, options: ['Pecorino Romano or Grana Padano', 'Aged Asiago', 'Nutritional yeast (dairy-free, about half as much)'] },
  { re: /\bmozzarella\b/i, options: ['Provolone', 'Monterey Jack', 'Fontina'] },
  { re: /\bcheddar\b/i, options: ['Colby or Monterey Jack', 'Gouda or Gruyère', 'Any good melting cheese'] },
  { re: /\bricotta\b/i, options: ['Cottage cheese, blended smooth', 'Mascarpone (richer)', 'Soft goat cheese'] },
  { re: /\bfeta\b/i, options: ['Goat cheese', 'Cotija', 'Ricotta salata'] },

  // Eggs, baking
  { re: /\beggs?\b/i, options: ['Per egg: 1 Tbsp ground flaxseed + 3 Tbsp water, rested 5 minutes (baking)', 'Per egg: ¼ cup unsweetened applesauce or mashed banana (sweet baking)', 'Per egg: 3 Tbsp aquafaba (liquid from canned chickpeas)'] },
  { re: /\bself[- ]rising flour\b/i, options: ['Per cup: 1 cup all-purpose flour + 1½ tsp baking powder + ¼ tsp salt'] },
  { re: /\bcake flour\b/i, options: ['Per cup: 1 cup all-purpose flour, remove 2 Tbsp, add 2 Tbsp cornstarch, sift'] },
  { re: /\bbread flour\b/i, options: ['All-purpose flour (same amount; slightly less chewy)'] },
  { re: /\b(all[- ]purpose |plain )?flour\b/i, options: ['For thickening: half as much cornstarch', 'Whole wheat flour (use ¾–⅞ the amount)', 'A 1:1 gluten-free flour blend'] },
  { re: /\bcornstarch|cornflour\b/i, options: ['All-purpose flour — twice the amount', 'Arrowroot or potato starch (same amount)', 'Tapioca starch — about twice the amount'] },
  { re: /\bbaking powder\b/i, options: ['Per tsp: ¼ tsp baking soda + ½ tsp cream of tartar', 'Per tsp: ¼ tsp baking soda + ½ cup buttermilk/yogurt (reduce other liquid)'] },
  { re: /\bbaking soda\b/i, options: ['Baking powder — about 3× the amount (and cut salt slightly)'] },
  { re: /\bbrown sugar\b/i, options: ['Per cup: 1 cup white sugar + 1 Tbsp molasses', 'White sugar (same amount; less caramel flavor)', 'Coconut sugar'] },
  { re: /\bpowdered sugar|confectioners'? sugar|icing sugar\b/i, options: ['Blend 1 cup granulated sugar + 1 Tbsp cornstarch until fine'] },
  { re: /\b(granulated |white )?sugar\b/i, options: ['Honey — ¾ the amount, reduce liquid by 3 Tbsp per cup', 'Maple syrup — ¾ the amount, reduce liquid slightly', 'Brown sugar or coconut sugar (same amount)'] },
  { re: /\bhoney\b/i, options: ['Maple syrup (same amount)', 'Agave syrup', 'Light corn syrup or golden syrup'] },
  { re: /\bmaple syrup\b/i, options: ['Honey (same amount)', 'Brown sugar dissolved in a little water', 'Agave syrup'] },
  { re: /\bmolasses\b/i, options: ['Dark brown sugar + a little water', 'Maple syrup or honey', 'Dark corn syrup'] },
  { re: /\bvanilla( extract)?\b/i, options: ['Maple syrup (same amount)', 'Almond extract — use half', 'Bourbon or dark rum (same amount)'] },
  { re: /\b(semi-?sweet |bittersweet )?chocolate\b/i, options: ['Per oz: 3 Tbsp cocoa powder + 1 Tbsp butter or oil (+1 Tbsp sugar for semi-sweet)'] },

  // Acids, liquids, sauces
  { re: /\blemon juice\b|\blemons?\b/i, options: ['Lime juice (same amount)', 'White wine vinegar or apple cider vinegar — half the amount', 'A pinch of citric acid dissolved in water'] },
  { re: /\blime juice\b|\blimes?\b/i, options: ['Lemon juice (same amount)', 'Rice vinegar — half the amount'] },
  { re: /\b(white |red )?wine vinegar\b|\bapple cider vinegar\b|\bsherry vinegar\b/i, options: ['Any other mild vinegar (same amount)', 'Lemon juice (same amount)'] },
  { re: /\brice (wine )?vinegar\b/i, options: ['Apple cider vinegar with a pinch of sugar', 'White wine vinegar'] },
  { re: /\bwhite wine\b/i, options: ['Chicken or vegetable broth + a splash of white wine vinegar or lemon juice', 'Dry vermouth', 'White grape juice + a splash of vinegar'] },
  { re: /\bred wine\b/i, options: ['Beef broth + 1 Tbsp red wine vinegar per cup', 'Unsweetened grape or pomegranate juice + a splash of vinegar'] },
  { re: /\b(chicken|vegetable|beef) (stock|broth)\b|\bstock\b|\bbroth\b/i, options: ['Water + bouillon cube or paste (1 cube per cup)', 'Another broth (chicken ↔ vegetable)', 'Water + 1 tsp soy sauce and a bay leaf per cup'] },
  { re: /\bsoy sauce|tamari\b/i, options: ['Tamari or coconut aminos (same amount)', 'Worcestershire sauce + a little water (half the amount)', 'Fish sauce — half the amount'] },
  { re: /\bfish sauce\b/i, options: ['Soy sauce + a squeeze of lime', 'Worcestershire sauce', 'Mashed anchovies (1 fillet per tsp)'] },
  { re: /\bworcestershire\b/i, options: ['Soy sauce + a dash of vinegar and sugar', 'Fish sauce — half the amount'] },
  { re: /\bmayo(nnaise)?\b/i, options: ['Plain Greek yogurt', 'Sour cream', 'Mashed avocado (dips and sandwiches)'] },
  { re: /\bdijon( mustard)?\b|\bmustard\b/i, options: ['Spicy brown or yellow mustard', 'Per Tbsp prepared: 1 tsp dry mustard + 2 tsp water/vinegar'] },
  { re: /\bketchup\b/i, options: ['Tomato paste + a little vinegar and sugar'] },
  { re: /\btomato paste\b/i, options: ['3 Tbsp tomato sauce or passata per Tbsp, cooked down a bit', 'Ketchup (sweeter; same amount)'] },
  { re: /\btomato sauce|passata\b/i, options: ['Tomato paste thinned with water (1:1)', 'Canned crushed tomatoes, blended'] },
  { re: /\b(canned |diced |crushed )?tomato(es)?\b/i, options: ['Canned diced or crushed tomatoes (one 14-oz can ≈ 4 medium tomatoes)', 'Fresh tomatoes, chopped', 'Tomato sauce or passata'] },
  { re: /\bcream of (mushroom|chicken|celery) soup\b/i, options: ['Per can: 3 Tbsp butter + 3 Tbsp flour cooked 1 minute, whisk in 1¼ cups milk or broth until thick'] },

  // Aromatics, produce, herbs, spices
  { re: /\bshallots?\b/i, options: ['Red or yellow onion — about the same volume, plus a little garlic', 'White parts of green onions'] },
  { re: /\b(green onions?|scallions?|spring onions?)\b/i, options: ['Chives', 'Finely chopped shallot or red onion (less amount)', 'Leek greens, thinly sliced'] },
  { re: /\bleeks?\b/i, options: ['Yellow onion + a few green onions', 'Shallots'] },
  { re: /\b(yellow |white |red |sweet )?onions?\b/i, options: ['Shallots (about 3 per onion)', 'Leeks (white and light-green parts)', '1 Tbsp onion powder per medium onion'] },
  { re: /\bgarlic\b/i, options: ['⅛ tsp garlic powder per clove', '½ tsp jarred minced garlic per clove', 'A shallot (milder)'] },
  { re: /\bginger\b/i, options: ['¼ tsp ground ginger per Tbsp fresh', 'Ginger paste from a tube (same amount)', 'Galangal'] },
  { re: /\bcelery\b/i, options: ['Fennel', 'Bok choy stems', 'A pinch of celery seed'] },
  { re: /\bcarrots?\b/i, options: ['Parsnips', 'Sweet potato or butternut squash, diced'] },
  { re: /\b(bell )?peppers?\b(?!.*\b(black|white|ground|cayenne|flakes)\b)/i, options: ['Poblano or Anaheim pepper', 'Roasted red peppers from a jar', 'Zucchini or celery for crunch'] },
  { re: /\bspinach\b/i, options: ['Kale (stems removed; cook a little longer)', 'Swiss chard', 'Frozen spinach, thawed and squeezed'] },
  { re: /\bzucchini|courgettes?\b/i, options: ['Yellow squash', 'Eggplant', 'Cucumber (raw dishes only)'] },
  { re: /\bpotato(es)?\b/i, options: ['Sweet potatoes', 'Cauliflower (for mash and soups)', 'Turnips or parsnips'] },
  { re: /\bmushrooms?\b/i, options: ['Canned mushrooms, drained', 'Eggplant or zucchini, diced', 'Dried porcini, rehydrated (use less — strong flavor)'] },
  { re: /\bcilantro|coriander leaves\b/i, options: ['Flat-leaf parsley + a squeeze of lime', 'Basil or mint (Asian dishes)'] },
  { re: /\b(fresh )?parsley\b/i, options: ['Cilantro', 'Chervil', '1 tsp dried parsley per Tbsp fresh'] },
  { re: /\b(fresh )?basil\b/i, options: ['1 tsp dried basil per Tbsp fresh', 'Fresh oregano or spinach + a little mint', 'Pesto (reduce salt and oil)'] },
  { re: /\b(fresh )?(thyme|rosemary|oregano|sage|dill|tarragon|marjoram)\b/i, options: ['The dried version — ⅓ of the amount', 'Italian seasoning or herbes de Provence — ⅓ of the amount'] },
  { re: /\bbay lea(f|ves)\b/i, options: ['A pinch of dried thyme', 'Leave it out — it\'s subtle'] },
  { re: /\bsmoked paprika\b/i, options: ['Sweet paprika + a pinch of cumin or chipotle powder'] },
  { re: /\bpaprika\b/i, options: ['Chili powder (spicier) or a pinch of cayenne', 'Smoked paprika'] },
  { re: /\bcumin\b/i, options: ['Ground coriander + a pinch of chili powder', 'Chili powder (contains cumin)', 'Caraway seed'] },
  { re: /\bchili powder\b/i, options: ['Per Tbsp: 1 tsp paprika + 1 tsp cumin + ½ tsp oregano + ¼ tsp cayenne + ¼ tsp garlic powder'] },
  { re: /\bcayenne\b|\bred pepper flakes\b|\bcrushed red pepper\b/i, options: ['Hot sauce (a few dashes)', 'Chili powder (milder)', 'A fresh or dried chile'] },
  { re: /\bitalian seasoning\b/i, options: ['Equal parts dried oregano, basil and thyme (+ a little rosemary)'] },
  { re: /\bcinnamon\b/i, options: ['Pumpkin pie spice or allspice (use less)', 'Nutmeg — about ¼ of the amount'] },
  { re: /\bnutmeg\b/i, options: ['Mace', 'Pumpkin pie spice or a pinch of allspice'] },
  { re: /\ballspice\b/i, options: ['Equal parts cinnamon, nutmeg and cloves'] },
  { re: /\bpumpkin pie spice\b/i, options: ['Per tsp: ½ tsp cinnamon + ¼ tsp ginger + ⅛ tsp nutmeg + ⅛ tsp cloves'] },

  // Proteins, starches, pantry
  { re: /\bchicken breasts?\b/i, options: ['Boneless chicken thighs (juicier; cook a few minutes longer)', 'Turkey cutlets', 'Shredded rotisserie chicken (add near the end)'] },
  { re: /\bchicken thighs?\b/i, options: ['Chicken breasts (cook a little less so they don\'t dry out)', 'Turkey thighs'] },
  { re: /\b(whole )?chicken\b/i, options: ['Bone-in chicken pieces (thighs and drumsticks)', 'Shredded rotisserie chicken (add near the end)', 'Turkey'] },
  { re: /\bground (beef|chuck)\b|\bminced beef\b/i, options: ['Ground turkey or chicken (add a little oil)', 'Ground pork', 'Cooked lentils or crumbled mushrooms (vegetarian)'] },
  { re: /\bground (pork|turkey|chicken|lamb)\b/i, options: ['Another ground meat (beef, pork, turkey or chicken)', 'Sausage meat removed from casings (reduce salt and spices)'] },
  { re: /\bbacon\b/i, options: ['Pancetta or prosciutto', 'Smoked ham', 'Smoked paprika + a little oil (vegetarian)'] },
  { re: /\bshrimp|prawns?\b/i, options: ['Scallops', 'Firm white fish, cubed', 'Chicken, thinly sliced'] },
  { re: /\btofu\b/i, options: ['Tempeh', 'Paneer', 'Chickpeas'] },
  { re: /\b(spaghetti|linguine|fettuccine|penne|rigatoni|fusilli|rotini|macaroni|pasta|noodles)\b/i, options: ['Any pasta of a similar size and shape', 'Rice noodles or egg noodles', 'Zucchini noodles (low-carb)'] },
  { re: /\b(long[- ]grain |white |jasmine |basmati )?rice\b/i, options: ['Another rice (adjust cooking time and water)', 'Quinoa', 'Orzo or couscous'] },
  { re: /\bpanko\b/i, options: ['Regular breadcrumbs', 'Crushed crackers or cornflakes', 'Rolled oats, pulsed'] },
  { re: /\bbread ?crumbs\b/i, options: ['Panko', 'Crushed crackers', 'Rolled oats or ground almonds'] },
  { re: /\b(black|kidney|pinto|cannellini|navy|white|great northern) beans\b|\bchickpeas\b/i, options: ['Any other canned bean, drained and rinsed', 'Lentils'] },
  { re: /\b(olive|vegetable|canola|sunflower|avocado) oil\b|\boil\b/i, options: ['Any neutral oil for cooking', 'Melted butter (lower heat)', 'Applesauce for half the oil (baking)'] },
  { re: /\btortillas?\b/i, options: ['Pita or naan', 'Lettuce wraps', 'Corn ↔ flour tortillas'] },
  { re: /\byeast\b/i, options: ['Instant ↔ active dry: use the same amount (activate active dry in warm water)', 'For quick breads only: 1 tsp baking powder per cup of flour'] },
  { re: /\bpie crust\b/i, options: ['Store-bought refrigerated pie crust', 'Crushed graham cracker or cookie crust (sweet pies)', 'Puff pastry'] },
];

export function substitutesFor(ingredient) {
  const entry = TABLE.find((e) => e.re.test(ingredient));
  return entry ? entry.options : [];
}

// missing: ingredient lines. Returns [{ ingredient, options: [{ text, note }] }].
export function ruleSubstitutes(missing = []) {
  return missing.map((ingredient) => {
    const opts = substitutesFor(ingredient);
    return {
      ingredient,
      options: opts.length
        ? opts.map((text) => ({ text, note: '' }))
        : [{ text: 'Leave it out', note: 'No common substitute known — taste and adjust seasoning.' }],
    };
  });
}
