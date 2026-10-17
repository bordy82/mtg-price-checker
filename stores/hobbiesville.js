// Hobbiesville (Storepass platform; Ottawa and Toronto).
// Buylist: the "Buy Price" shown on their site is STORE CREDIT by default (offer_price_credit), with a Cash toggle
// (offer_price). Credit isn't a fixed bonus over cash (their price rules: +25% for cards up to $10 retail, +14.3%
// above, none in a set's first two weeks), so both come straight from the API.
// Retail: the same response carries the Shopify store's variants. Only the online warehouse's copies count as in
// stock on hobbiesville.com; copies at the shops show "out of stock online".

const { round2, normFinish, searchLink } = require('../lib/normalize');
const { fetchProducts, parseDisplayName, readTags } = require('../lib/storepass');

const HOST = 'buylist.hobbiesville.com';
const STORE_ID = 'cGCfZUZiX0';
// The Shopify location hobbiesville.com sells from. A variant is available on the site exactly when this location
// has copies (checked against /products/<handle>.js on 31 products); the other locations are the shops.
const ONLINE_LOCATION = 35200073750;

// Store pages for a card (#45). Retail: Shopify's /variants/<id> redirects to the product page with that variant
// (NM) selected. The buylist has no product pages; its search reads `q` (and needs the product line).
const LINKS = {
  buy: 'https://www.hobbiesville.com/search?q={q}',
  sell: `https://${HOST}/retailer/buylist?q={q}&product_line=Magic%3A%20the%20Gathering`,
};

// Copies of a variant the site can sell: its inventory at the online location.
function onlineStock(p, variant) {
  const level = (p.inventoryLevels || []).find(
    (l) => l.inventory_item_id === variant.inventory_item_id && l.location_id === ONLINE_LOCATION
  );
  return Math.max(0, Number(level?.available) || 0);
}

function toOffer(p, mode) {
  // Products without an NM variant are odd one-offs (a "Default Title" listing).
  const nm = (p.variant_info || []).find((v) => v.title === 'NM');
  if (!nm) return null;

  // "Sol Ring (Borderless) (Surge Foil) (PIP-887) (Borderless) Foil": no set name, unlike Collect-Edition's.
  // The " Foil" suffix always agrees with the SKU (MTG-PIP-887-F-…); selectedFinish and the Foil tag don't.
  const { name, tags } = parseDisplayName(p.display_name);
  const data = p.product_data || {};
  const { setCode, collectorNumber, foilTag, treatments } = readTags(tags, data);

  const identity = {
    store: 'hv',
    name,
    setName: data.set_name,
    setCode,
    collectorNumber,
    finish: / Foil$/.test(p.display_name) ? normFinish(foilTag || 'foil') : 'nonfoil',
    treatments,
    condition: 'NM',
    image: p.image_url || null,
    raw: p.display_name,
  };

  if (mode === 'buy') {
    const price = Number(nm.price) > 0 ? round2(Number(nm.price)) : null;
    const url = nm.id ? `https://www.hobbiesville.com/variants/${nm.id}` : searchLink(LINKS.buy, name);
    return { ...identity, price, stock: onlineStock(p, nm), url };
  }
  const cash = Number(p.offer_price) > 0 ? round2(Number(p.offer_price)) : null;
  const credit = Number(p.offer_price_credit) > 0 ? round2(Number(p.offer_price_credit)) : null;
  return { ...identity, cash, credit, retail: Number(p.price) || null, url: searchLink(LINKS.sell, name) };
}

async function search(name) {
  return (await fetchProducts(HOST, STORE_ID, name)).map((p) => toOffer(p, 'sell')).filter(Boolean);
}

async function searchRetail(name) {
  return (await fetchProducts(HOST, STORE_ID, name)).map((p) => toOffer(p, 'buy')).filter(Boolean);
}

module.exports = {
  id: 'hv',
  label: 'Hobbiesville',
  logo: 'logos/hv.png',
  creditNote: 'site price = credit',
  links: LINKS,
  search,
  searchRetail,
};
