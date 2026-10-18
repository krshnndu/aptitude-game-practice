#!/usr/bin/env node
// Regenerate Digit Equation puzzle sets into data/sets/digitequation/setN.json.
//
//   node tools/digitequation-gen.mjs                 all five sets with their default seeds
//   node tools/digitequation-gen.mjs --set 3         only set 3
//   node tools/digitequation-gen.mjs --set 3 --seed 42
//   node tools/digitequation-gen.mjs --dry --explain print puzzles and explanations, write nothing
//
// Every generated set is re-checked by the independent verifier before writing. The tool exits
// non-zero (and writes nothing for that set) if any puzzle fails.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_CONFIGS, configFor, generateSet } from '../js/games/digitequation/gen.js';
import { explainPuzzle } from '../js/games/digitequation/explain.js';
import { checkSet } from './digitequation-verify.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'data', 'sets', 'digitequation');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(name);

const onlySet = arg('--set') ? Number(arg('--set')) : null;
const seedOverride = arg('--seed') ? Number(arg('--seed')) : undefined;
const dry = flag('--dry');
const showExplain = flag('--explain');
const configs = onlySet ? [configFor(onlySet)] : SET_CONFIGS;

if (!dry) mkdirSync(outDir, { recursive: true });
let failed = false;
for (const cfg of configs) {
  const t0 = Date.now();
  console.log(`set ${cfg.set} (${cfg.blanks} blanks, ops ${cfg.ops.join(' ')}, decoys ${cfg.decoys.join('-')}, seed ${seedOverride ?? cfg.seed})`);
  let data;
  try {
    data = generateSet(cfg, { seed: seedOverride, log: (m) => console.log(m) });
  } catch (err) {
    console.error(`FAIL set ${cfg.set}: ${err.message}`);
    failed = true;
    continue;
  }
  if (showExplain) {
    for (const p of data.puzzles) {
      const ex = explainPuzzle(p);
      console.log(`\n  ${p.id}  ${p.tokens.join(' ')}`);
      ex.steps.forEach((s, i) => console.log(`    ${i + 1}. [${s.technique}] ${s.text}`));
      console.log(`    check: ${ex.check}`);
    }
  }
  const problems = checkSet(data, cfg);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    failed = true;
    continue;
  }
  if (dry) {
    console.log(`  dry run: set ${cfg.set} OK in ${((Date.now() - t0) / 1000).toFixed(1)}s, not written`);
    continue;
  }
  const file = join(outDir, `set${cfg.set}.json`);
  writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
  console.log(`  wrote ${file} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
if (failed) {
  console.error('digitequation-gen: FAILED');
  process.exit(1);
}
console.log('digitequation-gen: OK');
