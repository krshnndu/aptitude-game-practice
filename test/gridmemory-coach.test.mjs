// Grid Memory coach: per-trial findings from the replayed log and run-level coaching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachTrial, coachRun, serialBuckets, serialCurve, recallTiming, topHabits, GUESS_MS } from '../js/games/gridmemory/coach.js';
import { replayLog, createTrial } from '../js/games/gridmemory/state.js';
import { buildAttempt } from '../js/games/gridmemory/record.js';
import { createStaircase } from '../js/games/gridmemory/stream.js';
import { generateFresh, configFor, freshSeed } from '../js/games/gridmemory/gen.js';
import { summarizeRun } from '../js/core/recorder.js';
import { HAND, playTrial, attemptOf } from './gridmemory-helpers.mjs';

const ids = (res) => res.findings.map((f) => f.id);
const fixes = (res) => res.findings.filter((f) => f.kind === 'fix').map((f) => f.id);

// 5x5, length 6, every side question parity so tests can script answers easily.
const LONG = {
  id: 'gm-long', n: 5, length: 6, sequence: [0, 6, 12, 18, 24, 4], showMs: 700, windowMs: 3000,
  distractors: [[3, 4], [5, 5], [2, 9], [8, 8], [7, 2], [6, 6]].map(([a, b]) => {
    const v = a + b;
    return { kind: 'parity', a, op: '+', b, answer: v % 2 ? 'odd' : 'even' };
  }),
};

test('perfect play: only good and info findings', () => {
  const res = coachTrial(attemptOf(playTrial(HAND)), HAND);
  assert.deepEqual(fixes(res), []);
  assert.ok(ids(res).includes('recall-perfect'));
  assert.ok(ids(res).includes('side-perfect'));
  assert.ok(ids(res).includes('recall-pace'));
  assert.equal(res.result.efficiency, 1);
});

test('order errors and location errors are told apart', () => {
  const swapped = coachTrial(attemptOf(playTrial(HAND, { recall: [0, 8, 2, 4] })), HAND);
  assert.ok(fixes(swapped).includes('order-errors'));
  assert.ok(!fixes(swapped).includes('location-errors'));
  assert.match(swapped.findings.find((f) => f.id === 'order-errors').detail, /position 2 got \(3,3\) \(cell 3 of the sequence\)/);

  const lost = coachTrial(attemptOf(playTrial(HAND, { recall: [0, 2, 1, 3] })), HAND);
  assert.ok(fixes(lost).includes('location-errors'));
  assert.ok(!fixes(lost).includes('order-errors'));
});

test('serial position: errors at the start against errors at the end', () => {
  assert.deepEqual(serialBuckets(6), { first: [0, 1], last: [4, 5] });
  const early = coachTrial(attemptOf(playTrial(LONG, { recall: [1, 2, 12, 18, 24, 4] })), LONG);
  assert.ok(fixes(early).includes('early-errors'));
  const late = coachTrial(attemptOf(playTrial(LONG, { recall: [0, 6, 12, 18, 3, 2] })), LONG);
  assert.ok(fixes(late).includes('late-errors'));
  const middle = coachTrial(attemptOf(playTrial(LONG, { recall: [0, 6, 1, 2, 24, 4] })), LONG);
  assert.ok(!fixes(middle).includes('early-errors') && !fixes(middle).includes('late-errors'));
});

test('side questions: time-outs, fast guesses and dropping the side task', () => {
  const timeouts = coachTrial(attemptOf(playTrial(LONG, { side: ['miss', 'even', 'odd', 'even', 'odd', 'miss'] })), LONG);
  assert.ok(fixes(timeouts).includes('side-timeout'));
  assert.match(timeouts.findings.find((f) => f.id === 'side-timeout').detail, /ran out 2 times/);

  const guesses = coachTrial(attemptOf(playTrial(LONG, { side: 'wrong', rt: GUESS_MS - 200 })), LONG);
  assert.ok(fixes(guesses).includes('side-guess'));
  const dropped = guesses.findings.find((f) => f.id === 'side-dropped');
  assert.ok(dropped, 'side accuracy 0 with recall 100%');
  assert.match(dropped.detail, /memory was protected at the cost of the side task/);

  const slowCareful = coachTrial(attemptOf(playTrial(LONG, { rt: 2500, recall: [1, 2, 3, 5, 7, 8] })), LONG);
  assert.ok(fixes(slowCareful).includes('side-overfocus'));
});

test('wasted steps, hints and the recall pace with the longest pause', () => {
  const t = playTrial(HAND, {
    recall: [],
    extra: (trial, tick) => {
      trial.tap(0, tick());
      trial.tap(0, tick());
      trial.tap(0, tick());
      trial.tap(4, tick());
      trial.undo(tick());
      trial.hint(tick());
      for (let i = 0; i < 6; i++) tick();
      trial.tap(4, tick());
      trial.tap(8, tick());
    },
  });
  const res = coachTrial(attemptOf(t), HAND);
  assert.ok(fixes(res).includes('wasted-steps'));
  assert.ok(fixes(res).includes('hint'));
  assert.match(res.findings.find((f) => f.id === 'wasted-steps').detail, /2 repeat taps on a cell already entered and 1 undo/);
  const pace = res.findings.find((f) => f.id === 'recall-pace');
  assert.match(pace.detail, /Longest pause 4\.9 s before position 3, and that position was wrong/);
  const timing = recallTiming(replayLog(HAND, t.events));
  assert.equal(timing.longestGapAt, 2);
});

test('recall pace is compared with your own history in the set', () => {
  const history = [1, 2, 3].map(() => buildAttempt(playTrial(HAND, { tapMs: 2000 }), { set: 1, mode: 'practice', startedAt: 1 }));
  const res = coachTrial(attemptOf(playTrial(HAND, { tapMs: 500 })), HAND, { history });
  assert.match(res.findings.find((f) => f.id === 'recall-pace').detail, /usual pace in this set: 2\.1 s per cell \(median of 3\)/);
});

test('skip cost names the phase and the points given up', () => {
  const mid = coachTrial(attemptOf(playTrial(HAND, { skipAt: { phase: 'show', step: 2 } })), HAND);
  const f = mid.findings.find((x) => x.id === 'skip-cost');
  assert.equal(f.kind, 'fix');
  assert.match(f.detail, /while the sequence was still running \(after cell 3 of 4\)/);
  const late = coachTrial(attemptOf(playTrial(HAND, { skipAt: { phase: 'recall', after: 3 } })), HAND);
  assert.match(late.findings.find((x) => x.id === 'skip-cost').detail, /after entering 3 cells of 4.*worth 33 of 40 points/);
});

test('a corrupt or empty log does not crash the coach', () => {
  const res = coachTrial({ id: 'x', set: 1, outcome: 'skipped', events: [] }, HAND);
  assert.ok(Array.isArray(res.findings));
  const junk = coachTrial({ id: 'y', set: 1, outcome: 'solved', events: [{ t: 5, type: 'move', p: 77 }, { t: 6, type: 'select', p: 99, d: 'yes' }] }, HAND);
  assert.ok(Array.isArray(junk.findings));
});

test('habit ranking counts each habit once per trial', () => {
  const a = [{ id: 'order-errors', kind: 'fix', severity: 2 }, { id: 'order-errors', kind: 'fix', severity: 1 }];
  const b = [{ id: 'side-timeout', kind: 'fix', severity: 1 }, { id: 'recall-perfect', kind: 'good', severity: 0 }];
  const h = topHabits([a, b, a]);
  assert.equal(h[0].id, 'order-errors');
  assert.equal(h[0].count, 2);
  assert.equal(h[0].of, 3);
  assert.equal(h.length, 2);
});

test('run coaching: span, trade-off, serial curve, error types, time and skips', () => {
  const cfg = configFor(4);
  const stair = createStaircase({ start: 4, max: cfg.runMax });
  const attempts = [];
  const puzzles = new Map();
  const plan = [
    { recall: 'right', side: 'right' },
    { recall: 'right', side: 'right' },
    { recall: 'late', side: 'right' },
    { recall: 'right', side: 'wrong' },
    { skip: true },
    { recall: 'late', side: 'right' },
  ];
  plan.forEach((step, k) => {
    const p = generateFresh(cfg, stair.length, freshSeed(77, k));
    puzzles.set(p.id, p);
    const seq = p.sequence;
    const others = Array.from({ length: 25 }, (_, i) => i).filter((c) => !seq.includes(c));
    const recall = step.recall === 'late' ? [...seq.slice(0, -2), others[0], others[1]] : seq;
    const t = playTrial(p, { side: step.side ?? 'right', recall, mode: 'exam', skipAt: step.skip ? { phase: 'recall', after: 1 } : null });
    const a = buildAttempt(t, { set: 4, mode: 'exam', runId: 'r1', source: 'generated', startedAt: 1000 + k });
    attempts.push(a);
    stair.update(t.result().success);
  });
  const run = { ...summarizeRun({ id: 'r1', game: 'gridmemory', set: 4, seed: 77, startedAt: 0, endedAt: 360_000, budgetMs: 360_000, attempts }), maxSpan: stair.maxSpan, trail: stair.trail };
  const res = coachRun(run, attempts, puzzles);
  const byId = Object.fromEntries(res.lines.map((l) => [l.id, l]));
  assert.equal(byId.span.title, 'Span reached: 5');
  assert.match(byId.span.text, /Lengths played: 4 pass, 5 pass, 6 miss, 5 miss, 4 miss, 3 miss/);
  assert.ok(byId['trade-off']);
  assert.equal(byId.serial.kind, 'fix');
  assert.match(byId.serial.text, /Weak end \(low recency\)/);
  assert.match(byId['error-types'].text, /location error/);
  assert.equal(byId.skips.kind, 'fix');
  assert.match(byId.skips.text, /trial 5 \(at recall\)/);
  // Location errors in trials 3 and 6 (weight 4) outrank the single late-errors finding.
  assert.equal(res.habits[0].id, 'location-errors');
  assert.equal(res.habits[0].count, 2);
  assert.equal(res.perTrial.length, 6);

  // Puzzles missing from the map are rebuilt from generated ids.
  assert.equal(coachRun(run, attempts, {}).perTrial.length, 6);
  assert.equal(coachRun({ puzzles: [] }).lines[0].id, 'empty');
});

test('run coaching when the clock cut off the only trial', () => {
  const t = createTrial(HAND, { mode: 'exam' });
  t.begin(0);
  t.endShow(1000);
  t.timeout(2000);
  const a = buildAttempt(t, { set: 1, mode: 'exam', runId: 'r2', startedAt: 5 });
  const run = { ...summarizeRun({ id: 'r2', game: 'gridmemory', set: 1, seed: 1, startedAt: 0, endedAt: 360_000, budgetMs: 360_000, attempts: [a] }), maxSpan: 0, trail: [] };
  const res = coachRun(run, [a], { [HAND.id]: HAND });
  const time = res.lines.find((l) => l.id === 'time');
  assert.match(time.text, /^No trial finished before the clock ran out; 1 trial reached/);
  assert.equal(res.lines.find((l) => l.id === 'span').kind, 'fix');
});

test('serial curve skips short and unsubmitted trials', () => {
  const curve = serialCurve([
    { result: { outcome: 'submitted', recall: { total: 2, positions: [] } } },
    { result: { outcome: 'skipped', recall: { total: 6, positions: [] } } },
  ]);
  assert.deepEqual([curve.first, curve.middle, curve.last], [null, null, null]);
});
