import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseProduct } from '../public/js/parse.js';
import { familiesOfNote, estimateAttributes } from '../public/js/flavor.js';
import { preferences, predict, groupScore, verdict, summary, crewStats, radar, attributeTrends } from '../public/js/analysis.js';

const cat = JSON.parse(fs.readFileSync(new URL('./fixtures/catalog.json', import.meta.url))).map(parseProduct);
const people = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];

test('flavor families from Dutch and English notes', () => {
  assert.deepEqual(familiesOfNote('Pure chocolade'), ['chocolate']);
  assert.deepEqual(familiesOfNote('Melkchocolade'), ['chocolate']);
  assert.deepEqual(familiesOfNote('Aardbei'), ['berry']);
  assert.deepEqual(familiesOfNote('Limoen'), ['citrus']);
  assert.deepEqual(familiesOfNote('Oranjebloesem'), ['floral']);
  assert.deepEqual(familiesOfNote('Dark chocolate'), ['chocolate']);
  assert.ok(familiesOfNote('Geroosterde walnoten').includes('nutty'));
  assert.ok(familiesOfNote('Zwarte thee').includes('tea'));
});

test('every catalog note maps to at least one family (or is a texture word)', () => {
  const texture = /romig|crème|boter|gebalanceerd|aciditeit|zoet|notig|ahorn/i;
  const missing = [...new Set(cat.flatMap((c) => c.notes))].filter((n) => !familiesOfNote(n).length && !texture.test(n));
  assert.deepEqual(missing, []);
});

test('attribute estimates are sensible', () => {
  const kenya = estimateAttributes(cat.find((c) => c.slug === 'kenia-ibonia-estate'));
  const blend = estimateAttributes(cat.find((c) => c.name === 'Winter blend'));
  assert.ok(kenya.acidity > blend.acidity, 'Kenya brighter than chocolate/nut blend');
  assert.ok(blend.body > kenya.body, 'blend fuller');
  for (const v of Object.values(kenya)) assert.ok(v >= 1 && v <= 5);
});

// Synthetic crew: A loves naturals, hates washed.
function crewData() {
  return cat.slice(0, 20).map((c) => ({
    ...c,
    scores: {
      a: { score: c.process === 'Natural' ? 9 : c.process === 'Washed' ? 5 : 7 },
      b: { score: (c.notes.join(' ').toLowerCase().includes('chocolade') ? 8.5 : 6) },
      c: { score: c.process === 'Natural' ? 8.5 : c.process === 'Washed' ? 5.5 : 7 },
    },
  }));
}

test('preferences detect a process preference', () => {
  const prefs = preferences(crewData(), 'a', people);
  const proc = prefs.dims.process;
  assert.equal(proc[0].value, 'Natural');
  assert.equal(proc[proc.length - 1].value, 'Washed');
  assert.match(summary(crewData(), 'a', people).join(' '), /Natural/);
});

test('prediction follows preferences', () => {
  const data = crewData().slice(0, 15);
  const nat = cat.slice(20).find((c) => c.process === 'Natural');
  const wash = cat.slice(20).find((c) => c.process === 'Washed');
  const pn = predict(nat, data, 'a', people), pw = predict(wash, data, 'a', people);
  assert.ok(pn.score > pw.score, `${pn.score} > ${pw.score}`);
  assert.ok(pn.reasons.length > 0);
});

test('no prediction with too few scores', () => {
  assert.equal(predict(cat[0], crewData().slice(0, 2), 'a', people).score, null);
});

test('group score, verdicts, crew stats, radar', () => {
  const c = { scores: { a: { score: 8 }, b: { score: 7 }, c: { score: null } } };
  assert.equal(groupScore(c, people), 7.5);
  assert.equal(verdict(7.5), 'reorder');
  assert.equal(verdict(5.5), 'skip');
  assert.equal(verdict(6.5), 'ok');
  const cs = crewStats(crewData(), people);
  assert.equal(cs.pairs[0].a.id + cs.pairs[0].b.id, 'ac'); // A and C are taste twins
  const r = radar(preferences(crewData(), 'group', people));
  assert.equal(r.length, 11);
  assert.ok(r.every((x) => x.value >= 0 && x.value <= 10));
  assert.equal(attributeTrends(crewData(), 'b', people).length, 4);
});
