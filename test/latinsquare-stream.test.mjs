// Latin Square timed-run stream: shuffled pool, endless fresh puzzles, variants, determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunStream, generateFresh, variantPuzzle, freshSeed, TUTORIAL_PUZZLE } from '../js/games/latinsquare/stream.js';
import { SET_CONFIGS, configFor, patternKey } from '../js/games/latinsquare/gen.js';
import { checkPuzzle, loadSet } from '../tools/latinsquare-verify.mjs';

test('a run serves the 10 shipped puzzles first, shuffled by the seed, then fresh ones forever', () => {
  const puzzles = loadSet(2).puzzles;
  const s = createRunStream({ puzzles, seed: 42, setNo: 2 });
  const first = Array.from({ length: 10 }, () => s.next());
  assert.ok(first.every((x) => x.source === 'pool'));
  assert.deepEqual(first.map((x) => x.puzzle.id).sort(), puzzles.map((p) => p.id).sort());
  const other = createRunStream({ puzzles, seed: 43, setNo: 2 });
  assert.notDeepEqual(Array.from({ length: 10 }, () => other.next().puzzle.id), first.map((x) => x.puzzle.id));
  const keys = new Set(puzzles.map(patternKey));
  for (let i = 0; i < 40; i++) {
    const x = s.next();
    assert.equal(x.source, 'generated');
    assert.ok(!keys.has(patternKey(x.puzzle)), 'no repeats');
    keys.add(patternKey(x.puzzle));
  }
  assert.equal(s.drawn, 50);
});

test('fresh puzzles pass the independent verifier for every set, and are deterministic per seed', () => {
  for (const cfg of SET_CONFIGS) {
    for (let k = 0; k < 4; k++) {
      const seed = freshSeed(1234 + cfg.set, k);
      const p = generateFresh(cfg.set, seed);
      assert.doesNotThrow(() => checkPuzzle(p, cfg), `set ${cfg.set} fresh ${k}`);
      assert.deepEqual(generateFresh(cfg.set, seed), p);
    }
  }
});

test('variants keep size, depth and a unique answer', () => {
  for (const cfg of SET_CONFIGS) {
    for (const base of loadSet(cfg.set).puzzles.slice(0, 3)) {
      const v = variantPuzzle(base, 99);
      assert.equal(v.variantOf, base.id);
      assert.deepEqual(v.targetDepths.slice().sort(), base.targetDepths.slice().sort());
      assert.doesNotThrow(() => checkPuzzle(v, cfg), `${base.id} variant`);
    }
  }
});

test('when generation fails the stream falls back to variants at once', () => {
  const puzzles = loadSet(5).puzzles;
  const s = createRunStream({ puzzles, seed: 7, setNo: 5, makeFresh: () => { throw new Error('no'); } });
  for (let i = 0; i < 10; i++) s.next();
  for (let i = 0; i < 12; i++) {
    const x = s.next();
    assert.equal(x.source, 'variant');
    assert.doesNotThrow(() => checkPuzzle(x.puzzle, configFor(5)));
  }
});

test('tutorial puzzle is a direct row plus column check on 4x4', () => {
  assert.doesNotThrow(() => checkPuzzle(TUTORIAL_PUZZLE, { ...configFor(1), blanks: [0, 16] }));
});
