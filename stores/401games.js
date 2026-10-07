// 401 Games (Storepass platform).
// Buylist: their site shows CASH by default; store credit is cash x 1.30 (store setting credit_percent).
// The site prices from the product's top-level offer_price; the per-condition entries are stale.
// Retail: variant_info carries the Shopify store's price + inventory per condition (matches store.401games.ca).

const { round2, normCollector, normFinish, normTreatment, searchLink } = require('../lib/normalize');
const { fetchProducts } = require('../lib/storepass');

const HOST = 'buylist.401games.ca';
const STORE_ID = 'USYSFNJ9bg';
const CREDIT_MULTIPLIER = 1.3;

// Store pages for a card (#45). Retail: Shopify's /variants/<id> redirects to the product page with that variant
// (NM) selected. The buylist has no product pages; its search reads `q` (and needs the product line).
const LINKS = {
  buy: 'https://store.401games.ca/search?q={q}',
  sell: `https://${HOST}/retailer/buylist?q={q}&product_line=Magic%3A%20the%20Gathering`,
};

const KNOWN_TREATMENTS = new Set(['borderless', 'extended art', 'showcase', 'retro frame', 'full art']);

// SKUs look like "MTGN-CM_038-EOC-057" or "MTGF-F000-PLST-C21-263": set code, then collector number.
function parseSku(sku) {
  const m = /^MTG[NF]-[^-]+-([A-Z0-9]+)-(.+)$/i.exec(String(sku || ''));
  return m ? { setCode: m[1], collectorNumber: m[2] } : null;
}

// "Sol Ring - Borderless (Foil) (CMM)" -> name "Sol Ring", treatments ["Borderless"], tags ["Foil", "CMM"]
// "Sol Ring - Elven (LTC)"            -> name "Sol Ring - Elven"
function parseDisplayName(display) {
  const tags = [...String(display).matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
  const bare = String(display).replace(/\s*\([^)]*\)/g, '').trim();
  const [base, ...subtitles] = bare.split(' - ');
  const nameParts = [base];
  const treatments = [];
  for (const sub of subtitles) {
    // "Borderless Artist Card" still counts as Borderless.
    const known = [...KNOWN_TREATMENTS].find((t) => sub.toLowerCase().includes(t));
    if (known) treatments.push(normTreatment(known));
    else if (/promo/i.test(sub)) treatments.push('Promo');
    else nameParts.push(sub);
  }
  return { name: nameParts.join(' - '), treatments, tags };
}

function toOffer(p, mode) {
  // Products without an NM entry are odd one-offs (e.g. a single HP copy).
  const nmRetail = (p.variant_info || []).find((v) => v.title === 'NM');
  if (mode === 'buy' ? !nmRetail : !(p.store_pass_variant_info || []).some((v) => v.title === 'NM')) return null;

  const data = p.product_data || {};
  const sku = parseSku(p.variant_info?.[0]?.sku);
  if (!sku && !data.set) return null;

  const { name, treatments, tags } = parseDisplayName(p.display_name);
  const isFoil = (p.tags || []).includes('Foil or Non-Foil_Foil');
  const foilTag = tags.find((t) => /foil|etched/i.test(t));

  const identity = {
    store: '401',
    name,
    setName: data.set_name,
    setCode: sku?.setCode || data.set,
    altSetCodes: [data.set],
    collectorNumber: normCollector(sku?.collectorNumber ?? data.collector_number_normalized),
    finish: isFoil ? normFinish(foilTag || 'foil') : 'nonfoil',
    treatments,
    condition: 'NM',
    image: p.image_url || null,
    raw: p.display_name,
  };

  if (mode === 'buy') {
    const price = Number(nmRetail.price) > 0 ? round2(Number(nmRetail.price)) : null;
    const url = nmRetail.id ? `https://store.401games.ca/variants/${nmRetail.id}` : searchLink(LINKS.buy, name);
    return { ...identity, price, stock: Math.max(0, Number(nmRetail.inventory_quantity) || 0), url };
  }
  const cash = Number(p.offer_price) > 0 ? round2(Number(p.offer_price)) : null;
  return {
    ...identity,
    cash,
    credit: cash === null ? null : round2(cash * CREDIT_MULTIPLIER),
    retail: Number(p.price) || null,
    url: searchLink(LINKS.sell, name),
  };
}

async function search(name) {
  return (await fetchProducts(HOST, STORE_ID, name)).map((p) => toOffer(p, 'sell')).filter(Boolean);
}

async function searchRetail(name) {
  return (await fetchProducts(HOST, STORE_ID, name)).map((p) => toOffer(p, 'buy')).filter(Boolean);
}

module.exports = {
  id: '401',
  label: '401 Games',
  creditNote: 'cash + 30%',
  links: LINKS,
  search,
  searchRetail,
};
