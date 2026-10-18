// Timed test stream: the adaptive staircase and the trial source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStaircase, createRunSource, tutorialTrial, maxSpanOf, MIN_LENGTH } from '../js/games/gridmemory/stream.js';
import { configFor, SET_CONFIGS } from '../js/games/gridmemory/gen.js';
import { checkPuzzle } from '../js/games/gridmemory/validate.js';
import { loadSet } from '../tools/gridmemory-verify.mjs';

test('staircase: pass makes it longer, miss shorter, within bounds', () => {
  const s = createStaircase({ start: 3, max: 5 });
  assert.equal(s.length, 3);
  assert.equal(s.update(true), 4);
  assert.equal(s.update(true), 5);
  assert.equal(s.update(true), 5, 'capped at max');
  assert.equal(s.update(false), 4);
  assert.equal(s.update(false), 3);
  assert.equal(s.update(false), 2);
  assert.equal(s.update(false), MIN_LENGTH, 'floored at the minimum');
  assert.equal(s.maxSpan, 5);
  assert.equal(s.trail.length, 7);
  assert.equal(maxSpanOf([{ length: 3, success: false }]), 0);
});

test('run source: shipped trials first at each length, then fresh ones, endless', () => {
  const cfg = configFor(2);
  const data = loadSet(2);
  const src = createRunSource({ puzzles: data.puzzles, cfg, seed: 42 });
  const at3 = data.puzzles.filter((p) => p.length === 3).length;
  const got = [];
  for (let i = 0; i < at3; i++) got.push(src.next(3));
  assert.ok(got.every((g) => g.source === 'pool' && g.puzzle.length === 3));
  assert.equal(new Set(got.map((g) => g.puzzle.id)).size, at3, 'no shipped trial twice');
  const fresh = src.next(3);
  assert.equal(fresh.source, 'generated');
  assert.equal(fresh.puzzle.length, 3);
  const long = src.next(cfg.runMax);
  assert.equal(long.source, 'generated');
  assert.deepEqual(checkPuzzle(long.puzzle, { ...cfg, lengths: [2, cfg.runMax] }), []);
  for (let i = 0; i < 60; i++) assert.ok(src.next(2 + (i % 6)).puzzle);
  assert.equal(src.next(4).index, at3 + 2 + 60);
});

test('run source is deterministic per seed and shuffles per seed', () => {
  const cfg = configFor(5);
  const data = loadSet(5);
  const draw = (seed) => {
    const src = createRunSource({ puzzles: data.puzzles, cfg, seed });
    return [5, 5, 6, 7, 7, 7, 7, 8].map((L) => src.next(L).puzzle.id);
  };
  assert.deepEqual(draw(9), draw(9));
  assert.notDeepEqual(draw(9), draw(10));
});

test('tutorial trial: length 2 with the set\'s own side questions and timing', () => {
  for (const cfg of SET_CONFIGS) {
    const p = tutorialTrial(cfg);
    assert.equal(p.length, 2);
    assert.deepEqual(checkPuzzle(p, { ...cfg, lengths: [2, 2], noLine: false }), []);
    assert.deepEqual(tutorialTrial(cfg), p, 'same sample every time');
  }
});
