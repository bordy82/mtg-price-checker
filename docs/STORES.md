# Store reference

How each store's data is read, last verified 2026-10-02. All four stores serve CAD prices. None of these
endpoints is documented by the stores, so re-check them here first when a store's column goes blank.

The first question for any store: **does its site display cash or credit?** It differs by store.

| Store | Platform | Site shows | Credit | Retail stock |
|---|---|---|---|---|
| Face to Face | Shopify + Elasticsearch app proxy | cash | cash × 1.30 | exact count |
| Collect-Edition | Storepass (buylist) + Shopify | **credit** | as shown (cash = credit ÷ 1.5) | exact count |
| 401 Games | Storepass (buylist) + Shopify | cash (toggle to credit) | cash × 1.30 | exact count |
| Game Keeper | Crystal Commerce (HTML) | cash | cash × 1.30 | max orderable qty |

---

## Face to Face Games — `stores/facetoface.js`

- **Buylist**: `https://facetofacegames.com/apps/prod-indexer/buy/search/pageSize/100/page/{n}/keyword/{name}/sort/date_desc/withFacets/false/publishedF2FSell/1`
- **Retail**: the same URL with `/search` instead of `/buy/search`, and `publishedOnlineStore/1`.
- The response is Elasticsearch `hits.hits[]._source`:
  - Identity: `General_Card_Name`, `MTG_Set_Name`, `MTG_Collector_Number`, `MTG_Foil_Option`, `General_Alternate_Art_Qualifier[]`, `General_Card_Language`.
  - `variants[]`, one per condition (`selectedOptions[0].value` = `NM` / `PL`…), with retail `price`, `inventoryQuantity`, `sku`, and on the buylist index `sellPrice` (cash).
- Set code comes from the SKU: `SIN-MTG-FIN-253-ENG-NM-NF` → `FIN`, `M-C15-…` → `C15`, `MP-Name-G05-3-…` → `G05`. `The List` is mapped to `LIST`.
- **Links**: the product page, `https://facetofacegames.com/products/{handle}` (the exact printing), with the site's mode set on the way:
  - Buying vs selling is a **site-wide mode**, stored as a cart attribute (`/cart.js` → `attributes.site`: `shop` / `sell`). Every page shows only the current mode: a product page has "Add to cart" at the retail price **or** "Add to sell" at the buylist price, and `/search` queries the retail or the buylist index. `buylist.facetofacegames.com` just redirects to the main site.
  - Selling: append `?site=sell`. Their pages handle it: they set the attribute to `sell`, then reload without the parameter.
  - Buying: there's no `site=shop`, so the link is `https://facetofacegames.com/cart/update?attributes%5Bsite%5D=shop&return_to=<path>`: Shopify sets the attribute and redirects (cart items untouched). Without it, a buying link opened after a selling link would show the sell side. Their own SHOP button switches back the same way (their home page posts `site: 'shop'`).
  - Searches (cards saved before links existed): `/search?q={q}&site=sell`, and for buying the cart update with `return_to=/search?q=…`, the name encoded twice (`{qq}`).

Gotchas:
- The keyword is **double** URL-encoded (`Aettir%2520and%2520Priwen`).
- `pageSize` caps at 100. Relevance sorting pages unstably (cards are skipped or repeated across pages), so the adapter uses `sort/date_desc`.
- `facetofacegames.com/search?q=` in the browser is the **retail** store. The buylist is the site's "Sell" mode.
- Credit bonus: `_val * 1.3` in the sell-form script on `/pages/sell-your-cards`.

## Collect-Edition — `stores/collectedition.js`

- Buylist host `buylist.collect-edition.com`, store_id `dFODoSzI0G`. Retail site: `cards.collect-edition.com`.
- `GET /saas/search?store_id=…&product_line=Magic: the Gathering&mongo=true&sort=Relevance&name={name}&buylist_products=true&…&page={n}`, through `lib/storepass.js`.
- Per product:
  - `display_name`, e.g. `Sol Ring - Elven (0408) (Serial Numbered) (LTC-408Z) - Tales of Middle-earth Commander Foil`. The name is the part before ` (`. Tags are the `(…)` groups before the last ` - `. `(SET-NUM)` gives the set code and collector number.
  - `selectedFinish` (`foil` / `nonfoil`), `product_data.set`, `.set_name`, `.collector_number_normalized` (drops letters such as `408Z`, so the tag is preferred).
  - **Buylist**: `store_pass_variant_info[title='Near Mint']`, where `offer_price` is cash and `offer_price_credit` is credit.
  - **Retail**: `variant_info[title='Near Mint']` with `price` and `inventory_quantity`. These match the Shopify store.
- **Links**: retail `https://cards.collect-edition.com/variants/{NM variant id}`, which Shopify redirects to the product page with Near Mint selected. Buylist: the Storepass buylist has no product pages; its search reads `q` (also `search_query` / `name`) and needs the product line: `/retailer/buylist?q={front name}&product_line=Magic%3A%20the%20Gathering`.

Gotchas:
- The "Buy Price" on their site **is the credit value**. Cash is credit ÷ 1.5.
- Their store settings (`/retailer/store-info`) set buy prices as a tiered percentage of retail (≈44% cash for cards $10 and up). Cards under $2 retail get no offer.
- Only NM is public on the buylist; other conditions are staff-only.
- Serialized cards keep the plain number and add a tag (`(Serial Numbered) (LTR-748)`), unlike F2F's `748z`. The matcher treats both as serialized.

## 401 Games — `stores/401games.js`

- Buylist host `buylist.401games.ca`, store_id `USYSFNJ9bg`. Retail site: `store.401games.ca` (Shopify, `/products/{handle}.js`).
- Same Storepass `/saas/search` as Collect-Edition, but the fields are used differently:
  - `display_name`, e.g. `Sol Ring - Borderless (Foil) (CMM)`. Versions are ` - ` suffixes ("Borderless Artist Card" counts as Borderless); other suffixes stay part of the name (`Sol Ring - Elven`).
  - Set code and collector number come from the SKU: `MTGN-CM_038-EOC-057` → `EOC`, `057`; `MTGF-F000-PLST-C21-263` → `PLST`, `C21-263`. `product_data.set` is used as an alternate code (`ied` for `CEI`).
  - Foil comes from the tag `Foil or Non-Foil_Foil`. **`selectedFinish` is unreliable.**
  - **Buylist**: the top-level `offer_price` is the cash shown on the site; credit = cash × `credit_percent` (1.30, from `/retailer/store-info`).
  - **Retail**: `variant_info[title='NM']` with `price` and `inventory_quantity`. These match `store.401games.ca/products/*.js`.
- **Links**: retail `https://store.401games.ca/variants/{NM variant id}` (redirects to the product page with NM selected); buylist `/retailer/buylist?q={front name}&product_line=Magic%3A%20the%20Gathering`, as for Collect-Edition.

Gotchas:
- `store_pass_variant_info` (per-condition buy offers) is **stale**. The site uses the top-level `offer_price` × condition factor (SP = 0.85).
- Some products lack `product_data` or an NM variant (e.g. single HP copies); they're skipped.

## Game Keeper Online — `stores/gamekeeper.js`

- No JSON API; the adapter parses server-rendered Crystal Commerce HTML.
  - **Buylist**: `https://www.gamekeeperonline.com/buylist/search?c=1&q={name}&page={n}`
  - **Retail**: `https://www.gamekeeperonline.com/products/search?c=1&q={name}&page={n}`
- Both pages use the same markup: `<li class="product">` blocks with:
  - `itemprop="name"` (title) and `<span class="category">` (set name)
  - variant rows starting with `variant-short-info">` + a label (`NM-Mint, English`, `Light Play, English`, `Out of stock.`), a `CAD$ 12.34` price, and, when orderable, a quantity `<select … max="N">`.
- NM English price = the first `NM-Mint, English` row. Retail stock = that row's `max`. A product with only an `Out of stock.` row keeps its price with stock 0.
- Titles look like `Name (0408) - Foil - Borderless`:
  - A trailing `(number)` is the collector number. It's usually absent, so these offers are matched with the loose key.
  - `Foil` / `Surge Foil` / `Etched` parts set the finish.
  - Parts matching the version words (`borderless|extended|showcase|frame|…`) become versions; others stay part of the name.
- `SET_ALIASES` maps set names unlike the other stores' (`Commander Lord of the Rings` → `Tales of Middle-earth Commander`, `3rd Edition` → `Revised Edition`…).
- Version labels are often compound (`Borderless Poster`, `Showcase Scrolls`, `Bundle Promo`, `Borderless Poster (Serialized)`). Loose matching only compares their core words (see `coreVersions`).
- Some promos are filed under catch-all sets (`Miscellaneous Promos`, `Prerelease Promos`) and can't be matched to a specific printing.
- **Links**: each `<li class="product">` links its own page: `/catalog/{set}/{card}/{id}` on the retail page, `/buylist/{set}/{card}/{id}` on the buylist page (the other `href` in the block is the set's page, without the card part).

Gotchas:
- Search is fuzzy and relevance-sorted, so it returns unrelated cards after the real matches. Paging stops at the first page with no name match (max 8 pages).
- Credit bonus: the English buy/sell policy says +30% for Magic; the French page says +50%. **30% is correct** (confirmed by the user).
- The server often drops connections or returns 502, even for plain `curl`. Requests retry 4 times with backoff. Keep request volume low.

---

## Adding a store

1. Open the store's buylist or search page with the browser's network tab open and look for a JSON request. If there isn't one, plan on parsing the HTML.
2. Note whether the site shows cash or credit, and the credit bonus (policy page or checkout script).
3. Write `stores/<store>.js`:
   - Build the identity (`name, setName, setCode, collectorNumber, finish, treatments, image`) with the helpers in `lib/normalize.js`.
   - Return `{ cash, credit, retail }` from `search`, and `{ price, stock }` from `searchRetail`, each with `url`: the card's page at the store in that mode (or its search, via `searchLink`).
   - Export `links: { buy, sell }`, the store's search pages with `{q}` for the card name.
4. Register it in `stores/index.js`.
5. Check matching with a few cards that have many printings ("Sol Ring", "Lightning Bolt"). Rows that show only the new store usually mean a set-code or set-name mismatch; add an alias.
6. Add a section to this file.
