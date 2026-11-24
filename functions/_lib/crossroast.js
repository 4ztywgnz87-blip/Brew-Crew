// Shared helpers for the Cloudflare Pages Functions.
// They fetch product data from the public WooCommerce Store API of crossroast.be
// and return a trimmed JSON version. Only crossroast.be is ever contacted, so this
// can not be abused as an open proxy.

const SHOP = 'https://www.crossroast.be';
const API = `${SHOP}/wp-json/wc/store/v1/products`;

export function slugFromUrl(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (/^[a-z0-9-]+$/i.test(s)) return s.toLowerCase();
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    if (!/(^|\.)crossroast\.be$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/product\/([^/]+)/i);
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  } catch {
    return null;
  }
}

export function trimProduct(p) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    permalink: p.permalink,
    short_description: p.short_description,
    description: p.description,
    prices: p.prices && {
      price: p.prices.price,
      min: p.prices.price_range?.min_amount ?? p.prices.price,
      max: p.prices.price_range?.max_amount ?? p.prices.price,
      minor: p.prices.currency_minor_unit ?? 2,
    },
    image: p.images?.[0] ? { src: p.images[0].src, thumbnail: p.images[0].thumbnail } : null,
    categories: (p.categories || []).map((c) => c.name),
    attributes: (p.attributes || []).map((a) => ({ name: a.name, terms: (a.terms || []).map((t) => t.name) })),
    in_stock: !!p.is_in_stock,
  };
}

export async function shopFetch(url, ttl) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'BrewCrew/1.0' },
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Shop answered ${res.status}`);
  return res.json();
}

export function json(data, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export { API };
