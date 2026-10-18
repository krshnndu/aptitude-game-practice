// Digit Equation: equation model, evaluation rules and the headless game session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePuzzle, evalValues, evalLeftToRight, checkFill, numberValue, equationText, createGame, trayCounts, fillUsesTray,
} from '../js/games/digitequation/state.js';

const P = (tokens, tray, extra = {}) => ({ id: 'hand', tokens, tray: tray.map(([d, n = 1]) => ({ d, n })), blanks: tokens.join('').split('_').length - 1, ...extra });

test('parse: slots in reading order, leading and units flags, sides', () => {
  const parsed = parsePuzzle(P(['4_', 'x', '3', '=', '1_6'], [[2, 2]]));
  assert.equal(parsed.slots.length, 2);
  assert.deepEqual(parsed.slots.map((s) => s.label), ['A', 'B']);
  assert.equal(parsed.slots[0].units, true);
  assert.equal(parsed.slots[0].leading, false);
  assert.equal(parsed.slots[1].place, 1);
  assert.equal(parsed.numbers[2].side, 'R');
  assert.equal(parsed.left.length, 3);
  assert.equal(parsed.hasDivision, false);
});

test('parse: rejects malformed equations', () => {
  assert.throws(() => parsePuzzle(P(['4', '+', '=', '4'], [])));
  assert.throws(() => parsePuzzle(P(['4', '+', '4'], [])));
  assert.throws(() => parsePuzzle(P(['4', '=', '4', '=', '4'], [])));
  assert.throws(() => parsePuzzle(P(['4', '^', '2', '=', '16'], [])));
});

test('evaluation: x and / before + and -, left to right', () => {
  assert.equal(evalValues([3, 7, 4], ['+', 'x']).value, 31);
  assert.equal(evalValues([20, 2, 3], ['-', 'x']).value, 14);
  assert.equal(evalValues([48, 4, 3], ['/', 'x']).value, 36);
  assert.equal(evalValues([10, 4, 3], ['-', '-']).value, 3);
  assert.equal(evalValues([2, 3, 4, 5], ['x', '+', 'x']).value, 26);
  assert.equal(evalLeftToRight([3, 7, 4], ['+', 'x']).value, 40);
});

test('evaluation: division must be exact and never by zero', () => {
  assert.deepEqual(evalValues([7, 2], ['/']), { ok: false, error: 'not-exact' });
  assert.deepEqual(evalValues([7, 0], ['/']), { ok: false, error: 'div-zero' });
  // 12 / 8 x 2 is not exact at the first step even though 12 x 2 / 8 = 3 would be.
  assert.equal(evalValues([12, 8, 2], ['/', 'x']).ok, false);
});

test('numbers: no leading zero for 2+ digits, single 0 is fine', () => {
  const parsed = parsePuzzle(P(['_5', '+', '_', '=', '5'], [[0, 2]]));
  assert.deepEqual(numberValue(parsed, 0, [0, 0]), { ok: false, error: 'leading-zero' });
  assert.deepEqual(numberValue(parsed, 1, [0, 0]), { ok: true, value: 0 });
  assert.equal(checkFill(parsed, [0, 0]).error, 'leading-zero');
});

test('checkFill: complete, true and false fills', () => {
  const parsed = parsePuzzle(P(['4_', 'x', '3', '=', '1_6'], [[2, 2]]));
  assert.equal(checkFill(parsed, [2, null]).complete, false);
  assert.deepEqual(checkFill(parsed, [2, 2]), { complete: true, valid: true, true: true, left: 126, right: 126, error: null });
  const wrong = checkFill(parsed, [3, 2]);
  assert.equal(wrong.true, false);
  assert.equal(wrong.left, 129);
  assert.equal(equationText(parsed, [2, null]), '4[2] × 3 = 1[B]6');
  assert.equal(equationText(parsed, [2, 2], { brackets: false }), '42 × 3 = 126');
});

test('tray counts and fills', () => {
  const tray = [{ d: 2, n: 2 }, { d: 5, n: 1 }];
  assert.equal(trayCounts(tray)[2], 2);
  assert.equal(fillUsesTray([2, 2], tray), true);
  assert.equal(fillUsesTray([5, 5], tray), false);
});

test('game session: place, auto-advance, swap, counts, clear, reset', () => {
  const g = createGame(P(['4_', 'x', '3', '=', '1_6'], [[2, 1], [5], [7]]));
  assert.equal(g.selected, 0);
  assert.equal(g.place(7).ok, true);
  assert.equal(g.selected, 1, 'moves to the next empty blank');
  assert.equal(g.left(7), 0);
  assert.deepEqual(g.place(7), { ok: false, reason: 'none-left' });
  g.select(0);
  const swap = g.place(2);
  assert.equal(swap.replaced, 7);
  assert.equal(g.left(7), 1, 'swapped tile goes back');
  assert.equal(g.placements, 2);
  assert.equal(g.clear(0), true);
  assert.equal(g.fill[0], null);
  g.place(5, 1);
  assert.equal(g.reset(), true);
  assert.deepEqual(g.fill, [null, null]);
  assert.equal(g.placements, 3, 'reset keeps the placement count');
});

test('game session: wrong check counts, true check solves, any true fill is accepted', () => {
  const g = createGame(P(['_', '+', '_', '=', '9'], [[4], [5], [3], [6]]));
  g.place(4);
  assert.equal(g.check().error, 'incomplete');
  assert.equal(g.wrongChecks, 0, 'incomplete checks do not count');
  g.place(3);
  const r = g.check();
  assert.equal(r.ok, false);
  assert.equal(g.wrongChecks, 1);
  g.select(0);
  g.place(6);
  assert.equal(g.check().ok, true, '6 + 3 is accepted even though 4 + 5 also works');
  assert.equal(g.status, 'solved');
  assert.equal(g.place(4).ok, false, 'no changes after solving');
});

test('game session: skip is final', () => {
  const g = createGame(P(['_', '+', '1', '=', '3'], [[2], [5]]));
  assert.equal(g.skip(), true);
  assert.equal(g.skip(), false);
  assert.equal(g.place(2).ok, false);
  assert.equal(g.status, 'skipped');
});
