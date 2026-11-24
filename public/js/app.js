import * as store from './store.js';
import { db } from './store.js';
import { fetchProduct, fetchCatalog, findLinks } from './api.js';
import { regionsOf, REGIONS, canonicalNotes } from './parse.js';
import { estimateAttributes, familiesOf, familyLabel, ATTRIBUTES } from './flavor.js';
import {
  groupScore, personScore, verdict, preferences, attributeTrends, radar, confidence,
  predict, describeReason, summary, crewStats, scoredCoffees, REORDER_AT, SKIP_AT,
} from './analysis.js';

const $view = document.getElementById('view');
const $toast = document.getElementById('toast');

// ================================================================ helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => (v == null ? '–' : Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1));
const fmtHalf = (v) => (v == null ? '–' : v % 1 === 0 ? String(v) : v.toFixed(1));
const euro = (v) => `€ ${v.toFixed(2).replace('.', ',')}`;
const svg = (d, w = 20) => `<svg viewBox="0 0 24 24" style="width:${w}px;height:${w}px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round">${d}</svg>`;
const ICON = {
  back: svg('<path d="m15 5-7 7 7 7"/>'),
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 15),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/>'),
  paste: svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>'),
  filter: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
};

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 1500);
}

// In-app confirmation sheet (replaces the browser's confirm()).
function ask({ title, text = '', ok = 'Delete', cancel = 'Cancel', danger = true }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet-backdrop';
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}
      <div class="row"><button class="btn ghost" data-r="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger fill' : 'primary'}" data-r="1">${esc(ok)}</button></div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const close = (r) => { el.classList.remove('show'); setTimeout(() => el.remove(), 200); resolve(r); };
    el.addEventListener('click', (e) => {
      if (e.target === el) return close(false);
      const b = e.target.closest('[data-r]');
      if (b) close(b.dataset.r === '1');
    });
  });
}

// Sheet to pick which order a coffee goes into.
function chooseOrder(c) {
  const latest = latestOrder();
  const options = [];
  if (latest && !(c.orderIds || []).includes(latest.id)) options.push([latest.id, `${orderName(latest)} · ${store.orderCoffees(latest.id).length} coffees`]);
  options.push(['new', 'New order · today']);
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet-backdrop';
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><h2>Ordered it again?</h2><p>Add “${esc(c.name)}” to:</p>
      <div class="stack">${options.map(([v, l]) => `<button class="btn block ${v === 'new' ? 'ghost' : 'primary'}" data-v="${v}">${esc(l)}</button>`).join('')}
      <button class="btn block ghost" data-v="">Cancel</button></div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const close = (r) => { el.classList.remove('show'); setTimeout(() => el.remove(), 200); resolve(r); };
    el.addEventListener('click', (e) => {
      if (e.target === el) return close(null);
      const b = e.target.closest('[data-v]');
      if (b) close(b.dataset.v || null);
    });
  });
}

const people = () => db.people;
const coffeeImg = (c, cls = 'thumb') =>
  c.thumb || c.image ? `<img class="${cls}" src="${esc(c.thumb || c.image)}" alt="" loading="lazy">` : `<div class="${cls}"></div>`;

// "Colombia – Finca El Paseo" → two lines
function nameHtml(c, big = false) {
  const parts = (c.name || '').split(/\s+[–—-]\s+/);
  const first = parts.shift();
  return `<div class="cname ${big ? 'big' : ''}"><span class="n1">${esc(first)}</span>${parts.length ? `<span class="n2">${esc(parts.join(' – '))}</span>` : ''}</div>`;
}
const procLine = (c) => {
  const name = (c.name || '').toLowerCase();
  const countries = (c.countries || []).filter((x) => !name.startsWith(x.toLowerCase().slice(0, 5)));
  return [c.process && [c.process, ...(c.modifiers || [])].join(' · '), c.type === 'Blend' ? 'Blend' : null, countries.join(', ')].filter(Boolean).join(' · ');
};
const scoreBadge = (v, cls = '') => `<div class="score ${cls} ${verdict(v) || ''}">${fmt(v)}</div>`;
const expectBadge = (v, cls = '') => `<div class="score expect ${cls}"><small>for you</small><b>~${fmt(v)}</b></div>`;
const verdictTag = (v) => {
  const t = verdict(v);
  return t === 'reorder' ? '<span class="tag reorder">Reorder</span>' : t === 'skip' ? '<span class="tag skip">Skip</span>' : t === 'ok' ? '<span class="tag ok">Okay</span>' : '<span class="tag plain">Not rated</span>';
};
const dateLabel = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const orderName = (o) => o.name || `Order · ${dateLabel(o.date)}`;

function personScoresLine(c) {
  return people().map((p) => {
    const v = personScore(c, p.id);
    return `<span>${esc(p.name)} ${v == null ? '<b class="none">–</b>' : `<b>${fmtHalf(v)}</b>`}</span>`;
  }).join('');
}

// ---- search + filter panel (type + region, like on crossroast.be)
const FILTER_GROUPS = {
  verdict: { title: 'Score', options: [['reorder', 'Reorder'], ['ok', 'Okay'], ['skip', 'Skip'], ['unrated', 'Not rated']] },
  hide: { title: 'Show', options: [['tasted', 'Only coffees we haven’t tasted']] },
  region: { title: 'Region', options: REGIONS.map((r) => [r, r]) },
  type: { title: 'Type', options: [['Single origin', 'Single origin'], ['Blend', 'Blend']] },
};
function searchBar(f, placeholder, groups) {
  return `<div class="searchrow">
      <div class="search grow">${ICON.search}<input class="input" id="q" type="search" placeholder="${esc(placeholder)}" value="${esc(f.q || '')}" autocomplete="off"></div>
      <button class="filter-btn" id="filterBtn" aria-label="Filters" aria-expanded="false">${ICON.filter}<span class="fcount"></span></button>
    </div>
    <div class="card filter-panel hidden" id="filterPanel">
      ${groups.map((g) => `<div class="fgroup"><div class="ftitle">${FILTER_GROUPS[g].title}</div><div class="chips">${FILTER_GROUPS[g].options.map(([k, l]) => `<button class="chip" data-g="${g}" data-k="${esc(k)}">${esc(l)}</button>`).join('')}</div></div>`).join('')}
      <div class="row" style="justify-content:space-between"><button class="linkish small" id="clearF">Clear all</button><button class="btn sm dark" id="doneF">Done</button></div>
    </div>
    <div class="chips active-filters hidden" id="activeF"></div>`;
}
function bindSearch(f, groups, onChange) {
  const panel = $view.querySelector('#filterPanel');
  const btn = $view.querySelector('#filterBtn');
  const act = $view.querySelector('#activeF');
  const paint = () => {
    const active = groups.filter((g) => f[g]);
    btn.classList.toggle('on', active.length > 0);
    btn.querySelector('.fcount').textContent = active.length || '';
    panel.querySelectorAll('[data-g]').forEach((x) => x.classList.toggle('on', f[x.dataset.g] === x.dataset.k));
    act.innerHTML = active.map((g) => `<button class="chip on" data-x="${g}">${esc(FILTER_GROUPS[g].options.find((o) => o[0] === f[g])?.[1] || f[g])}<span aria-hidden="true">✕</span></button>`).join('');
    act.classList.toggle('hidden', !active.length || !panel.classList.contains('hidden'));
  };
  const toggle = (open) => { panel.classList.toggle('hidden', !open); btn.setAttribute('aria-expanded', open); paint(); };
  btn.addEventListener('click', () => toggle(panel.classList.contains('hidden')));
  $view.querySelector('#doneF').addEventListener('click', () => toggle(false));
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    const { g, k } = b.dataset;
    f[g] = f[g] === k ? null : k;
    paint(); onChange();
  });
  $view.querySelector('#clearF').addEventListener('click', () => { groups.forEach((g) => (f[g] = null)); paint(); onChange(); });
  act.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (b) { f[b.dataset.x] = null; paint(); onChange(); } });
  $view.querySelector('#q').addEventListener('input', (e) => { f.q = e.target.value; onChange(); });
  paint();
}
const passes = (c, f) => (!f.type || (c.type || 'Single origin') === f.type) && (!f.region || regionsOf(c).includes(f.region));
const matchesQuery = (c, q) => !q || [c.name, c.processText, c.variety, ...(c.countries || []), ...(c.notes || [])].join(' ').toLowerCase().includes(q.trim().toLowerCase());

// ---- the order new coffees go into
const latestOrder = () => db.orders[0] || null;
function defaultDest() {
  const o = store.recentOrder(7);
  return o ? o.id : 'new';
}
const resolveDest = (dest) => (dest === 'new' ? store.createOrder().id : dest);

// ================================================================ router
const routes = [
  [/^#?\/?$/, viewCoffees, 'coffees'],
  [/^#\/add$/, () => location.replace('#/shop'), 'shop'],
  [/^#\/coffee\/([\w-]+)$/, viewCoffee, 'coffees'],
  [/^#\/edit\/([\w-]+)$/, viewEdit, 'coffees'],
  [/^#\/taste$/, viewTaste, 'taste'],
  [/^#\/shop$/, viewShop, 'shop'],
  [/^#\/shop\/([\w-]+)$/, viewShopItem, 'shop'],
  [/^#\/orders$/, viewOrders, 'shop'],
  [/^#\/order\/([\w-]+)$/, viewOrder, 'shop'],
  [/^#\/settings$/, viewSettings, 'settings'],
];

function render() {
  const hash = location.hash.split('?')[0] || '#/';
  for (const [re, fn, tab] of routes) {
    const m = hash.match(re);
    if (m) {
      document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
      fn(...m.slice(1));
      return;
    }
  }
  location.hash = '#/';
}
const query = () => new URLSearchParams(location.hash.split('?')[1] || '');
window.addEventListener('hashchange', () => { render(); $view.scrollTop = 0; });
const goBack = (fallback) => (history.length > 1 ? history.back() : (location.hash = fallback));

// ================================================================ coffees list
const listState = { q: '', verdict: null, type: null, region: null, sort: 'newest' };

function viewCoffees() {
  const total = db.coffees.length;
  if (!total) {
    $view.innerHTML = `
      <div class="top"><div><div class="eyebrow">${esc(people().map((p) => p.name).join(' · '))}</div><h1>Brew Crew</h1></div></div>
      <div class="card empty">
        <h2>No coffees yet</h2>
        <p>Open the Shop, tick the coffees you ordered, and each of you gives a score.</p>
        <a class="btn primary" href="#/shop">Go to the shop</a>
        <p class="small" style="margin-top:18px">Just want to look around? <a class="linkish" href="#/settings">Load demo data</a></p>
      </div>`;
    return;
  }
  $view.innerHTML = `
    <div class="top"><div><div class="eyebrow">${total} coffee${total === 1 ? '' : 's'} tasted</div><h1>Brew Crew</h1></div></div>
    ${searchBar(listState, 'Search name, country, note…', ['verdict', 'region', 'type'])}
    <div class="row" style="margin-top:8px;justify-content:space-between">
      <span class="small muted" id="count"></span>
      <select class="select" id="sort" style="width:auto;padding:6px 10px;font-size:14px;border-radius:11px">
        <option value="newest">Newest first</option><option value="best">Best score</option><option value="worst">Lowest score</option><option value="name">Name</option>
      </select>
    </div>
    <div class="list" id="list"></div>
    <p class="small muted" style="text-align:center;margin-top:14px">Swipe a coffee to the left to delete it.</p>`;
  const $list = $view.querySelector('#list');
  $view.querySelector('#sort').value = listState.sort;

  const draw = () => {
    let items = db.coffees.filter((c) => matchesQuery(c, listState.q) && passes(c, listState)).map((c) => ({ c, s: groupScore(c, people()) }));
    if (listState.verdict === 'unrated') items = items.filter((x) => x.s == null);
    else if (listState.verdict) items = items.filter((x) => verdict(x.s) === listState.verdict);
    const by = {
      newest: (a, b) => (b.c.addedAt || '').localeCompare(a.c.addedAt || ''),
      best: (a, b) => (b.s ?? -1) - (a.s ?? -1),
      worst: (a, b) => (a.s ?? 99) - (b.s ?? 99),
      name: (a, b) => a.c.name.localeCompare(b.c.name),
    };
    items.sort(by[listState.sort]);
    $view.querySelector('#count').textContent = `${items.length} shown`;
    $list.innerHTML = items.length
      ? items.map(({ c, s }) => `
        <div class="swipe" data-id="${c.id}">
          <button class="swipe-del" aria-label="Delete">${ICON.trash}</button>
          <a class="card item" href="#/coffee/${c.id}" draggable="false">
            ${coffeeImg(c)}
            <div class="grow">${nameHtml(c)}<div class="meta">${esc(procLine(c))}</div><div class="people">${personScoresLine(c)}</div></div>
            ${scoreBadge(s)}
          </a>
        </div>`).join('')
      : `<div class="empty small">Nothing matches.</div>`;
  };
  draw();
  bindSwipe($list, async (id) => {
    const c = store.getCoffee(id);
    if (await ask({ title: 'Delete this coffee?', text: `“${c.name}” and all its scores will be removed.` })) {
      store.deleteCoffee(id);
      toast('Deleted');
      draw();
      return true;
    }
    return false;
  });
  $view.querySelector('#sort').addEventListener('change', (e) => { listState.sort = e.target.value; draw(); });
  bindSearch(listState, ['verdict', 'region', 'type'], draw);
}

// Swipe left on .swipe > .card to reveal the delete button.
function bindSwipe($list, onDelete) {
  const OPEN = -88;
  let cur = null;
  let openCard = null;
  const setX = (card, x) => { card.style.transform = x ? `translateX(${x}px)` : ''; card.dataset.x = x; card.parentElement.classList.toggle('reveal', x < 0); };
  const closeOpen = () => { if (openCard) { setX(openCard, 0); openCard = null; } };
  $list.addEventListener('dragstart', (e) => e.preventDefault());

  $list.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.swipe > .card');
    if (!card) return;
    if (openCard && openCard !== card) closeOpen();
    cur = { card, x0: e.clientX, y0: e.clientY, base: Number(card.dataset.x || 0), dx: 0, mode: null };
  });
  $list.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const dx = e.clientX - cur.x0, dy = e.clientY - cur.y0;
    if (!cur.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      cur.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll';
      if (cur.mode === 'swipe') cur.card.classList.add('dragging');
    }
    if (cur.mode !== 'swipe') return;
    cur.dx = dx;
    setX(cur.card, Math.max(OPEN - 30, Math.min(0, cur.base + dx)));
  });
  $list.addEventListener('pointerup', () => {
    if (!cur) return;
    const { card, mode, base, dx } = cur;
    card.classList.remove('dragging');
    if (mode === 'swipe') {
      if (base + dx < OPEN / 2) { setX(card, OPEN); openCard = card; } else { setX(card, 0); if (openCard === card) openCard = null; }
      card.dataset.swiped = '1';
      setTimeout(() => delete card.dataset.swiped, 50);
    }
    cur = null;
  });
  $list.addEventListener('pointercancel', () => { if (cur) { setX(cur.card, cur.base); cur.card.classList.remove('dragging'); cur = null; } });
  $list.addEventListener('click', async (e) => {
    const card = e.target.closest('.swipe > .card');
    if (card && (card.dataset.swiped || Number(card.dataset.x || 0) !== 0)) {
      e.preventDefault();
      if (!card.dataset.swiped) closeOpen();
      return;
    }
    const del = e.target.closest('.swipe-del');
    if (del) {
      const ok = await onDelete(del.closest('.swipe').dataset.id);
      if (!ok) closeOpen();
      openCard = null;
    }
  }, true);
}

// ================================================================ rating bar
function ratingBar(value) {
  const pct = value == null ? 0 : (value / 10) * 100;
  return `<div class="rbar" role="slider" aria-valuemin="1" aria-valuemax="10" aria-valuenow="${value ?? ''}" tabindex="0">
    <div class="fill" style="width:${pct}%"></div>
    <div class="ticks">${Array.from({ length: 10 }, (_, i) => `<span class="${value != null && i + 1 <= value ? 'lit' : ''}">${i + 1}</span>`).join('')}</div>
  </div>`;
}

// Scores only change on a clear tap or a deliberate sideways slide,
// so scrolling past the bars with your thumb never changes a score.
function bindRating($el, initial, onChange, onCommit) {
  let value = initial;
  const fill = $el.querySelector('.fill');
  const ticks = [...$el.querySelectorAll('.ticks span')];
  const paint = () => {
    fill.style.width = value == null ? '0%' : `${(value / 10) * 100}%`;
    ticks.forEach((t, i) => t.classList.toggle('lit', value != null && i + 1 <= value));
    $el.setAttribute('aria-valuenow', value ?? '');
  };
  const at = (x) => {
    const r = $el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (x - r.left) / r.width));
    return Math.max(1, Math.min(10, Math.ceil(f * 20) / 2)); // left half of a cell = x.5
  };
  let g = null; // gesture: { x0, y0, t0, mode: null | 'slide' | 'scroll', start }
  $el.addEventListener('pointerdown', (e) => { g = { x0: e.clientX, y0: e.clientY, t0: Date.now(), mode: null, start: value, id: e.pointerId }; });
  $el.addEventListener('pointermove', (e) => {
    if (!g) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.mode) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { g.mode = 'scroll'; return; }
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) { g.mode = 'slide'; try { $el.setPointerCapture(g.id); } catch {} }
      else return;
    }
    if (g.mode !== 'slide') return;
    const v = at(e.clientX);
    if (v !== value) { value = v; paint(); onChange(value); }
  });
  $el.addEventListener('pointerup', (e) => {
    if (!g) return;
    const moved = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
    if (g.mode === 'slide') onCommit(value);
    else if (!g.mode && moved < 8 && Date.now() - g.t0 < 600) { value = at(e.clientX); paint(); onChange(value); onCommit(value); }
    g = null;
  });
  $el.addEventListener('pointercancel', () => {
    if (g?.mode === 'slide') { value = g.start; paint(); onChange(value); }
    g = null;
  });
  $el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') value = Math.min(10, (value ?? 0.5) + 0.5);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') value = Math.max(1, (value ?? 1.5) - 0.5);
    else return;
    e.preventDefault(); paint(); onChange(value); onCommit(value);
  });
  return { set(v) { value = v; paint(); } };
}

// ================================================================ shared coffee sections
function fact(label, value, raw = false) {
  if (!value) return '';
  return `<div><span>${label}</span><b>${raw ? value : esc(value)}</b></div>`;
}
function meter(a, v) {
  return `<div class="meter"><div class="lbl"><b>${a.label}</b><span>${v != null ? v.toFixed(1) + ' / 5' : ''}</span></div>
    <div class="track"><i style="width:${v != null ? (v / 5) * 100 : 0}%"></i></div>
    <div class="ends"><span>${a.low}</span><span>${a.high}</span></div></div>`;
}

const ESTIMATE_TEXT = `Cross Roast doesn’t publish acidity, body or bitterness, so Brew Crew estimates them from what it does publish: the tasting notes (lime or berries → brighter, dark chocolate or nuts → fuller and more bitter, caramel or honey → sweeter), the process (natural & honey → sweeter and fuller, washed → cleaner and brighter) and the altitude (higher → brighter). Treat it as a rough guide (about ±1 point). For your taste profile it only matters whether a coffee is low, medium or high.`;

function coffeeSections(c, extraFacts = '') {
  const attrs = estimateAttributes(c);
  const fams = familiesOf(c);
  return `
    <div class="section">
      <div class="section-head"><h2>Tasting notes</h2><span class="hint">from Cross Roast</span></div>
      <div class="chips">${(c.notes || []).map((n) => `<span class="chip note">${esc(n)}</span>`).join('') || '<span class="muted small">None listed</span>'}</div>
      ${fams.length ? `<div class="small muted" style="margin-top:8px">Flavor families: ${fams.map((f) => esc(familyLabel(f))).join(', ')}</div>` : ''}
    </div>
    <div class="section">
      <div class="section-head"><h2>Profile<button class="info-btn" data-info aria-label="How is this estimated?">?</button></h2><span class="hint">estimated</span></div>
      <div class="explain hidden" data-info-text style="margin-bottom:10px">${esc(ESTIMATE_TEXT)}</div>
      <div class="card pad meters">${ATTRIBUTES.map((a) => meter(a, attrs[a.key])).join('')}</div>
    </div>
    <div class="section">
      <div class="section-head"><h2>Details</h2></div>
      <div class="card pad facts">
        ${fact('Process', c.processText || c.process)}
        ${fact('Variety', c.variety)}
        ${fact('Altitude', c.altitudeText || (c.altitude ? c.altitude + ' m' : null))}
        ${fact('Harvest', c.harvest)}
        ${fact('Origin', [(c.countries || []).join(', '), regionsOf(c).join(', ')].filter(Boolean).join(' · '))}
        ${fact('Price', c.priceFrom ? `${euro(c.priceFrom)} / 250 g` : null)}
        ${extraFacts}
      </div>
    </div>
    ${c.story || c.intro ? `<div class="section"><div class="section-head"><h2>The story</h2></div>
      <div class="card pad"><div class="story clamp" data-story>${esc(c.story || c.intro)}</div>
      <button class="linkish small" data-more style="margin-top:8px">Read more</button></div></div>` : ''}`;
}
function bindSections() {
  $view.querySelector('[data-info]')?.addEventListener('click', () => $view.querySelector('[data-info-text]').classList.toggle('hidden'));
  $view.querySelector('[data-more]')?.addEventListener('click', (e) => {
    const s = $view.querySelector('[data-story]');
    s.classList.toggle('clamp');
    e.target.textContent = s.classList.contains('clamp') ? 'Read more' : 'Show less';
  });
}
const siteLink = (c) => (c.url ? `<a class="linkish small row" style="gap:4px;display:inline-flex" href="${esc(c.url)}" target="_blank" rel="noopener">crossroast.be ${ICON.ext}</a>` : '');

// ================================================================ coffee detail (tasted)
function viewCoffee(id) {
  const c = store.getCoffee(id);
  if (!c) { location.hash = '#/'; return; }
  const isNew = query().get('new') === '1';
  const orders = store.coffeeOrders(c);
  const g = groupScore(c, people());

  $view.innerHTML = `
    <div class="hero">${c.image ? `<img src="${esc(c.image)}" alt="">` : ''}
      <div class="hero-actions">
        <button class="icon-btn" id="back" aria-label="Back">${ICON.back}</button>
        <div class="row"><label class="icon-btn" aria-label="Add photo">${ICON.camera}<input id="photo" type="file" accept="image/*" hidden></label>
        <a class="icon-btn" href="#/edit/${c.id}" aria-label="Edit">${ICON.edit}</a></div>
      </div>
    </div>
    <div class="card detail-head">
      <div class="row" style="align-items:flex-start;gap:14px">
        <div class="grow">
          <div class="kicker">${esc([c.type, ...regionsOf(c)].filter(Boolean).join(' · '))}</div>
          ${nameHtml(c, true)}
          <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px" id="verdictRow">${verdictTag(g)}${siteLink(c)}</div>
        </div>
        <div id="groupBadge">${scoreBadge(g, 'lg')}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Scores</h2><span class="hint">tap or slide · last score counts</span></div>
      <div class="card raters" id="raters">
        ${people().map((p) => {
          const s = c.scores?.[p.id] || {};
          return `<div class="rater" data-p="${p.id}">
            <div class="rater-top">
              <div class="who-wrap"><span class="who">${esc(p.name)}</span><button data-act="clear" class="clear-btn ${s.score == null ? 'invisible' : ''}">Clear</button></div>
              <div class="rater-tools"><button data-act="note">${s.note ? 'Edit note' : '+ Note'}</button>
              <span class="val ${s.score == null ? 'unset' : ''}">${s.score == null ? 'no score' : fmtHalf(s.score)}</span></div></div>
            ${ratingBar(s.score ?? null)}
            ${s.note ? `<div class="note-show">“${esc(s.note)}”</div>` : ''}
            <textarea class="textarea note-input hidden" rows="2" placeholder="What did you think? (optional)">${esc(s.note || '')}</textarea>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Order history</h2><span class="hint">${orders.length ? `ordered ${orders.length}×` : ''}</span></div>
      <div class="card hist">${orders.map((o) => `<div class="hist-row"><a href="#/order/${o.id}"><b>${esc(orderName(o))}</b><span class="small muted">${(() => { const n = store.orderCoffees(o.id).length; return `${n} coffee${n === 1 ? '' : 's'}`; })()}</span></a>
        <button class="hist-x" data-rmorder="${o.id}" aria-label="Remove from this order">✕</button></div>`).join('') || '<div class="hist-row small muted">Not part of an order yet.</div>'}</div>
      <button class="btn block" id="reorder" style="margin-top:10px">+ We ordered it again</button>
    </div>

    ${coffeeSections(c, fact('Added', c.addedAt ? dateLabel(c.addedAt.slice(0, 10)) : null))}

    <div class="section hidden" id="myPhotoSec">
      <div class="section-head"><h2>Our photo</h2><button class="linkish small" id="rmPhoto">Remove</button></div>
      <img id="myPhoto" class="card" style="width:100%" alt="">
    </div>

    <div class="section"><button class="btn danger block" id="del">Delete this coffee</button></div>`;

  bindSections();
  $view.querySelector('#back').addEventListener('click', () => goBack('#/'));
  $view.querySelector('#reorder').addEventListener('click', async () => {
    const dest = await chooseOrder(c);
    if (!dest) return;
    store.addToOrder(c.id, resolveDest(dest));
    toast('Added to the order');
    viewCoffee(c.id);
  });
  $view.querySelectorAll('[data-rmorder]').forEach((b) => b.addEventListener('click', async () => {
    const o = store.getOrder(b.dataset.rmorder);
    if (await ask({ title: 'Remove from this order?', text: `“${c.name}” stays in your list with its scores; it’s only taken out of ${orderName(o)}.`, ok: 'Remove' })) {
      store.removeFromOrder(c.id, o.id); viewCoffee(c.id);
    }
  }));
  $view.querySelector('#del').addEventListener('click', async () => {
    if (await ask({ title: 'Delete this coffee?', text: `“${c.name}” and all its scores will be removed.` })) {
      store.deleteCoffee(c.id); toast('Deleted'); location.hash = '#/';
    }
  });

  const refreshGroup = () => {
    const gs = groupScore(c, people());
    $view.querySelector('#groupBadge').innerHTML = scoreBadge(gs, 'lg');
    $view.querySelector('#verdictRow').firstElementChild.outerHTML = verdictTag(gs);
  };

  $view.querySelectorAll('.rater').forEach(($r) => {
    const pid = $r.dataset.p;
    const $val = $r.querySelector('.val');
    const $clear = $r.querySelector('[data-act=clear]');
    const show = (v) => { $val.textContent = v == null ? 'no score' : fmtHalf(v); $val.classList.toggle('unset', v == null); $clear.classList.toggle('invisible', v == null); };
    const bar = bindRating($r.querySelector('.rbar'), c.scores?.[pid]?.score ?? null, show, (v) => { store.setScore(c.id, pid, v); refreshGroup(); toast('Saved'); });
    $clear.addEventListener('click', () => { bar.set(null); show(null); store.setScore(c.id, pid, null); refreshGroup(); toast('Score cleared'); });
    const $note = $r.querySelector('.note-input');
    $r.querySelector('[data-act=note]').addEventListener('click', () => { $note.classList.toggle('hidden'); if (!$note.classList.contains('hidden')) $note.focus(); });
    $note.addEventListener('change', () => {
      store.setNote(c.id, pid, $note.value.trim());
      let $show = $r.querySelector('.note-show');
      if ($note.value.trim()) {
        if (!$show) { $show = document.createElement('div'); $show.className = 'note-show'; $note.before($show); }
        $show.textContent = `“${$note.value.trim()}”`;
      } else $show?.remove();
      $note.classList.add('hidden');
      toast('Note saved');
    });
  });

  const showPhoto = async () => {
    const blob = await store.loadPhoto(c.id);
    const sec = $view.querySelector('#myPhotoSec');
    if (!sec) return;
    if (blob) { $view.querySelector('#myPhoto').src = URL.createObjectURL(blob); sec.classList.remove('hidden'); } else sec.classList.add('hidden');
  };
  $view.querySelector('#photo').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { await store.savePhoto(c.id, await store.resizeImage(f)); store.updateCoffee(c.id, { hasPhoto: true }); toast('Photo saved'); showPhoto(); }
    catch { toast('Could not save photo'); }
  });
  $view.querySelector('#rmPhoto').addEventListener('click', async () => { await store.deletePhoto(c.id); store.updateCoffee(c.id, { hasPhoto: false }); showPhoto(); });
  if (c.hasPhoto) showPhoto();

  if (isNew) setTimeout(() => $view.querySelector('#raters')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
}

// ================================================================ edit / manual
function viewEdit(id) {
  const isNew = id === 'new';
  const c = isNew ? { name: '', url: query().get('url') || '', countries: [], notes: [], modifiers: [], process: '', variety: '', altitudeText: '', harvest: '', type: 'Single origin' } : store.getCoffee(id);
  if (!c) { location.hash = '#/'; return; }
  const orderSel = defaultDest();
  const opts = [['new', 'New order · today'], ...db.orders.slice(0, 8).map((o) => [o.id, orderName(o)]), ['none', 'Not part of an order']];
  $view.innerHTML = `
    <div class="top"><button class="back" id="back">${ICON.back} Back</button></div>
    <h1 style="margin-bottom:18px">${isNew ? 'Add manually' : 'Edit coffee'}</h1>
    <form id="f" class="stack">
      <label class="field"><span>Name</span><input class="input" name="name" required value="${esc(c.name)}"></label>
      <label class="field"><span>Link (crossroast.be)</span><input class="input" name="url" type="url" value="${esc(c.url)}"></label>
      <label class="field"><span>Country (comma separated)</span><input class="input" name="countries" value="${esc((c.countries || []).join(', '))}"></label>
      <label class="field"><span>Process</span><select class="select" name="process">
        ${['', 'Washed', 'Natural', 'Honey', 'Mixed', 'Other'].map((p) => `<option ${c.process === p ? 'selected' : ''} value="${p}">${p || '–'}</option>`).join('')}</select></label>
      <label class="field"><span>Extra process (e.g. Anaerobic)</span><input class="input" name="modifiers" value="${esc((c.modifiers || []).join(', '))}"></label>
      <label class="field"><span>Tasting notes (comma separated)</span><input class="input" name="notes" value="${esc((c.notes || []).join(', '))}"></label>
      <label class="field"><span>Variety</span><input class="input" name="variety" value="${esc(c.variety || '')}"></label>
      <label class="field"><span>Altitude</span><input class="input" name="altitudeText" value="${esc(c.altitudeText || '')}" placeholder="e.g. 1600 – 1800 m"></label>
      <label class="field"><span>Harvest</span><input class="input" name="harvest" value="${esc(c.harvest || '')}"></label>
      <label class="field"><span>Type</span><select class="select" name="type">${['Single origin', 'Blend'].map((t) => `<option ${c.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${isNew ? `<label class="field"><span>Order</span><select class="select" name="order">${opts.map(([v, l]) => `<option value="${v}" ${v === orderSel ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}
      <button class="btn primary block" type="submit">${isNew ? 'Add coffee' : 'Save'}</button>
    </form>`;
  $view.querySelector('#back').addEventListener('click', () => history.back());
  $view.querySelector('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const alts = (fd.altitudeText.match(/\d{3,4}/g) || []).map(Number);
    const patch = {
      name: fd.name.trim(), url: fd.url.trim(), countries: list(fd.countries), process: fd.process || null,
      processText: [fd.process, ...list(fd.modifiers)].filter(Boolean).join(' – '), modifiers: list(fd.modifiers),
      notes: canonicalNotes(list(fd.notes)), variety: fd.variety.trim() || null, altitudeText: fd.altitudeText.trim() || null,
      altitude: alts.length ? Math.round(alts.reduce((a, b) => a + b, 0) / alts.length) : null, harvest: fd.harvest.trim() || null, type: fd.type,
    };
    const orderId = isNew && fd.order !== 'none' ? resolveDest(fd.order) : null;
    if (isNew) {
      const slug = (patch.url && findLinks(patch.url)[0]) || 'manual-' + store.uid();
      const existing = store.findBySlug(slug);
      if (existing) { location.hash = `#/coffee/${existing.id}`; return; }
      store.addCoffee({ ...patch, slug, story: '', intro: '', image: null, thumb: null }, orderId);
      toast(`${patch.name} added`);
      location.hash = '#/';
    } else {
      store.updateCoffee(c.id, patch);
      toast('Saved');
      location.hash = `#/coffee/${c.id}`;
    }
  });
}

// ================================================================ taste profile
let subject = sessionStorage.getItem('bc.subject') || 'group';

function whoPicker() {
  const ps = people();
  return `<div class="who-pick" id="who">
    <button class="who-crew ${subject === 'group' ? 'on' : ''}" data-s="group">
      <div><b>The Crew</b><span>Everyone together</span></div>
      <div class="faces">${ps.map((p) => `<i>${esc(p.name.charAt(0))}</i>`).join('')}</div>
    </button>
    <div class="who-row">${ps.map((p) => `<button data-s="${p.id}" class="${subject === p.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>
  </div>`;
}

function viewTaste() {
  if (subject !== 'group' && !people().some((p) => p.id === subject)) subject = 'group';
  const ps = people();
  const prefs = preferences(db.coffees, subject, ps);
  const conf = confidence(prefs.n);
  const subjName = subject === 'group' ? 'the crew' : ps.find((p) => p.id === subject).name;
  const rated = scoredCoffees(db.coffees, subject, ps).sort((a, b) => b.score - a.score);
  const lines = summary(db.coffees, subject, ps);
  const head = `<div class="top"><div><div class="eyebrow">Taste profile</div><h1>What ${esc(subjName)} likes</h1></div></div>${whoPicker()}`;

  if (prefs.n === 0) {
    $view.innerHTML = `${head}<div class="card empty" style="margin-top:16px"><h2>Nothing scored yet</h2><p>Score a few coffees and the taste profile appears here.</p><a class="btn primary" href="#/">Go to coffees</a></div>`;
    bindWho();
    return;
  }

  const bars = (rows, label = (v) => v, limit = 8, minN = 1) => {
    const r = (rows || []).filter((x) => x.n >= minN).slice(0, limit);
    if (!r.length) return '<div class="small muted">Not enough data yet.</div>';
    return `<div class="bars">${r.map((x) => `<div class="bar"><span class="k">${esc(label(x.value))}</span><span class="t"><i class="${verdict(x.avg)}" style="width:${x.avg * 10}%"></i></span><span class="v">${fmt(x.avg)} <small>×${x.n}</small></span></div>`).join('')}</div>`;
  };

  const trends = attributeTrends(db.coffees, subject, ps);
  const attrBlock = ATTRIBUTES.map((a) => {
    const rows = (prefs.dims[a.key] || []).slice().sort((x, y) => ['low', 'medium', 'high'].indexOf(x.value) - ['low', 'medium', 'high'].indexOf(y.value));
    const t = trends.find((x) => x.key === a.key);
    const name = { low: a.low, medium: 'medium', high: a.high };
    let verdictTxt = 'No clear preference yet';
    if (t.r != null && Math.abs(t.r) >= 0.3) verdictTxt = t.r > 0 ? `Prefers ${a.high}` : `Prefers ${a.low}`;
    else if (t.r != null) verdictTxt = 'Doesn’t seem to matter much';
    return `<div><div class="row" style="justify-content:space-between;margin-bottom:6px"><b>${a.label}</b><span class="small muted">${verdictTxt}</span></div>${bars(rows, (v) => name[v], 3)}</div>`;
  }).join('<div style="height:14px"></div>');

  const months = {};
  db.coffees.forEach((c) => { const m = (c.addedAt || '').slice(0, 7); if (m) months[m] = (months[m] || 0) + 1; });
  const countries = new Set(db.coffees.flatMap((c) => c.countries || []));
  const avgAll = rated.length ? rated.reduce((s, x) => s + x.score, 0) / rated.length : null;
  const notesLiked = (prefs.dims.note || []).filter((x) => x.n >= 2).slice(0, 10);
  const bottom = rated.filter((x) => verdict(x.score) === 'skip').slice(-5).reverse();
  const regionRows = (() => {
    const by = {};
    rated.forEach(({ coffee, score }) => regionsOf(coffee).forEach((r) => (by[r] ||= []).push(score)));
    return Object.entries(by).map(([value, s]) => ({ value, n: s.length, avg: s.reduce((a, b) => a + b, 0) / s.length })).sort((a, b) => b.avg - a.avg);
  })();
  const listRow = (x, i) => `<a href="#/coffee/${x.coffee.id}">${i != null ? `<span class="rank">${i + 1}</span>` : ''}${coffeeImg(x.coffee, 'thumb sm')}<div class="grow">${nameHtml(x.coffee)}</div><span class="s ${verdict(x.score)}">${fmt(x.score)}</span></a>`;

  $view.innerHTML = `
    ${head}
    <div class="card confidence" style="margin-top:14px">
      <div class="dots">${[0, 1, 2, 3].map((i) => `<i class="${i <= conf.level ? 'on' : ''}"></i>`).join('')}</div>
      <div><b>${conf.label}</b> <span class="small muted">· ${prefs.n} scored</span><div class="small muted">${conf.text}</div></div>
    </div>

    ${lines.length ? `<div class="section"><div class="section-head"><h2>In a nutshell</h2></div><div class="card pad"><ul class="summary">${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div></div>` : ''}

    <div class="section"><div class="section-head"><h2>Top ${Math.min(10, rated.length)}</h2><span class="hint">reorder from ${REORDER_AT}</span></div>
      <div class="card top10">${rated.slice(0, 10).map((x, i) => listRow(x, i)).join('')}</div></div>

    ${bottom.length ? `<div class="section"><div class="section-head"><h2>Don’t reorder</h2><span class="hint">${SKIP_AT} or lower</span></div>
      <div class="card top10">${bottom.map((x) => listRow(x)).join('')}</div></div>` : ''}

    <div class="section"><div class="section-head"><h2>Flavor map</h2></div>
      <div class="card pad">
        <div class="radar-wrap">${radarSvg(radar(prefs))}</div>
        <div class="explain"><b>How to read this:</b> each spoke is a flavor family (from the tasting notes). The dashed ring is “neutral”. Further <b>outside</b> = coffees with that flavor score <b>higher</b> than average; further <b>inside</b> = lower. Grey = not tasted yet.</div>
      </div></div>

    <div class="section"><div class="section-head"><h2>Process</h2><span class="hint">avg score · ×count</span></div>
      <div class="card pad">${bars(prefs.dims.process)}
        ${(prefs.dims.fermentation || []).length > 1 ? `<div style="height:14px"></div><div class="small muted" style="margin-bottom:6px">Fermentation style</div>${bars(prefs.dims.fermentation)}` : ''}</div></div>

    <div class="section"><div class="section-head"><h2>Acidity, body & co.<button class="info-btn" data-info aria-label="How is this estimated?">?</button></h2><span class="hint">estimated</span></div>
      <div class="explain hidden" data-info-text style="margin-bottom:10px">${esc(ESTIMATE_TEXT)}</div>
      <div class="card pad">${attrBlock}</div></div>

    <div class="section"><div class="section-head"><h2>Flavors</h2><span class="hint">avg score · ×count</span></div>
      <div class="card pad">${bars(prefs.dims.family, familyLabel, 11)}
      ${notesLiked.length ? `<div class="small muted" style="margin:14px 0 6px">Tasting notes that came back at least twice</div>${bars(notesLiked.map((x) => ({ ...x, value: x.value.charAt(0).toUpperCase() + x.value.slice(1) })), (v) => v, 10)}` : ''}</div></div>

    <div class="section"><div class="section-head"><h2>Where it’s from</h2></div>
      <div class="card pad">${bars(regionRows)}<div style="height:14px"></div>${bars(prefs.dims.country, (v) => v, 10)}</div></div>
    <div class="section"><div class="section-head"><h2>Altitude & type</h2></div><div class="card pad">${bars(prefs.dims.altitude, (v) => v, 5)}<div style="height:14px"></div>${bars(prefs.dims.type)}</div></div>

    ${subject === 'group' ? crewBlock() : ''}

    <div class="section"><div class="section-head"><h2>Numbers</h2></div>
      <div class="stats">
        ${stat(db.coffees.length, 'coffees')}${stat(prefs.n, 'scored')}${stat(fmt(avgAll), 'avg score')}
        ${stat(db.orders.length, 'orders')}${stat(countries.size, 'countries')}${stat(months[new Date().toISOString().slice(0, 7)] || 0, 'this month')}
      </div></div>`;
  bindWho();
  $view.querySelector('[data-info]')?.addEventListener('click', () => $view.querySelector('[data-info-text]').classList.toggle('hidden'));
}

const stat = (v, l) => `<div class="card stat"><b>${v}</b><span>${l}</span></div>`;

function bindWho() {
  $view.querySelector('#who').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    subject = b.dataset.s;
    sessionStorage.setItem('bc.subject', subject);
    viewTaste();
  });
}

function crewBlock() {
  const { per, pairs } = crewStats(db.coffees, people());
  const withAvg = per.filter((p) => p.avg != null).sort((a, b) => a.avg - b.avg);
  if (withAvg.length < 2) return '';
  const strict = withAvg[0], soft = withAvg[withAvg.length - 1];
  const pct = (r) => Math.round(((r + 1) / 2) * 100);
  return `<div class="section"><div class="section-head"><h2>The crew</h2></div>
    <div class="card pad stack">
      <div class="bars">${per.map((p) => `<div class="bar"><span class="k">${esc(p.person.name)}</span><span class="t"><i class="${verdict(p.avg) || ''}" style="width:${(p.avg || 0) * 10}%"></i></span><span class="v">${fmt(p.avg)} <small>×${p.n}</small></span></div>`).join('')}</div>
      <div class="small muted">Strictest: <b style="color:var(--ink)">${esc(strict.person.name)}</b> · Most generous: <b style="color:var(--ink)">${esc(soft.person.name)}</b></div>
      <div class="twins">${pairs.map((x) => `<div class="twin"><span>${esc(x.a.name)} & ${esc(x.b.name)}</span><span class="small">${x.r == null ? '<span class="muted">need 3+ shared scores</span>' : `<b>${pct(x.r)}%</b> taste match · ${fmt(x.diff)} apart`}</span></div>`).join('')}</div>
    </div></div>`;
}

function radarSvg(data) {
  const W = 340, H = 300, cx = W / 2, cy = H / 2 + 4, R = 105;
  const n = data.length;
  const pt = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + Math.cos(a) * R * (v / 10), cy + Math.sin(a) * R * (v / 10)]; };
  const ring = (v, mid) => `<polygon points="${data.map((_, i) => pt(i, v).join(',')).join(' ')}" fill="none" stroke="${mid ? '#1E1611' : '#E6DBCC'}" stroke-width="${mid ? 1.2 : 1}" ${mid ? 'stroke-dasharray="3 4"' : ''}/>`;
  const shape = data.map((d, i) => pt(i, d.value).join(',')).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Flavor preference map">
    ${ring(10)}${ring(7.5)}${ring(5, true)}${ring(2.5)}
    ${data.map((_, i) => { const [x, y] = pt(i, 10); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#E6DBCC"/>`; }).join('')}
    <polygon points="${shape}" fill="rgba(224,89,42,.22)" stroke="#E0592A" stroke-width="2.5" stroke-linejoin="round"/>
    ${data.map((d, i) => { const [x, y] = pt(i, d.value); return `<circle cx="${x}" cy="${y}" r="${d.n ? 4.5 : 3}" fill="${d.n ? '#E0592A' : '#CFC3B8'}" stroke="${d.n ? '#1E1611' : 'none'}" stroke-width="1.5"/>`; }).join('')}
    ${data.map((d, i) => {
      const [x, y] = pt(i, 12.4);
      const anchor = Math.abs(x - cx) < 8 ? 'middle' : x > cx ? 'start' : 'end';
      return `<text x="${x}" y="${y + 4}" text-anchor="${anchor}" font-size="12" font-weight="700" fill="${d.n ? '#1E1611' : '#B9ABA0'}" font-family="DM Sans, sans-serif">${esc(d.label)}</text>`;
    }).join('')}
  </svg>`;
}

// ================================================================ shop
const shopState = { items: null, loading: false, error: null, hide: null, q: '', type: null, region: null };

function shopTabs(active) {
  return `<div class="seg" style="margin-bottom:14px"><button data-go="#/shop" class="${active === 'shop' ? 'on' : ''}">Shop</button><button data-go="#/orders" class="${active === 'orders' ? 'on' : ''}">Our orders</button></div>`;
}
function bindShopTabs() {
  $view.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => (location.hash = b.dataset.go)));
}

function reasonsHtml(reasons) {
  if (!reasons?.length) return '';
  return `<ul class="reasons">${reasons.slice(0, 4).map((r) => `<li class="${r.delta > 0 ? 'up' : 'down'}">${r.delta > 0 ? '▲' : '▼'} ${esc(describeReason(r))}</li>`).join('')}</ul>`;
}

// Shop = browse the Cross Roast range AND add what you ordered.
// Tap a coffee → details. Tap the circle → select it; a bar appears to add the selection to an order.
let pick = { picked: new Set(), dest: 'new', fixed: null };

function destPicker() {
  const latest = latestOrder();
  if (pick.fixed) return `<div class="dest">Adding to ${esc(orderName(store.getOrder(pick.fixed)))}</div>`;
  if (!latest) return `<div class="dest">Starts a new order · today</div>`;
  const n = store.orderCoffees(latest.id).length;
  return `<div class="dest">Add to</div>
    <div class="seg small" style="margin-bottom:10px">
      <button data-d="${latest.id}" class="${pick.dest === latest.id ? 'on' : ''}">${esc(orderName(latest))} (${n})</button>
      <button data-d="new" class="${pick.dest === 'new' ? 'on' : ''}">New order</button>
    </div>`;
}

function viewShop() {
  const fixed = query().get('order');
  pick = { picked: new Set(), dest: fixed || defaultDest(), fixed };
  const nScored = scoredCoffees(db.coffees, 'group', people()).length;
  $view.innerHTML = `
    <div class="top"><div><div class="eyebrow">Cross Roast</div><h1>Shop</h1></div><button class="btn sm ghost" id="reload">Refresh</button></div>
    ${shopTabs('shop')}
    ${searchBar(shopState, 'Search the shop…', ['hide', 'region', 'type'])}
    <div class="small muted" style="margin:2px 2px 0">Tap a coffee for details · tap <span class="mini-check"></span> to add it to an order</div>
    ${nScored < 3 ? `<div class="card notice" style="margin-top:10px">Score ${3 - nScored} more coffee${3 - nScored === 1 ? '' : 's'} to see how much you’ll probably like each one.</div>` : ''}
    <div id="catalog" class="list"></div>
    <div id="barSpace"></div>
    <div class="pick-bar hidden" id="actions">${destPicker()}<button class="btn primary block" id="addBtn">Add</button></div>`;
  bindShopTabs();
  $view.querySelector('#reload').addEventListener('click', () => loadCatalog(true));
  bindSearch(shopState, ['hide', 'region', 'type'], drawCatalog);

  $view.querySelector('#catalog').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    e.preventDefault();
    const s = b.dataset.pick;
    pick.picked.has(s) ? pick.picked.delete(s) : pick.picked.add(s);
    b.closest('.match').classList.toggle('on', pick.picked.has(s));
    updateBar();
  });
  $view.querySelector('#actions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    pick.dest = b.dataset.d;
    $view.querySelectorAll('#actions [data-d]').forEach((x) => x.classList.toggle('on', x === b));
  });
  $view.querySelector('#addBtn').addEventListener('click', () => {
    const list = chosen();
    if (!list.length) return;
    const orderId = resolveDest(pick.dest);
    list.forEach((c) => store.addCoffee(c, orderId));
    toast(list.length > 1 ? `${list.length} coffees added` : `${list[0].name} added`);
    location.hash = pick.fixed ? `#/order/${orderId}` : '#/';
  });

  if (shopState.items) drawCatalog(); else loadCatalog(false);
}

function chosen() {
  return (shopState.items || []).filter((c) => pick.picked.has(c.slug));
}
function updateBar() {
  const $a = document.getElementById('actions');
  if (!$a) return;
  const n = chosen().length;
  $a.classList.toggle('hidden', !n);
  document.getElementById('barSpace').style.height = n ? '150px' : '0';
  document.getElementById('addBtn').textContent = n > 1 ? `Add ${n} coffees` : 'Add 1 coffee';
}

async function loadCatalog(force) {
  shopState.loading = true; shopState.error = null;
  drawCatalog();
  try { shopState.items = await fetchCatalog(force); if (force) toast('Shop refreshed'); }
  catch (e) { shopState.error = e.message || 'Could not load the shop.'; }
  shopState.loading = false;
  drawCatalog();
}

function drawCatalog() {
  const $c = document.getElementById('catalog');
  if (!$c) return;
  if (shopState.loading && !shopState.items) { $c.innerHTML = `<div class="card preview"><div class="spinner"></div><div class="status-line">Loading the Cross Roast shop…</div></div>`; return; }
  if (shopState.error && !shopState.items) { $c.innerHTML = `<div class="error">${esc(shopState.error)} Check your connection and tap Refresh.</div>`; return; }
  const ps = people();
  let rows = (shopState.items || [])
    .filter((c) => c.inStock !== false && matchesQuery(c, shopState.q) && passes(c, shopState))
    .map((c) => {
      const ex = store.findBySlug(c.slug);
      if (ex) return { c, ex, val: groupScore(ex, ps), tasted: true };
      const p = predict(c, db.coffees, 'group', ps);
      return { c, val: p.score, pred: p, tasted: false };
    });
  if (shopState.hide === 'tasted') rows = rows.filter((r) => !r.tasted);
  rows.sort((a, b) => (b.val ?? -1) - (a.val ?? -1));
  $c.innerHTML = rows.map(({ c, ex, val, pred, tasted }) => {
    const last = tasted ? store.coffeeOrders(ex)[0] : null;
    return `
    <div class="card match ${pick.picked.has(c.slug) ? 'on' : ''}">
      <a class="match-main" href="${tasted ? `#/coffee/${ex.id}` : `#/shop/${esc(c.slug)}`}">
        ${coffeeImg(c)}
        <div class="grow">
          ${nameHtml(c)}
          <div class="small muted" style="margin-top:2px">${esc(procLine(c))}</div>
          <div class="small" style="color:var(--ink-2);margin-top:2px">${esc(c.notes.join(' · '))}</div>
          <div style="margin-top:6px">${tasted
            ? `<div class="row" style="gap:6px;flex-wrap:wrap">${verdictTag(val)}${last ? `<span class="small muted">last ordered ${esc(dateLabel(last.date))}</span>` : ''}</div>`
            : (val != null && reasonsHtml(pred?.reasons?.slice(0, 2))) || '<span class="tag new">New for you</span>'}</div>
        </div>
      </a>
      <div class="match-side">
        ${tasted ? scoreBadge(val) : val == null ? '' : expectBadge(val)}
        <button class="check-btn" data-pick="${esc(c.slug)}" aria-label="Select ${esc(c.name)}"></button>
      </div>
    </div>`;
  }).join('') || '<div class="small muted">No coffees found.</div>';
}

// In-app preview of a shop coffee that you haven't tasted yet.
async function viewShopItem(slug) {
  const ex = store.findBySlug(slug);
  if (ex) { location.replace(`#/coffee/${ex.id}`); return; }
  let c = shopState.items?.find((x) => x.slug === slug);
  if (!c) {
    $view.innerHTML = `<div class="card preview" style="margin-top:20px"><div class="spinner"></div><div class="status-line">Loading…</div></div>`;
    try { c = await fetchProduct(slug); } catch (e) { $view.innerHTML = `<div class="error" style="margin-top:20px">${esc(e.message)}</div>`; return; }
  }
  const ps = people();
  const g = predict(c, db.coffees, 'group', ps);
  const per = ps.map((p) => ({ p, ...predict(c, db.coffees, p.id, ps) }));
  const dest = defaultDest();
  const destLabel = dest === 'new' ? 'a new order' : orderName(store.getOrder(dest));

  $view.innerHTML = `
    <div class="hero">${c.image ? `<img src="${esc(c.image)}" alt="">` : ''}
      <div class="hero-actions"><button class="icon-btn" id="back" aria-label="Back">${ICON.back}</button></div>
    </div>
    <div class="card detail-head">
      <div class="row" style="align-items:flex-start;gap:14px">
        <div class="grow">
          <div class="kicker">${esc([c.type, ...regionsOf(c)].filter(Boolean).join(' · '))}</div>
          ${nameHtml(c, true)}
          <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px"><span class="tag new">Not tasted yet</span>${siteLink(c)}</div>
        </div>
        ${g.score != null ? expectBadge(g.score, 'lg') : ''}
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Would you like it?</h2><span class="hint">${g.score != null ? esc(confidence(g.n).label.toLowerCase()) : ''}</span></div>
      ${g.score == null
        ? `<div class="card notice">Score at least 3 coffees and Brew Crew predicts how much each of you will like this one.</div>`
        : `<div class="card pad stack">
            <div class="person-preds"><div class="crew"><b>${fmt(g.score)}</b><span>Crew</span></div>
              ${per.map((x) => `<div><b>${x.score == null ? '–' : fmt(x.score)}</b><span>${esc(x.p.name)}</span></div>`).join('')}</div>
            <div><div class="small muted" style="font-weight:700">Why</div>${reasonsHtml(g.reasons) || '<div class="small">Nothing stands out: looks like an average coffee for you.</div>'}</div>
            <div class="small muted">Expected score, based on ${g.n} scored coffees.</div>
          </div>`}
    </div>

    ${coffeeSections(c)}

    <div class="section"><button class="btn primary block" id="add">We ordered this · add to ${esc(destLabel)}</button></div>`;
  bindSections();
  $view.querySelector('#back').addEventListener('click', () => goBack('#/shop'));
  $view.querySelector('#add').addEventListener('click', () => {
    store.addCoffee(c, resolveDest(dest));
    toast(`${c.name} added`);
    location.hash = '#/';
  });
}

// ================================================================ orders (under Shop)
function viewOrders() {
  $view.innerHTML = `
    <div class="top"><div><div class="eyebrow">Cross Roast</div><h1>Orders</h1></div></div>
    ${shopTabs('orders')}
    <div class="list">${db.orders.length ? db.orders.map((o) => {
      const cs = store.orderCoffees(o.id);
      const scores = cs.map((c) => groupScore(c, people())).filter((v) => v != null);
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      return `<a class="card order-card" href="#/order/${o.id}">
        <div class="row"><div class="grow"><b style="font:800 18px var(--display)">${esc(orderName(o))}</b><div class="small muted">${cs.length} coffee${cs.length === 1 ? '' : 's'} · ${scores.length} scored</div></div>${scoreBadge(avg)}</div>
        <div class="order-thumbs">${cs.slice(0, 6).map((c) => (c.thumb ? `<img src="${esc(c.thumb)}" alt="" loading="lazy">` : '<div class="ph"></div>')).join('')}</div>
      </a>`;
    }).join('') : '<div class="card empty"><h2>No orders yet</h2><p>Tick coffees in the Shop and add them: an order is created automatically.</p></div>'}</div>`;
  bindShopTabs();
}

function viewOrder(id) {
  const o = store.getOrder(id);
  if (!o) { location.hash = '#/orders'; return; }
  const cs = store.orderCoffees(o.id);
  $view.innerHTML = `
    <div class="top"><button class="back" id="back">${ICON.back} Orders</button></div>
    <div class="eyebrow">${cs.length} coffee${cs.length === 1 ? '' : 's'}</div>
    <h1>${esc(orderName(o))}</h1>
    <div class="row" style="margin:14px 0 4px;gap:8px">
      <input class="input" type="date" id="date" value="${esc(o.date)}" style="max-width:180px">
      <a class="btn soft grow" href="#/shop?order=${o.id}">+ Add coffees</a>
    </div>
    <div class="list">${cs.map((c) => { const s = groupScore(c, people()); return `
      <a class="card item" href="#/coffee/${c.id}">${coffeeImg(c)}<div class="grow">${nameHtml(c)}
      <div class="meta">${esc(procLine(c))}</div><div class="people">${personScoresLine(c)}</div></div>${scoreBadge(s)}</a>`; }).join('') || '<div class="small muted">No coffees in this order yet.</div>'}</div>
    <label class="field section"><span>Order note</span><textarea class="textarea" id="note" placeholder="e.g. price paid, who ordered">${esc(o.note || '')}</textarea></label>
    <div class="section"><button class="btn danger block" id="del">Delete order</button></div>`;
  $view.querySelector('#back').addEventListener('click', () => (location.hash = '#/orders'));
  $view.querySelector('#date').addEventListener('change', (e) => { if (e.target.value) { store.updateOrder(o.id, { date: e.target.value }); toast('Saved'); viewOrder(id); } });
  $view.querySelector('#note').addEventListener('change', (e) => { store.updateOrder(o.id, { note: e.target.value }); toast('Saved'); });
  $view.querySelector('#del').addEventListener('click', async () => {
    if (await ask({ title: 'Delete this order?', text: 'The coffees and their scores stay in your list.' })) { store.deleteOrder(o.id); location.hash = '#/orders'; }
  });
}

// ================================================================ settings (own tab)
function viewSettings() {
  const hasDemo = db.coffees.some((c) => c.demo);
  $view.innerHTML = `
    <div class="top"><div><div class="eyebrow">Brew Crew</div><h1>Settings</h1></div></div>
    <div class="section" style="margin-top:8px"><div class="section-head"><h2>The crew</h2></div>
      <div class="card pad stack">
        ${people().map((p) => `<div class="row"><input class="input" data-p="${p.id}" value="${esc(p.name)}"><button class="btn sm danger" data-rm="${p.id}">Remove</button></div>`).join('')}
        <div class="row"><input class="input" id="newName" placeholder="New crew member"><button class="btn sm soft" id="addP">Add</button></div>
      </div></div>
    <div class="section"><div class="section-head"><h2>Try it out</h2></div>
      <div class="card pad stack">
        <p class="small muted" style="margin:0">Demo data fills the app with real Cross Roast coffees and made-up scores, so you can see the taste profile in action. Remove it with one tap; your own coffees stay.</p>
        ${hasDemo ? '<button class="btn block" id="rmDemo">Remove demo data</button>' : '<button class="btn soft block" id="demo">Load demo data</button>'}
      </div></div>
    <div class="section"><div class="section-head"><h2>How estimates work</h2></div>
      <div class="card pad small" style="color:var(--ink-2)">${esc(ESTIMATE_TEXT)}<br><br>Predictions (“for you”) compare a coffee’s process, flavors, origin and estimated profile with how you scored similar coffees. They start after 3 scored coffees and get better from 10–15 on.</div></div>
    <div class="section"><div class="section-head"><h2>Data</h2></div>
      <div class="card pad stack">
        <p class="small muted" style="margin:0">Everything is saved on this device (${db.coffees.length} coffees, ${db.orders.length} orders). Syncing between phones comes in version 2.</p>
        <button class="btn danger block" id="wipe">Delete everything</button>
      </div></div>
    <p class="small muted" style="text-align:center;margin-top:28px">Brew Crew · v1.2</p>`;
  $view.querySelectorAll('[data-p]').forEach((i) => i.addEventListener('change', () => { store.renamePerson(i.dataset.p, i.value); toast('Saved'); }));
  $view.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    const p = people().find((x) => x.id === b.dataset.rm);
    if (await ask({ title: `Remove ${p.name}?`, text: 'Their scores are hidden but kept, in case you add them back.', ok: 'Remove' })) { store.removePerson(p.id); viewSettings(); }
  }));
  $view.querySelector('#addP').addEventListener('click', () => { store.addPerson($view.querySelector('#newName').value); viewSettings(); });
  $view.querySelector('#demo')?.addEventListener('click', async () => {
    const { demoData } = await import('./demo.js');
    store.addDemo(demoData(people()));
    toast('Demo data loaded');
    location.hash = '#/taste';
  });
  $view.querySelector('#rmDemo')?.addEventListener('click', () => { store.removeDemo(); toast('Demo data removed'); viewSettings(); });
  $view.querySelector('#wipe').addEventListener('click', async () => {
    if (await ask({ title: 'Delete everything?', text: 'All coffees, scores and orders on this device will be removed. This cannot be undone.', ok: 'Delete all' })) {
      store.wipe(); toast('Everything deleted'); location.hash = '#/';
    }
  });
}

// ================================================================ boot
render();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    // Check for a new version every time the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}
