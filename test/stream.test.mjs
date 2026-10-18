// Timed test stream: shuffled pool, fresh puzzles, instant symmetric variants, tutorial puzzle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunStream, transformPuzzle, TRANSFORMS, VARIANT_TRANSFORMS, generateFresh, freshSeed, TUTORIAL_PUZZLE } from '../js/games/blockslide/stream.js';
import { makeBoard, isSolved } from '../js/games/blockslide/state.js';
import { solve, replay } from '../js/games/blockslide/solver.js';
import { isTrivial, layoutKey, configFor } from '../js/games/blockslide/gen.js';
import { loadSet } from '../tools/verify.mjs';

function onStatedEdge(p) {
  const { exit: e, n } = p;
  return (e.side === 'top' && e.r === 0) || (e.side === 'bottom' && e.r === n - 1) || (e.side === 'left' && e.c === 0) || (e.side === 'right' && e.c === n - 1);
}

test('transforms: every symmetry of every set 1 to 3 puzzle keeps the optimum and the stored line', () => {
  for (const s of [1, 2, 3]) {
    for (const p of loadSet(s).puzzles) {
      for (const t of Object.keys(TRANSFORMS)) {
        const q = transformPuzzle(p, t);
        assert.ok(onStatedEdge(q), `${q.id} exit on its edge`);
        assert.equal(isTrivial(q), false);
        const board = makeBoard(q);
        assert.ok(isSolved(board, replay(board, q.solution)), `${q.id} transformed line solves`);
        assert.equal(solve(q).optimal, p.optimal, `${q.id} optimum`);
      }
    }
  }
});

test('transforms: a set 5 puzzle stays legal and solved by the mapped line; ids name the variant', () => {
  const p = loadSet(5).puzzles[0];
  const keys = new Set();
  for (const t of VARIANT_TRANSFORMS) {
    const q = transformPuzzle(p, t);
    assert.equal(q.id, `${p.id}~${t}`);
    assert.equal(q.variantOf, p.id);
    assert.equal(q.walls.length, p.walls.length);
    const board = makeBoard(q);
    assert.ok(isSolved(board, replay(board, q.solution)));
    keys.add(layoutKey(q));
  }
  assert.ok(keys.size >= 4, 'variants look different');
  assert.throws(() => transformPuzzle(p, 'nope'), /unknown transform/);
  assert.deepEqual(transformPuzzle(p, 'id'), { ...p });
});

test('stream: pool first, shuffled per seed, deterministic', () => {
  const pool = loadSet(2).puzzles;
  const draw = (seed, k) => {
    const st = createRunStream({ puzzles: pool, seed });
    return Array.from({ length: k }, () => st.next());
  };
  const a = draw(42, 10);
  assert.deepEqual(a.map((x) => x.puzzle.id).sort(), pool.map((p) => p.id).sort(), 'all 10 shipped puzzles, once each');
  assert.ok(a.every((x) => x.source === 'pool'));
  assert.deepEqual(a.map((x) => x.index), [...Array(10).keys()]);
  assert.deepEqual(draw(42, 10).map((x) => x.puzzle.id), a.map((x) => x.puzzle.id), 'same seed, same order');
  assert.notDeepEqual(draw(43, 10).map((x) => x.puzzle.id), a.map((x) => x.puzzle.id), 'other seed, other order');
});

test('stream: after the pool it takes fresh puzzles, drops duplicates of the pool, then falls back to variants', () => {
  const pool = loadSet(1).puzzles;
  const freshOne = generateFresh(1, 77);
  const queue = [{ ...pool[3], id: 'dupe' }, freshOne];
  const st = createRunStream({ puzzles: pool, seed: 1, takeFresh: () => queue.shift() ?? null });
  for (let i = 0; i < 10; i++) st.next();
  const g = st.next();
  assert.equal(g.source, 'generated');
  assert.equal(g.puzzle.id, freshOne.id, 'the duplicate layout was skipped');
  const v = st.next();
  assert.equal(v.source, 'variant');
  assert.match(v.puzzle.id, /^bs1-\d\d~/);
  assert.equal(st.drawn, 12);
});

test('stream: endless, variant ids unique across the first 70', () => {
  const pool = loadSet(3).puzzles;
  const st = createRunStream({ puzzles: pool, seed: 9 });
  const ids = [];
  for (let i = 0; i < 200; i++) ids.push(st.next().puzzle.id);
  assert.equal(new Set(ids.slice(0, 80)).size, 80);
  assert.throws(() => createRunStream({ puzzles: [], seed: 1 }), /empty/);
});

test('fresh puzzles: deterministic per seed, in band, non-trivial, own id', () => {
  const cfg = configFor(2);
  const a = generateFresh(2, 1234);
  assert.deepEqual(generateFresh(2, 1234), a);
  assert.match(a.id, /^bs2-g[0-9a-z]+$/);
  assert.ok(a.optimal >= cfg.band[0] && a.optimal <= cfg.band[1]);
  assert.equal(isTrivial(a), false);
  assert.equal(solve(a).optimal, a.optimal);
  assert.notEqual(freshSeed(5, 0), freshSeed(5, 1));
  assert.notEqual(freshSeed(5, 0), freshSeed(6, 0));
  assert.equal(freshSeed(5, 3), freshSeed(5, 3));
});

test('tutorial puzzle: stored line is optimal and solves', () => {
  const board = makeBoard(TUTORIAL_PUZZLE);
  assert.equal(solve(TUTORIAL_PUZZLE).optimal, TUTORIAL_PUZZLE.optimal);
  assert.ok(isSolved(board, replay(board, TUTORIAL_PUZZLE.solution)));
  assert.equal(isTrivial(TUTORIAL_PUZZLE), false);
});
