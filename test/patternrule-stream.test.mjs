// Pattern Rule timed test stream: shuffled pool, fresh puzzles, reshuffled repeats, tutorial puzzle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunStream, reshuffle, freshSource, freshSeed, puzzleKey, tutorialPuzzle } from '../js/games/patternrule/stream.js';
import { checkPuzzle } from '../js/games/patternrule/solver.js';
import { configFor } from '../js/games/patternrule/gen.js';
import { createRng } from '../js/core/rng.js';
import { loadSet } from '../tools/patternrule-verify.mjs';

const pool = loadSet(2).puzzles;

test('the pool comes first, in an order fixed by the run seed', () => {
  const a = createRunStream({ puzzles: pool, seed: 7 });
  const b = createRunStream({ puzzles: pool, seed: 7 });
  const c = createRunStream({ puzzles: pool, seed: 8 });
  const ia = pool.map(() => a.next().puzzle.id);
  const ib = pool.map(() => b.next().puzzle.id);
  const ic = pool.map(() => c.next().puzzle.id);
  assert.deepEqual(ia, ib);
  assert.notDeepEqual(ia, ic);
  assert.deepEqual([...ia].sort(), pool.map((p) => p.id).sort());
});

test('after the pool: fresh generated puzzles, then reshuffled repeats if generation fails', () => {
  const s = createRunStream({ puzzles: pool, seed: 3, takeFresh: freshSource(2, 3) });
  for (let i = 0; i < pool.length; i++) assert.equal(s.next().source, 'pool');
  const fresh = s.next();
  assert.equal(fresh.source, 'generated');
  assert.deepEqual(checkPuzzle(fresh.puzzle, configFor(2)), []);
  const dry = createRunStream({ puzzles: pool, seed: 3, takeFresh: () => null });
  for (let i = 0; i < pool.length; i++) dry.next();
  const items = Array.from({ length: 25 }, () => dry.next());
  assert.ok(items.every((x) => x.source === 'variant'));
  for (const x of items) assert.deepEqual(checkPuzzle(x.puzzle, configFor(2)), [], x.puzzle.id);
  assert.equal(dry.drawn, pool.length + 25);
});

test('duplicates of the pool are never served as fresh puzzles', () => {
  const s = createRunStream({ puzzles: pool, seed: 1, takeFresh: (k) => (k < 2 ? pool[0] : null) });
  for (let i = 0; i < pool.length; i++) s.next();
  assert.equal(s.next().source, 'variant');
});

test('reshuffle keeps the rule and the answer, only the order changes', () => {
  const rng = createRng(5);
  for (const p of loadSet(5).puzzles) {
    const v = reshuffle(p, rng, 'v1');
    assert.equal(v.variantOf, p.id);
    assert.equal(puzzleKey(v), puzzleKey(p));
    assert.equal(v.answer.length, p.answer.length);
    assert.deepEqual(checkPuzzle(v, configFor(5)), []);
  }
});

test('fresh seeds differ per k and per run', () => {
  assert.notEqual(freshSeed(1, 0), freshSeed(1, 1));
  assert.notEqual(freshSeed(1, 0), freshSeed(2, 0));
});

test('the tutorial puzzle is fixed, valid and has one fitting candidate', () => {
  const t = tutorialPuzzle();
  assert.deepEqual(t, tutorialPuzzle());
  assert.equal(t.id, 'tutorial');
  assert.equal(t.answer.length, 1);
  assert.match(t.rule[0], /^fill-all:/);
  assert.deepEqual(checkPuzzle(t), []);
});
