// GET /api/catalog – all coffees currently listed in the "Koffiebonen" category.
import { API, trimProduct, shopFetch, json } from '../_lib/crossroast.js';

export async function onRequestGet() {
  try {
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const data = await shopFetch(`${API}?category=koffiebonen&per_page=100&page=${page}`, 1800);
      if (!Array.isArray(data)) break;
      all.push(...data);
      if (data.length < 100) break;
    }
    return json(all.map(trimProduct), 200, 900);
  } catch (e) {
    return json({ error: `Could not reach crossroast.be (${e.message}).` }, 502);
  }
}
