#!/usr/bin/env node
// Re-verify every shipped Pattern Rule set.
// Per puzzle (solver.checkPuzzle, whole catalogue): valid panels and drawing data, set sizes,
// every fitting panel follows the rule, every does-not-fit panel breaks it, the answer key and
// the stored violated parts match the rule, and every conjunction of up to 3 catalogue atoms that
// fits the examples picks exactly the keyed candidates (no ambiguity, no simpler rival rule).
// Per set: 10 puzzles, ids in order, the rule shape the set promises, no repeated puzzle, and a
// non-decreasing difficulty ladder. Exits non-zero on any failure.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_CONFIGS, PUZZLES_PER_SET, difficulty } from '../js/games/patternrule/gen.js';
import { checkPuzzle, solvePuzzle } from '../js/games/patternrule/solver.js';
import { atom } from '../js/games/patternrule/rules.js';
import { puzzleKey } from '../js/games/patternrule/stream.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function setPath(setNo) {
  return join(root, 'data', 'sets', 'patternrule', `set${setNo}.json`);
}

export function loadSet(setNo) {
  return JSON.parse(readFileSync(setPath(setNo), 'utf8'));
}

// The rule shape each set promises.
function ruleShapeProblem(cfg, rule) {
  const kinds = rule.map((id) => atom(id).kind);
  const rel = kinds.filter((k) => k === 'relation').length;
  if (cfg.set <= 2 && !(rule.length === 1 && rel === 0)) return 'set promises one feature';
  if (cfg.set === 3 && !(rule.length === 2 && rel === 0 && atom(rule[0]).dim !== atom(rule[1]).dim)) return 'set promises two features from different dimensions';
  if (cfg.set === 4 && !(rule.length === 1 && rel === 1)) return 'set promises one relation';
  if (cfg.set === 5 && !(rule.length === 2 && rel === 1)) return 'set promises a feature plus a relation';
  return null;
}

export function checkSet(data, cfg) {
  const problems = [];
  const tag = `set ${cfg.set}`;
  if (data.game !== 'patternrule') problems.push(`${tag}: game is ${data.game}`);
  if (data.set !== cfg.set) problems.push(`${tag}: file says set ${data.set}`);
  if (data.puzzles.length !== PUZZLES_PER_SET) problems.push(`${tag}: ${data.puzzles.length} puzzles, expected ${PUZZLES_PER_SET}`);
  const keys = new Set();
  let prev = -Infinity;
  data.puzzles.forEach((p, k) => {
    const want = `pr${cfg.set}-${String(k + 1).padStart(2, '0')}`;
    if (p.id !== want) problems.push(`${tag}: puzzle ${k + 1} has id ${p.id}, expected ${want}`);
    for (const m of checkPuzzle(p, cfg)) problems.push(`${tag} ${m}`);
    const shape = ruleShapeProblem(cfg, p.rule ?? []);
    if (shape) problems.push(`${tag} ${p.id}: ${shape}`);
    const key = puzzleKey(p);
    if (keys.has(key)) problems.push(`${tag} ${p.id}: duplicate puzzle`);
    keys.add(key);
    const d = difficulty(p);
    if (d < prev) problems.push(`${tag} ${p.id}: difficulty ${d} below the previous puzzle (${prev})`);
    prev = d;
  });
  return problems;
}

export function verifyAll({ log = console.log } = {}) {
  let total = 0;
  let bad = 0;
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
    for (const p of problems) log(`FAIL ${p}`);
    total += data.puzzles.length;
    bad += problems.length;
    let checked = 0;
    const consistent = [];
    for (const p of data.puzzles) {
      const res = solvePuzzle(p, { full: true });
      checked += res.checked;
      consistent.push(res.hypotheses.length);
    }
    rows.push({
      set: cfg.set,
      name: cfg.name,
      n: data.puzzles.length,
      answers: data.puzzles.map((p) => p.answer.length).join(''),
      checked,
      consistent: `${Math.min(...consistent)}-${Math.max(...consistent)}`,
      ok: problems.length === 0,
      secs: (Date.now() - t0) / 1000,
    });
  }
  log('');
  log('Pattern Rule verification (catalogue: conjunctions of up to 3 atoms, checked per puzzle)');
  log('set  name                  puzzles  fitting per puzzle  rules checked  consistent rules  status  time');
  for (const r of rows) {
    log(`${String(r.set).padEnd(5)}${r.name.padEnd(22)}${String(r.n).padEnd(9)}${r.answers.padEnd(20)}${String(r.checked).padEnd(15)}${r.consistent.padEnd(18)}${(r.ok ? 'OK' : 'FAIL').padEnd(8)}${r.secs.toFixed(1)}s`);
  }
  log(`verified ${total} puzzles, ${bad} problem(s)`);
  return bad === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = verifyAll();
  console.log(ok ? 'verify: OK' : 'verify: FAILED');
  process.exit(ok ? 0 : 1);
}
