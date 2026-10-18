// Analytics math: summary stats, moving average, trend, jump detection, streaks, series, summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mean, median, stddev, movingAverage, linearTrend, detectJumps, compareEnds, dayStreak, dayKey,
  runSeries, efficiencyBySet, personalBests, setProgress, summaryLines, sampleData,
} from '../js/core/analytics.js';
import { niceTicks } from '../js/core/charts.js';
import { migrate } from '../js/core/recorder.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ~ ${b}`);

test('mean, median, stddev, ignoring non-finite values', () => {
  assert.equal(mean([1, 2, 3, 6]), 3);
  assert.equal(mean([]), null);
  assert.equal(mean([NaN, null, undefined, Infinity]), null);
  assert.equal(mean([2, NaN, 4]), 3);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(stddev([2, 4, 4, 4, 5, 5, 7, 9]), 2, 'population sd');
  assert.equal(stddev([7]), 0);
  assert.equal(stddev([]), null);
});

test('moving average: trailing window, partial start, gaps and bad windows', () => {
  assert.deepEqual(movingAverage([1, 2, 3, 4, 5], 3), [1, 1.5, 2, 3, 4]);
  assert.deepEqual(movingAverage([1, 2, 3], 1), [1, 2, 3], 'window 1 is the identity');
  assert.deepEqual(movingAverage([2, 4, 6], 10), [2, 3, 4], 'window longer than the series');
  assert.deepEqual(movingAverage([2, 4], 0), [2, 4], 'window 0 is treated as 1');
  assert.deepEqual(movingAverage([2, 4], -3), [2, 4]);
  assert.deepEqual(movingAverage([2, 4], 2.9), [2, 3], 'fractional window floors to 2');
  assert.deepEqual(movingAverage([], 5), []);
  assert.deepEqual(movingAverage([4, null, 8, NaN], 2), [4, 4, 8, 8], 'missing values are skipped');
  assert.deepEqual(movingAverage([null, null, 3], 2), [null, null, 3], 'no data in the window gives null');
});

test('linear trend: exact fit, flat, single point, empty, gaps', () => {
  const t = linearTrend([1, 3, 5, 7]);
  close(t.slope, 2);
  close(t.intercept, 1);
  close(t.at(10), 21);
  assert.equal(linearTrend([4, 4, 4]).slope, 0);
  const one = linearTrend([5]);
  assert.equal(one.slope, 0);
  assert.equal(one.at(3), 5);
  assert.equal(linearTrend([]).at(0), null);
  const gap = linearTrend([0, null, 4]);
  close(gap.slope, 2, 1e-9);
  const noisy = linearTrend([5, 4, 6, 5, 7, 6, 8]);
  assert.ok(noisy.slope > 0);
});

test('jump detection: beats previous best or rolling mean by more than 1 SD', () => {
  const j = detectJumps([5, 5.2, 4.8, 5.1, 8]);
  assert.deepEqual(j.map((r) => r.jump), [false, false, false, false, true]);
  assert.deepEqual(j[4].reasons, ['best', 'mean']);
  close(j[4].best, 5.2);
  close(j[4].rollingMean, 5.025);
  assert.ok(j[4].sd > 0);
  // Above the recent mean by more than 1 SD, but not above the old best: a 'mean' jump only.
  const m = detectJumps([2, 10, 2, 2, 2, 7]);
  assert.equal(m[5].jump, true);
  assert.deepEqual(m[5].reasons, ['mean']);
  // Too little history: never a jump.
  assert.ok(detectJumps([1, 100]).every((r) => !r.jump));
  assert.equal(detectJumps([1, 1, 1, 100], { minHistory: 4 })[3].jump, false);
  // Flat history has SD 0: an equal value is not a jump, any rise is.
  const flat = detectJumps([3, 3, 3, 3, 3.5]);
  assert.equal(flat[3].jump, false);
  assert.equal(flat[4].jump, true);
  // Decline and steady improvement inside the noise band are not jumps.
  assert.ok(detectJumps([8, 7, 6, 5, 4]).every((r) => !r.jump));
  assert.ok(detectJumps([5, 6, 5.5, 5.6, 5.4, 5.7]).every((r) => !r.jump), 'moves inside 1 SD are noise');
  // A step up keeps clearing the lagging rolling mean for a few runs, then settles.
  assert.deepEqual(detectJumps([5, 5, 5, 5, 5, 6, 6, 6, 6]).map((r) => r.jump), [false, false, false, false, false, true, true, true, false]);
  // Non-finite values are skipped and do not count as history.
  const gaps = detectJumps([5, NaN, 5, 5, null, 9]);
  assert.equal(gaps[1].jump, false);
  assert.equal(gaps[5].jump, true);
  // k scales the threshold; window limits the rolling mean.
  assert.equal(detectJumps([5, 5.2, 4.8, 5.1, 5.6], { k: 1 })[4].jump, true);
  assert.equal(detectJumps([5, 5.2, 4.8, 5.1, 5.6], { k: 5 })[4].jump, false, 'rise 0.575 against 5 SD = 0.74');
  const w = detectJumps([10, 0, 0, 0, 5], { window: 3 });
  close(w[4].rollingMean, 0);
  assert.deepEqual(w[4].reasons, ['mean'], '5 beats the 3-run mean 0 by more than SD 4.33');
  assert.equal(detectJumps([10, 0, 0, 0, 5], { window: 5 })[4].jump, false, 'the 5-run mean 2.5 is too close');
  assert.deepEqual(detectJumps([]), []);
});

test('compareEnds: first k against last k, shrinking for short series', () => {
  const c = compareEnds([5, 5, 5, 5, 5, 6, 6, 6, 6, 6.5]);
  assert.equal(c.n, 5);
  close(c.pct, 0.22);
  assert.equal(compareEnds([4, 6]).n, 1);
  close(compareEnds([4, 6]).pct, 0.5);
  assert.equal(compareEnds([4, 6, 8]).n, 1, 'odd length: the middle value is left out');
  assert.equal(compareEnds([7]), null);
  assert.equal(compareEnds([]), null);
  assert.equal(compareEnds([0, 2]).pct, null, 'no percentage against a zero start');
  assert.equal(compareEnds([0, 2]).delta, 2);
});

test('day streak: local days, today or yesterday, gaps, longest', () => {
  const at = (d, h = 12) => new Date(2026, 9, d, h).getTime();
  const now = at(18, 20);
  assert.deepEqual(dayStreak([], now), { current: 0, longest: 0, days: 0 });
  assert.deepEqual(dayStreak([at(18, 9), at(18, 23), at(17), at(16)], now), { current: 3, longest: 3, days: 3 });
  assert.equal(dayStreak([at(17), at(16)], now).current, 2, 'not played today yet: yesterday keeps the streak');
  assert.equal(dayStreak([at(15), at(16)], now).current, 0, 'two days ago breaks it');
  assert.deepEqual(dayStreak([at(1), at(2), at(3), at(4), at(10), at(18)], now), { current: 1, longest: 4, days: 6 });
  // Month boundary.
  assert.equal(dayStreak([new Date(2026, 9, 1, 8).getTime(), new Date(2026, 8, 30, 8).getTime()], new Date(2026, 9, 1, 20).getTime()).current, 2);
  assert.equal(dayKey(at(5, 0)), '2026-10-05');
});

function run(id, set, endedAt, rows) {
  return { id, set, endedAt, startedAt: endedAt - 360_000, score: rows.reduce((s, r) => s + r.efficiency, 0), puzzles: rows };
}
const solved = (optimal, moves, gross = moves, firstMoveMs = 3000) => ({ outcome: 'solved', optimal, moves, grossMoves: gross, efficiency: Math.min(1, optimal / moves), firstMoveMs, totalMs: 20_000, puzzleId: 'p' });
const skipped = (firstMoveMs = null) => ({ outcome: 'skipped', optimal: 5, moves: 0, grossMoves: 0, efficiency: 0, firstMoveMs, totalMs: 9000, puzzleId: 'p' });

test('run series: sorted, with skip, wasted-move and latency rates', () => {
  const runs = [
    run('b', 1, 2000, [solved(4, 4), skipped()]),
    run('a', 1, 1000, [solved(4, 8, 8, 6000), solved(5, 5, 5, 2000), skipped(1000), skipped()]),
  ];
  const s = runSeries(runs);
  assert.deepEqual(s.map((r) => r.id), ['a', 'b']);
  assert.deepEqual(s.map((r) => r.n), [1, 2]);
  assert.equal(s[0].solved, 2);
  assert.equal(s[0].attempted, 4);
  assert.equal(s[0].skipRate, 0.5);
  close(s[0].wastedRate, 4 / 13);
  assert.equal(s[0].avgFirstMoveMs, 3000, 'skips without a move are left out of the latency mean');
  close(s[0].avgEfficiency, 1.5 / 4);
  assert.equal(s[1].wastedRate, 0);
  assert.equal(runSeries([run('e', 1, 1, [])])[0].skipRate, null, 'empty run: no rate');
});

test('per-set efficiency, personal bests and progress', () => {
  const att = (set, outcome, eff, mode = 'practice', puzzleId = 'x', totalMs = 10_000) => ({ set, outcome, mode, puzzleId, metrics: { efficiency: eff, totalMs } });
  const attempts = [att(1, 'solved', 1, 'practice', 'a', 8000), att(1, 'solved', 0.5), att(1, 'skipped', 0), att(2, 'solved', 1, 'exam', 'b', 30_000)];
  const eff = efficiencyBySet(attempts, [1, 2, 3]);
  close(eff[0].efficiency, 0.5);
  close(eff[0].solvedEfficiency, 0.75);
  assert.equal(eff[2].efficiency, null);
  const runs = [run('r1', 1, 1000, [solved(4, 8)]), run('r2', 1, 2000, [solved(4, 4), solved(4, 4)]), run('r3', 1, 3000, [solved(4, 5)])];
  const pb = personalBests(runs, attempts, [1, 2]);
  assert.equal(pb[0].bestScore, 2);
  assert.equal(pb[0].bestScoreAt, 2000);
  assert.equal(pb[0].mostSolved, 2);
  assert.equal(pb[0].fastestPerfectMs, 8000);
  assert.equal(pb[1].bestScore, null);
  assert.equal(pb[1].fastestPerfectMs, 30_000);
  const pr = setProgress(runs, attempts, [1]);
  assert.equal(pr[0].runs, 3);
  assert.equal(pr[0].practicePuzzles, 2);
  close(pr[0].lastScore, 0.8);
  assert.equal(pr[0].change.n, 1);
});

test('summary: "Last 5 runs +22% vs first 5" and friends', () => {
  const scores = [5, 5, 5, 5, 5, 6, 6, 6, 6, 6.5];
  const day = 86_400_000;
  const now = new Date(2026, 9, 18, 20).getTime();
  const runs = scores.map((sc, i) => ({ id: `r${i}`, set: 2, endedAt: now - (scores.length - i) * day, startedAt: 0, score: sc, puzzles: [solved(4, 4)] }));
  const lines = summaryLines({ runs, attempts: [], now });
  assert.equal(lines[0], 'Last 5 runs +22% vs first 5 (average score 6.10 vs 5.00).');
  assert.match(lines[1], /^Trend: rising, \+0\.\d\d points per run\.$/);
  assert.ok(lines.some((l) => /^4 jumps flagged: run 6 \(.+, 6\.00\), run 7 .*run 10 \(.+, 6\.50\)\.$/.test(l)), lines.join(' | '));
  assert.ok(lines.includes('10-day streak, longest 10 days; 0 puzzle attempts and 10 timed tests in total.'), 'daily runs ending yesterday');
  assert.match(summaryLines({ runs: runs.slice(0, 1), attempts: [{ startedAt: now }], now }).at(-1), /1 puzzle attempt and 1 timed test in total\.$/);
  assert.ok(!lines.some((l) => /several sets/.test(l)));
  const mixed = summaryLines({ runs: [...runs, { ...runs[0], id: 'x', set: 3 }], attempts: [], now });
  assert.ok(mixed.some((l) => /several sets/.test(l)));
  assert.ok(!summaryLines({ runs: [...runs, { ...runs[0], id: 'x', set: 3 }], attempts: [], now, filterSet: 2 }).some((l) => /several sets/.test(l)));
  assert.match(summaryLines({ runs: runs.slice(0, 1), attempts: [], now })[0], /^One timed test so far/);
  assert.deepEqual(summaryLines({ runs: [], attempts: [], now }), []);
});

test('sample data: deterministic, labelled, includes a jump, survives the recorder sanitizer', () => {
  const now = new Date(2026, 9, 18, 12).getTime();
  const a = sampleData(7, now);
  const b = sampleData(7, now);
  assert.deepEqual(a, b);
  assert.equal(a.sample, true);
  assert.ok(a.runs.every((r) => r.sample) && a.attempts.every((x) => x.sample));
  assert.ok(a.runs.length >= 10);
  const scores = runSeries(a.runs).map((r) => r.score);
  assert.ok(detectJumps(scores).some((j) => j.jump), 'sample shows the jump label');
  assert.ok(linearTrend(scores).slope > 0);
  const m = migrate({ v: 1, attempts: a.attempts, runs: a.runs });
  assert.equal(m.ok, true);
  assert.equal(m.dropped, 0);
});

test('chart ticks are clean numbers covering the range', () => {
  assert.deepEqual(niceTicks(0, 1), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(niceTicks(0, 7.3), [0, 2, 4, 6, 8]);
  const flat = niceTicks(5, 5);
  assert.ok(flat[0] <= 5 && flat.at(-1) >= 5 && flat.length >= 2);
  assert.deepEqual(niceTicks(NaN, 3), [0, 1]);
  const t = niceTicks(3200, 11800);
  assert.ok(t[0] <= 3200 && t.at(-1) >= 11800);
});
