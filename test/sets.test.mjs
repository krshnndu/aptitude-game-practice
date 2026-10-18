// Re-verify every shipped set JSON with the solver: solvable, optimal matches stored, within band.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SET_CONFIGS, PUZZLES_PER_SET } from '../js/games/blockslide/gen.js';
import { loadSet, checkSet } from '../tools/verify.mjs';

for (const cfg of SET_CONFIGS) {
  test(`shipped set ${cfg.set} passes solver verification`, () => {
    const data = loadSet(cfg.set);
    assert.equal(data.puzzles.length, PUZZLES_PER_SET);
    assert.deepEqual(data.band, cfg.band);
    for (const p of data.puzzles) {
      assert.ok(p.optimal >= cfg.band[0] && p.optimal <= cfg.band[1], `${p.id} optimal ${p.optimal} in band`);
    }
    assert.deepEqual(checkSet(data, cfg), []);
  });
}

test('difficulty ladder: band floors rise from set to set', () => {
  const lows = SET_CONFIGS.map((c) => c.band[0]);
  for (let i = 1; i < lows.length; i++) assert.ok(lows[i] > lows[i - 1]);
});

test('puzzle ids are unique across all sets', () => {
  const ids = SET_CONFIGS.flatMap((c) => loadSet(c.set).puzzles.map((p) => p.id));
  assert.equal(new Set(ids).size, ids.length);
});
