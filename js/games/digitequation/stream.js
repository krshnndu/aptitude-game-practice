// Timed run puzzle stream (pure, no DOM).
//
// A run serves the shipped set in an order shuffled by the run seed, then fresh puzzles of the
// same set generated in the browser from seeds derived from the run seed. Generation is pure and
// takes a few milliseconds, so it runs inline. A skipped puzzle never comes back: fresh puzzles
// are checked against everything already served.

import { createRng } from '../../core/rng.js';
import { generateFresh, freshSeed, puzzleKey } from './gen.js';

export function createRunStream({ puzzles, seed, setNo, makeFresh = generateFresh }) {
  if (!puzzles.length) throw new Error('empty puzzle pool');
  const rng = createRng(seed);
  const order = rng.shuffle(puzzles);
  const seen = new Set(puzzles.map(puzzleKey));
  let drawn = 0;
  let freshK = 0;
  let repeats = 0;

  return {
    next() {
      let puzzle = null;
      let source;
      if (drawn < order.length) {
        puzzle = order[drawn];
        source = 'pool';
      } else {
        for (let tries = 0; !puzzle && tries < 8; tries++) {
          const p = makeFresh(setNo, freshSeed(seed, freshK++), { seen: new Set(seen) });
          if (p && !seen.has(puzzleKey(p))) {
            seen.add(puzzleKey(p));
            puzzle = p;
          }
        }
        source = 'generated';
        if (!puzzle) {
          // Safety net only: generation found nothing new, so reuse a shipped puzzle.
          puzzle = { ...order[repeats % order.length], id: `${order[repeats % order.length].id}~r${repeats}` };
          repeats++;
          source = 'repeat';
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

// Untimed sample puzzle on the pre-run tutorial screen: one blank, two decoys.
export const TUTORIAL_PUZZLE = {
  id: 'de-tutorial',
  tokens: ['3_', '+', '4', '=', '41'],
  tray: [{ d: 1, n: 1 }, { d: 7, n: 1 }, { d: 9, n: 1 }],
  blanks: 1,
  optimal: 1,
  answer: [7],
  solutions: 1,
  unique: true,
  decoys: 2,
  difficulty: 0,
};
