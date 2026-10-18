// Digit Equation: brute-force solver against hand-built puzzles and the independent verifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, hintTarget } from '../js/games/digitequation/solver.js';
import { configFor, generateFresh } from '../js/games/digitequation/gen.js';
import { bruteForce, evalText } from '../tools/digitequation-verify.mjs';

const P = (tokens, tray) => ({ id: 'hand', tokens, tray: tray.map(([d, n = 1]) => ({ d, n })) });

test('unique: 4_ x 3 = 1_6 needs both 2 tiles', () => {
  const res = solve(P(['4_', 'x', '3', '=', '1_6'], [[2, 2], [5], [7]]));
  assert.equal(res.unique, true);
  assert.deepEqual(res.solutions, [[2, 2]]);
  const one2 = solve(P(['4_', 'x', '3', '=', '1_6'], [[2, 1], [5], [7]]));
  assert.equal(one2.count, 0, 'with a single 2 tile there is no answer');
});

test('unique under precedence: _ + 7 x _ = 29', () => {
  const res = solve(P(['_', '+', '7', 'x', '_', '=', '29'], [[1], [4], [5], [8], [9]]));
  assert.deepEqual(res.solutions, [[1, 4]]);
});

test('multiple answers are all found and the puzzle is marked not unique', () => {
  const res = solve(P(['_', '+', '_', '=', '9'], [[3], [4], [5], [6]]));
  assert.equal(res.count, 4);
  assert.equal(res.unique, false);
});

test('no answer from the tray', () => {
  assert.equal(solve(P(['_', '+', '1', '=', '9'], [[1], [2]])).count, 0);
});

test('division answers must be exact', () => {
  const res = solve(P(['_4', '/', '_', '=', '8'], [[2], [3], [5], [6], [7]]));
  // 24 / 3 = 8 works; 64 / 8 would need an 8 tile; every other pair leaves a remainder or misses 8.
  assert.deepEqual(res.solutions, [[2, 3]]);
});

test('independent evaluator agrees on precedence and exactness', () => {
  assert.equal(evalText('3+7*4'), 31);
  assert.equal(evalText('48/4*3'), 36);
  assert.equal(evalText('7/2'), null);
  assert.equal(evalText('05+1'), null);
  assert.equal(evalText('20-2*3'), 14);
});

test('solver and the independent brute force agree on 60 fresh puzzles', () => {
  for (const setNo of [1, 2, 3, 4, 5]) {
    for (let k = 0; k < 12; k++) {
      const p = generateFresh(setNo, 1000 + setNo * 100 + k);
      assert.ok(p, `set ${setNo} seed ${k}`);
      const a = solve(p).solutions.map((s) => s.join(''));
      const b = bruteForce(p.tokens, p.tray).map((s) => s.join(''));
      assert.deepEqual(a.sort(), b.sort(), p.tokens.join(' '));
      assert.equal(p.blanks, configFor(setNo).blanks);
    }
  }
});

test('hint target: first wrong or empty blank of the matching answer', () => {
  const p = P(['4_', 'x', '3', '=', '1_6'], [[2, 2], [5], [7]]);
  assert.deepEqual(hintTarget(p, [null, null]).slot, 0);
  assert.deepEqual(hintTarget(p, [2, null]), { slot: 1, digit: 2, answer: [2, 2] });
  assert.deepEqual(hintTarget(p, [5, 2]).slot, 0);
  assert.equal(hintTarget(p, [2, 2]), null);
});
