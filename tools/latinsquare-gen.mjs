#!/usr/bin/env node
// Regenerate Latin Square puzzle sets into data/sets/latinsquare/setN.json.
//
//   node tools/latinsquare-gen.mjs              all five sets with their default seeds
//   node tools/latinsquare-gen.mjs --set 3      only set 3
//   node tools/latinsquare-gen.mjs --set 3 --seed 42
//
// Every generated set is re-checked by tools/latinsquare-verify.mjs before writing (exhaustive
// uniqueness search, independent depth count, explanation replay). The tool exits non-zero and
// writes nothing for a set that fails.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_CONFIGS, configFor, generateSet } from '../js/games/latinsquare/gen.js';
import { checkSet } from './latinsquare-verify.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'data', 'sets', 'latinsquare');

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
  const t0 = Date.now();
  console.log(`set ${cfg.set} (${cfg.n}x${cfg.n}, depth ${cfg.depth}, blanks ${cfg.blanks.join('-')}, seed ${seedOverride ?? cfg.seed})`);
  let data;
  try {
    data = generateSet(cfg, { seed: seedOverride, log: (m) => console.log(m) });
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
  console.log(`  wrote ${file} [steps: ${data.puzzles.map((p) => p.steps).join(',')}] in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
if (failed) {
  console.error('gen: FAILED');
  process.exit(1);
}
console.log('gen: OK');
