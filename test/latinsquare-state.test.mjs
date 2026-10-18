// Headless checks of the Latin Square puzzle model and game session used by play.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, parsePuzzle, gridRows, isConsistent, examPoints, examRunScore, cellLabel, BLANK, SYMBOLS } from '../js/games/latinsquare/state.js';
import { efficiency } from '../js/core/score.js';
import { TUTORIAL_PUZZLE } from '../js/games/latinsquare/stream.js';
import { loadSet } from '../tools/latinsquare-verify.mjs';

const TWO = loadSet(5).puzzles[0]; // two ? cells

test('symbols: distinct ids, letters and shapes', () => {
  assert.equal(new Set(SYMBOLS.map((s) => s.id)).size, SYMBOLS.length);
  assert.equal(new Set(SYMBOLS.map((s) => s.letter)).size, SYMBOLS.length);
});

test('parsePuzzle round-trips rows and rejects bad input', () => {
  const P = parsePuzzle(TUTORIAL_PUZZLE);
  assert.deepEqual(gridRows(P.n, P.grid, P.symbols), TUTORIAL_PUZZLE.rows);
  assert.ok(isConsistent(P.n, P.grid));
  assert.equal(P.grid[P.targets[0]], BLANK);
  assert.throws(() => parsePuzzle({ ...TUTORIAL_PUZZLE, rows: ['CS.D', '.TD.', 'T.C.'] }), /rows/);
  assert.throws(() => parsePuzzle({ ...TUTORIAL_PUZZLE, rows: ['CS.H', '.TD.', 'T.C.', 'DC.T'] }), /not one of/);
  assert.throws(() => parsePuzzle({ ...TUTORIAL_PUZZLE, targets: [[0, 0]] }), /not blank/);
  assert.equal(cellLabel(4, 9), '(3,2)');
});

test('practice: a wrong pick is ruled out, a right pick solves; efficiency = targets / picks', () => {
  const g = createGame(TUTORIAL_PUZZLE, { mode: 'practice' });
  const ans = g.parsed.answers[0];
  const wrong = (ans + 1) % 4;
  const r1 = g.pick(wrong);
  assert.deepEqual(r1, { ok: false, target: 0, done: false });
  assert.ok(g.isRuledOut(0, wrong));
  assert.equal(g.pick(wrong), null, 'a ruled-out symbol cannot be picked again');
  const r2 = g.pick(ans);
  assert.equal(r2.ok, true);
  assert.equal(g.status, 'solved');
  assert.equal(g.pickCount, 2);
  assert.equal(efficiency(1, g.pickCount, true), 0.5);
  assert.equal(g.pick(ans), null, 'no picks after the end');
  assert.equal(g.valueAt(g.parsed.targets[0]), ans);
});

test('exam: answers are final; any wrong answer makes the puzzle wrong', () => {
  const g = createGame(TWO, { mode: 'exam' });
  const [a0, a1] = g.parsed.answers;
  assert.equal(g.activeTarget, 0);
  const r = g.pick((a0 + 1) % g.n);
  assert.equal(r.ok, false);
  assert.equal(g.activeTarget, 1, 'moves on to the next ? cell');
  assert.equal(g.pick(a0, 0), null, 'cannot change a final answer');
  g.pick(a1);
  assert.equal(g.status, 'wrong');
  assert.equal(g.correctCount, 1);
  assert.equal(g.wrongCount, 1);
});

test('exam: both right is solved; selecting a target answers it first', () => {
  const g = createGame(TWO, { mode: 'exam' });
  const [a0, a1] = g.parsed.answers;
  g.select(g.parsed.targets[1]);
  assert.equal(g.activeTarget, 1);
  g.pick(a1);
  assert.equal(g.activeTarget, 0);
  g.pick(a0);
  assert.equal(g.status, 'solved');
});

test('selecting a non-target cell keeps the next open target active; skip ends the game', () => {
  const g = createGame(TWO, { mode: 'exam' });
  g.select(0);
  assert.equal(g.selected, 0);
  assert.equal(g.activeTarget, 0);
  assert.equal(g.select(999), 0, 'out of range ignored');
  assert.ok(g.skip());
  assert.equal(g.status, 'skipped');
  assert.equal(g.skip(), false);
  assert.equal(g.pick(0), null);
});

test('exam points: +1 right, -1/(n-1) wrong, 0 skip; blind guessing averages 0; run score floors at 0', () => {
  for (const n of [4, 5, 6]) {
    assert.equal(examPoints('solved', n), 1);
    assert.equal(examPoints('skipped', n), 0);
    assert.equal(examPoints('timeout', n), 0);
    const guess = (1 / n) * examPoints('solved', n) + ((n - 1) / n) * examPoints('wrong', n);
    assert.ok(Math.abs(guess) < 1e-12, `n ${n}`);
  }
  assert.equal(examRunScore(['solved', 'solved', 'wrong'], 5), 1.75);
  assert.equal(examRunScore(['wrong', 'wrong'], 4), 0);
});
