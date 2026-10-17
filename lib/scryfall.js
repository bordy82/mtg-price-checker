// Scryfall, called by the server only: card name suggestions (#52), and the set code and collector number of each
// TCGplayer product, for a store whose buylist only knows TCGplayer's set names (Cartes Sportives Rive-Sud, #80).
// Scryfall's API guidelines ask for the app's own User-Agent, an Accept header (getJson sends it) and 50–100 ms
// between requests, so every request waits its turn here.

const { getJson } = require('./http');

const SCRYFALL = 'https://api.scryfall.com';
const USER_AGENT = `mtg-price-checker/${require('../package.json').version}`;
const GAP_MS = 100;
let next = 0; // when the next request may start

async function scryfallGet(path, options = {}) {
  const wait = next - Date.now();
  next = Math.max(Date.now(), next) + GAP_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return getJson(SCRYFALL + path, { userAgent: USER_AGENT, ...options });
}

// ---- printings by TCGplayer product id ----

const PRINTS_TTL_MS = 24 * 60 * 60 * 1000; // printings only change when a set comes out
const PRINTS_MAX = 500; // cached names; the oldest goes first
const MAX_PAGES = 2; // 175 printings a page: "Sol Ring" has 147, "Island" over 1000
const printsCache = new Map(); // lowercased name -> { at, byTcgplayerId }

// TCGplayer product id -> { setCode, setName, collectorNumber } for every printing whose name contains `name`
// ("Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel" for "Sephiroth, Fabled SOLDIER"). An etched
// printing is its own TCGplayer product (tcgplayer_etched_id). Empty when no card has that name.
async function printsByTcgplayerId(name) {
  const key = String(name).toLowerCase();
  const hit = printsCache.get(key);
  if (hit && Date.now() - hit.at < PRINTS_TTL_MS) return hit.byTcgplayerId;

  const byTcgplayerId = new Map();
  const q = encodeURIComponent(`"${String(name).replace(/"/g, '')}" unique:prints`);
  let path = `/cards/search?q=${q}&include_extras=true`;
  for (let page = 1; path && page <= MAX_PAGES; page++) {
    let res;
    try {
      res = await scryfallGet(path, { timeoutMs: 8000 });
    } catch (err) {
      if (err.status === 404) break; // no card has that name
      throw err;
    }
    for (const card of res.data || []) {
      const printing = { setCode: card.set.toUpperCase(), setName: card.set_name, collectorNumber: card.collector_number };
      for (const id of [card.tcgplayer_id, card.tcgplayer_etched_id]) if (id) byTcgplayerId.set(id, printing);
    }
    path = res.has_more && res.next_page ? res.next_page.replace(SCRYFALL, '') : null;
  }

  printsCache.delete(key);
  printsCache.set(key, { at: Date.now(), byTcgplayerId });
  if (printsCache.size > PRINTS_MAX) printsCache.delete(printsCache.keys().next().value);
  return byTcgplayerId;
}

module.exports = { scryfallGet, printsByTcgplayerId };
