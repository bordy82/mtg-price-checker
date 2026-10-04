const state = {
  stores: [],
  view: 'sell', // 'sell' = buylist offers + cards to sell, 'buy' = retail prices + wishlist
  sellValue: 'credit', // in sell view, which value decides the "best" store
  results: [],
  filters: { finish: 'all', treatments: new Set() },
  lists: { sell: [], buy: [] },
  excluded: { sell: new Set(), buy: new Set() }, // stores left out of the comparison, per view
  moveTo: null, // store picked in "Move starred cards to"
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => (n === null || n === undefined ? '—' : `$${n.toFixed(2)}`);
const otherValue = () => (state.sellValue === 'credit' ? 'cash' : 'credit');
const finishGroup = (f) => (f === 'nonfoil' || f === 'etched' ? f : 'foil');
const NORMAL = 'Normal';
const VIEW_KEY = 'mtg-buylist:view';
const EXCLUDED_KEY = 'mtg-buylist:excluded';

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
    storeListTitle: (store) => `Selling to ${store}`,
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
const isIncluded = (storeId) => !state.excluded[state.view].has(storeId);
// Unticked stores keep their column, dimmed.
const colClass = (storeId, chosen) =>
  `num${isIncluded(storeId) ? '' : ' excluded'}${storeId === chosen ? ' chosen' : ''}`;

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
  return `<td class="thumb" data-preview="${esc(image)}"><img src="${esc(image)}" alt="" loading="lazy"></td>`;
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
    if (isIncluded(s.id) && eligible(p) && (!best || better(value(p), value(prices[best])))) best = s.id;
  }
  return best;
}

function priceCell(prices, storeId, best, chosen) {
  const { value, eligible, alt } = cfg();
  const p = prices?.[storeId];
  const v = value(p);
  if (!v) return `<td class="${colClass(storeId, chosen)}"><span class="price none">—</span></td>`;
  const cls = storeId === best ? 'best' : eligible(p) ? '' : 'oos';
  return `<td class="${colClass(storeId, chosen)}"><span class="price ${cls}">
    <span class="main">${money(v)}</span><span class="alt">${esc(alt(p))}</span></span></td>`;
}

// Clicking a store's header leaves it out of the comparison (its column dims); clicking again brings it back.
function storeHeaders(chosen) {
  return state.stores
    .map((s) => {
      const included = isIncluded(s.id);
      const hint = included ? 'Click to leave out of the comparison' : 'Click to compare again';
      const title = state.view === 'sell' ? `${s.creditNote} · ${hint}` : hint;
      return `<th class="${colClass(s.id, chosen)}"><button class="store-toggle" data-store="${esc(s.id)}"
        aria-pressed="${included}" title="${esc(title)}">${esc(s.label)}</button></th>`;
    })
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

// Store a sell-list card was moved to (#17), or null if it's in the main list.
// Only the Selling tab has store lists; an unknown store id counts as the main list.
function sellToOf(item) {
  return state.view === 'sell' && state.stores.some((s) => s.id === item.sellTo) ? item.sellTo : null;
}

function renderList() {
  const c = cfg();
  const list = currentList();
  const main = list.filter((item) => !sellToOf(item));
  const table = $('#list');
  $('#list-title').textContent = c.listTitle;
  $('#list-empty').innerHTML = c.emptyText;
  $('#list-empty').hidden = list.length > 0;
  table.hidden = !main.length;
  $('#refresh').disabled = !list.length;
  $('#list-count').textContent = main.length ? `${main.length} card${main.length === 1 ? '' : 's'}` : '';
  renderUpdated();
  renderMoveBar(main);
  renderStoreLists(list);
  if (!main.length) return;

  const { thead, tbody, tfoot } = listTable(main, { subtotal: true });
  table.querySelector('thead').innerHTML = thead;
  table.querySelector('tbody').innerHTML = tbody;
  table.querySelector('tfoot').innerHTML = tfoot;
}

// List order: starred cards first, then by card name; printings of the same card by set, number, finish.
// Display only: the saved list keeps the order cards were added.
const byText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base', numeric: true });
const FINISH_ORDER = ['nonfoil', 'foil', 'etched'];
const finishRank = (f) => (FINISH_ORDER.includes(f) ? FINISH_ORDER.indexOf(f) : FINISH_ORDER.length);

function compareListItems(a, b) {
  return Boolean(b.starred) - Boolean(a.starred)
    || byText(a.name, b.name)
    || byText(a.setName || a.setCode, b.setName || b.setCode)
    || byText(a.collectorNumber, b.collectorNumber)
    || finishRank(a.finish) - finishRank(b.finish)
    || byText(a.finish, b.finish);
}

// One list table: starred cards first, an optional starred subtotal, and per-store totals.
// `chosen` highlights one store's column (the store a "Selling to" list is for).
function listTable(items, { subtotal = false, chosen = null } = {}) {
  const c = cfg();
  const rows = [...items].sort(compareListItems);
  const html = rows.map((item) => {
    const best = bestStore(item.prices);
    const key = esc(item.key);
    return `<tr>
      <td><button class="icon star${item.starred ? ' on' : ''}" data-star="${key}" title="${esc(c.starTitle)}" aria-pressed="${Boolean(item.starred)}">${item.starred ? '★' : '☆'}</button></td>
      ${thumb(item.image)}
      <td><div class="card-name">${esc(item.name)} ${printingTags(item)}</div>${printingLine(item)}</td>
      ${state.stores.map((s) => priceCell(item.prices, s.id, best, chosen)).join('')}
      <td class="num"><button class="icon" data-remove="${key}" title="Remove">✕</button></td>
    </tr>`;
  });

  // Subtotal of the starred cards, under the last one. Only when it differs from the full total.
  const starred = rows.filter((item) => item.starred);
  if (subtotal && starred.length && starred.length < rows.length) {
    const label = c.totalLabel();
    html.splice(starred.length, 0,
      totalRows(`Starred: ${label[0].toLowerCase()}${label.slice(1)}`, listTotals(starred), 'starred'));
  }
  return {
    thead: `<tr><th></th><th></th><th>Card</th>${storeHeaders(chosen)}<th></th></tr>`,
    tbody: html.join(''),
    tfoot: totalRows(c.totalLabel(), listTotals(items), '', chosen),
  };
}

// "Move starred cards to [store]": shown in Selling when the main list has starred cards.
function renderMoveBar(main) {
  const bar = $('#move-bar');
  const count = main.filter((item) => item.starred).length;
  bar.hidden = state.view !== 'sell' || !count;
  if (bar.hidden) return;
  if (!state.stores.some((s) => s.id === state.moveTo)) state.moveTo = state.stores[0]?.id;
  $('#move-label').textContent = `Move ${count} starred card${count === 1 ? '' : 's'} to`;
  $('#move-to').innerHTML = state.stores
    .map((s) => `<option value="${esc(s.id)}"${s.id === state.moveTo ? ' selected' : ''}>${esc(s.label)}</option>`)
    .join('');
}

// One "Selling to <store>" section per store that has cards, in store order.
function renderStoreLists(list) {
  const c = cfg();
  $('#store-lists').innerHTML = state.stores.map((s) => {
    const items = list.filter((item) => sellToOf(item) === s.id);
    if (!items.length) return '';
    const { thead, tbody, tfoot } = listTable(items, { chosen: s.id });
    return `<section class="store-list">
      <div class="store-list-head">
        <h3>${esc(c.storeListTitle(s.label))} <span class="pill">${items.length} card${items.length === 1 ? '' : 's'}</span></h3>
        <button class="ghost small" data-print="${esc(s.id)}">Print</button>
      </div>
      <div class="table-wrap"><table class="grid"><thead>${thead}</thead><tbody>${tbody}</tbody><tfoot>${tfoot}</tfoot></table></div>
    </section>`;
  }).join('');
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
function totalRows(label, { perStore, missing }, cls = '', chosen = null) {
  const { missingLabel } = cfg();
  return `
    <tr class="total ${cls}">
      <td></td><td></td><td>${esc(label)}</td>
      ${state.stores.map((s) => `<td class="${colClass(s.id, chosen)}">${money(perStore[s.id])}</td>`).join('')}
      <td></td>
    </tr>
    <tr class="total sub ${cls}">
      <td></td><td></td><td></td>
      ${state.stores.map((s) => `<td class="${colClass(s.id, chosen)}">${missing[s.id] ? esc(missingLabel(missing[s.id])) : ''}</td>`).join('')}
      <td></td>
    </tr>`;
}

// "Prices from 3 h ago": the age of the oldest prices among these cards, or '' if none are dated.
function pricesAge(items) {
  const times = items.map((i) => i.updatedAt).filter(Boolean);
  if (!times.length) return '';
  const mins = Math.round((Date.now() - Math.min(...times)) / 60000);
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  return `Prices from ${ago}`;
}

function renderUpdated() {
  $('#updated').textContent = pricesAge(currentList());
}

// ---- print a "Selling to <store>" list: that store's credit and cash only, whatever the switch says ----

function printStoreList(storeId) {
  const store = state.stores.find((s) => s.id === storeId);
  const items = currentList().filter((item) => sellToOf(item) === storeId).sort(compareListItems);
  if (!store || !items.length) return;

  let credit = 0;
  let cash = 0;
  let notBought = 0;
  const rows = items.map((item) => {
    const p = item.prices?.[storeId];
    const buys = p?.credit > 0 || p?.cash > 0;
    if (buys) { credit += p.credit || 0; cash += p.cash || 0; } else notBought += 1;
    const finish = item.finish === 'nonfoil' ? '' : item.finish.replace(/\b\w/g, (ch) => ch.toUpperCase());
    const meta = [`${item.setName || item.setCode} · ${String(item.setCode).toUpperCase()} #${item.collectorNumber}`,
      finish, ...item.treatments].filter(Boolean).join(' · ');
    return `<tr>
      <td><div class="ps-name">${esc(item.name)}</div><div class="ps-meta">${esc(meta)}</div></td>
      <td class="num">${buys ? money(p.credit) : '—'}</td>
      <td class="num">${buys ? money(p.cash) : '—'}</td>
    </tr>`;
  }).join('');

  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const info = [date, pricesAge(items), `${items.length} card${items.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  $('#print-sheet').innerHTML = `
    <h2>${esc(cfg().storeListTitle(store.label))}</h2>
    <p class="ps-info">${esc(info)}</p>
    <table>
      <thead><tr><th>Card</th><th class="num">Credit</th><th class="num">Cash</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td>Total</td><td class="num">${money(credit)}</td><td class="num">${money(cash)}</td></tr>
        ${notBought ? `<tr class="ps-note"><td colspan="3">${notBought} not bought by ${esc(store.label)}</td></tr>` : ''}
      </tfoot>
    </table>`;
  window.print();
}

window.addEventListener('afterprint', () => { $('#print-sheet').innerHTML = ''; });

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

// ---- excluded stores: left out of the comparison (each view has its own set) ----

function loadExcluded() {
  try {
    const saved = JSON.parse(localStorage.getItem(EXCLUDED_KEY) || '{}');
    const ids = new Set(state.stores.map((s) => s.id));
    for (const view of ['sell', 'buy']) {
      // Ignore stores that no longer exist.
      state.excluded[view] = new Set((saved[view] || []).filter((id) => ids.has(id)));
    }
  } catch {}
}

function saveExcluded() {
  try {
    localStorage.setItem(EXCLUDED_KEY, JSON.stringify({ sell: [...state.excluded.sell], buy: [...state.excluded.buy] }));
  } catch {}
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

// ---- card preview ----
// One floating preview for every thumbnail. It's positioned in the window rather than inside the table,
// so the table frame (which scrolls sideways on small screens, and so clips) can't cut it off.

const preview = $('#card-preview');

function showPreview(cell) {
  if (preview.getAttribute('src') !== cell.dataset.preview) preview.src = cell.dataset.preview;
  preview.hidden = false;
  const r = cell.getBoundingClientRect();
  const margin = 8;
  // Start beside the row, then keep the whole image inside the window (near the bottom it opens upward).
  const top = Math.min(Math.max(margin, r.top - 40), innerHeight - preview.offsetHeight - margin);
  preview.style.left = `${r.right + 10}px`;
  preview.style.top = `${top}px`;
}

const hidePreview = () => { preview.hidden = true; };

document.addEventListener('mouseover', (e) => {
  const cell = e.target.closest('td.thumb[data-preview]');
  if (cell) showPreview(cell);
  else hidePreview();
});
document.documentElement.addEventListener('mouseleave', hidePreview);
window.addEventListener('scroll', hidePreview, { passive: true });

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

// Star / remove in the main list and in every store list. Rows are found by key: starred cards are
// shown first, and cards are split across lists, so row order differs from the saved order.
$('#list-panel').addEventListener('click', (e) => {
  const list = currentList();
  const star = e.target.closest('[data-star]');
  if (star) {
    const item = list.find((i) => i.key === star.dataset.star);
    if (!item) return;
    if (item.starred) {
      // Unstarring a card in a store list also sends it back to the main list.
      delete item.starred;
      delete item.sellTo;
    } else item.starred = true;
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

$('#store-lists').addEventListener('click', (e) => {
  const b = e.target.closest('[data-print]');
  if (b) printStoreList(b.dataset.print);
});

$('#move-to').addEventListener('change', (e) => { state.moveTo = e.target.value; });

// Move the main list's starred cards into the chosen store's list.
$('#move-btn').addEventListener('click', () => {
  const store = $('#move-to').value;
  if (!state.stores.some((s) => s.id === store)) return;
  for (const item of currentList()) {
    if (item.starred && !sellToOf(item)) item.sellTo = store;
  }
  state.moveTo = store;
  saveList();
  renderList();
});

// Store headers in either table toggle that store for the current view; both tables re-render.
document.addEventListener('click', (e) => {
  const b = e.target.closest('.store-toggle');
  if (!b) return;
  const excluded = state.excluded[state.view];
  if (excluded.has(b.dataset.store)) excluded.delete(b.dataset.store);
  else excluded.add(b.dataset.store);
  saveExcluded();
  renderList();
  if (state.results.length) renderResults();
});

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
  loadExcluded();
  applyView();
  setInterval(renderUpdated, 60000);
  $('#search-input').focus();
})();
