const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LEVEL_ICONS = { shortcut: '🥫', balanced: '⚖️', mostly: '🥕', scratch: '👩‍🍳' };

const state = {
  status: null,
  pref: 'balanced',
  sources: new Set(),
  results: new Map(),
  library: [],
  entry: null, // open library entry
  similar: null, // last "find better matches" result
  versionId: null, // selected version in the open entry (null = original)
  maxPrep: '',
  maxCook: '',
  personalize: true,
  profile: null,
  lastQuery: '',
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2800);
}

function setStatus(el, html, kind = '') {
  el.className = `status ${kind}`;
  el.innerHTML = html;
}

const spinner = '<span class="spinner"></span>';

// ---------- Setup ----------

async function init() {
  state.status = await api('/api/status');
  const settings = state.status.settings;
  state.pref = settings.pref || 'balanced';
  state.maxPrep = settings.maxPrep || '';
  state.maxCook = settings.maxCook || '';
  state.personalize = settings.personalize !== false;
  $('#maxPrep').value = state.maxPrep;
  $('#maxCook').value = state.maxCook;
  $('#personalize').checked = state.personalize;
  for (const [id, key] of [['#maxPrep', 'maxPrep'], ['#maxCook', 'maxCook']]) {
    $(id).addEventListener('change', () => {
      state[key] = $(id).value;
      saveSettings({ [key]: state[key] || null });
      researchIfShowing();
    });
  }
  $('#personalize').addEventListener('change', () => {
    state.personalize = $('#personalize').checked;
    saveSettings({ personalize: state.personalize });
    renderTasteNote();
    researchIfShowing();
  });
  for (const s of state.status.sources) if (s.enabled) state.sources.add(s.id);
  renderPref();
  renderSources();
  await refreshLibrary();

  $$('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    search($('#q').value.trim());
  });
  $('#importBtn').addEventListener('click', importUrl);
  $('#importUrl').addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), importUrl()));
  $('#libFilter').addEventListener('input', renderLibrary);
  $('#drawer').addEventListener('click', (e) => e.target.closest('[data-close]') && closeDrawer());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());
}

function showView(name) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'library') renderLibrary();
}

function renderPref() {
  const levels = state.status.levels;
  $('#prefScale').innerHTML = levels
    .map((l) => `<button type="button" role="radio" aria-checked="${l.id === state.pref}" data-pref="${l.id}" title="${esc(l.desc)}">
        <span class="ico">${LEVEL_ICONS[l.id]}</span>${esc(l.label)}</button>`)
    .join('');
  $('#prefDesc').textContent = levels.find((l) => l.id === state.pref)?.desc || '';
  $$('#prefScale button').forEach((b) =>
    b.addEventListener('click', async () => {
      state.pref = b.dataset.pref;
      renderPref();
      saveSettings({ pref: state.pref });
      researchIfShowing();
    }),
  );
}

function renderSources() {
  $('#sourceList').innerHTML = state.status.sources
    .map((s) => s.enabled
      ? `<label class="chip"><input type="checkbox" data-source="${s.id}" ${state.sources.has(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`
      : `<span class="chip off" title="Add an API key in .env to enable (see README)">🔒 ${esc(s.name)}</span>`)
    .join('');
  $$('#sourceList input').forEach((cb) =>
    cb.addEventListener('change', () => (cb.checked ? state.sources.add(cb.dataset.source) : state.sources.delete(cb.dataset.source))),
  );
}

// ---------- Search ----------

function saveSettings(patch) {
  api('/api/settings', { method: 'PUT', body: patch }).catch(() => {});
}

// Filters and preferences are applied by the server, so re-run the last search.
function researchIfShowing() {
  if (state.lastQuery) search(state.lastQuery);
}

function searchParams(q) {
  const p = new URLSearchParams({ q, pref: state.pref, personalize: state.personalize ? '1' : '0' });
  if (state.maxPrep) p.set('maxPrep', state.maxPrep);
  if (state.maxCook) p.set('maxCook', state.maxCook);
  return p;
}

function renderTasteNote() {
  const p = state.profile;
  const has = p?.feedbackCount > 0;
  $('#personalizeWrap').hidden = !has;
  const note = $('#tasteNote');
  const bits = has ? [...p.summary, ...(p.topLikes.length ? [`more ${p.topLikes.slice(0, 3).join(', ')}`] : [])] : [];
  note.hidden = !(has && state.personalize && bits.length);
  note.textContent = bits.length ? `From your feedback, results favor: ${bits.join(' · ')}` : '';
}

async function search(q) {
  if (!q) return;
  const btn = $('#searchForm button[type=submit]');
  btn.disabled = true;
  state.lastQuery = q;
  state.results.clear();
  $('#results').innerHTML = '';
  for (const id of ['web', 'blog']) {
    $(`#${id}Results`).innerHTML = '';
    setStatus($(`#${id}Status`), '');
  }
  const slow = new Set(state.status.sources.filter((s) => s.slow).map((s) => s.id));
  const apiSources = [...state.sources].filter((s) => !slow.has(s));
  const tasks = [];

  if (apiSources.length) {
    setStatus($('#searchStatus'), `${spinner} Searching ${apiSources.length} recipe source${apiSources.length > 1 ? 's' : ''}…`);
    tasks.push(
      api(`/api/search?${searchParams(q)}&sources=${apiSources.join(',')}`)
        .then(({ results, errors, filteredOut, personalized, unrelated }) => {
          renderResults($('#results'), results);
          const exact = results.filter((r) => r.relevance?.full !== false).length;
          const close = results.length - exact;
          const timeNote = filteredOut ? ` ${filteredOut} hidden by your time filters.` : '';
          const fitNote = personalized?.length ? ' Ranked using your feedback.' : '';
          const skipped = unrelated ? ` Skipped ${unrelated} unrelated result${unrelated > 1 ? 's' : ''}.` : '';
          const moreNote = exact < 6 && ![...state.sources].some((s) => s !== 'themealdb')
            ? ' <br><span class="muted">TheMealDB is small — tick “Food blogs” for many more recipes.</span>' : '';
          const label = state.sources.size > 1 ? '<b>From recipe databases:</b> ' : '';
          const msg = results.length
            ? `${label}${exact} recipe${exact === 1 ? '' : 's'} matching “${esc(q)}”${close ? ` and ${close} close match${close > 1 ? 'es' : ''}` : ''}, best for “${esc(levelLabel())}” first.${fitNote}${timeNote}${skipped}${moreNote}`
            : `No recipes found for “${esc(q)}”${filteredOut ? ` within your time limits (${filteredOut} recipes were too long — try loosening the prep or cook time)` : ''}.${moreNote}`;
          setStatus($('#searchStatus'), msg + (errors.length ? ` <span class="muted">(${esc(errors.join('; '))})</span>` : ''));
        })
        .catch((err) => setStatus($('#searchStatus'), esc(err.message), 'error')),
    );
  } else {
    setStatus($('#searchStatus'), '');
  }

  if (state.sources.has('blogs')) {
    setStatus($('#blogStatus'), `${spinner} Searching food blogs — Budget Bytes, RecipeTin Eats, Natasha’s Kitchen, Once Upon a Chef and more… (a few seconds)`);
    tasks.push(
      api(`/api/search/blogs?${searchParams(q)}`)
        .then(({ results, filteredOut, sites }) => {
          const exact = results.filter((r) => r.relevance?.full !== false).length;
          const timeNote = filteredOut ? ` ${filteredOut} hidden by your time filters.` : '';
          setStatus($('#blogStatus'), results.length
            ? `<b>From food blogs:</b> ${exact} recipe${exact === 1 ? '' : 's'} matching “${esc(q)}” from ${sites} site${sites === 1 ? '' : 's'}.${timeNote}`
            : `No food blog recipes found for “${esc(q)}”.${timeNote}`);
          renderResults($('#blogResults'), results);
        })
        .catch((err) => setStatus($('#blogStatus'), `Food blogs: ${esc(err.message)}`, 'error')),
    );
  }

  if (state.sources.has('web')) {
    setStatus($('#webStatus'), `${spinner} Claude is searching recipe sites across the web… (this takes 20–60 seconds)`);
    tasks.push(
      api(`/api/search/web?${searchParams(q)}`)
        .then(({ results }) => {
          setStatus($('#webStatus'), results.length ? `<b>From around the web:</b> ${results.length} recipes from ${new Set(results.map((r) => r.sourceName)).size} sites` : 'No readable recipes found on the web for that search.');
          renderResults($('#webResults'), results);
        })
        .catch((err) => setStatus($('#webStatus'), `Web search: ${esc(err.message)}`, 'error')),
    );
  }
  await Promise.allSettled(tasks);
  btn.disabled = false;
}

function levelLabel() {
  return state.status.levels.find((l) => l.id === state.pref)?.label;
}

const urlKey = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '');

function renderResults(grid, results) {
  let closeHeading = false;
  const shown = new Set([...state.results.values()].map((r) => urlKey(r.url)).filter(Boolean));
  results = results.filter((r) => !r.url || !shown.has(urlKey(r.url)));
  for (const r of results) {
    if (r.relevance && !r.relevance.full && !closeHeading) {
      closeHeading = true;
      const h = document.createElement('div');
      h.className = 'grid-heading';
      h.innerHTML = '<b>Close matches</b> <span class="muted">— these are missing part of what you searched for</span>';
      grid.appendChild(h);
    }
    state.results.set(r.id, r);
    const card = buildCard({
      title: r.title,
      image: r.image,
      source: r.sourceName,
      meta: [timeSummary(r), `${r.ingredients.length} ingredients`, r.description && r.description.length <= 40 ? r.description : (r.tags || []).slice(0, 2).join(' · ')],
      homemade: r.homemade,
      fit: r.relevance && !r.relevance.full
        ? { ...r.fit, warnings: [`no ${r.relevance.missing.join(' or ')}`, ...(r.fit?.warnings || [])], reasons: r.fit?.reasons || [] }
        : r.fit,
    });
    card.dataset.score = r.homemade.score;
    card.classList.toggle('dim', !r.matchesPreference);
    card.addEventListener('click', () => openRecipe(r));
    card.addEventListener('keydown', (e) => e.key === 'Enter' && openRecipe(r));
    grid.appendChild(card);
  }
}

function timeSummary(r) {
  if (!r.prepTime && !r.cookTime) return r.totalTime ? `⏱ ${formatTime(r.totalTime)}` : '';
  const t = r.timeEstimated ? '~' : '';
  return `Prep ${t}${formatTime(r.prepTime) || '0 min'} · Cook ${t}${formatTime(r.cookTime) || '0 min'}`;
}

function fitHtml(fit) {
  if (!fit) return '';
  return [...fit.reasons.map((x) => `<span class="good" title="Matches your feedback">✓ ${esc(x)}</span>`),
    ...fit.warnings.map((x) => `<span class="bad" title="From your feedback">! ${esc(x)}</span>`)].join('');
}

function buildCard({ title, image, source, meta, homemade, fit, extra }) {
  const card = $('#cardTpl').content.firstElementChild.cloneNode(true);
  const img = $('img', card);
  if (image) {
    img.src = image;
    img.alt = title;
    img.onerror = () => {
      img.remove();
      $('.thumb', card).classList.add('noimg');
    };
  } else {
    img.remove();
    $('.thumb', card).classList.add('noimg');
  }
  $('.source', card).textContent = source || '';
  $('h3', card).textContent = title;
  $('.meta', card).innerHTML = meta.filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('') + (extra || '');
  $('.meter-fill', card).style.width = `${homemade.score}%`;
  $('.meter-label', card).textContent = `${homemade.level} (${homemade.score}%)${homemade.convenienceCount ? ` · ${homemade.convenienceCount} processed/packaged item${homemade.convenienceCount > 1 ? 's' : ''}` : ''}`;
  $('.fit', card).innerHTML = fitHtml(fit);
  return card;
}

function formatTime(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

async function importUrl() {
  const url = $('#importUrl').value.trim();
  if (!url) return;
  const btn = $('#importBtn');
  btn.disabled = true;
  btn.textContent = 'Reading…';
  try {
    const recipe = await api('/api/import', { method: 'POST', body: { url } });
    state.results.set(recipe.id, recipe);
    openRecipe(recipe);
    $('#importUrl').value = '';
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import';
  }
}

// ---------- Drawer: search result ----------

function openDrawer(html) {
  $('#drawerBody').innerHTML = html;
  $('#drawer').hidden = false;
  document.body.style.overflow = 'hidden';
  $('.drawer-panel').scrollTop = 0;
}

function closeDrawer() {
  $('#drawer').hidden = true;
  document.body.style.overflow = '';
  state.entry = null;
}

function heroHtml(image, title) {
  return image
    ? `<div class="hero"><img src="${esc(image)}" alt="${esc(title)}" onerror="this.parentNode.remove()"></div>`
    : '';
}

function stepsHtml(steps, url) {
  if (!steps.length) {
    return `<p class="muted">This source doesn't share the method.${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener">See the full instructions on the original site ↗</a>` : ''}</p>`;
  }
  return `<ol class="steps">${steps.map((s) => (s.startsWith('— ') ? `<li style="list-style:none;font-weight:700">${esc(s)}</li>` : `<li>${esc(s)}</li>`)).join('')}</ol>`;
}

function scoreHtml(h) {
  return `<div class="scorebox"><div class="score-ring" style="--p:${h.score}">${h.score}%</div>
    <div><b>${esc(h.level)}</b> — ${h.score}% made from scratch<br><span class="muted">${processedText(h)}</span></div></div>`;
}

function processedText(h) {
  if (!h.convenienceCount) return 'No processed or packaged products detected';
  const processed = h.processedCount || 0;
  const packaged = h.convenienceCount - processed;
  const parts = [];
  if (processed) parts.push(`${processed} processed food${processed > 1 ? 's' : ''} 🏭`);
  if (packaged) parts.push(`${packaged} canned / boxed / store-bought item${packaged > 1 ? 's' : ''} 🥫`);
  return `${parts.join(' and ')} (highlighted below)`;
}

async function openRecipe(r, { backTo = null } = {}) {
  const inLibrary = state.library.find((e) => e.sourceId === r.id);
  render(r);

  // Some sources (e.g. Edamam) don't include the method; fetch the full recipe.
  if (!r.steps.length && r.source !== 'web') {
    try {
      const full = await api(`/api/recipe?id=${encodeURIComponent(r.id)}`);
      Object.assign(r, full);
      if (!$('#drawer').hidden) render(r);
    } catch { /* keep what we have */ }
  }

  function render(recipe) {
    openDrawer(`
      ${backTo ? `<button class="back small" id="backBtn">← Back to ${esc(backTo.title)}</button>` : ''}
      ${heroHtml(recipe.image, recipe.title)}
      <div class="detail">
        <div>
          <h2>${esc(recipe.title)}</h2>
          <div class="row muted">
            <span>From <b>${esc(recipe.sourceName)}</b></span>
            ${timeSummary(recipe) ? `<span title="${recipe.timeEstimated ? 'Estimated from the ingredients and method' : 'From the recipe'}">· ⏱ ${timeSummary(recipe)}${recipe.timeEstimated ? ' (estimated)' : ''}</span>` : ''}
            ${recipe.servings ? `<span>· 🍽 ${esc(recipe.servings)}</span>` : ''}
            ${recipe.url ? `<a href="${esc(recipe.url)}" target="_blank" rel="noopener">Original recipe ↗</a>` : ''}
          </div>
          ${recipe.description ? `<p class="muted">${esc(recipe.description)}</p>` : ''}
          ${recipe.fit && (recipe.fit.reasons.length || recipe.fit.warnings.length) ? `<div class="fit" style="margin-top:8px">${fitHtml(recipe.fit)}</div>` : ''}
        </div>
        <div class="row">
          ${inLibrary ? `<button class="primary" id="openLib">📖 Open in my library</button>` : `<button class="primary" id="saveBtn">＋ Save to my library</button>`}
        </div>
        <div class="panel">${scoreHtml(recipe.homemade)}</div>
        <div class="cols">
          <div class="panel" id="ingPanel"></div>
          <div class="panel"><h3>Method</h3>${stepsHtml(recipe.steps, recipe.url)}</div>
        </div>
      </div>`);

    const saveRecipe = async (version) => {
      const entry = await api('/api/library', { method: 'POST', body: { recipe: { ...recipe, homemade: undefined, fit: undefined, relevance: undefined } } });
      let versionId = null;
      // If the cook changed the ingredients first, keep that as their first version too.
      if (version) {
        const updated = await api(`/api/library/${entry.id}/versions`, { method: 'POST', body: { ...version, steps: recipe.steps } });
        versionId = updated.versions.at(-1)?.id || null;
      }
      await refreshLibrary();
      toast(version ? 'Saved to your library with your changes' : 'Saved to your library');
      await openLibraryEntry(entry.id);
      if (versionId) {
        state.versionId = versionId;
        renderEntry();
      }
    };

    mountIngredientTools($('#ingPanel'), {
      title: recipe.title,
      ingredients: recipe.ingredients,
      items: recipe.homemade.items,
      steps: recipe.steps,
      saveLabel: inLibrary ? null : 'Save to my library with these changes',
      onSave: inLibrary ? null : saveRecipe,
    });

    $('#saveBtn')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      await saveRecipe(null);
    });
    $('#openLib')?.addEventListener('click', () => openLibraryEntry(inLibrary.id));
    $('#backBtn')?.addEventListener('click', () => openLibraryEntry(backTo.id, { keepVersion: true, scrollTo: '#similarPanel' }));
  }
}

// ---------- Ingredient tools: adapt, use canned, substitute missing ----------

// Renders an ingredient list with tools to rework it, inside `el`.
// opts: { title, ingredients, items (flags from the server), steps, saveLabel, onSave(version) }
function mountIngredientTools(el, opts) {
  const original = [...opts.ingredients];
  const local = {
    lines: [...original],
    changes: [], // human-readable list of what changed
    kinds: new Set(), // 'scratch' | 'canned' | 'substitutes'
    picking: false,
    missing: new Set(), // indexes ticked as missing
    subs: null, // [{ index, original, options, choice }]
    subsOrigin: null,
    busy: false,
  };

  const scratchTarget = state.pref === 'mostly' || state.pref === 'scratch' ? state.pref : 'scratch';
  const scratchLabel = scratchTarget === state.pref ? `${LEVEL_ICONS[state.pref]} Adapt to “${esc(levelLabel())}”` : '👩‍🍳 Make it from scratch';

  function changedCount() {
    return local.lines.filter((l, i) => l !== original[i]).length;
  }

  function lineHtml(text, i) {
    const changed = text !== original[i];
    const f = changed ? null : opts.items?.[i]?.flag;
    let cls = f ? `${f.type} ${f.kind || ''}` : '';
    if (changed) cls += ' changed';
    let note = '';
    if (f?.type === 'convenience') note = `<span class="flag"><b>${f.kind === 'processed' ? '🏭' : '🥫'} ${esc(f.label)}</b> — from scratch: ${esc(f.tip)}</span>`;
    else if (f?.type === 'homemade' && state.pref === 'shortcut') note = `<span class="flag"><b>⚡ Shortcut</b> — ${esc(f.tip)}</span>`;

    if (local.picking) {
      return `<li class="${cls} pick"><label><input type="checkbox" data-missing="${i}" ${local.missing.has(i) ? 'checked' : ''}> ${esc(text)}</label></li>`;
    }
    const sub = local.subs?.find((x) => x.index === i);
    if (sub) {
      const opt = (o, k) => `<label class="sub-opt"><input type="radio" name="sub-${i}" data-sub="${i}" value="${k}" ${sub.choice === k ? 'checked' : ''}>
        <span>${esc(o.text)}${o.note ? ` <span class="muted">— ${esc(o.note)}</span>` : ''}</span></label>`;
      return `<li class="${sub.choice >= 0 ? 'changed' : ''}"><div class="sub-title">Instead of <b>${esc(sub.original)}</b>:</div>
        ${sub.options.map(opt).join('')}
        <label class="sub-opt"><input type="radio" name="sub-${i}" data-sub="${i}" value="-1" ${sub.choice === -1 ? 'checked' : ''}> <span class="muted">Keep the original (I'll get it)</span></label></li>`;
    }
    return `<li class="${cls}">${esc(text)}${note}</li>`;
  }

  function render() {
    const n = changedCount();
    el.innerHTML = `
      <h3>Ingredients</h3>
      <div class="tools">
        <button class="small" data-act="scratch" title="Swap canned, boxed and processed products for homemade">${scratchLabel}</button>
        <button class="small" data-act="canned" title="Swap homemade parts for canned or store-bought versions">🥫 Use canned &amp; store-bought</button>
        <button class="small" data-act="missing" title="Tick what you don't have and get substitutes">🔄 Missing something?</button>
        ${n ? '<button class="small ghost" data-act="reset">↺ Undo changes</button>' : ''}
      </div>
      ${local.picking ? `<div class="notice">Tick the ingredients you <b>don't have</b>, then
          <button class="small primary" data-act="find" ${local.missing.size ? '' : 'disabled'}>Find substitutes${local.missing.size ? ` (${local.missing.size})` : ''}</button>
          <button class="small ghost" data-act="cancel">Cancel</button></div>` : ''}
      ${local.busy ? `<div class="status">${spinner} ${state.status.claude ? 'Claude is finding substitutes…' : 'Finding substitutes…'}</div>` : ''}
      ${local.subs && !local.picking ? `<div class="notice">Pick a substitute for each missing ingredient below${local.subsOrigin === 'claude' ? ' (suggested by Claude for this recipe)' : ''}.</div>` : ''}
      <ul class="ingredients">${local.lines.map(lineHtml).join('')}</ul>
      ${n ? `<div class="notice" style="margin-top:12px"><b>${n} ingredient${n > 1 ? 's' : ''} changed</b> (highlighted).
          ${opts.onSave ? `<button class="small primary" data-act="save">${esc(opts.saveLabel)}</button>` : ''}</div>` : ''}`;
  }

  async function adapt(kind) {
    const body = kind === 'canned' ? { ingredients: local.lines, direction: 'shortcut' } : { ingredients: local.lines, ...(scratchTarget === 'scratch' ? { direction: 'scratch' } : { pref: scratchTarget }) };
    const result = await api('/api/adapt', { method: 'POST', body });
    if (!result.changes.length) {
      return toast(kind === 'canned'
        ? 'Nothing here has a common canned or store-bought version.'
        : 'Nothing canned, boxed or processed to swap — it\'s already homemade.');
    }
    local.lines = result.ingredients;
    local.kinds.add(kind);
    local.changes.push(...result.changes.map((c) => `${c.label}: ${c.to}`));
    render();
  }

  async function findSubstitutes() {
    const indexes = [...local.missing].sort((a, b) => a - b);
    local.picking = false;
    local.busy = true;
    render();
    try {
      const res = await api('/api/substitute', {
        method: 'POST',
        body: { title: opts.title, ingredients: local.lines, steps: opts.steps, missing: indexes.map((i) => local.lines[i]) },
      });
      local.subsOrigin = res.origin;
      // "Instead of" always names the recipe's own ingredient, even if it was swapped above.
      local.subs = indexes.map((index, k) => ({ index, original: original[index], options: res.substitutions[k]?.options || [], choice: res.substitutions[k]?.options?.length ? 0 : -1 }));
      for (const sub of local.subs) applySub(sub);
      local.kinds.add('substitutes');
    } catch (err) {
      toast(err.message);
    } finally {
      local.busy = false;
      local.missing.clear();
      render();
    }
  }

  function applySub(sub) {
    const opt = sub.options[sub.choice];
    local.lines[sub.index] = opt ? `${opt.text}  (instead of ${sub.original})` : sub.original;
  }

  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || local.busy) return;
    if (act === 'scratch' || act === 'canned') await adapt(act);
    else if (act === 'missing') { local.picking = true; local.subs = null; render(); }
    else if (act === 'cancel') { local.picking = false; local.missing.clear(); render(); }
    else if (act === 'find') await findSubstitutes();
    else if (act === 'reset') {
      Object.assign(local, { lines: [...original], changes: [], picking: false, subs: null });
      local.kinds.clear();
      local.missing.clear();
      render();
    } else if (act === 'save') {
      e.target.disabled = true;
      const subChanges = (local.subs || []).filter((x) => x.choice >= 0).map((x) => `Instead of ${x.original}: ${x.options[x.choice].text}`);
      const names = { scratch: 'From scratch', canned: 'Canned & store-bought', substitutes: 'With substitutes' };
      const kinds = [...local.kinds].filter((k) => k !== 'substitutes' || subChanges.length);
      await opts.onSave({
        title: kinds.map((k) => names[k]).join(' + ') || 'My version',
        summary: kinds.includes('substitutes') ? 'Uses substitutes for ingredients I didn’t have.' : `Reworked: ${kinds.map((k) => names[k].toLowerCase()).join(' and ')}.`,
        changes: [...local.changes, ...subChanges],
        ingredients: local.lines,
        origin: 'rules',
      });
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.dataset.missing != null) {
      const i = Number(e.target.dataset.missing);
      e.target.checked ? local.missing.add(i) : local.missing.delete(i);
      render();
    } else if (e.target.dataset.sub != null) {
      const sub = local.subs.find((x) => x.index === Number(e.target.dataset.sub));
      sub.choice = Number(e.target.value);
      applySub(sub);
      render();
    }
  });
  render();
}

// ---------- Library ----------

async function refreshLibrary() {
  [state.library, state.profile] = await Promise.all([api('/api/library'), api('/api/profile')]);
  renderTasteNote();
  $('#libCount').textContent = state.library.length || '';
  if ($('#view-library').classList.contains('active')) renderLibrary();
}

function stars(n) {
  if (!n) return '';
  const r = Math.round(n);
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function renderTaste() {
  const p = state.profile;
  const el = $('#taste');
  el.hidden = !p?.feedbackCount;
  if (el.hidden) return;
  const rows = [];
  if (p.summary.length) rows.push(`<li>You tend to prefer <b>${p.summary.map(esc).join(', ')}</b></li>`);
  if (p.topLikes.length) rows.push(`<li>You rate dishes with <b>${p.topLikes.map(esc).join(', ')}</b> highly</li>`);
  if (p.topDislikes.length) rows.push(`<li>You weren't keen on dishes with <b>${p.topDislikes.map(esc).join(', ')}</b></li>`);
  if (p.commonNotes.length) rows.push(`<li>Most common notes: ${p.commonNotes.map(esc).join(', ')}</li>`);
  el.innerHTML = `<h3>🧠 What your feedback says (${p.feedbackCount} note${p.feedbackCount > 1 ? 's' : ''})</h3>
    ${rows.length ? `<ul>${rows.join('')}</ul>` : '<p class="muted" style="margin:0">Keep rating recipes — patterns will show up here.</p>'}
    <p class="muted" style="margin:8px 0 0;font-size:.85rem">Search results are ranked with this, and each recipe can find versions closer to what you want.</p>`;
}

function renderLibrary() {
  renderTaste();
  const grid = $('#library');
  const filter = $('#libFilter').value.trim().toLowerCase();
  const items = state.library.filter((e) => !filter || e.title.toLowerCase().includes(filter) || (e.sourceName || '').toLowerCase().includes(filter));
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = `<div class="empty"><div class="big">📖</div>${state.library.length ? 'No matches.' : 'Your library is empty. Search for a recipe and save it here, then come back after you cook it to give feedback.'}</div>`;
    return;
  }
  for (const e of items) {
    const card = buildCard({
      title: e.title,
      image: e.image,
      source: e.sourceName,
      meta: [
        e.avgRating ? `${stars(e.avgRating)}` : 'Not rated yet',
        timeSummary(e),
        e.timesMade ? `Made ${e.timesMade}×` : 'Not made yet',
        e.versions ? `${e.versions} version${e.versions > 1 ? 's' : ''}` : '',
      ],
      homemade: e.homemade,
    });
    card.addEventListener('click', () => openLibraryEntry(e.id));
    card.addEventListener('keydown', (ev) => ev.key === 'Enter' && openLibraryEntry(e.id));
    grid.appendChild(card);
  }
}

async function openLibraryEntry(id, { keepVersion = false, scrollTo } = {}) {
  const entry = await api(`/api/library/${id}`);
  state.entry = entry;
  if (!keepVersion) state.versionId = entry.favoriteVersionId;
  if (state.versionId && !entry.versions.some((v) => v.id === state.versionId)) state.versionId = null;
  renderEntry(scrollTo);
}

function currentVersion() {
  const e = state.entry;
  const v = e.versions.find((x) => x.id === state.versionId);
  return v ? { ...v, isOriginal: false } : { ...e.recipe, title: 'Original', isOriginal: true };
}

function renderEntry(scrollTo) {
  const e = state.entry;
  const r = e.recipe;
  const v = currentVersion();
  const scrollPos = $('.drawer-panel').scrollTop;
  const tags = state.status.feedbackTags;

  openDrawer(`
    ${heroHtml(r.image, r.title)}
    <div class="detail">
      <div>
        <h2>${esc(r.title)}</h2>
        <div class="row muted">
          <span>From <b>${esc(r.sourceName)}</b></span>
          ${r.totalTime ? `<span>· ⏱ ${formatTime(r.totalTime)}</span>` : ''}
          ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Original recipe ↗</a>` : ''}
          ${e.archivedAt ? `<span class="tagline" title="The ingredients, method${r.image?.startsWith('/images/') ? ' and photo' : ''} are stored on this computer, so this recipe stays even if the original site removes it.">📦 Saved copy</span>` : ''}
          <button class="ghost small" id="removeEntry">Remove from library</button>
        </div>
      </div>

      <div class="panel">
        <h3>Versions</h3>
        <div class="versions">
          <button class="small" data-version="" aria-pressed="${!state.versionId}">Original${!e.favoriteVersionId ? ' ★' : ''}</button>
          ${e.versions.map((x) => `<button class="small" data-version="${x.id}" aria-pressed="${state.versionId === x.id}">${esc(x.title)}${e.favoriteVersionId === x.id ? ' ★' : ''}</button>`).join('')}
        </div>
        ${!v.isOriginal ? `
          <div style="margin-top:12px">
            ${v.summary ? `<p style="margin:0 0 6px">${esc(v.summary)}</p>` : ''}
            ${v.changes?.length ? `<details><summary class="muted">What changed (${v.changes.length})</summary><ul>${v.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
            <div class="row" style="margin-top:8px">
              ${e.favoriteVersionId !== v.id ? `<button class="small" id="favVersion">★ Make this my go-to version</button>` : ''}
              <button class="small ghost" id="deleteVersion">Delete version</button>
            </div>
          </div>` : (e.favoriteVersionId ? `<div class="row" style="margin-top:8px"><button class="small" id="favVersion">★ Make the original my go-to</button></div>` : '')}
      </div>

      <div class="panel">${scoreHtml(v.homemade || r.homemade)}</div>

      <div class="cols">
        <div class="panel" id="ingPanel"></div>
        <div class="panel"><h3>Method</h3>${stepsHtml(v.steps, r.url)}</div>
      </div>

      <div class="panel" id="feedbackPanel">
        <h3>🍳 I made this — how did it go?</h3>
        <form class="feedback-form" id="feedbackForm">
          <div class="row"><span class="label">Rating</span><div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} stars">★</button>`).join('')}</div>
            <span class="muted" style="margin-left:auto">Cooked: <input type="date" id="fbDate" value="${new Date().toISOString().slice(0, 10)}" style="width:auto;padding:4px 8px"></span></div>
          <div><span class="label">Quick notes</span><div class="chips" id="fbTags" style="margin-top:6px">${tags.map((t) => `<button type="button" class="chip tag" aria-pressed="false">${esc(t)}</button>`).join('')}</div></div>
          <textarea id="fbComment" rows="2" placeholder="Anything else? e.g. “sauce was too thin”, “used half the chili and it was perfect”, “would add mushrooms”…"></textarea>
          <div class="row">
            <label class="chip"><input type="radio" name="again" value="yes"> Would make again</label>
            <label class="chip"><input type="radio" name="again" value="no"> Wouldn't make again</label>
            <button class="primary" type="submit" style="margin-left:auto">Save feedback</button>
          </div>
          <p class="muted" style="margin:0;font-size:.85rem">Feedback is recorded against the <b>${esc(v.title)}</b> version.</p>
        </form>
        ${e.feedback.length ? `<h3 style="margin-top:18px">History</h3><div class="history">${[...e.feedback].reverse().map(feedbackItem).join('')}</div>` : ''}
      </div>

      <div class="panel" id="altPanel">
        <h3>✨ Find new alterations</h3>
        <p class="muted" style="margin-top:0">Get new versions to try, based on all your feedback${state.status.claude ? '' : ' (built-in rules — add an Anthropic API key for much smarter suggestions)'}. They respect your “${esc(levelLabel())}” setting.</p>
        <div class="search-row">
          <input type="text" id="altRequest" placeholder="Optional: a specific wish, e.g. “make it dairy-free”, “use the slow cooker”, “more veggies”" ${state.status.claude ? '' : 'disabled title="Needs Claude (ANTHROPIC_API_KEY)"'}>
          <button class="primary" id="altBtn">Suggest alterations</button>
        </div>
        <div id="altStatus" class="status"></div>
        <div class="suggestions">${e.suggestions.map(suggestionHtml).join('')}</div>
      </div>

      <div class="panel" id="similarPanel">
        <h3>🔎 Find recipes closer to what you want</h3>
        <p class="muted" style="margin-top:0">${e.feedback.length
          ? 'Searches for other versions of this dish and ranks them by how well they fix what you noted, compared with this recipe.'
          : 'Rate this recipe first (above) — then this finds other versions of the dish that fix what you didn’t like.'}</p>
        <div class="row">
          <button class="primary" id="similarBtn">Find better matches</button>
          ${state.status.claude ? '<label class="chip"><input type="checkbox" id="similarWeb"> Also search the whole web (slower)</label>' : ''}
        </div>
        <div id="similarStatus" class="status"></div>
        <div id="similarResults" class="grid"></div>
      </div>
    </div>`);

  mountIngredientTools($('#ingPanel'), {
    title: r.title,
    ingredients: v.ingredients,
    items: (v.homemade || r.homemade).items,
    steps: v.steps,
    saveLabel: 'Save as a new version',
    onSave: async (version) => {
      state.entry = await api(`/api/library/${e.id}/versions`, { method: 'POST', body: { ...version, steps: v.steps, basedOn: v.isOriginal ? null : v.id } });
      state.versionId = state.entry.versions.at(-1).id;
      renderEntry('.detail');
      refreshLibrary();
      toast('Saved as a new version');
    },
  });

  if (scrollTo) $(scrollTo)?.scrollIntoView({ block: 'start' });
  else if (scrollPos) $('.drawer-panel').scrollTop = scrollPos;

  // Versions
  $$('[data-version]').forEach((b) => b.addEventListener('click', () => {
    state.versionId = b.dataset.version || null;
    renderEntry();
  }));
  $('#favVersion')?.addEventListener('click', async () => {
    state.entry = await api(`/api/library/${e.id}/favorite`, { method: 'PUT', body: { versionId: state.versionId } });
    renderEntry();
    refreshLibrary();
    toast('Go-to version updated');
  });
  $('#deleteVersion')?.addEventListener('click', async () => {
    if (!confirm(`Delete the “${v.title}” version?`)) return;
    state.entry = await api(`/api/library/${e.id}/versions/${v.id}`, { method: 'DELETE' });
    state.versionId = null;
    renderEntry();
    refreshLibrary();
  });
  $('#removeEntry').addEventListener('click', async () => {
    if (!confirm(`Remove “${r.title}” and all its feedback from your library?`)) return;
    await api(`/api/library/${e.id}`, { method: 'DELETE' });
    closeDrawer();
    await refreshLibrary();
    renderLibrary();
    toast('Removed');
  });

  // Feedback form
  let rating = 0;
  $$('#stars button').forEach((b) => b.addEventListener('click', () => {
    rating = Number(b.dataset.star);
    $$('#stars button').forEach((s) => s.classList.toggle('on', Number(s.dataset.star) <= rating));
  }));
  $$('#fbTags .tag').forEach((b) => b.addEventListener('click', () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true')));
  $('#feedbackForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const again = $('input[name=again]:checked')?.value;
    const body = {
      versionId: state.versionId,
      rating,
      tags: $$('#fbTags .tag[aria-pressed=true]').map((b) => b.textContent),
      comment: $('#fbComment').value.trim(),
      wouldMakeAgain: again ? again === 'yes' : undefined,
      date: $('#fbDate').value,
    };
    if (!body.rating && !body.tags.length && !body.comment) return toast('Add a rating, a quick note or a comment first.');
    state.entry = await api(`/api/library/${e.id}/feedback`, { method: 'POST', body });
    refreshLibrary();
    renderEntry('#altPanel');
    toast('Feedback saved — now try “Suggest alterations”');
  });
  $$('[data-del-feedback]').forEach((b) => b.addEventListener('click', async () => {
    state.entry = await api(`/api/library/${e.id}/feedback/${b.dataset.delFeedback}`, { method: 'DELETE' });
    renderEntry();
    refreshLibrary();
  }));

  // Alterations
  $('#altBtn').addEventListener('click', async (ev) => {
    const btn = ev.target;
    btn.disabled = true;
    setStatus($('#altStatus'), `${spinner} ${state.status.claude ? 'Claude is working out what to change… (about 20–40 seconds)' : 'Working out what to change…'}`);
    try {
      const res = await api(`/api/library/${e.id}/alterations`, { method: 'POST', body: { versionId: state.versionId, request: $('#altRequest').value.trim(), pref: state.pref } });
      state.entry = res;
      renderEntry('#altPanel');
      if (res.note) setStatus($('#altStatus'), esc(res.note));
    } catch (err) {
      setStatus($('#altStatus'), esc(err.message), 'error');
      btn.disabled = false;
    }
  });
  $('#similarBtn').addEventListener('click', (ev) => findSimilar(ev.target));
  if (state.similar?.entryId === e.id) showSimilar(state.similar);
  $$('[data-save-suggestion]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    state.entry = await api(`/api/library/${e.id}/versions`, { method: 'POST', body: { suggestionId: b.dataset.saveSuggestion } });
    state.versionId = state.entry.versions.at(-1).id;
    renderEntry('.detail');
    refreshLibrary();
    toast('Saved as a new version — cook it and tell me how it went!');
  }));
}

async function findSimilar(btn) {
  const e = state.entry;
  btn.disabled = true;
  const web = $('#similarWeb')?.checked;
  setStatus($('#similarStatus'), `${spinner} Looking for other versions of this dish${web ? ' across the web (up to a minute)' : ''}…`);
  $('#similarResults').innerHTML = '';
  try {
    const res = await api(`/api/library/${e.id}/similar`, {
      method: 'POST',
      body: { versionId: state.versionId, includeWeb: web, pref: state.pref, maxPrep: state.maxPrep || null, maxCook: state.maxCook || null },
    });
    state.similar = { ...res, entryId: e.id };
    showSimilar(state.similar);
  } catch (err) {
    setStatus($('#similarStatus'), esc(err.message), 'error');
  } finally {
    btn.disabled = false;
  }
}

function showSimilar(res) {
  const e = state.entry;
  const looking = res.lookingFor.length ? ` Looking for: <b>${res.lookingFor.map(esc).join(', ')}</b>.` : '';
  setStatus($('#similarStatus'), res.results.length
    ? `${res.results.length} versions of “${esc(res.query)}”, best fit first.${looking}`
    : `No other versions of “${esc(res.query)}” found.${looking}${res.errors.length ? ` (${esc(res.errors.join('; '))})` : ''}`);
  const grid = $('#similarResults');
  grid.innerHTML = '';
  for (const r of res.results) {
    const card = buildCard({
      title: r.title,
      image: r.image,
      source: r.sourceName,
      meta: [timeSummary(r), r.inLibrary ? '📖 in your library' : ''],
      homemade: r.homemade,
      fit: r.fit,
    });
    card.addEventListener('click', () => openRecipe(r, { backTo: { id: e.id, title: e.recipe.title } }));
    grid.appendChild(card);
  }
}

function feedbackItem(f) {
  return `<div class="item">
    <div class="row"><b>${new Date(f.date).toLocaleDateString()}</b>
      <span class="tagline">${esc(f.versionTitle || 'Original')}</span>
      ${f.rating ? `<span style="color:#e3a21a">${stars(f.rating)}</span>` : ''}
      ${f.wouldMakeAgain === true ? '<span class="tagline">👍 again</span>' : f.wouldMakeAgain === false ? '<span class="tagline">👎 not again</span>' : ''}
      <button class="ghost small" style="margin-left:auto" data-del-feedback="${f.id}" title="Delete this note">✕</button></div>
    ${f.tags?.length ? `<div class="muted">${f.tags.map(esc).join(' · ')}</div>` : ''}
    ${f.comment ? `<div>“${esc(f.comment)}”</div>` : ''}
  </div>`;
}

function suggestionHtml(s) {
  const diff = { easier: '⚡ easier', same: '≈ same effort', 'more involved': '👩‍🍳 more involved' }[s.difficulty] || '';
  return `<div class="suggestion">
    <div class="row"><h3 style="margin:0">${esc(s.title)}</h3>
      <span class="tagline">${diff}</span>
      ${s.homemade ? `<span class="tagline">${s.homemade.score}% from scratch</span>` : ''}
      <span class="tagline">${s.origin === 'claude' ? '✨ Claude' : '📏 rules'}</span></div>
    <p style="margin:8px 0 4px">${esc(s.summary)}</p>
    ${s.why ? `<p class="muted" style="margin:0 0 6px"><b>Why:</b> ${esc(s.why)}</p>` : ''}
    ${s.changes?.length ? `<ul>${s.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <details><summary>Full recipe for this version</summary>
      <div class="cols" style="margin-top:10px">
        <div><b>Ingredients</b><ul>${s.ingredients.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>
        <div><b>Method</b><ol>${s.steps.map((i) => `<li>${esc(i)}</li>`).join('')}</ol></div>
      </div>
    </details>
    <div class="row" style="margin-top:10px"><button class="primary small" data-save-suggestion="${s.id}">Save as a new version to try</button></div>
  </div>`;
}

init().catch((err) => {
  document.querySelector('main').innerHTML = `<p class="status error">Could not start: ${esc(err.message)}</p>`;
});
