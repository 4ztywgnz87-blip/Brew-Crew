import * as store from './store.js';
import { db } from './store.js';
import { fetchProduct, fetchCatalog, findLinks } from './api.js';
import { estimateAttributes, familiesOf, familiesOfNote, familyLabel, ATTRIBUTES, bucket, FAMILIES } from './flavor.js';
import {
  groupScore, personScore, scoreFor, verdict, preferences, attributeTrends, radar, confidence,
  predict, describeReason, summary, crewStats, round1, scoredCoffees, REORDER_AT, SKIP_AT,
} from './analysis.js';

const $view = document.getElementById('view');
const $toast = document.getElementById('toast');

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => (v == null ? '–' : Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1));
const fmtHalf = (v) => (v == null ? '–' : v % 1 === 0 ? String(v) : v.toFixed(1));
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  paste: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/></svg>',
};

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 1400);
}

const people = () => db.people;
const coffeeImg = (c, cls = 'thumb') =>
  c.thumb || c.image ? `<img class="${cls}" src="${esc(c.thumb || c.image)}" alt="" loading="lazy">` : `<div class="${cls}"></div>`;
const procLine = (c) => [c.process && (c.process + (c.modifiers?.length ? ' · ' + c.modifiers.join(', ') : '')), (c.countries || []).join(', ')].filter(Boolean).join(' · ');
const scoreBadge = (v, cls = '') => `<div class="score ${cls} ${verdict(v) || ''}">${fmt(v)}</div>`;
const verdictTag = (v) => {
  const t = verdict(v);
  return t === 'reorder' ? '<span class="tag reorder">Reorder</span>' : t === 'skip' ? '<span class="tag skip">Skip</span>' : t === 'ok' ? '<span class="tag ok">Okay</span>' : '<span class="tag plain">Not rated</span>';
};
const dateLabel = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function personScoresLine(c) {
  return people()
    .map((p) => {
      const v = personScore(c, p.id);
      return `<span>${esc(p.name)} ${v == null ? '<b class="none">–</b>' : `<b>${fmtHalf(v)}</b>`}</span>`;
    })
    .join('');
}

// ---------------------------------------------------------------- router
const routes = [
  [/^#?\/?$/, viewCoffees, 'coffees'],
  [/^#\/add$/, viewAdd, 'add'],
  [/^#\/coffee\/([\w-]+)$/, viewCoffee, 'coffees'],
  [/^#\/edit\/([\w-]+)$/, viewEdit, 'coffees'],
  [/^#\/taste$/, viewTaste, 'taste'],
  [/^#\/shop$/, viewShop, 'shop'],
  [/^#\/orders$/, viewOrders, 'orders'],
  [/^#\/order\/([\w-]+)$/, viewOrder, 'orders'],
  [/^#\/settings$/, viewSettings, 'coffees'],
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
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

// ---------------------------------------------------------------- coffees list
const listState = { q: '', filter: 'all', sort: 'newest' };

function viewCoffees() {
  const total = db.coffees.length;
  if (!total) {
    $view.innerHTML = `
      <div class="top"><div><h1>Brew Crew</h1><div class="sub">${esc(people().map((p) => p.name).join(' · '))}</div></div>
        <a class="icon-btn" href="#/settings" aria-label="Settings">${ICON.gear}</a></div>
      <div class="card empty">
        <h2>No coffees yet</h2>
        <p>Paste a link from crossroast.be and everything is filled in for you.<br>Then each of you gives a score.</p>
        <a class="btn primary" href="#/add">Add your first coffee</a>
        <p class="small" style="margin-top:18px">Just want to look around? <a class="linkish" href="#/settings">Load demo data</a></p>
      </div>`;
    return;
  }
  const processes = [...new Set(db.coffees.map((c) => c.process).filter(Boolean))].sort();
  const filters = [
    ['all', 'All'], ['reorder', 'Reorder'], ['skip', 'Skip'], ['unrated', 'Not rated'],
    ...processes.map((p) => [`p:${p}`, p]),
  ];
  $view.innerHTML = `
    <div class="top"><div><h1>Brew Crew</h1><div class="sub">${total} coffee${total === 1 ? '' : 's'} tasted</div></div>
      <a class="icon-btn" href="#/settings" aria-label="Settings">${ICON.gear}</a></div>
    <div class="search">${ICON.search}<input class="input" id="q" type="search" placeholder="Search name, country, note…" value="${esc(listState.q)}" autocomplete="off"></div>
    <div class="chips scroll" id="filters">${filters.map(([k, l]) => `<button class="chip ${listState.filter === k ? 'on' : ''}" data-f="${esc(k)}">${esc(l)}</button>`).join('')}</div>
    <div class="row" style="margin-top:10px;justify-content:space-between">
      <span class="small muted" id="count"></span>
      <select class="select" id="sort" style="width:auto;padding:6px 10px;font-size:14px">
        <option value="newest">Newest first</option><option value="best">Best score</option><option value="worst">Lowest score</option><option value="name">Name</option>
      </select>
    </div>
    <div class="list" id="list"></div>`;
  const $list = $view.querySelector('#list');
  const $count = $view.querySelector('#count');
  $view.querySelector('#sort').value = listState.sort;

  const draw = () => {
    const q = listState.q.trim().toLowerCase();
    let items = db.coffees.map((c) => ({ c, s: groupScore(c, people()) }));
    if (q) items = items.filter(({ c }) => [c.name, c.processText, c.variety, ...(c.countries || []), ...(c.notes || [])].join(' ').toLowerCase().includes(q));
    const f = listState.filter;
    if (f === 'reorder' || f === 'skip') items = items.filter((x) => verdict(x.s) === f);
    else if (f === 'unrated') items = items.filter((x) => x.s == null);
    else if (f.startsWith('p:')) items = items.filter((x) => x.c.process === f.slice(2));
    const by = {
      newest: (a, b) => (b.c.addedAt || '').localeCompare(a.c.addedAt || ''),
      best: (a, b) => (b.s ?? -1) - (a.s ?? -1),
      worst: (a, b) => (a.s ?? 99) - (b.s ?? 99),
      name: (a, b) => a.c.name.localeCompare(b.c.name),
    };
    items.sort(by[listState.sort]);
    $count.textContent = `${items.length} shown`;
    $list.innerHTML = items.length
      ? items.map(({ c, s }) => `
        <a class="card item" href="#/coffee/${c.id}">
          ${coffeeImg(c)}
          <div class="grow">
            <div class="name ellipsis">${esc(c.name)}</div>
            <div class="meta ellipsis">${esc(procLine(c))}</div>
            <div class="people">${personScoresLine(c)}</div>
          </div>
          ${scoreBadge(s)}
        </a>`).join('')
      : `<div class="empty small">Nothing matches.</div>`;
  };
  draw();
  $view.querySelector('#q').addEventListener('input', (e) => { listState.q = e.target.value; draw(); });
  $view.querySelector('#sort').addEventListener('change', (e) => { listState.sort = e.target.value; draw(); });
  $view.querySelector('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    listState.filter = b.dataset.f;
    $view.querySelectorAll('#filters .chip').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
}

// ---------------------------------------------------------------- add
function orderOptions(selected) {
  const recent = db.orders.slice(0, 6);
  return `
    <option value="new" ${selected === 'new' ? 'selected' : ''}>New order · today</option>
    ${recent.map((o) => `<option value="${o.id}" ${selected === o.id ? 'selected' : ''}>Order of ${esc(dateLabel(o.date))} (${store.orderCoffees(o.id).length})</option>`).join('')}
    <option value="none" ${selected === 'none' ? 'selected' : ''}>Not part of an order</option>`;
}

function resolveOrder(choice) {
  if (choice === 'none') return null;
  if (choice === 'new') return store.createOrder().id;
  return choice;
}

function viewAdd() {
  const state = { items: new Map(), order: store.recentOrder()?.id || 'new' };
  $view.innerHTML = `
    <div class="top"><div><h1>Add coffee</h1><div class="sub">Paste one or more crossroast.be links</div></div></div>
    <div class="paste-box">
      <input class="input" id="link" type="url" inputmode="url" placeholder="https://www.crossroast.be/product/…" autocomplete="off">
      <button class="btn soft" id="pasteBtn" aria-label="Paste">${ICON.paste}Paste</button>
    </div>
    <div id="results" class="stack" style="margin-top:14px"></div>
    <div id="actions" class="stack hidden" style="margin-top:14px">
      <label class="field"><span>Order</span><select class="select" id="order">${orderOptions(state.order)}</select></label>
      <button class="btn primary block" id="addBtn">Add & rate</button>
    </div>
    <p class="small muted" style="margin-top:22px">Tip: paste several links at once to add a whole order in one go.<br>
    Link not working? <a class="linkish" href="#/edit/new">Enter a coffee manually</a></p>`;
  const $link = $view.querySelector('#link');
  const $results = $view.querySelector('#results');
  const $actions = $view.querySelector('#actions');
  const $addBtn = $view.querySelector('#addBtn');

  const draw = () => {
    const items = [...state.items.values()];
    $results.innerHTML = items.map((it) => {
      if (it.status === 'loading') return `<div class="card preview"><div class="spinner"></div><div class="grow status-line">Reading ${esc(it.slug)}…</div></div>`;
      if (it.status === 'error') return `<div class="card preview"><div class="grow"><div class="error">${esc(it.slug)}: ${esc(it.error)}</div>
        <a class="linkish small" href="#/edit/new?url=${encodeURIComponent('https://www.crossroast.be/product/' + it.slug + '/')}">Enter manually instead</a></div></div>`;
      const c = it.coffee;
      const ex = store.findBySlug(c.slug);
      return `<div class="card preview">${coffeeImg(c)}<div class="grow">
          <div style="font-weight:600">${esc(c.name)}</div>
          <div class="small muted">${esc(procLine(c))}</div>
          <div class="chips" style="margin-top:6px">${c.notes.map((n) => `<span class="chip note">${esc(n)}</span>`).join('')}</div>
          ${ex ? `<div class="small" style="margin-top:6px"><span class="tag ok">Already tasted</span> <a class="linkish" href="#/coffee/${ex.id}">Open it</a></div>` : ''}
        </div></div>`;
    }).join('');
    const ready = items.filter((i) => i.status === 'ok' && !store.findBySlug(i.coffee.slug));
    $actions.classList.toggle('hidden', !ready.length);
    $addBtn.textContent = ready.length > 1 ? `Add all ${ready.length} coffees` : 'Add & rate';
  };

  const handle = (text) => {
    const slugs = findLinks(text);
    if (!slugs.length) {
      if (text.trim()) $results.innerHTML = `<div class="error">That doesn't look like a crossroast.be product link.</div>`;
      return;
    }
    for (const slug of slugs) {
      if (state.items.has(slug)) continue;
      state.items.set(slug, { slug, status: 'loading' });
      fetchProduct(slug)
        .then((coffee) => state.items.set(slug, { slug, status: 'ok', coffee }))
        .catch((e) => state.items.set(slug, { slug, status: 'error', error: e.message || 'Could not read this page.' }))
        .finally(draw);
    }
    draw();
  };

  $link.addEventListener('input', () => handle($link.value));
  $view.querySelector('#pasteBtn').addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      $link.value = t.trim();
      handle(t);
    } catch {
      $link.focus();
      toast('Long-press the field to paste');
    }
  });
  $view.querySelector('#order').addEventListener('change', (e) => (state.order = e.target.value));
  $addBtn.addEventListener('click', () => {
    const ready = [...state.items.values()].filter((i) => i.status === 'ok' && !store.findBySlug(i.coffee.slug));
    if (!ready.length) return;
    const orderId = resolveOrder(state.order);
    const added = ready.map((i) => store.addCoffee(i.coffee, orderId).coffee);
    toast(added.length > 1 ? `${added.length} coffees added` : 'Added');
    location.hash = added.length === 1 ? `#/coffee/${added[0].id}?new=1` : orderId ? `#/order/${orderId}` : '#/';
  });
  setTimeout(() => $link.focus(), 50);
}

// ---------------------------------------------------------------- rating bar
function ratingBar(value) {
  const pct = value == null ? 0 : (value / 10) * 100;
  return `<div class="rbar" role="slider" aria-valuemin="1" aria-valuemax="10" aria-valuenow="${value ?? ''}" tabindex="0">
    <div class="fill" style="width:${pct}%"></div>
    <div class="ticks">${Array.from({ length: 10 }, (_, i) => `<span class="${value != null && i + 1 <= value ? 'lit' : ''}">${i + 1}</span>`).join('')}</div>
  </div>`;
}

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
    // each cell = one point; left half of a cell = x.5, right half = x
    return Math.max(1, Math.min(10, Math.ceil(f * 20) / 2));
  };
  let dragging = false;
  $el.addEventListener('pointerdown', (e) => {
    dragging = true;
    $el.setPointerCapture(e.pointerId);
    value = at(e.clientX); paint(); onChange(value);
  });
  $el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const v = at(e.clientX);
    if (v !== value) { value = v; paint(); onChange(value); }
  });
  const end = () => { if (dragging) { dragging = false; onCommit(value); } };
  $el.addEventListener('pointerup', end);
  $el.addEventListener('pointercancel', end);
  $el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') value = Math.min(10, (value ?? 0.5) + 0.5);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') value = Math.max(1, (value ?? 1.5) - 0.5);
    else return;
    e.preventDefault(); paint(); onChange(value); onCommit(value);
  });
  return { set(v) { value = v; paint(); } };
}

// ---------------------------------------------------------------- coffee detail
async function viewCoffee(id) {
  const c = store.getCoffee(id);
  if (!c) { location.hash = '#/'; return; }
  const isNew = query().get('new') === '1';
  const attrs = estimateAttributes(c);
  const fams = familiesOf(c);
  const order = c.orderId ? store.getOrder(c.orderId) : null;
  const g = groupScore(c, people());

  $view.innerHTML = `
    <div class="hero" id="hero">${c.image ? `<img src="${esc(c.image)}" alt="">` : ''}
      <div class="hero-actions">
        <button class="icon-btn" id="back" aria-label="Back">${ICON.back}</button>
        <div class="row"><label class="icon-btn" aria-label="Add photo">${ICON.camera}<input id="photo" type="file" accept="image/*" hidden></label>
        <a class="icon-btn" href="#/edit/${c.id}" aria-label="Edit">${ICON.edit}</a></div>
      </div>
    </div>
    <div class="card detail-head">
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <div class="kicker">${esc(c.type || '')}${c.countries?.length ? ' · ' + esc(c.countries.join(', ')) : ''}</div>
          <h1>${esc(c.name)}</h1>
          <div class="row" style="gap:8px;flex-wrap:wrap" id="verdictRow">${verdictTag(g)}
            ${c.url ? `<a class="linkish small row" style="gap:4px" href="${esc(c.url)}" target="_blank" rel="noopener">crossroast.be <span style="width:14px;height:14px;display:inline-flex">${ICON.ext.replace('<svg', '<svg style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2"')}</span></a>` : ''}</div>
        </div>
        <div id="groupBadge">${scoreBadge(g, 'lg')}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Scores</h2><span class="hint">1–10 · tap or slide · last score counts</span></div>
      <div class="card raters" id="raters">
        ${people().map((p) => {
          const s = c.scores?.[p.id] || {};
          return `<div class="rater" data-p="${p.id}">
            <div class="rater-top"><span class="who">${esc(p.name)}</span>
              <div class="rater-tools"><button data-act="note">${s.note ? 'Edit note' : '+ Note'}</button><button data-act="clear" class="${s.score == null ? 'hidden' : ''}">Clear</button>
              <span class="val ${s.score == null ? 'unset' : ''}">${s.score == null ? 'no score' : fmtHalf(s.score)}</span></div></div>
            ${ratingBar(s.score ?? null)}
            ${s.note ? `<div class="note-show">“${esc(s.note)}”</div>` : ''}
            <textarea class="textarea note-input hidden" rows="2" placeholder="What did you think? (optional)">${esc(s.note || '')}</textarea>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Tasting notes</h2><span class="hint">from Cross Roast</span></div>
      <div class="chips">${(c.notes || []).map((n) => `<span class="chip note">${esc(n)}</span>`).join('') || '<span class="muted small">None listed</span>'}</div>
      ${fams.length ? `<div class="small muted" style="margin-top:8px">Flavor families: ${fams.map((f) => esc(familyLabel(f))).join(', ')}</div>` : ''}
    </div>

    <div class="section">
      <div class="section-head"><h2>Profile</h2><span class="hint">estimated from notes & process</span></div>
      <div class="card pad meters">${ATTRIBUTES.map((a) => meter(a, attrs[a.key])).join('')}</div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Details</h2></div>
      <div class="card pad facts">
        ${fact('Process', c.processText || c.process)}
        ${fact('Variety', c.variety)}
        ${fact('Altitude', c.altitudeText || (c.altitude ? c.altitude + ' m' : null))}
        ${fact('Harvest', c.harvest)}
        ${fact('Origin', (c.countries || []).join(', '))}
        ${fact('Price', c.priceFrom ? `from € ${c.priceFrom.toFixed(2).replace('.', ',')}` : null)}
        ${fact('Order', order ? `<a class="linkish" href="#/order/${order.id}">${esc(dateLabel(order.date))}</a>` : 'none', true)}
        ${fact('Added', c.addedAt ? dateLabel(c.addedAt.slice(0, 10)) : null)}
      </div>
    </div>

    <div class="section hidden" id="myPhotoSec">
      <div class="section-head"><h2>Our photo</h2><button class="linkish small" id="rmPhoto">Remove</button></div>
      <img id="myPhoto" class="card" style="width:100%;border-radius:16px" alt="">
    </div>

    ${c.story || c.intro ? `<div class="section"><div class="section-head"><h2>The story</h2></div>
      <div class="card pad"><div class="story clamp" id="story">${esc(c.story || c.intro)}</div>
      <button class="linkish small" id="more" style="margin-top:8px">Read more</button></div></div>` : ''}

    <div class="section"><button class="btn danger block" id="del">Delete this coffee</button></div>`;

  $view.querySelector('#back').addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '#/')));
  $view.querySelector('#more')?.addEventListener('click', (e) => {
    const s = $view.querySelector('#story');
    s.classList.toggle('clamp');
    e.target.textContent = s.classList.contains('clamp') ? 'Read more' : 'Show less';
  });
  $view.querySelector('#del').addEventListener('click', () => {
    if (confirm(`Delete “${c.name}” and its scores?`)) { store.deleteCoffee(c.id); toast('Deleted'); location.hash = '#/'; }
  });

  const refreshGroup = () => {
    const gs = groupScore(c, people());
    $view.querySelector('#groupBadge').innerHTML = scoreBadge(gs, 'lg');
    const row = $view.querySelector('#verdictRow');
    row.firstElementChild.outerHTML = verdictTag(gs);
  };

  $view.querySelectorAll('.rater').forEach(($r) => {
    const pid = $r.dataset.p;
    const $val = $r.querySelector('.val');
    const $clear = $r.querySelector('[data-act=clear]');
    const show = (v) => { $val.textContent = v == null ? 'no score' : fmtHalf(v); $val.classList.toggle('unset', v == null); $clear.classList.toggle('hidden', v == null); };
    const bar = bindRating($r.querySelector('.rbar'), c.scores?.[pid]?.score ?? null, show, (v) => {
      store.setScore(c.id, pid, v); refreshGroup(); toast('Saved');
    });
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

  // own photo
  const showPhoto = async () => {
    const blob = await store.loadPhoto(c.id);
    const sec = $view.querySelector('#myPhotoSec');
    if (!sec) return;
    if (blob) { $view.querySelector('#myPhoto').src = URL.createObjectURL(blob); sec.classList.remove('hidden'); }
    else sec.classList.add('hidden');
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

function fact(label, value, raw = false) {
  if (!value) return '';
  return `<div><span>${label}</span><b>${raw ? value : esc(value)}</b></div>`;
}

function meter(a, v, marker) {
  return `<div class="meter"><div class="lbl"><b>${a.label}</b><span>${v != null ? v.toFixed(1) + ' / 5' : ''}</span></div>
    <div class="track"><i style="width:${v != null ? (v / 5) * 100 : 0}%"></i>${marker != null ? `<em style="left:calc(${(marker / 5) * 100}% - 1.5px)"></em>` : ''}</div>
    <div class="ends"><span>${a.low}</span><span>${a.high}</span></div></div>`;
}

// ---------------------------------------------------------------- edit / manual
function viewEdit(id) {
  const isNew = id === 'new';
  const c = isNew ? { name: '', url: query().get('url') || '', countries: [], notes: [], modifiers: [], process: '', variety: '', altitudeText: '', harvest: '', type: 'Single origin' } : store.getCoffee(id);
  if (!c) { location.hash = '#/'; return; }
  const orderSel = isNew ? store.recentOrder()?.id || 'new' : c.orderId || 'none';
  $view.innerHTML = `
    <div class="top"><button class="back" id="back">${ICON.back.replace('<svg', '<svg style="width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2"')} Back</button></div>
    <h1 style="margin-bottom:16px">${isNew ? 'Add manually' : 'Edit coffee'}</h1>
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
      <label class="field"><span>Order</span><select class="select" name="order">${orderOptions(orderSel)}</select></label>
      <button class="btn primary block" type="submit">${isNew ? 'Add & rate' : 'Save'}</button>
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
      notes: list(fd.notes), variety: fd.variety.trim() || null, altitudeText: fd.altitudeText.trim() || null,
      altitude: alts.length ? Math.round(alts.reduce((a, b) => a + b, 0) / alts.length) : null, harvest: fd.harvest.trim() || null, type: fd.type,
    };
    if (isNew) {
      const slug = (patch.url && findLinks(patch.url)[0]) || 'manual-' + store.uid();
      const existing = store.findBySlug(slug);
      if (existing) { location.hash = `#/coffee/${existing.id}`; return; }
      const { coffee } = store.addCoffee({ ...patch, slug, story: '', intro: '', image: null, thumb: null }, resolveOrder(fd.order));
      location.hash = `#/coffee/${coffee.id}?new=1`;
    } else {
      patch.orderId = resolveOrder(fd.order);
      store.updateCoffee(c.id, patch);
      toast('Saved');
      location.hash = `#/coffee/${c.id}`;
    }
  });
}

// ---------------------------------------------------------------- taste profile
let subject = sessionStorage.getItem('bc.subject') || 'group';

function viewTaste() {
  if (subject !== 'group' && !people().some((p) => p.id === subject)) subject = 'group';
  const ps = people();
  const prefs = preferences(db.coffees, subject, ps);
  const conf = confidence(prefs.n);
  const subjName = subject === 'group' ? 'the crew' : ps.find((p) => p.id === subject).name;
  const rated = scoredCoffees(db.coffees, subject, ps).sort((a, b) => b.score - a.score);
  const lines = summary(db.coffees, subject, ps);

  const seg = `<div class="seg" id="seg"><button data-s="group" class="${subject === 'group' ? 'on' : ''}">Crew</button>${ps.map((p) => `<button data-s="${p.id}" class="${subject === p.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>`;

  if (prefs.n === 0) {
    $view.innerHTML = `<div class="top"><div><h1>Taste profile</h1><div class="sub">What ${esc(subjName)} likes</div></div></div>${seg}
      <div class="card empty" style="margin-top:16px"><h2>Nothing scored yet</h2><p>Score a few coffees and your taste profile appears here.</p><a class="btn primary" href="#/">Go to coffees</a></div>`;
    bindSeg();
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
    return `<div><div class="row" style="justify-content:space-between;margin-bottom:6px"><b>${a.label}</b><span class="small muted">${verdictTxt}</span></div>
      ${bars(rows, (v) => name[v], 3)}</div>`;
  }).join('<div style="height:14px"></div>');

  const radarData = radar(prefs);
  const crew = subject === 'group' ? crewBlock() : '';
  const months = {};
  db.coffees.forEach((c) => { const m = (c.addedAt || '').slice(0, 7); if (m) months[m] = (months[m] || 0) + 1; });
  const countries = new Set(db.coffees.flatMap((c) => c.countries || []));
  const avgAll = rated.length ? rated.reduce((s, x) => s + x.score, 0) / rated.length : null;
  const notesLiked = (prefs.dims.note || []).filter((x) => x.n >= 2).slice(0, 10);
  const bottom = rated.filter((x) => verdict(x.score) === 'skip').slice(-5).reverse();

  $view.innerHTML = `
    <div class="top"><div><h1>Taste profile</h1><div class="sub">What ${esc(subjName)} likes · ${prefs.n} coffee${prefs.n === 1 ? '' : 's'} scored</div></div></div>
    ${seg}
    <div class="card confidence" style="margin-top:14px">
      <div class="dots">${[0, 1, 2, 3].map((i) => `<i class="${i <= conf.level ? 'on' : ''}"></i>`).join('')}</div>
      <div><b>${conf.label}</b><div class="small muted">${conf.text}</div></div>
    </div>

    ${lines.length ? `<div class="section"><div class="section-head"><h2>In a nutshell</h2></div><div class="card pad"><ul class="summary">${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div></div>` : ''}

    <div class="section"><div class="section-head"><h2>Top ${Math.min(10, rated.length)}</h2><span class="hint">reorder from ${REORDER_AT}</span></div>
      <div class="card top10">${rated.slice(0, 10).map((x, i) => `<a href="#/coffee/${x.coffee.id}"><span class="rank">${i + 1}</span>${coffeeImg(x.coffee, 'thumb sm')}<div class="grow"><div class="ellipsis" style="font-weight:600">${esc(x.coffee.name)}</div><div class="small muted ellipsis">${esc(procLine(x.coffee))}</div></div><span class="s" style="color:var(--${verdict(x.score) === 'reorder' ? 'good' : verdict(x.score) === 'skip' ? 'bad' : 'mid'})">${fmt(x.score)}</span></a>`).join('')}</div>
    </div>

    ${bottom.length ? `<div class="section"><div class="section-head"><h2>Don’t reorder</h2><span class="hint">${SKIP_AT} or lower</span></div>
      <div class="card top10">${bottom.map((x) => `<a href="#/coffee/${x.coffee.id}">${coffeeImg(x.coffee, 'thumb sm')}<div class="grow"><div class="ellipsis" style="font-weight:600">${esc(x.coffee.name)}</div><div class="small muted ellipsis">${esc(procLine(x.coffee))}</div></div><span class="s" style="color:var(--bad)">${fmt(x.score)}</span></a>`).join('')}</div></div>` : ''}

    <div class="section"><div class="section-head"><h2>Flavor map</h2></div>
      <div class="card pad">
        <div class="radar-wrap">${radarSvg(radarData)}</div>
        <div class="explain"><b>How to read this:</b> each spoke is a flavor family (from the tasting notes). The middle dashed ring is “neutral”. A point further <b>outside</b> means coffees with that flavor score <b>higher</b> than ${esc(subjName === 'the crew' ? 'your' : subjName + '’s')} average; further <b>inside</b> means lower. Grey points haven’t been tasted yet.</div>
      </div>
    </div>

    <div class="section"><div class="section-head"><h2>Process</h2><span class="hint">average score · ×count</span></div>
      <div class="card pad">${bars(prefs.dims.process)}
        ${(prefs.dims.fermentation || []).length > 1 ? `<div style="height:14px"></div><div class="small muted" style="margin-bottom:6px">Fermentation style</div>${bars(prefs.dims.fermentation)}` : ''}</div></div>

    <div class="section"><div class="section-head"><h2>Acidity, body & co.</h2><span class="hint">estimated per coffee</span></div>
      <div class="card pad">${attrBlock}</div></div>

    <div class="section"><div class="section-head"><h2>Flavors</h2><span class="hint">average score · ×count</span></div>
      <div class="card pad">${bars(prefs.dims.family, familyLabel, 11)}
      ${notesLiked.length ? `<div class="small muted" style="margin:14px 0 6px">Tasting notes that came back at least twice</div><div class="bars">${notesLiked.map((x) => `<div class="bar"><span class="k">${esc(x.value.charAt(0).toUpperCase() + x.value.slice(1))}</span><span class="t"><i class="${verdict(x.avg)}" style="width:${x.avg * 10}%"></i></span><span class="v">${fmt(x.avg)} <small>×${x.n}</small></span></div>`).join('')}</div>` : ''}</div></div>

    <div class="section"><div class="section-head"><h2>Countries</h2></div><div class="card pad">${bars(prefs.dims.country, (v) => v, 10)}</div></div>
    <div class="section"><div class="section-head"><h2>Altitude & type</h2></div><div class="card pad">${bars(prefs.dims.altitude, (v) => v, 5)}<div style="height:14px"></div>${bars(prefs.dims.type)}</div></div>

    ${crew}

    <div class="section"><div class="section-head"><h2>Numbers</h2></div>
      <div class="stats">
        ${stat(db.coffees.length, 'coffees')}${stat(prefs.n, 'scored')}${stat(fmt(avgAll), 'avg score')}
        ${stat(db.orders.length, 'orders')}${stat(countries.size, 'countries')}${stat(months[new Date().toISOString().slice(0, 7)] || 0, 'this month')}
      </div>
    </div>`;
  bindSeg();
}

const stat = (v, l) => `<div class="card stat"><b>${v}</b><span>${l}</span></div>`;

function bindSeg() {
  $view.querySelector('#seg').addEventListener('click', (e) => {
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
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * R * (v / 10), cy + Math.sin(a) * R * (v / 10)];
  };
  const ring = (v, cls) => `<polygon points="${data.map((_, i) => pt(i, v).join(',')).join(' ')}" fill="none" stroke="${cls === 'mid' ? '#C9A88A' : '#ECE3D9'}" stroke-width="${cls === 'mid' ? 1.2 : 1}" ${cls === 'mid' ? 'stroke-dasharray="4 4"' : ''}/>`;
  const shape = data.map((d, i) => pt(i, d.value).join(',')).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Flavor preference map">
    ${ring(10)}${ring(7.5)}${ring(5, 'mid')}${ring(2.5)}
    ${data.map((_, i) => { const [x, y] = pt(i, 10); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#ECE3D9"/>`; }).join('')}
    <polygon points="${shape}" fill="rgba(168,86,42,.18)" stroke="#A8562A" stroke-width="2" stroke-linejoin="round"/>
    ${data.map((d, i) => { const [x, y] = pt(i, d.value); return `<circle cx="${x}" cy="${y}" r="${d.n ? 4 : 3}" fill="${d.n ? '#A8562A' : '#CFC3B8'}"/>`; }).join('')}
    ${data.map((d, i) => {
      const [x, y] = pt(i, 12.4);
      const anchor = Math.abs(x - cx) < 8 ? 'middle' : x > cx ? 'start' : 'end';
      return `<text x="${x}" y="${y + 4}" text-anchor="${anchor}" font-size="11.5" font-weight="600" fill="${d.n ? '#5B4A3F' : '#B9ABA0'}" font-family="Inter, sans-serif">${esc(d.label)}</text>`;
    }).join('')}
  </svg>`;
}

// ---------------------------------------------------------------- shop / match
const shopState = { items: null, loading: false, error: null, hideTasted: false };

function predictionsFor(c) {
  const ps = people();
  const g = predict(c, db.coffees, 'group', ps);
  const per = ps.map((p) => ({ p, ...predict(c, db.coffees, p.id, ps) }));
  return { g, per };
}

function reasonsHtml(reasons) {
  if (!reasons?.length) return '';
  return `<ul class="reasons">${reasons.slice(0, 4).map((r) => `<li class="${r.delta > 0 ? 'up' : 'down'}">${r.delta > 0 ? '▲' : '▼'} ${esc(describeReason(r))}</li>`).join('')}</ul>`;
}

function viewShop() {
  const nScored = scoredCoffees(db.coffees, 'group', people()).length;
  $view.innerHTML = `
    <div class="top"><div><h1>Shop</h1><div class="sub">Would we like it? Check before you order.</div></div></div>
    <div class="paste-box">
      <input class="input" id="link" type="url" inputmode="url" placeholder="Paste a crossroast.be link to check" autocomplete="off">
      <button class="btn soft" id="pasteBtn">${ICON.paste}Paste</button>
    </div>
    <div id="check" style="margin-top:12px"></div>
    ${nScored < 3 ? `<div class="card pad small" style="margin-top:14px">Predictions start after <b>3 scored coffees</b> (you have ${nScored}). They get better from 10–15 on.</div>` : ''}
    <div class="section">
      <div class="section-head"><h2>Now at Cross Roast</h2><button class="linkish small" id="reload">Refresh</button></div>
      <div class="chips" style="margin-bottom:10px"><button class="chip ${shopState.hideTasted ? 'on' : ''}" id="hideTasted">Hide tasted</button></div>
      <div id="catalog" class="list" style="margin-top:0"></div>
    </div>`;
  const $check = $view.querySelector('#check');
  const $link = $view.querySelector('#link');

  const check = async (text) => {
    const slug = findLinks(text)[0];
    if (!slug) { $check.innerHTML = text.trim() ? '<div class="error">Not a crossroast.be product link.</div>' : ''; return; }
    $check.innerHTML = `<div class="card preview"><div class="spinner"></div><div class="status-line">Reading…</div></div>`;
    try {
      const c = await fetchProduct(slug);
      $check.innerHTML = checkCard(c);
      bindCheck(c);
    } catch (e) {
      $check.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    }
  };
  const bindCheck = (c) => {
    $check.querySelector('[data-add]')?.addEventListener('click', () => {
      const { coffee } = store.addCoffee(c, resolveOrder(store.recentOrder()?.id || 'new'));
      location.hash = `#/coffee/${coffee.id}?new=1`;
    });
  };
  $link.addEventListener('input', () => check($link.value));
  $view.querySelector('#pasteBtn').addEventListener('click', async () => {
    try { const t = await navigator.clipboard.readText(); $link.value = t.trim(); check(t); } catch { $link.focus(); toast('Long-press the field to paste'); }
  });
  $view.querySelector('#reload').addEventListener('click', () => loadCatalog(true));
  $view.querySelector('#hideTasted').addEventListener('click', (e) => { shopState.hideTasted = !shopState.hideTasted; e.target.classList.toggle('on', shopState.hideTasted); drawCatalog(); });
  $view.querySelector('#catalog').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add-slug]');
    if (!b) return;
    e.preventDefault();
    const c = shopState.items.find((x) => x.slug === b.dataset.addSlug);
    const { coffee } = store.addCoffee(c, resolveOrder(store.recentOrder()?.id || 'new'));
    toast('Added to the latest order');
    location.hash = `#/coffee/${coffee.id}?new=1`;
  });
  if (shopState.items) drawCatalog(); else loadCatalog(false);
}

function checkCard(c) {
  const ex = store.findBySlug(c.slug);
  if (ex) {
    const g = groupScore(ex, people());
    return `<a class="card match" href="#/coffee/${ex.id}">${coffeeImg(c)}<div class="grow"><div style="font-weight:600">${esc(c.name)}</div>
      <div class="small muted">${esc(procLine(c))}</div><div style="margin-top:6px">${verdictTag(g)} <span class="small muted">You already tasted this one.</span></div></div>${scoreBadge(g)}</a>`;
  }
  const { g, per } = predictionsFor(c);
  return `<div class="card pad stack">
    <div class="row">${coffeeImg(c)}<div class="grow"><div style="font-weight:600">${esc(c.name)}</div><div class="small muted">${esc(procLine(c))}</div>
      <div class="chips" style="margin-top:6px">${c.notes.map((n) => `<span class="chip note">${esc(n)}</span>`).join('')}</div></div></div>
    ${g.score == null ? '<div class="small muted">Not enough scores yet to predict.</div>' : `
      <div class="person-preds"><div style="background:var(--accent-soft);border-color:transparent"><b>${fmt(g.score)}</b><span>Crew</span></div>
      ${per.map((x) => `<div><b>${x.score == null ? '–' : fmt(x.score)}</b><span>${esc(x.p.name)}</span></div>`).join('')}</div>
      <div><div class="small muted">Why</div>${reasonsHtml(g.reasons) || '<div class="small">Nothing stands out: looks like an average coffee for you.</div>'}</div>
      <div class="small muted">Expected score based on ${g.n} scored coffees · ${esc(confidence(g.n).label.toLowerCase())}</div>`}
    <button class="btn primary block" data-add>Add to Brew Crew</button>
  </div>`;
}

async function loadCatalog(force) {
  shopState.loading = true; shopState.error = null;
  drawCatalog();
  try { shopState.items = await fetchCatalog(force); }
  catch (e) { shopState.error = e.message || 'Could not load the shop.'; }
  shopState.loading = false;
  drawCatalog();
}

function drawCatalog() {
  const $c = document.getElementById('catalog');
  if (!$c) return;
  if (shopState.loading && !shopState.items) { $c.innerHTML = `<div class="card preview"><div class="spinner"></div><div class="status-line">Loading the Cross Roast shop…</div></div>`; return; }
  if (shopState.error && !shopState.items) { $c.innerHTML = `<div class="error">${esc(shopState.error)}</div>`; return; }
  const ps = people();
  let rows = (shopState.items || []).filter((c) => c.inStock !== false).map((c) => {
    const ex = store.findBySlug(c.slug);
    if (ex) return { c, ex, val: groupScore(ex, ps), tasted: true };
    const p = predict(c, db.coffees, 'group', ps);
    return { c, val: p.score, pred: p, tasted: false };
  });
  if (shopState.hideTasted) rows = rows.filter((r) => !r.tasted);
  rows.sort((a, b) => (b.val ?? -1) - (a.val ?? -1));
  $c.innerHTML = rows.map(({ c, ex, val, pred, tasted }) => `
    <a class="card match" href="${tasted ? `#/coffee/${ex.id}` : esc(c.url)}" ${tasted ? '' : 'target="_blank" rel="noopener"'}>
      ${coffeeImg(c)}
      <div class="grow">
        <div style="font-weight:600" class="ellipsis">${esc(c.name)}</div>
        <div class="small muted ellipsis">${esc(procLine(c))}</div>
        <div class="small ellipsis" style="color:var(--ink-2)">${esc(c.notes.join(' · '))}</div>
        ${tasted ? `<div style="margin-top:4px">${verdictTag(val)}</div>` : reasonsHtml(pred?.reasons?.slice(0, 2))}
        ${tasted ? '' : `<button class="btn sm soft" style="margin-top:8px" data-add-slug="${esc(c.slug)}">+ Add</button>`}
      </div>
      <div class="pred">${tasted ? scoreBadge(val) : `<b style="color:var(--${verdict(val) === 'reorder' ? 'good' : verdict(val) === 'skip' ? 'bad' : 'ink-2'})">${val == null ? '?' : '~' + fmt(val)}</b><span>${val == null ? 'no data' : 'expected'}</span>`}</div>
    </a>`).join('') || '<div class="small muted">No coffees found.</div>';
}

// ---------------------------------------------------------------- orders
function viewOrders() {
  $view.innerHTML = `
    <div class="top"><div><h1>Orders</h1><div class="sub">Every batch you ordered together</div></div>
      <button class="btn sm soft" id="newOrder">+ New</button></div>
    <div class="list">${db.orders.length ? db.orders.map((o) => {
      const cs = store.orderCoffees(o.id);
      const scores = cs.map((c) => groupScore(c, people())).filter((v) => v != null);
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      return `<a class="card order-card" href="#/order/${o.id}">
        <div class="row"><div class="grow"><b>${esc(o.name || 'Order of ' + dateLabel(o.date))}</b><div class="small muted">${cs.length} coffee${cs.length === 1 ? '' : 's'} · ${scores.length} scored</div></div>${scoreBadge(avg)}</div>
        <div class="order-thumbs">${cs.slice(0, 6).map((c) => (c.thumb ? `<img src="${esc(c.thumb)}" alt="" loading="lazy">` : '<div class="ph"></div>')).join('')}</div>
      </a>`;
    }).join('') : '<div class="card empty"><h2>No orders yet</h2><p>Orders are created automatically when you add coffees.</p></div>'}</div>`;
  $view.querySelector('#newOrder').addEventListener('click', () => { const o = store.createOrder(); location.hash = `#/order/${o.id}`; });
}

function viewOrder(id) {
  const o = store.getOrder(id);
  if (!o) { location.hash = '#/orders'; return; }
  const cs = store.orderCoffees(o.id);
  $view.innerHTML = `
    <div class="top"><button class="back" id="back">${ICON.back.replace('<svg', '<svg style="width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2"')} Orders</button></div>
    <h1>${esc(o.name || 'Order of ' + dateLabel(o.date))}</h1>
    <div class="row" style="margin:12px 0 4px;gap:8px">
      <input class="input" type="date" id="date" value="${esc(o.date)}" style="max-width:190px">
      <a class="btn soft" href="#/add">+ Add coffee</a>
    </div>
    <div class="list">${cs.map((c) => { const s = groupScore(c, people()); return `
      <a class="card item" href="#/coffee/${c.id}">${coffeeImg(c)}<div class="grow"><div class="name ellipsis">${esc(c.name)}</div>
      <div class="meta ellipsis">${esc(procLine(c))}</div><div class="people">${personScoresLine(c)}</div></div>${scoreBadge(s)}</a>`; }).join('') || '<div class="small muted">No coffees in this order yet.</div>'}</div>
    <label class="field section"><span>Order note</span><textarea class="textarea" id="note" placeholder="e.g. price paid, who ordered">${esc(o.note || '')}</textarea></label>
    <div class="section"><button class="btn danger block" id="del">Delete order (coffees are kept)</button></div>`;
  $view.querySelector('#back').addEventListener('click', () => (location.hash = '#/orders'));
  $view.querySelector('#date').addEventListener('change', (e) => { if (e.target.value) { store.updateOrder(o.id, { date: e.target.value }); toast('Saved'); viewOrder(id); } });
  $view.querySelector('#note').addEventListener('change', (e) => { store.updateOrder(o.id, { note: e.target.value }); toast('Saved'); });
  $view.querySelector('#del').addEventListener('click', () => { if (confirm('Delete this order? The coffees and scores stay.')) { store.deleteOrder(o.id); location.hash = '#/orders'; } });
}

// ---------------------------------------------------------------- settings
function viewSettings() {
  const hasDemo = db.coffees.some((c) => c.demo);
  $view.innerHTML = `
    <div class="top"><button class="back" id="back">${ICON.back.replace('<svg', '<svg style="width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2"')} Back</button></div>
    <h1>Settings</h1>
    <div class="section"><div class="section-head"><h2>The crew</h2></div>
      <div class="card pad stack" id="crew">
        ${people().map((p) => `<div class="row"><input class="input" data-p="${p.id}" value="${esc(p.name)}"><button class="btn sm danger" data-rm="${p.id}">Remove</button></div>`).join('')}
        <div class="row"><input class="input" id="newName" placeholder="New crew member"><button class="btn sm soft" id="addP">Add</button></div>
      </div></div>
    <div class="section"><div class="section-head"><h2>Try it out</h2></div>
      <div class="card pad stack">
        <p class="small muted" style="margin:0">Demo data fills the app with real Cross Roast coffees and made-up scores, so you can see the taste profile in action. Remove it with one tap; your own coffees stay.</p>
        ${hasDemo ? '<button class="btn block" id="rmDemo">Remove demo data</button>' : '<button class="btn soft block" id="demo">Load demo data</button>'}
      </div></div>
    <div class="section"><div class="section-head"><h2>Data</h2></div>
      <div class="card pad stack">
        <p class="small muted" style="margin:0">Everything is saved on this device (${db.coffees.length} coffees, ${db.orders.length} orders). Syncing between phones comes in version 2.</p>
        <button class="btn danger block" id="wipe">Delete everything</button>
      </div></div>
    <p class="small muted" style="text-align:center;margin-top:28px">Brew Crew · v1.0</p>`;
  $view.querySelector('#back').addEventListener('click', () => (location.hash = '#/'));
  $view.querySelectorAll('[data-p]').forEach((i) => i.addEventListener('change', () => { store.renamePerson(i.dataset.p, i.value); toast('Saved'); }));
  $view.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    const p = people().find((x) => x.id === b.dataset.rm);
    if (confirm(`Remove ${p.name}? Their scores are hidden but kept, in case you add them back.`)) { store.removePerson(p.id); viewSettings(); }
  }));
  $view.querySelector('#addP').addEventListener('click', () => { store.addPerson($view.querySelector('#newName').value); viewSettings(); });
  $view.querySelector('#demo')?.addEventListener('click', async () => {
    const { demoData } = await import('./demo.js');
    const d = demoData(people());
    db.orders.push(...d.orders);
    db.orders.sort((a, b) => b.date.localeCompare(a.date));
    db.coffees.push(...d.coffees.filter((c) => !store.findBySlug(c.slug)));
    store.save();
    toast('Demo data loaded');
    location.hash = '#/taste';
  });
  $view.querySelector('#rmDemo')?.addEventListener('click', () => { store.removeDemo(); toast('Demo data removed'); viewSettings(); });
  $view.querySelector('#wipe').addEventListener('click', () => {
    if (confirm('Delete ALL coffees, scores and orders on this device?') && confirm('Really sure? This cannot be undone.')) { store.wipe(); toast('Everything deleted'); location.hash = '#/'; }
  });
}

// ---------------------------------------------------------------- boot
render();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
