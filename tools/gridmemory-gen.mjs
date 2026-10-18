#!/usr/bin/env node
// Regenerate Grid Memory sets into data/sets/gridmemory/setN.json.
//
//   node tools/gridmemory-gen.mjs              all five sets with their default seeds
//   node tools/gridmemory-gen.mjs --set 3      only set 3
//   node tools/gridmemory-gen.mjs --set 3 --seed 42
//
// Every set is re-checked by the independent validator before writing. The tool exits non-zero
// (and writes nothing for that set) on any problem.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_CONFIGS, configFor, generateSet } from '../js/games/gridmemory/gen.js';
import { checkSet } from './gridmemory-verify.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'data', 'sets', 'gridmemory');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const onlySet = arg('--set') ? Number(arg('--set')) : null;
const seedOverride = arg('--seed') ? Number(arg('--seed')) : undefined;
const configs = onlySet ? [configFor(onlySet)] : SET_CONFIGS;

mkdirSync(outDir, { recursive: true });
let failed = false;
for (const cfg of configs) {
  console.log(`set ${cfg.set} (${cfg.n}x${cfg.n}, lengths ${cfg.lengths.join('-')}, ${cfg.kinds.join('+')}, seed ${seedOverride ?? cfg.seed})`);
  let data;
  try {
    data = generateSet(cfg, { seed: seedOverride });
  } catch (err) {
    console.error(`FAIL set ${cfg.set}: ${err.message}`);
    failed = true;
    continue;
  }
  const problems = checkSet(data, cfg);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    failed = true;
    continue;
  }
  const file = join(outDir, `set${cfg.set}.json`);
  writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
  console.log(`  wrote ${file} [lengths: ${data.puzzles.map((p) => p.length).join(',')}]`);
}
if (failed) {
  console.error('gridmemory gen: FAILED');
  process.exit(1);
}
console.log('gridmemory gen: OK');
