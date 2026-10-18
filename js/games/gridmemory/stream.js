// Timed test trial stream for Grid Memory: an adaptive staircase on sequence length, fed first from
// the set's shipped puzzles (shuffled by the run seed) and then from freshly generated trials.
// Generation takes well under a millisecond, so runs never stall and never run out.

import { createRng } from '../../core/rng.js';
import { generateFresh, freshSeed, generateTrial } from './gen.js';

export const MIN_LENGTH = 2;

// One up, one down: a passed trial makes the next one longer, a failed or skipped one shorter.
export function createStaircase({ start, min = MIN_LENGTH, max }) {
  let length = Math.max(min, Math.min(max, start));
  const trail = [];
  return {
    get length() {
      return length;
    },
    get trail() {
      return trail.slice();
    },
    // Longest length passed so far (0 when none).
    get maxSpan() {
      return trail.reduce((m, s) => (s.success && s.length > m ? s.length : m), 0);
    },
    update(success) {
      trail.push({ length, success: !!success });
      length = success ? Math.min(max, length + 1) : Math.max(min, length - 1);
      return length;
    },
  };
}

export function maxSpanOf(trail) {
  return trail.reduce((m, s) => (s.success && s.length > m ? s.length : m), 0);
}

// next(length) -> { puzzle, source: 'pool' | 'generated', index }.
export function createRunSource({ puzzles, cfg, seed }) {
  const rng = createRng(seed);
  const pool = new Map();
  for (const p of rng.shuffle(puzzles)) {
    if (!pool.has(p.length)) pool.set(p.length, []);
    pool.get(p.length).push(p);
  }
  let index = 0;
  let freshK = 0;
  return {
    next(length) {
      const fromPool = pool.get(length)?.shift();
      const puzzle = fromPool ?? generateFresh(cfg, length, freshSeed(seed, freshK++));
      return { puzzle, source: fromPool ? 'pool' : 'generated', index: index++ };
    },
  };
}

// The untimed sample trial before a run: length 2 with the set's own side questions and timing.
export function tutorialTrial(cfg) {
  return generateTrial(createRng(0x6d656d + cfg.set), cfg, 2, `gm${cfg.set}-sample`);
}
