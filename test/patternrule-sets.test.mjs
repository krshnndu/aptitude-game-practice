// Pattern Rule shipped sets and generator: verification, determinism, ladder, fresh puzzles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SET_CONFIGS, PUZZLES_PER_SET, configFor, generateSet, generateFresh, difficulty } from '../js/games/patternrule/gen.js';
import { checkPuzzle } from '../js/games/patternrule/solver.js';
import { atom } from '../js/games/patternrule/rules.js';
import { loadSet, checkSet } from '../tools/patternrule-verify.mjs';

for (const cfg of SET_CONFIGS) {
  test(`shipped set ${cfg.set} passes the verifier (whole catalogue)`, () => {
    const data = loadSet(cfg.set);
    assert.equal(data.puzzles.length, PUZZLES_PER_SET);
    assert.deepEqual(checkSet(data, cfg), []);
  });
  test(`regenerating set ${cfg.set} with its default seed reproduces the shipped JSON`, () => {
    assert.deepEqual(generateSet(cfg), loadSet(cfg.set));
  });
}

test('difficulty ladder: rule complexity and panel count rise across sets', () => {
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const avg = SET_CONFIGS.map((c) => mean(loadSet(c.set).puzzles.map(difficulty)));
  assert.ok(avg[4] > avg[0], `set 5 (${avg[4]}) harder than set 1 (${avg[0]})`);
  const ruleSize = SET_CONFIGS.map((c) => mean(loadSet(c.set).puzzles.map((p) => p.rule.length)));
  assert.deepEqual(ruleSize, [1, 1, 2, 1, 2]);
  for (const c of SET_CONFIGS) {
    const ds = loadSet(c.set).puzzles.map(difficulty);
    for (let i = 1; i < ds.length; i++) assert.ok(ds[i] >= ds[i - 1], `set ${c.set} in ladder order`);
  }
});

test('set 1 holds size and direction fixed unless they are the rule; set 2 styles a distractor', () => {
  for (const p of loadSet(1).puzzles) {
    const panels = [...p.fits, ...p.counters, ...p.candidates];
    const keys = new Set(p.rule.map((id) => atom(id).key));
    if (!keys.has('s')) assert.ok(panels.every((q) => q.shapes.every((s) => s.s === 'L')), p.id);
    if (!keys.has('d')) assert.ok(panels.every((q) => q.shapes.every((s) => s.d === 'U')), p.id);
  }
  for (const p of loadSet(2).puzzles) {
    assert.ok(p.distractor, `${p.id} has a distractor`);
    const { key, value } = p.distractor;
    const allV = (q) => q.shapes.every((s) => s[key] === value);
    const noneV = (q) => q.shapes.every((s) => s[key] !== value);
    p.candidates.forEach((q, i) => {
      if (p.answer.includes(i)) assert.ok(noneV(q), `${p.id} fitting candidate avoids the distractor look`);
      else assert.ok(allV(q), `${p.id} non-fitting candidate copies the distractor look`);
    });
    assert.ok(p.fits.filter(allV).length >= 2, `${p.id}: most fitting panels share the look`);
  }
});

test('non-fitting candidates are near misses: each breaks exactly one part of the rule', () => {
  for (const c of SET_CONFIGS) {
    for (const p of loadSet(c.set).puzzles) {
      p.candidates.forEach((_, i) => {
        if (!p.answer.includes(i)) assert.equal(p.violates[i].length, 1, `${p.id} candidate ${i}`);
      });
    }
  }
});

test('puzzle ids are unique across sets', () => {
  const ids = SET_CONFIGS.flatMap((c) => loadSet(c.set).puzzles.map((p) => p.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('generator is deterministic per seed and differs across seeds', () => {
  const cfg = configFor(3);
  assert.deepEqual(generateSet(cfg, { count: 3, seed: 99 }), generateSet(cfg, { count: 3, seed: 99 }));
  assert.notDeepEqual(generateSet(cfg, { count: 3, seed: 1 }).puzzles, generateSet(cfg, { count: 3, seed: 2 }).puzzles);
});

test('fresh puzzles for timed tests pass the same checks, for every set', () => {
  for (const cfg of SET_CONFIGS) {
    for (const seed of [11, 222, 3333]) {
      const p = generateFresh(cfg.set, seed);
      assert.match(p.id, new RegExp(`^pr${cfg.set}-g`));
      assert.deepEqual(checkPuzzle(p, cfg), [], `set ${cfg.set} seed ${seed}`);
      assert.deepEqual(generateFresh(cfg.set, seed), p, 'deterministic');
    }
  }
});

test('many seeds: the generator never ships an ambiguous puzzle', () => {
  for (const cfg of SET_CONFIGS) {
    const data = generateSet(cfg, { count: 10, seed: 4242 + cfg.set });
    for (const p of data.puzzles) assert.deepEqual(checkPuzzle(p, cfg), [], p.id);
  }
});
