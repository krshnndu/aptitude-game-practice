// Timed test puzzle stream (pure, no DOM).
//
// A run draws the shipped set shuffled by the run seed. When that pool is exhausted it takes
// fresh puzzles generated from seeds derived from the run seed (built in a worker by the UI).
// If no fresh puzzle is ready yet, it serves a rotated or mirrored copy of a shipped puzzle:
// same optimum by symmetry, available instantly, so the clock never waits for the generator.

import { createRng } from '../../core/rng.js';
import { DIRS } from './state.js';
import { configFor, generateSet, layoutKey } from './gen.js';

// The eight symmetries of the square. Each maps (r, c) on an n x n board.
export const TRANSFORMS = {
  id: (r, c) => [r, c],
  rot90: (r, c, n) => [c, n - 1 - r],
  rot180: (r, c, n) => [n - 1 - r, n - 1 - c],
  rot270: (r, c, n) => [n - 1 - c, r],
  flipH: (r, c, n) => [r, n - 1 - c],
  flipV: (r, c, n) => [n - 1 - r, c],
  transpose: (r, c) => [c, r],
  antitranspose: (r, c, n) => [n - 1 - c, n - 1 - r],
};
export const VARIANT_TRANSFORMS = Object.keys(TRANSFORMS).filter((t) => t !== 'id');

const SIDE_DIR = { top: 'U', bottom: 'D', left: 'L', right: 'R' };
const DIR_SIDE = { U: 'top', D: 'bottom', L: 'left', R: 'right' };

function mapDir(f, n, d) {
  // Map the step from a centre-ish cell; the linear part of the symmetry is what matters.
  const [r0, c0] = f(1, 1, n);
  const [r1, c1] = f(1 + DIRS[d].dr, 1 + DIRS[d].dc, n);
  const dr = r1 - r0;
  const dc = c1 - c0;
  return Object.keys(DIRS).find((k) => DIRS[k].dr === dr && DIRS[k].dc === dc);
}

export function transformPuzzle(puzzle, name) {
  const f = TRANSFORMS[name];
  if (!f) throw new Error(`unknown transform ${name}`);
  const { n } = puzzle;
  const cell = (r, c) => {
    const [nr, nc] = f(r, c, n);
    return { r: nr, c: nc };
  };
  const blocks = puzzle.blocks.map((b) => {
    const cells = [];
    for (let k = 0; k < b.len; k++) cells.push(cell(b.dir === 'h' ? b.r : b.r + k, b.dir === 'h' ? b.c + k : b.c));
    const r = Math.min(...cells.map((x) => x.r));
    const c = Math.min(...cells.map((x) => x.c));
    const dir = b.len === 1 ? 'h' : cells.every((x) => x.r === cells[0].r) ? 'h' : 'v';
    return { r, c, len: b.len, dir };
  });
  const exitCell = cell(puzzle.exit.r, puzzle.exit.c);
  const out = {
    ...puzzle,
    id: name === 'id' ? puzzle.id : `${puzzle.id}~${name}`,
    exit: { ...exitCell, side: DIR_SIDE[mapDir(f, n, SIDE_DIR[puzzle.exit.side])] },
    walls: (puzzle.walls || []).map(([r, c]) => {
      const x = cell(r, c);
      return [x.r, x.c];
    }),
    ball: cell(puzzle.ball.r, puzzle.ball.c),
    blocks,
    solution: (puzzle.solution || []).map((m) => ({ p: m.p, d: mapDir(f, n, m.d) })),
  };
  if (name !== 'id') out.variantOf = puzzle.id;
  return out;
}

// Seed for the k-th fresh puzzle of a run (k = 0, 1, ...).
export function freshSeed(runSeed, k) {
  return ((runSeed >>> 0) + Math.imul(k + 1, 0x9e3779b1)) >>> 0;
}

// One fresh puzzle for a set from a seed. In-browser generation uses a smaller solver budget
// than the shipped sets: layouts that exceed it are simply rejected, the optimum stays exact.
export function generateFresh(setNo, seed, { maxStates = 300_000, maxAttempts = 50_000 } = {}) {
  const data = generateSet(configFor(setNo), { count: 1, seed, maxStates, maxAttempts });
  return { ...data.puzzles[0], id: `bs${setNo}-g${seed.toString(36)}` };
}

// takeFresh(): returns a fresh puzzle or null when none is ready.
// shuffle: false keeps the shipped order (the ranked run). usePool: false starts with fresh puzzles
// (fresh timed practice; the pool is then only the source of variants). ordered: one takeFresh()
// per fresh slot and a variant when it yields nothing new, so the sequence depends only on the
// seed and not on how fast puzzles were built (the ranked run waits for each one instead).
// isSeen(key): puzzles to skip besides the shipped ones (the local seen-list).
export function createRunStream({ puzzles, seed, takeFresh = () => null, shuffle = true, usePool = true, ordered = false, isSeen = () => false }) {
  if (!puzzles.length) throw new Error('empty puzzle pool');
  const rng = createRng(seed);
  const order = shuffle ? rng.shuffle(puzzles) : puzzles.slice();
  const transforms = rng.shuffle(VARIANT_TRANSFORMS);
  const seen = new Set(puzzles.map(layoutKey));
  const poolSize = usePool ? order.length : 0;
  let drawn = 0;
  let variants = 0;

  function variant() {
    const v = variants++;
    const base = order[v % order.length];
    const t = transforms[Math.floor(v / order.length) % transforms.length];
    return transformPuzzle(base, t);
  }

  function fresh() {
    if (ordered) {
      const p = takeFresh();
      if (!p) return null;
      const key = layoutKey(p);
      if (seen.has(key)) return null;
      seen.add(key);
      return p;
    }
    let tries = 0;
    for (let p = takeFresh(); p && tries < 40; p = takeFresh(), tries++) {
      const key = layoutKey(p);
      if (seen.has(key) || isSeen(key)) continue;
      seen.add(key);
      return p;
    }
    return null;
  }

  return {
    next() {
      let puzzle;
      let source;
      if (drawn < poolSize) {
        puzzle = order[drawn];
        source = 'pool';
      } else {
        puzzle = fresh();
        source = 'generated';
        if (!puzzle) {
          puzzle = variant();
          source = 'variant';
        }
      }
      drawn++;
      return { puzzle, source, index: drawn - 1 };
    },
    // True when the next puzzle comes from the generator (the UI may wait for it).
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

// Practice slots past the shipped 10 and the seen-list use these.
export const freshKit = { keyOf: layoutKey, make: (setNo, seed) => generateFresh(setNo, seed) };

// Untimed sample puzzle on the pre-run tutorial screen: one blocker in the ball's lane.
export const TUTORIAL_PUZZLE = {
  id: 'tutorial',
  n: 4,
  exit: { r: 3, c: 3, side: 'right' },
  walls: [],
  ball: { r: 3, c: 0 },
  blocks: [
    { r: 3, c: 2, len: 1, dir: 'h' },
    { r: 2, c: 0, len: 2, dir: 'h' },
  ],
  optimal: 4,
  solution: [
    { p: 1, d: 'U' },
    { p: 0, d: 'R' },
    { p: 0, d: 'R' },
    { p: 0, d: 'R' },
  ],
};
