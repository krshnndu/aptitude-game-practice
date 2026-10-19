// Timed test puzzle stream (pure, no DOM).
//
// A run first serves the set's shipped puzzles in an order shuffled by the run seed, then fresh
// puzzles generated in the page from seeds derived from the run seed. Generation is pure and takes
// well under a millisecond, so no worker is needed and the run never runs out. Duplicate questions
// are skipped.

import { createRng } from '../../core/rng.js';
import { generateFresh } from './gen.js';
import { questionKey } from './solver.js';

// Seed for the k-th fresh puzzle of a run (k = 0, 1, ...).
export function freshSeed(runSeed, k) {
  return ((runSeed >>> 0) + Math.imul(k + 1, 0x9e3779b1)) >>> 0;
}

// shuffle: false keeps the shipped order (the ranked run). usePool: false starts with fresh puzzles
// (fresh timed practice). isSeen(key): puzzles to skip besides the shipped ones (the local seen-list).
export function createRunStream({ puzzles, seed, setNo, makeFresh = generateFresh, shuffle = true, usePool = true, isSeen = () => false }) {
  if (!puzzles.length) throw new Error('empty puzzle pool');
  const rng = createRng(seed);
  const order = shuffle ? rng.shuffle(puzzles) : puzzles.slice();
  const seen = new Set(puzzles.map(questionKey));
  const poolSize = usePool ? order.length : 0;
  let drawn = 0;
  let k = 0;
  let repeats = 0;

  function fresh() {
    for (let tries = 0; tries < 200; tries++) {
      let p;
      try {
        p = makeFresh(setNo, freshSeed(seed, k++));
      } catch {
        continue;
      }
      if (!p) continue;
      const key = questionKey(p);
      if (seen.has(key) || isSeen(key)) continue;
      seen.add(key);
      return p;
    }
    // Last resort only: a shipped puzzle again, never an invalid one.
    return order[repeats++ % order.length];
  }

  return {
    next() {
      const source = drawn < poolSize ? 'pool' : 'generated';
      const puzzle = source === 'pool' ? order[drawn] : fresh();
      drawn++;
      return { puzzle, source: source === 'generated' && puzzles.includes(puzzle) ? 'pool' : source, index: drawn - 1 };
    },
    get drawn() {
      return drawn;
    },
    get poolSize() {
      return poolSize;
    },
  };
}

// Practice slots past the shipped 10 and the seen-list use these (fallback: the shipped puzzle).
export const freshKit = { keyOf: questionKey, make: (setNo, seed) => generateFresh(setNo, seed) };

// Untimed sample on the pre-run tutorial screen: one box, four options.
// Box 2 4 1 3 on circle, square, triangle, diamond gives square, diamond, circle, triangle.
export const TUTORIAL_PUZZLE = {
  id: 'tutorial',
  kind: 'forward',
  n: 4,
  start: 'CSTD',
  chains: [['2413']],
  hidden: null,
  target: null,
  options: ['SDCT', 'TCDS', 'SCDT', 'DSCT'],
  answer: 0,
  optimal: 1,
};
