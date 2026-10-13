import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleLine, ruleBasedAlterations } from '../lib/tweaks.js';

test('scales quantities and keeps counted items whole', () => {
  assert.equal(scaleLine('1 1/2 tsp salt', 0.7), '1 tsp salt');
  assert.equal(scaleLine('4 cloves garlic', 1.3), '5 cloves garlic');
  assert.equal(scaleLine('½ cup sugar', 0.75), '⅓ cup sugar');
  assert.equal(scaleLine('salt to taste', 0.5), null);
});

test('builds alterations from feedback tags', () => {
  const recipe = { title: 'Chili', ingredients: ['2 tsp chili powder', '1 tsp salt', '2 cans kidney beans'], steps: ['Cook.'] };
  const alts = ruleBasedAlterations({ recipe, feedback: [{ rating: 3, tags: ['Too spicy'] }], pref: 'scratch' });
  assert.ok(alts.length >= 2);
  assert.ok(alts[0].ingredients.includes('1 tsp chili powder'));
  assert.ok(alts.some((a) => a.title === 'More homemade'));
});
