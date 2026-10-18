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

export function createRunStream({ puzzles, seed, setNo, makeFresh = generateFresh }) {
  if (!puzzles.length) throw new Error('empty puzzle pool');
  const rng = createRng(seed);
  const order = rng.shuffle(puzzles);
  const seen = new Set(puzzles.map(questionKey));
  let drawn = 0;
  let k = 0;

  function fresh() {
    for (let tries = 0; tries < 50; tries++) {
      const p = makeFresh(setNo, freshSeed(seed, k++));
      const key = questionKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      return p;
    }
    throw new Error('could not draw a fresh puzzle');
  }

  return {
    next() {
      const source = drawn < order.length ? 'pool' : 'generated';
      const puzzle = source === 'pool' ? order[drawn] : fresh();
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
