#!/usr/bin/env node
// Re-verify every shipped Operator Switch set with the independent solver (solver.js).
// Checks per puzzle: well-formed start, boxes, target and options; no identity box; the chain
// changes the start; exactly one option is correct and it is the stored answer; for a hidden box,
// exactly one of all n! operators fits; twin chains end in the same arrangement; the set's kind,
// item count, box count and option range; the stored difficulty matches and the set climbs as a
// ladder; the explanation (state.js model) reaches the solver's answer, its elimination ends on the
// answer and every wrong option gets a reason; no duplicate ids or questions. Exits non-zero on
// any failure.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_CONFIGS, PUZZLES_PER_SET, GAME_ID, difficulty } from '../js/games/operatorswitch/gen.js';
import { validatePuzzle, solvePuzzle, questionKey } from '../js/games/operatorswitch/solver.js';
import { explainPuzzle } from '../js/games/operatorswitch/explain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function setPath(setNo) {
  return join(root, 'data', 'sets', GAME_ID, `set${setNo}.json`);
}

export function loadSet(setNo) {
  return JSON.parse(readFileSync(setPath(setNo), 'utf8'));
}

// Problems with one puzzle's explanation (empty when it agrees with the solver).
export function checkExplanation(p) {
  const problems = [];
  const ex = explainPuzzle(p);
  const solved = solvePuzzle(p).value;
  if (ex.value !== solved) problems.push(`explanation ends on ${ex.value}, solver says ${solved}`);
  if (ex.elimination.answer !== p.answer) problems.push(`elimination ends on option ${ex.elimination.answer + 1}, answer is ${p.answer + 1}`);
  if (ex.others.length !== p.options.length - 1 || ex.others.some((o) => !o.text)) problems.push('a wrong option has no reason');
  if (!ex.steps.length || ex.steps.some((s) => !s.text)) problems.push('empty explanation step');
  return problems;
}

// Returns a list of problem strings (empty when the set is valid).
export function checkSet(data, cfg) {
  const problems = [];
  const tag = `set ${cfg.set}`;
  if (data.game !== GAME_ID) problems.push(`${tag}: game ${data.game}`);
  if (data.set !== cfg.set) problems.push(`${tag}: file says set ${data.set}`);
  if (data.n !== cfg.n) problems.push(`${tag}: n ${data.n} != ${cfg.n}`);
  if (!Array.isArray(data.puzzles) || data.puzzles.length !== PUZZLES_PER_SET) {
    problems.push(`${tag}: ${data.puzzles?.length} puzzles, expected ${PUZZLES_PER_SET}`);
    return problems;
  }
  const ids = new Set();
  const keys = new Set();
  let prevDiff = -Infinity;
  data.puzzles.forEach((p, k) => {
    const where = `${tag} ${p.id ?? `#${k + 1}`}`;
    const add = (msg) => problems.push(`${where}: ${msg}`);
    if (p.id !== `os${cfg.set}-${String(k + 1).padStart(2, '0')}`) add(`id out of order (position ${k + 1})`);
    if (ids.has(p.id)) add('duplicate id');
    ids.add(p.id);
    const bad = validatePuzzle(p, cfg);
    for (const b of bad) add(b);
    if (bad.length) return;
    const key = questionKey(p);
    if (keys.has(key)) add('duplicate question');
    keys.add(key);
    if (p.difficulty !== difficulty(p)) add(`stored difficulty ${p.difficulty} != ${difficulty(p)}`);
    if (p.difficulty < prevDiff) add('difficulty drops: the set must climb as a ladder');
    prevDiff = p.difficulty;
    try {
      for (const e of checkExplanation(p)) add(e);
    } catch (err) {
      add(`explanation threw: ${err.message}`);
    }
  });
  if (cfg.twins) {
    const twins = data.puzzles.filter((p) => p.kind === 'twin').length;
    if (twins !== cfg.twins) problems.push(`${tag}: ${twins} two-chain puzzles, expected ${cfg.twins}`);
  }
  return problems;
}

export function verifyAll({ log = console.log } = {}) {
  let total = 0;
  let bad = 0;
  const rows = [];
  const allKeys = new Map();
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
    for (const p of data.puzzles ?? []) {
      const key = questionKey(p);
      if (allKeys.has(key)) problems.push(`set ${cfg.set} ${p.id}: same question as ${allKeys.get(key)}`);
      else allKeys.set(key, p.id);
    }
    total += data.puzzles?.length ?? 0;
    bad += problems.length;
    for (const p of problems) log(`FAIL ${p}`);
    const kinds = {};
    for (const p of data.puzzles ?? []) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
    rows.push({
      set: cfg.set,
      n: cfg.n,
      kinds: Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(', '),
      boxes: (data.puzzles ?? []).map((p) => p.chains.map((c) => c.length).join('+')).join(','),
      options: [...new Set((data.puzzles ?? []).map((p) => p.options.length))].join('/'),
      diff: (data.puzzles ?? []).map((p) => p.difficulty).join(','),
      ok: problems.length === 0,
      ms: Date.now() - t0,
    });
  }
  log('');
  log('Operator Switch verification');
  log('set  items  puzzles                 boxes per puzzle               options  difficulty ladder                status  time');
  for (const r of rows) {
    log(`${String(r.set).padEnd(5)}${String(r.n).padEnd(7)}${r.kinds.padEnd(24)}${r.boxes.padEnd(31)}${r.options.padEnd(9)}${r.diff.padEnd(33)}${(r.ok ? 'OK' : 'FAIL').padEnd(8)}${r.ms}ms`);
  }
  log(`verified ${total} puzzles, ${bad} problem(s)`);
  return bad === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = verifyAll();
  console.log(ok ? 'verify: OK' : 'verify: FAILED');
  process.exit(ok ? 0 : 1);
}
