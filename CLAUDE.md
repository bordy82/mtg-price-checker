# CLAUDE.md

Guidance for Claude when working in this repository.

## Workflow

- Never commit or push unless explicitly asked. The user tests features first.
- Run with `npm start` (http://localhost:3000). After changing server or store code, restart the server; the browser page alone won't pick it up.
- No build step and no test suite. Verify changes by running real searches (e.g. "Aettir and Priwen", "Sol Ring", "Sephiroth, Fabled SOLDIER") and checking the numbers against the stores' websites.
- `data/list.json` (sell list) and `data/wishlist.json` (wishlist) are the user's real data. Don't overwrite them while testing.

## Architecture

- `server.js`: Express 5. `searchAll(query, { mode })` calls every store in parallel and merges the results. Results are cached 10 min per mode and query; results with a failed store aren't cached. `/api/refresh` keeps a failed store's last known prices.
- `stores/*.js`: one adapter per store with `search` (buylist → `cash`, `credit`) and `searchRetail` (retail → `price`, `stock`). They share an identity part: `name, setName, setCode, altSetCodes?, collectorNumber, finish, treatments, image`.
- `lib/match.js`: `mergeOffers(offers, query, mode)` makes one row per printing.
  - Pass 1 uses strict keys (`printingKeys`).
  - Pass 2 handles offers without a collector number using `looseKey`. They merge only when exactly one row matches; if several do, the exact special-foil label can narrow it down.
- `lib/normalize.js`: name, finish, treatment and set-name normalization. Searches use `frontName()` because stores join two-name cards differently (`A // B` vs `A - B`).
- `public/app.js`: vanilla JS. Everything that differs between Selling and Buying lives in the `MODES` config. Keep the rendering code shared.

## Store quirks (verified; re-check before changing)

- **Face to Face**:
  - Buylist: `/apps/prod-indexer/buy/search/...`. Retail: `/apps/prod-indexer/search/...`.
  - The keyword must be **double** URL-encoded.
  - Use `sort/date_desc`, because relevance-sorted paging skips and duplicates cards. Max `pageSize` is 100.
  - `sellPrice` is **cash**; credit = cash × 1.3.
  - The search page the user may share is the retail store, not the buylist.
- **Collect-Edition** (Storepass, store_id `dFODoSzI0G`):
  - The "Buy Price" on their site is already **credit** (`offer_price_credit`); cash = `offer_price`.
  - Retail price and stock are in `variant_info` (title `Near Mint`).
- **401 Games** (Storepass, store_id `USYSFNJ9bg`):
  - The site shows **cash**; credit = cash × 1.3.
  - Use the top-level `offer_price`; `store_pass_variant_info` is stale.
  - Set code and collector number come from the SKU (`MTGN-CM_038-EOC-057`).
  - Foil comes from the `Foil or Non-Foil_Foil` tag; `selectedFinish` is unreliable.
  - Retail data is in `variant_info` (title `NM`).
- **Game Keeper** (Crystal Commerce, HTML only):
  - Pages: `/buylist/search` and `/products/search`, with `c=1&q=&page=`.
  - Results are relevance-sorted, so paging stops at the first page with no name match.
  - Price is **cash**; credit = cash × 1.3. The user confirmed 30%; the French policy page wrongly says 50%.
  - No collector number unless the name has one (`Sol Ring (0408)`).
  - Retail stock = the `max` of the quantity select.
  - The site sometimes drops connections, so requests retry 3×. Keep request volume low.

## Conventions

- NM English only. One row per printing; no quantity column (the user found it too cramped).
- When adding a store, first confirm whether its site displays cash or credit.
