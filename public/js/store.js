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
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
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

export function addCoffee(parsed, orderId) {
  const existing = findBySlug(parsed.slug);
  if (existing) return { coffee: existing, existed: true };
  const coffee = { ...parsed, id: uid(), addedAt: new Date().toISOString(), orderId: orderId || null, scores: {} };
  db.coffees.unshift(coffee);
  save();
  return { coffee, existed: false };
}

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
export const orderCoffees = (id) => db.coffees.filter((c) => c.orderId === id);

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
  db.coffees.forEach((c) => { if (c.orderId === id) c.orderId = null; });
  save();
}

// ---------- people ----------
export function renamePerson(id, name) {
  const p = db.people.find((x) => x.id === id);
  if (p && name.trim()) { p.name = name.trim(); save(); }
}
export function addPerson(name) {
  if (!name.trim()) return;
  db.people.push({ id: uid(), name: name.trim() });
  save();
}
export function removePerson(id) {
  db.people = db.people.filter((p) => p.id !== id);
  save();
}

// ---------- bulk ----------
export function replaceAll(data) {
  Object.keys(db).forEach((k) => delete db[k]);
  Object.assign(db, fresh(), data);
  save();
}
export function removeDemo() {
  const demoCoffees = db.coffees.filter((c) => c.demo).map((c) => c.id);
  db.coffees = db.coffees.filter((c) => !c.demo);
  db.orders = db.orders.filter((o) => !o.demo);
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
