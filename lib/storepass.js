// Shared fetching for stores whose buylist is hosted on the Storepass platform (Collect-Edition, 401 Games).
// One /saas/search response carries both the buylist offers and the store's retail variants.

const { getJson } = require('./http');

const MAX_PAGES = 10; // 24 products per page

function searchUrl(host, storeId, name, page, countOnly = false) {
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
    page: String(page),
  });
  if (countOnly) {
    params.set('with_count', 'true');
    params.set('no_track', 'true');
  }
  return `https://${host}/saas/search?${params}`;
}

// All raw products matching a card name, de-duplicated (paging can repeat products).
async function fetchProducts(host, storeId, name) {
  const count = await getJson(searchUrl(host, storeId, name, 1, true));
  const pages = Math.max(1, Math.min(MAX_PAGES, Number(count.pages) || 1));
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) => getJson(searchUrl(host, storeId, name, i + 1)))
  );
  const seen = new Set();
  return results
    .flatMap((r) => r.products || [])
    .filter((p) => !seen.has(p.id) && seen.add(p.id));
}

module.exports = { fetchProducts };
