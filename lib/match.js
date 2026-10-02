// Merge offers from every store into one row per printing (set + collector number + finish).
// mode 'sell': buylist offers { cash, credit }.  mode 'buy': retail listings { price, stock }.

const { printingKeys, looseKey, normName } = require('./normalize');

function mergeOffers(offers, query, mode = 'sell') {
  const wanted = normName(query);
  const rows = [];
  const byKey = new Map(); // any exact alias key -> row
  const byLoose = new Map(); // loose key -> Set of rows (more than one = ambiguous)

  function newRow(o, key) {
    const row = {
      key,
      keys: [],
      name: o.name,
      setCode: o.setCode,
      setName: o.setName,
      collectorNumber: o.collectorNumber,
      finish: o.finish,
      treatments: [],
      image: o.image,
      prices: {},
    };
    rows.push(row);
    return row;
  }

  function addToRow(row, o, keys) {
    for (const k of keys) {
      if (!row.keys.includes(k)) row.keys.push(k);
      if (!byKey.has(k)) byKey.set(k, row);
    }
    const lk = looseKey(o);
    if (!byLoose.has(lk)) byLoose.set(lk, new Set());
    byLoose.get(lk).add(row);

    row.treatments = [...new Set([...row.treatments, ...o.treatments])];
    // Prefer the more specific finish label ("Rainbow Foil" over "Foil").
    if (row.finish === 'foil' && o.finish !== 'foil') row.finish = o.finish;
    if (!row.image && o.image) row.image = o.image;
    if (!row.setName && o.setName) row.setName = o.setName;
    if (!row.setCode && o.setCode) row.setCode = o.setCode;
    if (!row.collectorNumber && o.collectorNumber) row.collectorNumber = o.collectorNumber;

    // If a store lists the same printing twice, keep its better offer.
    const prev = row.prices[o.store];
    if (mode === 'buy') {
      const entry = { price: o.price, stock: o.stock };
      if (!prev || betterListing(entry, prev)) row.prices[o.store] = entry;
    } else if (!prev || (o.credit ?? -1) > (prev.credit ?? -1)) {
      row.prices[o.store] = { cash: o.cash, credit: o.credit, retail: o.retail };
    }
  }

  // Stores do fuzzy matching; keep only cards whose name contains the query.
  const relevant = offers.filter((o) => !wanted || normName(o.name).includes(wanted));

  // Pass 1: offers with a collector number match on set + number + finish.
  const deferred = [];
  for (const o of relevant) {
    const keys = printingKeys(o);
    if (!keys.length) { deferred.push(o); continue; }
    const row = keys.map((k) => byKey.get(k)).find(Boolean) || newRow(o, keys[0]);
    addToRow(row, o, keys);
  }

  // Pass 2: offers without one join a row only when name + set + finish + versions is unambiguous.
  for (const o of deferred) {
    const lk = looseKey(o);
    const candidates = byLoose.get(lk);
    // Several printings share the key: an exact special-foil label ("surge foil") can still single one out.
    const pool = candidates ? [...candidates] : [];
    const narrowed = pool.length > 1 ? pool.filter((r) => r.finish === o.finish) : pool;
    const row = narrowed.length === 1 ? narrowed[0] : byKey.get(lk) || newRow(o, lk);
    addToRow(row, o, [lk]);
  }

  if (mode === 'buy') {
    // Keep printings some store lists; cheapest in-stock first, sold-out-everywhere last.
    return rows
      .filter((r) => Object.values(r.prices).some((p) => p.price > 0))
      .sort((a, b) => cheapestInStock(a) - cheapestInStock(b));
  }
  // Drop printings no store is currently buying.
  return rows.filter((r) => bestCredit(r) > 0).sort((a, b) => bestCredit(b) - bestCredit(a));
}

function bestCredit(row) {
  return Math.max(0, ...Object.values(row.prices).map((p) => p.credit || 0));
}

// In-stock beats sold out; then cheaper wins.
function betterListing(a, b) {
  if ((a.stock > 0) !== (b.stock > 0)) return a.stock > 0;
  return (a.price || Infinity) < (b.price || Infinity);
}

function cheapestInStock(row) {
  return Math.min(Infinity, ...Object.values(row.prices).filter((p) => p.stock > 0 && p.price > 0).map((p) => p.price));
}

module.exports = { mergeOffers };
