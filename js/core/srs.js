// Spaced re-queue, SM-2 lite (pure). Fixed interval ladder 1, 3, 7, 14, 30 days:
//   correct and efficient -> next interval; correct but inefficient -> same interval; fail -> back to 1.
// Ease is tracked for display and future tuning; it does not stretch the fixed ladder.

export const INTERVALS = [1, 3, 7, 14, 30];
export const DAY_MS = 24 * 3600 * 1000;
export const EFFICIENT = 0.9; // efficiency at or above this counts as efficient
export const NOTEBOOK_EFF = 0.7; // auto-add to the notebook below this (or on any fail)
export const DAILY_CAP = 20;
export const CAPS = { total: 600, perGame: 100, snapshotsPerGame: 26, note: 200, events: 400 };

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Result of one review encounter from outcome and efficiency.
export function grade({ solved, efficiency }) {
  if (!solved) return 'fail';
  return efficiency >= EFFICIENT ? 'pass' : 'inefficient';
}

export function newSchedule(now) {
  return { interval: INTERVALS[0], ease: 2.5, dueAt: now + INTERVALS[0] * DAY_MS, history: [] };
}

// Returns the updated schedule fields (does not mutate the item).
export function schedule(item, result, now, extra = {}) {
  const level = Math.max(0, INTERVALS.indexOf(item.interval));
  let next = level;
  let ease = item.ease ?? 2.5;
  if (result === 'pass') {
    next = Math.min(INTERVALS.length - 1, level + 1);
    ease += 0.1;
  } else if (result === 'inefficient') {
    ease -= 0.05;
  } else {
    next = 0;
    ease -= 0.2;
  }
  const interval = INTERVALS[next];
  const history = [...(item.history ?? []), { t: now, result, interval: item.interval, ...extra }].slice(-20);
  return { interval, ease: Math.round(clamp(ease, 1.3, 3) * 100) / 100, dueAt: now + interval * DAY_MS, history };
}

// Mastered: the last 3 encounters were correct and each was taken at an interval of 14 days or more.
export function isMastered(item) {
  const h = item.history ?? [];
  if (h.length < 3) return false;
  return h.slice(-3).every((e) => e.result !== 'fail' && e.interval >= 14);
}

export function endOfDay(now) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function dueItems(items, now, game = null) {
  const cut = endOfDay(now);
  return items.filter((it) => (game === null || it.game === game) && !it.retired && it.dueAt <= cut).sort((a, b) => a.dueAt - b.dueAt);
}

export function dueCounts(items, now) {
  const out = {};
  for (const it of dueItems(items, now)) out[it.game] = (out[it.game] ?? 0) + 1;
  return out;
}

// Daily mixed queue: oldest due first within each game, games interleaved round robin (the game with
// the oldest due item goes first), capped at DAILY_CAP.
export function mixedQueue(items, now, cap = DAILY_CAP) {
  const byGame = new Map();
  for (const it of dueItems(items, now)) {
    if (!byGame.has(it.game)) byGame.set(it.game, []);
    byGame.get(it.game).push(it);
  }
  const lanes = [...byGame.values()].sort((a, b) => a[0].dueAt - b[0].dueAt);
  const out = [];
  for (let k = 0; out.length < cap && lanes.some((l) => l.length > k); k++) {
    for (const lane of lanes) if (lane[k] && out.length < cap) out.push(lane[k]);
  }
  return out;
}

// Enforce caps: per game first, then total. Mastered items go first, then the oldest.
export function enforceItemCaps(items, caps = CAPS) {
  const order = (a, b) => (isMastered(b) - isMastered(a)) || a.createdAt - b.createdAt;
  let out = items.slice();
  const games = [...new Set(out.map((i) => i.game))];
  for (const g of games) {
    const mine = out.filter((i) => i.game === g);
    if (mine.length <= caps.perGame) continue;
    const drop = new Set(mine.sort(order).slice(0, mine.length - caps.perGame).map((i) => i.id));
    out = out.filter((i) => !drop.has(i.id));
  }
  if (out.length > caps.total) {
    const drop = new Set(out.slice().sort(order).slice(0, out.length - caps.total).map((i) => i.id));
    out = out.filter((i) => !drop.has(i.id));
  }
  return out;
}
