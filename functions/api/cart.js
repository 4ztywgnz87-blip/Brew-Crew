// POST /api/cart  { items: [{ slug, quantity? }], size: '250-gram', grind: 'maling-bialetti' }
// Builds a brand-new, empty Cross Roast cart through their public Store API, adds the coffees,
// and returns a link that opens exactly that cart on crossroast.be (replacing whatever was in it).
import { API, json } from '../_lib/crossroast.js';

const SHOP = 'https://www.crossroast.be';
const CART = `${SHOP}/wp-json/wc/store/v1/cart`;
const UA = { 'User-Agent': 'BrewCrew/1.0', Accept: 'application/json' };

async function product(slug) {
  const res = await fetch(`${API}?slug=${encodeURIComponent(slug)}`, { headers: UA });
  const data = await res.json();
  return Array.isArray(data) ? data[0] : null;
}

function pickVariation(p, size) {
  const vars = p.variations || [];
  if (!vars.length) return null;
  const sized = vars.find((v) => v.attributes.some((a) => a.value === size));
  return sized || vars[0];
}

export async function onRequestPost({ request }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  const size = /^[a-z0-9-]{1,40}$/.test(body.size || '') ? body.size : '250-gram';
  const grind = /^[a-z0-9-]{1,60}$/.test(body.grind || '') ? body.grind : 'maling-bialetti';
  if (!items.length) return json({ error: 'No coffees to add.' }, 400);

  try {
    // 1. A fresh, empty cart.
    const start = await fetch(CART, { headers: UA });
    const token = start.headers.get('Cart-Token');
    if (!token) return json({ error: 'Cross Roast did not open a cart.' }, 502);

    // 2. Add every coffee (in order, so the cart lists them the way you picked them).
    const added = [], failed = [];
    for (const it of items) {
      const slug = String(it.slug || '');
      const qty = Math.max(1, Math.min(10, Number(it.quantity) || 1));
      try {
        const p = await product(slug);
        if (!p) throw new Error('not found');
        const v = pickVariation(p, size);
        const payload = { id: v ? v.id : p.id, quantity: qty };
        if (v) {
          payload.variation = [{ attribute: 'pa_maling', value: grind }];
          const sizeAttr = v.attributes.find((a) => a.name === 'Hoeveelheid');
          if (sizeAttr?.value) payload.variation.push({ attribute: 'pa_hoeveelheid', value: sizeAttr.value });
        }
        const res = await fetch(`${CART}/add-item`, {
          method: 'POST',
          headers: { ...UA, 'Content-Type': 'application/json', 'Cart-Token': token },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err.message || `HTTP ${res.status}`).replace(/<[^>]+>/g, ''));
        }
        added.push(slug);
      } catch (e) {
        failed.push({ slug, reason: e.message });
      }
    }
    if (!added.length) return json({ error: 'None of the coffees could be added.', failed }, 422);

    // 3. Opening this link hands the new cart to your browser.
    return json({ url: `${SHOP}/winkelmand/?session=${encodeURIComponent(token)}`, added, failed });
  } catch (e) {
    return json({ error: `Could not reach crossroast.be (${e.message}).` }, 502);
  }
}
