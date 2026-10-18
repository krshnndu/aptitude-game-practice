// Analytics math and data shaping (pure, no DOM): summary statistics, moving average, trend line,
// jump detection, per-run series, per-set efficiency, personal bests, streaks, the plain-English
// summary, and a seeded sample data set for the empty state.

import { createRng } from './rng.js';

const finite = (x) => typeof x === 'number' && Number.isFinite(x);

export function mean(xs) {
  const v = xs.filter(finite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function median(xs) {
  const v = xs.filter(finite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Population standard deviation (the spread of the values themselves).
export function stddev(xs) {
  const v = xs.filter(finite);
  if (!v.length) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
}

// Trailing moving average. Point i averages the finite values among the last `window` points
// (fewer at the start). Points with no finite value in their window are null.
export function movingAverage(values, window = 5) {
  const w = Math.max(1, Math.floor(window) || 1);
  return values.map((_, i) => mean(values.slice(Math.max(0, i - w + 1), i + 1)));
}

// Least squares line y = intercept + slope * x over the indices of the finite values.
export function linearTrend(values) {
  const pts = values.map((y, x) => [x, y]).filter(([, y]) => finite(y));
  if (!pts.length) return { slope: 0, intercept: 0, at: () => null };
  if (pts.length === 1) return { slope: 0, intercept: pts[0][1], at: () => pts[0][1] };
  const mx = mean(pts.map((p) => p[0]));
  const my = mean(pts.map((p) => p[1]));
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const slope = sxx ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  return { slope, intercept, at: (x) => intercept + slope * x };
}

// A value is a jump when it beats the previous best, or the rolling mean of the previous `window`
// values, by more than k standard deviations of all previous values. Needs `minHistory` earlier
// values. Returns one entry per value: { index, jump, reasons, best, rollingMean, sd }.
export function detectJumps(values, { window = 5, minHistory = 3, k = 1 } = {}) {
  const out = [];
  const prev = [];
  values.forEach((v, index) => {
    const row = { index, value: v, jump: false, reasons: [], best: null, rollingMean: null, sd: null };
    if (finite(v) && prev.length >= minHistory) {
      const best = Math.max(...prev);
      const rollingMean = mean(prev.slice(-window));
      const sd = stddev(prev);
      row.best = best;
      row.rollingMean = rollingMean;
      row.sd = sd;
      if (v - best > k * sd) row.reasons.push('best');
      if (v - rollingMean > k * sd) row.reasons.push('mean');
      row.jump = row.reasons.length > 0;
    }
    if (finite(v)) prev.push(v);
    out.push(row);
  });
  return out;
}

// Mean of the first k against the last k values (k shrinks to half the series when short).
export function compareEnds(values, k = 5) {
  const v = values.filter(finite);
  if (v.length < 2) return null;
  const n = Math.min(k, Math.floor(v.length / 2));
  const first = mean(v.slice(0, n));
  const last = mean(v.slice(-n));
  return { n, first, last, delta: last - first, pct: first ? (last - first) / Math.abs(first) : null };
}

// Local calendar day key (YYYY-MM-DD).
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prevDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1, 12).getTime());
}

// Consecutive days with activity, ending today (or yesterday, so the streak survives until you
// play today). Returns { current, longest, days }.
export function dayStreak(timestamps, now = Date.now()) {
  const days = new Set(timestamps.filter(finite).map(dayKey));
  if (!days.size) return { current: 0, longest: 0, days: 0 };
  const sorted = [...days].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = prevDayKey(sorted[i]) === sorted[i - 1] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  let cur = 0;
  let key = dayKey(now);
  if (!days.has(key)) key = prevDayKey(key);
  while (days.has(key)) {
    cur++;
    key = prevDayKey(key);
  }
  return { current: cur, longest, days: days.size };
}

// One point per finished timed run, oldest first.
export function runSeries(runs) {
  return runs
    .slice()
    .sort((a, b) => a.endedAt - b.endedAt)
    .map((r, i) => {
      const rows = r.puzzles || [];
      const solved = rows.filter((p) => p.outcome === 'solved');
      const gross = solved.reduce((s, p) => s + (p.grossMoves ?? p.moves), 0);
      const opt = solved.reduce((s, p) => s + p.optimal, 0);
      return {
        n: i + 1,
        id: r.id,
        set: r.set,
        at: r.endedAt,
        score: r.score,
        attempted: rows.length,
        solved: solved.length,
        skipRate: rows.length ? rows.filter((p) => p.outcome === 'skipped').length / rows.length : null,
        wastedRate: gross ? Math.max(0, gross - opt) / gross : null,
        avgFirstMoveMs: mean(rows.map((p) => p.firstMoveMs)),
        avgEfficiency: rows.length ? r.score / rows.length : null,
      };
    });
}

// Average efficiency per set over every recorded attempt (practice and timed).
export function efficiencyBySet(attempts, sets = [1, 2, 3, 4, 5]) {
  return sets.map((set) => {
    const list = attempts.filter((a) => a.set === set);
    const solved = list.filter((a) => a.outcome === 'solved');
    return {
      set,
      attempts: list.length,
      solved: solved.length,
      efficiency: list.length ? mean(list.map((a) => a.metrics.efficiency)) : null,
      solvedEfficiency: solved.length ? mean(solved.map((a) => a.metrics.efficiency)) : null,
    };
  });
}

export function personalBests(runs, attempts, sets = [1, 2, 3, 4, 5]) {
  const series = runSeries(runs);
  return sets.map((set) => {
    const rs = series.filter((r) => r.set === set);
    const as = attempts.filter((a) => a.set === set && a.outcome === 'solved');
    const perfect = as.filter((a) => a.metrics.efficiency >= 1).map((a) => a.metrics.totalMs);
    const best = rs.reduce((b, r) => (!b || r.score > b.score ? r : b), null);
    const firsts = rs.map((r) => r.avgFirstMoveMs).filter(finite);
    return {
      set,
      runs: rs.length,
      bestScore: best ? best.score : null,
      bestScoreAt: best ? best.at : null,
      mostSolved: rs.length ? Math.max(...rs.map((r) => r.solved)) : null,
      fastestPerfectMs: perfect.length ? Math.min(...perfect) : null,
      quickestAvgFirstMoveMs: firsts.length ? Math.min(...firsts) : null,
    };
  });
}

// Per-set progress: activity plus first 3 against last 3 runs.
export function setProgress(runs, attempts, sets = [1, 2, 3, 4, 5]) {
  const series = runSeries(runs);
  return sets.map((set) => {
    const rs = series.filter((r) => r.set === set).map((r) => r.score);
    const practiced = new Set(attempts.filter((a) => a.set === set && a.mode === 'practice').map((a) => a.puzzleId));
    const ends = compareEnds(rs, 3);
    return {
      set,
      runs: rs.length,
      attempts: attempts.filter((a) => a.set === set).length,
      practicePuzzles: practiced.size,
      lastScore: rs.length ? rs[rs.length - 1] : null,
      change: ends,
    };
  });
}

function signedPct(x) {
  const v = Math.round(x * 100);
  return `${v > 0 ? '+' : ''}${v}%`;
}

function signed(x, digits = 2) {
  const v = x.toFixed(digits);
  return x > 0 ? `+${v}` : v;
}

const shortDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Plain-English summary lines for the top of the page.
export function summaryLines({ runs, attempts, now = Date.now(), filterSet = null }) {
  const series = runSeries(runs).filter((r) => filterSet === null || r.set === filterSet);
  const lines = [];
  const scores = series.map((r) => r.score);
  const ends = compareEnds(scores, 5);
  if (ends) {
    const change = ends.pct === null ? `${signed(ends.delta)} points` : signedPct(ends.pct);
    lines.push(`Last ${ends.n} runs ${change} vs first ${ends.n} (average score ${ends.last.toFixed(2)} vs ${ends.first.toFixed(2)}).`);
  } else if (series.length === 1) {
    lines.push(`One timed run so far: score ${series[0].score.toFixed(2)}. Play another to see a trend.`);
  }
  if (series.length >= 3) {
    const t = linearTrend(scores);
    const dir = Math.abs(t.slope) < 0.05 ? 'flat' : t.slope > 0 ? 'rising' : 'falling';
    lines.push(`Trend: ${dir}, ${signed(t.slope)} points per run.`);
  }
  const jumps = detectJumps(scores).filter((j) => j.jump);
  if (jumps.length) {
    lines.push(`${jumps.length === 1 ? '1 jump' : `${jumps.length} jumps`} flagged: ${jumps.map((j) => `run ${j.index + 1} (${shortDate(series[j.index].at)}, ${j.value.toFixed(2)})`).join(', ')}.`);
  }
  const sets = new Set(series.map((r) => r.set));
  if (filterSet === null && sets.size > 1) lines.push('Runs span several sets, which differ in difficulty: filter by set for a like-for-like comparison.');
  const lat = compareEnds(series.map((r) => r.avgFirstMoveMs), 5);
  if (lat && Math.abs(lat.delta) >= 300) {
    lines.push(`First-move thinking time ${lat.delta < 0 ? 'down' : 'up'} from ${(lat.first / 1000).toFixed(1)} s to ${(lat.last / 1000).toFixed(1)} s.`);
  }
  const st = dayStreak([...attempts.map((a) => a.startedAt), ...runs.map((r) => r.endedAt)], now);
  if (attempts.length || runs.length) {
    const count = (k, one) => `${k} ${one}${k === 1 ? '' : 's'}`;
    lines.push(`${st.current ? `${st.current}-day streak` : 'No current streak'}, longest ${count(st.longest, 'day')}; ${count(attempts.length, 'puzzle attempt')} and ${count(runs.length, 'timed run')} in total.`);
  }
  return lines;
}

// ---------------------------------------------------------------- sample data

// Deterministic sample history (clearly labelled in the UI) so the page can be explored before
// any real play. Mostly set 2: scores improve with noise, thinking time falls, and a step up at
// run 12 shows the jump label.
export function sampleData(seed = 7, now = Date.now()) {
  const rng = createRng(seed);
  const day = 24 * 3600 * 1000;
  const pace = { 1: 20, 2: 30, 3: 40 };
  const runs = [];
  const attempts = [];
  const total = 18;
  for (let i = 0; i < total; i++) {
    const set = i < 4 ? 1 : 2;
    const startedAt = now - (total - i) * day * 0.9 - rng.int(0, 3) * 3600 * 1000;
    const skill = 0.5 + 0.02 * i + (i >= 11 ? 0.15 : 0);
    const paceMs = pace[set] * 1000;
    const puzzles = [];
    let clock = 0;
    let k = 0;
    while (clock < 360_000) {
      const optimal = set * 2 + 2 + rng.int(0, 3);
      const skip = rng.next() < 0.18 - 0.006 * i;
      const ms = Math.round(paceMs * (0.6 + rng.next() * 1.1) / Math.min(1.4, skill + 0.3));
      if (clock + ms > 360_000) {
        puzzles.push(row(`sample-${i}-${k}`, optimal, 0, rng.int(0, optimal), 'timeout', 360_000 - clock, rng, i, paceMs));
        break;
      }
      clock += ms;
      if (skip) puzzles.push(row(`sample-${i}-${k}`, optimal, 0, rng.int(0, 3), 'skipped', ms, rng, i, paceMs));
      else {
        const extra = Math.max(0, Math.round((1 - Math.min(1, skill)) * optimal * (0.5 + rng.next())));
        puzzles.push(row(`sample-${i}-${k}`, optimal, optimal + extra, optimal + extra, 'solved', ms, rng, i, paceMs));
      }
      k++;
    }
    const score = puzzles.reduce((s, p) => s + p.efficiency, 0);
    const id = `sample-run-${i}`;
    runs.push({ id, game: 'blockslide', set, seed: i, startedAt, endedAt: startedAt + 360_000, budgetMs: 360_000, durationMs: 360_000, score, attempted: puzzles.length, solved: puzzles.filter((p) => p.outcome === 'solved').length, skipped: puzzles.filter((p) => p.outcome === 'skipped').length, timedOut: puzzles.filter((p) => p.outcome === 'timeout').length, puzzles, sample: true });
    puzzles.forEach((p, j) => attempts.push({
      id: p.attemptId, game: 'blockslide', set, puzzleId: p.puzzleId, mode: 'exam', runId: id, source: 'pool',
      startedAt: startedAt + j * 20_000, optimal: p.optimal, outcome: p.outcome, moves: p.moves, hintsUsed: 0, events: [],
      metrics: { totalMs: p.totalMs, firstMoveMs: p.firstMoveMs, longestPauseMs: p.longestPauseMs, moves: p.moves, grossMoves: p.grossMoves, optimal: p.optimal, efficiency: p.efficiency, solved: p.outcome === 'solved', skipped: p.outcome === 'skipped', timedOut: p.outcome === 'timeout', undos: 0, resets: 0, hints: 0 },
      sample: true,
    }));
  }
  return { runs, attempts, sample: true };

  // Thinking time before the first move shrinks as the sample player practises (run i).
  function row(puzzleId, optimal, moves, grossMoves, outcome, totalMs, r, i, paceMs) {
    const firstMoveMs = Math.min(totalMs, Math.round(paceMs * (0.32 - 0.011 * i) * (0.8 + 0.4 * r.next())));
    return {
      attemptId: `${puzzleId}-a`, puzzleId, source: 'pool', optimal, moves, grossMoves, outcome, totalMs, firstMoveMs,
      longestPauseMs: Math.max(firstMoveMs, Math.round(totalMs * 0.25)),
      efficiency: outcome === 'solved' && moves > 0 ? Math.min(1, optimal / moves) : 0,
    };
  }
}
