// Headless checks of the game session used by play.js (no DOM needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, enteringCells, makeBoard } from '../js/games/blockslide/state.js';
import { solve } from '../js/games/blockslide/solver.js';
import { efficiency } from '../js/core/score.js';
import { loadSet } from '../tools/verify.mjs';
import { HAND_BUILT } from './helpers.mjs';

const chain = () => {
  const { puzzle, optimal } = HAND_BUILT[3];
  return { ...puzzle, optimal, solution: solve(puzzle).moves };
};

test('game: illegal moves are rejected and do not count', () => {
  const g = createGame(chain());
  assert.equal(g.move(0, 'U'), false, 'wall above ball');
  assert.equal(g.move(0, 'R'), false, 'block A right of ball');
  assert.equal(g.move(0, 'D'), false, 'board edge');
  assert.equal(g.move(1, 'U'), false, 'block B above A');
  assert.equal(g.move(2, 'D'), false, 'block B cannot go down onto A');
  assert.equal(g.moves, 0);
  assert.deepEqual(g.legalDirs(0), []);
});

test('game: playing the optimal line solves it and locks the board', () => {
  const p = chain();
  const g = createGame(p);
  for (const m of p.solution) assert.ok(g.move(m.p, m.d));
  assert.equal(g.status, 'solved');
  assert.equal(g.moves, p.optimal);
  assert.equal(efficiency(p.optimal, g.moves), 1);
  assert.equal(g.move(0, 'L'), false, 'no moves after solving');
  assert.equal(g.undo(), false);
});

test('game: undo and reset restore earlier positions', () => {
  const g = createGame(chain());
  const start = g.positions.slice();
  assert.ok(g.move(2, 'U'));
  assert.ok(g.move(1, 'U'));
  const mid = g.positions.slice();
  assert.ok(g.move(1, 'R'));
  assert.equal(g.moves, 3);
  assert.ok(g.undo());
  assert.deepEqual(g.positions, mid);
  assert.equal(g.moves, 2);
  assert.ok(g.reset());
  assert.deepEqual(g.positions, start);
  assert.equal(g.moves, 0);
  assert.equal(g.selected, null);
});

test('game: skip ends the puzzle and is final', () => {
  const g = createGame(chain());
  g.move(2, 'U');
  assert.ok(g.skip());
  assert.equal(g.status, 'skipped');
  assert.equal(g.skip(), false);
  assert.equal(g.reset(), false, 'cannot return to a skipped puzzle');
  assert.equal(g.move(1, 'U'), false);
  assert.equal(efficiency(5, g.moves, g.solved), 0);
});

test('game: selection, moveSelected and tap-to-move toward a cell', () => {
  const p = HAND_BUILT[2].puzzle; // ball (3,0), block A at (3,2), exit (3,3)
  const g = createGame(p);
  assert.equal(g.selectAt(3 * 4 + 2), 1);
  assert.equal(g.selected, 1);
  assert.equal(g.dirToward(2 * 4 + 2), 'U');
  assert.equal(g.dirToward(0), null);
  assert.ok(g.moveSelected('U'));
  g.select(0);
  for (let i = 0; i < 3; i++) {
    const d = g.dirToward(g.positions[0] + 1);
    assert.equal(d, 'R');
    assert.ok(g.move(0, d));
  }
  assert.equal(g.status, 'solved');
  assert.equal(g.moves, 4);
  assert.equal(g.selectAt(0), null, 'empty cell selects nothing');
});

test('game: multi-cell blocks need every leading cell free, and never rotate', () => {
  const p = HAND_BUILT[5].puzzle; // length 3 horizontal block in row 4
  const board = makeBoard(p);
  assert.deepEqual(enteringCells(board, 1, board.start[1], 'U'), [9, 10, 11]);
  assert.equal(enteringCells(board, 1, board.start[1], 'R'), null, 'off board');
  const g = createGame(p);
  assert.ok(g.move(1, 'U'));
  assert.deepEqual(g.board.shapes[1], { len: 3, dir: 'h' });
});

test('game: onOptimalLine tracks the stored solution', () => {
  const p = chain();
  const g = createGame(p);
  assert.ok(g.onOptimalLine());
  g.move(p.solution[0].p, p.solution[0].d);
  assert.ok(g.onOptimalLine());
  g.undo();
  const other = ['U', 'R'].map((d) => ({ p: 2, d })).find((m) => m.d !== p.solution[0].d || m.p !== p.solution[0].p);
  assert.ok(g.move(other.p, other.d));
  assert.equal(g.onOptimalLine(), false);
});

test('game: every shipped puzzle starts unsolved and the stored line solves it via the session API', () => {
  for (let s = 1; s <= 5; s++) {
    for (const p of loadSet(s).puzzles) {
      const g = createGame(p);
      assert.equal(g.status, 'playing');
      for (const m of p.solution) assert.ok(g.move(m.p, m.d), `${p.id} move legal`);
      assert.equal(g.status, 'solved', p.id);
    }
  }
});
