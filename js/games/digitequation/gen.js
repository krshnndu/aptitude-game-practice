// Offline (and in-browser) puzzle generator for Digit Equation. Deterministic per seed (mulberry32).
// A puzzle is kept only when:
//   - the true equation has whole, non-negative numbers and every division is exact,
//   - the brute-force solver finds exactly one way to fill the blanks from the tray,
//   - at least one blank is on the left side,
//   - in sets with mixed precedence, reading left to right would give a different value
//     (so the order of operations matters),
//   - it is not a duplicate of an earlier puzzle.

import { createRng } from '../../core/rng.js';
import { parsePuzzle, evalValues, evalLeftToRight } from './state.js';
import { solve } from './solver.js';
import { difficultyOf, explainPuzzle } from './explain.js';

// shapes: equation templates the set draws from (see SHAPES). decoys: extra tiles in the tray.
export const SET_CONFIGS = [
  { set: 1, name: 'Warm-up', blanks: 1, ops: ['+', '-'], shapes: ['add', 'sub'], decoys: [2, 3], paceSec: 15, seed: 7101 },
  { set: 2, name: 'Times tables', blanks: 2, ops: ['x'], need: ['x'], shapes: ['mul21', 'mul12', 'mul22s'], decoys: [2, 3], paceSec: 25, seed: 7202 },
  { set: 3, name: 'Order of operations', blanks: 2, ops: ['+', '-', 'x'], need: ['x'], mixed: true, shapes: ['addMul', 'mulSub', 'subMul', 'mulAddMul'], decoys: [3, 4], paceSec: 35, seed: 7303 },
  { set: 4, name: 'Bigger numbers', blanks: 3, ops: ['+', '-', 'x'], shapes: ['mul21big', 'add32', 'sub32', 'mul22', 'addMulBig'], decoys: [3, 4], paceSec: 45, seed: 7404 },
  { set: 5, name: 'Division and decoys', blanks: 3, ops: ['+', '-', 'x', '/'], need: ['/'], shapes: ['div31', 'divAdd', 'mulDiv', 'subDiv', 'divMul'], decoys: [4, 6], paceSec: 55, seed: 7505 },
];

export const PUZZLES_PER_SET = 10;

export function configFor(setNo) {
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg) throw new Error(`unknown set ${setNo}`);
  return cfg;
}

// Each shape returns { values, ops } for the left side; the right side is the single result.
export const SHAPES = {
  add: (r) => ({ values: [r.int(10, 89), r.chance(0.3) ? r.int(2, 9) : r.int(10, 89)], ops: ['+'] }),
  sub: (r) => {
    const a = r.int(20, 99);
    return { values: [a, r.int(2, a - 5)], ops: ['-'] };
  },
  mul21: (r) => ({ values: [r.int(12, 49), r.int(3, 9)], ops: ['x'] }),
  mul12: (r) => ({ values: [r.int(3, 9), r.int(12, 39)], ops: ['x'] }),
  mul22s: (r) => ({ values: [r.int(11, 19), r.int(11, 19)], ops: ['x'] }),
  addMul: (r) => ({ values: [r.int(2, 30), r.int(2, 9), r.int(2, 9)], ops: ['+', 'x'] }),
  mulSub: (r) => ({ values: [r.int(3, 9), r.int(4, 12), r.int(2, 19)], ops: ['x', '-'] }),
  subMul: (r) => ({ values: [r.int(40, 99), r.int(2, 9), r.int(2, 6)], ops: ['-', 'x'] }),
  mulAddMul: (r) => ({ values: [r.int(2, 9), r.int(2, 9), r.int(2, 9), r.int(2, 9)], ops: ['x', '+', 'x'] }),
  mul21big: (r) => ({ values: [r.int(21, 99), r.int(4, 9)], ops: ['x'] }),
  add32: (r) => ({ values: [r.int(120, 899), r.int(12, 99)], ops: ['+'] }),
  sub32: (r) => {
    const a = r.int(150, 999);
    return { values: [a, r.int(12, 99)], ops: ['-'] };
  },
  mul22: (r) => ({ values: [r.int(11, 31), r.int(11, 31)], ops: ['x'] }),
  addMulBig: (r) => ({ values: [r.int(12, 99), r.int(11, 29), r.int(3, 9)], ops: ['+', 'x'] }),
  div31: (r) => {
    const b = r.int(3, 9);
    const q = r.int(Math.ceil(100 / b), Math.floor(999 / b));
    return { values: [b * q, b], ops: ['/'] };
  },
  divAdd: (r) => {
    const b = r.int(2, 9);
    const q = r.int(3, 19);
    return { values: [b * q, b, r.int(2, 49)], ops: ['/', '+'] };
  },
  mulDiv: (r) => {
    const a = r.int(2, 19);
    const b = r.int(2, 19);
    // Divide by a one-digit divisor of a x b so the division is exact.
    const divisors = [2, 3, 4, 5, 6, 7, 8, 9].filter((c) => (a * b) % c === 0 && c !== a && c !== b);
    if (!divisors.length) return { values: [a, b, 1], ops: ['x', '/'] };
    return { values: [a, b, r.pick(divisors)], ops: ['x', '/'] };
  },
  subDiv: (r) => {
    const c = r.int(2, 9);
    const q = r.int(2, 12);
    return { values: [r.int(q + 5, 99), c * q, c], ops: ['-', '/'] };
  },
  divMul: (r) => {
    const b = r.int(2, 9);
    const q = r.int(2, 12);
    return { values: [b * q, b, r.int(2, 9)], ops: ['/', 'x'] };
  },
};

// Equation key for duplicate detection: shape of the equation plus the tray.
export function puzzleKey(p) {
  return `${p.tokens.join(' ')}|${p.tray.map((t) => `${t.d}x${t.n}`).join(',')}`;
}

function buildTokens(values, ops, result) {
  const tokens = [];
  values.forEach((v, i) => {
    if (i) tokens.push(ops[i - 1]);
    tokens.push(String(v));
  });
  tokens.push('=', String(result));
  return tokens;
}

// One random candidate puzzle (not yet checked for uniqueness), or null.
export function randomCandidate(rng, cfg) {
  const shape = SHAPES[rng.pick(cfg.shapes)];
  const { values, ops } = shape(rng);
  const res = evalValues(values, ops);
  if (!res.ok || res.value < 0 || res.value > 9999) return null;
  if (cfg.mixed) {
    const ltr = evalLeftToRight(values, ops);
    if (ltr.ok && ltr.value === res.value) return null;
  }
  const tokens = buildTokens(values, ops, res.value);
  // Digit positions that may hold a blank.
  const positions = [];
  tokens.forEach((t, ti) => {
    if (!/^\d+$/.test(t)) return;
    for (let p = 0; p < t.length; p++) positions.push({ ti, p, left: ti < tokens.indexOf('=') });
  });
  const chosen = rng.shuffle(positions).slice(0, cfg.blanks);
  if (chosen.length < cfg.blanks || !chosen.some((x) => x.left)) return null;
  // No number fully blank when it has 3 digits (too little to reason from).
  const perToken = new Map();
  for (const c of chosen) perToken.set(c.ti, (perToken.get(c.ti) ?? 0) + 1);
  for (const [ti, k] of perToken) if (k >= 3 && tokens[ti].length === k) return null;
  const answerByPos = new Map(chosen.map((c) => [`${c.ti}:${c.p}`, Number(tokens[c.ti][c.p])]));
  const blanked = tokens.map((t, ti) => (/^\d+$/.test(t) ? [...t].map((ch, p) => (answerByPos.has(`${ti}:${p}`) ? '_' : ch)).join('') : t));
  // Answer in reading order.
  const answer = [];
  blanked.forEach((t, ti) => {
    if (!/^[0-9_]+$/.test(t)) return;
    for (let p = 0; p < t.length; p++) if (t[p] === '_') answer.push(answerByPos.get(`${ti}:${p}`));
  });
  const counts = new Array(10).fill(0);
  for (const d of answer) counts[d]++;
  const decoys = rng.int(cfg.decoys[0], cfg.decoys[1]);
  let added = 0;
  for (let tries = 0; added < decoys && tries < 100; tries++) {
    const d = rng.int(0, 9);
    if (counts[d] >= 2) continue;
    counts[d]++;
    added++;
  }
  if (added < decoys) return null;
  const tray = [];
  counts.forEach((n, d) => n && tray.push({ d, n }));
  if (tray.length < Math.min(4, cfg.blanks + 2)) return null;
  return { tokens: blanked, tray, blanks: cfg.blanks, optimal: cfg.blanks, answer, decoys };
}

// Find one unique puzzle. Returns the puzzle (with solver facts) or null after maxAttempts.
export function findPuzzle(rng, cfg, { maxAttempts = 5000, seen = null } = {}) {
  for (let a = 0; a < maxAttempts; a++) {
    const p = randomCandidate(rng, cfg);
    if (!p) continue;
    const key = puzzleKey(p);
    if (seen && seen.has(key)) continue;
    parsePuzzle(p);
    const res = solve(p);
    if (!res.unique) continue;
    if (res.solutions[0].some((d, i) => d !== p.answer[i])) continue;
    const ex = explainPuzzle(p);
    if (!ex.solved) continue;
    seen?.add(key);
    return { ...p, solutions: res.count, unique: true, difficulty: difficultyOf(p, ex), attempts: a + 1 };
  }
  return null;
}

export function generateSet(cfg, { count = PUZZLES_PER_SET, seed = cfg.seed, log = null } = {}) {
  const rng = createRng(seed);
  const seen = new Set();
  const puzzles = [];
  // Draw more than needed, then keep a spread: the set is a ladder from easier to harder.
  const pool = [];
  const want = count * 3;
  let guard = 0;
  while (pool.length < want && guard++ < want * 20) {
    const p = findPuzzle(rng, cfg, { seen });
    if (p) pool.push(p);
  }
  if (pool.length < count) throw new Error(`set ${cfg.set}: only ${pool.length}/${count} unique puzzles`);
  pool.sort((a, b) => a.difficulty - b.difficulty || puzzleKey(a).localeCompare(puzzleKey(b)));
  for (let k = 0; k < count; k++) {
    const idx = Math.round((k * (pool.length - 1)) / (count - 1 || 1));
    puzzles.push(pool[idx]);
  }
  const out = puzzles.map((p, k) => {
    const { attempts, ...rest } = p;
    return { id: `de${cfg.set}-${String(k + 1).padStart(2, '0')}`, ...rest };
  });
  if (log) for (const p of out) log(`  ${p.id}: ${p.tokens.join(' ')}  tray ${p.tray.map((t) => (t.n > 1 ? `${t.d}x${t.n}` : t.d)).join(' ')}  difficulty ${p.difficulty}`);
  return {
    game: 'digitequation',
    version: 1,
    set: cfg.set,
    name: cfg.name,
    blanks: cfg.blanks,
    paceSec: cfg.paceSec,
    seed,
    puzzles: out,
  };
}

// Seed for the k-th fresh puzzle of a run (k = 0, 1, ...).
export function freshSeed(runSeed, k) {
  return ((runSeed >>> 0) + Math.imul(k + 1, 0x9e3779b1)) >>> 0;
}

// One fresh puzzle for a timed test: pure, synchronous, a few milliseconds.
export function generateFresh(setNo, seed, { seen = null } = {}) {
  const cfg = configFor(setNo);
  const rng = createRng(seed);
  const p = findPuzzle(rng, cfg, { seen, maxAttempts: 20000 });
  if (!p) return null;
  const { attempts, ...rest } = p;
  return { id: `de${setNo}-g${seed.toString(36)}`, ...rest };
}
