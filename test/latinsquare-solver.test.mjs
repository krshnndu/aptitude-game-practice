// Latin Square deduction engine: rules, rounds (chain depth), justifications, completion search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePuzzle, BLANK, isLatinSquare } from '../js/games/latinsquare/state.js';
import { deduce, chainFor, cellDepth, countCompletions, possibleValues } from '../js/games/latinsquare/solver.js';
import { TUTORIAL_PUZZLE } from '../js/games/latinsquare/stream.js';

const SYMS4 = ['circle', 'square', 'triangle', 'diamond'];
const make = (rows, targets = [], answers = []) => ({ id: 'hand', n: rows.length, symbols: SYMS4.slice(0, rows.length), rows, targets, answers });

// (2,3) is the ? cell: row 2 has square, column 3 has diamond, so circle and triangle are both left
// and one helper cell has to be filled first. Found with the generator; the tests below pin it down.
const CHAIN = make(['S.D.', '...S', 'CS..', 'DT..'], [[1, 2]], ['C']);

test('naked single: the tutorial ? cell is forced in round 1 from its row and column', () => {
  const P = parsePuzzle(TUTORIAL_PUZZLE);
  const ded = deduce(P.n, P.grid);
  const t = P.targets[0];
  assert.equal(ded.round[t], 1);
  assert.equal(ded.why[t].rule, 'naked');
  assert.equal(ded.value[t], P.answers[0]);
  // Every source is a given (round 0), one per ruled-out symbol.
  assert.equal(ded.why[t].sources.length, P.n - 1);
  assert.deepEqual(ded.why[t].deps, []);
});

test('hidden single: a symbol with one open place in its row is forced, naked singles alone are not enough', () => {
  const p = make(['....', '.C..', '..C.', '...C']);
  const P = parsePuzzle(p);
  const ded = deduce(P.n, P.grid);
  assert.equal(ded.round[0], 1);
  assert.equal(ded.value[0], 0, 'circle');
  assert.match(ded.why[0].rule, /^hidden-/);
  assert.equal(cellDepth(P.n, P.grid, 0, { rules: ['naked'] }), Infinity);
});

test('chain: the ? cell needs one helper cell first (depth 2), and the chain lists it before the target', () => {
  const P = parsePuzzle(CHAIN);
  const ded = deduce(P.n, P.grid);
  const t = P.targets[0];
  assert.equal(ded.round[t], 2);
  assert.equal(ded.value[t], P.answers[0]);
  const chain = chainFor(ded, P.targets);
  assert.equal(chain.length, 2);
  assert.equal(chain[chain.length - 1], t);
  assert.equal(ded.round[chain[0]], 1);
  assert.ok(ded.why[t].deps.includes(chain[0]), 'the target cites the helper');
  // Hand check of the first round: row 2 has square, column 3 has diamond, so the ? is not forced yet.
  assert.equal(cellDepth(P.n, P.grid, t, { maxRounds: 1 }), Infinity);
});

test('rounds: every derived cell cites only cells from earlier rounds, and at least one from the round before', () => {
  const P = parsePuzzle(CHAIN);
  const ded = deduce(P.n, P.grid);
  for (let x = 0; x < P.n * P.n; x++) {
    if (ded.round[x] <= 0) continue;
    for (const d of ded.why[x].deps) assert.ok(ded.round[d] < ded.round[x]);
    if (ded.round[x] > 1) assert.ok(ded.why[x].deps.some((d) => ded.round[d] === ded.round[x] - 1));
  }
});

test('deduce places only values that agree with the unique completion', () => {
  const P = parsePuzzle(CHAIN);
  const ded = deduce(P.n, P.grid);
  for (let x = 0; x < P.n * P.n; x++) {
    if (ded.round[x] > 0) assert.deepEqual(possibleValues(P.n, P.grid, x), [ded.value[x]]);
  }
});

test('a fully forced grid ends as a Latin square', () => {
  const P = parsePuzzle(TUTORIAL_PUZZLE);
  const ded = deduce(P.n, P.grid);
  if (ded.round.every((r) => r >= 0)) assert.ok(isLatinSquare(P.n, ded.value));
  else assert.ok(ded.value.some((v) => v === BLANK));
});

test('completion search: known counts of Latin squares', () => {
  assert.equal(countCompletions(3, new Int8Array(9).fill(BLANK)), 12);
  assert.equal(countCompletions(4, new Int8Array(16).fill(BLANK)), 576);
  assert.equal(countCompletions(4, new Int8Array(16).fill(BLANK), 10), 10, 'limit stops the search');
});

test('completion search: a clash has no completion and every value is impossible', () => {
  const g = new Int8Array(16).fill(BLANK);
  g[0] = 0;
  g[1] = 0;
  assert.equal(countCompletions(4, g), 0);
  assert.deepEqual(possibleValues(4, g, 5), []);
});

test('possibleValues: an open cell with two options in an unconstrained grid', () => {
  const P = parsePuzzle(make(['CS..', '....', '....', '....']));
  assert.deepEqual(possibleValues(P.n, P.grid, 2), [2, 3]);
});
