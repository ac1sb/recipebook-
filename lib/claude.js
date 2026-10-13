// Claude-powered features: finding recipes across the web, and proposing
// alterations based on the cook's feedback. Both are optional; the app
// falls back to rule-based behavior when no API key is configured.
import Anthropic from '@anthropic-ai/sdk';
import { fromUrl } from './sources/webpage.js';
import { LEVELS } from './homemade.js';

const MODEL = 'claude-opus-5-5';
let client;

export function claudeEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getClient() {
  client ??= new Anthropic();
  return client;
}

// Shared request options: server-side fallback if the model declines a request.
const base = {
  model: MODEL,
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
};

function assertNotRefused(response) {
  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('Claude declined this request.'), { status: 422 });
  }
}

// ---------- Web-wide recipe search ----------

const SKIP_HOSTS = /(pinterest|youtube|facebook|instagram|tiktok|reddit|amazon|wikipedia|quora)\./i;

export async function searchWeb(query, { pref = 'balanced', limit = 10 } = {}) {
  const level = LEVELS.find((l) => l.id === pref) || LEVELS[1];
  const response = await getClient().beta.messages.create({
    ...base,
    max_tokens: 4000,
    output_config: { effort: 'low' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    messages: [{
      role: 'user',
      content:
        `Search the web for individual recipe pages for: "${query}".\n` +
        `The cook's preference is "${level.label}": ${level.desc}\n` +
        'Find pages from a variety of different recipe websites, food blogs and magazines. ' +
        'Prefer single-recipe pages over roundups or listicles. Then list the best page URLs, one per line.',
    }],
  });
  assertNotRefused(response);

  // Collect URLs from the search results themselves and from any links in Claude's answer.
  const urls = [];
  for (const block of response.content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === 'web_search_result' && r.url) urls.push(r.url);
    } else if (block.type === 'text') {
      for (const m of block.text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) urls.push(m[0]);
    }
  }

  const perHost = new Map();
  const candidates = [...new Set(urls)].filter((u) => {
    try {
      const host = new URL(u).hostname.replace(/^www\./, '');
      if (SKIP_HOSTS.test(host)) return false;
      const n = perHost.get(host) || 0;
      perHost.set(host, n + 1);
      return n < 2; // keep the results varied
    } catch {
      return false;
    }
  }).slice(0, limit * 2);

  const pages = await Promise.allSettled(candidates.map((u) => fromUrl(u, { timeout: 9000 })));
  return pages
    .filter((p) => p.status === 'fulfilled' && p.value.ingredients.length)
    .map((p) => p.value)
    .slice(0, limit);
}

// ---------- Feedback-driven alterations ----------

const STRING_LIST = { type: 'array', items: { type: 'string' } };

const ALTERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['alterations'],
  properties: {
    alterations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'why', 'changes', 'ingredients', 'steps', 'difficulty'],
        properties: {
          title: { type: 'string', description: 'Short name for this version, e.g. "Brighter, less salty"' },
          summary: { type: 'string', description: 'One or two sentences describing the change' },
          why: { type: 'string', description: 'How this responds to the feedback' },
          changes: { ...STRING_LIST, description: 'Bullet list of specific edits vs. the current version' },
          ingredients: { ...STRING_LIST, description: 'Complete revised ingredient list with quantities' },
          steps: { ...STRING_LIST, description: 'Complete revised method' },
          difficulty: { type: 'string', enum: ['easier', 'same', 'more involved'] },
        },
      },
    },
  },
};

function describeFeedback(feedback = []) {
  if (!feedback.length) return 'No feedback yet.';
  return feedback
    .map((f, i) => {
      const parts = [`#${i + 1} (${f.date?.slice(0, 10) || 'undated'}${f.versionTitle ? `, version "${f.versionTitle}"` : ''})`];
      if (f.rating) parts.push(`rating ${f.rating}/5`);
      if (f.tags?.length) parts.push(`notes: ${f.tags.join(', ')}`);
      if (f.wouldMakeAgain != null) parts.push(f.wouldMakeAgain ? 'would make again' : 'would NOT make again');
      if (f.comment) parts.push(`comment: "${f.comment}"`);
      return parts.join(' — ');
    })
    .join('\n');
}

export async function suggestAlterations({ recipe, version, feedback, pref, request, count = 3 }) {
  const level = LEVELS.find((l) => l.id === pref) || LEVELS[1];
  const current = version || recipe;
  const prompt = [
    `Recipe: ${recipe.title}${recipe.sourceName ? ` (from ${recipe.sourceName})` : ''}`,
    version ? `Current version: "${version.title}"` : '',
    '',
    'Ingredients:',
    ...current.ingredients.map((i) => `- ${i}`),
    '',
    'Method:',
    ...current.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    'Feedback from the times they have cooked it:',
    describeFeedback(feedback),
    '',
    `Homemade preference: "${level.label}" — ${level.desc}`,
    request ? `\nSpecific request from the cook: ${request}` : '',
    '',
    `Propose ${count} distinct alterations to try next time. Each one should directly address the feedback ` +
      '(or the specific request), respect the homemade preference — swap canned/boxed/jarred products for homemade ' +
      'components or vice versa as the preference calls for — and stay true to the dish. ' +
      'Make them meaningfully different from each other (e.g. a small tweak, a bolder change, a technique change). ' +
      'Give complete ingredient lists and methods so each can be cooked as-is.',
  ].filter((l) => l !== null).join('\n');

  const response = await getClient().beta.messages.create({
    ...base,
    max_tokens: 16000,
    system: 'You are an experienced home-cooking coach. You give practical, specific recipe adjustments with real quantities.',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: ALTERATION_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  });
  assertNotRefused(response);
  if (response.stop_reason === 'max_tokens') {
    throw Object.assign(new Error('The suggestion was cut off; please try again.'), { status: 502 });
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = JSON.parse(text);
  return parsed.alterations.map((a) => ({ ...a, origin: 'claude' }));
}
