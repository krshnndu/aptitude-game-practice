import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSet, configFor, isTrivial, randomLayout } from '../js/games/blockslide/gen.js';
import { createRng } from '../js/core/rng.js';
import { loadSet } from '../tools/verify.mjs';

test('generator is deterministic per seed', () => {
  const cfg = configFor(3);
  const a = generateSet(cfg, { count: 3, seed: 999 });
  const b = generateSet(cfg, { count: 3, seed: 999 });
  assert.deepEqual(a, b);
});

test('different seeds give different sets', () => {
  const cfg = configFor(2);
  const a = generateSet(cfg, { count: 3, seed: 1 });
  const b = generateSet(cfg, { count: 3, seed: 2 });
  assert.notDeepEqual(a.puzzles, b.puzzles);
});

for (const setNo of [1, 2, 3]) {
  test(`regenerating set ${setNo} with its default seed reproduces the shipped JSON`, () => {
    assert.deepEqual(generateSet(configFor(setNo)), loadSet(setNo));
  });
}

test('generated puzzles are never trivial and respect the band', () => {
  const cfg = configFor(2);
  const data = generateSet(cfg, { count: 4, seed: 4242 });
  for (const p of data.puzzles) {
    assert.equal(isTrivial(p), false);
    assert.ok(p.optimal >= cfg.band[0] && p.optimal <= cfg.band[1]);
    assert.equal(p.solution.length, p.optimal);
  }
});

test('generator fails loudly when the band is impossible', () => {
  const cfg = { ...configFor(1), band: [40, 41] };
  assert.throws(() => generateSet(cfg, { count: 1, maxAttempts: 200 }), /only 0\/1 puzzles/);
});

test('random layouts are legal: no overlaps, inside the board', () => {
  const rng = createRng(5);
  const cfg = configFor(5);
  for (let i = 0; i < 50; i++) {
    const p = randomLayout(rng, cfg);
    if (!p) continue;
    const seen = new Set();
    const add = (r, c) => {
      assert.ok(r >= 0 && c >= 0 && r < p.n && c < p.n);
      const k = `${r},${c}`;
      assert.ok(!seen.has(k), 'overlap');
      seen.add(k);
    };
    add(p.ball.r, p.ball.c);
    for (const [r, c] of p.walls) add(r, c);
    for (const b of p.blocks) for (let k = 0; k < b.len; k++) add(b.dir === 'h' ? b.r : b.r + k, b.dir === 'h' ? b.c + k : b.c);
  }
});
