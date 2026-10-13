import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIngredient, analyzeRecipe, adaptIngredients } from '../lib/homemade.js';

test('flags canned, boxed and jarred products', () => {
  for (const line of [
    '2 cans (10-3/4 ounces each) condensed cream of mushroom soup',
    '1 box yellow cake mix',
    '2 cans black beans, drained and rinsed',
    '1 jar marinara sauce',
    '1 can (6 ounces) french-fried onions',
    '1 packet taco seasoning',
    '1 refrigerated pie crust',
  ]) {
    assert.equal(classifyIngredient(line)?.type, 'convenience', line);
  }
});

test('does not flag staples nobody makes at home', () => {
  assert.equal(classifyIngredient('1 can coconut milk'), null);
  assert.equal(classifyIngredient('2 Tbsp olive oil'), null);
  assert.equal(classifyIngredient('1 (8 oz) package cream cheese'), null);
});

test('recognizes homemade components that have a shortcut', () => {
  assert.equal(classifyIngredient('1 lb dried pinto beans')?.type, 'homemade');
  assert.equal(classifyIngredient('3 cloves garlic, minced')?.type, 'homemade');
  assert.equal(classifyIngredient('4 cups homemade chicken stock')?.type, 'homemade');
});

test('scores recipes from shortcut-heavy to from-scratch', () => {
  const casserole = analyzeRecipe(['1 box cake mix', '1 can cherry pie filling', '1 cup butter']);
  const scratch = analyzeRecipe(['2 cups flour', '1 cup butter', '3 eggs', '1 lb fresh cherries']);
  assert.ok(casserole.score < 40, `casserole scored ${casserole.score}`);
  assert.equal(scratch.score, 100);
  assert.equal(scratch.level, 'From scratch');
});

test('flags processed foods, not just packaging', () => {
  for (const line of ['8 hot dogs, sliced', '1/2 cup margarine', '1 cup crushed Ritz crackers', '6 slices Velveeta']) {
    assert.equal(classifyIngredient(line)?.kind, 'processed', line);
  }
  assert.equal(classifyIngredient('1 can black beans')?.kind, 'packaged');
  assert.equal(analyzeRecipe(['4 hot dogs', '1 onion']).processedCount, 1);
});

test('adapts ingredients toward the preference', () => {
  const scratch = adaptIngredients(['2 cans black beans, drained', '1 onion'], 'scratch');
  assert.equal(scratch.changes.length, 1);
  assert.match(scratch.ingredients[0], /make it yourself/);

  const shortcut = adaptIngredients(['1 lb dried black beans', '1 onion'], 'shortcut');
  assert.equal(shortcut.changes.length, 1);
  assert.match(shortcut.ingredients[0], /shortcut/);
});
