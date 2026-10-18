import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, solveBoard, replay, hint } from '../js/games/blockslide/solver.js';
import { makeBoard, isSolved, legalMoves, applyMove } from '../js/games/blockslide/state.js';
import { createRng } from '../js/core/rng.js';
import { randomLayout } from '../js/games/blockslide/gen.js';
import { HAND_BUILT, UNSOLVABLE } from './helpers.mjs';

for (const { name, puzzle, optimal } of HAND_BUILT) {
  test(`solver: ${name} (optimal ${optimal})`, () => {
    const res = solve(puzzle);
    assert.equal(res.status, 'solved');
    assert.equal(res.optimal, optimal);
    assert.equal(res.moves.length, optimal);
    const board = makeBoard(puzzle);
    assert.ok(isSolved(board, replay(board, res.moves)), 'returned moves solve the board');
  });

  test(`solver with cap: ${name}`, () => {
    if (optimal > 0) assert.equal(solve(puzzle, { cap: optimal - 1 }).status, 'unsolvable', 'nothing shorter than optimal');
    assert.equal(solve(puzzle, { cap: optimal }).optimal, optimal);
    assert.equal(solve(puzzle, { cap: optimal + 4 }).optimal, optimal, 'pruning keeps optimality');
  });
}

test('solver: unsolvable board is reported, not looped on', () => {
  assert.equal(solve(UNSOLVABLE).status, 'unsolvable');
});

test('solver: budget exhaustion is reported separately', () => {
  const p = HAND_BUILT.find((h) => h.optimal === 9).puzzle;
  assert.equal(solve(p, { maxStates: 3 }).status, 'budget');
});

test('replay throws on an illegal move', () => {
  const p = HAND_BUILT[2].puzzle;
  const board = makeBoard(p);
  assert.throws(() => replay(board, [{ p: 0, d: 'R' }, { p: 0, d: 'R' }]), /illegal move 2/);
});

// Independent reference: iterative deepening DFS over the same move rules.
function iddfsOptimal(puzzle, maxDepth) {
  const board = makeBoard(puzzle);
  function dfs(pos, depth) {
    if (isSolved(board, pos)) return true;
    if (depth === 0) return false;
    for (const m of legalMoves(board, pos)) if (dfs(applyMove(board, pos, m), depth - 1)) return true;
    return false;
  }
  for (let d = 0; d <= maxDepth; d++) if (dfs(board.start, d)) return d;
  return null;
}

test('solver agrees with an independent IDDFS on random small boards', () => {
  const rng = createRng(77);
  const cfg = { n: 4, blockers: [1, 3], walls: [0, 1] };
  let checked = 0;
  for (let i = 0; i < 400 && checked < 25; i++) {
    const p = randomLayout(rng, cfg);
    if (!p) continue;
    const res = solve(p, { cap: 6 });
    const ref = iddfsOptimal(p, 6);
    if (res.status === 'solved') assert.equal(res.optimal, ref, JSON.stringify(p));
    else assert.equal(ref, null, JSON.stringify(p));
    checked++;
  }
  assert.ok(checked >= 20);
});

test('hint: follows the stored line, and searches when off it', () => {
  const { puzzle, optimal } = HAND_BUILT[3];
  const solution = solve(puzzle).moves;
  const p = { ...puzzle, optimal, solution };
  const board = makeBoard(p);
  const h0 = hint(p, board.start, 0);
  assert.equal(h0.source, 'stored');
  assert.deepEqual(h0.move, solution[0]);
  assert.equal(h0.remaining, optimal);

  // Wander off the line with a legal first move that differs from the stored one.
  const first = legalMoves(board, board.start).find((m) => m.p !== solution[0].p || m.d !== solution[0].d);
  const off = applyMove(board, board.start, first);
  const h1 = hint(p, off, 1);
  assert.equal(h1.source, 'search');
  const res = solveBoard(board, off);
  assert.equal(h1.remaining, res.optimal);
  assert.ok(isSolved(board, replay(board, res.moves, off)));

  const end = replay(board, solution);
  assert.equal(hint(p, end, optimal), null, 'no hint once solved');
});
