// Fresh puzzles per game: the ranked sequence is the same for everyone, fresh timed sequences
// differ by browser id and skip the seen-list, and practice keeps going past the shipped 10 with
// valid puzzles that carry a verified answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { rankedSeed, freshRunSeed, createSeenList, pickPracticePuzzle, practiceOwner } from '../js/core/fresh.js';
import { memoryStorage } from '../js/core/store.js';

import * as bs from '../js/games/blockslide/stream.js';
import { solve as bsSolve } from '../js/games/blockslide/solver.js';
import * as ls from '../js/games/latinsquare/stream.js';
import { configFor as lsConfig } from '../js/games/latinsquare/gen.js';
import { checkPuzzle as lsCheck } from '../tools/latinsquare-verify.mjs';
import * as os from '../js/games/operatorswitch/stream.js';
import { validatePuzzle as osValidate } from '../js/games/operatorswitch/solver.js';
import * as de from '../js/games/digitequation/stream.js';
import { solve as deSolve } from '../js/games/digitequation/solver.js';
import * as pr from '../js/games/patternrule/stream.js';
import { checkPuzzle as prCheck } from '../js/games/patternrule/solver.js';
import { configFor as prConfig } from '../js/games/patternrule/gen.js';
import * as gm from '../js/games/gridmemory/stream.js';
import { configFor as gmConfig } from '../js/games/gridmemory/gen.js';
import { checkPuzzle as gmCheck } from '../js/games/gridmemory/validate.js';

const load = (game, set) => JSON.parse(readFileSync(new URL(`../data/sets/${game}/set${set}.json`, import.meta.url), 'utf8'));

// Block Slide builds its fresh puzzles in a worker; here the same seeds are built inline.
const bsTake = (set, seed) => {
  let k = 0;
  return () => {
    try {
      return bs.generateFresh(set, bs.freshSeed(seed, k++));
    } catch {
      return null;
    }
  };
};

// Per game: how a ranked or fresh stream is made, and how a puzzle's answer is checked.
const GAMES = {
  blockslide: {
    // Sets 4 and 5 take seconds per fresh puzzle; the logic is the same as sets 1 to 3.
    sets: [1, 2, 3],
    ranked: (puzzles, set, seed) => bs.createRunStream({ puzzles, seed, takeFresh: bsTake(set, seed), shuffle: false, ordered: true }),
    fresh: (puzzles, set, seed, isSeen) => bs.createRunStream({ puzzles, seed, takeFresh: bsTake(set, seed), usePool: false, isSeen }),
    verify: (p) => {
      const r = bsSolve(p, { maxStates: 2_000_000 });
      assert.equal(r.status, 'solved', p.id);
      assert.equal(r.optimal, p.optimal, `${p.id}: stored optimal is the true optimum`);
    },
  },
  latinsquare: {
    sets: [1, 2, 3, 4, 5],
    ranked: (puzzles, setNo, seed) => ls.createRunStream({ puzzles, seed, setNo, shuffle: false }),
    fresh: (puzzles, setNo, seed, isSeen) => ls.createRunStream({ puzzles, seed, setNo, usePool: false, isSeen }),
    verify: (p, set) => assert.doesNotThrow(() => lsCheck(p, lsConfig(set)), p.id),
  },
  operatorswitch: {
    sets: [1, 2, 3, 4, 5],
    ranked: (puzzles, setNo, seed) => os.createRunStream({ puzzles, seed, setNo, shuffle: false }),
    fresh: (puzzles, setNo, seed, isSeen) => os.createRunStream({ puzzles, seed, setNo, usePool: false, isSeen }),
    verify: (p) => assert.deepEqual(osValidate(p), [], p.id),
  },
  digitequation: {
    sets: [1, 2, 3, 4, 5],
    ranked: (puzzles, setNo, seed) => de.createRunStream({ puzzles, seed, setNo, shuffle: false }),
    fresh: (puzzles, setNo, seed, isSeen) => de.createRunStream({ puzzles, seed, setNo, usePool: false, isSeen }),
    verify: (p) => {
      const r = deSolve(p);
      assert.ok(r.count >= 1, `${p.id}: solvable`);
      assert.ok(r.solutions.some((f) => f.join() === p.answer.join()), `${p.id}: stored answer is a solution`);
    },
  },
  patternrule: {
    sets: [1, 2, 3, 4, 5],
    ranked: (puzzles, setNo, seed) => pr.createRunStream({ puzzles, seed, takeFresh: pr.freshSource(setNo, seed), shuffle: false }),
    fresh: (puzzles, setNo, seed, isSeen) => pr.createRunStream({ puzzles, seed, takeFresh: pr.freshSource(setNo, seed), usePool: false, isSeen }),
    verify: (p, set) => assert.deepEqual(prCheck(p, prConfig(set)), [], p.id),
  },
};

const draw = (stream, n) => Array.from({ length: n }, () => stream.next());

// Determinism is checked with Math.random and Date.now unavailable.
function withoutRandom(fn) {
  const saved = { random: Math.random, now: Date.now };
  Math.random = () => {
    throw new Error('Math.random used');
  };
  Date.now = () => {
    throw new Error('Date.now used');
  };
  try {
    return fn();
  } finally {
    Math.random = saved.random;
    Date.now = saved.now;
  }
}

for (const [game, g] of Object.entries(GAMES)) {
  const kit = (await import(`../js/games/${game}/stream.js`)).freshKit;

  test(`${game}: ranked sequence is the shipped order, then the same fresh puzzles for everyone`, () => {
    for (const set of g.sets) {
      const { puzzles } = load(game, set);
      const seed = rankedSeed(game, set);
      const a = withoutRandom(() => draw(g.ranked(puzzles, set, seed), 14));
      const b = withoutRandom(() => draw(g.ranked(puzzles, set, seed), 14));
      assert.deepEqual(a.map((x) => x.puzzle.id), b.map((x) => x.puzzle.id), `set ${set}`);
      assert.deepEqual(a.map((x) => kit.keyOf(x.puzzle)), b.map((x) => kit.keyOf(x.puzzle)), `set ${set}`);
      assert.deepEqual(a.slice(0, 10).map((x) => x.puzzle.id), puzzles.map((p) => p.id), `set ${set}: shipped order`);
      assert.ok(a.slice(10).every((x) => x.source !== 'pool'), `set ${set}: fresh after the shipped 10`);
      for (const x of a.slice(10)) g.verify(x.puzzle, set);
    }
  });

  test(`${game}: fresh timed sequence differs by browser id and skips the seen-list`, () => {
    const set = g.sets[0];
    const { puzzles } = load(game, set);
    const shipped = new Set(puzzles.map(kit.keyOf));
    const one = draw(g.fresh(puzzles, set, freshRunSeed('browser-a', game, set, 0), () => false), 3);
    const two = draw(g.fresh(puzzles, set, freshRunSeed('browser-b', game, set, 0), () => false), 3);
    assert.ok(one.every((x) => x.source === 'generated'), 'fresh runs start with generated puzzles');
    assert.notDeepEqual(one.map((x) => kit.keyOf(x.puzzle)), two.map((x) => kit.keyOf(x.puzzle)));
    for (const x of one) {
      assert.ok(!shipped.has(kit.keyOf(x.puzzle)), 'no shipped puzzle in a fresh run');
      g.verify(x.puzzle, set);
    }
    // The same browser and run number: the same puzzles. With the first two marked seen, they are skipped.
    const seen = createSeenList(memoryStorage());
    for (const x of one.slice(0, 2)) seen.add(game, kit.keyOf(x.puzzle), 'f');
    const again = draw(g.fresh(puzzles, set, freshRunSeed('browser-a', game, set, 0), (key) => seen.has(game, key)), 2);
    for (const x of again) assert.ok(!seen.has(game, kit.keyOf(x.puzzle)), 'seen puzzle skipped');
    assert.equal(kit.keyOf(again[0].puzzle), kit.keyOf(one[2].puzzle), 'next unseen puzzle of the same sequence');
  });

  test(`${game}: practice continues past puzzle 10 with fresh, verified, unseen puzzles`, () => {
    for (const set of g.sets) {
      const { puzzles } = load(game, set);
      const shipped = new Set(puzzles.map(kit.keyOf));
      const seen = createSeenList(memoryStorage());
      const slot = (k, cid = 'browser-a') => pickPracticePuzzle({ game, set, k, cid, make: (seed) => kit.make(set, seed, k), keyOf: kit.keyOf, shipped, seen });
      const keys = new Set();
      const ks = set === g.sets[0] ? [11, 12, 13, 25, 140] : [11, 12];
      for (const k of ks) {
        const p = slot(k);
        assert.ok(p, `set ${set} slot ${k}: built`);
        const key = kit.keyOf(p);
        assert.ok(!shipped.has(key) && !keys.has(key), `set ${set} slot ${k}: new puzzle`);
        g.verify(p, set);
        seen.add(game, key, practiceOwner(set, k));
        keys.add(key);
        // Reload: the same puzzle for the same browser; another browser gets another one.
        assert.equal(slot(k).id, p.id, `set ${set} slot ${k}: same after reload`);
        assert.notEqual(kit.keyOf(slot(k, 'browser-b')), key, `set ${set} slot ${k}: differs by browser`);
      }
    }
  });
}

// ---------------------------------------------------------------- Grid Memory (adaptive length)

const lengths = (cfg) => {
  const [lo, hi] = cfg.lengths;
  return Array.from({ length: 16 }, (_, i) => lo + (i % (hi - lo + 1)));
};

test('gridmemory: ranked trials are the same for everyone at the same lengths', () => {
  for (const set of [1, 2, 3, 4, 5]) {
    const cfg = gmConfig(set);
    const { puzzles } = load('gridmemory', set);
    const seed = rankedSeed('gridmemory', set);
    const run = () => withoutRandom(() => {
      const src = gm.createRunSource({ puzzles, cfg, seed, shuffle: false });
      return lengths(cfg).map((L) => src.next(L));
    });
    const a = run();
    const b = run();
    assert.deepEqual(a.map((x) => x.puzzle.id), b.map((x) => x.puzzle.id), `set ${set}`);
    for (const x of a) assert.deepEqual(gmCheck(x.puzzle, cfg), [], x.puzzle.id);
    assert.ok(a.some((x) => x.source === 'generated'), `set ${set}: goes past the shipped trials`);
  }
});

test('gridmemory: fresh timed trials differ by browser id and skip the seen-list', () => {
  const set = 2;
  const cfg = gmConfig(set);
  const { puzzles } = load('gridmemory', set);
  const shipped = new Set(puzzles.map(gm.trialKey));
  const mk = (cid, isSeen = () => false) => gm.createRunSource({ puzzles, cfg, seed: freshRunSeed(cid, 'gridmemory', set, 0), usePool: false, isSeen });
  const a = mk('browser-a');
  const b = mk('browser-b');
  const one = [3, 3, 4].map((L) => a.next(L));
  const two = [3, 3, 4].map((L) => b.next(L));
  assert.ok(one.every((x) => x.source === 'generated' && !shipped.has(gm.trialKey(x.puzzle))));
  assert.notDeepEqual(one.map((x) => gm.trialKey(x.puzzle)), two.map((x) => gm.trialKey(x.puzzle)));
  const seen = createSeenList(memoryStorage());
  seen.add('gridmemory', gm.trialKey(one[0].puzzle), 'f');
  const again = mk('browser-a', (key) => seen.has('gridmemory', key)).next(3);
  assert.notEqual(gm.trialKey(again.puzzle), gm.trialKey(one[0].puzzle));
  assert.deepEqual(gmCheck(again.puzzle, cfg), []);
});

test('gridmemory: practice trials past 10 follow the set\'s length ladder and validate', () => {
  for (const set of [1, 2, 3, 4, 5]) {
    const cfg = gmConfig(set);
    const { puzzles } = load('gridmemory', set);
    const shipped = new Set(puzzles.map(gm.freshKit.keyOf));
    const seen = createSeenList(memoryStorage());
    for (const k of [11, 12, 20]) {
      const p = pickPracticePuzzle({ game: 'gridmemory', set, k, cid: 'browser-a', make: (seed) => gm.freshKit.make(set, seed, k), keyOf: gm.freshKit.keyOf, shipped, seen });
      assert.ok(p, `set ${set} slot ${k}`);
      assert.deepEqual(gmCheck(p, cfg), [], p.id);
      assert.equal(p.length, puzzles[(k - 1) % puzzles.length].length, 'same length as the matching shipped trial');
      seen.add('gridmemory', gm.freshKit.keyOf(p), practiceOwner(set, k));
    }
  }
});

// ---------------------------------------------------------------- Block Slide ranked fallback

test('blockslide: ranked fallback is a fixed variant when a fresh puzzle cannot be built', () => {
  const { puzzles } = load('blockslide', 4);
  const seed = rankedSeed('blockslide', 4);
  // Seeds the generator cannot use come back as null for every player alike.
  const take = () => {
    let k = 0;
    return () => (k++ % 2 ? null : bs.transformPuzzle(puzzles[0], 'rot90'));
  };
  const ids = () => withoutRandom(() => draw(bs.createRunStream({ puzzles, seed, takeFresh: take(), shuffle: false, ordered: true }), 14)).map((x) => `${x.source}:${x.puzzle.id}`);
  const a = ids();
  assert.deepEqual(a, ids());
  assert.ok(a.slice(10).some((s) => s.startsWith('variant:')));
  // A repeat from the generator is not served twice in a run.
  assert.equal(a.slice(10).filter((s) => s.startsWith('generated:')).length, 1);
});
