// Timed test puzzle stream (pure, no DOM).
//
// A run draws the shipped set shuffled by the run seed. After that pool it serves fresh puzzles
// generated from seeds derived from the run seed: generation takes a few milliseconds, so it runs on
// the main thread between puzzles. If generation ever fails, the stream serves a variant of a shipped
// puzzle instead: rows and columns shuffled, maybe transposed, symbols renamed. That keeps the
// row and column structure, so the answer stays unique and the chain depth stays the same.

import { createRng } from '../../core/rng.js';
import { parsePuzzle, BLANK } from './state.js';
import { configFor, makePuzzle, buildPuzzle, pickSymbols, patternKey } from './gen.js';
import { deduce } from './solver.js';

// Seed for the k-th fresh puzzle of a run (k = 0, 1, ...).
export function freshSeed(runSeed, k) {
  return ((runSeed >>> 0) + Math.imul(k + 1, 0x9e3779b1)) >>> 0;
}

// One fresh puzzle for a set from a seed: blank count and target count drawn from the set's bands.
export function generateFresh(setNo, seed, { maxAttempts = 5000 } = {}) {
  const cfg = configFor(setNo);
  const rng = createRng(seed);
  for (let i = 0; i < maxAttempts; i++) {
    const blanks = rng.int(cfg.blanks[0], cfg.blanks[1]);
    const want = rng.int(cfg.targets[0], cfg.targets[1]);
    const p = makePuzzle(rng, cfg, blanks, want);
    if (p) return { id: `ls${setNo}-g${seed.toString(36)}`, ...p };
  }
  throw new Error(`set ${setNo}: no fresh puzzle after ${maxAttempts} attempts`);
}

// Same puzzle up to row order, column order, transposition and symbol names.
export function variantPuzzle(puzzle, seed, tag = seed.toString(36)) {
  const P = parsePuzzle(puzzle);
  const { n } = P;
  const rng = createRng(seed);
  const rowPerm = rng.shuffle([...Array(n).keys()]);
  const colPerm = rng.shuffle([...Array(n).keys()]);
  const flip = rng.chance(0.5);
  const symMap = rng.shuffle([...Array(n).keys()]);
  const symbols = pickSymbols(rng, n);
  const at = (r, c) => {
    const nr = rowPerm[r];
    const nc = colPerm[c];
    return flip ? nc * n + nr : nr * n + nc;
  };
  const grid = new Int8Array(n * n).fill(BLANK);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = P.grid[r * n + c];
      if (v !== BLANK) grid[at(r, c)] = symMap[v];
    }
  }
  const targets = P.targets.map((t) => at(Math.floor(t / n), t % n));
  const out = buildPuzzle(n, grid, targets, symbols, deduce(n, grid));
  return { id: `${puzzle.id}~${tag}`, ...out, variantOf: puzzle.id };
}

// makeFresh(k): returns the k-th fresh puzzle or throws. Defaults to generateFresh for setNo.
export function createRunStream({ puzzles, seed, setNo, makeFresh = (k) => generateFresh(setNo, freshSeed(seed, k)) }) {
  if (!puzzles.length) throw new Error('empty puzzle pool');
  const rng = createRng(seed);
  const order = rng.shuffle(puzzles);
  const seen = new Set(puzzles.map(patternKey));
  let drawn = 0;
  let freshK = 0;
  let variants = 0;

  function fresh() {
    for (let tries = 0; tries < 5; tries++) {
      let p;
      try {
        p = makeFresh(freshK++);
      } catch {
        continue;
      }
      if (!p) continue;
      const key = patternKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      return p;
    }
    return null;
  }

  function variant() {
    const v = variants++;
    const base = order[v % order.length];
    return variantPuzzle(base, freshSeed(seed ^ 0x51ed27, v), `v${v}`);
  }

  return {
    next() {
      let puzzle;
      let source;
      if (drawn < order.length) {
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
    get drawn() {
      return drawn;
    },
    get poolSize() {
      return order.length;
    },
  };
}

// Untimed sample on the pre-run screen: row 3 has triangle and circle, column 2 adds square, so the
// ? cell can only be diamond.
export const TUTORIAL_PUZZLE = {
  id: 'tutorial',
  n: 4,
  symbols: ['circle', 'square', 'triangle', 'diamond'],
  rows: ['CS.D', '.TD.', 'T.C.', 'DC.T'],
  targets: [[2, 1]],
  answers: ['D'],
  depth: 1,
  targetDepths: [1],
  blanks: 6,
  steps: 1,
};
