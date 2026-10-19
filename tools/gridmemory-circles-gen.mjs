#!/usr/bin/env node
// Regenerate Grid Memory Circles sets into data/sets/gridmemory/circles-setN.json (N = level 1..5).
//
//   node tools/gridmemory-circles-gen.mjs              all five levels with their fixed seeds
//   node tools/gridmemory-circles-gen.mjs --set 3      only level 3
//
// Every set is re-checked by the independent validator before writing. The tool exits non-zero
// (and writes nothing for that set) on any problem.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CIRCLE_CONFIGS, generateCircleSet } from '../js/games/gridmemory/circles.js';
import { checkCircleSet, circleSetPath } from './gridmemory-circles-verify.mjs';

const i = process.argv.indexOf('--set');
const only = i >= 0 ? Number(process.argv[i + 1]) : null;
const configs = only ? CIRCLE_CONFIGS.filter((c) => c.level === only) : CIRCLE_CONFIGS;
if (!configs.length) {
  console.error(`unknown circles level ${only}`);
  process.exit(1);
}

let failed = false;
for (const cfg of configs) {
  console.log(`circles set ${cfg.level} (stored as set ${cfg.set}, ${cfg.circles} circles, min distance ${cfg.minDist}, lengths ${cfg.lengths.join('-')}, seed ${cfg.seed})`);
  let data;
  try {
    data = generateCircleSet(cfg);
  } catch (err) {
    console.error(`FAIL circles set ${cfg.level}: ${err.message}`);
    failed = true;
    continue;
  }
  const problems = checkCircleSet(data, cfg);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    failed = true;
    continue;
  }
  const file = circleSetPath(cfg.level);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
  console.log(`  wrote ${file} [lengths: ${data.puzzles.map((p) => p.length).join(',')}]`);
}
if (failed) {
  console.error('gridmemory circles gen: FAILED');
  process.exit(1);
}
console.log('gridmemory circles gen: OK');
