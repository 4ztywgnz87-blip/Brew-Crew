import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/cart.js';

// Fake crossroast.be: one coffee with 250 g / 500 g variations; one that is sold out.
function fakeShop() {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    if (u.endsWith('/wp-json/wc/store/v1/cart')) return json({ items: [] }, 200, { 'Cart-Token': 'tok123' });
    if (u.includes('/products?slug=good')) return json([{ id: 1, variations: [{ id: 11, attributes: [{ name: 'Hoeveelheid', value: '500-gram' }] }, { id: 12, attributes: [{ name: 'Hoeveelheid', value: '250-gram' }] }] }]);
    if (u.includes('/products?slug=soldout')) return json([{ id: 2, variations: [{ id: 21, attributes: [{ name: 'Hoeveelheid', value: '250-gram' }] }] }]);
    if (u.includes('/products?slug=')) return json([]);
    if (u.endsWith('/cart/add-item')) {
      const body = JSON.parse(opts.body);
      if (body.id === 21) return json({ message: 'Out of stock' }, 400);
      return json({ items: [body] }, 201);
    }
    return json({}, 404);
  };
  return calls;
}
const post = (body) => onRequestPost({ request: new Request('https://x/api/cart', { method: 'POST', body: JSON.stringify(body) }) });

test('builds a fresh cart with the right size and grind, and returns a hand-off link', async () => {
  const calls = fakeShop();
  const res = await post({ items: [{ slug: 'good' }, { slug: 'soldout' }, { slug: 'nope' }], size: '250-gram', grind: 'maling-bialetti' });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.url, 'https://www.crossroast.be/winkelmand/?session=tok123');
  assert.deepEqual(data.added, ['good']);
  assert.deepEqual(data.failed.map((f) => f.slug), ['soldout', 'nope']);
  const add = calls.find((c) => c.url.endsWith('/add-item') && JSON.parse(c.opts.body).id === 12);
  assert.ok(add, 'picked the 250 g variation');
  assert.equal(add.opts.headers['Cart-Token'], 'tok123');
  assert.deepEqual(JSON.parse(add.opts.body).variation, [{ attribute: 'pa_maling', value: 'maling-bialetti' }, { attribute: 'pa_hoeveelheid', value: '250-gram' }]);
});

test('rejects empty and unusable requests', async () => {
  fakeShop();
  assert.equal((await post({ items: [] })).status, 400);
  assert.equal((await post({ items: [{ slug: 'nope' }] })).status, 422);
});
