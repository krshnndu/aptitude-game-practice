// Circles variant of Grid Memory: no grid. Circles sit at free positions in a square play area,
// some of them light up one after another (a side question after each, as in the grid variant),
// then the player taps the lit circles in the same order. Offline seeded generator (mulberry32).
//
// Circle sets are stored as sets 6..10 of the gridmemory game (circle level k is set 5 + k), so
// progress, unlocking, history and review never mix with the grid sets 1..5.
//
// A trial is kept only when:
//   - every circle centre lies inside the margin and every two centres are at least minDist apart
//     (at 360 px wide this keeps 44 px tap targets apart),
//   - the sequence has `length` distinct circles,
//   - the side questions follow the same rules as the grid variant (shared makeDistractors),
//   - no sequence repeats inside a set.

import { createRng } from '../../core/rng.js';
import { makeDistractors, lengthLadder, PUZZLES_PER_SET, GAP_MS } from './gen.js';

export const VARIANT = 'circles';
export const CIRCLE_SET_BASE = 5;
// Centres stay this far from every edge (a 44 px circle at a 328 px wide area is 0.134 across).
export const MARGIN = 0.08;
const DECIMALS = 1000;

export const CIRCLE_CONFIGS = [
  {
    set: 6, level: 1, name: 'Warm-up', circles: 6, minDist: 0.26, lengths: [3, 4], kinds: ['sym'], showMs: 1000, windowMs: 8000,
    pauseMs: 0, shapeSize: 5, asymDiff: [3, 4], arith: null, runMax: 6, seed: 6101,
  },
  {
    set: 7, level: 2, name: 'Quick sums', circles: 8, minDist: 0.24, lengths: [4, 5], kinds: ['parity'], showMs: 900, windowMs: 6000,
    pauseMs: 0, shapeSize: 5, asymDiff: [2, 3], arith: { ops: ['+'], lo: 1, hi: 9 }, runMax: 7, seed: 7102,
  },
  {
    set: 8, level: 3, name: 'Switching tasks', circles: 10, minDist: 0.21, lengths: [5, 6], kinds: ['sym', 'parity'], showMs: 850, windowMs: 5000,
    pauseMs: 1000, shapeSize: 5, asymDiff: [2, 2], arith: { ops: ['+', '-'], lo: 2, hi: 20 }, runMax: 9, seed: 8103,
  },
  {
    set: 9, level: 4, name: 'Crowded', circles: 12, minDist: 0.19, lengths: [6, 7], kinds: ['sym', 'parity'], showMs: 800, windowMs: 4000,
    pauseMs: 1500, shapeSize: 6, asymDiff: [1, 2], arith: { ops: ['+', '-', '*'], lo: 2, hi: 30 }, runMax: 10, seed: 9104,
  },
  {
    set: 10, level: 5, name: 'Expert', circles: 14, minDist: 0.18, lengths: [7, 8], kinds: ['sym', 'parity'], showMs: 700, windowMs: 3000,
    pauseMs: 2000, shapeSize: 6, asymDiff: [1, 1], arith: { ops: ['+', '-', '*'], lo: 6, hi: 60 }, runMax: 11, seed: 10105,
  },
];

export const isCircleSet = (setNo) => CIRCLE_CONFIGS.some((c) => c.set === setNo);
export const circleSetOf = (level) => CIRCLE_SET_BASE + level;
export const levelOf = (setNo) => setNo - CIRCLE_SET_BASE;

export function circleConfigFor(setNo) {
  const cfg = CIRCLE_CONFIGS.find((c) => c.set === setNo);
  if (!cfg) throw new Error(`unknown circles set ${setNo}`);
  return cfg;
}

export function circleTrialSeconds(cfg, length) {
  return Math.round((length * (cfg.showMs + 2 * GAP_MS + cfg.windowMs / 2) + cfg.pauseMs + length * 1200) / 1000);
}

const round = (v) => Math.round(v * DECIMALS) / DECIMALS;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// `count` centres inside the margin, pairwise at least minDist apart, in reading order (top to
// bottom, then left to right) so "circle 1" is the topmost one.
export function drawLayout(rng, count, minDist) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const pts = [];
    for (let tries = 0; tries < 4000 && pts.length < count; tries++) {
      const p = [round(MARGIN + rng.next() * (1 - 2 * MARGIN)), round(MARGIN + rng.next() * (1 - 2 * MARGIN))];
      if (pts.every((q) => dist(p, q) >= minDist)) pts.push(p);
    }
    if (pts.length === count) return pts.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }
  throw new Error(`could not place ${count} circles ${minDist} apart`);
}

export function generateCircleTrial(rng, cfg, length, id) {
  if (length > cfg.circles) throw new Error(`length ${length} does not fit ${cfg.circles} circles`);
  const circles = drawLayout(rng, cfg.circles, cfg.minDist);
  const sequence = rng.shuffle(circles.map((_, i) => i)).slice(0, length);
  const distractors = makeDistractors(rng, cfg, length);
  return {
    id, var: VARIANT, circles, length, sequence, showMs: cfg.showMs, windowMs: cfg.windowMs, pauseMs: cfg.pauseMs, distractors,
  };
}

export function circlePuzzleId(setNo, k) {
  return `gc${levelOf(setNo)}-${String(k).padStart(2, '0')}`;
}

export function generateCircleSet(cfg, { count = PUZZLES_PER_SET, seed = cfg.seed } = {}) {
  const rng = createRng(seed);
  const seen = new Set();
  const puzzles = [];
  for (const length of lengthLadder(cfg, count)) {
    let p;
    for (let tries = 0; ; tries++) {
      if (tries > 200) throw new Error(`circles set ${cfg.level}: no new trial of length ${length}`);
      p = generateCircleTrial(rng, cfg, length, circlePuzzleId(cfg.set, puzzles.length + 1));
      const key = circleKey(p);
      if (!seen.has(key)) {
        seen.add(key);
        break;
      }
    }
    puzzles.push(p);
  }
  return {
    game: 'gridmemory',
    var: VARIANT,
    version: 1,
    set: cfg.set,
    level: cfg.level,
    name: cfg.name,
    circles: cfg.circles,
    minDist: cfg.minDist,
    lengths: cfg.lengths,
    kinds: cfg.kinds,
    showMs: cfg.showMs,
    windowMs: cfg.windowMs,
    pauseMs: cfg.pauseMs,
    seed,
    puzzles,
  };
}

// Identity of a circles trial for the seen-list: layout, order and side questions.
export function circleKey(p) {
  const side = (p.distractors ?? []).map((d) => (d.kind === 'sym' ? `s${d.rows.join('/')}` : `p${d.a}${d.op}${d.b}`)).join(';');
  return `c|${p.circles.map((c) => c.join(':')).join(' ')}|${p.sequence.join(',')}|${side}`;
}

// A fresh circles trial; the id encodes level, seed and length so it rebuilds from the id alone.
export function generateCircleFresh(cfg, length, seed) {
  return generateCircleTrial(createRng(seed), cfg, length, `gc${cfg.level}-g${seed.toString(36)}-${length}`);
}

export const CIRCLE_FRESH_ID = /^gc(\d)-g([0-9a-z]+)-(\d+)$/;
export const CIRCLE_POOL_ID = /^gc(\d)-(\d\d)(?:~.*)?$/;

export function circleTrialFromId(id) {
  const m = CIRCLE_FRESH_ID.exec(id ?? '');
  if (!m) return null;
  const cfg = CIRCLE_CONFIGS.find((c) => c.level === Number(m[1]));
  if (!cfg) return null;
  return generateCircleFresh(cfg, Number(m[3]), parseInt(m[2], 36));
}

// A shipped circles trial rebuilt from its fixed set seed (review needs no set file).
export function circlePoolTrial(id) {
  const m = CIRCLE_POOL_ID.exec(id ?? '');
  if (!m) return null;
  const cfg = CIRCLE_CONFIGS.find((c) => c.level === Number(m[1]));
  const base = `gc${m[1]}-${m[2]}`;
  const p = cfg ? generateCircleSet(cfg).puzzles.find((x) => x.id === base) : null;
  return p ? { ...p, id } : null;
}

export const circleFreshKit = {
  keyOf: circleKey,
  make: (setNo, seed, k) => {
    const cfg = circleConfigFor(setNo);
    return generateCircleFresh(cfg, lengthLadder(cfg)[(k - 1) % PUZZLES_PER_SET], seed);
  },
};

export function circleTutorialTrial(cfg) {
  return generateCircleTrial(createRng(0x636972 + cfg.level), cfg, 2, `gc${cfg.level}-sample`);
}
