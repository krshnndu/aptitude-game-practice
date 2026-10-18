// Shipped Grid Memory sets, the generator and the independent validator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SET_CONFIGS, PUZZLES_PER_SET, configFor, generateSet, generateTrial, generateFresh, trialFromId, freshSeed,
  lengthLadder, symmetricShape, asymmetricShape, arithItem, isConnected, collinear,
} from '../js/games/gridmemory/gen.js';
import { checkPuzzle, checkSetData, solveSide, mirrorDiffPairs, solveRecall } from '../js/games/gridmemory/validate.js';
import { correctAnswer, mirrorMismatches } from '../js/games/gridmemory/state.js';
import { createRng } from '../js/core/rng.js';
import { loadSet, checkSet } from '../tools/gridmemory-verify.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));

for (const cfg of SET_CONFIGS) {
  test(`shipped set ${cfg.set} passes the independent validator`, () => {
    const data = loadSet(cfg.set);
    assert.equal(data.puzzles.length, PUZZLES_PER_SET);
    assert.deepEqual(checkSet(data, cfg), []);
    for (const p of data.puzzles) {
      assert.deepEqual(solveRecall(p), p.sequence);
      for (const d of p.distractors) assert.equal(solveSide(d), d.answer);
    }
  });

  test(`regenerating set ${cfg.set} with its default seed reproduces the shipped JSON`, () => {
    assert.deepEqual(generateSet(cfg), loadSet(cfg.set));
  });
}

test('difficulty ladder across sets: grid, length, side window and display time', () => {
  for (let i = 1; i < SET_CONFIGS.length; i++) {
    const a = SET_CONFIGS[i - 1];
    const b = SET_CONFIGS[i];
    assert.ok(b.n >= a.n, 'grid never shrinks');
    assert.ok(b.lengths[0] >= a.lengths[0] && b.lengths[1] > a.lengths[1], 'lengths climb');
    assert.ok(b.windowMs < a.windowMs, 'side window shrinks');
    assert.ok(b.showMs < a.showMs, 'cells show for less time');
  }
  assert.deepEqual([SET_CONFIGS[0].n, ...SET_CONFIGS[0].lengths], [3, 2, 3]);
  assert.deepEqual([SET_CONFIGS[4].n, ...SET_CONFIGS[4].lengths], [5, 5, 7]);
});

test('lengths ladder spans the band in order', () => {
  assert.deepEqual(lengthLadder(configFor(1)), [2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
  assert.deepEqual(lengthLadder(configFor(5)), [5, 5, 5, 5, 6, 6, 6, 7, 7, 7]);
});

test('puzzle ids are unique across all sets', () => {
  const ids = SET_CONFIGS.flatMap((c) => loadSet(c.set).puzzles.map((p) => p.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('generator is deterministic per seed and differs across seeds', () => {
  const cfg = configFor(4);
  assert.deepEqual(generateSet(cfg, { seed: 99 }), generateSet(cfg, { seed: 99 }));
  assert.notDeepEqual(generateSet(cfg, { seed: 1 }).puzzles, generateSet(cfg, { seed: 2 }).puzzles);
});

test('shapes: symmetric ones are symmetric, asymmetric ones break exactly k pairs, all connected', () => {
  const rng = createRng(7);
  for (let i = 0; i < 200; i++) {
    const size = i % 2 ? 5 : 6;
    const s = symmetricShape(rng, size);
    assert.equal(mirrorMismatches(s), 0);
    assert.equal(mirrorDiffPairs(s), 0, 'independent check agrees');
    assert.ok(isConnected(s));
    const k = 1 + (i % 4);
    const a = asymmetricShape(rng, size, k);
    assert.equal(mirrorMismatches(a), k);
    assert.equal(mirrorDiffPairs(a), k, 'independent check agrees');
    assert.ok(isConnected(a));
  }
});

test('arithmetic items carry the parity they were asked for', () => {
  const rng = createRng(3);
  for (const cfg of SET_CONFIGS.filter((c) => c.arith)) {
    for (let i = 0; i < 100; i++) {
      const want = i % 2 ? 'odd' : 'even';
      const d = arithItem(rng, cfg.arith, want);
      assert.equal(d.answer, want);
      assert.equal(correctAnswer(d), want);
      assert.equal(solveSide(d), want);
    }
  }
});

test('collinear detection', () => {
  assert.equal(collinear(4, [0, 1, 2, 3]), true);
  assert.equal(collinear(4, [0, 5, 10, 15]), true);
  assert.equal(collinear(4, [0, 5, 3]), false);
});

test('fresh trials: any length that fits, valid, rebuilt from their id', () => {
  for (const cfg of SET_CONFIGS) {
    const looser = { ...cfg, lengths: [2, cfg.runMax] };
    for (let L = 2; L <= cfg.runMax; L++) {
      const p = generateFresh(cfg, L, freshSeed(1234, L));
      assert.deepEqual(checkPuzzle(p, looser), [], `${p.id}`);
      assert.deepEqual(trialFromId(p.id), p);
    }
    assert.ok(cfg.runMax <= cfg.n * cfg.n);
  }
  assert.equal(trialFromId('gm1-03'), null);
  assert.throws(() => generateTrial(createRng(1), configFor(1), 10, 'x'), /does not fit/);
  assert.notEqual(freshSeed(1, 0), freshSeed(1, 1));
});

test('validator catches broken puzzles', () => {
  const cfg = configFor(3);
  const good = loadSet(3);
  const p0 = good.puzzles[0];
  const sym = p0.distractors.findIndex((d) => d.kind === 'sym');
  const par = p0.distractors.findIndex((d) => d.kind === 'parity');

  const cases = [
    ['symmetric shape with one cell flipped', (p) => {
      const d = p.distractors[sym];
      const r = d.rows[0];
      const c = r[0] === '#' ? '.' : '#';
      d.rows[0] = c + r.slice(1);
    }, /marked|differing|connected|stored answer/],
    ['wrong parity answer', (p) => { p.distractors[par].answer = p.distractors[par].answer === 'even' ? 'odd' : 'even'; }, /stored answer/],
    ['repeated cell', (p) => { p.sequence[1] = p.sequence[0]; }, /repeats/],
    ['cell off the grid', (p) => { p.sequence[0] = 99; }, /off the grid/],
    ['missing side question', (p) => { p.distractors.pop(); }, /one side question/],
    ['wrong window', (p) => { p.windowMs = 9999; }, /windowMs/],
    ['unknown answer word', (p) => { p.distractors[sym].answer = 'maybe'; }, /not one of/],
    ['straight line sequence', (p) => { p.sequence = [0, 1, 2, 3]; }, /straight line/],
  ];
  for (const [name, mutate, re] of cases) {
    const p = clone(p0);
    mutate(p);
    const problems = checkPuzzle(p, cfg);
    assert.ok(problems.some((m) => re.test(m)), `${name}: ${problems.join('; ')}`);
  }

  const swapped = clone(good);
  [swapped.puzzles[0], swapped.puzzles[9]] = [swapped.puzzles[9], swapped.puzzles[0]];
  assert.ok(checkSetData(swapped, cfg).some((m) => /drops below/.test(m)));
  const dup = clone(good);
  dup.puzzles[1] = { ...clone(dup.puzzles[0]), id: dup.puzzles[1].id };
  assert.ok(checkSetData(dup, cfg).some((m) => /duplicate sequence/.test(m)));
  const lopsided = clone(good);
  for (const p of lopsided.puzzles) for (const d of p.distractors) if (d.kind === 'parity') {
    d.a = 2; d.b = 2; d.op = '+'; d.answer = 'even';
  }
  assert.ok(checkSetData(lopsided, cfg).some((m) => /unbalanced/.test(m)));
});
