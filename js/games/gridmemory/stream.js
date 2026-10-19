// Timed test trial stream for Grid Memory: an adaptive staircase on sequence length, fed first from
// the set's shipped puzzles (shuffled by the run seed) and then from freshly generated trials.
// Generation takes well under a millisecond, so runs never stall and never run out.

import { createRng } from '../../core/rng.js';
import { generateFresh, freshSeed, generateTrial, configFor, lengthLadder, PUZZLES_PER_SET } from './gen.js';
import { isCircleSet, circleKey, generateCircleFresh, circleFreshKit, circleTutorialTrial } from './circles.js';
import { isCircles } from './state.js';

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

// Identity of a trial for the seen-list: grid, path and side questions. The path alone is not
// enough (set 1 has only 72 paths of length 2).
export function trialKey(p) {
  if (isCircles(p)) return circleKey(p);
  const side = (p.distractors ?? []).map((d) => (d.kind === 'sym' ? `s${d.rows.join('/')}` : `p${d.a}${d.op}${d.b}`)).join(';');
  return `${p.n}|${p.sequence.join(',')}|${side}`;
}

// Fresh trials tried for one request before giving up on the seen-list (then the last valid one).
const FRESH_TRIES = 30;

// next(length) -> { puzzle, source: 'pool' | 'generated', index }.
// shuffle: false keeps the shipped order inside each length (the ranked run). usePool: false serves
// only generated trials (fresh timed practice). isSeen(key): trials to skip (the local seen-list).
// A generated trial's seed depends on the run seed, its length and how many trials of that length
// this run already generated, not on the path through the staircase: two ranked players who reach
// a length the same number of times see the same trials there.
export function createRunSource({ puzzles, cfg, seed, shuffle = true, usePool = true, isSeen = () => false }) {
  const rng = createRng(seed);
  const make = isCircleSet(cfg.set) ? generateCircleFresh : generateFresh;
  const pool = new Map();
  const shipped = new Set(puzzles.map(trialKey));
  if (usePool) {
    for (const p of shuffle ? rng.shuffle(puzzles) : puzzles) {
      if (!pool.has(p.length)) pool.set(p.length, []);
      pool.get(p.length).push(p);
    }
  }
  const served = new Set();
  const perLength = new Map();
  let index = 0;
  function fresh(length) {
    let last = null;
    for (let tries = 0; tries < FRESH_TRIES; tries++) {
      const n = perLength.get(length) ?? 0;
      perLength.set(length, n + 1);
      const p = make(cfg, length, freshSeed(seed, length * 100_000 + n));
      const key = trialKey(p);
      last = p;
      if (shipped.has(key) || served.has(key) || isSeen(key)) continue;
      served.add(key);
      return p;
    }
    return last;
  }
  return {
    next(length) {
      const fromPool = pool.get(length)?.shift();
      const puzzle = fromPool ?? fresh(length);
      return { puzzle, source: fromPool ? 'pool' : 'generated', index: index++ };
    },
  };
}

// Practice slots past the shipped 10 follow the set's length ladder; the id rebuilds the trial.
export const freshKit = {
  keyOf: trialKey,
  make: (setNo, seed, k) => {
    if (isCircleSet(setNo)) return circleFreshKit.make(setNo, seed, k);
    const cfg = configFor(setNo);
    return generateFresh(cfg, lengthLadder(cfg)[(k - 1) % PUZZLES_PER_SET], seed);
  },
};

// The untimed sample trial before a run: length 2 with the set's own side questions and timing.
export function tutorialTrial(cfg) {
  if (isCircleSet(cfg.set)) return circleTutorialTrial(cfg);
  return generateTrial(createRng(0x6d656d + cfg.set), cfg, 2, `gm${cfg.set}-sample`);
}
