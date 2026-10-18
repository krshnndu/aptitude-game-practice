// Operator Switch: the pure model (state.js) and the independent solver (solver.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOp, undoOp, invertOp, opBetween, composeOps, runChain, chainResult, identityOp, isOp, isArrangement,
  fixedPoints, isInvolution, chainMistakes, hiddenMistakes, diagnose, correctValue, createSession, examPoints,
  wrongPenalty, hiddenRows,
} from '../js/games/operatorswitch/state.js';
import { solvePuzzle, validatePuzzle, allOps, questionKey } from '../js/games/operatorswitch/solver.js';
import { createRng } from '../js/core/rng.js';

const forward = (start, ops, options, answer) => ({ id: 't', kind: 'forward', n: start.length, start, chains: [ops], hidden: null, target: null, options, answer, optimal: 1 });

test('rule: 3142 on [A,B,C,D] gives [C,A,D,B] (output slot i takes input position digit i)', () => {
  assert.equal(applyOp('ABCD', '3142'), 'CADB');
  assert.deepEqual(applyOp(['A', 'B', 'C', 'D'], '3142'), ['C', 'A', 'D', 'B']);
  assert.equal(applyOp('CSTD', '3142'), 'TCDS');
});

test('undo and inverse reverse a box; opBetween recovers it', () => {
  for (const op of allOps(4)) {
    assert.equal(undoOp(applyOp('CSTD', op), op), 'CSTD');
    assert.equal(applyOp(applyOp('CSTD', op), invertOp(op)), 'CSTD');
    assert.equal(opBetween('CSTD', applyOp('CSTD', op)), op);
  }
  assert.equal(invertOp('3142'), '2413');
  assert.equal(isInvolution('2143'), true);
  assert.equal(isInvolution('3142'), false);
});

test('composeOps equals applying the boxes one after the other', () => {
  const rng = createRng(11);
  const ops = allOps(5);
  for (let i = 0; i < 200; i++) {
    const a = rng.pick(ops);
    const b = rng.pick(ops);
    assert.equal(applyOp('CSTDH', composeOps(a, b)), applyOp(applyOp('CSTDH', a), b));
  }
});

test('runChain rows and validity helpers', () => {
  assert.deepEqual(runChain('1234', ['3142', '2413']), ['1234', '3142', '1234']);
  assert.equal(chainResult('CSTD', ['3142', '3142']), applyOp('TCDS', '3142'));
  assert.equal(identityOp(5), '12345');
  assert.equal(isOp('3142', 4), true);
  assert.equal(isOp('3144', 4), false);
  assert.equal(isOp('31425', 4), false);
  assert.equal(isArrangement('CSTD', 4), true);
  assert.equal(isArrangement('CSTX', 4), false);
  assert.equal(fixedPoints('1342'), 1);
});

test('misreadings: applied to the start row, inverse, reversed order, dropped box', () => {
  const start = 'CSTD';
  const ops = ['3142', '4312'];
  const right = chainResult(start, ops);
  const m = Object.fromEntries(chainMistakes(start, ops).map((x) => [`${x.kind}${x.box ?? ''}`, x.value]));
  assert.equal(m.original, applyOp(start, '4312'), 'only the last box applied to the start');
  assert.equal(m.inverse, chainResult(start, [invertOp('3142'), invertOp('4312')]));
  assert.equal(m.reversed, chainResult(start, ['4312', '3142']));
  assert.equal(m.dropped2, applyOp(start, '3142'));
  for (const v of Object.values(m)) assert.notEqual(v, right);
  // Single box: only the inverse reading applies.
  assert.deepEqual(chainMistakes(start, ['3142']).map((x) => x.kind), ['inverse']);
  assert.deepEqual(chainMistakes(start, ['2143']), [], 'a self-inverse box has no distinct inverse reading');
});

test('diagnose names the misreading behind a wrong arrangement, or a slip, or other', () => {
  const start = 'CSTD';
  const ops = ['3142', '4312'];
  const right = chainResult(start, ops);
  const p = forward(start, ops, [right], 0);
  assert.equal(diagnose(p, right).primary, null);
  assert.equal(diagnose(p, applyOp(start, '4312')).primary, chainMistakes(start, ops).find((x) => x.value === applyOp(start, '4312')).kind);
  assert.ok(diagnose(p, chainResult(start, ops.map(invertOp))).kinds.includes('inverse'));
  const slip = right[1] + right[0] + right.slice(2);
  const named = new Set(chainMistakes(start, ops).map((x) => x.value));
  if (!named.has(slip)) assert.equal(diagnose(p, slip).primary, 'slip');
  // A three-slot rotation of the answer that no misreading produces is 'other'.
  const rot = right[1] + right[2] + right[0] + right[3];
  if (!named.has(rot)) assert.deepEqual([diagnose(p, rot).primary, diagnose(p, rot).slots], ['other', [0, 1, 2]]);
  else assert.ok(diagnose(p, rot).primary !== 'other');
});

test('hidden puzzles: rows around the gap, the unique box, and gap misreadings', () => {
  const start = 'CSTD';
  const ops = ['3142', '2341', '4312'];
  const target = chainResult(start, ops);
  const p = { id: 'h', kind: 'hidden', n: 4, start, chains: [['3142', null, '4312']], hidden: { chain: 0, at: 1 }, target, options: ['2341'], answer: 0, optimal: 1 };
  const { before, after } = hiddenRows(p);
  assert.equal(before, applyOp(start, '3142'));
  assert.equal(applyOp(after, '4312'), target);
  assert.equal(correctValue(p), '2341');
  const kinds = hiddenMistakes(p).map((m) => m.kind);
  assert.ok(kinds.includes('hidden-inverse'));
  assert.ok(kinds.includes('hidden-direct'));
  assert.ok(kinds.includes('hidden-skip-before'));
  assert.ok(kinds.includes('hidden-skip-after'));
  assert.ok(kinds.includes('hidden-undo-forward'));
  const inv = hiddenMistakes(p).find((m) => m.kind === 'hidden-inverse').value;
  assert.equal(inv, invertOp('2341'));
  assert.equal(diagnose(p, inv).primary, 'hidden-inverse');
});

test('solver agrees with the step-by-step model on random chains (independent code paths)', () => {
  const rng = createRng(2024);
  for (let i = 0; i < 300; i++) {
    const n = rng.pick([4, 5]);
    const start = rng.shuffle(['C', 'S', 'T', 'D', 'H']).slice(0, n).join('');
    const ops = Array.from({ length: rng.int(1, 4) }, () => rng.shuffle([...identityOp(n)]).join(''));
    const right = chainResult(start, ops);
    const res = solvePuzzle(forward(start, ops, [right, start], 0));
    assert.equal(res.value, right);
    // Hidden version: the solver's brute force over all n! boxes finds exactly the true one.
    const at = rng.int(0, ops.length - 1);
    const hp = { kind: 'hidden', n, start, chains: [ops.map((o, k) => (k === at ? null : o))], hidden: { chain: 0, at }, target: right, options: [ops[at]], answer: 0 };
    const hr = solvePuzzle(hp);
    assert.equal(hr.spaceMatches, 1);
    assert.equal(hr.value, ops[at]);
    assert.equal(correctValue(hp), ops[at]);
  }
});

test('allOps lists every permutation once', () => {
  assert.equal(allOps(4).length, 24);
  assert.equal(new Set(allOps(5)).size, 120);
});

test('validator catches broken puzzles', () => {
  const good = forward('CSTD', ['3142'], ['TCDS', 'SDCT', 'TDCS', 'CTDS'], 0);
  assert.deepEqual(validatePuzzle(good), []);
  assert.match(validatePuzzle({ ...good, answer: 1 }).join(), /stored answer/);
  assert.match(validatePuzzle({ ...good, options: ['TCDS', 'TCDS', 'SDCT', 'CTDS'] }).join(), /duplicate options/);
  assert.match(validatePuzzle({ ...good, chains: [['1234']] }).join(), /identity/);
  assert.match(validatePuzzle({ ...good, chains: [['3144']] }).join(), /not a permutation/);
  assert.match(validatePuzzle({ ...good, options: ['TCDS', 'SDCT', 'TDCS'] }).join(), /options outside/);
  assert.match(validatePuzzle({ ...good, start: 'CSTX' }).join(), /start/);
  const twin = { ...good, kind: 'twin', chains: [['3142'], ['2413']] };
  assert.match(validatePuzzle(twin).join(), /do not end in the same arrangement/);
  const hidden = { ...good, kind: 'hidden', chains: [['3142', '2413']], hidden: { chain: 0, at: 1 }, target: 'TCDS', options: ['2413', '3142', '4321', '1342'] };
  assert.match(validatePuzzle(hidden).join(), /not blank/);
  assert.equal(questionKey(good), questionKey({ ...good, options: ['x'] }), 'options are not part of the question key');
});

test('session: practice crosses out wrong picks; efficiency is 1 / answers', () => {
  const p = forward('CSTD', ['3142'], ['SDCT', 'TCDS', 'TDCS', 'CTDS'], 1);
  const s = createSession(p, { mode: 'practice', maxHints: 1 });
  assert.deepEqual(s.answer(0), { ok: true, correct: false });
  assert.equal(s.isCrossed(0), true);
  assert.equal(s.canAnswer(0), false, 'a crossed option cannot be picked again');
  assert.equal(s.answer(0).ok, false);
  assert.equal(s.status, 'playing');
  assert.equal(s.useHint(), true);
  assert.equal(s.useHint(), false, 'no more hints than available');
  assert.deepEqual(s.answer(1), { ok: true, correct: true });
  assert.equal(s.status, 'correct');
  assert.equal(s.efficiency(), 0.5);
  assert.equal(s.outcome(), 'solved');
  assert.equal(s.answer(2).ok, false, 'locked after solving');
  assert.equal(s.skip(), false);
});

test('session: exam answers are final, no hints, points with the guessing penalty', () => {
  const p = forward('CSTD', ['3142'], ['SDCT', 'TCDS', 'TDCS', 'CTDS'], 1);
  const s = createSession(p, { mode: 'exam', maxHints: 3 });
  assert.equal(s.canHint(), false);
  s.answer(3);
  assert.equal(s.status, 'wrong');
  assert.equal(s.answer(1).ok, false);
  assert.equal(s.outcome(), 'skipped', 'core recorder has no wrong outcome');
  assert.equal(s.efficiency(), 0);
  assert.equal(s.examPoints(), -1 / 3);
  const k = createSession(p, { mode: 'exam' });
  k.skip();
  assert.equal(k.examPoints(), 0);
  const t = createSession(p, { mode: 'exam' });
  assert.equal(t.timeout(), true);
  assert.equal(t.outcome(), 'timeout');
  assert.equal(examPoints('correct', 6), 1);
  assert.equal(wrongPenalty(6), 0.2);
  // Blind guessing averages zero: 1/k chance of +1, (k-1)/k chance of -1/(k-1).
  for (const k2 of [4, 5, 6]) assert.ok(Math.abs(1 / k2 - ((k2 - 1) / k2) * wrongPenalty(k2)) < 1e-12);
});
