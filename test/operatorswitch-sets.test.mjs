// Operator Switch: shipped sets, generator and the timed run stream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SET_CONFIGS, PUZZLES_PER_SET, configFor, generateSet, generateFresh, makeForward, difficulty } from '../js/games/operatorswitch/gen.js';
import { validatePuzzle, solvePuzzle, questionKey } from '../js/games/operatorswitch/solver.js';
import { createRunStream, freshSeed, TUTORIAL_PUZZLE } from '../js/games/operatorswitch/stream.js';
import { correctValue, isInvolution, fixedPoints, puzzleMistakes } from '../js/games/operatorswitch/state.js';
import { createRng } from '../js/core/rng.js';
import { loadSet, checkSet, verifyAll } from '../tools/operatorswitch-verify.mjs';

for (const cfg of SET_CONFIGS) {
  test(`shipped set ${cfg.set} passes the independent verification`, () => {
    const data = loadSet(cfg.set);
    assert.equal(data.puzzles.length, PUZZLES_PER_SET);
    assert.deepEqual(checkSet(data, cfg), []);
    for (const p of data.puzzles) {
      const res = solvePuzzle(p);
      assert.deepEqual(res.correct, [p.answer], `${p.id}: exactly one correct option`);
    }
  });

  test(`regenerating set ${cfg.set} with its default seed reproduces the shipped JSON`, () => {
    assert.deepEqual(generateSet(cfg), loadSet(cfg.set));
  });
}

test('set structure follows the difficulty plan', () => {
  const s = SET_CONFIGS.map((c) => loadSet(c.set).puzzles);
  assert.ok(s[0].every((p) => p.kind === 'forward' && p.n === 4 && p.chains[0].length === 1), 'set 1: one box');
  assert.ok(s[0].every((p) => !isInvolution(p.chains[0][0])), 'set 1: boxes are not self-inverse, so the inverse trap is a real option');
  assert.ok(s[1].every((p) => p.kind === 'forward' && p.chains[0].length === 2), 'set 2: two boxes');
  assert.ok(s[2].every((p) => p.kind === 'forward' && p.chains[0].length === 3), 'set 3: three boxes');
  assert.ok(s[3].every((p) => p.kind === 'hidden' && [2, 3].includes(p.chains[0].length)), 'set 4: hidden box in a 2 or 3 chain');
  assert.ok(new Set(s[3].map((p) => p.chains[0].length)).size === 2, 'set 4 mixes 2 and 3 box chains');
  assert.ok(s[4].every((p) => p.n === 5 && p.chains[0].length === 4), 'set 5: five items, four boxes');
  assert.equal(s[4].filter((p) => p.kind === 'twin').length, 3, 'set 5: three two-chain puzzles');
  for (const set of s) for (const p of set) assert.ok(p.options.length >= 4 && p.options.length <= 6);
  for (const set of s) for (const p of set) for (const op of p.chains.flat().filter(Boolean)) assert.ok(fixedPoints(op) <= 1, 'every box moves at least n - 1 items');
});

test('every set climbs as a ladder and later sets start harder', () => {
  const firsts = [];
  for (const cfg of SET_CONFIGS) {
    const d = loadSet(cfg.set).puzzles.map((p) => p.difficulty);
    for (let i = 1; i < d.length; i++) assert.ok(d[i] >= d[i - 1], `set ${cfg.set} ladder`);
    firsts.push(d[0]);
  }
  for (const set of [2, 3, 5]) assert.ok(firsts[set - 1] > firsts[set - 2], `set ${set} starts above set ${set - 1}`);
});

test('wrong options include the named misreadings', () => {
  for (const cfg of SET_CONFIGS) {
    let total = 0;
    for (const p of loadSet(cfg.set).puzzles) {
      const named = new Set(puzzleMistakes(p).map((m) => m.value));
      const k = p.options.filter((o, i) => i !== p.answer && named.has(o)).length;
      assert.ok(k >= 1, `${p.id}: at least one wrong option comes from a named misreading`);
      total += k;
    }
    // Multi-box sets carry about two named traps per puzzle on average.
    if (cfg.set !== 1) assert.ok(total / PUZZLES_PER_SET >= 1.5, `set ${cfg.set}: ${total / PUZZLES_PER_SET} named traps per puzzle`);
  }
});

test('ids and questions are unique across all sets', () => {
  const all = SET_CONFIGS.flatMap((c) => loadSet(c.set).puzzles);
  assert.equal(new Set(all.map((p) => p.id)).size, all.length);
  assert.equal(new Set(all.map(questionKey)).size, all.length);
});

test('verify tool reports OK on the shipped sets', () => {
  const lines = [];
  assert.equal(verifyAll({ log: (l) => lines.push(l) }), true);
  assert.match(lines.join('\n'), /verified 50 puzzles, 0 problem/);
});

test('generator: deterministic per seed, different seeds differ', () => {
  const cfg = configFor(3);
  assert.deepEqual(generateSet(cfg, { seed: 99 }), generateSet(cfg, { seed: 99 }));
  assert.notDeepEqual(generateSet(cfg, { seed: 1 }).puzzles, generateSet(cfg, { seed: 2 }).puzzles);
});

test('generator fails loudly when constraints cannot be met', () => {
  // Five options need four distinct wrong arrangements, but 2 items allow none: impossible.
  const cfg = { ...configFor(1), n: 2 };
  assert.throws(() => generateSet(cfg, { count: 1, maxAttempts: 50 }), /only 0\/1 puzzles/);
});

test('generator output always verifies, for many seeds, and difficulty is stored', () => {
  for (const cfg of SET_CONFIGS) {
    for (let s = 1; s <= 8; s++) {
      const data = generateSet(cfg, { seed: s * 7919 });
      for (const p of data.puzzles) {
        assert.deepEqual(validatePuzzle(p, cfg), [], `${cfg.set}/${s}/${p.id}`);
        assert.equal(p.difficulty, difficulty(p));
      }
    }
  }
});

test('fresh in-page puzzles: valid for every set, deterministic, fast', () => {
  const t0 = Date.now();
  let count = 0;
  for (const cfg of SET_CONFIGS) {
    for (let k = 0; k < 150; k++) {
      const seed = freshSeed(12345, k);
      const p = generateFresh(cfg.set, seed);
      assert.deepEqual(validatePuzzle(p, cfg), [], `set ${cfg.set} seed ${seed}`);
      count++;
    }
    assert.deepEqual(generateFresh(cfg.set, 777), generateFresh(cfg.set, 777));
  }
  const ms = Date.now() - t0;
  assert.ok(ms / count < 5, `about ${(ms / count).toFixed(2)} ms per puzzle including validation`);
});

test('run stream: shuffled pool first, then endless fresh puzzles without duplicates', () => {
  const data = loadSet(4);
  const stream = createRunStream({ puzzles: data.puzzles, seed: 42, setNo: 4 });
  const drawn = [];
  for (let i = 0; i < 120; i++) drawn.push(stream.next());
  const pool = drawn.slice(0, 10);
  assert.ok(pool.every((d) => d.source === 'pool'));
  assert.deepEqual(new Set(pool.map((d) => d.puzzle.id)), new Set(data.puzzles.map((p) => p.id)));
  assert.ok(drawn.slice(10).every((d) => d.source === 'generated'));
  assert.equal(new Set(drawn.map((d) => questionKey(d.puzzle))).size, drawn.length, 'no repeated question');
  assert.deepEqual(drawn.map((d) => d.index), drawn.map((_, i) => i));
  // Same seed, same run; another seed, another order.
  const again = createRunStream({ puzzles: data.puzzles, seed: 42, setNo: 4 });
  for (let i = 0; i < 15; i++) assert.deepEqual(again.next().puzzle, drawn[i].puzzle);
  const other = createRunStream({ puzzles: data.puzzles, seed: 43, setNo: 4 });
  const otherIds = Array.from({ length: 10 }, () => other.next().puzzle.id);
  assert.notDeepEqual(otherIds, pool.map((d) => d.puzzle.id));
});

test('run stream skips duplicate fresh puzzles', () => {
  const data = loadSet(1);
  let calls = 0;
  const dup = data.puzzles[0];
  const stream = createRunStream({
    puzzles: data.puzzles,
    seed: 1,
    setNo: 1,
    makeFresh: (setNo, seed) => (calls++ < 3 ? dup : generateFresh(setNo, seed)),
  });
  for (let i = 0; i < 10; i++) stream.next();
  const fresh = stream.next();
  assert.equal(fresh.source, 'generated');
  assert.notEqual(questionKey(fresh.puzzle), questionKey(dup));
  assert.equal(calls, 4);
});

test('tutorial puzzle is valid with a unique answer', () => {
  assert.deepEqual(validatePuzzle(TUTORIAL_PUZZLE), []);
  assert.equal(correctValue(TUTORIAL_PUZZLE), TUTORIAL_PUZZLE.options[TUTORIAL_PUZZLE.answer]);
});

test('makeForward with a fixed rng is reproducible', () => {
  const a = makeForward(createRng(5), { n: 4, boxes: 2, options: 5 });
  const b = makeForward(createRng(5), { n: 4, boxes: 2, options: 5 });
  assert.deepEqual(a, b);
});
