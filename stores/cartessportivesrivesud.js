// Cartes Sportives Rive-Sud (Sainte-Catherine, QC). Two platforms, both built on TCGplayer's products.
// Buylist: SortSwift (buylist.cartessportivesrivesud.com). Their site shows CASH AND CREDIT for every card (credit is
// the default payment). Both come from the API: 60% / 65% of TCGplayer's market price in CAD over $1, half a cent
// at $1 and under, nothing once they hold 5 copies. The search has TCGplayer's set names but no set codes, so set
// codes, set names and collector numbers come from Scryfall by TCGplayer product id (lib/scryfall.js).
// Retail: Shopify (cartessportivesrivesud.com). Titles carry the set code and number ("Sol Ring [CLB - 871]").

const { round2, normCollector, normFinish, normTreatment, normName } = require('../lib/normalize');
const { getJson, getText, postJson } = require('../lib/http');
const { printsByTcgplayerId } = require('../lib/scryfall');

const BUYLIST_API = 'https://buylist-api.sortswift-services.com/api/buylist';
const STORE_ID = 'cartessportivessivesud'; // sic
const MAGIC = 1; // SortSwift's categoryId
const SEARCH_LIMIT = 500; // products in one search response ("Sol Ring": 168, "Island": 1030)
const MAX_PRINTINGS = 300; // priced per search: 30 bulk requests
const BULK_SIZE = 10; // printings per get-price/bulk request, 3 requests at a time, as their site does
const BULK_CONCURRENCY = 3;

const SHOP = 'https://cartessportivesrivesud.com';
const SINGLES = 'Magic: The Gathering Singles'; // the Shopify product type
// The theme's search results section: Shopify sends just that part of the page (~270 KB instead of ~830 KB).
// A new theme renames it; the full page then works the same (see fetchShopPage).
const SEARCH_SECTION = 'template--17446591955231__main';
const MAX_SHOP_PAGES = 10; // 24 products a page

// Store pages for a card (#45). Retail: Shopify's /variants/<id> redirects to the product page with that variant
// selected. The buylist page has no links to a search: pick Magic: The Gathering, then search.
const LINKS = {
  buy: `${SHOP}/search?q={q}&type=product`,
  sell: 'https://buylist.cartessportivesrivesud.com/',
};

// TCGplayer's product names, used by both sites: "Sol Ring (0356) (Surge Foil)", "Sol Ring - Elven (0408) (Serial
// Numbered)", "Sol Ring (C18)" (The List: the original set; "(CE)" and "(IE)" tell Collectors' Editions apart).
function parseTcgName(title) {
  const str = String(title);
  const tags = [...str.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
  const numberTag = tags.find((t) => /^\d+[a-z]?$/i.test(t));
  const setTag = tags.find((t) => t !== numberTag && /^[A-Z0-9]{2,5}$/.test(t));
  const foilTag = tags.find((t) => /foil|etched/i.test(t));
  const treatments = tags
    .filter((t) => t !== numberTag && t !== setTag && t !== foilTag)
    .map(normTreatment)
    .filter(Boolean);
  return { name: str.split(' (')[0].trim(), numberTag, setTag, foilTag, treatments: [...new Set(treatments)] };
}

// TCGplayer's printings are "Normal" and "Foil"; the name says which foil ("Surge Foil", "Foil Etched").
const finishOf = (printing, foilTag) => (printing === 'Foil' ? normFinish(foilTag || 'foil') : 'nonfoil');

// The List: Scryfall's PLST numbers its cards by original set ("C18-222"), as 401 Games does; Hobbiesville and Face
// to Face call the set LIST. TCGplayer has the original set as a tag and its number ("222/307").
const theList = (setTag, number) => ({
  setCode: 'PLST',
  altSetCodes: ['LIST'],
  collectorNumber: normCollector(`${setTag}-${String(number).split('/')[0]}`),
});

// ---- buylist (SortSwift) ----

async function searchBuylist(query) {
  const params = new URLSearchParams({
    query,
    page: '1',
    limit: String(SEARCH_LIMIT),
    sort: 'nameAsc',
    categoryId: String(MAGIC),
    storeId: STORE_ID,
    single: 'true',
    sealed: 'false',
  });
  return (await getJson(`${BUYLIST_API}/search?${params}`)).products || [];
}

// A product Scryfall doesn't list (TCGplayer has separate products for some special foils: "Sol Ring (0356) (Surge
// Foil)") takes the set of the other products of its TCGplayer set, when they all agree.
// TCGplayer group id -> { setCode, setName }.
function groupSets(products, prints) {
  const sets = new Map(); // group id -> Map of set code -> set name
  for (const p of products) {
    const known = prints.get(p.productId);
    if (!known) continue;
    if (!sets.has(p.groupId)) sets.set(p.groupId, new Map());
    sets.get(p.groupId).set(known.setCode, known.setName);
  }
  return new Map([...sets].filter(([, set]) => set.size === 1)
    .map(([group, set]) => { const [[setCode, setName]] = set; return [group, { setCode, setName }]; }));
}

function buylistIdentity(p, printing, prints, groups) {
  const { name, numberTag, setTag, foilTag, treatments } = parseTcgName(p.name);
  const known = prints.get(p.productId);
  const set = known || groups.get(p.groupId);
  const setCode = set?.setCode || null;
  const collectorNumber = normCollector(known?.collectorNumber ?? (p.number || numberTag));
  let printingId = { setCode, altSetCodes: [], collectorNumber };
  if (setCode === 'PLST') {
    printingId = known ? { ...printingId, altSetCodes: ['LIST'] } : setTag ? theList(setTag, p.number) : printingId;
  }
  return {
    store: 'csrs',
    name,
    // Scryfall's set name, like most stores' ("Ravnica Allegiance Promos" for TCGplayer's "Prerelease Cards")
    setName: set?.setName || p.groupName,
    ...printingId,
    finish: finishOf(printing, foilTag),
    treatments,
    condition: 'NM',
    image: p.cdnImage || null,
    raw: p.name,
  };
}

// Offers are to the cent, as their site rounds them, except the bulk offer for cards at $1 and under: $0.005.
const offerValue = (n) => (!(n > 0) ? null : n < 0.01 ? Math.round(n * 1000) / 1000 : round2(n));

// NM English offers for each { productId, printing }, by "productId|printing". The site asks for 10 printings per
// request, 3 requests at a time; so does this. If one request fails, the store fails (no partial results).
async function fetchOffers(printings) {
  const chunks = [];
  for (let i = 0; i < printings.length; i += BULK_SIZE) chunks.push(printings.slice(i, i + BULK_SIZE));
  const offers = new Map();
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < chunks.length) {
      const body = chunks[next++].map(({ productId, printing }) =>
        ({ productId, condition: 'NM', printing, language: 'EN', storeId: STORE_ID, cartQuantity: 0 }));
      try {
        const { prices = [] } = await postJson(`${BUYLIST_API}/get-price/bulk`, body);
        for (const r of prices) offers.set(`${r.productId}|${r.printing}`, r.price || {});
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, chunks.length) }, worker));
  return offers;
}

async function search(query) {
  const [products, prints] = await Promise.all([
    searchBuylist(query),
    // Without Scryfall, printings still match on set name + number (fewer of them merge); the store doesn't fail.
    printsByTcgplayerId(query).catch((err) => {
      console.error(`[csrs] Scryfall: ${err.message}`);
      return new Map();
    }),
  ]);

  // The search is fuzzy ("Solemn Offering" for "Sol Ring"); price only the products named like the card, exact
  // names first when there are too many.
  const wanted = normName(query);
  const matching = products
    .map((p) => ({ p, name: normName(parseTcgName(p.name).name) }))
    .filter(({ name }) => name.includes(wanted))
    .sort((a, b) => (a.name === wanted ? 0 : 1) - (b.name === wanted ? 0 : 1))
    .map(({ p }) => p);
  const printingsOf = (p) => [...new Set((p.prices || []).map((x) => x.subTypeName).filter(Boolean))];
  const printings = matching.flatMap((p) => printingsOf(p).map((printing) => ({ p, printing }))).slice(0, MAX_PRINTINGS);
  if (!printings.length) return [];

  const groups = groupSets(matching, prints);
  const offers = await fetchOffers(printings.map(({ p, printing }) => ({ productId: p.productId, printing })));
  return printings.map(({ p, printing }) => {
    const offer = offers.get(`${p.productId}|${printing}`) || {};
    const buying = offer.buying?.NM !== false; // 0 too when they hold 5 copies already
    const cash = buying ? offerValue(offer.NMFinalCash) : null;
    const credit = buying ? offerValue(offer.NMFinalCredit) : null;
    return { ...buylistIdentity(p, printing, prints, groups), cash, credit, retail: null, url: LINKS.sell };
  });
}

// ---- retail (Shopify) ----

let sectionGone = false; // the theme no longer has SEARCH_SECTION: fetch whole pages

async function fetchShopPage(query, page) {
  const q = `product_type:"${SINGLES}" AND title:"${query.replace(/"/g, '')}"`;
  const url = `${SHOP}/search?type=product&page=${page}&q=${encodeURIComponent(q)}`;
  if (!sectionGone) {
    try {
      return await getText(`${url}&section_id=${SEARCH_SECTION}`);
    } catch (err) {
      if (err.status !== 404) throw err;
      console.error(`[csrs] search section ${SEARCH_SECTION} is gone; reading whole pages`);
      sectionGone = true;
    }
  }
  return getText(url);
}

// Each result is a product item with the product's JSON (all its variants) and, when in stock, the theme's
// "In stock, 4 units" / "Only 1 unit left": the product's copies over all its variants.
function parseShopPage(html) {
  const items = html.split(/<div class="product-item product-item--/).slice(1).map((block) => {
    const json = /<script type='application\/json' class='wcp_json[^']*'[^>]*>([\s\S]*?)<\/script>/.exec(block)?.[1];
    const label = /class="product-item__inventory inventory[^"]*">([^<]*)</.exec(block)?.[1] || '';
    let product = null;
    try {
      product = json ? JSON.parse(json) : null;
    } catch {}
    return { product, units: Number(/(\d+)\s+units?/.exec(label)?.[1]) || null };
  });
  // Without the product JSON there'd be no variants, prices or stock: fail rather than show nothing.
  if (items.length && !items.some((i) => i.product)) {
    throw new Error('no product data on the search page (has the theme changed?)');
  }
  return {
    items: items.filter((i) => i.product),
    total: Number(/(\d+)\s+results?\b/.exec(html)?.[1]) || null, // "41 results"
    hasNext: (page) => html.includes(`page=${page + 1}`),
  };
}

// Page 1 says how many results there are, so the other pages load together. Without that line, follow the links.
async function fetchShopProducts(query) {
  const first = parseShopPage(await fetchShopPage(query, 1));
  if (!first.total) {
    const items = [...first.items];
    for (let page = 1, last = first; page < MAX_SHOP_PAGES && last.hasNext(page); page++) {
      last = parseShopPage(await fetchShopPage(query, page + 1));
      items.push(...last.items);
    }
    return items;
  }
  const pages = Math.min(MAX_SHOP_PAGES, Math.ceil(first.total / (first.items.length || 1)));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, async (_, i) => parseShopPage(await fetchShopPage(query, i + 2)).items)
  );
  return [first.items, ...rest].flat();
}

// Product pages list each variant's quantity: the theme's stock messages ("inventories") and a labels app's
// variant list both carry it. Variant id -> copies.
function variantQuantities(html) {
  const read = (re) => new Map([...html.matchAll(re)].map((m) => [Number(m[1]), Number(m[2])]));
  const inventories = read(/"(\d+)":\s*\{[^{}]*?"inventory_quantity":\s*(-?\d+)/g);
  return inventories.size ? inventories : read(/\{"id":(\d+),[^{}]*?"inventory_quantity":(-?\d+)/g);
}

function retailIdentity(product) {
  // "Sol Ring (C18) [LIST - 222/307]", "Sol Ring (0211) [MSC]" (number only in the name)
  const m = /^(.*?)\s*\[([A-Za-z0-9]+)(?:\s*-\s*([^\]]+))?\]\s*$/.exec(product.title);
  if (!m) return null;
  const [, base, code, number = ''] = m;
  const { name, numberTag, setTag, foilTag, treatments } = parseTcgName(base);
  const setCode = code.toUpperCase();
  const printingId = (setCode === 'LIST' || setCode === 'PLST') && setTag
    ? theList(setTag, number)
    : { setCode, altSetCodes: [], collectorNumber: normCollector(number.trim() || numberTag) };
  const image = product.featured_image ? String(product.featured_image).replace(/^\/\//, 'https://') : null;
  return {
    store: 'csrs',
    name,
    setName: product.vendor,
    ...printingId,
    foilTag,
    treatments,
    condition: 'NM',
    image,
    raw: product.title,
  };
}

async function searchRetail(query) {
  const items = await fetchShopProducts(query);
  const listings = [];
  const needPage = new Map(); // handle -> listings whose stock the product page has to tell
  for (const { product, units } of items) {
    if (product.type !== SINGLES || !Array.isArray(product.variants)) continue;
    const identity = retailIdentity(product);
    if (!identity) continue;
    const { foilTag, ...printing } = identity;
    const option = (v, label) => v[`option${(product.options || []).indexOf(label) + 1}`];
    const inStock = product.variants.filter((v) => v.available);
    for (const v of product.variants) {
      if (option(v, 'Condition') !== 'Near Mint' || option(v, 'Language') !== 'English') continue;
      const listing = {
        ...printing,
        finish: finishOf(option(v, 'Printing'), foilTag),
        price: Number(v.price) > 0 ? round2(v.price / 100) : null, // cents
        stock: 0,
        url: `${SHOP}/variants/${v.id}`,
      };
      listings.push(listing);
      if (!v.available) continue;
      // The search page's count is the product's: exact when this is its only variant in stock.
      if (inStock.length === 1 && units) listing.stock = units;
      else {
        listing.variantId = v.id;
        listing.units = units;
        if (!needPage.has(product.handle)) needPage.set(product.handle, []);
        needPage.get(product.handle).push(listing);
      }
    }
  }

  // Rare: a product with several variants in stock (NM Normal and Foil, or NM and LP). Its page has each one's count.
  await Promise.all([...needPage].map(async ([handle, waiting]) => {
    const quantities = variantQuantities(await getText(`${SHOP}/products/${handle}`));
    for (const listing of waiting) {
      const n = quantities.get(listing.variantId);
      if (n === undefined) console.error(`[csrs] no stock count for variant ${listing.variantId} on /products/${handle}`);
      // Without a count, the product's total is the best guess (it may include the other variants' copies).
      listing.stock = Math.max(0, n ?? listing.units ?? 1);
    }
  }));
  return listings.map(({ variantId, units, ...l }) => l);
}

module.exports = {
  id: 'csrs',
  label: 'Cartes Sportives Rive-Sud',
  logo: 'logos/csrs.png',
  creditNote: 'cash + 8%', // the site shows both
  links: LINKS,
  search,
  searchRetail,
};
