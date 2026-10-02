// Game Keeper Online (Crystal Commerce, server-rendered HTML; no JSON API).
// Buylist (/buylist/search): the price shown is CASH; store credit gets a bonus (see CREDIT_MULTIPLIER).
// Retail (/products/search): same page layout; stock is the max of the quantity selector.
// Listings have no collector number unless the name carries one ("Sol Ring (0408)"),
// so most offers are matched to other stores by name + set + finish + version (see lib/match.js).

const { round2, normCollector, normFinish, normTreatment, normName } = require('../lib/normalize');

const BASE = 'https://www.gamekeeperonline.com';
const CREDIT_MULTIPLIER = 1.3; // Buy/Sell policy (EN): +30% on Magic store credit (the FR page says 50%; confirmed 30%)
const MAX_PAGES = 8;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) mtg-buylist/0.1';

// Game Keeper set names that don't resemble what the other stores call them.
const SET_ALIASES = {
  'Commander Lord of the Rings': 'Tales of Middle-earth Commander',
  'Commander Doctor Who': 'Doctor Who',
  '3rd Edition': 'Revised Edition',
  "Collector's Edition - Domestic": "Collectors' Edition",
  "Collector's Edition - International": "Intl. Collectors' Edition",
};

// Title parts that describe a version; anything else is part of the card name.
const VERSION_WORDS = /borderless|extended|showcase|frame|full art|serial|promo|manga|anime|textured|stamped|the list|theme deck/i;

const decode = (s) =>
  String(s)
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

// "Sol Ring (0408) - Foil - Serialized" -> name "Sol Ring", cn "408", finish "foil", treatments ["Serialized"]
function parseName(title) {
  const [base, ...parts] = title.split(' - ');
  const cnMatch = /\((\d+[a-z]?)\)\s*$/i.exec(base);
  const nameParts = [base.replace(/\s*\(\d+[a-z]?\)\s*$/i, '').trim()];
  let finish = 'nonfoil';
  const treatments = [];
  for (const part of parts) {
    if (/foil|etched/i.test(part)) finish = normFinish(part);
    else if (VERSION_WORDS.test(part)) treatments.push(normTreatment(part));
    else nameParts.push(part); // "Lightning, Lone Commando - Isshin, Two Heavens as One"
  }
  return { name: nameParts.join(' - '), collectorNumber: cnMatch ? normCollector(cnMatch[1]) : '', finish, treatments };
}

const PATHS = { sell: '/buylist/search', buy: '/products/search' };

// Each variant row starts with its label ("NM-Mint, English", "Light Play, English", "Out of stock.")
// and holds a "CAD$ 13.20" price and, when orderable, a quantity selector with max="N".
function parseVariants(block) {
  return block
    .split('variant-short-info">')
    .slice(1)
    .map((chunk) => ({
      label: chunk.slice(0, chunk.indexOf('<')).trim(),
      price: Number(/CAD\$\s*([\d,.]+)/.exec(chunk)?.[1]?.replace(/,/g, '')) || 0,
      max: Number(/max="(\d+)"/.exec(chunk)?.[1]) || 0,
    }));
}

function parseProducts(html) {
  return html
    .split('<li class="product"')
    .slice(1)
    .map((block) => {
      const title = /itemprop="name"[^>]*>([^<]+)</.exec(block)?.[1];
      const setName = /<span class="category">([^<]+)</.exec(block)?.[1];
      const image = /<img src="([^"]+)"/.exec(block)?.[1];
      if (!title) return null;
      const variants = parseVariants(block);
      const nm = variants.find((v) => v.label.startsWith('NM-Mint, English'));
      const soldOut = variants.find((v) => v.label.startsWith('Out of stock'));
      return {
        title: decode(title),
        setName: setName && decode(setName),
        image,
        price: nm?.price || soldOut?.price || 0,
        stock: nm ? nm.max : 0,
      };
    })
    .filter(Boolean);
}

// The site drops connections now and then; retry a couple of times before giving up.
async function fetchHtml(url, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return await res.text();
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function fetchPage(mode, name, page) {
  const url = `${BASE}${PATHS[mode]}?c=1&page=${page}&q=${encodeURIComponent(name)}`;
  const html = await fetchHtml(url);
  return { products: parseProducts(html), hasNext: html.includes(`page=${page + 1}&`) };
}

async function fetchMatching(mode, query) {
  const wanted = normName(query);
  const found = [];
  // Results are relevance-sorted; stop at the first page with no matching card name.
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { products, hasNext } = await fetchPage(mode, query, page);
    const matching = products.filter((p) => normName(p.title).includes(wanted) && !p.title.startsWith('['));
    if (!matching.length) break;
    found.push(...matching.filter((p) => p.price > 0)); // 0 = "Not on buylist." / no NM listing
    if (!hasNext) break;
  }
  return found.map((p) => ({
    store: 'gk',
    ...parseName(p.title),
    setName: SET_ALIASES[p.setName] || p.setName,
    setCode: null,
    condition: 'NM',
    image: p.image || null,
    raw: p.title,
    price: p.price,
    stock: p.stock,
  }));
}

async function search(query) {
  return (await fetchMatching('sell', query)).map(({ price, stock, ...o }) => {
    const cash = round2(price);
    return { ...o, cash, credit: round2(cash * CREDIT_MULTIPLIER), retail: null };
  });
}

async function searchRetail(query) {
  return (await fetchMatching('buy', query)).map((o) => ({ ...o, price: round2(o.price) }));
}

module.exports = {
  id: 'gk',
  label: 'Game Keeper',
  creditNote: 'cash + 30%',
  buylistUrl: (name) => `${BASE}/buylist/search?c=1&q=${encodeURIComponent(name)}`,
  search,
  searchRetail,
};
