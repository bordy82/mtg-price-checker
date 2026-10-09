# Product decisions

Choices the user made, often against an obvious alternative, so later reviews and cards don't propose them again.
One line each, with the issue where it was decided. **Check this list before proposing a feature.** To change one of
these, the user decides on a new card; update the line then.

## Lists

- **No "Best" column, and no "each card at its best store" total** (nor its "saves $x vs one store" note). The green cell already shows the best store (#7).
- **Quantities only in "Selling to \<store\>" lists.** The main sell list and the wishlist have none: too cramped there (#24). Even in store lists there's no Qty column, just a faint **+** that becomes **− 2× +** (#29).
- **Wishlist lists have no quantity** (#27).
- **Wishlist sheets print every store** still in the comparison (price, stock, the cheapest in-stock one starred), not one store's prices like a "Selling to" sheet (#55).

## Page

- **Copying a card name shows "✓ Copied" right after the name, not a toast.** #25's toast was dropped at review (#32).

## Stores

- **Game Keeper's credit is cash + 30%**, though its French policy page says 50%. The user confirmed 30% before issues were tracked.
- **No getting around a store's bot check**: no headless or stealth browsers, challenge solving, copied `cf_clearance` cookies, or rotating User-Agents or IPs. A store behind one (Imaginaire, behind Cloudflare) gets an adapter only through a public endpoint or the store's own feed (#1).
- **Outside services other than the stores are called by the server, never by the page** (Scryfall's card names, #52).
