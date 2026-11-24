// Turns a (trimmed) Cross Roast product into a Brew Crew coffee record.
// The product description holds "<strong>Label</strong><br>Value" pairs, which are
// more up to date than the WooCommerce attributes, so we prefer those.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', euml: 'ë', eacute: 'é', egrave: 'è', iuml: 'ï', ouml: 'ö', uuml: 'ü', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

export function decode(s = '') {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripTags(html = '') {
  return decode(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

const COUNTRY = {
  'brazilië': 'Brazil', brasil: 'Brazil', brazil: 'Brazil', 'brazilie': 'Brazil',
  'ethiopië': 'Ethiopia', ethiopie: 'Ethiopia', ethiopia: 'Ethiopia',
  'indonesië': 'Indonesia', indonesie: 'Indonesia', indonesia: 'Indonesia',
  kenia: 'Kenya', kenya: 'Kenya', png: 'Papua New Guinea', 'papua new guinea': 'Papua New Guinea', 'papoea-nieuw-guinea': 'Papua New Guinea',
  colombia: 'Colombia', peru: 'Peru', 'el salvador': 'El Salvador', 'costa rica': 'Costa Rica', burundi: 'Burundi',
  guatemala: 'Guatemala', mexico: 'Mexico', malawi: 'Malawi', rwanda: 'Rwanda', honduras: 'Honduras', nicaragua: 'Nicaragua',
  panama: 'Panama', bolivia: 'Bolivia', ecuador: 'Ecuador', oeganda: 'Uganda', uganda: 'Uganda', tanzania: 'Tanzania',
  jemen: 'Yemen', yemen: 'Yemen', india: 'India', china: 'China', vietnam: 'Vietnam', 'dr congo': 'DR Congo', congo: 'DR Congo',
};

export function normCountry(s) {
  if (!s) return null;
  const k = s.trim().toLowerCase();
  if (COUNTRY[k]) return COUNTRY[k];
  return s.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function splitList(s) {
  if (!s) return [];
  return s
    .split(/\s+[–—-]\s+|\s*\/\s*|,|\s*\+\s*|\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// Process → a base group plus extra modifiers.
export function parseProcess(text) {
  const t = (text || '').toLowerCase();
  const has = (re) => re.test(t);
  const bases = [];
  if (has(/pulped natural|honey/)) bases.push('Honey');
  if (has(/(?<!pulped )natural/)) bases.push('Natural');
  if (has(/washed|gewassen/) && !has(/semi[ -]?washed/)) bases.push('Washed');
  if (has(/semi[ -]?washed|wet[ -]?hulled/)) bases.push('Washed');
  const uniq = [...new Set(bases)];
  let group = uniq.length === 1 ? uniq[0] : uniq.length > 1 ? 'Mixed' : text ? 'Other' : null;
  const mods = [];
  if (has(/ana?er?obic|anearobic/)) mods.push('Anaerobic');
  if (has(/co[ -]?ferment/)) mods.push('Co-fermented');
  if (has(/carbonic/)) mods.push('Carbonic maceration');
  if (has(/decaf/)) mods.push('Decaf');
  return { group, modifiers: mods };
}

export function parseAltitude(text) {
  const nums = (text || '').replace(/\./g, '').match(/\d{3,4}/g);
  if (!nums) return null;
  const n = nums.map(Number).filter((x) => x >= 300 && x <= 3000);
  if (!n.length) return null;
  return Math.round(n.reduce((a, b) => a + b, 0) / n.length);
}

function descPairs(html) {
  const out = {};
  const re = /<strong>([\s\S]*?)<\/strong>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const key = stripTags(m[1]).toLowerCase();
    const val = stripTags(m[2]).replace(/\n+/g, ' ').trim();
    if (key && val && !out[key]) out[key] = val;
  }
  return out;
}

function storyFrom(html) {
  const plain = stripTags(html || '').replace(/#[\w-]+[^{}\n]*\{[^}]*\}/g, '');
  const i = plain.toLowerCase().indexOf('meer info over deze koffie');
  if (i < 0) return '';
  let s = plain.slice(i + 'meer info over deze koffie'.length);
  const stop = s.search(/\n(Zetmethodes|Wil je graag meer weten)/i);
  if (stop >= 0) s = s.slice(0, stop);
  return s.replace(/\nLees meer\n/gi, '\n').replace(/[ \t]*\n[ \t\n]*/g, '\n').trim();
}

export function parseProduct(p) {
  const pairs = descPairs(p.description);
  const attr = Object.fromEntries((p.attributes || []).map((a) => [a.name.toLowerCase(), a.terms]));
  const get = (...keys) => keys.map((k) => pairs[k]).find(Boolean) || null;

  const fullName = decode(p.name || '').trim();
  const categories = p.categories || [];
  const isBlend = categories.includes('Blend') || (!!pairs['origine'] && !pairs['variëteit']);

  const nameParts = fullName.split(/\s+[–—-]\s+/);
  let countries = [];
  if (pairs['origine']) countries = splitList(pairs['origine']).map(normCountry);
  else if (nameParts.length > 1 && normCountry(nameParts[0]) && COUNTRY[nameParts[0].toLowerCase()]) countries = [normCountry(nameParts[0])];
  else if (attr['origine']?.length) countries = attr['origine'].map(normCountry);
  countries = [...new Set(countries.filter(Boolean))];

  const processText = get('processing', 'proces', 'process', 'verwerking') || (attr['processing'] || []).join(' – ') || null;
  const process = parseProcess(processText);
  const notesText = get('tasting notes', 'smaaknoten', 'smaak') || (attr['tasting notes'] || []).join(' – ');
  const notes = canonicalNotes(splitList(notesText));
  const altitudeText = get('hoogte plantage', 'hoogte', 'altitude');

  const minor = p.prices?.minor ?? 2;
  const money = (v) => (v == null || v === '' || !Number(v) ? null : Number(v) / 10 ** minor);

  return {
    slug: p.slug,
    url: p.permalink || `https://www.crossroast.be/product/${p.slug}/`,
    name: fullName,
    shortName: get('naam koffie') || nameParts.slice(1).join(' – ') || fullName,
    type: isBlend ? 'Blend' : 'Single origin',
    countries,
    variety: get('variëteit', 'varieteit', 'variety') || (attr['variëteit'] || []).join(', ') || null,
    processText,
    process: process.group,
    modifiers: process.modifiers,
    altitudeText,
    altitude: parseAltitude(altitudeText),
    harvest: get('crop / harvest', 'harvest', 'oogst'),
    notes,
    story: storyFrom(p.description),
    intro: stripTags(p.short_description || ''),
    image: p.image?.src || null,
    thumb: p.image?.thumbnail || p.image?.src || null,
    priceFrom: money(p.prices?.min),
    inStock: p.in_stock ?? null,
  };
}

// Regions as Cross Roast groups them on its site.
const REGION = {
  Africa: ['Ethiopia', 'Kenya', 'Burundi', 'Rwanda', 'Uganda', 'Tanzania', 'Malawi', 'DR Congo', 'Zambia', 'Zimbabwe'],
  'Central America': ['El Salvador', 'Guatemala', 'Costa Rica', 'Honduras', 'Nicaragua', 'Panama', 'Mexico'],
  'South America': ['Colombia', 'Peru', 'Brazil', 'Bolivia', 'Ecuador'],
  Asia: ['Indonesia', 'India', 'China', 'Vietnam', 'Yemen', 'Myanmar', 'Thailand'],
  Oceania: ['Papua New Guinea', 'Australia'],
};
export const REGIONS = Object.keys(REGION);
export function regionsOf(coffee) {
  return [...new Set((coffee.countries || []).map((c) => REGIONS.find((r) => REGION[r].includes(c))).filter(Boolean))];
}

// Cross Roast writes tasting notes sometimes in Dutch, sometimes in English.
// Everything is mapped to one English name, so "Bosbes" and "Blueberry" are the same note.
const NOTE_EN = {
  aardbei: 'Strawberry', aardbeien: 'Strawberry', framboos: 'Raspberry', frambozen: 'Raspberry',
  braambes: 'Blackberry', braambessen: 'Blackberry', bramen: 'Blackberry', blackberries: 'Blackberry',
  bosbes: 'Blueberry', bosbessen: 'Blueberry', 'blauwe bes': 'Blueberry', 'blauwe bessen': 'Blueberry', blueberries: 'Blueberry',
  bosvruchten: 'Forest fruits', bosvrucht: 'Forest fruits', 'forest fruit': 'Forest fruits', 'rode vruchten': 'Red fruits', 'red fruit': 'Red fruits',
  bessen: 'Berries', bes: 'Berries', berry: 'Berries', cassis: 'Blackcurrant', 'zwarte bes': 'Blackcurrant', 'rode bes': 'Redcurrant', 'rode aalbes': 'Redcurrant',
  kers: 'Cherry', kersen: 'Cherry', cherries: 'Cherry', 'donkere kers': 'Dark cherry', 'donkere kersen': 'Dark cherry',
  druif: 'Grape', druiven: 'Grape', grapes: 'Grape', rozijn: 'Raisin', rozijnen: 'Raisin', vijg: 'Fig', dadel: 'Date',
  limoen: 'Lime', citroen: 'Lemon', sinaasappel: 'Orange', appelsien: 'Orange', mandarijn: 'Mandarin', tangerine: 'Tangerine',
  pompelmoes: 'Grapefruit', 'geconfijte sinaasappel': 'Candied orange', bergamot: 'Bergamot',
  perzik: 'Peach', abrikoos: 'Apricot', pruim: 'Plum', pruimen: 'Plum', 'gedroogde pruim': 'Dried plum', 'gedroogde pruimen': 'Dried plum',
  steenfruit: 'Stone fruit', 'gedroogd steenfruit': 'Dried stone fruit', 'geel fruit': 'Yellow fruit', 'rijp fruit': 'Ripe fruit',
  'tropisch fruit': 'Tropical fruit', ananas: 'Pineapple', mango: 'Mango', passievrucht: 'Passion fruit', banaan: 'Banana', appel: 'Apple', peer: 'Pear',
  likeur: 'Liqueur', wijnachtig: 'Winey', wijn: 'Wine',
  floraal: 'Floral', bloemig: 'Floral', jasmijn: 'Jasmine', oranjebloesem: 'Orange blossom', roos: 'Rose', lavendel: 'Lavender', vlierbloesem: 'Elderflower',
  chocolade: 'Chocolate', choco: 'Chocolate', 'pure chocolade': 'Dark chocolate', 'donkere chocolade': 'Dark chocolate', 'fondant chocolade': 'Dark chocolate',
  melkchocolade: 'Milk chocolate', 'witte chocolade': 'White chocolate', cacao: 'Cacao', cocoa: 'Cacao', 'cacao nibs': 'Cacao nibs', cacaonibs: 'Cacao nibs',
  noten: 'Nuts', notig: 'Nutty', noot: 'Nuts', hazelnoot: 'Hazelnut', hazelnoten: 'Hazelnut', amandel: 'Almond', amandelen: 'Almond',
  'geroosterde amandel': 'Roasted almond', 'geroosterde amandelen': 'Roasted almond', walnoot: 'Walnut', walnoten: 'Walnut',
  'geroosterde walnoot': 'Roasted walnut', 'geroosterde walnoten': 'Roasted walnut', pecannoot: 'Pecan', pinda: 'Peanut', marsepein: 'Marzipan',
  karamel: 'Caramel', honing: 'Honey', 'bruine suiker': 'Brown sugar', rietsuiker: 'Cane sugar', vanille: 'Vanilla', ahorn: 'Maple', ahornsiroop: 'Maple syrup',
  stroop: 'Syrup', melasse: 'Molasses', zoet: 'Sweet', toffee: 'Toffee', speculoos: 'Speculoos', koekje: 'Biscuit',
  kruidig: 'Spicy', kaneel: 'Cinnamon', kruidnagel: 'Clove', nootmuskaat: 'Nutmeg', gember: 'Ginger', peper: 'Pepper', kardemom: 'Cardamom', tabak: 'Tobacco',
  'zwarte thee': 'Black tea', 'groene thee': 'Green tea', thee: 'Tea', kruiden: 'Herbal', munt: 'Mint',
  romig: 'Creamy', crème: 'Cream', creme: 'Cream', boter: 'Buttery', boterig: 'Buttery', gebalanceerd: 'Balanced', 'gebalanceerde aciditeit': 'Balanced acidity',
  'crème brûlée': 'Crème brûlée',
};
export function canonicalNote(note) {
  const t = String(note || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const k = t.toLowerCase();
  if (NOTE_EN[k]) return NOTE_EN[k];
  return k.charAt(0).toUpperCase() + k.slice(1);
}
export const canonicalNotes = (notes) => [...new Set((notes || []).map(canonicalNote).filter(Boolean))];
