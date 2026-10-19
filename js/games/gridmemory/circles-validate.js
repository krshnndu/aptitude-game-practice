// Independent validator for Circles trials. Geometry is recomputed here (no code shared with
// circles.js); side questions go through validate.js, which recomputes them from their content.
//
// A circles trial has exactly one correct response when:
//   - every circle is a pair of finite numbers inside the play area margin, and no two circles are
//     closer than the set's minimum distance (so every circle is a separate, tappable target),
//   - the sequence holds `length` distinct circle indexes (one ordered list of taps is right),
//   - every side question has exactly one true answer, stored with it.

import { checkSides } from './validate.js';

export const EDGE = 0.08;

function gap(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// Smallest distance between two circle centres (Infinity for fewer than two circles).
export function closestPair(circles) {
  let best = Infinity;
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) best = Math.min(best, gap(circles[i], circles[j]));
  }
  return best;
}

// The single correct recall response.
export function solveCircles(p) {
  return p.sequence.slice();
}

export function checkCirclePuzzle(p, cfg) {
  const problems = [];
  const bad = (m) => problems.push(m);
  if (p.var !== 'circles') bad(`var ${p.var} is not circles`);
  if (!(p.length >= cfg.lengths[0] && p.length <= cfg.lengths[1])) bad(`length ${p.length} outside ${cfg.lengths.join('-')}`);
  if (p.showMs !== cfg.showMs) bad(`showMs ${p.showMs} != ${cfg.showMs}`);
  if (p.windowMs !== cfg.windowMs) bad(`windowMs ${p.windowMs} != ${cfg.windowMs}`);
  if (p.pauseMs !== cfg.pauseMs) bad(`pauseMs ${p.pauseMs} != ${cfg.pauseMs}`);
  if (!Array.isArray(p.circles) || p.circles.length !== cfg.circles) {
    bad(`need ${cfg.circles} circles, found ${p.circles?.length}`);
    return problems;
  }
  p.circles.forEach((c, i) => {
    const ok = Array.isArray(c) && c.length === 2 && c.every((v) => typeof v === 'number' && Number.isFinite(v));
    if (!ok) return bad(`circle ${i + 1} is not an [x, y] pair`);
    if (c.some((v) => v < EDGE - 1e-9 || v > 1 - EDGE + 1e-9)) bad(`circle ${i + 1} at ${c.join(',')} is outside the play area margin`);
  });
  const close = closestPair(p.circles);
  if (close < cfg.minDist - 1e-9) bad(`two circles are ${close.toFixed(3)} apart, below ${cfg.minDist}`);
  if (!Array.isArray(p.sequence) || p.sequence.length !== p.length) bad('sequence length != length');
  else {
    const used = new Set();
    for (const x of p.sequence) {
      if (!Number.isInteger(x) || x < 0 || x >= p.circles.length) bad(`circle index ${x} does not exist`);
      if (used.has(x)) bad(`circle ${x + 1} repeats, so the order would be ambiguous`);
      used.add(x);
    }
  }
  checkSides(p, cfg, bad);
  return problems;
}

export function checkCircleSetData(data, cfg, { count = 10 } = {}) {
  const tag = `circles set ${cfg.level}`;
  const problems = [];
  if (data.game !== 'gridmemory' || data.var !== 'circles') problems.push(`${tag}: game ${data.game} var ${data.var}`);
  if (data.set !== cfg.set) problems.push(`${tag}: file says set ${data.set}, expected ${cfg.set}`);
  if (!Array.isArray(data.puzzles) || data.puzzles.length !== count) {
    problems.push(`${tag}: ${data.puzzles?.length} puzzles, expected ${count}`);
    return problems;
  }
  const ids = new Set();
  const seqs = new Set();
  const tally = { yes: 0, no: 0, even: 0, odd: 0 };
  const kinds = new Set();
  let prevLen = 0;
  for (const p of data.puzzles) {
    const where = `${tag} ${p.id}`;
    if (!/^gc\d-\d\d$/.test(p.id)) problems.push(`${where}: id is not gc<level>-<nn>`);
    if (ids.has(p.id)) problems.push(`${where}: duplicate id`);
    ids.add(p.id);
    for (const m of checkCirclePuzzle(p, cfg)) problems.push(`${where}: ${m}`);
    const key = JSON.stringify([p.circles, p.sequence]);
    if (seqs.has(key)) problems.push(`${where}: duplicate trial`);
    seqs.add(key);
    if (p.length < prevLen) problems.push(`${where}: length ${p.length} drops below the previous ${prevLen}`);
    prevLen = p.length;
    for (const d of p.distractors || []) {
      if (d.answer in tally) tally[d.answer]++;
      kinds.add(d.kind);
    }
  }
  const lens = data.puzzles.map((p) => p.length);
  if (Math.min(...lens) !== cfg.lengths[0] || Math.max(...lens) !== cfg.lengths[1]) {
    problems.push(`${tag}: lengths ${Math.min(...lens)}-${Math.max(...lens)} do not span ${cfg.lengths.join('-')}`);
  }
  for (const k of cfg.kinds) if (!kinds.has(k)) problems.push(`${tag}: no ${k} questions`);
  for (const [a, b] of [['yes', 'no'], ['even', 'odd']]) {
    const total = tally[a] + tally[b];
    if (total && (tally[a] / total < 0.3 || tally[a] / total > 0.7)) problems.push(`${tag}: ${a}/${b} answers unbalanced (${tally[a]}/${tally[b]})`);
  }
  return problems;
}
