// Collect-Edition (Storepass platform).
// Buylist: the "Buy Price" shown on their site is already the STORE CREDIT value (offer_price_credit);
// cash (offer_price) is credit / 1.5. Both come straight from the API.
// Retail: the same response carries the Shopify store's variants (price + inventory per condition),
// which match cards.collect-edition.com.

const { round2, normCollector, normFinish, normTreatment } = require('../lib/normalize');
const { fetchProducts } = require('../lib/storepass');

const HOST = 'buylist.collect-edition.com';
const STORE_ID = 'dFODoSzI0G';

// "Sol Ring - Elven (0408) (Serial Numbered) (LTC-408Z) - Tales of Middle-earth Commander Foil"
//  -> name "Sol Ring - Elven", tags ["0408", "Serial Numbered", "LTC-408Z"]
function parseDisplayName(display) {
  const str = String(display);
  const left = str.includes(' - ') ? str.slice(0, str.lastIndexOf(' - ')) : str;
  const name = left.split(' (')[0].trim();
  const tags = [...left.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
  return { name, tags };
}

function toOffer(p, mode) {
  const { name, tags } = parseDisplayName(p.display_name);
  const data = p.product_data || {};

  // "(FIN-350)", "(LTC-408Z)", "(LIST-CMD-261)", or "(LEB-)" when the number is unknown.
  const setTag = [...tags].reverse().find((t) => /^[A-Z0-9]+-[A-Za-z0-9★-]*$/.test(t));
  const tagNumber = setTag ? setTag.slice(setTag.indexOf('-') + 1) : '';
  const collectorNumber = normCollector(tagNumber || data.collector_number_normalized);
  const setCode = (data.set || (setTag ? setTag.split('-')[0] : '') || data.set_name || '').toUpperCase();

  const foilTag = tags.find((t) => /foil|etched/i.test(t));
  const finish = p.selectedFinish === 'foil' ? normFinish(foilTag || 'foil') : 'nonfoil';

  const treatments = tags
    .filter((t) => t !== setTag && t !== foilTag && !/^\d+$/.test(t))
    .map(normTreatment)
    .filter(Boolean);

  const identity = {
    store: 'ce',
    name,
    setName: data.set_name,
    setCode,
    collectorNumber,
    finish,
    treatments: [...new Set(treatments)],
    condition: 'NM',
    image: p.image_url || null,
    raw: p.display_name,
  };

  if (mode === 'buy') {
    const variant = (p.variant_info || []).find((v) => v.title === 'Near Mint');
    if (!variant) return null;
    const price = Number(variant.price) > 0 ? round2(Number(variant.price)) : null;
    return { ...identity, price, stock: Math.max(0, Number(variant.inventory_quantity) || 0) };
  }
  const nm = (p.store_pass_variant_info || []).find((v) => v.title === 'Near Mint') || p;
  const cash = Number(nm.offer_price) > 0 ? round2(Number(nm.offer_price)) : null;
  const credit = Number(nm.offer_price_credit) > 0 ? round2(Number(nm.offer_price_credit)) : null;
  return { ...identity, cash, credit, retail: Number(p.price) || null };
}

async function search(name) {
  return (await fetchProducts(HOST, STORE_ID, name)).map((p) => toOffer(p, 'sell'));
}

async function searchRetail(name) {
  return (await fetchProducts(HOST, STORE_ID, name)).map((p) => toOffer(p, 'buy')).filter(Boolean);
}

module.exports = {
  id: 'ce',
  label: 'Collect-Edition',
  creditNote: 'site price = credit',
  search,
  searchRetail,
};
