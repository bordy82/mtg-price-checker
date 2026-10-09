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
- Card name suggestions while you type (from [Scryfall](https://scryfall.com)), so a typo or a missing comma or apostrophe doesn't come up empty: pick one with ↑ / ↓ and Enter, or click it. Enter without picking searches what you typed. Without a connection to Scryfall, search works as usual, just without suggestions.
- Filter results by finish (non-foil, foil, etched) and version (normal, borderless, showcase, extended art…).
- Keep a saved **sell list** and a separate **wishlist**, and refresh all their prices in one click (or just one wishlist list, with its own **Refresh**). The button shows its progress (`Refreshing 12 / 55…`).
- After a refresh, each list price that moved shows how much under it (`▲ $1.30`), green when it's better for you (a higher offer when selling, a lower price when buying) and red when worse; hover it for the old price and date. A wishlist card that came back in stock says so. "Prices from …" also says how many prices changed.
- Click a card's name (in the search results or any list) to copy it, ready to paste into a store's site; a small "✓ Copied" flashes next to it. Two-name cards copy only the front name (`Clive Rosfield - Vial Smasher the Fierce` → `Clive Rosfield`), which every store's search finds.
- Click a price to open that card at the store, in a new tab: the exact printing's page where the store has one (the buylist search for Collect-Edition and 401 Games when selling).
- Lists are sorted by card name. Star the cards you're actually selling or buying: they're pinned to the top, with their own subtotal.
- Removed a card by mistake? "Removed <card> · **Undo**" shows for 8 seconds and puts it back exactly as it was (star, list, quantity).
- When selling, move the starred cards to a store: they go into a "Selling to <store>" list under the main one (all stores' offers still shown, that store highlighted). Unstar a card to send it back. Each card in a store list has a faint **+** to add copies (it then shows **− 2× +**); the store totals count every copy. Each store list has a **Print** button for a printable sheet with that store's credit and cash prices (line totals per quantity). Once you've entered the list on the store's own buylist, **Clear list** removes those cards from your sell list for good (after a confirmation; they don't go back to the main list).
- When buying, move the starred wishlist cards into a list you name (e.g. "Check Lands"), or add them to one you already made. Each list is its own section under the wishlist, with its own totals. Each list, and the main wishlist, has a **Print** button for a sheet of just those cards: every store's price and stock, the cheapest in-stock store in bold with a ★, and per-store totals. Unstar a card to send it back; a list disappears when its last card leaves.
- The best store per card is highlighted:
  - selling: the highest offer
  - buying: the cheapest copy **in stock** (sold-out prices are shown greyed and never win)
- Click a store's column header to leave it out of the comparison (e.g. online-only stores when selling in person): its column turns grey and the best price moves to the next store. Click again to bring it back. Selling and Buying each remember their own choice.
- Totals for "everything at one store", with how many cards each store doesn't buy or doesn't have in stock.
- Near Mint, English cards only.

## Getting started

Requires Node.js 18 or newer (uses the built-in `fetch`).

```bash
npm install
npm start
```

Then open http://localhost:3000. Set `PORT` to use another port.

From a phone or another computer on the same Wi-Fi, open `http://<this computer's IP>:3000` (e.g. `http://192.168.1.20:3000`): the server listens on every network interface. Copying a card name still works there. Note that anyone on that network can then open the page and change your lists; there's no login.

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
  http.js              store requests: User-Agent, 15 s timeout, retries
  match.js             merges offers from all stores into one row per printing
  normalize.js         names, finishes, versions, set names, matching keys
  storepass.js         shared fetching for Storepass-hosted buylists
public/              the web page (vanilla HTML/CSS/JS)
docs/                architecture, per-store reference, product decisions
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
| GET | `/api/suggest?q=<text>` | Up to 20 card names starting like `text`, from Scryfall: `{ names }` (empty if Scryfall can't be reached) |
| GET / PUT | `/api/list?mode=sell\|buy` | Read / replace the saved list |
| POST | `/api/refresh?mode=sell\|buy` | Re-fetch prices for every card in the list, or only the cards in an optional `{ "keys": [...] }` body |

### Adding a store

1. Find the store's search data, ideally a JSON request in the browser's network tab, otherwise the HTML.
2. Check what the site displays: some show **cash**, others show **credit** directly.
3. Create `stores/<store>.js` exporting `{ id, label, creditNote, links, search, searchRetail }`, returning the offer shapes above (each with a `url` to the card at the store).
4. Add it to `stores/index.js`. The UI adds a column automatically.

The full checklist is in [docs/STORES.md](docs/STORES.md#adding-a-store).

## Disclaimer

This is an unofficial personal tool and isn't affiliated with any of the stores. It reads the same public data their websites show. Prices and credit bonuses change, and stores' own sites and policies are authoritative. Please keep usage light.
