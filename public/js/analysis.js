// Taste analysis: turns scores into preferences and predictions. Pure functions, no AI.
import { familiesOf, estimateAttributes, ATTRIBUTES, bucket, altitudeBand, familyLabel, FAMILIES } from './flavor.js';

export const REORDER_AT = 7.5;
export const SKIP_AT = 5.5;
const SHRINK = 2; // pulls averages of rarely-seen features towards "no opinion"

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

export function personScore(coffee, personId) {
  const s = coffee.scores?.[personId];
  return s && typeof s.score === 'number' ? s.score : null;
}

export function groupScore(coffee, people) {
  const vals = people.map((p) => personScore(coffee, p.id)).filter((v) => v != null);
  return vals.length ? mean(vals) : null;
}

// subject = 'group' or a person id
export function scoreFor(coffee, subject, people) {
  return subject === 'group' ? groupScore(coffee, people) : personScore(coffee, subject);
}

export function verdict(score) {
  if (score == null) return null;
  if (score >= REORDER_AT) return 'reorder';
  if (score <= SKIP_AT) return 'skip';
  return 'ok';
}

// All the "features" of a coffee that preferences are computed for.
export function features(coffee) {
  const attrs = estimateAttributes(coffee);
  const out = [];
  if (coffee.process) out.push({ dim: 'process', value: coffee.process });
  const ferm = (coffee.modifiers || []).filter((m) => m !== 'Decaf');
  out.push({ dim: 'fermentation', value: ferm.length ? ferm[0] : 'Classic' });
  for (const c of coffee.countries || []) out.push({ dim: 'country', value: c });
  for (const f of familiesOf(coffee)) out.push({ dim: 'family', value: f });
  for (const n of coffee.notes || []) out.push({ dim: 'note', value: n.toLowerCase() });
  for (const a of ATTRIBUTES) out.push({ dim: a.key, value: bucket(attrs[a.key]) });
  const band = altitudeBand(coffee.altitude);
  if (band) out.push({ dim: 'altitude', value: band });
  out.push({ dim: 'type', value: coffee.type || 'Single origin' });
  return out;
}

export function scoredCoffees(coffees, subject, people) {
  return coffees
    .map((c) => ({ coffee: c, score: scoreFor(c, subject, people) }))
    .filter((x) => x.score != null);
}

// Preference table: for every dimension → list of { value, n, avg, delta, weight }
export function preferences(coffees, subject, people) {
  const rated = scoredCoffees(coffees, subject, people);
  const overall = mean(rated.map((r) => r.score));
  const table = {};
  for (const { coffee, score } of rated) {
    const seen = new Set();
    for (const f of features(coffee)) {
      const id = `${f.dim}|${f.value}`;
      if (seen.has(id)) continue;
      seen.add(id);
      ((table[f.dim] ||= {})[f.value] ||= []).push(score);
    }
  }
  const dims = {};
  for (const [dim, values] of Object.entries(table)) {
    dims[dim] = Object.entries(values)
      .map(([value, scores]) => {
        const n = scores.length;
        const avg = mean(scores);
        const delta = avg - overall;
        return { value, n, avg, delta, shrunk: (delta * n) / (n + SHRINK) };
      })
      .sort((a, b) => b.shrunk - a.shrunk);
  }
  return { n: rated.length, overall, dims };
}

// How much the estimated attributes go together with higher scores (Pearson r).
export function attributeTrends(coffees, subject, people) {
  const rated = scoredCoffees(coffees, subject, people);
  return ATTRIBUTES.map((a) => {
    const xs = rated.map((r) => estimateAttributes(r.coffee)[a.key]);
    const ys = rated.map((r) => r.score);
    const r = pearson(xs, ys);
    // weighted "ideal" value: average attribute of coffees, weighted by how much they were liked
    const base = mean(ys) ?? 0;
    let wsum = 0, vsum = 0;
    rated.forEach((x, i) => {
      const w = Math.max(0.05, ys[i] - base + 1.5);
      wsum += w;
      vsum += w * xs[i];
    });
    return { ...a, r, ideal: wsum ? vsum / wsum : null, n: rated.length };
  });
}

export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (!sxx || !syy) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// Radar values 0–10 per flavor family. 5 = neutral / unknown.
export function radar(prefs) {
  const fam = Object.fromEntries((prefs.dims.family || []).map((x) => [x.value, x]));
  return FAMILIES.map((f) => {
    const x = fam[f.key];
    const v = x ? Math.max(0, Math.min(10, 5 + 2.2 * x.shrunk)) : 5;
    return { key: f.key, label: f.short, value: v, n: x?.n || 0 };
  });
}

export function confidence(n) {
  if (n < 5) return { level: 0, label: 'Too early', text: 'Score at least 5 coffees before reading much into this.' };
  if (n < 12) return { level: 1, label: 'First hints', text: 'Based on few coffees: treat these as first hints.' };
  if (n < 25) return { level: 2, label: 'Taking shape', text: 'Patterns are getting clearer, but can still shift.' };
  return { level: 3, label: 'Solid', text: 'Enough coffees for a reliable picture.' };
}

const WEIGHTS = { process: 0.3, fermentation: 0.15, country: 0.15, family: 0.35, note: 0.1, acidity: 0.2, sweetness: 0.1, body: 0.15, bitterness: 0.15, altitude: 0.05, type: 0.1 };

// Predict a score for a (new) coffee, with explanations.
export function predict(coffee, coffees, subject, people) {
  const others = coffees.filter((c) => c.slug !== coffee.slug);
  const prefs = preferences(others, subject, people);
  if (prefs.n < 3) return { score: null, n: prefs.n, reasons: [] };
  const lookup = {};
  for (const [dim, rows] of Object.entries(prefs.dims)) for (const r of rows) lookup[`${dim}|${r.value}`] = r;
  const byDim = {};
  for (const f of features(coffee)) {
    const r = lookup[`${f.dim}|${f.value}`];
    if (!r) continue;
    (byDim[f.dim] ||= []).push({ ...f, ...r });
  }
  let adj = 0;
  const reasons = [];
  for (const [dim, rows] of Object.entries(byDim)) {
    const d = mean(rows.map((r) => r.shrunk));
    adj += (WEIGHTS[dim] || 0.1) * d * 1.6;
    for (const r of rows) reasons.push({ dim, value: r.value, n: r.n, avg: r.avg, delta: r.shrunk });
  }
  const score = Math.max(1, Math.min(10, prefs.overall + adj));
  reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { score, n: prefs.n, overall: prefs.overall, reasons: reasons.filter((r) => Math.abs(r.delta) >= 0.15 && r.dim !== 'note').slice(0, 5) };
}

export function describeReason(r) {
  const sign = r.delta > 0 ? 'liked' : 'less liked';
  switch (r.dim) {
    case 'process': return `${r.value} process (${sign})`;
    case 'fermentation': return r.value === 'Classic' ? `Classic fermentation (${sign})` : `${r.value} (${sign})`;
    case 'country': return `From ${r.value} (${sign})`;
    case 'family': return `${familyLabel(r.value)} notes (${sign})`;
    case 'type': return `${r.value} (${sign})`;
    case 'altitude': return `Grown at ${r.value} (${sign})`;
    default: {
      const a = ATTRIBUTES.find((x) => x.key === r.dim);
      if (!a) return `${r.value} ${r.dim} (${sign})`;
      const word = r.value === 'low' ? a.low : r.value === 'high' ? a.high : 'medium';
      return `${word.charAt(0).toUpperCase() + word.slice(1)} ${a.label.toLowerCase()} (${sign})`;
    }
  }
}

// Plain-language summary built from templates.
export function summary(coffees, subject, people) {
  const prefs = preferences(coffees, subject, people);
  if (prefs.n < 3) return [];
  const lines = [];
  const top = (dim, min = 2) => (prefs.dims[dim] || []).filter((x) => x.n >= min);
  const proc = top('process');
  if (proc.length >= 2) {
    const best = proc[0], worst = proc[proc.length - 1];
    if (best.delta - worst.delta >= 0.4)
      lines.push(`<b>${esc(best.value)}</b> coffees score best (${round1(best.avg)} on average), <b>${esc(worst.value)}</b> the lowest (${round1(worst.avg)}).`);
    else lines.push(`No strong preference between processes yet.`);
  }
  const fam = top('family');
  const likedFam = fam.filter((x) => x.shrunk > 0.2).slice(0, 3);
  const dislikedFam = fam.filter((x) => x.shrunk < -0.2).slice(-2).reverse();
  if (likedFam.length) lines.push(`Favourite flavors: <b>${likedFam.map((x) => familyLabel(x.value).toLowerCase()).join('</b>, <b>')}</b>.`);
  if (dislikedFam.length) lines.push(`Less of a match: <b>${dislikedFam.map((x) => familyLabel(x.value).toLowerCase()).join('</b>, <b>')}</b>.`);
  for (const t of attributeTrends(coffees, subject, people)) {
    if (t.r == null || Math.abs(t.r) < 0.3) continue;
    lines.push(t.r > 0 ? `The more <b>${t.high}</b> (${t.label.toLowerCase()}), the higher the score.` : `Prefers <b>${t.low}</b> over ${t.high} coffees (${t.label.toLowerCase()}).`);
  }
  const ctry = top('country');
  if (ctry.length && ctry[0].shrunk > 0.25) lines.push(`Best country so far: <b>${esc(ctry[0].value)}</b> (${round1(ctry[0].avg)} avg over ${ctry[0].n}).`);
  return lines;
}

// Crew comparisons: average, strictness, taste twins.
export function crewStats(coffees, people) {
  const per = people.map((p) => {
    const s = coffees.map((c) => personScore(c, p.id)).filter((v) => v != null);
    return { person: p, n: s.length, avg: mean(s) };
  });
  const pairs = [];
  for (let i = 0; i < people.length; i++)
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i], b = people[j];
      const both = coffees.filter((c) => personScore(c, a.id) != null && personScore(c, b.id) != null);
      const r = pearson(both.map((c) => personScore(c, a.id)), both.map((c) => personScore(c, b.id)));
      const diff = both.length ? mean(both.map((c) => Math.abs(personScore(c, a.id) - personScore(c, b.id)))) : null;
      pairs.push({ a, b, n: both.length, r, diff });
    }
  pairs.sort((x, y) => (y.r ?? -2) - (x.r ?? -2));
  return { per, pairs };
}
