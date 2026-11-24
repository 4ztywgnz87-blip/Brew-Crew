// Fetches coffee data from crossroast.be.
// 1st choice: our own Cloudflare function (/api/...). Fallback: free public CORS proxies.
import { parseProduct } from './parse.js';

const STORE_API = 'https://www.crossroast.be/wp-json/wc/store/v1/products';
const PROXIES = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

export function slugFromUrl(input) {
  if (!input) return null;
  const s = String(input).trim();
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    if (!/(^|\.)crossroast\.be$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/product\/([^/]+)/i);
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  } catch {
    return null;
  }
}

export function findLinks(text) {
  const found = (text || '').match(/(https?:\/\/)?(www\.)?crossroast\.be\/product\/[^\s"'<>]+/gi) || [];
  const slugs = [];
  for (const f of found) {
    const s = slugFromUrl(f);
    if (s && !slugs.includes(s)) slugs.push(s);
  }
  return slugs;
}

function trim(p) {
  return {
    id: p.id, name: p.name, slug: p.slug, permalink: p.permalink,
    short_description: p.short_description, description: p.description,
    prices: p.prices && { min: p.prices.price_range?.min_amount ?? p.prices.price, max: p.prices.price_range?.max_amount ?? p.prices.price, minor: p.prices.currency_minor_unit ?? 2 },
    image: p.images?.[0] ? { src: p.images[0].src, thumbnail: p.images[0].thumbnail } : null,
    categories: (p.categories || []).map((c) => c.name),
    attributes: (p.attributes || []).map((a) => ({ name: a.name, terms: (a.terms || []).map((t) => t.name) })),
    in_stock: !!p.is_in_stock,
  };
}

async function getJson(url, timeout = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error('not json');
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { fatal: res.status === 404 || res.status === 400 });
    return data;
  } finally {
    clearTimeout(t);
  }
}

async function viaProxies(storeUrl) {
  let last;
  for (const p of PROXIES) {
    try {
      return await getJson(p(storeUrl), 12000);
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error('unreachable');
}

export async function fetchProduct(slug) {
  try {
    return parseProduct(await getJson(`/api/product?slug=${encodeURIComponent(slug)}`));
  } catch (e) {
    if (e.fatal) throw e;
  }
  const data = await viaProxies(`${STORE_API}?slug=${encodeURIComponent(slug)}`);
  if (!Array.isArray(data) || !data.length) throw new Error('Coffee not found on crossroast.be.');
  return parseProduct(trim(data[0]));
}

const CAT_KEY = 'brewcrew.catalog';
export async function fetchCatalog(force = false) {
  try {
    const cached = JSON.parse(localStorage.getItem(CAT_KEY) || 'null');
    if (!force && cached && Date.now() - cached.at < 30 * 60e3) return cached.items;
  } catch {}
  let raw;
  try {
    raw = await getJson('/api/catalog', 15000);
  } catch {
    raw = (await viaProxies(`${STORE_API}?category=koffiebonen&per_page=100`)).map(trim);
  }
  const items = raw.map(parseProduct);
  try { localStorage.setItem(CAT_KEY, JSON.stringify({ at: Date.now(), items })); } catch {}
  return items;
}
