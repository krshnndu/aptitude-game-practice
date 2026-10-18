// Digit Equation: the explanation engine reaches the answer with computed reasons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainPuzzle, isolateNumber, checkText, resultSummary } from '../js/games/digitequation/explain.js';
import { parsePuzzle, checkFill } from '../js/games/digitequation/state.js';
import { SET_CONFIGS } from '../js/games/digitequation/gen.js';
import { loadSet } from '../tools/digitequation-verify.mjs';

const P = (tokens, tray, extra = {}) => ({ id: 'hand', tokens, tray: tray.map(([d, n = 1]) => ({ d, n })), ...extra });
const DASH_CODES = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d];
const DASHES = { test: (s) => [...s].some((ch) => DASH_CODES.includes(ch.codePointAt(0))) };

test('last-digit test pins the units blank: 3 x _ ends in 6, so the blank is 2', () => {
  const ex = explainPuzzle(P(['4_', 'x', '3', '=', '1_6'], [[2, 2], [5], [7]]));
  const first = ex.steps[0];
  assert.equal(first.technique, 'last-digit');
  assert.match(first.text, /\[A\] × 3 must end in 6/);
  assert.match(first.text, /Only A = 2 fits \(2 × 3 = 6, which ends in 6\)/);
  assert.deepEqual(first.fixed, [{ slot: 0, d: 2 }]);
  const second = ex.steps[1];
  assert.equal(second.technique, 'isolate');
  assert.match(second.text, /42 × 3 = 126/);
  assert.deepEqual(ex.answer, [2, 2]);
});

test('undo the operations: divide both sides', () => {
  const ex = explainPuzzle(P(['3', 'x', '_', '=', '21'], [[4], [7], [9]]));
  const step = ex.steps.find((s) => s.technique === 'isolate');
  assert.match(step.text, /Divide both sides by 3: \[A\] = 21 ÷ 3 = 7/);
});

test('precedence is called out and the estimate rules out big tiles', () => {
  const ex = explainPuzzle(P(['_', '+', '7', 'x', '_', '=', '29'], [[1], [4], [5], [8], [9]]));
  assert.equal(ex.steps[0].technique, 'precedence');
  assert.match(ex.steps[0].text, /\[A\] \+ \(7 × \[B\]\)/);
  assert.deepEqual(ex.answer, [1, 4]);
  assert.ok(ex.tips.some((t) => t.id === 'precedence' && /left to right gives 32 instead of 29/.test(t.text)));
});

test('isolate a divisor and report a non-exact tile', () => {
  const parsed = parsePuzzle(P(['84', '/', '_', '=', '14'], [[6]]));
  const ok = isolateNumber(parsed, [null], 1);
  assert.equal(ok.ok, true);
  assert.equal(ok.needed, 6);
  const parsed2 = parsePuzzle(P(['7', 'x', '_', '=', '30'], [[4]]));
  const bad = isolateNumber(parsed2, [null], 1);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /30 is not a multiple of 7/);
});

test('check text: casting out nines without division, multiplying back with it', () => {
  const p1 = parsePuzzle(P(['42', 'x', '3', '=', '126'], []));
  assert.match(checkText(p1, []), /casting out nines/);
  const p2 = parsePuzzle(P(['84', '/', '6', '=', '14'], []));
  assert.match(checkText(p2, []), /84 ÷ 6 = 14 because 6 × 14 = 84/);
});

test('leading zero step drops 0 from a leading blank', () => {
  const ex = explainPuzzle(P(['_5', '+', '1', '=', '16'], [[0], [1], [3]]));
  assert.equal(ex.steps[0].technique, 'leading-zero');
  assert.deepEqual(ex.answer, [1]);
});

test('non-unique puzzles: explanation still ends on a true answer and lists the others', () => {
  const ex = explainPuzzle(P(['_', '+', '_', '=', '9'], [[3], [4], [5], [6]]));
  assert.equal(ex.unique, false);
  assert.equal(ex.solved, true);
  assert.equal(ex.others.length, 3);
});

for (const cfg of SET_CONFIGS) {
  test(`every shipped set ${cfg.set} puzzle: steps only fix correct digits and end on the answer`, () => {
    for (const p of loadSet(cfg.set).puzzles) {
      const ex = explainPuzzle(p);
      assert.ok(ex.solved, p.id);
      assert.deepEqual(ex.answer, p.answer, p.id);
      for (const s of ex.steps) {
        for (const f of s.fixed) assert.equal(f.d, p.answer[f.slot], `${p.id}: ${s.text}`);
        assert.ok(s.text.length > 10);
        assert.ok(!DASHES.test(s.text), `${p.id} has a Unicode dash`);
        assert.ok(!/undefined|NaN|Infinity/.test(s.text), `${p.id}: ${s.text}`);
      }
      assert.ok(checkFill(ex.parsed, ex.answer).true);
      assert.ok(ex.tips.length >= 2);
      assert.ok(!/undefined|NaN/.test(ex.check), ex.check);
      if (cfg.set === 5) assert.ok(ex.tips.some((t) => t.id === 'decoys') && ex.tips.some((t) => t.id === 'multiply-back'));
    }
  });
}

test('result summary', () => {
  assert.match(resultSummary({ placements: 2, blanks: 2, solved: true }), /efficiency 100%\. Clean solve/);
  assert.match(resultSummary({ placements: 4, blanks: 2, solved: true, wrongChecks: 1 }), /50%\. 1 wrong check/);
  assert.match(resultSummary({ placements: 0, blanks: 3, solved: false }), /score 0/);
});
