// Shared fetching for stores whose buylist is hosted on the Storepass platform (Collect-Edition, 401 Games, Hobbiesville).
// One /saas/search response carries both the buylist offers and the store's retail variants.

const { getJson } = require('./http');
const { normCollector, normTreatment } = require('./normalize');

// The most relevant ones when a search finds more ("Island" finds about 700).
const MAX_PRODUCTS = 240;

function searchUrl(host, storeId, name) {
  const params = new URLSearchParams({
    store_id: storeId,
    product_line: 'Magic: the Gathering',
    mongo: 'true',
    sort: 'Relevance',
    name,
    buylist_products: 'true',
    ignore_is_hot_order: 'true',
    override_buylist_gt_price: 'true',
    buylist_setting_search: 'true',
    page: '1',
    limit: String(MAX_PRODUCTS),
  });
  return `https://${host}/saas/search?${params}`;
}

// The raw products matching a card name, in one request: relevance-sorted pages of 24 repeat some products and skip
// others (401 Games' "Sol Ring" lost 13 to 18 of 193, Hobbiesville's 4 to 18 of 183), which one page of `limit` avoids.
async function fetchProducts(host, storeId, name) {
  return (await getJson(searchUrl(host, storeId, name))).products || [];
}

// "Sol Ring (0408) (Serial Numbered) (LTC-408Z) Foil" -> name "Sol Ring", tags ["0408", "Serial Numbered", "LTC-408Z"]
// (Collect-Edition's and Hobbiesville's display names; Collect-Edition cuts its " - <set name>" part off first).
function parseDisplayName(display) {
  const str = String(display);
  const name = str.split(' (')[0].trim();
  const tags = [...str.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
  return { name, tags };
}

// What those tags say about the printing. The set tag is "(FIN-350)", "(LTC-408Z)", "(LIST-CMD-261)", or "(LEB-)"
// when the number is unknown; `data` is the product's product_data, the fallback for set and number.
function readTags(tags, data = {}) {
  const setTag = [...tags].reverse().find((t) => /^[A-Z0-9]+-[A-Za-z0-9★-]*$/.test(t));
  const tagNumber = setTag ? setTag.slice(setTag.indexOf('-') + 1) : '';
  const foilTag = tags.find((t) => /foil|etched/i.test(t));
  const treatments = tags
    .filter((t) => t !== setTag && t !== foilTag && !/^\d+$/.test(t))
    .map(normTreatment)
    .filter(Boolean);
  return {
    setCode: (data.set || (setTag ? setTag.split('-')[0] : '') || data.set_name || '').toUpperCase(),
    collectorNumber: normCollector(tagNumber || data.collector_number_normalized),
    foilTag, // "Surge Foil", "Foil Etched"... for the finish label
    treatments: [...new Set(treatments)],
  };
}

module.exports = { fetchProducts, parseDisplayName, readTags };
