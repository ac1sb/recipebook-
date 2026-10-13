import { test } from 'node:test';
import assert from 'node:assert/strict';
import { substitutesFor, ruleSubstitutes } from '../lib/substitutes.js';
import { adaptIngredients } from '../lib/homemade.js';

test('finds substitutes for common ingredients', () => {
  assert.match(substitutesFor('1 cup buttermilk')[0], /lemon juice|vinegar/);
  assert.match(substitutesFor('1 can coconut milk')[0], /cream/i);
  assert.match(substitutesFor('2 Tbsp peanut butter')[0], /almond/i);
  assert.match(substitutesFor('8 oz egg noodles')[0], /pasta/i);
  assert.match(substitutesFor('1 tsp black pepper')[0], /white pepper/i);
  assert.match(substitutesFor('1 cup chicken broth')[0], /bouillon/i);
});

test('falls back to leaving it out', () => {
  const [r] = ruleSubstitutes(['1 tsp grains of paradise']);
  assert.equal(r.options[0].text, 'Leave it out');
});

test('swaps homemade ingredients for canned and store-bought ones', () => {
  const { changes } = adaptIngredients(['1 lb dried black beans', '4 tomatoes, peeled and chopped', '2 ears of fresh corn', '1 tsp salt'], 'shortcut');
  assert.deepEqual(changes.map((c) => c.label), ['Dried beans', 'Fresh tomatoes', 'Fresh corn']);
});
