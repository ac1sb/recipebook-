import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimes, estimateTimes, matchesTime } from '../lib/time.js';

test('uses source prep and cook times when present', () => {
  const r = withTimes({ ingredients: ['a'], steps: [], prepTime: 10, cookTime: 25 });
  assert.deepEqual([r.prepTime, r.cookTime, r.totalTime, r.timeEstimated], [10, 25, 35, false]);
});

test('estimates cook time from the method, excluding passive time', () => {
  const t = estimateTimes({ ingredients: [], steps: ['Marinate for 2 hours.', 'Bake for 1 1/2 hours.', 'Simmer ½ hour'] });
  assert.equal(t.cook, 120);
  assert.equal(t.inactive, 120);
});

test('splits a known total into prep and cook', () => {
  const r = withTimes({ ingredients: ['a', 'b'], steps: [], totalTime: 45 });
  assert.equal(r.prepTime + r.cookTime, 45);
  assert.ok(r.timeEstimated);
});

test('trusts "15-minute" in the title over a rough estimate', () => {
  const r = withTimes({ title: '15-minute chicken burgers', ingredients: Array(12).fill('x'), steps: ['Grill 8 minutes.'] });
  assert.equal(r.prepTime + r.cookTime, 15);
});

test('filters by prep and cook time', () => {
  const r = { prepTime: 15, cookTime: 40, totalTime: 55 };
  assert.ok(matchesTime(r, { maxPrep: 20 }));
  assert.ok(!matchesTime(r, { maxCook: 30 }));
  assert.ok(matchesTime(r, {}));
});
