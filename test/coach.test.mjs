// Coach: findings computed from replayed logs, deep vs stored-line divergence, run-level coaching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachPuzzle, coachRun, replayLog, latencyBaseline, countReversals, topHabits, HABITS } from '../js/games/blockslide/coach.js';
import { createAttemptLog, summarizeRun } from '../js/core/recorder.js';
import { solve } from '../js/games/blockslide/solver.js';
import { loadSet } from '../tools/verify.mjs';
import { HAND_BUILT } from './helpers.mjs';

const withSolution = (i) => {
  const { puzzle, optimal } = HAND_BUILT[i];
  return { ...puzzle, id: `hand-${i}`, optimal, solution: solve(puzzle).moves };
};
const SINGLE = withSolution(2); // stored: ball R, A U, ball R, ball R (A U first is equally optimal)
const CHAIN = withSolution(3); // stored: A R, ball R, A U, ball R, ball R
const BS101 = loadSet(1).puzzles[0]; // stored: ball U, C L, ball U; blocks A and B never move

const M = (p, d) => ['move', p, d];

// steps: ['move', p, d] | ['undo'] | ['reset'] | ['select', p]; one action per second after `first` ms.
function play(puzzle, steps, { first = 3000, step = 1000, outcome = 'solved', end = null, mode = 'practice', set = 1, id = null } = {}) {
  let t = 0;
  const log = createAttemptLog({ game: 'blockslide', set, puzzleId: puzzle.id, mode, optimal: puzzle.optimal, now: () => t });
  let net = 0;
  steps.forEach(([fn, ...args], i) => {
    t = first + i * step;
    log[fn](...args);
    if (fn === 'move') net++;
    else if (fn === 'undo') net = Math.max(0, net - 1);
    else if (fn === 'reset') net = 0;
  });
  if (end !== null) t = end;
  const a = log.end(outcome, { moves: net });
  if (id) a.id = id;
  return a;
}

const ids = (res) => res.findings.map((f) => f.id);
const get = (res, id) => res.findings.find((f) => f.id === id);
const DASH_CODES = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212]);
const DASH = { test: (s) => [...s].some((ch) => DASH_CODES.has(ch.codePointAt(0))) };

function checkText(res) {
  for (const f of res.findings) {
    assert.ok(!DASH.test(f.title + f.detail + f.tip), `no unicode dashes: ${f.detail}`);
    assert.ok(f.detail.length > 10);
    if (f.kind === 'fix') assert.ok(f.tip.length > 10, `fix findings carry a suggestion: ${f.id}`);
  }
}

test('optimal play: a single good finding and nothing to fix', () => {
  const a = play(CHAIN, CHAIN.solution.map((m) => M(m.p, m.d)));
  const res = coachPuzzle(a, CHAIN, { deep: true });
  assert.ok(ids(res).includes('optimal'));
  assert.equal(res.findings.filter((f) => f.kind === 'fix').length, 0);
  checkText(res);
});

test('an equally short alternative order is still optimal (no false divergence)', () => {
  const a = play(SINGLE, [M(1, 'U'), M(0, 'R'), M(0, 'R'), M(0, 'R')]);
  const res = coachPuzzle(a, SINGLE, { deep: false });
  assert.ok(ids(res).includes('optimal'));
  assert.ok(!ids(res).includes('divergence'));
});

test('wasted moves, oscillation, premature ball moves and the divergence point', () => {
  // A R, ball R (both optimal), then ball L and back while the lane is still closed.
  const a = play(CHAIN, [M(1, 'R'), M(0, 'R'), M(0, 'L'), M(0, 'R'), M(1, 'U'), M(0, 'R'), M(0, 'R')]);
  const res = coachPuzzle(a, CHAIN, { deep: true });
  checkText(res);
  const w = get(res, 'wasted');
  assert.equal(w.data.wasted, 2);
  assert.match(w.detail, /You made 7 moves on a puzzle that needs 5: 2 wasted moves/);
  const pre = get(res, 'premature-ball');
  assert.deepEqual(pre.data.moves, [3], 'move 4 (ball back right) is the stored move from that position');
  assert.equal(get(res, 'oscillation').data.count, 1);
  assert.match(get(res, 'oscillation').detail, /ball right then left \(moves 2 and 3\)/);
  const div = get(res, 'divergence');
  assert.equal(div.data.move, 3);
  assert.deepEqual(div.data.played, { p: 0, d: 'L' });
  assert.deepEqual(div.data.better, { p: 1, d: 'U' });
  assert.equal(div.data.exact, true);
  assert.match(div.detail, /^At your move 3 you moved ball 1 left, which left every optimal line\. Better: Move block A \(blue\) 1 up: clears cell \(4,3\) on the ball's route\./);
  assert.ok(!ids(res).includes('optimal'));
});

test('ball moves on the optimal line are never premature, even with the lane closed', () => {
  const a = play(CHAIN, [M(1, 'R'), M(0, 'R'), M(1, 'U'), M(1, 'D'), M(1, 'U'), M(0, 'R'), M(0, 'R')]);
  const res = coachPuzzle(a, CHAIN, { deep: true });
  assert.ok(!ids(res).includes('premature-ball'), 'move 2 (ball R) is part of the optimal line');
  assert.equal(get(res, 'divergence').data.move, 4);
});

test('deep search accepts an alternative optimal prefix; the stored-line check does not', () => {
  // A U first is optimal but differs from the stored line; the waste starts at move 2.
  const a = play(SINGLE, [M(1, 'U'), M(1, 'D'), M(1, 'U'), M(0, 'R'), M(0, 'R'), M(0, 'R')]);
  const deep = coachPuzzle(a, SINGLE, { deep: true });
  const quick = coachPuzzle(a, SINGLE, { deep: false });
  assert.equal(get(deep, 'divergence').data.move, 2);
  assert.deepEqual(get(deep, 'divergence').data.better, { p: 0, d: 'R' });
  assert.equal(get(quick, 'divergence').data.move, 1);
  assert.equal(get(quick, 'divergence').data.exact, false);
  assert.match(get(quick, 'divergence').detail, /left the optimal line/);
});

test('after wasted moves, the right ball move from a stored-line position is not premature', () => {
  // Out and back on block A returns to the start position; ball U is then the stored first move.
  const a = play(BS101, [M(1, 'L'), M(1, 'R'), ...BS101.solution.map((m) => M(m.p, m.d))]);
  const res = coachPuzzle(a, BS101, { deep: true });
  assert.ok(!ids(res).includes('premature-ball'), res.findings.map((f) => f.detail).join(' | '));
  const rep = replayLog(BS101, a.events);
  assert.deepEqual(rep.moves.map((e) => e.bestFromHere), [false, false, true, true, true]);
});

test('moves on blocks the optimal line never touches', () => {
  const a = play(BS101, [M(1, 'L'), M(1, 'R'), ...BS101.solution.map((m) => M(m.p, m.d))]);
  const res = coachPuzzle(a, BS101, { deep: true });
  const off = get(res, 'off-line-pieces');
  assert.equal(off.data.count, 2);
  assert.deepEqual(off.data.pieces, [1]);
  assert.match(off.detail, /You moved block A \(blue\) 2 times; the optimal line never moves it\./);
  assert.equal(get(res, 'divergence').data.move, 1);
  assert.equal(get(res, 'wasted').data.wasted, 2);
});

test('undo and reset are counted; undone moves do not count as divergence', () => {
  const steps = [M(1, 'R'), ['undo'], M(1, 'R'), M(0, 'R'), ['reset'], ...CHAIN.solution.map((m) => M(m.p, m.d))];
  const a = play(CHAIN, steps);
  const res = coachPuzzle(a, CHAIN, { deep: true });
  assert.equal(get(res, 'undo').kind, 'info', 'undo is fine in practice');
  assert.equal(get(res, 'reset').kind, 'fix');
  assert.equal(get(res, 'wasted').data.undone, 3);
  assert.match(get(res, 'wasted').detail, /\(3 undone or reset\)/);
  assert.ok(!ids(res).includes('divergence'));
  const exam = coachPuzzle({ ...a, mode: 'exam' }, CHAIN);
  assert.equal(get(exam, 'undo').kind, 'fix');
  const rep = replayLog(CHAIN, a.events);
  assert.deepEqual(rep.moves.map((e) => e.undone), ['undo', 'reset', 'reset', null, null, null, null, null]);
  assert.equal(rep.net.length, 5);
});

test('first-move latency against your own median (puzzle, then set, then pace guide)', () => {
  const hist = (puzzleId, ms, i, set = 1) => ({ id: `h${puzzleId}${i}`, game: 'blockslide', set, puzzleId, metrics: { firstMoveMs: ms } });
  const solution = CHAIN.solution.map((m) => M(m.p, m.d));
  const slow = play(CHAIN, solution, { first: 12_000 });
  const history = [1, 2, 3].map((i) => hist(CHAIN.id, 3000, i));
  const r1 = coachPuzzle(slow, CHAIN, { history });
  const f = get(r1, 'latency-slow');
  assert.equal(f.data.scope, 'puzzle');
  assert.equal(f.data.medianMs, 3000);
  assert.match(f.detail, /12\.0 s, 4\.0x your median of 3\.0 s for this puzzle \(3 attempts\)/);

  const setHistory = [1, 2, 3].map((i) => hist(`other${i}`, 8000, i));
  assert.deepEqual(latencyBaseline(slow, setHistory), { ms: 8000, scope: 'set', n: 3 });
  assert.equal(latencyBaseline(slow, [hist('x', 1, 1, 2), hist('y', 1, 2, 2), hist('z', 1, 3, 2)]), null, 'other sets do not count');
  assert.equal(latencyBaseline(slow, [...history.slice(0, 2), { ...hist(CHAIN.id, 1, 9), id: slow.id }]), null, 'the attempt itself is excluded');

  const rushed = play(CHAIN, [M(1, 'R'), M(0, 'R'), M(0, 'L'), M(0, 'R'), M(1, 'U'), M(0, 'R'), M(0, 'R')], { first: 900 });
  assert.ok(ids(coachPuzzle(rushed, CHAIN, { history })).includes('latency-rushed'));
  assert.ok(ids(coachPuzzle(rushed, CHAIN, {})).includes('latency-rushed'), 'rushed without a baseline too');

  const quick = play(CHAIN, solution, { first: 1500 });
  assert.ok(ids(coachPuzzle(quick, CHAIN, { history })).includes('latency-quick'));

  const noBase = coachPuzzle(slow, CHAIN, { paceSec: 20 });
  assert.match(get(noBase, 'latency-slow').detail, /over half the 20 s pace guide/);
  assert.equal(get(coachPuzzle(play(CHAIN, solution), CHAIN, { paceSec: 20 }), 'latency').kind, 'info');
});

test('skip and time-out costs, and the next move when the skip was still on track', () => {
  const late = play(CHAIN, [M(1, 'R'), M(0, 'R')], { outcome: 'skipped', end: 70_000 });
  const rl = coachPuzzle(late, CHAIN, { paceSec: 20 });
  const f = get(rl, 'skip-late');
  assert.equal(f.severity, 3);
  assert.match(f.detail, /70\.0 s \(3\.5x the 20 s pace guide\)/);
  assert.match(get(rl, 'next-move').detail, /Move block A \(blue\) 1 up/);

  const early = play(CHAIN, [], { outcome: 'skipped', end: 2000 });
  assert.ok(ids(coachPuzzle(early, CHAIN, { paceSec: 20 })).includes('skip-early'));
  assert.ok(ids(coachPuzzle(early, CHAIN, { paceSec: 20 })).includes('next-move'), 'nothing played yet: still on track');

  const mid = play(CHAIN, [M(1, 'R'), M(1, 'L')], { outcome: 'skipped', end: 20_000 });
  const rm = coachPuzzle(mid, CHAIN, { paceSec: 20 });
  assert.equal(get(rm, 'skip-cost').kind, 'info');
  assert.ok(!ids(rm).includes('next-move'), 'off the line: no next move offered');
  assert.ok(!ids(rm).includes('wasted'), 'waste is only judged on solved puzzles');

  const out = play(CHAIN, [M(1, 'R')], { outcome: 'timeout', end: 15_000 });
  assert.match(get(coachPuzzle(out, CHAIN), 'timeout').detail, /15\.0 s into this puzzle/);
  for (const r of [rl, rm]) checkText(r);
});

test('robustness: illegal or corrupt moves in a log are ignored with a note', () => {
  const a = play(CHAIN, [M(0, 'U'), M(7, 'R'), M(1, 'X'), ...CHAIN.solution.map((m) => M(m.p, m.d))]);
  const res = coachPuzzle(a, CHAIN, { deep: true });
  assert.match(get(res, 'log').detail, /3 recorded moves could not be replayed/);
  assert.ok(!ids(res).includes('divergence'));
  const empty = coachPuzzle({ ...a, events: [], metrics: { ...a.metrics, firstMoveMs: null, totalMs: 0 } }, CHAIN);
  assert.ok(Array.isArray(empty.findings));
});

test('reversal counting and habit ranking', () => {
  const pairs = countReversals([{ p: 1, d: 'U' }, { p: 0, d: 'R' }, { p: 1, d: 'D' }, { p: 1, d: 'U' }, { p: 0, d: 'L' }]);
  assert.deepEqual(pairs.map(([a, b]) => [a.n, b.n]), [[1, 3], [2, 5]]);
  assert.deepEqual(countReversals([]), []);
  const f = (id, severity, kind = 'fix') => ({ id, severity, kind });
  const habits = topHabits([
    [f('wasted', 2), f('oscillation', 1)],
    [f('wasted', 1), f('skip-late', 3), f('optimal', 0, 'good')],
    [f('oscillation', 1), f('premature-ball', 1), f('unknown', 3)],
  ]);
  assert.deepEqual(habits.map((h) => h.id), ['wasted', 'skip-late', 'oscillation']);
  assert.equal(habits[0].count, 2);
  assert.equal(habits[0].of, 3);
  assert.equal(habits[0].label, HABITS.wasted.label);
  assert.deepEqual(topHabits([]), []);
});

test('run coaching: time per puzzle, skip policy, pace and top habits', () => {
  const sol = CHAIN.solution.map((m) => M(m.p, m.d));
  const sloppy = [M(1, 'R'), M(0, 'R'), M(0, 'L'), M(0, 'R'), M(1, 'U'), M(0, 'R'), M(0, 'R')];
  const attempts = [
    play(CHAIN, sol, { mode: 'exam', end: 15_000 }),
    play(CHAIN, sloppy, { mode: 'exam', end: 25_000 }),
    play(CHAIN, [M(1, 'R')], { mode: 'exam', outcome: 'skipped', end: 50_000 }),
    play(CHAIN, [], { mode: 'exam', outcome: 'skipped', end: 1500 }),
    play(CHAIN, sloppy, { mode: 'exam', end: 70_000 }),
    play(CHAIN, [M(1, 'R')], { mode: 'exam', outcome: 'timeout', end: 9000 }),
  ];
  const run = summarizeRun({ id: 'r', game: 'blockslide', set: 1, seed: 1, startedAt: 0, endedAt: 360_000, budgetMs: 360_000, attempts });
  const res = coachRun(run, attempts, { [CHAIN.id]: CHAIN }, { paceSec: 20 });
  const line = (id) => res.lines.find((l) => l.id === id);
  assert.deepEqual(res.lines.map((l) => l.id), ['time-per-puzzle', 'skip-policy', 'pace']);
  assert.match(line('time-per-puzzle').text, /Slowest: puzzle 5 at 70\.0 s/);
  const skip = line('skip-policy');
  assert.equal(skip.kind, 'fix');
  assert.match(skip.text, /Skipped too late on 1 puzzle \(#3 after 50\.0 s\)/);
  assert.match(skip.text, /Skipped too early on 1 puzzle \(#4 after 1\.5 s\)/);
  assert.match(skip.text, /Held on past 3x the pace guide on 1 puzzle \(#5 70\.0 s\); skipping at 2x would have freed 30\.0 s/);
  assert.match(skip.tip, /skip if you have no plan after about 10 s, and at the latest at 40 s/);
  const pace = line('pace');
  assert.equal(pace.data.atPace, 18);
  assert.equal(pace.kind, 'fix', '6 puzzles is far below the 18 at pace');
  assert.ok(res.habits.length >= 1 && res.habits.length <= 3);
  assert.ok(res.habits.some((h) => h.id === 'wasted'));
  assert.equal(res.perPuzzle.length, 6);

  // A tidy run on pace.
  const tidy = Array.from({ length: 18 }, () => play(CHAIN, sol, { mode: 'exam', first: 2000, end: 19_000 }));
  const tidyRun = summarizeRun({ id: 't', game: 'blockslide', set: 1, seed: 1, startedAt: 0, endedAt: 360_000, budgetMs: 360_000, attempts: tidy });
  const tr = coachRun(tidyRun, tidy, new Map([[CHAIN.id, CHAIN]]), { paceSec: 20 });
  assert.equal(tr.lines.find((l) => l.id === 'pace').kind, 'good');
  assert.equal(tr.lines.find((l) => l.id === 'skip-policy').kind, 'good');
  assert.deepEqual(tr.habits, []);

  const none = coachRun({ ...tidyRun, puzzles: [] }, [], {});
  assert.equal(none.lines[0].id, 'empty');
});

test('every shipped puzzle in sets 1 to 3: the stored line coaches as optimal', () => {
  for (const s of [1, 2, 3]) {
    for (const p of loadSet(s).puzzles) {
      const a = play(p, p.solution.map((m) => M(m.p, m.d)), { set: s });
      const res = coachPuzzle(a, p, { deep: true });
      assert.ok(ids(res).includes('optimal'), p.id);
      assert.equal(res.findings.filter((f) => f.kind === 'fix').length, 0, p.id);
    }
  }
});

test('deep coaching on a set 5 puzzle stays inside its search budget', () => {
  const p = loadSet(5).puzzles[9];
  const [first, ...rest] = p.solution;
  const other = { p: first.p, d: first.d };
  // Play the first move, take it straight back, then the stored line: waste of 2.
  const back = { U: 'D', D: 'U', L: 'R', R: 'L' }[other.d];
  const a = play(p, [M(other.p, other.d), M(other.p, back), ...p.solution.map((m) => M(m.p, m.d))], { set: 5 });
  const t0 = Date.now();
  const res = coachPuzzle(a, p, { deep: true, maxStates: 100_000 });
  assert.ok(Date.now() - t0 < 15_000);
  assert.equal(get(res, 'wasted').data.wasted, 2);
  assert.equal(get(res, 'divergence').data.move, 2);
  assert.ok(rest.length > 0);
});
