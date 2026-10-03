// Registry of stores. To add a store, create an adapter exporting
// { id, label, creditNote,
//   search(name)       -> buylist offers  { ...printing, cash, credit },
//   searchRetail(name) -> retail listings { ...printing, price, stock } }
// and list it here.

module.exports = [
  require('./facetoface'),
  require('./collectedition'),
  require('./401games'),
  require('./gamekeeper'),
];
