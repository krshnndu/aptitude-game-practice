// Timed test puzzle stream (pure, no DOM).
//
// A run serves the shipped set in an order shuffled by the run seed, then fresh puzzles of the
// same set generated in the browser from seeds derived from the run seed. Generation is pure and
// takes a few milliseconds, so it runs inline. A skipped puzzle never comes back: fresh puzzles
// are checked against everything already served.

import { createRng } from '../../core/rng.js';
import { generateFresh, freshSeed, puzzleKey } from './gen.js';

// shuffle: false keeps the shipped order (the ranked run). usePool: false starts with fresh puzzles
// (fresh timed practice; the pool then only feeds the repeat safety net). isSeen(key): puzzles to
// skip besides the shipped ones (the local seen-list).
export function createRunStream({ puzzles, seed, setNo, makeFresh = generateFresh, shuffle = true, usePool = true, isSeen = () => false }) {
  if (!puzzles.length) throw new Error('empty puzzle pool');
  const rng = createRng(seed);
  const order = shuffle ? rng.shuffle(puzzles) : puzzles.slice();
  const seen = new Set(puzzles.map(puzzleKey));
  const poolSize = usePool ? order.length : 0;
  let drawn = 0;
  let freshK = 0;
  let repeats = 0;

  return {
    next() {
      let puzzle = null;
      let source;
      if (drawn < poolSize) {
        puzzle = order[drawn];
        source = 'pool';
      } else {
        for (let tries = 0; !puzzle && tries < 8; tries++) {
          const p = makeFresh(setNo, freshSeed(seed, freshK++), { seen: new Set(seen) });
          if (p && !seen.has(puzzleKey(p)) && !isSeen(puzzleKey(p))) {
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
      return poolSize;
    },
  };
}

// Practice slots past the shipped 10 and the seen-list use these. No seen option: the puzzle must
// rebuild from the seed in its id. No variant: the fallback is the shipped puzzle.
export const freshKit = { keyOf: puzzleKey, make: (setNo, seed) => generateFresh(setNo, seed) };

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
