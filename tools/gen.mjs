#!/usr/bin/env node
// Regenerate Block Slide puzzle sets into data/sets/blockslide/setN.json.
//
//   node tools/gen.mjs              all five sets with their default seeds
//   node tools/gen.mjs --set 3      only set 3
//   node tools/gen.mjs --set 3 --seed 42
//
// Every generated puzzle is re-solved before writing. The tool exits non-zero (and writes
// nothing for that set) if any puzzle is unsolvable, its optimum is outside the band, or the
// stored solution does not replay to a solved board.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_CONFIGS, configFor, generateSet } from '../js/games/blockslide/gen.js';
import { checkSet } from './verify.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'data', 'sets', 'blockslide');

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
  console.log(`set ${cfg.set} (${cfg.n}x${cfg.n}, band ${cfg.band[0]}-${cfg.band[1]}, seed ${seedOverride ?? cfg.seed})`);
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
  const opts = data.puzzles.map((p) => p.optimal).join(',');
  console.log(`  wrote ${file} [optimal: ${opts}] in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
if (failed) {
  console.error('gen: FAILED');
  process.exit(1);
}
console.log('gen: OK');
