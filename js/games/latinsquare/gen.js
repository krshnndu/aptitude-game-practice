// Offline puzzle generator for Latin Square. Deterministic per seed (mulberry32).
//
// A puzzle starts from a random full Latin square (random backtracking fill, so every square shape
// can come up, not only shuffled copies of the cyclic one). Cells are blanked at random, then the
// deduction engine (solver.js) runs. A puzzle is kept only when:
//   - every target is forced by row and column elimination, so its answer is unique,
//   - the deepest target needs exactly the set's chain depth (and the others at least depth - 1),
//   - in naked-only sets, the target falls to a plain row plus column check from the givens,
//   - it is not a duplicate.
// The verifier re-checks uniqueness with an exhaustive search that does not use the deduction rules.

import { createRng } from '../../core/rng.js';
import { SYMBOLS, BLANK, gridRows } from './state.js';
import { deduce, chainFor } from './solver.js';

export const SET_CONFIGS = [
  { set: 1, name: 'Warm-up', n: 4, depth: 1, blanks: [5, 8], targets: [1, 1], nakedOnly: true, paceSec: 15, seed: 1701 },
  { set: 2, name: 'Five by five', n: 5, depth: 1, blanks: [8, 12], targets: [1, 1], nakedOnly: true, paceSec: 20, seed: 2702 },
  { set: 3, name: 'First chains', n: 5, depth: 2, blanks: [10, 14], targets: [1, 1], nakedOnly: false, paceSec: 30, seed: 3703 },
  { set: 4, name: 'Six by six', n: 6, depth: 2, blanks: [14, 18], targets: [1, 2], nakedOnly: false, paceSec: 40, seed: 4704 },
  { set: 5, name: 'Long chains', n: 6, depth: 3, blanks: [18, 22], targets: [2, 2], nakedOnly: false, paceSec: 55, seed: 5705 },
];

export const PUZZLES_PER_SET = 10;

export function configFor(setNo) {
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg) throw new Error(`unknown set ${setNo}`);
  return cfg;
}

// Random Latin square by backtracking, cell by cell in reading order, symbols tried in random order.
export function randomLatinSquare(rng, n) {
  const g = new Int8Array(n * n).fill(BLANK);
  const rowMask = new Int32Array(n);
  const colMask = new Int32Array(n);
  const order = [];
  for (let i = 0; i < n * n; i++) order.push(rng.shuffle([...Array(n).keys()]));
  function rec(i) {
    if (i === n * n) return true;
    const r = Math.floor(i / n);
    const c = i % n;
    for (const v of order[i]) {
      const bit = 1 << v;
      if (rowMask[r] & bit || colMask[c] & bit) continue;
      g[i] = v;
      rowMask[r] |= bit;
      colMask[c] |= bit;
      if (rec(i + 1)) return true;
      rowMask[r] &= ~bit;
      colMask[c] &= ~bit;
      g[i] = BLANK;
    }
    return false;
  }
  rec(0);
  return g;
}

export function puzzleKey(p) {
  return `${p.n}|${p.rows.join('/')}|${p.targets.map(([r, c]) => `${r},${c}`).join(';')}`;
}

// Shape-only key: same blanks and same symbol pattern up to renaming the symbols.
export function patternKey(p) {
  const map = new Map();
  const rows = p.rows.map((row) => [...row].map((ch) => {
    if (ch === '.') return '.';
    if (!map.has(ch)) map.set(ch, String.fromCharCode(97 + map.size));
    return map.get(ch);
  }).join(''));
  return `${p.n}|${rows.join('/')}|${p.targets.map(([r, c]) => `${r},${c}`).join(';')}`;
}

// One candidate puzzle with `blanks` blank cells, or null when this layout does not fit the config.
export function makePuzzle(rng, cfg, blanks, want = rng.int(cfg.targets[0], cfg.targets[1])) {
  const { n } = cfg;
  const square = randomLatinSquare(rng, n);
  const cells = rng.shuffle([...Array(n * n).keys()]);
  const grid = Int8Array.from(square);
  for (const x of cells.slice(0, blanks)) grid[x] = BLANK;

  const ded = deduce(n, grid);
  const deep = [];
  const near = [];
  for (let x = 0; x < n * n; x++) {
    if (grid[x] !== BLANK) continue;
    if (ded.round[x] === cfg.depth) deep.push(x);
    else if (ded.round[x] === cfg.depth - 1 && cfg.depth > 1) near.push(x);
  }
  if (!deep.length) return null;
  const main = rng.pick(deep);
  if (cfg.nakedOnly && ded.why[main].rule !== 'naked') return null;
  const targets = [main];
  if (want > 1) {
    // A second target from another row and column, so the two do not answer each other directly.
    const pool = rng.shuffle([...deep, ...near]).filter((x) => x !== main && Math.floor(x / n) !== Math.floor(main / n) && x % n !== main % n);
    if (!pool.length) return null;
    targets.push(pool[0]);
  }
  for (const t of targets) if (ded.value[t] !== square[t]) throw new Error('deduction disagrees with the source square');
  return buildPuzzle(n, grid, targets, pickSymbols(rng, n), ded);
}

// n of the six symbols for one puzzle, kept in palette order.
export function pickSymbols(rng, n) {
  return rng.shuffle([...Array(SYMBOLS.length).keys()]).slice(0, n).sort((a, b) => a - b).map((k) => SYMBOLS[k]);
}

// Puzzle JSON (without id) from a grid of givens, target cells and symbol objects.
export function buildPuzzle(n, grid, targets, symbols, ded = deduce(n, grid)) {
  const ts = targets.slice().sort((a, b) => a - b);
  if (ts.some((t) => ded.round[t] < 1)) throw new Error('a target is not forced by row and column elimination');
  return {
    n,
    symbols: symbols.map((s) => s.id),
    rows: gridRows(n, grid, symbols),
    targets: ts.map((t) => [Math.floor(t / n), t % n]),
    answers: ts.map((t) => symbols[ded.value[t]].letter),
    depth: Math.max(...ts.map((t) => ded.round[t])),
    targetDepths: ts.map((t) => ded.round[t]),
    blanks: grid.filter((v) => v === BLANK).length,
    steps: chainFor(ded, ts).length,
  };
}

// Blank count for puzzle k of `count`: spread evenly across the band, so the set climbs.
export function blanksFor(cfg, k, count) {
  const [lo, hi] = cfg.blanks;
  return count <= 1 ? lo : Math.round(lo + ((hi - lo) * k) / (count - 1));
}

export function generatePuzzles(cfg, { count = PUZZLES_PER_SET, seed = cfg.seed, maxAttempts = 20_000, seen = new Set(), log = null, blanks = null } = {}) {
  const rng = createRng(seed);
  const puzzles = [];
  let attempts = 0;
  for (let k = 0; k < count; k++) {
    const b = blanks ?? blanksFor(cfg, k, count);
    let p = null;
    while (!p) {
      if (++attempts > maxAttempts) throw new Error(`set ${cfg.set}: only ${puzzles.length}/${count} puzzles after ${maxAttempts} attempts`);
      // Sets with a target range alternate between its ends, so both kinds appear.
      const want = cfg.targets[0] + (k % (cfg.targets[1] - cfg.targets[0] + 1));
      const cand = makePuzzle(rng, cfg, b, want);
      if (!cand) continue;
      const key = patternKey(cand);
      if (seen.has(key)) continue;
      seen.add(key);
      p = cand;
    }
    puzzles.push(p);
    if (log) log(`  puzzle ${k + 1}: ${p.blanks} blanks, depth ${p.targetDepths.join('+')}, ${p.steps} steps (attempt ${attempts})`);
  }
  return puzzles;
}

export function generateSet(cfg, { count = PUZZLES_PER_SET, seed = cfg.seed, log = null } = {}) {
  const puzzles = generatePuzzles(cfg, { count, seed, log });
  // Present the set as a ladder: fewer steps and fewer blanks first.
  puzzles.sort((a, b) => a.steps - b.steps || a.targets.length - b.targets.length || a.blanks - b.blanks);
  const out = puzzles.map((p, k) => ({ id: `ls${cfg.set}-${String(k + 1).padStart(2, '0')}`, ...p }));
  return {
    game: 'latinsquare',
    version: 1,
    set: cfg.set,
    name: cfg.name,
    n: cfg.n,
    depth: cfg.depth,
    blanks: cfg.blanks,
    targets: cfg.targets,
    paceSec: cfg.paceSec,
    seed,
    puzzles: out,
  };
}
