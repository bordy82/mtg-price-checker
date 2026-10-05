# CLAUDE.md

Guidance for Claude when working in this repository.

## Workflow

- Never commit or push unless explicitly asked. The user tests features first.
- Run with `npm start` (http://localhost:3000). After changing server or store code, restart the server; the browser page alone won't pick it up.
- No build step and no test suite. Verify changes by running real searches (e.g. "Aettir and Priwen", "Sol Ring", "Sephiroth, Fabled SOLDIER") and checking the numbers against the stores' websites.
- `data/list.json` (sell list) and `data/wishlist.json` (wishlist) are the user's real data. Don't overwrite them while testing: test with `npm run start:test`, which copies both lists into `data-test/` (fresh each run) and serves the copies on port 3999. Plain `PORT=3999 npm start` still reads and writes the real lists.

## GitHub project board

- Board: https://github.com/users/bordy82/projects/10 ("MTG Price Checker", project number **10**, owner **bordy82**). "The project", "the board" and "cards" mean this.
- Repo: `bordy82/mtg-price-checker`
- Column flow: Backlog → Ready → In progress → In review → Done
- Process (`/tackle-project`): take each **Ready** card → move it to **In progress** → read the issue → implement on a branch `fix/issue-<N>-<slug>` (or `feat/...`) → verify with real searches on a throwaway server (`npm run start:test`, stopped by PID), since there's no type-check or test suite → commit ending `Fixes #<N>` → push → PR body starting `Closes #<N>` → move the card to **In review**. Spikes get an issue comment instead of a PR. Never merge; the user merges after review (`/merge-issue <N>`). Running `/tackle-project` counts as asking for the commit, push and PR.
- IDs:
  - Project ID: `PVT_kwHOBZQit84BlhH6`
  - Status field ID: `PVTSSF_lAHOBZQit84BlhH6zhkNt3A`
  - Status options: Backlog `f75ad846` · Ready `61e4505c` · In progress `47fc9ee4` · In review `df73e18b` · Done `98236657`
- Example: move an item to In progress:

```sh
gh project item-edit --id <ITEM_ID> --project-id PVT_kwHOBZQit84BlhH6 \
  --field-id PVTSSF_lAHOBZQit84BlhH6zhkNt3A --single-select-option-id 47fc9ee4
```

(Item IDs come from `gh project item-list 10 --owner bordy82 --format json`.)

## Architecture

Full details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); per-store endpoints and fields are in [docs/STORES.md](docs/STORES.md).
Update those docs when you change behavior they describe.

- `server.js`: Express 5. `searchAll(query, { mode })` calls every store in parallel and merges the results. Results are cached 10 min per mode and query; results with a failed store aren't cached. `/api/refresh` keeps a failed store's last known prices. Errors go back as JSON.
- `stores/*.js`: one adapter per store, exporting `{ id, label, creditNote, search, searchRetail }`. `search` returns buylist offers (`cash`, `credit`); `searchRetail` returns retail listings (`price`, `stock`). They share an identity part: `name, setName, setCode, altSetCodes?, collectorNumber, finish, treatments, image`. The HTTP helper and User-Agent live in `lib/normalize.js`.
- `lib/match.js`: `mergeOffers(offers, query, mode)` makes one row per printing.
  - Pass 1 uses strict keys (`printingKeys`).
  - Pass 2 handles offers without a collector number using `looseKey`. They merge only when exactly one row matches; if several do, the exact special-foil label can narrow it down.
  - Versions are compared by core words (`coreVersions`). Serialized copies (`…z` number or a "serial" label, see `isSerialized`) are kept apart from regular ones.
  - Prefer leaving a listing unmerged over risking a wrong merge.
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
  - The server often drops connections or returns 502 (plain curl too), so requests retry 4× with backoff. Keep request volume low.

## Conventions

- NM English only. One row per printing. Quantities exist only in "Selling to <store>" lists (#24); the main list and wishlist have none (the user found a quantity column too cramped there).
- For a throwaway test server, use `npm run start:test` (port 3999, copies of the lists in `data-test/`) and stop it by PID (`lsof -t -iTCP:3999 -sTCP:LISTEN`). Don't use `pkill -f "node server.js"`, which can kill the user's main server.
- When adding a store, first confirm whether its site displays cash or credit.
