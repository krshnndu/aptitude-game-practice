#!/usr/bin/env node
// Re-verify every shipped Grid Memory Circles set with the independent validator
// (js/games/gridmemory/circles-validate.js). Per trial: circle count, centres inside the margin,
// every pair at least minDist apart, distinct sequence circles, timing and pause, side answers
// recomputed. Per set: 10 trials, lengths climbing and spanning the band, unique ids and trials,
// balanced side answers, and the file equals a fresh regeneration from its fixed seed.
// Exits non-zero on any failure.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUZZLES_PER_SET } from '../js/games/gridmemory/gen.js';
import { CIRCLE_CONFIGS, generateCircleSet } from '../js/games/gridmemory/circles.js';
import { checkCircleSetData, closestPair } from '../js/games/gridmemory/circles-validate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function circleSetPath(level) {
  return join(root, 'data', 'sets', 'gridmemory', `circles-set${level}.json`);
}

export function loadCircleSet(level) {
  return JSON.parse(readFileSync(circleSetPath(level), 'utf8'));
}

export function checkCircleSet(data, cfg) {
  return checkCircleSetData(data, cfg, { count: PUZZLES_PER_SET });
}

export function verifyCircles({ log = console.log } = {}) {
  let total = 0;
  let bad = 0;
  const rows = [];
  for (const cfg of CIRCLE_CONFIGS) {
    const file = circleSetPath(cfg.level);
    if (!existsSync(file)) {
      log(`FAIL circles set ${cfg.level}: missing ${file}`);
      bad++;
      continue;
    }
    const data = loadCircleSet(cfg.level);
    const problems = checkCircleSet(data, cfg);
    if (JSON.stringify(generateCircleSet(cfg)) !== JSON.stringify(data)) problems.push(`circles set ${cfg.level}: file differs from its seeded regeneration`);
    total += data.puzzles.length;
    bad += problems.length;
    for (const p of problems) log(`FAIL ${p}`);
    rows.push({
      level: cfg.level,
      circles: cfg.circles,
      lens: data.puzzles.map((p) => p.length),
      closest: Math.min(...data.puzzles.map((p) => closestPair(p.circles))),
      ok: problems.length === 0,
    });
  }
  log('');
  log('Grid Memory Circles verification');
  log('set  circles  lengths               closest  status');
  for (const r of rows) {
    log(`${String(r.level).padEnd(5)}${String(r.circles).padEnd(9)}${r.lens.join(',').padEnd(22)}${r.closest.toFixed(3).padEnd(9)}${r.ok ? 'OK' : 'FAIL'}`);
  }
  log(`verified ${total} trials, ${bad} problem(s)`);
  return bad === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = verifyCircles();
  console.log(ok ? 'gridmemory circles verify: OK' : 'gridmemory circles verify: FAILED');
  process.exit(ok ? 0 : 1);
}
