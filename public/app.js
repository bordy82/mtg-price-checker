const state = {
  stores: [],
  view: 'sell', // 'sell' = buylist offers + cards to sell, 'buy' = retail prices + wishlist
  sellValue: 'credit', // in sell view, which value decides the "best" store
  results: [],
  filters: { finish: 'all', treatments: new Set() },
  lists: { sell: [], buy: [] },
  excluded: { sell: new Set(), buy: new Set() }, // stores left out of the comparison, per view
  moveTo: { sell: null, buy: null }, // sub-list picked in "Move starred cards to", per view ('' = new wishlist list)
  refreshing: new Map(), // price refreshes running: `${view}:${sub-list id}` ('' = the whole list) -> { done, total }
  search: { seq: 0, abort: null }, // the latest search (#37): only its response may render
  removed: null, // the last removed card, for Undo (#43): { view, item, index, timer }
};

const $ = (sel) => document.querySelector(sel);
// "Face to Face, Collect-Edition, 401 Games, and Game Keeper"
const listText = (items) => new Intl.ListFormat('en', { type: 'conjunction' }).format(items);
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
    backText: null, // a store starting to buy a card shows no change (#51)
    totalLabel: () => `Total ${state.sellValue} if everything goes to…`,
    missingLabel: (n) => `${n} not bought`,
    starTitle: 'Star: actually selling this',
    storeListTitle: (store) => `Selling to ${store}`,
    // Sub-lists (#17): one "Selling to <store>" list per store, by `sellTo`. An unknown store id counts as the main list.
    groupOf: (item) => (state.stores.some((s) => s.id === item.sellTo) ? item.sellTo : null),
    setGroup: (item, id) => { item.sellTo = id; },
    groups: () => state.stores.map((s) => ({ id: s.id, label: s.label, title: MODES.sell.storeListTitle(s.label), chosen: s.id, qty: true, print: true, clear: true })),
    print: (storeId) => printStoreList(storeId),
    printMain: false,
    moveTarget: 'Store',
    newGroup: false,
  },
  buy: {
    subtitle: 'cheapest price per card',
    listTitle: 'My wishlist',
    emptyText: 'Search for a card above and click <b>Add</b> on the version you want.',
    value: (p) => p?.price,
    eligible: (p) => p?.price > 0 && p.stock > 0,
    better: (a, b) => a < b,
    alt: (p) => (p.stock > 0 ? `${p.stock} in stock` : 'out of stock'),
    backText: 'back in stock', // a card that wasn't available at the last refresh and is now (#51)
    totalLabel: () => 'Total cost if bought at…',
    missingLabel: (n) => `${n} unavailable`,
    starTitle: 'Star: actually buying this',
    // Sub-lists (#27): wishlist lists the user names ("Check Lands"), by `group`, alphabetically.
    // A list exists while it has cards.
    groupOf: (item) => (typeof item.group === 'string' && item.group.trim() ? item.group : null),
    setGroup: (item, name) => { item.group = name; },
    groups: () => [...new Set(state.lists.buy.map((item) => MODES.buy.groupOf(item)).filter(Boolean))].sort(byText)
      .map((name) => ({ id: name, label: name, title: name, refresh: true, print: true })),
    // Each wishlist list prints on its own (#55), and so does the main wishlist (`null`: cards not in a list).
    print: (name) => printWishlist(name),
    printMain: true,
    moveTarget: 'List',
    newGroup: true,
  },
};
const cfg = () => MODES[state.view];
const currentList = () => state.lists[state.view];
const isIncluded = (storeId) => !state.excluded[state.view].has(storeId);
// Unticked stores keep their column, dimmed.
const colClass = (storeId, chosen) =>
  `num${isIncluded(storeId) ? '' : ' excluded'}${storeId === chosen ? ' chosen' : ''}`;
// Copies of a card in a "Selling to <store>" list (#24). Missing means 1.
const qtyOf = (item) => Math.max(1, Math.floor(item.qty) || 1);
// "19 cards", or "19 cards · 23 copies" once some card has more than one copy.
function countText(items) {
  const copies = items.reduce((n, item) => n + qtyOf(item), 0);
  const cards = `${items.length} card${items.length === 1 ? '' : 's'}`;
  return copies === items.length ? cards : `${cards} · ${copies} copies`;
}

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

// Front face name, what the server searches stores with: stores write two-name cards differently
// (`A // B` vs `A - B`), so only the front name works everywhere. Keep in sync with frontName() in lib/normalize.js.
const frontName = (name) => String(name || '').split(/ \/\/ | - /)[0].trim();

// The card name, as a button that copies its front name (#25).
function nameButton(name) {
  const front = frontName(name);
  return `<button type="button" class="copy-name" data-copy="${esc(front)}" title="${esc(`Click to copy "${front}"`)}">${esc(name)}</button>`;
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

// Where a price links (#45): that offer's page at the store, or, for cards saved before links existed (no `url`
// until their next refresh), the store's search for the front name in the current mode.
// `{q}` / `{qq}` (encoded twice) as in searchLink() in lib/normalize.js.
function storeLink(store, p, name) {
  if (p?.url) return p.url;
  const template = store?.links?.[state.view];
  if (!template) return null;
  const q = encodeURIComponent(frontName(name));
  return template.replace('{qq}', encodeURIComponent(q)).replace('{q}', q);
}

// How a list item's price at one store changed at its last refresh (#51): `{ text, better, title }`, or null.
// /api/refresh keeps the prices it replaced in `prevPrices`; search results and cards not refreshed since being
// added have none. Selling compares the value the switch shows, buying the price.
const shortDate = (ts) => new Date(ts).toLocaleDateString('en', { month: 'short', day: 'numeric' });

function priceChange(card, storeId) {
  if (!card.prevPrices) return null;
  const { value, eligible, better, backText } = cfg();
  const p = card.prices?.[storeId];
  const was = card.prevPrices[storeId];
  const when = card.prevUpdatedAt ? ` (${shortDate(card.prevUpdatedAt)})` : '';
  if (backText && eligible(p) && !eligible(was)) return { text: backText, better: true, title: `Was out of stock${when}` };
  const [now, before] = [value(p), value(was)];
  if (!(now > 0 && before > 0) || Math.abs(now - before) < 0.005) return null;
  return { text: `${now > before ? '▲' : '▼'} ${money(Math.abs(now - before))}`, better: better(now, before), title: `Was ${money(before)}${when}` };
}

// "4 prices changed" at the last refresh of these cards, or ''.
function changedText(items) {
  const n = items.reduce((sum, item) => sum + state.stores.filter((s) => priceChange(item, s.id)).length, 0);
  return n ? `${n} price${n === 1 ? '' : 's'} changed` : '';
}

// One store's price for a card (a search result row or a list item: `prices` and `name`), linking to the card there.
// Under it, how it changed at the last refresh (list items only, see priceChange): green when better for the user.
function priceCell(card, storeId, best, chosen) {
  const { value, eligible, alt } = cfg();
  const p = card.prices?.[storeId];
  const v = value(p);
  if (!v) return `<td class="${colClass(storeId, chosen)}"><span class="price none">—</span></td>`;
  const cls = storeId === best ? 'best' : eligible(p) ? '' : 'oos';
  const change = priceChange(card, storeId);
  const price = `<span class="price ${cls}"><span class="main">${money(v)}</span><span class="alt">${esc(alt(p))}</span></span>` +
    (change ? `<span class="change ${change.better ? 'better' : 'worse'}" title="${esc(change.title)}">${esc(change.text)}</span>` : '');
  const store = state.stores.find((s) => s.id === storeId);
  const href = storeLink(store, p, card.name);
  if (!href) return `<td class="${colClass(storeId, chosen)}">${price}</td>`;
  return `<td class="${colClass(storeId, chosen)}"><a class="price-link" href="${esc(href)}" target="_blank" rel="noopener"
    title="${esc(`Open at ${store.label}`)}">${price}</a></td>`;
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

// Searches take 2–7 s uncached and are instant from the cache, so an older one can finish after a newer one (#37).
// Each search (and clearResults) cancels the previous one; a response renders only if it's still the latest.
function startSearch() {
  state.search.abort?.abort();
  const controller = new AbortController();
  const seq = ++state.search.seq;
  state.search.abort = controller;
  return { signal: controller.signal, isLatest: () => seq === state.search.seq };
}

async function search(q) {
  const status = $('#search-status');
  status.className = 'status';
  status.textContent = `Searching ${listText(state.stores.map((s) => s.label))}…`;
  $('#results').hidden = true;
  $('#filters').hidden = true;
  const { signal, isLatest } = startSearch();
  try {
    const data = await api(`/api/search?mode=${state.view}&q=${encodeURIComponent(q)}`, { signal });
    if (!isLatest()) return; // a newer search (or a tab switch) replaced this one
    state.query = q;
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
    if (!isLatest()) return; // aborted or outdated: no stale error message
    status.className = 'status error';
    status.textContent = err.message;
  }
}

function clearResults() {
  startSearch(); // a search still running can't render afterwards
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
  // Nothing found at all: say so, rather than an empty table that blames the filters (#39).
  if (!total) {
    const where = state.failedNote ? 'at the stores that answered' : 'at any store';
    $('#search-status').textContent = `No card named "${state.query}" ${where}.${state.failedNote || ''}`;
    table.hidden = true;
    return;
  }
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
          <td><div class="card-name">${nameButton(p.name)}</div>${printingLine(p)}</td>
          <td>${printingTags(p) || '<span class="muted">Normal</span>'}</td>
          ${state.stores.map((s) => priceCell(p, s.id, best)).join('')}
          <td class="add-cell">
            ${inList ? '<span class="added">✓ In list</span>' : `<button class="small" data-add="${esc(p.key)}">Add</button>`}
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="${4 + state.stores.length}" class="muted empty">No printing matches these filters.</td></tr>`;
  table.hidden = false;
}

// ---- saved lists ----

// Saving (#40): one PUT per list at a time. Changes made while one is in flight are sent together right after it
// (the list as it is then), so saves never overlap or reach the server out of order. When a save fails, the list
// panel says so, with Retry; the next change retries too.
const saving = { sell: { running: false, again: false, error: null }, buy: { running: false, again: false, error: null } };

function saveList(view = state.view) {
  const s = saving[view];
  if (s.running) { s.again = true; return; }
  s.running = true;
  (async () => {
    try {
      do {
        s.again = false;
        await api(`/api/list?mode=${view}`, { method: 'PUT', body: JSON.stringify(state.lists[view]) });
      } while (s.again);
      s.error = null;
    } catch (err) {
      // fetch() itself fails (TypeError) when the server is down.
      s.error = err instanceof TypeError ? "the server isn't reachable" : err.message;
    } finally {
      s.running = false;
      renderSaveError();
    }
  })();
}

function renderSaveError() {
  const { error } = saving[state.view];
  $('#save-error').hidden = !error;
  $('#save-error-text').textContent = error ? `Couldn't save: ${error}. Your last change isn't stored.` : '';
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

// Sub-list a card was moved to ("Selling to <store>" or a wishlist list), or null if it's in the main list.
const groupOf = (item) => cfg().groupOf(item);

function renderList() {
  const c = cfg();
  const list = currentList();
  const main = list.filter((item) => !groupOf(item));
  const table = $('#list');
  $('#list-title').textContent = c.listTitle;
  $('#list-empty').innerHTML = c.emptyText;
  $('#list-empty').hidden = list.length > 0;
  table.hidden = !main.length;
  const refreshing = state.refreshing.get(`${state.view}:`);
  $('#refresh').disabled = !list.length || Boolean(refreshing);
  $('#refresh').textContent = refreshing ? refreshingText(refreshing) : 'Refresh prices';
  $('#print-list').hidden = !c.printMain || !main.length;
  $('#list-count').textContent = main.length ? `${main.length} card${main.length === 1 ? '' : 's'}` : '';
  renderUpdated();
  renderSaveError();
  renderMoveBar(main);
  renderSubLists(list);
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
// `qty` adds a quantity stepper inside the Card cell (store lists only); totals then count every copy,
// while the price cells (and the green "best") stay per copy.
function listTable(items, { subtotal = false, chosen = null, qty = false } = {}) {
  const c = cfg();
  const rows = [...items].sort(compareListItems);
  const html = rows.map((item) => {
    const best = bestStore(item.prices);
    const key = esc(item.key);
    return `<tr>
      <td><button class="icon star${item.starred ? ' on' : ''}" data-star="${key}" title="${esc(c.starTitle)}" aria-pressed="${Boolean(item.starred)}">${item.starred ? '★' : '☆'}</button></td>
      ${thumb(item.image)}
      <td><div class="card-name">${nameButton(item.name)} ${printingTags(item)}</div>${qty ? qtyStepper(item) : ''}${printingLine(item)}</td>
      ${state.stores.map((s) => priceCell(item, s.id, best, chosen)).join('')}
      <td class="num"><button class="icon" data-remove="${key}" title="Remove">✕</button></td>
    </tr>`;
  });

  // Subtotal of the starred cards, under the last one. Only when it differs from the full total.
  const starred = rows.filter((item) => item.starred);
  if (subtotal && starred.length && starred.length < rows.length) {
    const label = c.totalLabel();
    html.splice(starred.length, 0,
      totalRows(`Starred: ${label[0].toLowerCase()}${label.slice(1)}`, listTotals(starred, { perCopy: qty }), 'starred'));
  }
  return {
    thead: `<tr><th></th><th></th><th>Card</th>${storeHeaders(chosen)}<th></th></tr>`,
    tbody: html.join(''),
    tfoot: totalRows(c.totalLabel(), listTotals(items, { perCopy: qty }), '', chosen),
  };
}

// Quantity, at the right of the card's set line (#29): one copy shows only a faint +; two or more show − 2× +.
// − at 2 goes back to just +, so it never removes a card (that stays the ✕'s job).
function qtyStepper(item) {
  const key = esc(item.key);
  const n = qtyOf(item);
  const plus = `<button class="icon" data-qty="${key}" data-step="1" title="One more copy">+</button>`;
  if (n <= 1) return `<span class="stepper">${plus}</span>`;
  return `<span class="stepper multi">
    <button class="icon" data-qty="${key}" data-step="-1" title="One copy fewer">−</button>
    <span class="qty-n">${n}×</span>${plus}
  </span>`;
}

// "Move starred cards to [sub-list]": shown when the main list has starred cards.
// Selling offers the stores; Buying offers the wishlist lists, then "New list…" (value '') with a name field.
function renderMoveBar(main) {
  const c = cfg();
  const bar = $('#move-bar');
  const count = main.filter((item) => item.starred).length;
  bar.hidden = !count;
  if (bar.hidden) return;
  const options = c.groups().map((g) => ({ value: g.id, label: g.label }));
  if (c.newGroup) options.push({ value: '', label: 'New list…' });
  const picked = state.moveTo[state.view];
  if (!options.some((o) => o.value === picked)) state.moveTo[state.view] = options[0]?.value ?? '';
  $('#move-label').textContent = `Move ${count} starred card${count === 1 ? '' : 's'} to`;
  $('#move-to').setAttribute('aria-label', c.moveTarget);
  $('#move-to').innerHTML = options
    .map((o) => `<option value="${esc(o.value)}"${o.value === state.moveTo[state.view] ? ' selected' : ''}>${esc(o.label)}</option>`)
    .join('');
  renderMoveName();
}

// The new list's name field shows only while "New list…" is picked; Move needs a name.
function renderMoveName() {
  const naming = cfg().newGroup && state.moveTo[state.view] === '';
  $('#move-name').hidden = !naming;
  $('#move-btn').disabled = naming && !$('#move-name').value.trim();
}

// One section per sub-list that has cards: "Selling to <store>" in store order, or wishlist lists by name.
function renderSubLists(list) {
  $('#sub-lists').innerHTML = cfg().groups().map((g) => {
    const items = list.filter((item) => groupOf(item) === g.id);
    if (!items.length) return '';
    const { thead, tbody, tfoot } = listTable(items, { chosen: g.chosen, qty: g.qty });
    const refreshing = state.refreshing.get(`${state.view}:${g.id}`);
    // Wishlist lists (#33) refresh on their own and show their own prices' age.
    const refresh = g.refresh
      ? `<span class="muted" data-age="${esc(g.id)}">${esc(pricesInfo(items))}</span>
        <button class="ghost small" data-refresh="${esc(g.id)}"${refreshing ? ' disabled' : ''}>${refreshing ? refreshingText(refreshing) : 'Refresh'}</button>`
      : '';
    return `<section class="sub-list">
      <div class="sub-list-head">
        <h3>${esc(g.title)} <span class="pill">${esc(countText(items))}</span></h3>
        <div class="panel-actions">
          ${refresh}
          ${g.print ? `<button class="ghost small" data-print="${esc(g.id)}">Print</button>` : ''}
          ${g.clear ? `<button class="ghost small danger-hover" data-clear="${esc(g.id)}">Clear list</button>` : ''}
        </div>
      </div>
      <div class="table-wrap"><table class="grid"><thead>${thead}</thead><tbody>${tbody}</tbody><tfoot>${tfoot}</tfoot></table></div>
    </section>`;
  }).join('');
}

// Per-store totals for some cards: everything at one store (eligible offers only).
// `perCopy` multiplies by each card's quantity, for prices and for the missing count (store lists).
function listTotals(items, { perCopy = false } = {}) {
  const { eligible, value } = cfg();
  const perStore = {};
  const missing = {};
  for (const s of state.stores) { perStore[s.id] = 0; missing[s.id] = 0; }
  for (const item of items) {
    const n = perCopy ? qtyOf(item) : 1;
    for (const s of state.stores) {
      const p = item.prices?.[s.id];
      if (eligible(p)) perStore[s.id] += value(p) * n;
      else missing[s.id] += n;
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

// "Prices from 3 h ago · 4 prices changed"
const pricesInfo = (items) => [pricesAge(items), changedText(items)].filter(Boolean).join(' · ');

function renderUpdated() {
  $('#updated').textContent = pricesInfo(currentList());
  for (const el of document.querySelectorAll('[data-age]')) {
    el.textContent = pricesInfo(currentList().filter((item) => groupOf(item) === el.dataset.age));
  }
}

// ---- printing: only #print-sheet is printed (see @media print) ----

// Card cell of a printed sheet: name, then set · code #number, finish and version tags (plain text).
function printCardCell(item) {
  const finish = item.finish === 'nonfoil' ? '' : item.finish.replace(/\b\w/g, (ch) => ch.toUpperCase());
  const meta = [`${item.setName || item.setCode} · ${String(item.setCode).toUpperCase()} #${item.collectorNumber}`,
    finish, ...item.treatments].filter(Boolean).join(' · ');
  return `<td><div class="ps-name">${esc(item.name)}</div><div class="ps-meta">${esc(meta)}</div></td>`;
}

// Title, "date · prices' age · count" line, then the table; cleared again on afterprint.
function printSheet(title, items, table) {
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const info = [date, pricesAge(items), countText(items)].filter(Boolean).join(' · ');
  $('#print-sheet').innerHTML = `<h2>${esc(title)}</h2><p class="ps-info">${esc(info)}</p>${table}`;
  window.print();
}

// A wishlist list (#55), or the main wishlist (`name` null: the cards not moved into a list).
// Not tied to a store, so it compares them like the screen: every store still in the comparison, price and stock,
// the cheapest in-stock one bold with a ★ (readable in black and white), per-store totals and "N unavailable".
function printWishlist(name) {
  const items = currentList().filter((item) => groupOf(item) === name).sort(compareListItems);
  if (!items.length) return;
  const { alt, missingLabel, totalLabel } = cfg();
  const stores = state.stores.filter((s) => isIncluded(s.id));

  const rows = items.map((item) => {
    const best = bestStore(item.prices);
    const cells = stores.map((s) => {
      const p = item.prices?.[s.id];
      if (!(p?.price > 0)) return '<td class="num ps-oos">—</td>';
      const cls = s.id === best ? 'ps-best' : p.stock > 0 ? '' : 'ps-oos';
      return `<td class="num ${cls}">${s.id === best ? '★ ' : ''}${money(p.price)}<div class="ps-each">${esc(alt(p))}</div></td>`;
    });
    return `<tr>${printCardCell(item)}${cells.join('')}</tr>`;
  });

  const { perStore, missing } = listTotals(items);
  const anyMissing = stores.some((s) => missing[s.id]);
  printSheet(name ?? cfg().listTitle, items, `
    <table>
      <thead><tr><th>Card</th>${stores.map((s) => `<th class="num">${esc(s.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>
      <tfoot>
        <tr><td>${esc(totalLabel())}</td>${stores.map((s) => `<td class="num">${money(perStore[s.id])}</td>`).join('')}</tr>
        ${anyMissing ? `<tr class="ps-note"><td></td>${stores.map((s) => `<td class="num">${missing[s.id] ? esc(missingLabel(missing[s.id])) : ''}</td>`).join('')}</tr>` : ''}
      </tfoot>
    </table>`);
}

// A "Selling to <store>" list: that store's credit and cash only, whatever the switch says.
function printStoreList(storeId) {
  const store = state.stores.find((s) => s.id === storeId);
  const items = currentList().filter((item) => groupOf(item) === storeId).sort(compareListItems);
  if (!store || !items.length) return;

  let credit = 0;
  let cash = 0;
  let notBought = 0;
  const rows = items.map((item) => {
    const p = item.prices?.[storeId];
    const n = qtyOf(item);
    const buys = p?.credit > 0 || p?.cash > 0;
    if (buys) { credit += (p.credit || 0) * n; cash += (p.cash || 0) * n; } else notBought += n;
    // Line total (qty × unit), with the unit price under it when there's more than one copy.
    const line = (unit) => (buys && unit ? `${money(unit * n)}${n > 1 ? `<div class="ps-each">${money(unit)} each</div>` : ''}` : '—');
    return `<tr>
      ${printCardCell(item)}
      <td class="num">${n}</td>
      <td class="num">${line(p?.credit)}</td>
      <td class="num">${line(p?.cash)}</td>
    </tr>`;
  }).join('');

  printSheet(cfg().storeListTitle(store.label), items, `
    <table>
      <thead><tr><th>Card</th><th class="num">Qty</th><th class="num">Credit</th><th class="num">Cash</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td>Total</td><td></td><td class="num">${money(credit)}</td><td class="num">${money(cash)}</td></tr>
        ${notBought ? `<tr class="ps-note"><td colspan="4">${notBought} not bought by ${esc(store.label)}</td></tr>` : ''}
      </tfoot>
    </table>`);
}

window.addEventListener('afterprint', () => { $('#print-sheet').innerHTML = ''; });

// Refresh the whole list, or one sub-list's cards (`groupId`, a wishlist list, #33).
// One request per card name, at most REFRESH_PARALLEL at a time, with "Refreshing N / M…" on the button (#44).
// Searching every name in one request, one after another, took ~3 s per name: about 3 minutes for 55 names.
const REFRESH_PARALLEL = 3;
const refreshingText = ({ done, total }) => `Refreshing ${done} / ${total}…`;

async function refreshPrices(groupId = '') {
  const view = state.view;
  const running = `${view}:${groupId}`;
  if (state.refreshing.has(running)) return;
  const items = groupId ? state.lists[view].filter((item) => groupOf(item) === groupId) : state.lists[view];
  // One batch per front name: what the server searches stores with.
  const keysByName = new Map();
  for (const item of items) {
    const name = frontName(item.name);
    keysByName.set(name, [...(keysByName.get(name) || []), item.key]);
  }
  const batches = [...keysByName.values()];
  const progress = { done: 0, total: batches.length };
  state.refreshing.set(running, progress);
  renderList();

  const failedStores = new Set();
  let error = null;
  async function refreshBatch(keys) {
    const { list, errors } = await api(`/api/refresh?mode=${view}`, { method: 'POST', body: JSON.stringify({ keys }) });
    // Take only this batch's new prices: anything changed on the page meanwhile (star, move, remove, add) stays,
    // and a response arriving late can't put back another batch's older prices.
    const wanted = new Set(keys);
    const fresh = new Map(list.filter((item) => wanted.has(item.key)).map((item) => [item.key, item]));
    for (const item of state.lists[view]) {
      const f = fresh.get(item.key);
      if (f) {
        const { prices, updatedAt, prevPrices, prevUpdatedAt } = f;
        Object.assign(item, { prices, updatedAt, prevPrices, prevUpdatedAt });
      }
    }
    Object.keys(errors || {}).forEach((id) => failedStores.add(id));
  }
  let next = 0;
  async function worker() {
    // Stop at the first failed request: it's the server (stores failing is reported in `errors`, not thrown).
    while (next < batches.length && !error) {
      const keys = batches[next++];
      try { await refreshBatch(keys); } catch (err) { error = err; }
      progress.done++;
      if (view === state.view) renderList();
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(REFRESH_PARALLEL, batches.length) }, worker));
    // A save sent while the server was writing could have put old prices back on disk; this fixes that.
    saveList(view);
    if (error) alert(`Refresh stopped after ${progress.done} of ${progress.total} cards: ${error.message}`);
    else if (failedStores.size) {
      const names = [...failedStores].map((id) => state.stores.find((s) => s.id === id)?.label || id);
      alert(`Couldn't reach: ${names.join(', ')}. Their last known prices are kept for the cards they didn't answer for.`);
    }
  } finally {
    state.refreshing.delete(running);
    if (view === state.view) renderList();
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
  dropUndo();
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

// ---- copy a card name (#25) ----

// The Clipboard API needs a secure context: http://localhost is one, but the page opened from a phone
// through the machine's LAN address isn't, so fall back to selecting a hidden textarea. Returns whether it copied.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const focused = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position: fixed; top: 0; left: 0; opacity: 0;';
  document.body.append(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  area.remove();
  focused?.focus();
  return ok;
}

// "Copied" right after the clicked name for 1.5 s, then it fades out (#32). Clicking again restarts it.
// A re-render (star, qty, remove…) drops it early; that's fine.
const copiedLabels = new WeakMap(); // name button -> { label, timer }

function showCopied(button, ok) {
  let shown = copiedLabels.get(button);
  if (shown) clearTimeout(shown.timer);
  else {
    shown = { label: document.createElement('span') };
    shown.label.className = 'copied';
    shown.label.setAttribute('role', 'status');
    button.after(shown.label);
    copiedLabels.set(button, shown);
  }
  shown.label.textContent = ok ? '✓ Copied' : "Couldn't copy";
  shown.label.classList.remove('fading');
  shown.timer = setTimeout(() => {
    shown.label.classList.add('fading');
    shown.timer = setTimeout(() => {
      shown.label.remove();
      copiedLabels.delete(button);
    }, 300);
  }, 1500);
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('.copy-name');
  if (b) showCopied(b, await copyText(b.dataset.copy));
});

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

// Star / quantity / remove in the main list and in every sub-list. Rows are found by key: starred cards are
// shown first, and cards are split across lists, so row order differs from the saved order.
$('#list-panel').addEventListener('click', (e) => {
  const list = currentList();
  const star = e.target.closest('[data-star]');
  if (star) {
    const item = list.find((i) => i.key === star.dataset.star);
    if (!item) return;
    if (item.starred) {
      // Unstarring a card in a sub-list also sends it back to the main list, with no quantity.
      delete item.starred;
      delete item.sellTo;
      delete item.group;
      delete item.qty;
    } else item.starred = true;
    saveList();
    renderList();
    return;
  }
  const step = e.target.closest('[data-qty]');
  if (step) {
    const item = list.find((i) => i.key === step.dataset.qty);
    if (!item) return;
    item.qty = Math.max(1, qtyOf(item) + Number(step.dataset.step));
    saveList();
    renderList();
    return;
  }
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  const idx = list.findIndex((i) => i.key === b.dataset.remove);
  if (idx === -1) return;
  const [item] = list.splice(idx, 1);
  showUndo(item, idx);
  saveList();
  renderList();
  if (state.results.length) renderResults();
});

// ---- undo a removal (#43) ----
// One level: the last removed card, for 8 s or until the next removal or a tab switch. Undo puts back the same
// object, so its star, sub-list (sellTo / group), quantity and prices come back with it.

const UNDO_MS = 8000;

function showUndo(item, index) {
  clearTimeout(state.removed?.timer);
  const timer = setTimeout(dropUndo, UNDO_MS);
  state.removed = { view: state.view, item, index, timer };
  renderUndo();
}

function dropUndo() {
  clearTimeout(state.removed?.timer);
  state.removed = null;
  renderUndo();
}

function renderUndo() {
  const r = state.removed;
  const shown = Boolean(r && r.view === state.view);
  $('#undo-bar').hidden = !shown;
  $('#undo-text').textContent = shown ? `Removed ${r.item.name}` : '';
}

function undoRemove() {
  const r = state.removed;
  if (!r) return;
  dropUndo();
  const list = state.lists[r.view];
  // Added again from the search results meanwhile: keep that one.
  if (!list.some((i) => i.key === r.item.key)) list.splice(Math.min(r.index, list.length), 0, r.item);
  saveList(r.view);
  renderList();
  if (state.results.length) renderResults();
}

$('#undo-btn').addEventListener('click', undoRemove);

// ---- confirmation window ----
// Resolves true only when the confirm button is clicked. Cancel has the focus, so Enter or Esc right after it
// opens cancels. The buttons say what they do ("Clear 20 cards"), which window.confirm() can't.
function confirmDialog({ title, text, confirm }) {
  const dialog = $('#confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = confirm;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

// ---- clear a "Selling to <store>" list (#63) ----
// Once the list has been entered on the store's own buylist, its cards are sold: they leave the sell list for good.
// (Unstarring would send them back to the main list instead.) No undo; the confirmation is the safeguard.
async function clearStoreList(storeId) {
  const store = state.stores.find((s) => s.id === storeId);
  const items = state.lists.sell.filter((item) => groupOf(item) === storeId);
  if (state.view !== 'sell' || !store || !items.length) return;
  const cards = `${items.length} card${items.length === 1 ? '' : 's'}`;
  const copies = items.reduce((n, item) => n + qtyOf(item), 0);
  const ok = await confirmDialog({
    title: `Clear "${MODES.sell.storeListTitle(store.label)}"?`,
    text: `This removes its ${cards}${copies === items.length ? '' : ` (${copies} copies)`} from your sell list. ` +
      `They won't go back to "${MODES.sell.listTitle}".`,
    confirm: `Clear ${cards}`,
  });
  if (!ok) return;
  state.lists.sell = state.lists.sell.filter((item) => groupOf(item) !== storeId);
  saveList('sell');
  renderList();
  if (state.results.length) renderResults();
}

// The undo bar sticks just under the sticky top bar, whose height changes when it wraps on narrow screens.
const setTopbarHeight = () =>
  document.documentElement.style.setProperty('--topbar-h', `${$('.topbar').offsetHeight}px`);
setTopbarHeight();
window.addEventListener('resize', setTopbarHeight);

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

document.querySelectorAll('[data-value]').forEach((b) =>
  b.addEventListener('click', () => {
    state.sellValue = b.dataset.value;
    document.querySelectorAll('[data-value]').forEach((x) => x.classList.toggle('active', x === b));
    renderList();
    if (state.results.length) renderResults();
  })
);

$('#refresh').addEventListener('click', () => refreshPrices());
$('#print-list').addEventListener('click', () => cfg().print(null));
$('#save-retry').addEventListener('click', () => saveList());

$('#sub-lists').addEventListener('click', (e) => {
  const b = e.target.closest('[data-print]');
  if (b) cfg().print(b.dataset.print);
  const r = e.target.closest('[data-refresh]');
  if (r) refreshPrices(r.dataset.refresh);
  const c = e.target.closest('[data-clear]');
  if (c) clearStoreList(c.dataset.clear);
});

$('#move-to').addEventListener('change', (e) => {
  state.moveTo[state.view] = e.target.value;
  renderMoveName();
  if (e.target.value === '') $('#move-name').focus();
});
$('#move-name').addEventListener('input', renderMoveName);
$('#move-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#move-btn').click(); });

// Move the main list's starred cards into the picked sub-list. A new wishlist list whose name matches
// an existing one (trimmed, any case) adds to that list instead of making a near-duplicate.
$('#move-btn').addEventListener('click', () => {
  const c = cfg();
  let target = $('#move-to').value;
  if (c.newGroup && target === '') {
    const name = $('#move-name').value.trim();
    if (!name) return;
    target = c.groups().find((g) => byText(g.id, name) === 0)?.id ?? name;
  } else if (!c.groups().some((g) => g.id === target)) return;
  for (const item of currentList()) {
    if (item.starred && !groupOf(item)) c.setGroup(item, target);
  }
  state.moveTo[state.view] = target;
  $('#move-name').value = '';
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
