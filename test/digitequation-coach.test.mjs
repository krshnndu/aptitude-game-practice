// Digit Equation coach: findings from the player's own event log, and recorder integration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachPuzzle, coachRun, replayLog, topHabits } from '../js/games/digitequation/coach.js';
import { createAttemptLog, sanitizeAttempt, summarizeRun, computeMetrics } from '../js/core/recorder.js';

const P = (tokens, tray, extra = {}) => ({ id: 'h1', tokens, tray: tray.map(([d, n = 1]) => ({ d, n })), optimal: tokens.join('').split('_').length - 1, ...extra });
const EQ = P(['4_', 'x', '3', '=', '1_6'], [[2, 2], [5], [7], [9]]);
const MIXED = P(['_', '+', '7', 'x', '_', '=', '29'], [[1], [4], [5], [8], [9]]);

// Build an attempt record the way the UI does, from [t, type, p, d] tuples.
function attempt(puzzle, rows, outcome = 'solved', extra = {}) {
  const events = rows.map(([t, type, p, d]) => {
    const ev = { t, type };
    if (p !== undefined) ev.p = p;
    if (d !== undefined) ev.d = d;
    return ev;
  });
  const end = { solved: 'solve', skipped: 'skip', timeout: 'timeout' }[outcome];
  events.push({ t: (rows.at(-1)?.[0] ?? 0) + 100, type: end });
  const moves = events.filter((e) => e.type === 'move').length;
  return {
    id: extra.id ?? 'a1', game: 'digitequation', set: 2, puzzleId: puzzle.id, mode: 'practice', startedAt: 0,
    optimal: puzzle.optimal, outcome, events, metrics: computeMetrics(events, { optimal: puzzle.optimal, moves, outcome }), ...extra,
  };
}
const ids = (res) => res.findings.map((f) => f.id);

test('clean solve: two tiles, no wrong checks', () => {
  const a = attempt(EQ, [[0, 'select', 0], [4000, 'move', 0, 2], [6000, 'move', 1, 2]]);
  const res = coachPuzzle(a, EQ, { paceSec: 25 });
  assert.ok(ids(res).includes('clean'));
  assert.ok(!res.findings.some((f) => f.kind === 'fix'));
});

test('wrong checks report the sides; swaps count as extra placements', () => {
  const a = attempt(EQ, [
    [0, 'select', 0], [3000, 'move', 0, 5], [4000, 'move', 1, 2], [5000, 'blocked'],
    [7000, 'select', 0], [7500, 'move', 0, 2],
  ]);
  const res = coachPuzzle(a, EQ, { paceSec: 25 });
  const wc = res.findings.find((f) => f.id === 'wrong-checks');
  assert.ok(wc);
  assert.match(wc.detail, /45 × 3 = 126 gave 135 on the left, 126 on the right/);
  const w = res.findings.find((f) => f.id === 'wasted');
  assert.equal(w.data.extra, 1);
  assert.equal(res.stats.swaps, 1);
});

test('trial and error: many quick swaps and wrong checks', () => {
  const rows = [[0, 'select', 0]];
  let t = 1000;
  for (const d of [5, 7, 9, 5, 7]) {
    rows.push([t, 'move', 0, d], [t + 300, 'move', 1, 2], [t + 600, 'blocked'], [t + 700, 'select', 0]);
    t += 1000;
  }
  rows.push([t, 'move', 0, 2]);
  const res = coachPuzzle(attempt(EQ, rows), EQ, { paceSec: 25 });
  const g = res.findings.find((f) => f.id === 'guessing');
  assert.ok(g, 'guessing flagged');
  assert.ok(g.data.wrong >= 3);
  assert.ok(ids(res).includes('decoy'), '9 is a decoy no answer uses');
});

test('order of operations slip: a fill that is only true left to right', () => {
  // (5 + 7) x 2 = 24, not 29; we need a left-to-right-true fill: (A + 7) x B = 29 has none,
  // so use a puzzle where it exists: _ + 2 x _ = 10, LTR (3 + 2) x 2 = 10, but 3 + 4 = 7.
  const p = P(['_', '+', '2', 'x', '_', '=', '10'], [[2], [3], [4], [6]]);
  const a = attempt(p, [[0, 'select', 0], [2000, 'move', 0, 3], [2500, 'move', 1, 2], [3000, 'blocked'], [5000, 'select', 0], [5200, 'move', 0, 6]]);
  const res = coachPuzzle(a, p, { paceSec: 25 });
  const slip = res.findings.find((f) => f.id === 'precedence');
  assert.ok(slip);
  assert.match(slip.detail, /true only if you work strictly left to right/);
});

test('skip timing: early, late, and plain', () => {
  const early = coachPuzzle(attempt(MIXED, [[1000, 'select', 1]], 'skipped'), MIXED, { paceSec: 30 });
  assert.ok(ids(early).includes('skip-early'));
  const late = coachPuzzle(attempt(MIXED, [[70_000, 'move', 0, 9]], 'skipped'), MIXED, { paceSec: 30 });
  assert.ok(ids(late).includes('skip-late'));
  const mid = coachPuzzle(attempt(MIXED, [[20_000, 'move', 0, 9]], 'skipped'), MIXED, { paceSec: 30 });
  assert.ok(ids(mid).includes('skip'));
});

test('time-out and slow solve', () => {
  const to = coachPuzzle(attempt(MIXED, [[5000, 'move', 0, 1]], 'timeout'), MIXED, { paceSec: 30 });
  assert.ok(ids(to).includes('timeout'));
  const slow = coachPuzzle(attempt(MIXED, [[10_000, 'move', 0, 1], [70_000, 'move', 1, 4]]), MIXED, { paceSec: 30 });
  assert.ok(ids(slow).includes('time-slow'));
});

test('first placement latency against your own median', () => {
  const history = [1, 2, 3].map((k) => ({ ...attempt(EQ, [[2000, 'move', 0, 2], [3000, 'move', 1, 2]], 'solved', { id: `h${k}` }) }));
  const slow = attempt(EQ, [[12_000, 'move', 0, 2], [13_000, 'move', 1, 2]], 'solved', { id: 'now' });
  const res = coachPuzzle(slow, EQ, { history, paceSec: 25 });
  const f = res.findings.find((x) => x.id === 'latency-slow');
  assert.ok(f);
  assert.equal(f.data.scope, 'puzzle');
});

test('replay: clear uses the selected blank, reset clears all', () => {
  const rep = replayLog(EQ, [
    { t: 0, type: 'move', p: 0, d: 5 }, { t: 1, type: 'move', p: 1, d: 2 },
    { t: 2, type: 'select', p: 0 }, { t: 3, type: 'undo' },
  ]);
  assert.deepEqual(rep.fill, [null, 2]);
  assert.equal(rep.clears, 1);
  const rep2 = replayLog(EQ, [{ t: 0, type: 'move', p: 0, d: 5 }, { t: 1, type: 'reset' }, { t: 2, type: 'move', p: 0, d: 2 }]);
  assert.deepEqual(rep2.fill, [2, null]);
  assert.equal(rep2.swaps, 1, 're-placing a blank after a reset is a swap');
});

test('recorder integration: the UI log passes sanitizeAttempt and gives game metrics', () => {
  let now = 1000;
  const log = createAttemptLog({ game: 'digitequation', set: 2, puzzleId: EQ.id, mode: 'exam', runId: 'r1', optimal: 2, now: () => now });
  now += 500; log.select(0);
  now += 2500; log.move(0, 5);
  now += 500; log.move(1, 2);
  now += 500; log.blocked(null, null);
  now += 900; log.select(0);
  now += 300; log.move(0, 2);
  now += 200;
  const a = log.end('solved', { moves: 3 });
  const clean = sanitizeAttempt(a);
  assert.ok(clean);
  assert.equal(clean.metrics.grossMoves, 3);
  assert.equal(clean.metrics.blocked, 1);
  assert.equal(clean.metrics.firstMoveMs, 3000);
  assert.ok(Math.abs(clean.metrics.efficiency - 2 / 3) < 1e-9);
  const res = coachPuzzle(clean, EQ, { paceSec: 25 });
  assert.ok(ids(res).includes('wrong-checks'));

  const run = summarizeRun({ id: 'r1', game: 'digitequation', set: 2, seed: 1, startedAt: 0, endedAt: 360_000, budgetMs: 360_000, attempts: [clean] });
  const rc = coachRun(run, [clean], { [EQ.id]: EQ }, { paceSec: 25 });
  assert.deepEqual(rc.lines.map((l) => l.id), ['time-per-puzzle', 'accuracy', 'skip-policy', 'pace']);
  assert.match(rc.lines[1].text, /Solved 1 of 1; 0 on the first check/);
  assert.ok(rc.habits.length >= 1);
});

test('run coaching with no puzzles, and habit ranking', () => {
  const empty = coachRun({ puzzles: [], score: 0 }, [], {});
  assert.equal(empty.lines[0].id, 'empty');
  const h = topHabits([
    [{ id: 'guessing', kind: 'fix', severity: 3 }, { id: 'wasted', kind: 'fix', severity: 1 }],
    [{ id: 'guessing', kind: 'fix', severity: 2 }],
    [{ id: 'clean', kind: 'good', severity: 0 }],
  ]);
  assert.equal(h[0].id, 'guessing');
  assert.equal(h[0].count, 2);
  assert.equal(h[0].of, 3);
});
