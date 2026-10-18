import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainSolution, resultSummary, pieceName, STRATEGY } from '../js/games/blockslide/explain.js';
import { solve } from '../js/games/blockslide/solver.js';
import { makeBoard, isSolved, applyMove, occupancy, canMove } from '../js/games/blockslide/state.js';
import { SET_CONFIGS } from '../js/games/blockslide/gen.js';
import { loadSet } from '../tools/verify.mjs';
import { HAND_BUILT } from './helpers.mjs';

const DASH_CODES = new Set([0x2012, 0x2013, 0x2014, 0x2015, 0x2212]);
const DASHES = { test: (s) => [...s].some((ch) => DASH_CODES.has(ch.codePointAt(0))) };

function checkExplained(puzzle, optimal) {
  const ex = explainSolution(puzzle);
  assert.equal(ex.steps.length, optimal, 'step count equals optimal');
  assert.ok(ex.solved, 'explainer reports solved');
  // Replay the emitted steps independently, checking every one is legal.
  const board = makeBoard(puzzle);
  let pos = board.start;
  ex.steps.forEach((s, k) => {
    assert.ok(canMove(board, pos, occupancy(board, pos), s.piece, s.dir), `step ${k + 1} legal`);
    pos = applyMove(board, pos, s.move);
    assert.deepEqual(pos, ex.states[k + 1]);
    assert.ok(s.reason.length > 10, 'has a reason');
    assert.ok(!DASHES.test(s.text), `no unicode dashes in: ${s.text}`);
    assert.match(s.text, /^Move (ball|block [A-H] \([a-z ]+\)) 1 (up|down|left|right): /);
  });
  assert.ok(isSolved(board, pos), 'replay reaches the solved state');
  assert.match(ex.steps.at(-1)?.reason ?? 'reaches the exit', /exit/);
  return ex;
}

for (const { name, puzzle, optimal } of HAND_BUILT) {
  test(`explain: ${name}`, () => {
    checkExplained({ ...puzzle, optimal, solution: solve(puzzle).moves }, optimal);
  });
}

test('explain: chain board reasons name the dependency', () => {
  const { puzzle, optimal } = HAND_BUILT[3];
  const ex = checkExplained({ ...puzzle, optimal, solution: solve(puzzle).moves }, optimal);
  const blockReasons = ex.steps.filter((s) => s.piece !== 0).map((s) => s.reason);
  assert.ok(blockReasons.some((r) => /makes room for block|clears cell|clears the exit/.test(r)), blockReasons.join(' | '));
});

test('explain: single blocker reason points at the cleared lane cell', () => {
  const { puzzle, optimal } = HAND_BUILT[2];
  const ex = checkExplained({ ...puzzle, optimal, solution: solve(puzzle).moves }, optimal);
  const blockStep = ex.steps.find((s) => s.piece !== 0);
  assert.match(blockStep.text, /^Move block A \(blue\) 1 (up|down|right): clears (cell \(4,3\) on the ball's route|the exit cell \(4,4\))/);
});

for (const cfg of SET_CONFIGS) {
  test(`explain: every shipped puzzle in set ${cfg.set} replays to solved in exactly optimal steps`, () => {
    for (const p of loadSet(cfg.set).puzzles) checkExplained(p, p.optimal);
  });
}

test('result summary text', () => {
  assert.equal(resultSummary({ moves: 9, optimal: 6, solved: true }), 'You used 9, optimal 6, efficiency 67%.');
  assert.match(resultSummary({ moves: 6, optimal: 6, solved: true }), /efficiency 100%\. Optimal/);
  assert.match(resultSummary({ moves: 3, optimal: 6, solved: false }), /^Skipped: efficiency 0%/);
});

test('piece names and strategy list', () => {
  assert.equal(pieceName(0), 'ball');
  assert.equal(pieceName(1), 'block A (blue)');
  assert.equal(pieceName(2), 'block B (orange)');
  assert.ok(STRATEGY.length >= 4);
  assert.ok(STRATEGY.some((s) => /10 seconds/.test(s)));
});
