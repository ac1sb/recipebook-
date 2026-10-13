import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, relevance, filterRelevant } from '../lib/relevance.js';

const r = (title, ingredients = [], extra = {}) => ({ title, ingredients, steps: [], tags: [], description: '', ...extra });

test('splits a search into ingredient and dish words', () => {
  const terms = parseQuery('Easy chicken noodle soup');
  assert.deepEqual(terms.map((t) => [t.key, t.kind]), [['chicken', 'ingredient'], ['noodle', 'ingredient'], ['soup', 'dish']]);
  assert.deepEqual(parseQuery('beef stir fry').map((t) => t.key), ['beef', 'stir fry']);
});

test('needs every word to match somewhere sensible', () => {
  const terms = parseQuery('chicken noodle soup');
  assert.ok(relevance(r('Grandma’s Chicken Noodle Soup', ['1 lb chicken', '8 oz egg noodles']), terms).full);
  assert.ok(relevance(r('Rosół', ['1 whole chicken', 'thin egg noodles'], { steps: ['Ladle the soup over the noodles.'] }), terms).full);
  assert.deepEqual(relevance(r('Salmon noodle soup', ['2 salmon fillets', 'rice noodles', '4 cups chicken stock']), terms).missing, ['chicken']);
  assert.deepEqual(relevance(r('Chicken Casserole', ['chicken', 'egg noodles', '1 can cream of chicken soup']), terms).missing, ['soup']);
});

test('understands synonyms', () => {
  assert.ok(relevance(r('Garlic Prawn Tacos', ['prawns', 'tortillas']), parseQuery('shrimp tacos')).full);
  assert.ok(relevance(r('Vegetable Lasagne', ['zucchini', 'lasagne sheets']), parseQuery('vegetable lasagna')).full);
});

test('keeps full matches first and drops unrelated recipes', () => {
  const recipes = [
    r('Pad Thai', ['rice noodles', 'shrimp']),
    r('Thai chicken soup', ['chicken', 'coconut milk']),
    r('Chicken noodle soup', ['chicken', 'egg noodles']),
    r('Chocolate cake', ['chocolate', 'flour']),
  ];
  const { kept, dropped } = filterRelevant(recipes, 'chicken noodle soup');
  assert.equal(kept[0].title, 'Chicken noodle soup');
  assert.ok(kept.some((k) => k.title === 'Thai chicken soup' && !k.relevance.full));
  assert.ok(!kept.some((k) => k.title === 'Chocolate cake'));
  assert.equal(dropped, 2);
});
