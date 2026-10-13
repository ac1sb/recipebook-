import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipeHtml, isoMinutes } from '../lib/sources/webpage.js';

const html = `<html><head>
<meta property="og:site_name" content="Test Kitchen">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},
{"@type":"Recipe","name":"Mac &amp; Cheese","image":[{"url":"/small.jpg","width":100},{"url":"/big.jpg","width":1200}],
"recipeIngredient":["8 oz elbow macaroni","2 cups shredded cheddar"],
"recipeInstructions":[{"@type":"HowToSection","name":"Pasta","itemListElement":[{"@type":"HowToStep","text":"Boil the pasta."}]},{"@type":"HowToStep","text":"Stir in cheese."}],
"totalTime":"PT1H5M","recipeYield":["4","4 servings"]}]}</script></head></html>`;

test('parses schema.org Recipe JSON-LD', () => {
  const r = parseRecipeHtml(html, 'https://example.com/mac');
  assert.equal(r.title, 'Mac & Cheese');
  assert.equal(r.sourceName, 'Test Kitchen');
  assert.equal(r.image, 'https://example.com/big.jpg');
  assert.deepEqual(r.ingredients, ['8 oz elbow macaroni', '2 cups shredded cheddar']);
  assert.deepEqual(r.steps, ['— Pasta —', 'Boil the pasta.', 'Stir in cheese.']);
  assert.equal(r.totalTime, 65);
  assert.equal(r.servings, '4');
});

test('returns null when a page has no recipe', () => {
  assert.equal(parseRecipeHtml('<html><body>hi</body></html>', 'https://example.com'), null);
});

test('parses ISO 8601 durations', () => {
  assert.equal(isoMinutes('PT45M'), 45);
  assert.equal(isoMinutes('PT2H'), 120);
  assert.equal(isoMinutes(null), null);
});
