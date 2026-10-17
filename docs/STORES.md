# Store reference

How each store's data is read, last verified 2026-10-02 (Collect-Edition's buy prices and listing minimum: 2026-10-07; Hobbiesville, Storepass paging and Cartes Sportives Rive-Sud: 2026-10-17). All six stores serve CAD prices. None of these
endpoints is documented by the stores, so re-check them here first when a store's column goes blank.

The first question for any store: **does its site display cash or credit?** It differs by store.

| Store | Platform | Site shows | Credit | Retail stock |
|---|---|---|---|---|
| Face to Face | Shopify + Elasticsearch app proxy | cash | cash × 1.30 | exact count |
| Collect-Edition | Storepass (buylist) + Shopify | **credit** | as shown (cash = credit ÷ 1.5) | exact count |
| 401 Games | Storepass (buylist) + Shopify | cash (toggle to credit) | cash × 1.30 | exact count |
| Game Keeper | Crystal Commerce (HTML) | cash | cash × 1.30 | max orderable qty |
| Hobbiesville | Storepass (buylist) + Shopify | **credit** (toggle to cash) | as shown (cash × 1.25 up to $10 retail, × 1.143 above) | online warehouse's count |
| Cartes Sportives Rive-Sud | SortSwift (buylist) + Shopify | **cash and credit** | as shown (65% vs 60% of TCGplayer market: cash × 1.083) | exact count |

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
- `GET /saas/search?store_id=…&product_line=Magic: the Gathering&mongo=true&sort=Relevance&name={name}&buylist_products=true&…&page=1&limit=240`, through `lib/storepass.js` (shared with 401 Games and Hobbiesville).
  - **One request.** In pages of 24 (the default), relevance sorting repeats some products and skips others from one page to the next: 401 Games' "Sol Ring" lost 13 to 18 of its 193 products, Hobbiesville's 4 to 18 of 183 (Collect-Edition's happened to be stable). `limit` goes to at least 1000 ("Island": 692 products in one response); 240, the old 10 pages of 24, keeps the most relevant.
  - The other sorts are the site's labels (`Alphabetical: A-Z`, `Release Date: New-Old`…). Alphabetical paging is stable, but it would cut real matches, not the least relevant ones, when a search finds more than the limit.
- Per product:
  - `display_name`, e.g. `Sol Ring - Elven (0408) (Serial Numbered) (LTC-408Z) - Tales of Middle-earth Commander Foil`. The name is the part before ` (`. Tags are the `(…)` groups before the last ` - `. `(SET-NUM)` gives the set code and collector number.
  - `selectedFinish` (`foil` / `nonfoil`), `product_data.set`, `.set_name`, `.collector_number_normalized` (drops letters such as `408Z`, so the tag is preferred).
  - **Buylist**: `store_pass_variant_info[title='Near Mint']`, where `offer_price` is cash and `offer_price_credit` is credit.
  - **Retail**: `variant_info[title='Near Mint']` with `price` and `inventory_quantity`. These match the Shopify store.
- **Links**: retail `https://cards.collect-edition.com/variants/{NM variant id}`, which Shopify redirects to the product page with Near Mint selected. Buylist: the Storepass buylist has no product pages; its search reads `q` (also `search_query` / `name`) and needs the product line: `/retailer/buylist?q={front name}&product_line=Magic%3A%20the%20Gathering`.

Gotchas:
- The "Buy Price" on their site **is the credit value**. Cash is credit ÷ 1.5.
- Their store settings (`/retailer/store-info`, the Magic product line's `priceGenerationRules`) set buy prices by retail tier. Cash is about 44% of retail at $10 and up, 37% from $5, 22% from $2 and 4% from $1 (e.g. $0.06 cash, $0.09 credit for a $1.50 card), with no offer under $1. Credit = cash × 1.5 (`credit_percent`).
- Their buylist page only **lists** offers over $2 cash (over $3 credit; `gt_price: 2`), and checkout needs at least $3. `lib/storepass.js` sends `override_buylist_gt_price=true`, so this app also shows the smaller offers, which their page doesn't list (checked on the page 2026-10-07: Llanowar Elves SLD #1553, $1.85 cash / $2.78 credit, isn't there; the lowest listed is $2.04 / $3.06). 401 Games has no such minimum (`gt_price: 0`).
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
- The server often drops connections or returns 502, even for plain `curl`. Its requests make 4 attempts with backoff (`getText(url, { retries: 3 })` in `lib/http.js`; the other stores get 2). Keep request volume low.

## Hobbiesville — `stores/hobbiesville.js`

- Buylist host `buylist.hobbiesville.com`, store_id `cGCfZUZiX0` (`domainStoreId` in the buylist page). Retail site: `www.hobbiesville.com` (Shopify). Shops in Ottawa and Toronto; ships across Canada.
- Same Storepass `/saas/search` as Collect-Edition, with the same `(…)` tags in `display_name` (read by `parseDisplayName()` / `readTags()` in `lib/storepass.js`), but no ` - <set name>` part:
  - `Sol Ring (SOC-128)`, `Sol Ring (0356) (FIC-356)`, `Sol Ring (Borderless) (Surge Foil) (PIP-887) (Borderless) Foil`, `Sol Ring (Extended Art) (CMR-700): (Extended Art)`, and `Sol Ring (2ED-)` when there's no number (`product_data.collector_number_normalized` fills it in).
  - Some names contain ` - ` (`Wild Rose Rebellion - Counterspell (Showcase) / Wild Rose Rebellion (FCA-004) (Borderless)`), so the name isn't cut there as it is for Collect-Edition.
  - **Foil**: a ` Foil` at the end of `display_name`. It always matches the SKU's `-F-` (`MTG-PIP-887-F-539392-1`). `selectedFinish` and the `Foil or Non-Foil_Foil` tag are often wrong (`Sol Ring (M3C-305) Foil` is nonfoil in both).
  - **Buylist**: the top-level `offer_price` (cash) and `offer_price_credit` (credit), the same as `store_pass_variant_info[title='NM']`.
  - **Retail**: `variant_info[title='NM']` for the `price`. Stock: see below.
- **Links**: retail `https://www.hobbiesville.com/variants/{NM variant id}` (redirects to the product page with NM selected); buylist `/retailer/buylist?q={front name}&product_line=Magic%3A%20the%20Gathering`, as for Collect-Edition. Their product pages also show the offer ("Sell to Us $28.88 cash / $33.01 credit").

Gotchas:
- The "Buy Price" on their buylist **is the credit value** by default (`default_payment_type: credit`). The cart's Cash button switches the page to cash.
- Credit isn't a fixed bonus. From `/retailer/store-info`: credit = cash × 1.25 (the store's `credit_percent`) for cards up to $10 retail, × 1.143 (the Magic line's) above, and × 1 in a set's first two weeks. Both values are read from the API, never computed.
- **Stock**: `inventory_quantity` adds up every Shopify location, but hobbiesville.com only sells what's at location `35200073750` (the online warehouse). Copies at the shops show "Item is out of stock online". So the stock is that location's `available` in `inventoryLevels`, for the NM variant's `inventory_item_id`. Checked on 31 products against `/products/{handle}.js`: `available` is true exactly when that location has copies. If Hobbiesville's stock reads 0 everywhere while the site has cards in stock, the online location changed.
- Their price rules make **no offer** (0, shown as not buying) for Foreign Black Border, Alpha, Beta, old promo sets and a few others, and when they already hold too many copies (over 8; over 3 for Secret Lair or $150+ cards).
- Their buylist page lists offers over $0.04 (`gt_price`); like Collect-Edition's, this app shows them all.
- Products without an NM variant (a `Default Title` one-off) are skipped.

## Cartes Sportives Rive-Sud — `stores/cartessportivesrivesud.js`

- Sainte-Catherine, QC (6252 Rte 132), an in-person store. Two platforms, neither used by another store here, both built on **TCGplayer's products**: names like `Sol Ring (0356) (Surge Foil)`, TCGplayer's set names ("Commander: FINAL FANTASY"), its product ids. No bot check on either.
- **Buylist**: SortSwift, `https://buylist.cartessportivesrivesud.com` (the site's "Sell Your Cards"). Public JSON API under `https://buylist-api.sortswift-services.com/api/buylist/`; the store's id there is `cartessportivessivesud` (sic). Magic is `categoryId=1`.
  - `GET search?query={name}&page=1&limit=500&sort=nameAsc&categoryId=1&storeId=…&single=true&sealed=false` → `{ products, totalCount }` ("Sol Ring": 168, "Island": 1030; one request, `limit` goes to at least 1000). Each product: `productId`, `name`, `groupId` / `groupName` (the TCGplayer set; **no set code**), `number`, `cdnImage` (full size, ~180 KB), and `prices[]` per `subTypeName` (`Normal`, `Foil`) in USD. It doesn't carry the store's offer. The search is fuzzy ("Solemn Offering" for "Sol Ring"), so only products named like the card are priced: exact names first, at most 300 printings (30 requests).
  - `POST get-price/bulk` with up to 10 `{ productId, condition: 'NM', printing, language: 'EN', storeId, cartQuantity: 0 }` → `{ prices: [{ productId, printing, …, price }] }`. `price.NMFinalCash` / `price.NMFinalCredit` are the offers (3 decimals; the site rounds to the nearest cent), `price.buying.NM`, `price.stockLimitReached`, `price.inventoryQuantity` (their stock of that printing, the same count as the shop's). The site sends 10 printings per request, 3 requests at a time; so does the adapter. `GET get-price?productId=…&printing=…&condition=NM&language=EN&storeId=…` is the one-printing version. It accepts more than 10 per request (30 worked); the adapter keeps to the site's 10.
  - **Set codes and numbers come from Scryfall** (`printsByTcgplayerId()` in `lib/scryfall.js`, one search per card name, cached a day): Scryfall lists each printing's `tcgplayer_id` (and `tcgplayer_etched_id`), so a product gets Scryfall's set code, set name and collector number (`PFIN 253s` for TCGplayer's "Prerelease Cards" 253). TCGplayer has separate products for some special foils (`Sol Ring (0356) (Surge Foil)`) that Scryfall doesn't link; those take the set of the other products of their TCGplayer group when they all agree, and their number from SortSwift. "Sol Ring": 176 of 180 offers get a code (the 4 others are Art Series cards, which no other store lists), and 3 of 176 rows show only this store. If Scryfall can't be reached, offers keep TCGplayer's set name and number and match by name only (more rows stay apart); the store doesn't fail.
  - The List: Scryfall's `PLST` numbers its cards by original set (`C18-222`), as 401 Games does; Face to Face and Hobbiesville call the set `LIST`, so `PLST` offers also get the alternate code `LIST`. Without Scryfall, TCGplayer's "The List Reprints" product (`Sol Ring (C18)`, number `222/307`) is turned into the same.
- **Retail**: Shopify, `https://cartessportivesrivesud.com` (Warehouse theme).
  - The search page, with only the results section: `/search?type=product&page={n}&q=product_type:"Magic: The Gathering Singles" AND title:"{name}"&section_id=template--17446591955231__main` (~270 KB a page instead of ~830 KB; 24 products a page; page 1 says "41 results", so the others load together). An unknown section id answers 404: a new theme renames it, and the adapter then reads whole pages. `/search/suggest.json` stops at 10 results.
  - Each product item has the product's JSON (`<script type='application/json' class='wcp_json …'>`, from an app): `title` (`Sol Ring [CLB - 871]`, `Sol Ring (C18) [LIST - 222/307]`, `Sol Ring (0211) [MSC]`: set code and number in brackets), `vendor` (the TCGplayer set name), `type`, `handle`, `featured_image`, `options` (`Condition`, `Language`, `Printing`) and `variants` (`Near Mint / English / Normal`…, `price` in cents, `available`; no stock count, `inventory_quantity` is null in `/products/{handle}.json`). Sold-out products are listed too.
  - **Stock**: the item's "In stock, 4 units" / "Only 1 unit left" is the **product's** count, over all its variants. It's exact when only one variant is in stock (almost always). When several are (NM Normal and Foil, or NM and LP), the adapter reads that product's page (`/products/{handle}`, ~600 KB), whose `"inventories"` (the theme's stock messages, by variant id) and a labels app's variant list both carry each variant's `inventory_quantity`. E.g. Sol'kanar the Swamp King DMR 368 shows "In stock, 3 units": 1 Normal and 2 Foil.
  - Images are under the shop's own `/cdn/shop/files/…`, which resizes on `width=` like `cdn.shopify.com`.
- **Links**: retail `https://cartessportivesrivesud.com/variants/{NM variant id}` (redirects to the product page with that variant selected). The buylist page doesn't read a search from its URL (you pick Magic: The Gathering, then search), so selling links go to `https://buylist.cartessportivesrivesud.com/`.

Gotchas:
- The buylist site shows **both** cash and credit for every card (Credit is selected by default, `defaultPayment: credit`), so both are read from the API. From the store config (`__NEXT_DATA__` on the buylist page, `gameSettings["1"].pricingOptions`): over $1, cash = 60% and credit = 65% of TCGplayer's market price in CAD (`marketPrice`, `chosenPriceType: market`, falling back to mid, low, high); at $1 and under, a fixed $0.005 both ("Bulk" on the site, shown as $0.005: the page prints half cents with 3 decimals). Credit isn't cash × 1.3; it's about cash × 1.083.
- They buy NM and LP English only, and stop at 5 copies in stock (`stockLimitations.maxQuantityPerProduct`, per printing): the offer is then 0 and the site says "Not buying" (Sol Ring MOC 381 with 5 in stock). Payment is e-transfer or store credit.
- Checked against the site on 2026-10-17 for "Sol Ring", "Aettir and Priwen" and "Sephiroth, Fabled SOLDIER", Normal and Foil (e.g. Aettir and Priwen FIN 350: $15.60 / $16.90, Foil $33.65 / $36.45).

---

## Logos — `public/logos/`

Column headers show each store's square mark (#82), saved here rather than linked from the stores' sites. Each is cropped to its visible part (transparent margins removed, so marks of different shapes look the same size) and scaled to 64 px high, sharp at the 24 px it's shown on 2× screens. Sources (2026-10-17):

| File | Source |
|---|---|
| `f2f.png` | the FF shield, `https://facetofacegames.com/cdn/shop/files/Icon_Black_1.png` (the site's favicon) |
| `f2f-dark.png` | the same shield in white, cropped from `https://facetofacegames.com/cdn/shop/files/wide-f2f-EN-white-logo.png`: the black shield's lower half is dark grey, lost on the dark theme |
| `ce.png` | the roundel, `https://cards.collect-edition.com/cdn/shop/files/logo_carre.png` (the site's favicon) |
| `401.png` | the green dice, their Storepass logo: `https://d2k4q26owzy373.cloudfront.net/700x700/games/userfiles/1732742151707-401_DICE_VERT_COL_GREY.png` |
| `gk.png` | the red wings, `https://bluedefault.crystalcommerce.com/themes/clients/gamekeeperonline/assets/img/favicon.ico` (a 64×64 PNG; the wings in `logo-2017.png` are 5× wider than tall) |
| `hv.png` | the "H", `https://www.hobbiesville.com/cdn/shop/files/h_logo_hobbiesville_large_5540fe46-d1c3-4c52-a8a9-f5cb1102c438.png` |
| `csrs.png` | the cards and "CSRS" square, the buylist's favicon: `https://buylist-logos.nyc3.cdn.digitaloceanspaces.com/store-45cd4c39a63a978b/1781285644502-favicon_CSRS_Logo_2.png`. Its cream background was made transparent around the mark (the cards stay white inside), so it reads on both themes: on the dark one, the white letters and cards carry it |

The stores' wide logos don't suit the headers: 401 Games' "GAMES" is white (invisible on the light theme) and Game Keeper's text is dark. Shopify image URLs take `?width=`.

---

## Adding a store

1. Open the store's buylist or search page with the browser's network tab open and look for a JSON request. If there isn't one, plan on parsing the HTML.
2. Note whether the site shows cash or credit, and the credit bonus (policy page or checkout script).
3. Write `stores/<store>.js`:
   - Fetch with `getJson` / `getText` from `lib/http.js` (User-Agent, 15 s timeout, retries).
   - Build the identity (`name, setName, setCode, collectorNumber, finish, treatments, image`) with the helpers in `lib/normalize.js`.
   - Return `{ cash, credit, retail }` from `search`, and `{ price, stock }` from `searchRetail`, each with `url`: the card's page at the store in that mode (or its search, via `searchLink`).
   - Export `links: { buy, sell }`, the store's search pages with `{q}` for the card name.
   - Export `online: true` if it's a mail-order store for the user (not one they can visit): its column goes on the right, with the other online stores.
   - Export `logo: 'logos/<id>.png'`: its square mark (favicon or app icon), cropped and saved in `public/logos/` (see [Logos](#logos--publiclogos)). Check it on both themes; add `logoDark` if it doesn't read on the dark one. Without a logo, the header shows the store's name.
4. Register it in `stores/index.js`.
5. Check matching with a few cards that have many printings ("Sol Ring", "Lightning Bolt"). Rows that show only the new store usually mean a set-code or set-name mismatch; add an alias.
6. Add a section to this file.
