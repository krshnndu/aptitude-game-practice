// Digit Equation: generator determinism, set rules, fresh puzzles and the run stream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SET_CONFIGS, generateSet, generateFresh, freshSeed, puzzleKey } from '../js/games/digitequation/gen.js';
import { createRunStream, TUTORIAL_PUZZLE } from '../js/games/digitequation/stream.js';
import { solve } from '../js/games/digitequation/solver.js';
import { evalLeftToRight, evalValues } from '../js/games/digitequation/state.js';
import { setPath, loadSet, checkSet } from '../tools/digitequation-verify.mjs';

for (const cfg of SET_CONFIGS) {
  test(`set ${cfg.set} regenerates byte for byte from its seed`, () => {
    const data = generateSet(cfg);
    assert.equal(JSON.stringify(data, null, 1) + '\n', readFileSync(setPath(cfg.set), 'utf8'));
  });
}

test('generation is deterministic per seed and differs across seeds', () => {
  const cfg = SET_CONFIGS[2];
  const a = generateSet(cfg, { seed: 99 });
  const b = generateSet(cfg, { seed: 99 });
  const c = generateSet(cfg, { seed: 100 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.puzzles.map(puzzleKey), c.puzzles.map(puzzleKey));
});

test('other seeds still give valid sets', () => {
  for (const cfg of SET_CONFIGS) {
    const data = generateSet(cfg, { seed: cfg.seed + 17 });
    assert.deepEqual([...checkSet(data, cfg)], [], `set ${cfg.set}`);
  }
});

test('difficulty ladder rises from set to set', () => {
  const med = SET_CONFIGS.map((c) => {
    const d = loadSet(c.set).puzzles.map((p) => p.difficulty).sort((x, y) => x - y);
    return d[Math.floor(d.length / 2)];
  });
  for (let i = 1; i < med.length; i++) assert.ok(med[i] >= med[i - 1], `set ${i + 1} median ${med[i]} >= ${med[i - 1]}`);
});

test('set 3 puzzles all depend on the order of operations', () => {
  for (const p of loadSet(3).puzzles) {
    const eq = p.tokens.indexOf('=');
    const left = p.tokens.slice(0, eq);
    let k = 0;
    const filled = left.map((t) => (/^[0-9_]+$/.test(t) ? Number(t.replace(/_/g, () => String(p.answer[k++]))) : t));
    const values = filled.filter((_, j) => j % 2 === 0);
    const ops = filled.filter((_, j) => j % 2 === 1);
    assert.notEqual(evalLeftToRight(values, ops).value, evalValues(values, ops).value, p.id);
  }
});

test('fresh puzzles: fast, unique, the right blank count', () => {
  for (const cfg of SET_CONFIGS) {
    const t0 = Date.now();
    for (let k = 0; k < 20; k++) {
      const p = generateFresh(cfg.set, freshSeed(42, k));
      assert.ok(p);
      assert.equal(p.blanks, cfg.blanks);
      assert.equal(solve(p).unique, true);
      for (const op of cfg.need || []) assert.ok(p.tokens.includes(op));
    }
    const per = (Date.now() - t0) / 20;
    assert.ok(per < 200, `set ${cfg.set}: ${per} ms per fresh puzzle`);
  }
  assert.deepEqual(generateFresh(5, 7), generateFresh(5, 7));
});

test('run stream: shuffled pool first, then endless fresh puzzles, nothing repeats', () => {
  const pool = loadSet(4).puzzles;
  const s = createRunStream({ puzzles: pool, seed: 123, setNo: 4 });
  const keys = new Set();
  const sources = [];
  for (let i = 0; i < 40; i++) {
    const { puzzle, source, index } = s.next();
    assert.equal(index, i);
    sources.push(source);
    const key = puzzleKey(puzzle);
    assert.ok(!keys.has(key), `repeat at ${i}`);
    keys.add(key);
  }
  assert.deepEqual(sources.slice(0, 10), new Array(10).fill('pool'));
  assert.ok(sources.slice(10).every((x) => x === 'generated'));
  const again = createRunStream({ puzzles: pool, seed: 123, setNo: 4 });
  const first = createRunStream({ puzzles: pool, seed: 124, setNo: 4 });
  assert.equal(again.next().puzzle.id, createRunStream({ puzzles: pool, seed: 123, setNo: 4 }).next().puzzle.id);
  const order123 = Array.from({ length: 10 }, () => again.next().puzzle.id);
  const order124 = Array.from({ length: 10 }, () => first.next().puzzle.id);
  assert.notDeepEqual(order123, order124);
});

test('run stream falls back to a marked repeat when generation fails', () => {
  const pool = loadSet(1).puzzles;
  const s = createRunStream({ puzzles: pool, seed: 1, setNo: 1, makeFresh: () => null });
  for (let i = 0; i < 10; i++) s.next();
  const r = s.next();
  assert.equal(r.source, 'repeat');
  assert.match(r.puzzle.id, /~r0$/);
});

test('tutorial puzzle has a unique answer from its tray', () => {
  const res = solve(TUTORIAL_PUZZLE);
  assert.deepEqual(res.solutions, [TUTORIAL_PUZZLE.answer]);
});
