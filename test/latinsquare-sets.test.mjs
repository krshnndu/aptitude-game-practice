// Re-verify every shipped Latin Square set with the independent checker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SET_CONFIGS, PUZZLES_PER_SET } from '../js/games/latinsquare/gen.js';
import { loadSet, checkSet } from '../tools/latinsquare-verify.mjs';

for (const cfg of SET_CONFIGS) {
  test(`shipped set ${cfg.set} passes the independent verifier`, () => {
    const data = loadSet(cfg.set);
    assert.equal(data.puzzles.length, PUZZLES_PER_SET);
    assert.equal(data.depth, cfg.depth);
    assert.deepEqual(checkSet(data, cfg), []);
  });
}

test('within a set, puzzles never get easier: the solving step count never falls', () => {
  for (const cfg of SET_CONFIGS) {
    const steps = loadSet(cfg.set).puzzles.map((p) => p.steps);
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i] >= steps[i - 1], `set ${cfg.set}`);
  }
});

test('set 4 mixes one and two ? cells; set 5 always has two', () => {
  const s4 = loadSet(4).puzzles.map((p) => p.targets.length);
  assert.ok(s4.includes(1) && s4.includes(2));
  assert.ok(loadSet(5).puzzles.every((p) => p.targets.length === 2));
});

test('puzzle ids are unique across all sets and follow lsS-KK', () => {
  const ids = SET_CONFIGS.flatMap((c) => loadSet(c.set).puzzles.map((p) => p.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^ls[1-5]-(0[1-9]|10)$/);
});
