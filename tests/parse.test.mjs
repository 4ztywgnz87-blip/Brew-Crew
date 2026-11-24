import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseProduct, parseProcess, parseAltitude, decode } from '../public/js/parse.js';
import { slugFromUrl } from '../functions/_lib/crossroast.js';
import { findLinks } from '../public/js/api.js';

const cat = JSON.parse(fs.readFileSync(new URL('./fixtures/catalog.json', import.meta.url)));
const bySlug = (s) => parseProduct(cat.find((p) => p.slug === s));

test('parses El Salvador – Las Brisas', () => {
  const c = bySlug('el-salvador-las-brisas');
  assert.equal(c.name, 'El Salvador – Las Brisas');
  assert.deepEqual(c.countries, ['El Salvador']);
  assert.equal(c.process, 'Natural');
  assert.deepEqual(c.modifiers, ['Anaerobic']);
  assert.deepEqual(c.notes, ['Aardbei', 'Gedroogde pruim', 'Cacao']);
  assert.equal(c.variety, 'Pacas');
  assert.equal(c.altitude, 1450);
  assert.equal(c.harvest, '2025'); // description wins over stale attribute
  assert.equal(c.type, 'Single origin');
  assert.ok(c.story.startsWith('Carlos Pola'));
  assert.ok(c.image.startsWith('https://www.crossroast.be/'));
  assert.ok(c.priceFrom > 5);
});

test('parses Colombia – El Para (washed)', () => {
  const c = bySlug('colombia-el-para');
  assert.equal(c.process, 'Washed');
  assert.deepEqual(c.notes, ['Pure chocolade', 'Zwarte thee', 'Limoen']);
  assert.equal(c.harvest, '2026');
});

test('parses blends with multiple origins', () => {
  const c = parseProduct(cat.find((p) => p.name === 'Mundi'));
  assert.equal(c.type, 'Blend');
  assert.deepEqual(c.countries, ['Brazil', 'Colombia', 'Ethiopia']);
  assert.equal(c.process, 'Mixed');
});

test('every catalog coffee gets a name, process and notes', () => {
  for (const p of cat) {
    const c = parseProduct(p);
    assert.ok(c.name && c.process && c.notes.length, p.slug);
    assert.ok(!c.story.includes('{'), `css leaked into story of ${p.slug}`);
  }
});

test('process parsing', () => {
  assert.deepEqual(parseProcess('Pulped natural'), { group: 'Honey', modifiers: [] });
  assert.deepEqual(parseProcess('Honey – co ferment blackberry'), { group: 'Honey', modifiers: ['Co-fermented'] });
  assert.deepEqual(parseProcess('Natural Anearobic'), { group: 'Natural', modifiers: ['Anaerobic'] });
  assert.deepEqual(parseProcess('Washed / E.A. decaf'), { group: 'Washed', modifiers: ['Decaf'] });
  assert.equal(parseProcess('Natural – Washed – Honey').group, 'Mixed');
});

test('altitude & entities', () => {
  assert.equal(parseAltitude('1300 M – 1600 M'), 1450);
  assert.equal(parseAltitude('+ 2000 M'), 2000);
  assert.equal(parseAltitude('1.700 meter'), 1700);
  assert.equal(decode('El Salvador &#8211; Las Brisas'), 'El Salvador – Las Brisas');
});

test('link handling', () => {
  assert.equal(slugFromUrl('https://www.crossroast.be/product/el-salvador-las-brisas/'), 'el-salvador-las-brisas');
  assert.equal(slugFromUrl('crossroast.be/product/colombia-el-para/?attribute_pa_hoeveelheid=250-gram'), 'colombia-el-para');
  assert.equal(slugFromUrl('https://evil.example/product/x/'), null);
  assert.deepEqual(findLinks('look https://www.crossroast.be/product/a-b/ and\nhttps://www.crossroast.be/product/c-d/ https://www.crossroast.be/product/a-b/'), ['a-b', 'c-d']);
});
