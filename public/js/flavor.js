// Built-in coffee knowledge: maps tasting notes (Dutch + English) to flavor families,
// and estimates acidity / sweetness / body / bitterness from notes, process and altitude.
// No AI involved: just a word list and some rules of thumb.

export const FAMILIES = [
  { key: 'berry', label: 'Berries & red fruit', short: 'Berries', words: ['aardbei', 'bes', 'bessen', 'bosvrucht', 'braam', 'framboos', 'kers', 'cherry', 'berry', 'berries', 'strawberry', 'raspberry', 'cranberry', 'rode vrucht', 'red fruit', 'cassis', 'rode aalbes'] },
  { key: 'citrus', label: 'Citrus', short: 'Citrus', words: ['limoen', 'citroen', 'sinaasappel', 'mandarijn', 'tangerine', 'grapefruit', 'pompelmoes', 'bergamot', 'lime', 'lemon', 'orange', 'citrus', 'yuzu', 'clementine'] },
  { key: 'tropical', label: 'Tropical fruit', short: 'Tropical', words: ['tropisch', 'tropical', 'ananas', 'pineapple', 'mango', 'passievrucht', 'passion', 'papaya', 'lychee', 'litchi', 'banaan', 'banana', '^kiwi', 'guave', 'guava'] },
  { key: 'stone', label: 'Stone fruit', short: 'Stone fruit', words: ['perzik', 'abrikoos', 'steenfruit', 'nectarine', 'peach', 'apricot', 'stone fruit', 'pruim', 'plum', 'geel fruit', 'yellow fruit'] },
  { key: 'ripe', label: 'Ripe, dried & winey', short: 'Winey', words: ['gedroogd', 'dried', 'rozijn', 'raisin', 'dadel', '^date', 'vijg', '^fig', 'likeur', 'liqueur', 'wijn', 'winey', '^wine', '^rum', 'rijp fruit', 'ripe fruit', 'druif', 'grape', 'boozy', 'gefermenteerd', 'fermented'] },
  { key: 'floral', label: 'Floral', short: 'Floral', words: ['floraal', 'floral', 'jasmijn', 'jasmine', 'bloesem', 'blossom', 'roos', '^rose', 'lavendel', 'lavender', 'hibiscus', 'bloem', 'flower', 'vlier', 'elderflower'] },
  { key: 'chocolate', label: 'Chocolate & cacao', short: 'Chocolate', words: ['chocolade', 'chocolate', 'cacao', 'cocoa', 'choco'] },
  { key: 'nutty', label: 'Nutty', short: 'Nutty', words: ['noot', 'noten', '^nut', 'notig', 'hazelnoot', 'hazelnut', 'amandel', 'almond', 'walnoot', 'walnut', 'pecan', 'nougat', 'praline', 'pinda', 'peanut', 'cashew', 'marsepein', 'marzipan'] },
  { key: 'caramel', label: 'Caramel & sweet', short: 'Caramel', words: ['karamel', 'caramel', 'honing', 'honey', 'suiker', 'sugar', 'vanille', 'vanilla', 'toffee', 'ahorn', 'maple', 'brûlée', 'brulee', 'siroop', 'syrup', 'zoet', 'sweet', 'butterscotch', 'stroop', 'melasse', 'molasses', 'marshmallow', 'speculoos', 'koekje', 'biscuit', 'cookie'] },
  { key: 'spice', label: 'Spice', short: 'Spice', words: ['kruidig', 'spicy', 'spice', 'kaneel', 'cinnamon', 'kruidnagel', 'clove', 'peper', 'pepper', 'nootmuskaat', 'nutmeg', 'gember', 'ginger', 'kardemom', 'cardamom', 'anijs', '^cola', 'tabak', 'tobacco'] },
  { key: 'tea', label: 'Tea & herbal', short: 'Tea', words: ['thee', '^tea', 'kruiden', 'herbal', 'munt', '^mint', 'earl grey', 'kamille', 'chamomile', 'citroengras', 'lemongrass', 'groen', 'green'] },
];

// Words that say something about mouthfeel rather than a flavor family.
const CREAMY = ['romig', 'creamy', 'crème', 'creme', 'boter', 'butter', 'body', '^vol', 'volle', 'full', 'zijdezacht', 'silky'];
const DARK = ['pure chocolade', 'donkere chocolade', 'dark chocolate', 'cacao', 'cocoa', 'cacao nibs', 'bitter'];

const norm = (s) => s.toLowerCase().normalize('NFC');
// Words starting with ^ must be a whole word ("cola" is not in "chocolade");
// all others may be part of a Dutch compound word ("melkchocolade", "oranjebloesem").
const hasWord = (text, w) =>
  w.startsWith('^') ? new RegExp(`(^|[^a-zà-ÿ])${w.slice(1)}([^a-zà-ÿ]|$)`).test(text) : text.includes(w);

export function familiesOfNote(note) {
  const t = norm(note);
  // "melkchocolade" is chocolate, "notig" nutty; "sinaasappelbloesem" both citrus & floral.
  return FAMILIES.filter((f) => f.words.some((w) => hasWord(t, w))).map((f) => f.key);
}

export function familiesOf(coffee) {
  const set = new Set();
  for (const n of coffee.notes || []) familiesOfNote(n).forEach((k) => set.add(k));
  return [...set];
}

const clamp = (v, lo = 1, hi = 5) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

// Estimated 1–5 scale for four classic attributes.
export function estimateAttributes(coffee) {
  const fam = new Set(familiesOf(coffee));
  const notesText = norm((coffee.notes || []).join(' | '));
  const f = (k) => (fam.has(k) ? 1 : 0);
  const mods = coffee.modifiers || [];
  const p = coffee.process;
  const alt = coffee.altitude;
  const dark = DARK.some((w) => notesText.includes(w)) ? 1 : 0;
  const creamy = CREAMY.some((w) => hasWord(notesText, w)) ? 1 : 0;

  let acidity = 3 + 1.0 * f('citrus') + 0.5 * f('berry') + 0.3 * f('tropical') + 0.3 * f('stone') + 0.5 * f('floral') + 0.3 * f('tea')
    - 0.5 * f('chocolate') - 0.5 * f('nutty') - 0.3 * f('spice') - 0.2 * f('caramel');
  if (alt) acidity += alt >= 1850 ? 0.5 : alt >= 1600 ? 0.2 : alt < 1250 ? -0.5 : 0;
  if (p === 'Washed') acidity += 0.3;
  if (p === 'Natural') acidity -= 0.2;
  if (notesText.includes('gebalanceerd') || notesText.includes('balanced')) acidity = (acidity + 3) / 2;

  let sweetness = 3 + 1.0 * f('caramel') + 0.5 * f('berry') + 0.5 * f('stone') + 0.4 * f('tropical') + 0.4 * f('ripe') - 0.3 * f('tea') - 0.2 * dark;
  if (p === 'Natural') sweetness += 0.5;
  if (p === 'Honey') sweetness += 0.7;
  if (mods.includes('Anaerobic') || mods.includes('Co-fermented')) sweetness += 0.3;

  let body = 3 + 0.7 * f('chocolate') + 0.5 * f('nutty') + 1.0 * creamy + 0.3 * f('ripe') + 0.3 * f('spice') + 0.2 * f('caramel')
    - 0.5 * f('floral') - 0.5 * f('tea') - 0.3 * f('citrus');
  if (p === 'Natural') body += 0.4;
  if (p === 'Honey') body += 0.3;
  if (p === 'Washed') body -= 0.3;

  let bitterness = 2.5 + 0.8 * dark + 0.3 * f('chocolate') + 0.3 * f('nutty') + 0.3 * f('spice')
    - 0.3 * f('caramel') - 0.3 * f('floral') - 0.2 * f('berry') - 0.2 * f('tropical');
  if (coffee.type === 'Blend') bitterness += 0.2;

  return {
    acidity: round1(clamp(acidity)),
    sweetness: round1(clamp(sweetness)),
    body: round1(clamp(body)),
    bitterness: round1(clamp(bitterness)),
  };
}

export const ATTRIBUTES = [
  { key: 'acidity', label: 'Acidity', low: 'soft', high: 'bright' },
  { key: 'sweetness', label: 'Sweetness', low: 'dry', high: 'sweet' },
  { key: 'body', label: 'Body', low: 'light', high: 'full' },
  { key: 'bitterness', label: 'Bitterness', low: 'mild', high: 'bitter' },
];

export function bucket(v) {
  return v < 2.75 ? 'low' : v > 3.5 ? 'high' : 'medium';
}

export function altitudeBand(a) {
  if (!a) return null;
  return a < 1300 ? '< 1300 m' : a < 1600 ? '1300–1600 m' : a < 1900 ? '1600–1900 m' : '1900 m +';
}

export const familyLabel = (k) => FAMILIES.find((f) => f.key === k)?.label || k;
export const familyShort = (k) => FAMILIES.find((f) => f.key === k)?.short || k;
