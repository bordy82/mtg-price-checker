// Registry of stores. To add a store, create an adapter exporting
// { id, label, creditNote,
//   logo               -> its square logo in public/ (column headers; optional, the label shows without one),
//   logoDark           -> optional variant for the dark theme, when the logo doesn't read on it,
//   online             -> true for a mail-order store: the page puts its column after the in-person stores' (#83),
//   links: { buy, sell }  -> store search pages with `{q}` for the card name (links for cards saved without one),
//   search(name)       -> buylist offers  { ...printing, cash, credit },
//   searchRetail(name) -> retail listings { ...printing, price, stock } }
// and list it here. The page shows in-person stores first, in this order, then online ones.

module.exports = [
  require('./facetoface'),
  require('./collectedition'),
  require('./401games'),
  require('./gamekeeper'),
  require('./hobbiesville'),
];
