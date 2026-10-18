// Brute-force solver: tries every way to fill the blanks from the tray (respecting tile counts)
// and keeps the fills that make the equation true. At most 10^3 fills for three blanks.

import { parsePuzzle, trayCounts, checkFill } from './state.js';

// Calls visit(fill) for every fill of the given blanks drawn from the counts.
// fixed: digits already decided (null where open); cand: optional Set per blank.
export function forEachFill(parsed, counts, visit, { fixed = null, cand = null } = {}) {
  const n = parsed.slots.length;
  const fill = fixed ? fixed.slice() : new Array(n).fill(null);
  const left = counts.slice();
  for (const d of fill) if (Number.isInteger(d)) left[d]--;
  const open = [];
  for (let i = 0; i < n; i++) if (!Number.isInteger(fill[i])) open.push(i);
  let stop = false;
  function rec(k) {
    if (stop) return;
    if (k === open.length) {
      if (visit(fill) === false) stop = true;
      return;
    }
    const i = open[k];
    for (let d = 0; d <= 9; d++) {
      if (left[d] <= 0) continue;
      if (cand && cand[i] && !cand[i].has(d)) continue;
      left[d]--;
      fill[i] = d;
      rec(k + 1);
      fill[i] = null;
      left[d]++;
      if (stop) return;
    }
  }
  rec(0);
}

// Returns { solutions: [fill], count, unique, space } where space counts every tray fill tried.
export function solve(puzzle, { limit = 50 } = {}) {
  const parsed = parsePuzzle(puzzle);
  const counts = trayCounts(puzzle.tray);
  const solutions = [];
  let space = 0;
  let count = 0;
  forEachFill(parsed, counts, (fill) => {
    space++;
    if (checkFill(parsed, fill).true) {
      count++;
      if (solutions.length < limit) solutions.push(fill.slice());
    }
  });
  return { solutions, count, unique: count === 1, space };
}

export function sameFill(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// Next hint target: the first blank whose placed digit is not part of any answer that agrees
// with the correct digits already placed. Returns { slot, digit } or null.
export function hintTarget(puzzle, fill, solutions = solve(puzzle).solutions) {
  if (!solutions.length) return null;
  // Prefer the answer that agrees with the most placed digits.
  let best = solutions[0];
  let bestScore = -1;
  for (const s of solutions) {
    const score = s.reduce((acc, d, i) => acc + (fill[i] === d ? 1 : 0), 0);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  for (let i = 0; i < best.length; i++) if (fill[i] !== best[i]) return { slot: i, digit: best[i], answer: best };
  return null;
}
