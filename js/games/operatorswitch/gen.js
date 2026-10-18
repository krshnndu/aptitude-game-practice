// Seeded puzzle generator for Operator Switch. Pure and fast (well under a millisecond per
// puzzle), so the same code builds the shipped sets offline and fresh puzzles in the page during a
// timed test. Deterministic per seed (mulberry32).
//
// A puzzle is kept only when:
//   - every box moves at least n - 1 items (at most one fixed point) and is not the identity,
//   - no two neighbouring boxes cancel out and the whole chain changes the start,
//   - set 1 boxes are not self-inverse, so reading a box backwards gives a different answer,
//   - the solver (solver.js, independent code) finds exactly one correct option,
//   - it is not a duplicate of an earlier question in the set.
// Wrong options come first from named misreadings (state.js MISTAKES), then from one-swap slips,
// then from random rearrangements.

import { createRng } from '../../core/rng.js';
import {
  ITEM_CODES, identityOp, opBetween, composeOps, fixedPoints, isInvolution,
  chainResult, runChain, chainMistakes, hiddenMistakes, swapSlots, correctValue,
} from './state.js';
import { solvePuzzle, questionKey } from './solver.js';

export const SET_CONFIGS = [
  { set: 1, name: 'One box', kind: 'forward', n: 4, boxes: [1, 1], options: [4, 4], paceSec: 12, seed: 7101 },
  { set: 2, name: 'Two boxes', kind: 'forward', n: 4, boxes: [2, 2], options: [4, 5], paceSec: 20, seed: 7202 },
  { set: 3, name: 'Three boxes', kind: 'forward', n: 4, boxes: [3, 3], options: [5, 5], paceSec: 28, seed: 7303 },
  { set: 4, name: 'Hidden box', kind: 'hidden', n: 4, boxes: [2, 3], options: [5, 5], paceSec: 40, seed: 7404 },
  { set: 5, name: 'Five items, four boxes', kind: 'forward', n: 5, boxes: [4, 4], options: [6, 6], twins: 3, twinBoxes: [3, 3], paceSec: 50, seed: 7505 },
];

export const PUZZLES_PER_SET = 10;
export const GAME_ID = 'operatorswitch';

export function configFor(setNo) {
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg) throw new Error(`unknown set ${setNo}`);
  return cfg;
}

export function puzzleId(setNo, k) {
  return `os${setNo}-${String(k).padStart(2, '0')}`;
}

function randomOp(rng, n, { noInvolution = false } = {}) {
  for (let tries = 0; tries < 200; tries++) {
    const op = rng.shuffle([...identityOp(n)]).join('');
    if (fixedPoints(op) > 1) continue;
    if (noInvolution && isInvolution(op)) continue;
    return op;
  }
  throw new Error('could not draw an operator');
}

// Boxes for one chain: neighbours never cancel and the whole chain changes the start.
function randomChain(rng, n, len, opts = {}) {
  for (let tries = 0; tries < 200; tries++) {
    const ops = [];
    let ok = true;
    for (let k = 0; k < len && ok; k++) {
      const op = randomOp(rng, n, opts);
      const prev = ops[k - 1];
      if (prev && (op === prev || composeOps(prev, op) === identityOp(n))) ok = false;
      ops.push(op);
    }
    if (!ok) continue;
    if (chainResult(identityOp(n), ops) === identityOp(n)) continue;
    return ops;
  }
  throw new Error('could not draw a chain');
}

function randomStart(rng, n) {
  return rng.shuffle(rng.shuffle(ITEM_CODES).slice(0, n)).join('');
}

// Fills `need` distractors: named misreadings first (in order), then slips, then random draws.
function pickDistractors(rng, right, named, { need, slipsFirst = 0, slipMaker, randomMaker, exclude = () => false, keepFirst = false }) {
  const out = [];
  const seen = new Set([right]);
  const take = (v) => {
    if (out.length >= need || seen.has(v) || exclude(v)) return;
    seen.add(v);
    out.push(v);
  };
  // keepFirst: slips that leave slot 1 alone come first, so slot 1 alone does not settle it.
  const shuffled = rng.shuffle(slipMaker());
  const slips = keepFirst ? [...shuffled.filter((v) => v[0] === right[0]), ...shuffled.filter((v) => v[0] !== right[0])] : shuffled;
  // Keep room for a few one-swap slips: they share most slots with the answer, so the
  // "eliminate by slot 1" habit has to be followed by a second slot.
  const namedRoom = Math.max(0, need - slipsFirst);
  for (const v of named) if (out.length < namedRoom) take(v);
  for (const v of slips) take(v);
  for (let tries = 0; out.length < need && tries < 500; tries++) take(randomMaker());
  if (out.length < need) throw new Error('not enough distinct distractors');
  return out;
}

function arrangementSlips(right) {
  const out = [];
  for (let i = 0; i < right.length; i++) for (let j = i + 1; j < right.length; j++) out.push(swapSlots(right, i, j));
  return out;
}

// Difficulty score used to order a set as a ladder (easy first). Counts the work (items moved by
// each box), how hidden the gap is, and how many wrong options agree with the answer in slot 1
// (those cannot be ruled out by the first slot alone).
export function difficulty(p) {
  const right = correctValue(p);
  // Two chains: only the shorter one has to be worked, plus spotting that and checking.
  const chainWork = p.chains.map((c) => c.filter(Boolean).reduce((s, op) => s + op.length - fixedPoints(op), 0));
  const work = p.kind === 'twin' ? Math.min(...chainWork) : chainWork.reduce((a, b) => a + b, 0);
  const sameFirst = p.options.filter((o, i) => i !== p.answer && o[0] === right[0]).length;
  let gap = 0;
  if (p.kind === 'hidden') {
    const len = p.chains[0].length;
    gap = p.hidden.at === len - 1 ? 2 : p.hidden.at === 0 ? 5 : 7;
  }
  const twin = p.kind === 'twin' ? 6 : 0;
  return work + gap + twin + 2 * sameFirst + p.options.length;
}

function finish(p, rng, values) {
  const order = rng.shuffle(values.map((v, i) => i));
  const options = order.map((i) => values[i]);
  const answer = order.indexOf(0);
  const puzzle = { ...p, options, answer, optimal: 1 };
  const res = solvePuzzle(puzzle);
  if (res.correct.length !== 1 || res.correct[0] !== answer) throw new Error(`generator produced ${res.correct.length} correct options`);
  puzzle.difficulty = difficulty(puzzle);
  return puzzle;
}

export function makeForward(rng, { n, boxes, options, noInvolution = false, keepFirst = false }) {
  const start = randomStart(rng, n);
  const ops = randomChain(rng, n, boxes, { noInvolution });
  const right = chainResult(start, ops);
  const named = chainMistakes(start, ops).map((m) => m.value);
  const distractors = pickDistractors(rng, right, named, {
    need: options - 1,
    slipsFirst: boxes === 1 ? options - 2 : 1,
    slipMaker: () => arrangementSlips(right),
    randomMaker: () => rng.shuffle([...right]).join(''),
    exclude: (v) => v === start,
    keepFirst,
  });
  return finish({ kind: 'forward', n, start, chains: [ops], hidden: null, target: null }, rng, [right, ...distractors]);
}

export function makeTwin(rng, { n, boxes, twinBoxes, options, keepFirst = false }) {
  const start = randomStart(rng, n);
  const opsA = randomChain(rng, n, boxes);
  const right = chainResult(start, opsA);
  let opsB = null;
  for (let tries = 0; tries < 200 && !opsB; tries++) {
    const len = rng.int(twinBoxes[0], twinBoxes[1]);
    const head = randomChain(rng, n, len - 1);
    const last = opBetween(runChain(start, head).pop(), right);
    if (fixedPoints(last) > 1) continue;
    const prev = head[head.length - 1];
    if (prev && (last === prev || composeOps(prev, last) === identityOp(n))) continue;
    opsB = [...head, last];
  }
  if (!opsB) throw new Error('could not draw a second chain');
  // Interleave the two chains' misreadings so both chains are represented.
  const a = chainMistakes(start, opsA).map((m) => m.value);
  const b = chainMistakes(start, opsB).map((m) => m.value);
  const named = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) named.push(...[a[i], b[i]].filter(Boolean));
  const distractors = pickDistractors(rng, right, named, {
    need: options - 1,
    slipsFirst: 1,
    slipMaker: () => arrangementSlips(right),
    randomMaker: () => rng.shuffle([...right]).join(''),
    exclude: (v) => v === start,
    keepFirst,
  });
  return finish({ kind: 'twin', n, start, chains: [opsA, opsB], hidden: null, target: null }, rng, [right, ...distractors]);
}

export function makeHidden(rng, { n, boxes, options, at = null, keepFirst = false }) {
  const start = randomStart(rng, n);
  const ops = randomChain(rng, n, boxes);
  const gap = at ?? rng.int(0, boxes - 1);
  const target = chainResult(start, ops);
  const right = ops[gap];
  const chain = ops.map((o, k) => (k === gap ? null : o));
  const base = { kind: 'hidden', n, start, chains: [chain], hidden: { chain: 0, at: gap }, target };
  const named = hiddenMistakes(base).map((m) => m.value);
  const id = identityOp(n);
  const distractors = pickDistractors(rng, right, named, {
    need: options - 1,
    slipsFirst: 1,
    slipMaker: () => arrangementSlips(right),
    randomMaker: () => rng.shuffle([...id]).join(''),
    exclude: (v) => v === id,
    keepFirst,
  });
  return finish(base, rng, [right, ...distractors]);
}

// Spread an integer range evenly across `count` slots: slot k of count.
function spread([lo, hi], k, count) {
  return lo + Math.floor((k * (hi - lo + 1)) / count);
}

// Parameters for puzzle k of a set (k = 0..count-1), before the ladder sort.
function slotParams(cfg, k, count) {
  const base = { n: cfg.n, options: spread(cfg.options, k, count), noInvolution: cfg.set === 1, keepFirst: cfg.set >= 2 };
  const twins = cfg.twins ?? 0;
  if (twins && k >= count - twins) return { ...base, kind: 'twin', boxes: cfg.boxes[1], twinBoxes: cfg.twinBoxes };
  const boxes = spread(cfg.boxes, k, count);
  // Gap position cycles last, earlier, ... so a set mixes forward-only, backward-only and both.
  if (cfg.kind === 'hidden') return { ...base, kind: 'hidden', boxes, at: boxes - 1 - (k % boxes) };
  return { ...base, kind: 'forward', boxes };
}

export function makePuzzle(rng, params) {
  if (params.kind === 'hidden') return makeHidden(rng, params);
  if (params.kind === 'twin') return makeTwin(rng, params);
  return makeForward(rng, params);
}

export function generateSet(cfg, { count = PUZZLES_PER_SET, seed = cfg.seed, maxAttempts = 5000, log = null } = {}) {
  const rng = createRng(seed);
  const puzzles = [];
  const seen = new Set();
  let attempts = 0;
  for (let k = 0; k < count; k++) {
    let puzzle = null;
    while (!puzzle) {
      if (++attempts > maxAttempts) throw new Error(`set ${cfg.set}: only ${puzzles.length}/${count} puzzles after ${maxAttempts} attempts`);
      const params = slotParams(cfg, k, count);
      let p;
      try {
        p = makePuzzle(rng, params);
      } catch {
        continue;
      }
      const key = questionKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      puzzle = p;
    }
    puzzles.push(puzzle);
  }
  // Present the set as a ladder: easier puzzles first (stable on ties).
  const ordered = puzzles.map((p, i) => ({ p, i })).sort((a, b) => a.p.difficulty - b.p.difficulty || a.i - b.i).map((x) => x.p);
  const out = ordered.map((p, i) => ({ id: puzzleId(cfg.set, i + 1), ...p }));
  if (log) for (const p of out) log(`  ${p.id}: ${p.kind}, ${p.chains.map((c) => c.length).join('+')} boxes, ${p.options.length} options, difficulty ${p.difficulty}`);
  return {
    game: GAME_ID,
    version: 1,
    set: cfg.set,
    name: cfg.name,
    n: cfg.n,
    kind: cfg.kind,
    boxes: cfg.boxes,
    paceSec: cfg.paceSec,
    seed,
    puzzles: out,
  };
}

// One fresh puzzle for a timed test, from a seed. Twin puzzles appear in set 5 at the same rate as
// in the shipped set.
export function generateFresh(setNo, seed) {
  const cfg = configFor(setNo);
  const rng = createRng(seed);
  for (let tries = 0; tries < 50; tries++) {
    const k = rng.int(0, PUZZLES_PER_SET - 1);
    try {
      const p = makePuzzle(rng, slotParams(cfg, k, PUZZLES_PER_SET));
      return { id: `os${setNo}-g${(seed >>> 0).toString(36)}`, ...p };
    } catch {
      // draw again
    }
  }
  throw new Error(`set ${setNo}: no fresh puzzle from seed ${seed}`);
}

