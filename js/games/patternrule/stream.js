// Timed run puzzle stream (pure, no DOM).
//
// A run serves the set's 10 shipped puzzles in an order shuffled by the run seed, then fresh
// puzzles generated from seeds derived from the run seed (about 10 ms each, so the UI builds them
// on the main thread between puzzles). If generation fails, it cycles the shipped set again with
// panels and candidates reshuffled (same rule, same answer).

import { createRng } from '../../core/rng.js';
import { panelKey } from './rules.js';
import { generateFresh, generatePuzzle, configFor } from './gen.js';

export function freshSeed(runSeed, k) {
  return ((runSeed >>> 0) + Math.imul(k + 1, 0x9e3779b1)) >>> 0;
}

export function puzzleKey(p) {
  return [...p.fits, ...p.counters, ...p.candidates].map(panelKey).sort().join('/');
}

// Same puzzle with the order of fitting panels, does-not-fit panels and candidates reshuffled.
export function reshuffle(puzzle, rng, tag) {
  const order = rng.shuffle(puzzle.candidates.map((_, i) => i));
  const key = new Set(puzzle.answer);
  return {
    ...puzzle,
    id: `${puzzle.id}~${tag}`,
    variantOf: puzzle.id,
    fits: rng.shuffle(puzzle.fits),
    counters: rng.shuffle(puzzle.counters),
    candidates: order.map((i) => puzzle.candidates[i]),
    violates: order.map((i) => puzzle.violates[i]),
    answer: order.map((i, k) => (key.has(i) ? k : -1)).filter((k) => k >= 0),
  };
}

// takeFresh(k): returns the k-th fresh puzzle or null.
export function createRunStream({ puzzles, seed, takeFresh = () => null }) {
  if (!puzzles.length) throw new Error('empty puzzle pool');
  const rng = createRng(seed);
  const order = rng.shuffle(puzzles);
  const seen = new Set(puzzles.map(puzzleKey));
  let drawn = 0;
  let freshK = 0;
  let variants = 0;
  return {
    next() {
      let puzzle = null;
      let source;
      if (drawn < order.length) {
        puzzle = order[drawn];
        source = 'pool';
      } else {
        for (let tries = 0; tries < 3 && !puzzle; tries++) {
          const fresh = takeFresh(freshK++);
          if (!fresh) break;
          const key = puzzleKey(fresh);
          if (seen.has(key)) continue;
          seen.add(key);
          puzzle = fresh;
          source = 'generated';
        }
        if (!puzzle) {
          const v = variants++;
          puzzle = reshuffle(order[v % order.length], rng, `v${v + 1}`);
          source = 'variant';
        }
      }
      drawn++;
      return { puzzle, source, index: drawn - 1 };
    },
    get drawn() {
      return drawn;
    },
    get poolSize() {
      return order.length;
    },
  };
}

export function freshSource(setNo, runSeed) {
  return (k) => {
    try {
      return generateFresh(setNo, freshSeed(runSeed, k));
    } catch {
      return null;
    }
  };
}

// Untimed sample puzzle on the pre-run screen: a fixed-seed one-feature fill puzzle, regenerated
// identically on every load and checked by the tests.
export const TUTORIAL_SEED = 20261018;
export function tutorialPuzzle() {
  const cfg = { ...configFor(1), candidates: 4, positives: [1, 1] };
  const { puzzle } = generatePuzzle(cfg, createRng(TUTORIAL_SEED), 'fill-all');
  return { ...puzzle, id: 'tutorial' };
}
