// "How it should be solved": a deduction engine that fills the blanks one reasoned step at a
// time and writes a plain-English reason for each step, computed from constraint checks:
//   - order of operations: where x and / bind before + and -,
//   - leading zero: a number of two or more digits cannot start with 0,
//   - last-digit test: with only + - x, the last digit of each side depends only on last digits,
//   - estimate: the range each side can reach for a given tile; out-of-range tiles are dropped,
//   - undo the operations: once one number is left, work it out by inverse operations,
//   - try each tile: the fallback, with the reason each wrong tile fails.
// It ends with a check (casting out nines, or multiplying back when there is a division) and
// mental-math tips chosen for this puzzle.

import {
  parsePuzzle, trayCounts, checkFill, evalSide, evalValues, evalLeftToRight, numberValue, numberText,
  equationText, OPS, ERROR_TEXT,
} from './state.js';
import { forEachFill, solve } from './solver.js';
import { efficiency, pct } from '../../core/score.js';

const sym = (op) => OPS[op].sym;
const listOr = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const listAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const sideWord = (s) => (s === 'L' ? 'left' : 'right');
const mod = (a, m) => ((a % m) + m) % m;

// Number shown with placed digits and [A] for open blanks.
function numText(parsed, n, fill) {
  const num = parsed.numbers[n];
  let k = 0;
  return [...num.pattern].map((ch) => {
    if (ch !== '_') return ch;
    const s = parsed.slots[num.slots[k++]];
    return Number.isInteger(fill[s.index]) ? String(fill[s.index]) : `[${s.label}]`;
  }).join('');
}

function seqText(parsed, seq, fill) {
  return seq.map((it) => ('op' in it ? sym(it.op) : numText(parsed, it.num, fill))).join(' ');
}

// A side split into additive terms, each a chain of x and / factors.
export function splitTerms(seq) {
  const terms = [];
  let cur = { sign: 1, items: [seq[0]] };
  for (let i = 1; i < seq.length; i += 2) {
    const op = seq[i].op;
    if (OPS[op].mul) cur.items.push(seq[i], seq[i + 1]);
    else {
      terms.push(cur);
      cur = { sign: op === '+' ? 1 : -1, items: [seq[i + 1]] };
    }
  }
  terms.push(cur);
  return terms;
}

function termValue(parsed, term, fill) {
  const values = [];
  const ops = [];
  for (const it of term.items) {
    if ('op' in it) ops.push(it.op);
    else {
      const r = numberValue(parsed, it.num, fill);
      if (!r.ok) return r;
      values.push(r.value);
    }
  }
  return evalValues(values, ops);
}

const isMixed = (seq) => {
  const ops = seq.filter((it) => 'op' in it).map((it) => it.op);
  return ops.some((o) => OPS[o].mul) && ops.some((o) => !OPS[o].mul);
};

// Side text with multiplication chains in brackets, to show the order of operations.
function groupedText(parsed, seq, fill) {
  const terms = splitTerms(seq);
  return terms.map((t, i) => {
    const body = seqText(parsed, t.items, fill);
    const wrapped = t.items.length > 1 && terms.length > 1 ? `(${body})` : body;
    return i === 0 ? wrapped : `${t.sign > 0 ? '+' : '-'} ${wrapped}`;
  }).join(' ');
}

// ---------------------------------------------------------------- undo the operations

// With every other number complete, work out the value number n must have.
// Returns { ok, needed, digits: [{ slot, d }], lines } or { ok: false, reason }.
export function isolateNumber(parsed, fill, n) {
  const num = parsed.numbers[n];
  const side = num.side;
  const other = side === 'L' ? 'R' : 'L';
  const otherSeq = other === 'L' ? parsed.left : parsed.right;
  const seq = side === 'L' ? parsed.left : parsed.right;
  const uText = numText(parsed, n, fill);
  const lines = [];
  const oth = evalSide(parsed, other, fill);
  if (!oth.ok) return { ok: false, reason: `the ${sideWord(other)} side does not work out (${ERROR_TEXT[oth.error] ?? oth.error})` };
  if (otherSeq.length > 1) lines.push(`The ${sideWord(other)} side works out to ${groupedText(parsed, otherSeq, fill)} = ${oth.value}.`);

  const terms = splitTerms(seq);
  const ti = terms.findIndex((t) => t.items.some((it) => it.num === n));
  const T = terms[ti];
  const tText = seqText(parsed, T.items, fill);
  let K = 0;
  const worked = [];
  const reduced = [];
  for (let i = 0; i < terms.length; i++) {
    const signText = i === 0 ? '' : terms[i].sign > 0 ? '+ ' : '- ';
    if (i === ti) {
      reduced.push(`${signText}${T.items.length > 1 && terms.length > 1 ? `(${tText})` : tText}`);
      continue;
    }
    const v = termValue(parsed, terms[i], fill);
    if (!v.ok) {
      const what = seqText(parsed, terms[i].items, fill);
      return { ok: false, reason: v.error === 'not-exact' ? `${what} does not come out exact` : `${what}: ${ERROR_TEXT[v.error] ?? v.error}` };
    }
    if (terms[i].items.length > 1) worked.push(`${seqText(parsed, terms[i].items, fill)} = ${v.value}`);
    reduced.push(`${signText}${v.value}`);
    K += terms[i].sign * v.value;
  }
  let need;
  if (terms.length === 1) need = oth.value;
  else {
    const pre = worked.length ? `Work out ${listAnd(worked)}: ` : '';
    const expr = T.sign > 0 ? `${oth.value} ${K < 0 ? '+' : '-'} ${Math.abs(K)}` : `${K} - ${oth.value}`;
    need = T.sign > 0 ? oth.value - K : K - oth.value;
    lines.push(`${pre}${reduced.join(' ')} = ${oth.value}, so ${tText} = ${expr} = ${need}.`);
  }

  const factors = T.items.filter((it) => 'num' in it);
  const fops = T.items.filter((it) => 'op' in it).map((it) => it.op);
  let needed = need;
  if (factors.length > 1) {
    const j = factors.findIndex((f) => f.num === n);
    const opBefore = (k) => (k === 0 ? 'x' : fops[k - 1]);
    let P = 1;
    let Q = 1;
    const pText = [];
    const qText = [];
    for (let k = 0; k < factors.length; k++) {
      if (k === j) continue;
      const v = numberValue(parsed, factors[k].num, fill).value;
      if (opBefore(k) === 'x') {
        P *= v;
        pText.push(String(v));
      } else {
        Q *= v;
        qText.push(String(v));
      }
    }
    const pDesc = pText.length > 1 ? `${pText.join(` ${sym('x')} `)} = ${P}` : String(P);
    const qDesc = qText.length > 1 ? `${qText.join(` ${sym('x')} `)} = ${Q}` : String(Q);
    if (Q === 0) return { ok: false, reason: 'dividing by 0 is not allowed' };
    if (opBefore(j) === 'x') {
      if (P === 0) return { ok: false, reason: 'a factor of 0 makes the term 0 whatever the blank' };
      const top = need * Q;
      if (mod(top, P) !== 0) {
        return { ok: false, reason: `${tText} would have to be ${need}, and ${top} is not a multiple of ${P}` };
      }
      needed = top / P;
      if (Q === 1) lines.push(`Divide both sides by ${pDesc}: ${uText} = ${need} ${sym('/')} ${P} = ${needed}.`);
      else if (P === 1) lines.push(`Multiply both sides by ${qDesc}: ${uText} = ${need} ${sym('x')} ${Q} = ${needed}.`);
      else lines.push(`Multiply both sides by ${qDesc}, then divide by ${pDesc}: ${uText} = ${need} ${sym('x')} ${Q} ${sym('/')} ${P} = ${needed}.`);
    } else {
      if (need === 0) return { ok: false, reason: `${tText} would have to be 0, which a division of a non-zero number never gives` };
      const den = need * Q;
      if (mod(P, den) !== 0) return { ok: false, reason: `${tText} would have to be ${need}, and ${P} does not divide exactly by ${den}` };
      needed = P / den;
      lines.push(`${tText} = ${need}, so the divisor ${uText} = ${P}${Q > 1 ? ` ${sym('/')} ${Q}` : ''} ${sym('/')} ${need} = ${needed}.`);
    }
  }

  const s = String(needed);
  const pattern = num.pattern;
  if (needed < 0) return { ok: false, reason: `it would need ${uText} = ${needed}, below 0` };
  if (s.length !== pattern.length) {
    return { ok: false, reason: `it would need ${uText} = ${needed}, which is not a ${pattern.length}-digit number` };
  }
  for (let p = 0; p < pattern.length; p++) {
    if (pattern[p] !== '_' && pattern[p] !== s[p]) return { ok: false, reason: `it would need ${uText} = ${needed}, which does not match the digits shown` };
  }
  const digits = num.slots.map((si) => ({ slot: si, d: Number(s[parsed.slots[si].pos]) }));
  const named = digits.map(({ slot, d }) => `${parsed.slots[slot].label} = ${d}`);
  if (pattern === '_') lines.push(`So ${named[0]}.`);
  else lines.push(`${uText} = ${needed}, so ${listAnd(named)}.`);
  return { ok: true, needed, digits, lines };
}

// ---------------------------------------------------------------- the deduction engine

function unitsSideText(parsed, side, fill, slot = null, d = null) {
  const seq = side === 'L' ? parsed.left : parsed.right;
  return seq.map((it) => {
    if ('op' in it) return sym(it.op);
    const num = parsed.numbers[it.num];
    const ch = num.pattern[num.pattern.length - 1];
    if (ch !== '_') return ch;
    const si = num.slots[num.slots.length - 1];
    if (si === slot && d !== null) return String(d);
    return Number.isInteger(fill[si]) ? String(fill[si]) : `[${parsed.slots[si].label}]`;
  }).join(' ');
}

function unitsSideValue(parsed, side, fill) {
  const seq = side === 'L' ? parsed.left : parsed.right;
  const values = [];
  const ops = [];
  for (const it of seq) {
    if ('op' in it) ops.push(it.op);
    else {
      const num = parsed.numbers[it.num];
      const ch = num.pattern[num.pattern.length - 1];
      values.push(ch === '_' ? fill[num.slots[num.slots.length - 1]] : Number(ch));
    }
  }
  return evalValues(values, ops).value;
}

// Returns { steps, answer, check, tips, others, unique, counts }.
// steps: [{ technique, text, fixed: [{ slot, d }], fillAfter }]
export function explainPuzzle(puzzle) {
  const parsed = parsePuzzle(puzzle);
  const counts = trayCounts(puzzle.tray);
  const n = parsed.slots.length;
  const fixed = new Array(n).fill(null);
  const cand = parsed.slots.map(() => new Set(counts.flatMap((c, d) => (c > 0 ? [d] : []))));
  const steps = [];
  const sol = solve(puzzle);
  const lab = (i) => parsed.slots[i].label;
  const br = (i) => `[${lab(i)}]`;
  const tally = { tries: 0, estimates: 0, lastDigit: 0, isolate: 0 };

  const leftOf = (d) => counts[d] - fixed.filter((x) => x === d).length;
  function prune() {
    for (let i = 0; i < n; i++) {
      if (fixed[i] !== null) continue;
      for (const d of [...cand[i]]) if (leftOf(d) <= 0) cand[i].delete(d);
    }
  }
  function fix(i, d) {
    fixed[i] = d;
    cand[i] = new Set([d]);
    prune();
  }
  function push(technique, text, fixedNow = []) {
    steps.push({ technique, text, fixed: fixedNow, fillAfter: fixed.slice() });
  }
  function existsTrue(trial) {
    let found = false;
    forEachFill(parsed, counts, (f) => {
      if (checkFill(parsed, f).true) {
        found = true;
        return false;
      }
      return true;
    }, { fixed: trial, cand });
    return found;
  }
  const open = () => parsed.slots.filter((s) => fixed[s.index] === null).map((s) => s.index);
  const openNumbers = () => parsed.numbers.filter((num) => num.slots.some((si) => fixed[si] === null)).map((num) => num.index);

  // Order of operations.
  for (const side of ['L', 'R']) {
    const seq = side === 'L' ? parsed.left : parsed.right;
    if (isMixed(seq)) {
      push('precedence', `Order of operations: ${sym('x')} and ${sym('/')} are worked out before + and -, so read the ${sideWord(side)} side as ${groupedText(parsed, seq, fixed)}.`);
    }
  }
  // Leading zero.
  const lz = parsed.slots.filter((s) => s.leading && cand[s.index].has(0));
  if (lz.length) {
    for (const s of lz) cand[s.index].delete(0);
    const what = lz.map((s) => `${br(s.index)} starts ${numText(parsed, s.num, fixed)}`);
    push('leading-zero', `Leading zero: ${listAnd(what)}, and a number with two or more digits cannot start with 0, so ${listAnd(lz.map((s) => lab(s.index)))} ${lz.length === 1 ? 'is' : 'are'} not 0.`);
  }
  if (parsed.hasDivision) {
    push('division', `Rule for ${sym('/')}: every division must come out exact, with no remainder. Tiles that leave a remainder can be dropped at once.`);
  }

  // Last-digit test for blank i: only when every other last digit is known (no division).
  function lastDigitFor(i) {
    if (parsed.hasDivision || !parsed.slots[i].units) return null;
    const othersKnown = parsed.numbers.every((num) => {
      if (num.pattern[num.pattern.length - 1] !== '_') return true;
      const si = num.slots[num.slots.length - 1];
      return si === i || fixed[si] !== null;
    });
    if (!othersKnown) return null;
    const keep = [];
    const drop = [];
    for (const d of [...cand[i]].sort((a, b) => a - b)) {
      const trial = fixed.slice();
      trial[i] = d;
      const ok = mod(unitsSideValue(parsed, 'L', trial) - unitsSideValue(parsed, 'R', trial), 10) === 0;
      (ok ? keep : drop).push(d);
    }
    if (!drop.length || !keep.length) return null;
    return { i, keep, drop };
  }
  function lastDigitText({ i, keep, drop }) {
    const side = parsed.numbers[parsed.slots[i].num].side;
    const other = side === 'L' ? 'R' : 'L';
    const uT = unitsSideText(parsed, side, fixed);
    const uO = unitsSideText(parsed, other, fixed);
    const vO = unitsSideValue(parsed, other, fixed);
    const oLast = mod(vO, 10);
    const oDesc = /^\d$/.test(uO) ? uO : `${oLast} (the last digit of ${uO} = ${vO})`;
    let text = `Last-digit test: the last digit of a +, - or ${sym('x')} result depends only on the last digits, so `;
    text += uT === br(i) ? `${br(i)} must be ${oDesc}.` : `${uT} must end in ${oDesc}.`;
    if (keep.length === 1) {
      const d = keep[0];
      const trial = fixed.slice();
      trial[i] = d;
      const ex = unitsSideText(parsed, side, fixed, i, d);
      const v = unitsSideValue(parsed, side, trial);
      let shown = '';
      if (!/^\d$/.test(ex)) {
        shown = v < 0
          ? ` (${ex} = ${v}, which leaves last digit ${mod(v, 10)} after borrowing)`
          : ` (${ex} = ${v}, which ends in ${mod(v, 10)})`;
      }
      text += ` Only ${lab(i)} = ${d} fits${shown}; that rules out ${listAnd(drop.map(String))}.`;
    } else {
      text += ` Only ${lab(i)} = ${listOr(keep.map(String))} give a matching last digit; ${listAnd(drop.map(String))} ${drop.length === 1 ? 'is' : 'are'} out.`;
    }
    return text;
  }

  // Range of each side for every tile of blank i, over all fills of the other blanks.
  function estimateFor(i) {
    if (open().length < 2) return null;
    const small = [];
    const big = [];
    const keep = [];
    for (const d of [...cand[i]].sort((a, b) => a - b)) {
      const trial = fixed.slice();
      trial[i] = d;
      let minL = Infinity, maxL = -Infinity, minR = Infinity, maxR = -Infinity;
      forEachFill(parsed, counts, (f) => {
        const L = evalSide(parsed, 'L', f);
        const R = evalSide(parsed, 'R', f);
        if (!L.ok || !R.ok) return true;
        minL = Math.min(minL, L.value);
        maxL = Math.max(maxL, L.value);
        minR = Math.min(minR, R.value);
        maxR = Math.max(maxR, R.value);
        return true;
      }, { fixed: trial, cand });
      if (minL === Infinity) keep.push(d); // no valid fill at all: left for the try step to explain
      else if (maxL < minR) small.push({ d, maxL, minR });
      else if (minL > maxR) big.push({ d, minL, maxR });
      else keep.push(d);
    }
    if ((!small.length && !big.length) || !keep.length) return null;
    return { i, small, big, keep };
  }
  function applyEstimate({ i, small, big, keep }) {
    const parts = [];
    if (small.length) {
      const e = small[small.length - 1];
      parts.push(`${lab(i)} = ${listOr(small.map((x) => String(x.d)))} leaves the left side too small (with ${lab(i)} = ${e.d}: left at most ${e.maxL}, right at least ${e.minR})`);
    }
    if (big.length) {
      const e = big[0];
      parts.push(`${lab(i)} = ${listOr(big.map((x) => String(x.d)))} makes the left side too big (with ${lab(i)} = ${e.d}: left at least ${e.minL}, right at most ${e.maxR})`);
    }
    for (const x of [...small, ...big]) cand[i].delete(x.d);
    let text = `Estimate the size of each side, whatever the other blanks are: ${parts.join('; ')}.`;
    const fixedNow = [];
    if (keep.length === 1) {
      text += ` So ${lab(i)} = ${keep[0]}.`;
      fix(i, keep[0]);
      fixedNow.push({ slot: i, d: keep[0] });
    } else text += ` ${lab(i)} is ${listOr(keep.map(String))}.`;
    tally.estimates++;
    push('estimate', text, fixedNow);
  }
  // Does fixing blank i leave a single number with blanks (so each tile can be checked exactly)?
  function leavesOneNumber(i) {
    const trial = fixed.slice();
    trial[i] = -1;
    return parsed.numbers.filter((num) => num.slots.some((si) => trial[si] === null)).length === 1;
  }

  let guard = 0;
  while (open().length && guard++ < 50) {
    prune();
    // Singles left by earlier eliminations.
    const single = open().find((i) => cand[i].size === 1);
    if (single !== undefined) {
      const d = [...cand[single]][0];
      const usedUp = counts.flatMap((c, k) => (c > 0 && leftOf(k) <= 0 ? [String(k)] : []));
      const why = usedUp.length ? ` (every ${listOr(usedUp)} tile is already placed)` : '';
      fix(single, d);
      push('single', `Only one tile is still possible for ${lab(single)}${why}, so ${lab(single)} = ${d}.`, [{ slot: single, d }]);
      continue;
    }

    // Undo the operations once a single number still has blanks.
    const nums = openNumbers();
    if (nums.length === 1) {
      const res = isolateNumber(parsed, fixed, nums[0]);
      const fits = res.ok && res.digits.every(({ slot, d }) => cand[slot].has(d));
      const trial = fixed.slice();
      if (fits) for (const { slot, d } of res.digits) trial[slot] = d;
      if (fits && checkFill(parsed, trial).true) {
        for (const { slot, d } of res.digits) fix(slot, d);
        tally.isolate++;
        push('isolate', `Undo the operations. ${res.lines.join(' ')}`, res.digits);
        continue;
      }
    }

    // Strong steps first: a last-digit test or an estimate that pins a blank down.
    const lds = open().map(lastDigitFor).filter(Boolean);
    const ldFix = lds.find((x) => x.keep.length === 1);
    if (ldFix) {
      const text = lastDigitText(ldFix);
      fix(ldFix.i, ldFix.keep[0]);
      tally.lastDigit++;
      push('last-digit', text, [{ slot: ldFix.i, d: ldFix.keep[0] }]);
      continue;
    }
    const byPlace = open().slice().sort((a, b) => parsed.slots[b].place - parsed.slots[a].place || a - b);
    const ests = byPlace.map(estimateFor).filter(Boolean);
    const estFix = ests.find((x) => x.keep.length === 1);
    if (estFix) {
      applyEstimate(estFix);
      continue;
    }
    // Then a short try where each tile can be checked by undoing the operations.
    const concrete = open().filter((i) => cand[i].size <= 4 && leavesOneNumber(i));
    if (concrete.length) {
      tryTiles(concrete.sort((a, b) => cand[a].size - cand[b].size || a - b)[0]);
      continue;
    }
    // Then narrowing steps.
    if (lds.length) {
      const x = lds[0];
      const text = lastDigitText(x);
      for (const d of x.drop) cand[x.i].delete(d);
      tally.lastDigit++;
      push('last-digit', text);
      continue;
    }
    if (ests.length) {
      applyEstimate(ests.sort((a, b) => (b.small.length + b.big.length) - (a.small.length + a.big.length))[0]);
      continue;
    }
    // Fallback: try each tile.
    const pickFrom = open().slice().sort((a, b) => cand[a].size - cand[b].size || parsed.slots[b].place - parsed.slots[a].place || a - b);
    if (!tryTiles(pickFrom[0])) break;
  }

  // Try each tile for blank i, with the reason each wrong tile fails. False when nothing works.
  function tryTiles(i) {
    const reasons = [];
    const works = [];
    for (const d of [...cand[i]].sort((a, b) => a - b)) {
      const trial = fixed.slice();
      trial[i] = d;
      if (existsTrue(trial)) {
        works.push(d);
        continue;
      }
      const nums2 = parsed.numbers.filter((num) => num.slots.some((si) => trial[si] === null)).map((num) => num.index);
      let why = 'no tiles for the other blanks make it true';
      if (nums2.length === 1) {
        const res = isolateNumber(parsed, trial, nums2[0]);
        if (!res.ok) why = res.reason;
        else {
          const missing = res.digits.find(({ slot, d: dd }) => !cand[slot].has(dd) || (counts[dd] - trial.filter((x) => x === dd).length) < res.digits.filter((x) => x.d === dd).length);
          why = missing ? `it would need ${lab(missing.slot)} = ${missing.d}, and that tile is not available` : 'the division would not come out exact';
        }
      } else if (nums2.length === 0) {
        const c = checkFill(parsed, trial);
        why = c.valid ? `the sides would be ${c.left} and ${c.right}` : ERROR_TEXT[c.error];
      }
      reasons.push(`${lab(i)} = ${d}: ${why}`);
    }
    let pickD = works[0];
    let note = '';
    if (works.length > 1) {
      const s0 = sol.solutions.find((s) => fixed.every((x, k) => x === null || x === s[k]));
      if (s0) pickD = s0[i];
      note = ` (${lab(i)} = ${listOr(works.map(String))} all lead to a true equation, so this puzzle has more than one answer)`;
    }
    if (pickD === undefined) return false; // no answer: puzzle is broken; the verifier reports it
    tally.tries++;
    fix(i, pickD);
    push('try', `Try each tile for ${br(i)}. ${reasons.map((r) => `${r}.`).join(' ')} ${works.length === 1 ? `Only ${lab(i)} = ${pickD} works.` : `Take ${lab(i)} = ${pickD}${note}.`}`.replace(/\s+/g, ' ').trim(), [{ slot: i, d: pickD }]);
    return true;
  }

  const answer = fixed.slice();
  return {
    parsed,
    steps,
    answer,
    solved: checkFill(parsed, answer).true,
    check: checkText(parsed, answer),
    tips: tipsFor(puzzle, parsed, answer, counts),
    others: sol.solutions.filter((s) => s.some((d, k) => d !== answer[k])),
    unique: sol.unique,
    space: sol.space,
    tally,
  };
}

// ---------------------------------------------------------------- check and tips

function digitRoot(v) {
  return mod(v, 9);
}

export function checkText(parsed, fill) {
  const c = checkFill(parsed, fill);
  if (!c.true) return 'The fill does not make the equation true.';
  const full = `${equationText(parsed, fill, { brackets: false })}: both sides are ${c.left}.`;
  if (!parsed.hasDivision) {
    const vals = parsed.numbers.map((num) => numberValue(parsed, num.index, fill).value);
    const shown = [...new Set(vals)].map((v) => `${v} gives ${digitRoot(v)}`);
    const sideMod = (seq) => {
      const values = [];
      const ops = [];
      for (const it of seq) {
        if ('op' in it) ops.push(it.op);
        else values.push(digitRoot(vals[it.num]));
      }
      const raw = evalValues(values, ops).value;
      const text = values.length > 1 ? `${values.map((v, k) => (k ? `${sym(ops[k - 1])} ${v}` : String(v))).join(' ')} = ${raw}, which gives ${digitRoot(raw)}` : `${raw}`;
      return { text, r: digitRoot(raw) };
    };
    const l = sideMod(parsed.left);
    const r = sideMod(parsed.right);
    return `Check by casting out nines: replace each number by its digit sum, cut down to 0 to 8 (${listAnd(shown)}). Left: ${l.text}. Right: ${r.text}. They match. Full check: ${full}`;
  }
  const backs = [];
  for (const side of ['L', 'R']) {
    const seq = side === 'L' ? parsed.left : parsed.right;
    let acc = null;
    for (let k = 0; k < seq.length; k++) {
      const it = seq[k];
      if ('num' in it) {
        const v = numberValue(parsed, it.num, fill).value;
        const prevOp = k > 0 ? seq[k - 1].op : null;
        if (acc === null || !prevOp || !OPS[prevOp].mul) acc = v;
        else if (prevOp === 'x') acc *= v;
        else {
          const q = acc / v;
          backs.push(`${acc} ${sym('/')} ${v} = ${q} because ${v} ${sym('x')} ${q} = ${acc}`);
          acc = q;
        }
      }
    }
  }
  return `Check by multiplying back: ${listAnd(backs)}. Full check: ${full}`;
}

function roughly(v) {
  if (Math.abs(v) < 10) return v;
  const p = 10 ** (String(Math.abs(v)).length - 1);
  return Math.round(v / p) * p;
}

export function tipsFor(puzzle, parsed, answer, counts = trayCounts(puzzle.tray)) {
  const tips = [];
  const filled = answer.every((d) => Number.isInteger(d));
  const vals = filled ? parsed.numbers.map((num) => numberValue(parsed, num.index, answer).value) : null;
  const sideVals = (seq, f = (v) => v) => {
    const values = [];
    const ops = [];
    for (const it of seq) ('op' in it ? ops.push(it.op) : values.push(f(vals[it.num])));
    return { values, ops };
  };
  for (const side of ['L', 'R']) {
    const seq = side === 'L' ? parsed.left : parsed.right;
    if (!isMixed(seq) || !filled) continue;
    const { values, ops } = sideVals(seq);
    const good = evalValues(values, ops);
    const ltr = evalLeftToRight(values, ops);
    const text = seq.map((it) => ('op' in it ? sym(it.op) : String(vals[it.num]))).join(' ');
    const wrong = ltr.ok && ltr.value !== good.value ? ` Reading ${text} strictly left to right gives ${ltr.value} instead of ${good.value}.` : '';
    tips.push({ id: 'precedence', title: 'Order of operations', text: `Do ${sym('x')} and ${sym('/')} before + and -.${wrong}` });
  }
  if (!parsed.hasDivision) {
    tips.push({ id: 'last-digit', title: 'Last-digit test', text: `For +, - and ${sym('x')}, the last digit of the answer comes from the last digits alone. Test a units blank this way before working out the whole sum.` });
  }
  if (filled) {
    const parts = [];
    for (const side of ['L', 'R']) {
      const seq = side === 'L' ? parsed.left : parsed.right;
      if (seq.length < 3) continue;
      const { values, ops } = sideVals(seq, roughly);
      const r = evalValues(values, ops);
      const exact = evalSide(parsed, side, answer);
      if (r.ok && exact.ok) parts.push(`${values.map((v, k) => (k ? `${sym(ops[k - 1])} ${v}` : String(v))).join(' ')} = ${r.value} (exact: ${exact.value})`);
    }
    tips.push({ id: 'estimate', title: 'Estimate the size', text: `Round each number to its first digit to see how big each side must be, then drop tiles that make a side far too big or too small.${parts.length ? ` Here: ${parts.join('; ')}.` : ''}` });
  }
  tips.push(parsed.hasDivision
    ? { id: 'multiply-back', title: 'Multiply back', text: `Check a division by multiplying: a ${sym('/')} b = c is right only if b ${sym('x')} c = a with nothing left over.` }
    : { id: 'nines', title: 'Casting out nines', text: 'Replace each number by its digit sum (repeat until one digit; 9 counts as 0). Do the same sum with those small numbers: if the two sides do not match, the answer is wrong. A match is a good sign, not proof.' });
  const decoys = puzzle.decoys ?? 0;
  if (decoys > 0) {
    tips.push({ id: 'decoys', title: 'Decoys', text: `This tray holds ${decoys} ${decoys === 1 ? 'tile' : 'tiles'} that the answer does not use. Do not try to use every tile.` });
  }
  if (counts[0] > 0 && parsed.slots.some((s) => s.leading)) {
    tips.push({ id: 'leading-zero', title: 'Leading zero', text: 'A 0 tile can never go first in a number with two or more digits.' });
  }
  return tips;
}

// ---------------------------------------------------------------- difficulty and results

// Difficulty for ordering a set: size of the search, and how much the deduction needed casework.
export function difficultyOf(puzzle, ex = explainPuzzle(puzzle)) {
  const digits = puzzle.tokens.filter((t) => /^[0-9_]+$/.test(t)).reduce((s, t) => s + t.length, 0);
  return Math.round(10 * Math.log10(Math.max(1, ex.space)) + 6 * ex.tally.tries + 3 * ex.tally.estimates + 2 * ex.tally.isolate + digits);
}

export const STRATEGY = [
  'Read the equation once with brackets around every x and / chain: they are worked out first.',
  'Start with a blank you can pin down alone: a units digit (last-digit test) or the last number left (undo the operations).',
  'Estimate the size of each side before trying tiles: it rules out most tiles at once.',
  'The tray may hold decoys. Leftover tiles are normal, so do not force them in.',
  'Check with casting out nines, or by multiplying back for a division, before you press Check.',
  'In a timed test, skip if no blank gives way after about half the pace guide.',
];

export function resultSummary({ placements, blanks, solved, wrongChecks = 0 }) {
  if (!solved) return `Not solved: score 0. The puzzle needs ${blanks} ${blanks === 1 ? 'tile' : 'tiles'}.`;
  const eff = efficiency(blanks, placements);
  const wrong = wrongChecks ? ` ${wrongChecks} wrong ${wrongChecks === 1 ? 'check' : 'checks'}.` : '';
  const tail = eff >= 1 && !wrongChecks ? ' Clean solve, well done.' : '';
  return `You placed ${placements} ${placements === 1 ? 'tile' : 'tiles'} for ${blanks} ${blanks === 1 ? 'blank' : 'blanks'}: efficiency ${pct(eff)}.${wrong}${tail}`;
}

export { numText, equationText };
