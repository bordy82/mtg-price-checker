const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const stores = require('./stores');
const { mergeOffers } = require('./lib/match');
const { frontName } = require('./lib/normalize');
const { getJson } = require('./lib/http');

const PORT = process.env.PORT || 3000;
// DATA_DIR lets a test server work on copies of the lists (see `npm run start:test`).
const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const LIST_FILES = {
  sell: path.join(DATA_DIR, 'list.json'),
  buy: path.join(DATA_DIR, 'wishlist.json'),
};
const modeOf = (req) => (req.query.mode === 'buy' ? 'buy' : 'sell');
const CACHE_TTL_MS = 10 * 60 * 1000;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- search (all stores in parallel, cached per mode + card name) ----

const cache = new Map(); // "mode|query" -> { at, printings, errors }

async function searchAll(fullQuery, { mode = 'sell', force = false } = {}) {
  const query = frontName(fullQuery);
  const cacheKey = `${mode}|${query.trim().toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const errors = {};
  const results = await Promise.all(
    stores.map((s) =>
      (mode === 'buy' ? s.searchRetail(query) : s.search(query)).catch((err) => {
        console.error(`[${s.id}] ${err.message}`);
        errors[s.id] = err.message;
        return [];
      })
    )
  );
  const entry = { at: Date.now(), printings: mergeOffers(results.flat(), query, mode), errors };
  // Don't keep a result with a failed store, so the next search tries it again.
  if (!Object.keys(errors).length) cache.set(cacheKey, entry);
  return entry;
}

app.get('/api/stores', (req, res) => {
  res.json(stores.map(({ id, label, creditNote, links }) => ({ id, label, creditNote, links })));
});

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Type at least 2 characters' });
  const { printings, errors, at } = await searchAll(q, { mode: modeOf(req) });
  res.json({ query: q, printings, errors, fetchedAt: at });
});

// ---- card name suggestions while typing (#52): Scryfall's autocomplete, through the server ----
// Scryfall's API guidelines ask for the app's own User-Agent, an Accept header (getJson sends it) and 50–100 ms
// between requests. The page waits for a pause in typing, so this stays far below that; answers are cached too.

const SCRYFALL = 'https://api.scryfall.com';
const SCRYFALL_UA = `mtg-price-checker/${require('./package.json').version}`;
const SCRYFALL_GAP_MS = 100;
const SUGGEST_TTL_MS = 24 * 60 * 60 * 1000; // card names only change when a set comes out
const SUGGEST_MAX = 1000; // cached answers; the oldest goes first
const suggestCache = new Map(); // lowercased text -> { at, names }
let scryfallNext = 0; // when the next Scryfall request may start

async function suggestNames(text) {
  const key = text.toLowerCase();
  const hit = suggestCache.get(key);
  if (hit && Date.now() - hit.at < SUGGEST_TTL_MS) return hit.names;
  const wait = scryfallNext - Date.now();
  scryfallNext = Math.max(Date.now(), scryfallNext) + SCRYFALL_GAP_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  // No retry and a short timeout: by then the user has typed on or searched.
  const { data } = await getJson(`${SCRYFALL}/cards/autocomplete?q=${encodeURIComponent(text)}`,
    { userAgent: SCRYFALL_UA, timeoutMs: 5000, retries: 0 });
  const names = Array.isArray(data) ? data : [];
  suggestCache.delete(key);
  suggestCache.set(key, { at: Date.now(), names });
  if (suggestCache.size > SUGGEST_MAX) suggestCache.delete(suggestCache.keys().next().value);
  return names;
}

app.get('/api/suggest', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ names: [] });
  try {
    res.json({ names: await suggestNames(q) });
  } catch (err) {
    // No suggestions, no error: searching works without them.
    console.error(`[scryfall] ${err.message}`);
    res.json({ names: [] });
  }
});

// ---- saved lists (sell: cards to sell, buy: wishlist) ----

async function readList(mode) {
  try {
    return JSON.parse(await fs.readFile(LIST_FILES[mode], 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// One write at a time per list (#40). Overlapping saves used to share one temp file: the first rename moved it
// away and the second failed. A task runs after the previous one settles, whether it succeeded or not.
const writeQueues = { sell: Promise.resolve(), buy: Promise.resolve() };
function queued(mode, task) {
  const run = writeQueues[mode].then(task, task);
  writeQueues[mode] = run.catch(() => {});
  return run;
}

let tmpCount = 0;
async function writeList(mode, list) {
  const file = LIST_FILES[mode];
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++tmpCount}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(list, null, 2));
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

app.get('/api/list', async (req, res) => {
  res.json(await readList(modeOf(req)));
});

app.put('/api/list', async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected an array' });
  const mode = modeOf(req);
  await queued(mode, () => writeList(mode, req.body));
  res.json({ ok: true });
});

// Re-fetch prices for every card in the saved list, or only for `keys` (one wishlist list, #33; the page's
// small batches, #44).
app.post('/api/refresh', async (req, res) => {
  const mode = modeOf(req);
  const only = Array.isArray(req.body?.keys) ? new Set(req.body.keys) : null;
  const picked = (item) => !only || only.has(item.key);
  // Search by front name: stores spell the rest of two-name cards differently.
  const names = [...new Set((await readList(mode)).filter(picked).map((item) => frontName(item.name)))];
  const errors = {}; // every store that failed for some name, for the page's message
  const byName = new Map(); // front name -> { printings, errors }
  for (const name of names) {
    const result = await searchAll(name, { mode, force: true });
    byName.set(name, result);
    Object.assign(errors, result.errors);
  }

  // The searches take a while and the page keeps saving meanwhile (star, move, remove…), so re-read the list
  // and only update the prices of the refreshed cards; everything else stays as it is on disk now.
  // Cards added since (their name wasn't searched) are left alone. The re-read and the write run in the write
  // queue (#40), so a save can't land between them and be lost.
  const list = await queued(mode, async () => {
    const current = await readList(mode);
    const now = Date.now();
    for (const item of current) {
      if (!picked(item) || !byName.has(frontName(item.name))) continue;
      const result = byName.get(frontName(item.name));
      const match = result.printings.find((p) => p.keys.includes(item.key));
      const fresh = match ? { ...match.prices } : {};
      // Keep the last known prices of stores that couldn't be reached for this card's search (#44): a store
      // that failed for another card answered for this one, so its answer (even "not buying") stands.
      for (const id of Object.keys(result.errors)) {
        if (item.prices?.[id]) fresh[id] = item.prices[id];
      }
      // The page shows what changed at this refresh (#51), so a refresh with no change clears the arrows.
      item.prevPrices = item.prices;
      item.prevUpdatedAt = item.updatedAt;
      item.prices = fresh;
      item.updatedAt = now;
    }
    await writeList(mode, current);
    return current;
  });
  res.json({ list, errors });
});

// The page expects JSON errors (Express's default handler sends HTML).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, (err) => {
  if (err) {
    console.error(
      err.code === 'EADDRINUSE'
        ? `Port ${PORT} is already in use — the app is probably already running at http://localhost:${PORT}`
        : err.message
    );
    process.exit(1);
  }
  const data = DATA_DIR === DEFAULT_DATA_DIR ? '' : ` (data: ${path.relative(process.cwd(), DATA_DIR) || DATA_DIR}/)`;
  console.log(`MTG Price Checker running at http://localhost:${PORT}${data}`);
});
