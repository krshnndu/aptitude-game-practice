// Review library: every game's puzzles round trip through a stored reference (seed, id, variant
// permutation or compact encoding) back to the identical puzzle, with a matching checksum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../js/core/rng.js';
import { readBlob, BLOB_CAP } from '../js/core/learn-util.js';
import * as bs from '../js/games/blockslide/review.js';
import * as ls from '../js/games/latinsquare/review.js';
import * as gm from '../js/games/gridmemory/review.js';
import * as os from '../js/games/operatorswitch/review.js';
import * as de from '../js/games/digitequation/review.js';
import * as pr from '../js/games/patternrule/review.js';
import { loadSet as bsSet } from '../tools/verify.mjs';
import { loadSet as lsSet } from '../tools/latinsquare-verify.mjs';
import { loadSet as gmSet } from '../tools/gridmemory-verify.mjs';
import { loadSet as osSet } from '../tools/operatorswitch-verify.mjs';
import { loadSet as deSet } from '../tools/digitequation-verify.mjs';
import { loadSet as prSet } from '../tools/patternrule-verify.mjs';
import { transformPuzzle, generateFresh as bsFresh } from '../js/games/blockslide/stream.js';
import { variantPuzzle, freshSeed as lsFreshSeed, generateFresh as lsFresh } from '../js/games/latinsquare/stream.js';
import { generateFresh as gmFresh, configFor as gmCfg } from '../js/games/gridmemory/gen.js';
import { generateFresh as osFresh } from '../js/games/operatorswitch/gen.js';
import { generateFresh as deFresh } from '../js/games/digitequation/gen.js';
import { generateFresh as prFresh } from '../js/games/patternrule/gen.js';
import { reshuffle } from '../js/games/patternrule/stream.js';

const GAMES = [
  ['blockslide', bs, bsSet],
  ['latinsquare', ls, lsSet],
  ['gridmemory', gm, gmSet],
  ['operatorswitch', os, osSet],
  ['digitequation', de, deSet],
  ['patternrule', pr, prSet],
];

// Store the reference as JSON (as localStorage would), then rebuild.
function roundTrip(adapter, puzzle, set, setData, opts) {
  const attempt = { puzzleId: puzzle.id, set };
  const ref = JSON.parse(JSON.stringify(adapter.refFor(attempt, puzzle, opts)));
  assert.equal(ref.gv, adapter.GENERATOR_VERSION);
  assert.ok(!('grid' in ref) && !('puzzle' in ref), 'never stores a raw board');
  const again = adapter.regenerate(ref, adapter.needsSet(ref) ? setData : null);
  assert.ok(again, `${puzzle.id} rebuilds`);
  assert.equal(adapter.checksum(again), ref.check, `${puzzle.id} checksum`);
  return { ref, again };
}

for (const [game, adapter, loadSet] of GAMES) {
  test(`${game}: every pool puzzle round trips from its id`, () => {
    for (let s = 1; s <= 5; s++) {
      const data = loadSet(s);
      for (const p of data.puzzles) {
        const { ref, again } = roundTrip(adapter, p, s, data);
        assert.equal(ref.src, 'pool');
        assert.equal(ref.blob, undefined, 'pool puzzles store no encoding');
        assert.deepEqual(again, p);
      }
    }
  });
}

test('blockslide: generated puzzles from the seed, variants from the transform name, slow sets via encoding', () => {
  for (const s of [1, 2]) {
    const p = bsFresh(s, 4242 + s);
    const { ref, again } = roundTrip(bs, p, s, null);
    assert.equal(ref.src, 'generated');
    assert.equal(ref.blob, undefined);
    assert.deepEqual(again, p);
  }
  const base = bsSet(2).puzzles[3];
  const v = transformPuzzle(base, 'rot90');
  const { ref, again } = roundTrip(bs, v, 2, bsSet(2));
  assert.equal(ref.v, 'rot90');
  assert.deepEqual(again, v);
  // Sets 4 and 5 take seconds to generate: the reference keeps a capped compact encoding.
  const slow = { ...bsSet(4).puzzles[0], id: 'bs4-gabc' };
  const r4 = roundTrip(bs, slow, 4, null);
  assert.ok(r4.ref.blob && r4.ref.blob.length <= BLOB_CAP);
  assert.deepEqual(r4.again, slow);
  assert.equal(bs.slowRebuild({ src: 'generated', set: 5 }), true);
});

test('latinsquare: generated from seed; run variants from the run seed, or an encoding when the run is lost', () => {
  const g = lsFresh(3, 777);
  assert.deepEqual(roundTrip(ls, g, 3, null).again, g);
  const data = lsSet(4);
  const runSeed = 0xdeadbeef;
  const v = variantPuzzle(data.puzzles[2], lsFreshSeed(runSeed ^ 0x51ed27, 3), 'v3');
  const withRun = roundTrip(ls, v, 4, data, { run: { seed: runSeed } });
  assert.equal(withRun.ref.blob, undefined);
  assert.deepEqual(withRun.again, v);
  const lost = roundTrip(ls, v, 4, data, {});
  assert.ok(lost.ref.blob);
  assert.equal(readBlob(lost.ref.blob).rows.join('/'), v.rows.join('/'));
});

test('gridmemory: generated trials from their id', () => {
  for (const s of [1, 3, 5]) {
    const p = gmFresh(gmCfg(s), 4, 999 + s);
    const { ref, again } = roundTrip(gm, p, s, null);
    assert.equal(ref.src, 'generated');
    assert.deepEqual(again, p);
  }
});

test('operatorswitch and digitequation: generated puzzles from their seed; digitequation repeats map to the pool', () => {
  for (const s of [1, 4]) {
    const p = osFresh(s, 31337 + s);
    assert.deepEqual(roundTrip(os, p, s, null).again, p);
    const q = deFresh(s, 31337 + s);
    const r = roundTrip(de, q, s, null);
    assert.equal(r.ref.blob, undefined, 'seed alone rebuilds it');
    assert.deepEqual(r.again, q);
  }
  const data = deSet(2);
  const rep = { ...data.puzzles[1], id: `${data.puzzles[1].id}~r1` };
  assert.deepEqual(roundTrip(de, rep, 2, data).again, rep);
  // A generated puzzle whose seed no longer rebuilds it (a skipped duplicate in the run) keeps an encoding.
  const odd = { ...data.puzzles[4], id: 'de2-g1' };
  const r = roundTrip(de, odd, 2, null);
  assert.ok(r.ref.blob);
});

test('patternrule: generated from seed; variants via a stored permutation', () => {
  const p = prFresh(2, 2024);
  assert.deepEqual(roundTrip(pr, p, 2, null).again, p);
  const data = prSet(3);
  const base = data.puzzles[5];
  const v = reshuffle(base, createRng(99), 'v2');
  const { ref, again } = roundTrip(pr, v, 3, data, { base });
  assert.ok(Array.isArray(ref.perm.k));
  assert.deepEqual(again, v);
});

test('a changed generator is detected by the checksum, not silently replayed', () => {
  const data = osSet(1);
  const p = data.puzzles[0];
  const ref = os.refFor({ puzzleId: p.id, set: 1 }, p);
  const changed = { ...data, puzzles: [{ ...p, answer: (p.answer + 1) % p.options.length }, ...data.puzzles.slice(1)] };
  assert.notEqual(os.checksum(os.regenerate(ref, changed)), ref.check);
});
