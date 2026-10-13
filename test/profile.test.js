import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfile, fit, dishQuery } from '../lib/profile.js';

const curry = { title: 'Chicken Curry', ingredients: ['1 lb chicken', '2 green chilies', '1 tsp cayenne', '1 tsp red pepper flakes'], steps: [], totalTime: 80 };
const mild = { title: 'Mild Chicken Korma', ingredients: ['1 lb chicken', '1 cup yogurt', '1 tsp cumin'], steps: [], totalTime: 40 };
const entry = (recipe, feedback) => ({ recipe, versions: [], feedback });

test('learns preferences from feedback tags', () => {
  const p = buildProfile([entry(curry, [{ date: '2026-01-01', rating: 2, tags: ['Too spicy', 'Took too long'] }])]);
  assert.ok(p.prefs.spicy < 0);
  assert.ok(p.prefs.quick > 0);
  assert.deepEqual(p.summary, ['milder food', 'quicker recipes']);
  // The low rating is explained by the notes, so chicken itself isn't disliked.
  assert.deepEqual(p.topDislikes, []);
});

test('ranks a milder, quicker version above the original', () => {
  const p = buildProfile([entry(curry, [{ date: '2026-01-01', rating: 2, tags: ['Too spicy', 'Took too long'] }])]);
  const f = fit(mild, p, curry);
  assert.ok(f.score > 0);
  assert.ok(f.reasons.includes('milder than yours'));
  assert.ok(f.reasons.some((r) => r.includes('min quicker')));
  assert.ok(fit(curry, p).warnings.includes('spicier'));
});

test('remembers ingredients from highly rated recipes', () => {
  const p = buildProfile([entry({ title: 'Mushroom Risotto', ingredients: ['1 cup rice', '8 oz mushrooms'], steps: [] }, [{ date: '2026-01-02', rating: 5 }])]);
  assert.ok(p.topLikes.includes('mushroom'));
  assert.ok(fit({ title: 'Mushroom pasta', ingredients: ['mushrooms', 'pasta'] }, p).reasons.some((r) => r.includes('mushroom')));
});

test('turns titles into dish searches', () => {
  assert.equal(dishQuery('The Best Easy Chicken Pot Pie (Family Favorite)'), 'chicken pot pie');
});
