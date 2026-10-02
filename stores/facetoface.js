// Face to Face Games (Shopify app proxy backed by Elasticsearch).
// Buylist: the price shown is CASH; store credit gets a 30% bonus at checkout.
// Retail: same index without /buy; each condition variant has its price and stock.

const { round2, normCollector, normFinish, normTreatment, getJson } = require('../lib/normalize');

const CREDIT_MULTIPLIER = 1.3;
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

const ENDPOINTS = {
  sell: { path: '/buy/search', published: '/publishedF2FSell/1' },
  buy: { path: '/search', published: '/publishedOnlineStore/1' },
};

const searchUrl = (name, page, mode) =>
  `https://facetofacegames.com/apps/prod-indexer${ENDPOINTS[mode].path}` +
  `/pageSize/${PAGE_SIZE}/page/${page}` +
  // F2F expects the keyword double URL-encoded ("Aettir%2520and%2520Priwen").
  `/keyword/${encodeURIComponent(encodeURIComponent(name))}` +
  // Relevance ties make paging skip/duplicate cards; creation date gives a stable order.
  `/sort/date_desc/withFacets/false${ENDPOINTS[mode].published}`;

// Sets whose SKU code doesn't match what other stores use.
const SET_CODE_BY_NAME = { 'The List': 'LIST' };

// SKUs look like "SIN-MTG-FIN-253-ENG-NM-NF", "M-C15-Sol_Ring-268-NM-NF" or "MP-Sol_Ring-G05-3-NM-F".
function setCodeFromSku(sku, collectorNumber) {
  const parts = String(sku || '').split('-');
  if (parts[0] === 'SIN' && parts[1] === 'MTG') return parts[2];
  if (parts[0] === 'M') return parts[1];
  // Promo SKUs: the set code is the segment right before the collector number.
  const cn = String(collectorNumber).toLowerCase();
  const i = parts.findIndex((p, idx) => idx > 1 && p.toLowerCase() === cn);
  return i > 1 ? parts[i - 1] : null;
}

function toOffer(src, mode) {
  if (src.General_Card_Language && src.General_Card_Language !== 'English') return null;
  const nm = (src.variants || []).find((v) => v.selectedOptions?.[0]?.value === 'NM');
  if (!nm) return null;

  const treatments = (src.General_Alternate_Art_Qualifier || []).map(normTreatment).filter(Boolean);
  const identity = {
    store: 'f2f',
    name: src.General_Card_Name || src.title,
    setName: src.MTG_Set_Name,
    setCode:
      SET_CODE_BY_NAME[src.MTG_Set_Name] ||
      setCodeFromSku(nm.sku, src.MTG_Collector_Number) ||
      src.MTG_Set_Name,
    collectorNumber: normCollector(src.MTG_Collector_Number),
    finish: normFinish(src.MTG_Foil_Option),
    treatments,
    condition: 'NM',
    image: nm.image?.url || src.media?.[0]?.url || null,
    raw: src.title,
  };

  if (mode === 'buy') {
    const price = Number(nm.price) > 0 ? round2(Number(nm.price)) : null;
    return { ...identity, price, stock: Math.max(0, Number(nm.inventoryQuantity) || 0) };
  }
  const cash = Number(nm.sellPrice) > 0 ? round2(Number(nm.sellPrice)) : null;
  return {
    ...identity,
    cash,
    credit: cash === null ? null : round2(cash * CREDIT_MULTIPLIER),
    retail: Number(nm.price) || null,
  };
}

async function fetchAll(name, mode) {
  const first = await getJson(searchUrl(name, 1, mode));
  const total = first.hits?.total?.value || 0;
  const pages = Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => getJson(searchUrl(name, i + 2, mode)))
  );
  return [first, ...rest]
    .flatMap((r) => r.hits?.hits || [])
    .map((h) => toOffer(h._source, mode))
    .filter(Boolean);
}

const search = (name) => fetchAll(name, 'sell');
const searchRetail = (name) => fetchAll(name, 'buy');

module.exports = {
  id: 'f2f',
  label: 'Face to Face',
  creditNote: 'cash + 30%',
  buylistUrl: (name) => `https://facetofacegames.com/search?q=${encodeURIComponent(name)}`,
  search,
  searchRetail,
};
