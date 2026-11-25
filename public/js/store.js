import { canonicalNotes } from './parse.js';

// Local storage of all Brew Crew data (version 1: on this device only).
// Photos are kept in IndexedDB because they are too big for localStorage.

const KEY = 'brewcrew.v1';
const listeners = new Set();

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
export const today = () => new Date().toISOString().slice(0, 10);

function fresh() {
  return {
    version: 1,
    people: [
      { id: 'dauwe', name: 'Dauwe' },
      { id: 'reinoud', name: 'Reinoud' },
      { id: 'walter', name: 'Walter' },
    ],
    coffees: [],
    orders: [],
    settings: { size: '250-gram', grind: 'maling-bialetti' },
  };
}

// Brings older records up to date: one coffee can be in several orders, notes in one language.
export function normalizeCoffee(c) {
  if (!Array.isArray(c.orderIds)) c.orderIds = c.orderId ? [c.orderId] : [];
  delete c.orderId;
  c.notes = canonicalNotes(c.notes);
  c.scores ||= {};
  return c;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = { ...fresh(), ...JSON.parse(raw) };
      data.settings = { ...fresh().settings, ...(data.settings || {}) };
      data.coffees.forEach(normalizeCoffee);
      return data;
    }
  } catch {}
  return fresh();
}

export const db = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.error('Could not save', e);
    alert('Could not save: storage on this device is full.');
  }
  listeners.forEach((fn) => fn());
}

export const onChange = (fn) => listeners.add(fn);

if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

// ---------- coffees ----------
export const getCoffee = (id) => db.coffees.find((c) => c.id === id);
export const findBySlug = (slug) => db.coffees.find((c) => c.slug === slug);

// Adds a coffee, or (if you already had it) adds it to the given order again.
export function addCoffee(parsed, orderId) {
  const existing = findBySlug(parsed.slug);
  if (existing) {
    if (orderId && !existing.orderIds.includes(orderId)) { existing.orderIds.push(orderId); save(); }
    return { coffee: existing, existed: true };
  }
  const coffee = normalizeCoffee({ ...parsed, id: uid(), addedAt: new Date().toISOString(), orderIds: orderId ? [orderId] : [], scores: {} });
  db.coffees.unshift(coffee);
  save();
  return { coffee, existed: false };
}

export function addToOrder(coffeeId, orderId) {
  const c = getCoffee(coffeeId);
  if (c && orderId && !c.orderIds.includes(orderId)) { c.orderIds.push(orderId); save(); }
}
export function removeFromOrder(coffeeId, orderId) {
  const c = getCoffee(coffeeId);
  if (c) { c.orderIds = c.orderIds.filter((x) => x !== orderId); save(); }
}
export const coffeeOrders = (c) => (c.orderIds || []).map(getOrder).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));

export function updateCoffee(id, patch) {
  const c = getCoffee(id);
  if (!c) return;
  Object.assign(c, patch);
  save();
}

export function setScore(coffeeId, personId, score) {
  const c = getCoffee(coffeeId);
  if (!c) return;
  c.scores ||= {};
  const prev = c.scores[personId] || {};
  if (score == null && !prev.note) delete c.scores[personId];
  else c.scores[personId] = { ...prev, score, at: new Date().toISOString() };
  save();
}

export function setNote(coffeeId, personId, note) {
  const c = getCoffee(coffeeId);
  if (!c) return;
  c.scores ||= {};
  const prev = c.scores[personId] || {};
  c.scores[personId] = { ...prev, score: prev.score ?? null, note: note || '' };
  save();
}

export function deleteCoffee(id) {
  const i = db.coffees.findIndex((c) => c.id === id);
  if (i >= 0) db.coffees.splice(i, 1);
  deletePhoto(id);
  save();
}

// ---------- orders ----------
export const getOrder = (id) => db.orders.find((o) => o.id === id);
export const orderCoffees = (id) => db.coffees.filter((c) => (c.orderIds || []).includes(id));

export function createOrder(date = today(), extra = {}) {
  const order = { id: uid(), date, note: '', ...extra };
  db.orders.unshift(order);
  db.orders.sort((a, b) => b.date.localeCompare(a.date));
  save();
  return order;
}

export function recentOrder(days = 4) {
  const limit = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return db.orders.filter((o) => o.date >= limit).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

export function updateOrder(id, patch) {
  const o = getOrder(id);
  if (!o) return;
  Object.assign(o, patch);
  db.orders.sort((a, b) => b.date.localeCompare(a.date));
  save();
}

export function deleteOrder(id) {
  db.orders = db.orders.filter((o) => o.id !== id);
  db.coffees.forEach((c) => { c.orderIds = (c.orderIds || []).filter((x) => x !== id); });
  save();
}

// ---------- people ----------
export function renamePerson(id, name) {
  const p = db.people.find((x) => x.id === id);
  if (p && name.trim()) { p.name = name.trim(); save(); }
}
// A removed crew member who is added again (same name) gets their old scores back.
export function addPerson(name) {
  const n = name.trim();
  if (!n) return;
  db.formerPeople ||= [];
  const back = db.formerPeople.find((p) => p.name.toLowerCase() === n.toLowerCase());
  if (back) db.formerPeople = db.formerPeople.filter((p) => p !== back);
  db.people.push(back ? { ...back, name: n } : { id: uid(), name: n });
  save();
}
export function removePerson(id) {
  if (db.people.length <= 1) return false;
  const p = db.people.find((x) => x.id === id);
  db.people = db.people.filter((x) => x.id !== id);
  if (p) (db.formerPeople ||= []).push(p);
  save();
  return true;
}

// ---------- bulk ----------
export function replaceAll(data) {
  Object.keys(db).forEach((k) => delete db[k]);
  Object.assign(db, fresh(), data);
  save();
}
export function addDemo({ orders, coffees }) {
  db.orders.push(...orders);
  db.orders.sort((a, b) => b.date.localeCompare(a.date));
  db.coffees.push(...coffees.filter((c) => !findBySlug(c.slug)).map(normalizeCoffee));
  save();
}
export function removeDemo() {
  const demoCoffees = db.coffees.filter((c) => c.demo).map((c) => c.id);
  db.coffees = db.coffees.filter((c) => !c.demo);
  db.orders = db.orders.filter((o) => !o.demo);
  db.coffees.forEach((c) => { c.orderIds = c.orderIds.filter((x) => !x.startsWith('demo-')); });
  demoCoffees.forEach(deletePhoto);
  save();
}
export function wipe() {
  db.coffees.forEach((c) => deletePhoto(c.id));
  replaceAll({});
}

// ---------- photos (IndexedDB) ----------
let idb;
function openIdb() {
  if (idb) return idb;
  idb = new Promise((resolve, reject) => {
    const req = indexedDB.open('brewcrew-photos', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idb;
}
async function tx(mode, fn) {
  const d = await openIdb();
  return new Promise((resolve, reject) => {
    const t = d.transaction('photos', mode);
    const r = fn(t.objectStore('photos'));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}
export const savePhoto = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
export const loadPhoto = (id) => tx('readonly', (s) => s.get(id)).catch(() => null);
export const deletePhoto = (id) => tx('readwrite', (s) => s.delete(id)).catch(() => {});

export async function resizeImage(file, max = 900) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
}

// ---------- backup ----------
export function exportData() {
  return JSON.stringify({ app: 'brew-crew', exportedAt: new Date().toISOString(), ...db }, null, 1);
}
export function importData(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.coffees) || !Array.isArray(data.orders) || !Array.isArray(data.people)) throw new Error('This is not a Brew Crew backup.');
  const { app, exportedAt, ...rest } = data;
  replaceAll(rest);
  db.coffees.forEach(normalizeCoffee);
  save();
  return db.coffees.length;
}

export function updateSettings(patch) {
  db.settings = { ...(db.settings || {}), ...patch };
  save();
}
