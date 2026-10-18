// Report snapshots (pure): a summary object of a report (never raw attempts), the weekly auto rule,
// and a diff between two snapshots.

import { CAPS } from './srs.js';

const WEEK = 7 * 24 * 3600 * 1000;

export function makeSnapshot(report, { kind = 'manual', now = Date.now(), id = null } = {}) {
  const h = report.header;
  const tags = {};
  for (const r of report.weeks.rows.slice(-4)) for (const [t, k] of Object.entries(r.counts)) tags[t] = (tags[t] ?? 0) + k;
  const topTags = Object.fromEntries(Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 5));
  return {
    id: id ?? `s${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    game: report.game,
    at: now,
    kind: kind === 'weekly' ? 'weekly' : 'manual',
    gss: h.gss,
    tier: h.tier,
    n: h.n,
    total: h.total,
    days: h.days,
    accuracy: h.accuracy,
    efficiency: h.efficiency,
    consistency: h.consistency,
    dims: Object.fromEntries(report.dims.map((d) => [d.key, { label: d.label, value: d.value, fmt: d.fmt, better: d.better }])),
    tags: topTags,
    weak: report.weak.shown.slice(0, 3).map((w) => ({ label: w.label, accuracy: w.accuracy, n: w.n })),
  };
}

// A weekly snapshot is due when there is play to summarise and the last weekly one is 7+ days old.
export function weeklyDue(list, report, now = Date.now()) {
  if (!report.header.total) return false;
  const lastWeekly = list.filter((s) => s.kind === 'weekly').reduce((m, s) => Math.max(m, s.at), 0);
  return now - lastWeekly >= WEEK;
}

export function capSnapshots(list) {
  return list.slice().sort((a, b) => a.at - b.at).slice(-CAPS.snapshotsPerGame);
}

// Rows comparing two snapshots (a older, b newer): { label, a, b, delta, fmt, better, improved }.
export function diffSnapshots(a, b) {
  const rows = [];
  const push = (label, x, y, fmt, better = 'high') => {
    const delta = Number.isFinite(x) && Number.isFinite(y) ? y - x : null;
    rows.push({ label, a: x ?? null, b: y ?? null, delta, fmt, better, improved: delta === null || delta === 0 ? null : better === 'high' ? delta > 0 : delta < 0 });
  };
  push('Game Skill Score', a.gss, b.gss, 'num');
  push('Accuracy', a.accuracy, b.accuracy, 'pct');
  push('Median efficiency', a.efficiency, b.efficiency, 'pct');
  push('Consistency', a.consistency, b.consistency, 'pct');
  push('Distinct days', a.days, b.days, 'int');
  const keys = [...new Set([...Object.keys(a.dims ?? {}), ...Object.keys(b.dims ?? {})])];
  for (const k of keys) {
    const da = a.dims?.[k];
    const db = b.dims?.[k];
    const d = db ?? da;
    if (['accuracy', 'efficiency'].includes(k)) continue;
    push(d.label, da?.value, db?.value, d.fmt, d.better);
  }
  const tags = [...new Set([...Object.keys(a.tags ?? {}), ...Object.keys(b.tags ?? {})])];
  for (const t of tags) push(`Tag: ${t} (last 4 weeks)`, a.tags?.[t] ?? 0, b.tags?.[t] ?? 0, 'int', 'low');
  return { rows, tierChange: a.tier === b.tier ? null : { from: a.tier, to: b.tier } };
}
