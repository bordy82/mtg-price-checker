// Shared helpers that turn each store's naming quirks into comparable values.

const round2 = (n) => Math.round(n * 100) / 100;

// "057" -> "57", "253s" -> "253s", "CMD-261" -> "cmd-261", "252★" -> "252"
function normCollector(cn) {
  if (cn === undefined || cn === null) return '';
  return String(cn).trim().toLowerCase().replace(/★/g, '').replace(/^0+(?=\w)/, '');
}

// Map every store's finish label onto one vocabulary.
function normFinish(label) {
  const s = String(label || '').toLowerCase().replace(/[-_]/g, ' ').trim();
  if (!s || s === 'non foil' || s === 'nonfoil' || s === 'normal') return 'nonfoil';
  if (s.includes('etched')) return 'etched';
  if (s === 'foil') return 'foil';
  return s; // "surge foil", "pool party foil", "galaxy foil", ...
}

// Stores disagree on special foil names ("Rainbow Foil" vs "Foil"), so matching uses broad groups.
function finishGroup(finish) {
  if (finish === 'nonfoil' || finish === 'etched') return finish;
  return 'foil';
}

const TREATMENT_ALIASES = {
  'default art': null,
  'extended': 'Extended Art',
  'extended art': 'Extended Art',
  'borderless': 'Borderless',
  'showcase': 'Showcase',
  'full art': 'Full Art',
  'retro frame': 'Retro Frame',
  'promotional': 'Promo',
  'promo': 'Promo',
  'serialized': 'Serial Numbered',
  'serial numbered': 'Serial Numbered',
};

function normTreatment(label) {
  const key = String(label || '').trim().toLowerCase();
  if (key in TREATMENT_ALIASES) return TREATMENT_ALIASES[key];
  return String(label).trim();
}

function normName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9/]+/g, ' ').trim();
}

// Stores join two-name cards differently ("A // B", "A - B"); the front name is what they share.
function frontName(name) {
  return String(name || '').split(/ \/\/ | - /)[0].trim();
}

// Serialized copies use a "z" collector number at some stores ("748z") and a "Serial Numbered" tag on
// the plain number at others ("LTR-748"). Treat either as serialized so they never merge with regular copies.
const isSerialized = ({ collectorNumber, treatments = [] }) =>
  /\dz$/i.test(String(collectorNumber || '')) || treatments.some((t) => /serial/i.test(t));

// Identity of a printing across stores. Primary key uses the set code; alternate keys use other
// codes the store knows (altSetCodes) and the set name, since stores' codes differ (CEI vs IED...).
function printingKeys(offer) {
  const { setCode, altSetCodes = [], setName, collectorNumber, finish } = offer;
  if (!collectorNumber) return [];
  let number = normCollector(collectorNumber);
  if (isSerialized(offer) && !number.endsWith('z')) number += 'z';
  const tail = [number, finishGroup(finish)].join('|');
  const codes = [setCode, ...altSetCodes].filter(Boolean).map((c) => String(c).toLowerCase());
  const keys = [...new Set(codes)].map((c) => `${c}|${tail}`);
  if (setName) keys.push(`name:${looseSetName(setName)}|${tail}`);
  return keys;
}

// Set names vary by store ("Commander: Adventures in the Forgotten Realms" vs
// "Adventures In The Forgotten Realms: Commander"), so compare them as sorted word sets.
const SET_STOPWORDS = new Set(['the', 'of', 'in', 'and', 'a', 'universes', 'beyond', 'edition', 'limited']);
function looseSetName(setName) {
  const words = normName(String(setName || '').replace(/(\d),(\d)/g, '$1$2'))
    .split(' ')
    .filter((w) => w && !SET_STOPWORDS.has(w));
  return [...new Set(words)].sort().join(' ');
}

// Stores label versions with extra words ("Borderless Poster", "Showcase Scrolls", "Bundle Promo"),
// so loose matching compares only these core words. Labels with none of them are kept as-is.
const CORE_VERSIONS = [
  [/borderless/, 'borderless'],
  [/showcase/, 'showcase'],
  [/extended/, 'extended art'],
  [/retro|old frame/, 'retro frame'],
  [/full art/, 'full art'],
  [/promo|prerelease|bundle/, 'promo'],
  [/serial/, 'serial numbered'],
];
function coreVersions(treatments) {
  const out = new Set();
  for (const t of treatments) {
    const label = String(t).toLowerCase();
    const hits = CORE_VERSIONS.filter(([re]) => re.test(label)).map(([, core]) => core);
    (hits.length ? hits : [label]).forEach((v) => out.add(v));
  }
  return [...out].sort();
}

// Fallback identity for stores without collector numbers: front-face name + set + finish + versions.
function looseKey(offer) {
  const { name, setName, finish, treatments = [] } = offer;
  const front = normName(frontName(name));
  const versions = coreVersions(isSerialized(offer) ? [...treatments, 'Serial Numbered'] : treatments).join(',');
  return ['loose', front, looseSetName(setName), finishGroup(finish), versions].join('|');
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) mtg-price-checker/0.1';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

module.exports = { round2, normCollector, normFinish, normTreatment, normName, frontName, finishGroup, printingKeys, looseKey, getJson, UA };
