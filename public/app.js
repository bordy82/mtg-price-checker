const state = {
  stores: [],
  view: 'sell', // 'sell' = buylist offers + cards to sell, 'buy' = retail prices + wishlist
  sellValue: 'credit', // in sell view, which value decides the "best" store
  results: [],
  filters: { finish: 'all', treatments: new Set() },
  lists: { sell: [], buy: [] },
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => (n === null || n === undefined ? '—' : `$${n.toFixed(2)}`);
const otherValue = () => (state.sellValue === 'credit' ? 'cash' : 'credit');
const finishGroup = (f) => (f === 'nonfoil' || f === 'etched' ? f : 'foil');
const NORMAL = 'Normal';
const VIEW_KEY = 'mtg-buylist:view';

// Everything that differs between selling and buying. Prices are { cash, credit } or { price, stock }.
const MODES = {
  sell: {
    subtitle: 'best offer per card',
    listTitle: 'My cards to sell',
    emptyText: 'Search for a card above and click <b>Add</b> on the version you own.',
    value: (p) => p?.[state.sellValue],
    eligible: (p) => p?.[state.sellValue] > 0,
    better: (a, b) => a > b,
    alt: (p) => `${otherValue()} ${money(p[otherValue()])}`,
    totalLabel: () => `Total ${state.sellValue} if everything goes to…`,
    missingLabel: (n) => `${n} not bought`,
    starTitle: 'Star: actually selling this',
  },
  buy: {
    subtitle: 'cheapest price per card',
    listTitle: 'My wishlist',
    emptyText: 'Search for a card above and click <b>Add</b> on the version you want.',
    value: (p) => p?.price,
    eligible: (p) => p?.price > 0 && p.stock > 0,
    better: (a, b) => a < b,
    alt: (p) => (p.stock > 0 ? `${p.stock} in stock` : 'out of stock'),
    totalLabel: () => 'Total cost if bought at…',
    missingLabel: (n) => `${n} unavailable`,
    starTitle: 'Star: actually buying this',
  },
};
const cfg = () => MODES[state.view];
const currentList = () => state.lists[state.view];

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// ---- shared rendering helpers ----

function thumb(image) {
  if (!image) return '<td class="thumb"></td>';
  return `<td class="thumb"><img src="${esc(image)}" alt="" loading="lazy"><img class="big" src="${esc(image)}" alt=""></td>`;
}

function printingTags(p) {
  const finish = p.finish === 'nonfoil' ? '' : `<span class="tag foil">${esc(p.finish.replace(/\b\w/g, (c) => c.toUpperCase()))}</span>`;
  const treatments = p.treatments.map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  return finish + treatments;
}

function printingLine(p) {
  return `<div class="printing">${esc(p.setName || p.setCode)} · ${esc(String(p.setCode).toUpperCase())} #${esc(p.collectorNumber)}</div>`;
}

// Store id with the best eligible value for the current view, or null.
function bestStore(prices) {
  const { value, eligible, better } = cfg();
  let best = null;
  for (const s of state.stores) {
    const p = prices?.[s.id];
    if (eligible(p) && (!best || better(value(p), value(prices[best])))) best = s.id;
  }
  return best;
}

function priceCell(prices, storeId, best) {
  const { value, eligible, alt } = cfg();
  const p = prices?.[storeId];
  const v = value(p);
  if (!v) return '<td class="num"><span class="price none">—</span></td>';
  const cls = storeId === best ? 'best' : eligible(p) ? '' : 'oos';
  return `<td class="num"><span class="price ${cls}">
    <span class="main">${money(v)}</span><span class="alt">${esc(alt(p))}</span></span></td>`;
}

function storeHeaders() {
  return state.stores
    .map((s) => `<th class="num" title="${state.view === 'sell' ? esc(s.creditNote) : ''}">${esc(s.label)}</th>`)
    .join('');
}

// ---- search ----

async function search(q) {
  const status = $('#search-status');
  status.className = 'status';
  status.textContent = `Searching ${state.stores.map((s) => s.label).join(' and ')}…`;
  $('#results').hidden = true;
  $('#filters').hidden = true;
  const view = state.view;
  try {
    const data = await api(`/api/search?mode=${view}&q=${encodeURIComponent(q)}`);
    if (view !== state.view) return; // switched modes while waiting
    state.results = data.printings;
    state.filters = { finish: 'all', treatments: new Set() };
    const failed = Object.keys(data.errors || {});
    const failedNote = failed.length
      ? ` · couldn't reach ${failed.map((id) => state.stores.find((s) => s.id === id)?.label || id).join(', ')}`
      : '';
    state.failedNote = failedNote;
    if (failed.length) status.className = 'status error';
    renderFilters();
    renderResults();
  } catch (err) {
    status.className = 'status error';
    status.textContent = err.message;
  }
}

function clearResults() {
  state.results = [];
  $('#results').hidden = true;
  $('#filters').hidden = true;
  $('#search-status').textContent = '';
}

function renderFilters() {
  const el = $('#filters');
  if (!state.results.length) { el.hidden = true; return; }

  const groups = new Set(state.results.map((p) => finishGroup(p.finish)));
  const finishes = [['all', 'All'], ['nonfoil', 'Non-foil'], ['foil', 'Foil'], ['etched', 'Etched']]
    .filter(([id]) => id === 'all' || groups.has(id));

  const treatments = new Set();
  for (const p of state.results) {
    if (!p.treatments.length) treatments.add(NORMAL);
    p.treatments.forEach((t) => treatments.add(t));
  }
  const sortedTreatments = [...treatments].sort((a, b) => (a === NORMAL ? -1 : b === NORMAL ? 1 : a.localeCompare(b)));

  el.innerHTML = `
    <div class="group"><span class="label">Finish</span>
      ${finishes.map(([id, label]) => `<button type="button" class="chip ${state.filters.finish === id ? 'on' : ''}" data-finish="${id}">${label}</button>`).join('')}
    </div>
    <div class="group"><span class="label">Version</span>
      ${sortedTreatments.map((t) => `<button type="button" class="chip ${state.filters.treatments.has(t) ? 'on' : ''}" data-treatment="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>`;
  el.hidden = false;
}

function filteredResults() {
  const { finish, treatments } = state.filters;
  return state.results.filter((p) => {
    if (finish !== 'all' && finishGroup(p.finish) !== finish) return false;
    if (treatments.size) {
      const tags = p.treatments.length ? p.treatments : [NORMAL];
      if (!tags.some((t) => treatments.has(t))) return false;
    }
    return true;
  });
}

function renderResults() {
  const table = $('#results');
  const rows = filteredResults();
  const total = state.results.length;
  $('#search-status').textContent =
    (rows.length === total ? `${total} printings found` : `Showing ${rows.length} of ${total} printings`) +
    (state.failedNote || '');
  table.querySelector('thead').innerHTML = `<tr><th></th><th>Card</th><th>Version</th>${storeHeaders()}<th></th></tr>`;
  table.querySelector('tbody').innerHTML = rows.length
    ? rows.map((p) => {
        const best = bestStore(p.prices);
        const inList = currentList().find((i) => p.keys.includes(i.key));
        return `<tr>
          ${thumb(p.image)}
          <td><div class="card-name">${esc(p.name)}</div>${printingLine(p)}</td>
          <td>${printingTags(p) || '<span class="muted">Normal</span>'}</td>
          ${state.stores.map((s) => priceCell(p.prices, s.id, best)).join('')}
          <td class="add-cell">
            ${inList ? '<span class="added">✓ In list</span>' : `<button class="small" data-add="${esc(p.key)}">Add</button>`}
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="${4 + state.stores.length}" class="muted empty">No printing matches these filters.</td></tr>`;
  table.hidden = false;
}

// ---- saved lists ----

async function saveList(view = state.view) {
  await api(`/api/list?mode=${view}`, { method: 'PUT', body: JSON.stringify(state.lists[view]) });
}

function addToList(key) {
  const p = state.results.find((r) => r.key === key);
  const list = currentList();
  if (!p || list.some((i) => p.keys.includes(i.key))) return;
  const { key: k, name, setCode, setName, collectorNumber, finish, treatments, image, prices } = p;
  list.push({ key: k, name, setCode, setName, collectorNumber, finish, treatments, image, prices, updatedAt: Date.now() });
  saveList();
  renderList();
  renderResults();
}

function renderList() {
  const c = cfg();
  const list = currentList();
  const table = $('#list');
  const empty = !list.length;
  $('#list-title').textContent = c.listTitle;
  $('#list-empty').innerHTML = c.emptyText;
  $('#list-empty').hidden = !empty;
  table.hidden = empty;
  $('#refresh').disabled = empty;
  $('#list-count').textContent = empty ? '' : `${list.length} card${list.length === 1 ? '' : 's'}`;
  renderUpdated();
  if (empty) return;

  table.querySelector('thead').innerHTML =
    `<tr><th></th><th></th><th>Card</th>${storeHeaders()}<th></th></tr>`;

  // Starred cards first; the sort is stable, so each group keeps the order cards were added.
  const rows = [...list].sort((a, b) => Boolean(b.starred) - Boolean(a.starred));
  const html = rows.map((item) => {
    const best = bestStore(item.prices);
    const key = esc(item.key);
    return `<tr>
      <td><button class="icon star${item.starred ? ' on' : ''}" data-star="${key}" title="${esc(c.starTitle)}" aria-pressed="${Boolean(item.starred)}">${item.starred ? '★' : '☆'}</button></td>
      ${thumb(item.image)}
      <td><div class="card-name">${esc(item.name)} ${printingTags(item)}</div>${printingLine(item)}</td>
      ${state.stores.map((s) => priceCell(item.prices, s.id, best)).join('')}
      <td class="num"><button class="icon" data-remove="${key}" title="Remove">✕</button></td>
    </tr>`;
  });

  // Subtotal of the starred cards, under the last one. Only when it differs from the full total.
  const starred = rows.filter((item) => item.starred);
  if (starred.length && starred.length < rows.length) {
    const label = c.totalLabel();
    html.splice(starred.length, 0,
      totalRows(`Starred: ${label[0].toLowerCase()}${label.slice(1)}`, listTotals(starred), 'starred'));
  }
  table.querySelector('tbody').innerHTML = html.join('');
  table.querySelector('tfoot').innerHTML = totalRows(c.totalLabel(), listTotals(list));
}

// Per-store totals for some cards: everything at one store (eligible offers only).
function listTotals(items) {
  const { eligible, value } = cfg();
  const perStore = {};
  const missing = {};
  for (const s of state.stores) { perStore[s.id] = 0; missing[s.id] = 0; }
  for (const item of items) {
    for (const s of state.stores) {
      const p = item.prices?.[s.id];
      if (eligible(p)) perStore[s.id] += value(p);
      else missing[s.id] += 1;
    }
  }
  return { perStore, missing };
}

// Two rows: the total per store, then how many cards each store doesn't buy / have in stock.
function totalRows(label, { perStore, missing }, cls = '') {
  const { missingLabel } = cfg();
  return `
    <tr class="total ${cls}">
      <td></td><td></td><td>${esc(label)}</td>
      ${state.stores.map((s) => `<td class="num">${money(perStore[s.id])}</td>`).join('')}
      <td></td>
    </tr>
    <tr class="total sub ${cls}">
      <td></td><td></td><td></td>
      ${state.stores.map((s) => `<td class="num">${missing[s.id] ? esc(missingLabel(missing[s.id])) : ''}</td>`).join('')}
      <td></td>
    </tr>`;
}

function renderUpdated() {
  const times = currentList().map((i) => i.updatedAt).filter(Boolean);
  if (!times.length) { $('#updated').textContent = ''; return; }
  const mins = Math.round((Date.now() - Math.min(...times)) / 60000);
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  $('#updated').textContent = `Prices from ${ago}`;
}

async function refreshPrices() {
  const btn = $('#refresh');
  const view = state.view;
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    const { list, errors } = await api(`/api/refresh?mode=${view}`, { method: 'POST' });
    state.lists[view] = list;
    if (view === state.view) renderList();
    const failed = Object.keys(errors || {});
    if (failed.length) {
      const names = failed.map((id) => state.stores.find((s) => s.id === id)?.label || id);
      alert(`Couldn't reach: ${names.join(', ')}. Their prices are blank until the next refresh.`);
    }
  } catch (err) {
    alert(err.message);
  } finally {
    btn.textContent = 'Refresh prices';
    btn.disabled = !currentList().length;
  }
}

// ---- mode switching ----

function applyView() {
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  $('#value-switch').hidden = state.view !== 'sell';
  $('#subtitle').textContent = cfg().subtitle;
  document.body.dataset.view = state.view;
  renderList();
}

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  try { localStorage.setItem(VIEW_KEY, view); } catch {}
  const query = $('#search-input').value.trim();
  const hadResults = state.results.length > 0;
  clearResults();
  applyView();
  // Show the same card in the new mode.
  if (hadResults && query.length >= 2) search(query);
}

// ---- events ----

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  search($('#search-input').value.trim());
});

// Clicking or tabbing into the search field selects its text, so typing replaces the last search.
// The mouseup after a focusing click would clear the selection, so that one mouseup is cancelled;
// later clicks place the cursor as usual.
{
  const input = $('#search-input');
  let focusingClick = false;
  input.addEventListener('mousedown', () => { focusingClick = document.activeElement !== input; });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('mouseup', (e) => {
    if (focusingClick) e.preventDefault();
    focusingClick = false;
  });
}

$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.finish) state.filters.finish = b.dataset.finish;
  if (b.dataset.treatment) {
    const t = b.dataset.treatment;
    state.filters.treatments.has(t) ? state.filters.treatments.delete(t) : state.filters.treatments.add(t);
  }
  renderFilters();
  renderResults();
});

$('#results').addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  addToList(b.dataset.add);
});

// Rows are found by key: starred cards are shown first, so row order differs from the saved order.
$('#list').addEventListener('click', (e) => {
  const list = currentList();
  const star = e.target.closest('[data-star]');
  if (star) {
    const item = list.find((i) => i.key === star.dataset.star);
    if (!item) return;
    if (item.starred) delete item.starred;
    else item.starred = true;
    saveList();
    renderList();
    return;
  }
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  const idx = list.findIndex((i) => i.key === b.dataset.remove);
  if (idx === -1) return;
  list.splice(idx, 1);
  saveList();
  renderList();
  if (state.results.length) renderResults();
});

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

document.querySelectorAll('[data-value]').forEach((b) =>
  b.addEventListener('click', () => {
    state.sellValue = b.dataset.value;
    document.querySelectorAll('[data-value]').forEach((x) => x.classList.toggle('active', x === b));
    renderList();
    if (state.results.length) renderResults();
  })
);

$('#refresh').addEventListener('click', refreshPrices);

(async function init() {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'buy' || saved === 'sell') state.view = saved;
  } catch {}
  [state.stores, state.lists.sell, state.lists.buy] = await Promise.all([
    api('/api/stores'),
    api('/api/list?mode=sell'),
    api('/api/list?mode=buy'),
  ]);
  applyView();
  setInterval(renderUpdated, 60000);
  $('#search-input').focus();
})();
