import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser shims so store.js can run in Node.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.alert = () => {};
globalThis.indexedDB = { open: () => ({}) };
mem.set('brewcrew.v1', JSON.stringify({
  version: 1, people: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }],
  orders: [{ id: 'o1', date: '2026-01-02', note: '' }],
  coffees: [{ id: 'c1', slug: 'old', name: 'Old', notes: ['Pure chocolade', 'Dark chocolate'], orderId: 'o1', scores: { a: { score: 8 } } }],
}));
const store = await import('../public/js/store.js');
const { db } = store;

test('old data is migrated on load', () => {
  const c = store.getCoffee('c1');
  assert.deepEqual(c.orderIds, ['o1']);
  assert.equal(c.orderId, undefined);
  assert.deepEqual(c.notes, ['Dark chocolate']);
});

test('adding a coffee again adds it to another order instead of duplicating', () => {
  const o2 = store.createOrder('2026-02-01');
  const r = store.addCoffee({ slug: 'old', name: 'Old', notes: [] }, o2.id);
  assert.equal(r.existed, true);
  assert.equal(db.coffees.filter((c) => c.slug === 'old').length, 1);
  assert.deepEqual(store.coffeeOrders(store.getCoffee('c1')).map((o) => o.id), [o2.id, 'o1']);
  store.removeFromOrder('c1', o2.id);
  assert.deepEqual(store.getCoffee('c1').orderIds, ['o1']);
});

test('deleting an order keeps the coffee', () => {
  const o = store.createOrder('2026-03-01');
  const { coffee } = store.addCoffee({ slug: 'new', name: 'New', notes: ['Kers'] }, o.id);
  assert.deepEqual(coffee.notes, ['Cherry']);
  store.deleteOrder(o.id);
  assert.deepEqual(store.getCoffee(coffee.id).orderIds, []);
});

test('a removed crew member gets their scores back when added again', () => {
  assert.equal(store.removePerson('a'), true);
  assert.deepEqual(db.people.map((p) => p.id), ['b']);
  assert.equal(store.removePerson('b'), false, 'never remove the last member');
  store.addPerson('ann');
  const ann = db.people.find((p) => p.name === 'ann');
  assert.equal(ann.id, 'a');
  assert.equal(store.getCoffee('c1').scores[ann.id].score, 8);
});

test('backup round-trip', () => {
  const json = store.exportData();
  store.wipe();
  assert.equal(db.coffees.length, 0);
  const n = store.importData(json);
  assert.equal(n, 2);
  assert.equal(store.getCoffee('c1').scores.a.score, 8);
  assert.throws(() => store.importData('{"hello":1}'), /not a Brew Crew backup/);
});
