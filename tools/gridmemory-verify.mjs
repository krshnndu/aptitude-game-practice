#!/usr/bin/env node
// Re-verify every shipped Grid Memory set with the independent validator (js/games/gridmemory/validate.js).
// Per puzzle: grid size, length inside the band, timing, distinct in-grid cells (one correct ordered
// response), one side question per highlight, each side answer recomputed independently (mirror pairs,
// connected shape, arithmetic), subtle-asymmetry band, no repeated shape. Per set: 10 puzzles, lengths
// climbing and spanning the band, unique ids and sequences, every question kind present, balanced
// answers. Exits non-zero on any failure.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_CONFIGS, PUZZLES_PER_SET } from '../js/games/gridmemory/gen.js';
import { checkSetData } from '../js/games/gridmemory/validate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function setPath(setNo) {
  return join(root, 'data', 'sets', 'gridmemory', `set${setNo}.json`);
}

export function loadSet(setNo) {
  return JSON.parse(readFileSync(setPath(setNo), 'utf8'));
}

export function checkSet(data, cfg) {
  return checkSetData(data, cfg, { count: PUZZLES_PER_SET });
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
    const data = loadSet(cfg.set);
    const problems = checkSet(data, cfg);
    total += data.puzzles.length;
    bad += problems.length;
    for (const p of problems) log(`FAIL ${p}`);
    const sides = data.puzzles.flatMap((p) => p.distractors);
    const yes = sides.filter((d) => d.answer === 'yes' || d.answer === 'even').length;
    rows.push({
      set: cfg.set,
      n: cfg.n,
      lens: data.puzzles.map((p) => p.length),
      kinds: cfg.kinds.join('+'),
      window: cfg.windowMs,
      sides: `${yes}/${sides.length - yes}`,
      ok: problems.length === 0,
    });
  }
  log('');
  log('Grid Memory verification');
  log('set  grid  lengths               kinds        window  yes-even/no-odd  status');
  for (const r of rows) {
    log(`${String(r.set).padEnd(5)}${`${r.n}x${r.n}`.padEnd(6)}${r.lens.join(',').padEnd(22)}${r.kinds.padEnd(13)}${`${r.window / 1000}s`.padEnd(8)}${r.sides.padEnd(17)}${r.ok ? 'OK' : 'FAIL'}`);
  }
  log(`verified ${total} puzzles, ${bad} problem(s)`);
  return bad === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = verifyAll();
  console.log(ok ? 'gridmemory verify: OK' : 'gridmemory verify: FAILED');
  process.exit(ok ? 0 : 1);
}
