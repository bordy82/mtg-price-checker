# Product decisions

Choices the user made, often against an obvious alternative, so later reviews and cards don't propose them again.
One line each, with the issue where it was decided. **Check this list before proposing a feature.** To change one of
these, the user decides on a new card; update the line then.

## Lists

- **No "Best" column, and no "each card at its best store" total** (nor its "saves $x vs one store" note). The green cell already shows the best store (#7).
- **Quantities only in "Selling to \<store\>" lists.** The main sell list and the wishlist have none: too cramped there (#24). Even in store lists there's no Qty column, just a faint **+** that becomes **− 2× +** (#29).
- **Wishlist lists have no quantity** (#27).
- **A pasted list (Add a list) goes into the main list, without quantities**, not straight into a "Selling to \<store\>" list with its quantities (#53, the card's default).
- **Several "Selling to \<store\>" lists per store are numbered** ("Selling to Face to Face (2)"), not dated or named, and a list has no "waiting" or "sent" tag: the user picks the store's new list when moving cards (#72).
- **Select, then act, instead of a star.** Ticking a card only marks it: it isn't pinned to the top and no subtotal rows appear, so nothing on the page moves. A floating bar at the bottom of the window acts on the ticked cards. The selection isn't saved (#89).
- **The selection's per-store totals are in that bar**, under the store columns, instead of a "Starred" subtotal in the table. Per-store totals only, like the footer: still no "each card at its best store" total (#89).
- **Cards go back to the main list through Move to** ("My cards to sell" / "My wishlist"), not by un-starring (#89).
- **Clear list is only for sub-lists** ("Selling to \<store\>" lists, wishlist lists), never the main sell list or "My wishlist". Cleared cards leave for good, with a confirmation and no undo (#63, #77).
- **Wishlist sheets print every store** still in the comparison (price, stock, the cheapest in-stock one starred), not one store's prices like a "Selling to" sheet (#55).

## Page

- **Copying a card name shows "✓ Copied" right after the name, not a toast.** #25's toast was dropped at review (#32).
- **Store columns are headed by the store's square logo, not its name**, so columns stay narrow as stores are added. The name is in the tooltip, and stays everywhere else, print sheets included (#82).
- **In-person stores come first, online ones (401 Games, Hobbiesville) on the right**, by default. Columns are reordered by **dragging a header**, not with ← / → buttons, and the order is **one for both Selling and Buying** (unlike left-out stores, which each view keeps its own). The "Selling to \<store\>" sections and the move bar follow the column order (#83).

## Stores

- **Game Keeper's credit is cash + 30%**, though its French policy page says 50%. The user confirmed 30% before issues were tracked.
- **No getting around a store's bot check**: no headless or stealth browsers, challenge solving, copied `cf_clearance` cookies, or rotating User-Agents or IPs. A store behind one (Imaginaire, behind Cloudflare) gets an adapter only through a public endpoint or the store's own feed (#1).
- **Outside services other than the stores are called by the server, never by the page** (Scryfall's card names, #52).
- **A buylist with only TCGplayer's set names gets its set codes from Scryfall**, by TCGplayer product id (Cartes Sportives Rive-Sud), not from a table of set-name aliases or from the store's own shop titles. Without Scryfall, it falls back to set names (#80).
- **Retail stock is exact per variant.** When Cartes Sportives Rive-Sud's search page only gives a product's total (several variants in stock), its product page is read, rather than showing the total or "in stock" without a number (#80).
