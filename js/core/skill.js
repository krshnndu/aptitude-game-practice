// Game Skill Score and overall badge (pure). Spec B:
//   GSS (0 to 100) = 100 x (0.5 x accuracy + 0.3 x median efficiency + 0.2 x consistency), last 30 attempts,
//   consistency = 1 - coefficient of variation of solve time, clamped to 0..1.
//   Overall = mean of the six GSS, every game weighted equally (untouched games count as 0).
// Trends need at least MIN_N attempts on both ends; below that the delta is null and n is shown.

import { mean, median, stddev } from './analytics.js';

export const WINDOW = 30;
export const MIN_N = 5;
export const STALE_DAYS = 14;
export const DELTA_DAYS = 14;
export const WEIGHTS = { accuracy: 0.5, efficiency: 0.3, consistency: 0.2 };
export const FORMULA = 'Game Skill Score = 100 x (0.5 x accuracy + 0.3 x median efficiency + 0.2 x consistency), over your last 30 attempts. Consistency = 1 minus the coefficient of variation of your solve times. Overall = average of all six games, each weighted equally.';
export const TIERS = [
  { name: 'Novice', min: 0 },
  { name: 'Apprentice', min: 30 },
  { name: 'Practitioner', min: 50 },
  { name: 'Adept', min: 70 },
  { name: 'Master', min: 85 },
];
const DAY = 24 * 3600 * 1000;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export const timeOf = (a) => a.metrics?.totalMs ?? 0;
export const solvedOf = (a) => a.outcome === 'solved';

// Consistency from a list of times: 1 - CV, clamped. Needs 2+ positive times.
export function consistency(times) {
  const v = times.filter((t) => Number.isFinite(t) && t > 0);
  if (v.length < 2) return 0;
  const m = mean(v);
  return m > 0 ? clamp01(1 - stddev(v) / m) : 0;
}

// attempts: one game's attempts in any order. Returns the components over the last WINDOW.
export function gameSkill(attempts, { now = Date.now(), time = timeOf, correct = solvedOf } = {}) {
  const list = attempts.filter((a) => a.startedAt <= now).sort((a, b) => a.startedAt - b.startedAt).slice(-WINDOW);
  const n = list.length;
  if (!n) return { n: 0, score: 0, accuracy: null, efficiency: null, consistency: null, lowSample: true };
  const accuracy = list.filter(correct).length / n;
  const efficiency = median(list.map((a) => a.metrics?.efficiency ?? 0)) ?? 0;
  const cons = consistency(list.filter(correct).map(time));
  const score = 100 * (WEIGHTS.accuracy * accuracy + WEIGHTS.efficiency * efficiency + WEIGHTS.consistency * cons);
  return { n, score: Math.round(score * 10) / 10, accuracy, efficiency, consistency: cons, lowSample: n < MIN_N };
}

export function tierFor(overall, scores = []) {
  let t = TIERS[0];
  for (const tier of TIERS) if (overall >= tier.min) t = tier;
  // Master also needs every game at 70 or more: breadth is the point.
  if (t.name === 'Master' && !(scores.length && scores.every((s) => s >= 70))) t = TIERS[3];
  return t.name;
}

export function nextTier(overall, scores = []) {
  const name = tierFor(overall, scores);
  const i = TIERS.findIndex((t) => t.name === name);
  if (i === TIERS.length - 1) return null;
  const next = TIERS[i + 1];
  return { name: next.name, at: next.min, needsAll70: next.name === 'Master' };
}

// Full picture: per-game cards plus the overall badge, delta vs 14 days ago, stale markers.
// games: list of game ids; attemptsByGame: { id: attempts[] }; time: { id: fn } optional.
export function skillSummary(games, attemptsByGame, { now = Date.now(), time = {}, correct = {} } = {}) {
  const past = now - DELTA_DAYS * DAY;
  const cards = games.map((g) => {
    const list = attemptsByGame[g] ?? [];
    const o = { time: time[g] ?? timeOf, correct: correct[g] ?? solvedOf };
    const cur = gameSkill(list, { now, ...o });
    const old = gameSkill(list, { now: past, ...o });
    const last = list.reduce((m, a) => Math.max(m, a.startedAt), 0);
    const delta = cur.n >= MIN_N && old.n >= MIN_N ? Math.round((cur.score - old.score) * 10) / 10 : null;
    return {
      game: g,
      ...cur,
      tier: tierFor(cur.score, [cur.score]),
      delta,
      pastN: old.n,
      lastAt: last || null,
      stale: !!last && now - last >= STALE_DAYS * DAY,
      days: new Set(list.map((a) => new Date(a.startedAt).toDateString())).size,
    };
  });
  const scores = cards.map((c) => c.score);
  const overall = scores.length ? Math.round(mean(scores) * 10) / 10 : 0;
  const pastScores = cards.map((c) => gameSkill(attemptsByGame[c.game] ?? [], { now: past, time: time[c.game] ?? timeOf, correct: correct[c.game] ?? solvedOf }).score);
  const pastOverall = pastScores.length ? mean(pastScores) : 0;
  const total = cards.reduce((s, c) => s + c.n, 0);
  const pastTotal = cards.reduce((s, c) => s + c.pastN, 0);
  return {
    cards,
    overall,
    tier: tierFor(overall, scores),
    next: nextTier(overall, scores),
    delta: total >= MIN_N && pastTotal >= MIN_N ? Math.round((overall - pastOverall) * 10) / 10 : null,
    n: total,
  };
}

// Trend of one game's GSS: now vs `days` ago, null under MIN_N on either end.
export function trend(attempts, days, { now = Date.now(), time = timeOf, correct = solvedOf } = {}) {
  const cur = gameSkill(attempts, { now, time, correct });
  const old = gameSkill(attempts, { now: now - days * DAY, time, correct });
  if (cur.n < MIN_N || old.n < MIN_N) return { delta: null, n: cur.n, pastN: old.n };
  return { delta: Math.round((cur.score - old.score) * 10) / 10, n: cur.n, pastN: old.n };
}
