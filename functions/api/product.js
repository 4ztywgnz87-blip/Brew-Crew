// GET /api/product?url=https://www.crossroast.be/product/<slug>/
import { API, slugFromUrl, trimProduct, shopFetch, json } from '../_lib/crossroast.js';

export async function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams;
  const slug = slugFromUrl(params.get('url') || params.get('slug'));
  if (!slug) return json({ error: 'This is not a crossroast.be product link.' }, 400);
  try {
    const data = await shopFetch(`${API}?slug=${encodeURIComponent(slug)}`, 3600);
    if (!Array.isArray(data) || !data.length) return json({ error: 'Coffee not found on crossroast.be.' }, 404);
    return json(trimProduct(data[0]), 200, 600);
  } catch (e) {
    return json({ error: `Could not reach crossroast.be (${e.message}).` }, 502);
  }
}
