// Offline seeded generator for Grid Memory (mulberry32, deterministic per seed).
// A trial is kept only when:
//   - the sequence has `length` distinct cells and (from set 3) does not lie on one straight line,
//   - every side question carries the answer computed from its own content,
//   - asymmetric shapes differ from their mirror image in exactly `asymDiff` cell pairs (few
//     pairs = subtle), symmetric shapes in none, and every shape is one 4-connected piece,
//   - no shape repeats inside a trial and no sequence repeats inside a set.

import { createRng } from '../../core/rng.js';
import { mirrorMismatches, arithValue, parityOf, correctAnswer } from './state.js';

export const SET_CONFIGS = [
  {
    set: 1, name: 'Warm-up', n: 3, lengths: [2, 3], kinds: ['sym'], showMs: 1000, windowMs: 8000,
    shapeSize: 5, asymDiff: [3, 4], arith: null, noLine: false, runMax: 8, seed: 1301,
  },
  {
    set: 2, name: 'Quick sums', n: 4, lengths: [3, 4], kinds: ['parity'], showMs: 900, windowMs: 6000,
    shapeSize: 5, asymDiff: [2, 3], arith: { ops: ['+'], lo: 1, hi: 9 }, noLine: false, runMax: 9, seed: 2302,
  },
  {
    set: 3, name: 'Switching tasks', n: 4, lengths: [4, 5], kinds: ['sym', 'parity'], showMs: 850, windowMs: 5000,
    shapeSize: 5, asymDiff: [2, 2], arith: { ops: ['+', '-'], lo: 2, hi: 20 }, noLine: true, runMax: 10, seed: 3303,
  },
  {
    set: 4, name: 'Bigger grid', n: 5, lengths: [4, 6], kinds: ['sym', 'parity'], showMs: 800, windowMs: 4000,
    shapeSize: 6, asymDiff: [1, 2], arith: { ops: ['+', '-', '*'], lo: 2, hi: 30 }, noLine: true, runMax: 11, seed: 4304,
  },
  {
    set: 5, name: 'Expert', n: 5, lengths: [5, 7], kinds: ['sym', 'parity'], showMs: 700, windowMs: 3000,
    shapeSize: 6, asymDiff: [1, 1], arith: { ops: ['+', '-', '*'], lo: 6, hi: 60 }, noLine: true, runMax: 12, seed: 5305,
  },
];

export const PUZZLES_PER_SET = 10;
// Gap between a highlight and its side question, and between an answer and the next highlight.
export const GAP_MS = 300;

export function configFor(setNo) {
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg) throw new Error(`unknown set ${setNo}`);
  return cfg;
}

// Rough seconds one trial takes at this set's timing (side answers at about half the window).
export function trialSeconds(cfg, length) {
  return Math.round((length * (cfg.showMs + 2 * GAP_MS + cfg.windowMs / 2) + length * 1200) / 1000);
}

// Lengths for the 10 puzzles of a set: a ladder from the low end of the band to the high end.
export function lengthLadder(cfg, count = PUZZLES_PER_SET) {
  const [lo, hi] = cfg.lengths;
  const span = hi - lo + 1;
  return Array.from({ length: count }, (_, k) => lo + Math.floor((k * span) / count));
}

// ---------------------------------------------------------------- shapes

export function isConnected(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const filled = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (rows[r][c] === '#') filled.push(r * w + c);
  if (!filled.length) return false;
  const seen = new Set([filled[0]]);
  const stack = [filled[0]];
  while (stack.length) {
    const k = stack.pop();
    const r = Math.floor(k / w);
    const c = k % w;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= h || cc >= w || rows[rr][cc] !== '#') continue;
      const kk = rr * w + cc;
      if (!seen.has(kk)) {
        seen.add(kk);
        stack.push(kk);
      }
    }
  }
  return seen.size === filled.length;
}

function fillRatio(rows) {
  const all = rows.join('');
  return [...all].filter((ch) => ch === '#').length / all.length;
}

const toRows = (grid) => grid.map((row) => row.map((x) => (x ? '#' : '.')).join(''));

function okShape(rows) {
  const f = fillRatio(rows);
  // Off-centre cells exist (else the shape is a bare centre line) and the shape is one piece.
  const offCentre = rows.some((row) => [...row].some((ch, c) => ch === '#' && 2 * c + 1 !== row.length));
  return f >= 0.3 && f <= 0.72 && offCentre && isConnected(rows);
}

export function symmetricShape(rng, size) {
  for (let tries = 0; tries < 500; tries++) {
    const half = Math.ceil(size / 2);
    const grid = [];
    for (let r = 0; r < size; r++) {
      const row = new Array(size).fill(0);
      for (let c = 0; c < half; c++) {
        const bit = rng.chance(0.5) ? 1 : 0;
        row[c] = bit;
        row[size - 1 - c] = bit;
      }
      grid.push(row);
    }
    const rows = toRows(grid);
    if (okShape(rows)) return rows;
  }
  throw new Error('could not draw a symmetric shape');
}

// A symmetric shape with exactly `diff` mirror pairs broken.
export function asymmetricShape(rng, size, diff) {
  for (let tries = 0; tries < 500; tries++) {
    const base = symmetricShape(rng, size).map((row) => [...row].map((ch) => (ch === '#' ? 1 : 0)));
    const pairs = [];
    for (let r = 0; r < size; r++) for (let c = 0; c < Math.floor(size / 2); c++) pairs.push([r, c]);
    for (const [r, c] of rng.shuffle(pairs).slice(0, diff)) {
      // Flip one side of the pair at random: the pair now differs.
      const side = rng.chance(0.5) ? c : size - 1 - c;
      base[r][side] ^= 1;
    }
    const rows = toRows(base);
    if (okShape(rows) && mirrorMismatches(rows) === diff) return rows;
  }
  throw new Error('could not draw an asymmetric shape');
}

// ---------------------------------------------------------------- arithmetic

export function arithItem(rng, arith, want) {
  for (let tries = 0; tries < 500; tries++) {
    const op = rng.pick(arith.ops);
    let a;
    let b;
    if (op === '*') {
      a = rng.int(2, Math.min(12, Math.max(4, Math.floor(arith.hi / 5))));
      b = rng.int(2, 9);
    } else {
      a = rng.int(arith.lo, arith.hi);
      b = rng.int(arith.lo, arith.hi);
      if (op === '-' && b > a) [a, b] = [b, a];
      if (op === '-' && a === b) continue;
    }
    const item = { kind: 'parity', a, op, b };
    if (arithValue(item) >= 0 && parityOf(arithValue(item)) === want) return { ...item, answer: want };
  }
  throw new Error(`could not draw a ${want} sum`);
}

// ---------------------------------------------------------------- trials

// Half one answer, half the other (the odd one out at random), shuffled.
function balanced(rng, options, count) {
  const first = rng.chance(0.5) ? 0 : 1;
  const list = Array.from({ length: count }, (_, i) => options[(i + first) % 2]);
  return rng.shuffle(list);
}

export function collinear(n, cells) {
  if (cells.length < 3) return true;
  const pts = cells.map((x) => [Math.floor(x / n), x % n]);
  const [r0, c0] = pts[0];
  const [r1, c1] = pts[1];
  return pts.every(([r, c]) => (r1 - r0) * (c - c0) - (c1 - c0) * (r - r0) === 0);
}

function drawSequence(rng, cfg, length) {
  const cells = Array.from({ length: cfg.n * cfg.n }, (_, i) => i);
  for (let tries = 0; tries < 200; tries++) {
    const seq = rng.shuffle(cells).slice(0, length);
    if (cfg.noLine && length >= 3 && collinear(cfg.n, seq)) continue;
    return seq;
  }
  throw new Error('could not draw a sequence');
}

export function generateTrial(rng, cfg, length, id) {
  if (length > cfg.n * cfg.n) throw new Error(`length ${length} does not fit a ${cfg.n}x${cfg.n} grid`);
  const sequence = drawSequence(rng, cfg, length);
  const distractors = makeDistractors(rng, cfg, length);
  return { id, n: cfg.n, length, sequence, showMs: cfg.showMs, windowMs: cfg.windowMs, distractors };
}

// One side question per highlight, answers balanced, no shape repeated (shared with circles.js).
export function makeDistractors(rng, cfg, length) {
  const kinds = cfg.kinds.length === 1 ? new Array(length).fill(cfg.kinds[0]) : balanced(rng, cfg.kinds, length);
  const symAnswers = balanced(rng, ['yes', 'no'], kinds.filter((k) => k === 'sym').length);
  const parAnswers = balanced(rng, ['even', 'odd'], kinds.filter((k) => k === 'parity').length);
  const usedShapes = new Set();
  const distractors = kinds.map((kind) => {
    if (kind === 'parity') return arithItem(rng, cfg.arith, parAnswers.shift());
    const want = symAnswers.shift();
    for (let tries = 0; tries < 50; tries++) {
      const rows = want === 'yes'
        ? symmetricShape(rng, cfg.shapeSize)
        : asymmetricShape(rng, cfg.shapeSize, rng.int(cfg.asymDiff[0], cfg.asymDiff[1]));
      const key = rows.join('/');
      if (usedShapes.has(key)) continue;
      usedShapes.add(key);
      return { kind: 'sym', rows, answer: want };
    }
    throw new Error('could not draw distinct shapes');
  });
  for (const d of distractors) {
    if (correctAnswer(d) !== d.answer) throw new Error(`generator bug: stored answer ${d.answer} is wrong`);
  }
  return distractors;
}

export function puzzleId(setNo, k) {
  return `gm${setNo}-${String(k).padStart(2, '0')}`;
}

export function generateSet(cfg, { count = PUZZLES_PER_SET, seed = cfg.seed } = {}) {
  const rng = createRng(seed);
  const seen = new Set();
  const puzzles = [];
  for (const length of lengthLadder(cfg, count)) {
    let p;
    for (let tries = 0; ; tries++) {
      if (tries > 200) throw new Error(`set ${cfg.set}: no new sequence of length ${length}`);
      p = generateTrial(rng, cfg, length, puzzleId(cfg.set, puzzles.length + 1));
      const key = p.sequence.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        break;
      }
    }
    puzzles.push(p);
  }
  return {
    game: 'gridmemory',
    version: 1,
    set: cfg.set,
    name: cfg.name,
    n: cfg.n,
    lengths: cfg.lengths,
    kinds: cfg.kinds,
    showMs: cfg.showMs,
    windowMs: cfg.windowMs,
    seed,
    puzzles,
  };
}

// Seed for the k-th fresh trial of a run (32-bit mix of the run seed and k).
export function freshSeed(runSeed, k) {
  let h = (runSeed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// A fresh trial of any length for a timed test. The id encodes set, seed and length, so the same
// trial can be rebuilt later from the id alone (see trialFromId).
export function generateFresh(cfg, length, seed) {
  return generateTrial(createRng(seed), cfg, length, `gm${cfg.set}-g${seed.toString(36)}-${length}`);
}

export function trialFromId(id) {
  const m = /^gm(\d)-g([0-9a-z]+)-(\d+)$/.exec(id ?? '');
  if (!m) return null;
  const cfg = SET_CONFIGS.find((c) => c.set === Number(m[1]));
  if (!cfg) return null;
  return generateFresh(cfg, Number(m[3]), parseInt(m[2], 36));
}
