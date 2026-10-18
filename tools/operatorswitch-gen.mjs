#!/usr/bin/env node
// Regenerate Operator Switch puzzle sets into data/sets/operatorswitch/setN.json.
//
//   node tools/operatorswitch-gen.mjs              all five sets with their default seeds
//   node tools/operatorswitch-gen.mjs --set 3      only set 3
//   node tools/operatorswitch-gen.mjs --set 3 --seed 42
//
// Every set is re-checked by tools/operatorswitch-verify.mjs (independent solver) before writing.
// The tool exits non-zero, and writes nothing for that set, on any problem.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SET_CONFIGS, configFor, generateSet } from '../js/games/operatorswitch/gen.js';
import { checkSet, setPath } from './operatorswitch-verify.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const onlySet = arg('--set') ? Number(arg('--set')) : null;
const seedOverride = arg('--seed') ? Number(arg('--seed')) : undefined;
const configs = onlySet ? [configFor(onlySet)] : SET_CONFIGS;

let failed = false;
for (const cfg of configs) {
  const t0 = Date.now();
  console.log(`set ${cfg.set} (${cfg.name}: ${cfg.kind}, ${cfg.n} items, boxes ${cfg.boxes.join('-')}, seed ${seedOverride ?? cfg.seed})`);
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
  const file = setPath(cfg.set);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
  console.log(`  wrote ${file} in ${Date.now() - t0}ms`);
}
if (failed) {
  console.error('gen: FAILED');
  process.exit(1);
}
console.log('gen: OK');
