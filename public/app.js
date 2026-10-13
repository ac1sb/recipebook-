const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LEVEL_ICONS = { shortcut: '🥫', balanced: '⚖️', mostly: '🧺', scratch: '👩‍🍳' };

const state = {
  status: null,
  pref: 'balanced',
  sources: new Set(),
  results: new Map(),
  library: [],
  entry: null, // open library entry
  versionId: null, // selected version in the open entry (null = original)
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
  state.pref = state.status.settings.pref || 'balanced';
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
      api('/api/settings', { method: 'PUT', body: { pref: state.pref } }).catch(() => {});
      // Re-rank what is already on screen.
      if (state.results.size) rerankResults();
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

const levelOrder = { shortcut: 0, balanced: 55, mostly: 75, scratch: 90 };

function rerankResults() {
  for (const grid of [$('#results'), $('#webResults')]) {
    const cards = $$('.card', grid);
    const target = { shortcut: 40, balanced: 70, mostly: 85, scratch: 100 }[state.pref];
    cards
      .map((c) => ({ c, s: Number(c.dataset.score) }))
      .sort((a, b) => Math.abs(a.s - target) - Math.abs(b.s - target))
      .forEach(({ c, s }) => {
        c.classList.toggle('dim', s < levelOrder[state.pref]);
        grid.appendChild(c);
      });
  }
}

async function search(q) {
  if (!q) return;
  const btn = $('#searchForm button[type=submit]');
  btn.disabled = true;
  state.results.clear();
  $('#results').innerHTML = '';
  $('#webResults').innerHTML = '';
  setStatus($('#webStatus'), '');
  const apiSources = [...state.sources].filter((s) => s !== 'web');
  const tasks = [];

  if (apiSources.length) {
    setStatus($('#searchStatus'), `${spinner} Searching ${apiSources.length} recipe source${apiSources.length > 1 ? 's' : ''}…`);
    tasks.push(
      api(`/api/search?q=${encodeURIComponent(q)}&pref=${state.pref}&sources=${apiSources.join(',')}`)
        .then(({ results, errors }) => {
          renderResults($('#results'), results);
          const msg = results.length ? `${results.length} recipes, best matches for “${esc(levelLabel())}” first.` : `No recipes found for “${esc(q)}”.`;
          setStatus($('#searchStatus'), msg + (errors.length ? ` <span class="muted">(${esc(errors.join('; '))})</span>` : ''));
        })
        .catch((err) => setStatus($('#searchStatus'), esc(err.message), 'error')),
    );
  } else {
    setStatus($('#searchStatus'), '');
  }

  if (state.sources.has('web')) {
    setStatus($('#webStatus'), `${spinner} Claude is searching recipe sites across the web… (this takes 20–60 seconds)`);
    tasks.push(
      api(`/api/search/web?q=${encodeURIComponent(q)}&pref=${state.pref}`)
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

function renderResults(grid, results) {
  for (const r of results) {
    state.results.set(r.id, r);
    const card = buildCard({
      title: r.title,
      image: r.image,
      source: r.sourceName,
      meta: [r.totalTime && `⏱ ${formatTime(r.totalTime)}`, `${r.ingredients.length} ingredients`, r.description && r.description.slice(0, 40)],
      homemade: r.homemade,
    });
    card.dataset.score = r.homemade.score;
    card.classList.toggle('dim', !r.matchesPreference);
    card.addEventListener('click', () => openRecipe(r));
    card.addEventListener('keydown', (e) => e.key === 'Enter' && openRecipe(r));
    grid.appendChild(card);
  }
}

function buildCard({ title, image, source, meta, homemade, extra }) {
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
  $('.meter-label', card).textContent = `${homemade.level} · ${homemade.score}% homemade${homemade.convenienceCount ? ` · ${homemade.convenienceCount} shortcut item${homemade.convenienceCount > 1 ? 's' : ''}` : ''}`;
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

function ingredientsHtml(items, { changed = new Set() } = {}) {
  const showShortcuts = state.pref === 'shortcut';
  return `<ul class="ingredients">${items
    .map((i) => {
      const f = i.flag;
      let cls = f ? f.type : '';
      if (f?.type === 'homemade' && showShortcuts) cls += ' show-short';
      if (changed.has(i.text)) cls += ' changed';
      let note = '';
      if (f?.type === 'convenience') note = `<span class="flag"><b>🥫 ${esc(f.label)}</b> — from scratch: ${esc(f.tip)}</span>`;
      else if (f?.type === 'homemade' && showShortcuts) note = `<span class="flag"><b>⚡ Shortcut</b> — ${esc(f.tip)}</span>`;
      return `<li class="${cls}">${esc(i.text)}${note}</li>`;
    })
    .join('')}</ul>`;
}

function stepsHtml(steps, url) {
  if (!steps.length) {
    return `<p class="muted">This source doesn't share the method.${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener">See the full instructions on the original site ↗</a>` : ''}</p>`;
  }
  return `<ol class="steps">${steps.map((s) => (s.startsWith('— ') ? `<li style="list-style:none;font-weight:700">${esc(s)}</li>` : `<li>${esc(s)}</li>`)).join('')}</ol>`;
}

function scoreHtml(h) {
  return `<div class="scorebox"><div class="score-ring" style="--p:${h.score}">${h.score}%</div>
    <div><b>${esc(h.level)}</b><br><span class="muted">${h.convenienceCount ? `${h.convenienceCount} canned / boxed / store-bought item${h.convenienceCount > 1 ? 's' : ''} (highlighted)` : 'No convenience products detected'}</span></div></div>`;
}

async function openRecipe(r) {
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

  function render(recipe, adapted) {
    const items = adapted ? adapted.items : recipe.homemade.items;
    openDrawer(`
      ${heroHtml(recipe.image, recipe.title)}
      <div class="detail">
        <div>
          <h2>${esc(recipe.title)}</h2>
          <div class="row muted">
            <span>From <b>${esc(recipe.sourceName)}</b></span>
            ${recipe.totalTime ? `<span>· ⏱ ${formatTime(recipe.totalTime)}</span>` : ''}
            ${recipe.servings ? `<span>· 🍽 ${esc(recipe.servings)}</span>` : ''}
            ${recipe.url ? `<a href="${esc(recipe.url)}" target="_blank" rel="noopener">Original recipe ↗</a>` : ''}
          </div>
          ${recipe.description ? `<p class="muted">${esc(recipe.description)}</p>` : ''}
        </div>
        <div class="row">
          ${inLibrary ? `<button class="primary" id="openLib">📖 Open in my library</button>` : `<button class="primary" id="saveBtn">＋ Save to my library</button>`}
          <button id="adaptBtn">${adapted ? '↺ Show original' : `${LEVEL_ICONS[state.pref]} Adapt to “${esc(levelLabel())}”`}</button>
        </div>
        ${adapted ? adaptNotice(adapted) : ''}
        <div class="panel">${scoreHtml(recipe.homemade)}</div>
        <div class="cols">
          <div class="panel"><h3>Ingredients</h3>${ingredientsHtml(items, { changed: adapted?.changedSet })}</div>
          <div class="panel"><h3>Method</h3>${stepsHtml(recipe.steps, recipe.url)}</div>
        </div>
      </div>`);

    $('#saveBtn')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      const recipeToSave = { ...recipe, homemade: undefined };
      const entry = await api('/api/library', { method: 'POST', body: { recipe: recipeToSave } });
      // If the cook saved an adapted version, keep that as their first variation too.
      if (adapted?.changes.length) {
        await api(`/api/library/${entry.id}/versions`, {
          method: 'POST',
          body: { title: `${levelLabel()} version`, summary: `Adapted to “${levelLabel()}”.`, changes: adapted.changes.map((c) => `${c.label}: ${c.to}`), ingredients: adapted.ingredients, steps: recipe.steps, origin: 'rules' },
        });
      }
      await refreshLibrary();
      toast('Saved to your library');
      openLibraryEntry(entry.id);
    });
    $('#openLib')?.addEventListener('click', () => openLibraryEntry(inLibrary.id));
    $('#adaptBtn').addEventListener('click', async () => {
      if (adapted) return render(recipe);
      const result = await api('/api/adapt', { method: 'POST', body: { ingredients: recipe.ingredients, pref: state.pref } });
      if (!result.changes.length) return toast(`Already fits “${levelLabel()}” — nothing to swap.`);
      const changedSet = new Set(result.ingredients.filter((t, i) => t !== recipe.ingredients[i]));
      render(recipe, { ...result, changedSet, items: result.ingredients.map((text) => ({ text, flag: null })) });
    });
  }
}

function adaptNotice(adapted) {
  const dir = adapted.changes[0]?.direction === 'shortcut' ? 'shortcuts' : 'homemade swaps';
  return `<div class="notice"><b>${adapted.changes.length} ${dir} applied</b> (highlighted). Save to your library to keep this as a version you can cook and rate.</div>`;
}

// ---------- Library ----------

async function refreshLibrary() {
  state.library = await api('/api/library');
  $('#libCount').textContent = state.library.length || '';
  if ($('#view-library').classList.contains('active')) renderLibrary();
}

function stars(n) {
  if (!n) return '';
  const r = Math.round(n);
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function renderLibrary() {
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
        <div class="panel"><h3>Ingredients</h3>${ingredientsHtml((v.homemade || r.homemade).items)}</div>
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
    </div>`);

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
  $$('[data-save-suggestion]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    state.entry = await api(`/api/library/${e.id}/versions`, { method: 'POST', body: { suggestionId: b.dataset.saveSuggestion } });
    state.versionId = state.entry.versions.at(-1).id;
    renderEntry('.detail');
    refreshLibrary();
    toast('Saved as a new version — cook it and tell me how it went!');
  }));
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
      ${s.homemade ? `<span class="tagline">${s.homemade.score}% homemade</span>` : ''}
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
