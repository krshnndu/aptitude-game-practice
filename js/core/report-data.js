// Per-game report data (pure): header, skill breakdown with 30-day sparklines, weekly coach-tag
// trend, pace distribution against par, weak puzzle patterns and practice prescriptions.
// Small samples are suppressed: trends need MIN_N and every figure carries its n.

import { median } from './analytics.js';
import { gameSkill, trend, tierFor, MIN_N, STALE_DAYS } from './skill.js';
import { dayKey } from './analytics.js';

const DAY = 24 * 3600 * 1000;
const WEEKS = 8;
export const WEAK_MIN = 5;
export const PACE_BUCKETS = [
  { label: 'under half par', lo: 0, hi: 0.5 },
  { label: 'half par to par', lo: 0.5, hi: 1 },
  { label: 'par to 1.5x par', lo: 1, hi: 1.5 },
  { label: '1.5x to 2x par', lo: 1.5, hi: 2 },
  { label: 'over 2x par', lo: 2, hi: Infinity },
];

const solved = (a) => a.outcome === 'solved';

function startOfWeek(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

// One dimension's daily series over the last `days`: value over a trailing 7-day window.
export function sparkSeries(dim, attempts, tagsOf, { now = Date.now(), days = 30 } = {}) {
  const out = [];
  for (let k = days - 1; k >= 0; k--) {
    const end = now - k * DAY;
    const win = attempts.filter((a) => a.startedAt <= end && a.startedAt > end - 7 * DAY);
    out.push(win.length ? dim.value(win, tagsOf) : null);
  }
  return out;
}

export function tagWeeks(attempts, tagsOf, { now = Date.now(), weeks = WEEKS } = {}) {
  const first = startOfWeek(now) - (weeks - 1) * 7 * DAY;
  const rows = [];
  for (let w = 0; w < weeks; w++) {
    const start = first + w * 7 * DAY;
    const list = attempts.filter((a) => a.startedAt >= start && a.startedAt < start + 7 * DAY);
    const counts = {};
    let tagged = 0;
    for (const a of list) {
      const t = tagsOf(a);
      if (t === undefined) continue;
      tagged++;
      for (const id of t) counts[id] = (counts[id] ?? 0) + 1;
    }
    rows.push({ start, attempts: list.length, tagged, counts });
  }
  const totals = {};
  const weeksSeen = {};
  for (const r of rows) for (const [id, k] of Object.entries(r.counts)) {
    totals[id] = (totals[id] ?? 0) + k;
    weeksSeen[id] = (weeksSeen[id] ?? 0) + 1;
  }
  const tags = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const top = tags.filter((id) => weeksSeen[id] >= 2).slice(0, 2);
  // Resolved: 3+ before the last two weeks, none in the last two weeks (with 5+ tagged attempts there).
  const recent = rows.slice(-2);
  const recentTagged = recent.reduce((s, r) => s + r.tagged, 0);
  const resolved = tags.filter((id) => {
    const before = rows.slice(0, -2).reduce((s, r) => s + (r.counts[id] ?? 0), 0);
    const after = recent.reduce((s, r) => s + (r.counts[id] ?? 0), 0);
    return before >= 3 && after === 0 && recentTagged >= MIN_N;
  });
  return { rows, tags, totals, top, resolved };
}

export function paceBuckets(attempts, { time, par, correct = solved }) {
  const rows = PACE_BUCKETS.map((b) => ({ ...b, n: 0, ok: 0 }));
  let used = 0;
  for (const a of attempts) {
    const p = par(a);
    const t = time(a);
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(t)) continue;
    const r = t / p;
    const row = rows.find((b) => r >= b.lo && r < b.hi);
    row.n++;
    if (correct(a)) row.ok++;
    used++;
  }
  return {
    n: used,
    rows: rows.map((r) => ({ ...r, accuracy: r.n >= MIN_N ? r.ok / r.n : null })),
    medianRatio: median(attempts.map((a) => time(a) / par(a)).filter(Number.isFinite)),
  };
}

// Feature labels with the worst accuracy (at least WEAK_MIN attempts each).
export function weakPatterns(attempts, featuresOf, { correct = solved, top = 5 } = {}) {
  const agg = new Map();
  for (const a of attempts) {
    const fs = featuresOf(a);
    if (!fs) continue;
    for (const f of fs) {
      const r = agg.get(f) ?? { label: f, n: 0, ok: 0, eff: 0 };
      r.n++;
      if (correct(a)) r.ok++;
      r.eff += a.metrics?.efficiency ?? 0;
      agg.set(f, r);
    }
  }
  const rows = [...agg.values()].map((r) => ({ ...r, accuracy: r.ok / r.n, efficiency: r.eff / r.n }));
  return {
    shown: rows.filter((r) => r.n >= WEAK_MIN).sort((a, b) => a.accuracy - b.accuracy || a.efficiency - b.efficiency).slice(0, top),
    hidden: rows.filter((r) => r.n < WEAK_MIN).length,
  };
}

const pctTxt = (x) => `${Math.round(x * 100)}%`;
const fmtVal = (dim, v) => (v === null || v === undefined ? 'none' : dim.fmt === 'pct' ? pctTxt(v) : dim.fmt === 'sec' ? `${(v / 1000).toFixed(1)} s` : (Math.round(v * 10) / 10).toString());
export { fmtVal };

// Three practice prescriptions, each tied to a metric and a deep link.
export function prescriptions(game, { last30, tagsOf, tagLabel, weeks, weak, dims }) {
  const out = [];
  const tagged = last30.filter((a) => tagsOf(a) !== undefined);
  if (tagged.length >= MIN_N) {
    const count = {};
    for (const a of tagged) for (const t of tagsOf(a)) count[t] = (count[t] ?? 0) + 1;
    const ranked = Object.entries(count).sort((a, b) => b[1] - a[1]);
    for (const [tag, k] of ranked.slice(0, 2)) {
      if (k < 2) continue;
      out.push({ metric: `${tagLabel(tag)}: ${k} of your last ${tagged.length} attempts`, text: `Retry 10 puzzles tagged "${tagLabel(tag)}" in your review queue, solving before you look at the walkthrough.`, href: `#/review/${game}?filter=${encodeURIComponent(tag)}` });
    }
  }
  for (const w of weak.shown.slice(0, 2)) {
    if (out.length >= 3) break;
    if (w.accuracy >= 0.85) continue;
    out.push({ metric: `${w.label}: ${pctTxt(w.accuracy)} accuracy (n=${w.n})`, text: `Practise puzzles with "${w.label}" and replay the misses from your notebook.`, href: `#/review/${game}` });
  }
  for (const d of dims) {
    if (out.length >= 3) break;
    if (d.value === null || !Number.isFinite(d.target)) continue;
    const off = d.better === 'high' ? d.value < d.target : d.value > d.target;
    if (!off || out.some((o) => o.metric.startsWith(d.label))) continue;
    out.push({ metric: `${d.label}: ${fmtVal(d, d.value)} against a target of ${fmtVal(d, d.target)}`, text: 'Read the strategy cheat sheet below, then play one practice set focusing on this number only.', href: `#/${game}` });
  }
  if (out.length < 3 && weeks.top.length) {
    const tag = weeks.top.find((t) => !out.some((o) => o.href.includes(encodeURIComponent(t))));
    if (tag) out.push({ metric: `${tagLabel(tag)}: recurring for ${WEEKS} weeks`, text: 'Write a one-line note on your last notebook entry with this tag: what will you check next time?', href: `#/review/${game}?filter=${encodeURIComponent(tag)}` });
  }
  if (out.length < 3) out.push({ metric: 'Review queue', text: 'Clear today\'s mixed review queue: spaced retries fix more than new puzzles.', href: '#/review/today' });
  return out.slice(0, 3);
}

// adapter: { DIMS, timeOf, parMs, tagLabel }; correct: fn(a); featuresOf: fn(a) -> labels | null.
export function buildReport({ game, attempts, tagsOf = () => undefined, adapter, correct = solved, featuresOf = () => null, now = Date.now() }) {
  const list = attempts.filter((a) => !a.sample && a.startedAt <= now).sort((a, b) => a.startedAt - b.startedAt);
  const time = adapter.timeOf;
  const opts = { now, time, correct };
  const skill = gameSkill(list, opts);
  const last30 = list.slice(-30);
  const last = list.length ? list[list.length - 1].startedAt : null;
  const header = {
    gss: skill.score,
    tier: tierFor(skill.score, [skill.score]),
    accuracy: skill.accuracy,
    efficiency: skill.efficiency,
    consistency: skill.consistency,
    n: skill.n,
    total: list.length,
    days: new Set(list.map((a) => dayKey(a.startedAt))).size,
    trend7: trend(list, 7, opts),
    trend30: trend(list, 30, opts),
    stale: last !== null && now - last >= STALE_DAYS * DAY,
    lastAt: last,
  };
  const dims = adapter.DIMS.map((d) => ({
    key: d.key, label: d.label, fmt: d.fmt, better: d.better, target: d.target,
    value: last30.length ? d.value(last30, tagsOf) : null,
    n: last30.length,
    spark: sparkSeries(d, list, tagsOf, { now }),
  }));
  const weeks = tagWeeks(list, tagsOf, { now });
  const pace = paceBuckets(last30.length >= MIN_N ? list.slice(-100) : [], { time, par: adapter.parMs, correct });
  const weak = weakPatterns(list.slice(-200), featuresOf, { correct });
  return {
    game,
    at: now,
    header,
    dims,
    weeks,
    pace,
    weak,
    prescriptions: prescriptions(game, { last30, tagsOf, tagLabel: adapter.tagLabel, weeks, weak, dims }),
    tagCoverage: list.filter((a) => tagsOf(a) !== undefined).length,
  };
}
