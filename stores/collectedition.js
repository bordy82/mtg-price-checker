// Collect-Edition (Storepass platform).
// Buylist: the "Buy Price" shown on their site is already the STORE CREDIT value (offer_price_credit);
// cash (offer_price) is credit / 1.5. Both come straight from the API.
// Retail: the same response carries the Shopify store's variants (price + inventory per condition),
// which match cards.collect-edition.com.

const { round2, normFinish, searchLink } = require('../lib/normalize');
const { fetchProducts, parseDisplayName, readTags } = require('../lib/storepass');

const HOST = 'buylist.collect-edition.com';
const STORE_ID = 'dFODoSzI0G';

// Store pages for a card (#45). Retail: Shopify's /variants/<id> redirects to the product page with that variant
// (Near Mint) selected. The buylist has no product pages; its search reads `q` (and needs the product line).
const LINKS = {
  buy: 'https://cards.collect-edition.com/search?q={q}',
  sell: `https://${HOST}/retailer/buylist?q={q}&product_line=Magic%3A%20the%20Gathering`,
};

// "Sol Ring - Elven (0408) (Serial Numbered) (LTC-408Z) - Tales of Middle-earth Commander Foil"
//  -> name "Sol Ring - Elven", tags ["0408", "Serial Numbered", "LTC-408Z"]: the tags before the last " - ".
function parseCeName(display) {
  const str = String(display);
  return parseDisplayName(str.includes(' - ') ? str.slice(0, str.lastIndexOf(' - ')) : str);
}

function toOffer(p, mode) {
  const { name, tags } = parseCeName(p.display_name);
  const data = p.product_data || {};
  const { setCode, collectorNumber, foilTag, treatments } = readTags(tags, data);

  const identity = {
    store: 'ce',
    name,
    setName: data.set_name,
    setCode,
    collectorNumber,
    finish: p.selectedFinish === 'foil' ? normFinish(foilTag || 'foil') : 'nonfoil',
    treatments,
    condition: 'NM',
    image: p.image_url || null,
    raw: p.display_name,
  };

  if (mode === 'buy') {
    const variant = (p.variant_info || []).find((v) => v.title === 'Near Mint');
    if (!variant) return null;
    const price = Number(variant.price) > 0 ? round2(Number(variant.price)) : null;
    const url = variant.id ? `https://cards.collect-edition.com/variants/${variant.id}` : searchLink(LINKS.buy, name);
    return { ...identity, price, stock: Math.max(0, Number(variant.inventory_quantity) || 0), url };
  }
  const nm = (p.store_pass_variant_info || []).find((v) => v.title === 'Near Mint') || p;
  const cash = Number(nm.offer_price) > 0 ? round2(Number(nm.offer_price)) : null;
  const credit = Number(nm.offer_price_credit) > 0 ? round2(Number(nm.offer_price_credit)) : null;
  return { ...identity, cash, credit, retail: Number(p.price) || null, url: searchLink(LINKS.sell, name) };
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
  logo: 'logos/ce.png',
  creditNote: 'site price = credit',
  links: LINKS,
  search,
  searchRetail,
};
