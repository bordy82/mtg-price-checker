# MTG Price Checker

Compare Magic: The Gathering prices across Quebec game stores, in both directions:

- **Selling**: what each store's buylist pays for your cards, in **store credit** or **cash**. Find the store that gives you the most.
- **Buying**: each store's retail price **and stock** for the cards you want. Find the cheapest store that actually has the card.

Supported stores:

| Store | Selling (buylist) | Buying (retail) |
|---|---|---|
| [Face to Face Games](https://facetofacegames.com) | cash, credit = cash + 30% | price + stock |
| [Collect-Edition](https://cards.collect-edition.com) | credit as shown on site, cash = credit / 1.5 | price + stock |
| [401 Games](https://store.401games.ca) | cash, credit = cash + 30% | price + stock |
| [Game Keeper Online](https://www.gamekeeperonline.com) | cash, credit = cash + 30% | price + stock |

## Features

- Search a card by name and see every printing side by side across all stores. Printings are matched by set, collector number and finish.
- Filter results by finish (non-foil, foil, etched) and version (normal, borderless, showcase, extended art…).
- Keep a saved **sell list** and a separate **wishlist**, and refresh all their prices in one click.
- The best store per card is highlighted:
  - selling: the highest offer
  - buying: the cheapest copy **in stock** (sold-out prices are shown greyed and never win)
- Totals for "everything at one store", with how many cards each store doesn't buy or doesn't have in stock.
- Near Mint, English cards only.

## Getting started

Requires Node.js 18 or newer (uses the built-in `fetch`).

```bash
npm install
npm start
```

Then open http://localhost:3000. Set `PORT` to use another port.

Your lists are stored locally in `data/list.json` (selling) and `data/wishlist.json` (buying). They are git-ignored. Set `DATA_DIR` to keep them in another folder.

To try changes without touching your lists, run `npm run start:test`. It copies both lists into `data-test/` (fresh each run) and serves the copies at http://localhost:3999.

## How it works

For more detail, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (components, data flow, matching algorithm, data shapes)
and [docs/STORES.md](docs/STORES.md) (each store's endpoints, fields, and quirks).

```
server.js            Express server: static page + JSON API
stores/              one adapter per store
  facetoface.js        JSON search API (buylist and retail indexes)
  collectedition.js    Storepass buylist API (also carries retail variants)
  401games.js          Storepass buylist API (also carries retail variants)
  gamekeeper.js        Crystal Commerce HTML pages (no JSON API)
  index.js             store registry
lib/
  match.js             merges offers from all stores into one row per printing
  normalize.js         names, finishes, versions, set names, matching keys
  storepass.js         shared fetching for Storepass-hosted buylists
public/              the web page (vanilla HTML/CSS/JS)
docs/                architecture and per-store reference
```

Each store adapter exports:

- `search(name)` → buylist offers `{ ...printing, cash, credit }`
- `searchRetail(name)` → retail listings `{ ...printing, price, stock }`

`...printing` is the store-independent identity: name, set name/code, collector number, finish and version tags.

**Matching across stores.** Printings are merged on `set code | collector number | finish group`. Alias keys cover stores whose set codes differ (e.g. `CEI` vs `IED`), using another code or a normalized set name. Game Keeper doesn't publish collector numbers, so its listings fall back to front-face name + set + finish + versions. They only merge when exactly one printing matches, so an ambiguous listing stays on its own row instead of being merged wrongly.

### API

| Method | Path | Description |
|---|---|---|
| GET | `/api/stores` | Store list |
| GET | `/api/search?q=<name>&mode=sell\|buy` | Merged printings for a card |
| GET / PUT | `/api/list?mode=sell\|buy` | Read / replace the saved list |
| POST | `/api/refresh?mode=sell\|buy` | Re-fetch prices for every card in the list |

### Adding a store

1. Find the store's search data, ideally a JSON request in the browser's network tab, otherwise the HTML.
2. Check what the site displays: some show **cash**, others show **credit** directly.
3. Create `stores/<store>.js` exporting `{ id, label, creditNote, search, searchRetail }`, returning the offer shapes above.
4. Add it to `stores/index.js`. The UI adds a column automatically.

The full checklist is in [docs/STORES.md](docs/STORES.md#adding-a-store).

## Disclaimer

This is an unofficial personal tool and isn't affiliated with any of the stores. It reads the same public data their websites show. Prices and credit bonuses change, and stores' own sites and policies are authoritative. Please keep usage light.
