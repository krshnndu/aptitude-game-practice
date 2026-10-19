// Timed test puzzle stream (pure, no DOM).
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
// shuffle: false keeps the shipped order (the ranked run). usePool: false starts with fresh puzzles
// (fresh timed practice; the pool then only feeds reshuffled variants). isSeen(key): puzzles to skip
// besides the shipped ones (the local seen-list).
export function createRunStream({ puzzles, seed, takeFresh = () => null, shuffle = true, usePool = true, isSeen = () => false }) {
  if (!puzzles.length) throw new Error('empty puzzle pool');
  const rng = createRng(seed);
  const order = shuffle ? rng.shuffle(puzzles) : puzzles.slice();
  const seen = new Set(puzzles.map(puzzleKey));
  const poolSize = usePool ? order.length : 0;
  let drawn = 0;
  let freshK = 0;
  let variants = 0;
  return {
    next() {
      let puzzle = null;
      let source;
      if (drawn < poolSize) {
        puzzle = order[drawn];
        source = 'pool';
      } else {
        // Up to 3 failed draws, plus up to 40 draws skipped because this browser saw them already.
        for (let tries = 0, skips = 0; tries < 3 && skips < 40 && !puzzle;) {
          const fresh = takeFresh(freshK++);
          if (!fresh) break;
          const key = puzzleKey(fresh);
          if (seen.has(key)) {
            tries++;
            continue;
          }
          if (isSeen(key)) {
            skips++;
            continue;
          }
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
    get needsFresh() {
      return drawn >= poolSize;
    },
    get drawn() {
      return drawn;
    },
    get poolSize() {
      return poolSize;
    },
  };
}

// Practice slots past the shipped 10 and the seen-list use these. The variant (same rule, panels
// reshuffled) is only a fallback when no fresh puzzle can be built.
export const freshKit = {
  keyOf: puzzleKey,
  make: (setNo, seed) => generateFresh(setNo, seed),
  variant: (base, seed, k) => reshuffle(base, createRng(seed), `p${k}`),
};

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
