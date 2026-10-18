#!/usr/bin/env node
// Re-verify every shipped Digit Equation set with an independent brute-force checker.
//
// The checker below does not use the game's own evaluator: it writes each filled equation as a
// string, parses it with its own recursive-descent parser (x and / bind tighter than + and -,
// left to right, exact division only, no leading zeros), and tries all 10^k digit vectors for
// the k blanks, keeping those the tray can supply. Per puzzle it checks: structure and operators
// allowed for the set, blank and decoy counts, at least one blank on the left, the stored answer
// is true, the stored solution count and unique flag match the brute force, the explanation
// engine reaches a true answer, mixed-precedence sets really depend on precedence, difficulty
// order, and no duplicates. Non-unique puzzles are reported as a warning (the game accepts any
// true fill), wrong flags are failures. Exits non-zero on any failure.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_CONFIGS, PUZZLES_PER_SET, puzzleKey } from '../js/games/digitequation/gen.js';
import { explainPuzzle } from '../js/games/digitequation/explain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function setPath(setNo) {
  return join(root, 'data', 'sets', 'digitequation', `set${setNo}.json`);
}

export function loadSet(setNo) {
  return JSON.parse(readFileSync(setPath(setNo), 'utf8'));
}

// ---------------------------------------------------------------- independent evaluator

// Parses and evaluates "12*3+4/2" style text. Returns a number, or null when a division is not
// exact, divides by zero, or a number has a leading zero.
export function evalText(text) {
  let i = 0;
  let bad = false;
  function number() {
    const start = i;
    while (i < text.length && text[i] >= '0' && text[i] <= '9') i++;
    const s = text.slice(start, i);
    if (!s) throw new Error(`number expected at ${start} in ${text}`);
    if (s.length > 1 && s[0] === '0') bad = true;
    return parseInt(s, 10);
  }
  function term() {
    let v = number();
    while (i < text.length && (text[i] === '*' || text[i] === '/')) {
      const op = text[i++];
      const w = number();
      if (op === '*') v *= w;
      else if (w === 0 || v % w !== 0) bad = true;
      else v /= w;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (i < text.length && (text[i] === '+' || text[i] === '-')) {
      const op = text[i++];
      const w = term();
      v = op === '+' ? v + w : v - w;
    }
    return v;
  }
  const v = expr();
  if (i !== text.length) throw new Error(`trailing input in ${text}`);
  return bad ? null : v;
}

function ltrText(text) {
  const parts = text.match(/\d+|[-+*/]/g);
  let acc = Number(parts[0]);
  for (let k = 1; k < parts.length; k += 2) {
    const w = Number(parts[k + 1]);
    const op = parts[k];
    if (op === '+') acc += w;
    else if (op === '-') acc -= w;
    else if (op === '*') acc *= w;
    else {
      if (w === 0 || acc % w !== 0) return null;
      acc /= w;
    }
  }
  return acc;
}

const OP_CHAR = { '+': '+', '-': '-', x: '*', '/': '/' };

function equationString(tokens, digits) {
  let k = 0;
  return tokens.map((t) => (t in OP_CHAR ? OP_CHAR[t] : t === '=' ? '=' : t.replace(/_/g, () => String(digits[k++])))).join('');
}

function isTrue(tokens, digits) {
  const [l, r] = equationString(tokens, digits).split('=');
  const a = evalText(l);
  const b = evalText(r);
  return a !== null && b !== null && a === b;
}

// All digit vectors that make the equation true and that the tray can supply.
export function bruteForce(tokens, tray) {
  const k = tokens.join('').split('').filter((c) => c === '_').length;
  const have = new Array(10).fill(0);
  for (const t of tray) have[t.d] += t.n;
  const found = [];
  for (let code = 0; code < 10 ** k; code++) {
    const digits = String(code).padStart(k, '0').split('').map(Number);
    const need = new Array(10).fill(0);
    let ok = true;
    for (const d of digits) if (++need[d] > have[d]) ok = false;
    if (ok && isTrue(tokens, digits)) found.push(digits);
  }
  return found;
}

// ---------------------------------------------------------------- set checks

function checkStructure(p, cfg) {
  const t = p.tokens;
  if (!Array.isArray(t) || t.filter((x) => x === '=').length !== 1) throw new Error('need exactly one =');
  const eq = t.indexOf('=');
  const sides = [t.slice(0, eq), t.slice(eq + 1)];
  for (const side of sides) {
    if (!side.length || side.length % 2 === 0) throw new Error('a side is empty or ends with an operator');
    side.forEach((x, k) => {
      if (k % 2 === 0 && !/^[0-9_]+$/.test(x)) throw new Error(`number expected, got ${x}`);
      if (k % 2 === 1 && !cfg.ops.includes(x)) throw new Error(`operator ${x} not allowed in set ${cfg.set}`);
    });
  }
  for (const op of cfg.need || []) if (!t.includes(op)) throw new Error(`set ${cfg.set} needs a ${op}`);
  const blanks = t.join('').split('').filter((c) => c === '_').length;
  if (blanks !== cfg.blanks || p.blanks !== cfg.blanks || p.optimal !== cfg.blanks) throw new Error(`blanks ${blanks}, stored ${p.blanks}/${p.optimal}, expected ${cfg.blanks}`);
  if (!sides[0].some((x) => x.includes('_'))) throw new Error('no blank on the left side');
  if (!Array.isArray(p.answer) || p.answer.length !== blanks || !p.answer.every((d) => Number.isInteger(d) && d >= 0 && d <= 9)) throw new Error('bad answer');
  const seenD = new Set();
  let total = 0;
  for (const tile of p.tray) {
    if (!(Number.isInteger(tile.d) && tile.d >= 0 && tile.d <= 9 && Number.isInteger(tile.n) && tile.n >= 1)) throw new Error('bad tray tile');
    if (seenD.has(tile.d)) throw new Error('tray digit listed twice');
    seenD.add(tile.d);
    total += tile.n;
  }
  const decoys = total - blanks;
  if (decoys !== p.decoys) throw new Error(`stored decoys ${p.decoys}, tray says ${decoys}`);
  if (decoys < cfg.decoys[0] || decoys > cfg.decoys[1]) throw new Error(`${decoys} decoys outside ${cfg.decoys.join('-')}`);
  return sides;
}

// Returns { problems, warnings, uniqueCount }.
export function checkSet(data, cfg) {
  const problems = [];
  const warnings = [];
  let uniqueCount = 0;
  const tag = `set ${cfg.set}`;
  if (data.game !== 'digitequation') problems.push(`${tag}: file says game ${data.game}`);
  if (data.set !== cfg.set) problems.push(`${tag}: file says set ${data.set}`);
  if (data.puzzles.length !== PUZZLES_PER_SET) problems.push(`${tag}: ${data.puzzles.length} puzzles, expected ${PUZZLES_PER_SET}`);
  const keys = new Set();
  const ids = new Set();
  let prevDiff = -Infinity;
  data.puzzles.forEach((p, k) => {
    const where = `${tag} ${p.id}`;
    try {
      const wantId = `de${cfg.set}-${String(k + 1).padStart(2, '0')}`;
      if (p.id !== wantId) throw new Error(`id should be ${wantId}`);
      if (ids.has(p.id)) throw new Error('duplicate id');
      ids.add(p.id);
      const key = puzzleKey(p);
      if (keys.has(key)) throw new Error('duplicate puzzle');
      keys.add(key);
      const sides = checkStructure(p, cfg);
      if (!isTrue(p.tokens, p.answer)) throw new Error('stored answer does not make the equation true');
      const sols = bruteForce(p.tokens, p.tray);
      if (!sols.length) throw new Error('no solution from the tray');
      if (p.solutions !== sols.length) throw new Error(`stored solutions ${p.solutions}, brute force finds ${sols.length}`);
      if (p.unique !== (sols.length === 1)) throw new Error(`unique flag ${p.unique} but ${sols.length} solution(s)`);
      if (sols.length === 1) uniqueCount++;
      else warnings.push(`${where}: ${sols.length} valid answers (accepted, marked not unique)`);
      if (cfg.mixed) {
        const text = equationString(p.tokens, p.answer).split('=')[0];
        const ops = sides[0].filter((_, j) => j % 2 === 1);
        if (!(ops.includes('x') && ops.some((o) => o === '+' || o === '-'))) throw new Error('mixed set without mixed operators on the left');
        if (ltrText(text) === evalText(text)) throw new Error('left to right reading gives the same value: precedence does not matter');
      }
      const ex = explainPuzzle(p);
      if (!ex.solved) throw new Error('explanation engine did not reach a true answer');
      if (!isTrue(p.tokens, ex.answer)) throw new Error('explanation answer fails the independent check');
      if (!ex.steps.length) throw new Error('explanation has no steps');
      if (!(p.difficulty >= prevDiff)) throw new Error(`difficulty ${p.difficulty} lower than the previous ${prevDiff}`);
      prevDiff = p.difficulty;
    } catch (err) {
      problems.push(`${where}: ${err.message}`);
    }
  });
  const out = problems;
  out.warnings = warnings;
  out.uniqueCount = uniqueCount;
  return out;
}

export function verifyAll({ log = console.log } = {}) {
  let total = 0;
  let bad = 0;
  let warn = 0;
  const rows = [];
  for (const cfg of SET_CONFIGS) {
    const file = setPath(cfg.set);
    if (!existsSync(file)) {
      log(`FAIL set ${cfg.set}: missing ${file}`);
      bad++;
      continue;
    }
    const t0 = Date.now();
    const data = loadSet(cfg.set);
    const problems = checkSet(data, cfg);
    total += data.puzzles.length;
    bad += problems.length;
    warn += problems.warnings.length;
    for (const p of problems) log(`FAIL ${p}`);
    for (const w of problems.warnings) log(`WARN ${w}`);
    rows.push({
      cfg,
      count: data.puzzles.length,
      unique: problems.uniqueCount,
      diffs: data.puzzles.map((p) => p.difficulty),
      ok: problems.length === 0,
      secs: (Date.now() - t0) / 1000,
    });
  }
  log('');
  log('Digit Equation verification (independent brute force)');
  log('set  blanks  ops       decoys  puzzles  unique  difficulty ladder                 status  time');
  for (const r of rows) {
    log(`${String(r.cfg.set).padEnd(5)}${String(r.cfg.blanks).padEnd(8)}${r.cfg.ops.join(' ').padEnd(10)}${r.cfg.decoys.join('-').padEnd(8)}${String(r.count).padEnd(9)}${String(r.unique).padEnd(8)}${r.diffs.join(',').padEnd(34)}${(r.ok ? 'OK' : 'FAIL').padEnd(8)}${r.secs.toFixed(1)}s`);
  }
  log(`verified ${total} puzzles, ${bad} problem(s), ${warn} warning(s)`);
  return bad === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = verifyAll();
  console.log(ok ? 'digitequation-verify: OK' : 'digitequation-verify: FAILED');
  process.exit(ok ? 0 : 1);
}
