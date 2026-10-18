// Digit Equation: shipped sets pass the independent verifier; content rules for this game's files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_CONFIGS, PUZZLES_PER_SET } from '../js/games/digitequation/gen.js';
import { loadSet, checkSet } from '../tools/digitequation-verify.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const cfg of SET_CONFIGS) {
  test(`shipped set ${cfg.set} passes the independent brute-force verifier`, () => {
    const data = loadSet(cfg.set);
    assert.equal(data.puzzles.length, PUZZLES_PER_SET);
    const problems = checkSet(data, cfg);
    assert.deepEqual([...problems], []);
    assert.equal(problems.uniqueCount, PUZZLES_PER_SET, 'every shipped puzzle has a unique answer');
  });
}

test('puzzle ids are unique across all sets', () => {
  const ids = SET_CONFIGS.flatMap((c) => loadSet(c.set).puzzles.map((p) => p.id));
  assert.equal(new Set(ids).size, ids.length);
});

function files(p) {
  if (!existsSync(p)) return [];
  if (!statSync(p).isDirectory()) return [p];
  return readdirSync(p).flatMap((n) => files(join(p, n)));
}
const OWN = [
  'js/games/digitequation', 'data/sets/digitequation', 'css/digitequation.css', 'tools/digitequation-gen.mjs',
  'tools/digitequation-verify.mjs', 'docs/digitequation.md',
  ...readdirSync(join(root, 'test')).filter((n) => n.startsWith('digitequation-')).map((n) => `test/${n}`),
].flatMap((p) => files(join(root, p)));

test('no Unicode em or en dashes (or similar) in this game\'s files', () => {
  const codes = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d]);
  const bad = { test: (line) => [...line].some((ch) => codes.has(ch.codePointAt(0))) };
  const offenders = [];
  for (const f of OWN) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (bad.test(line)) offenders.push(`${relative(root, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
  assert.ok(OWN.length >= 15);
});

test('play module exports the mount function and injects its own stylesheet', () => {
  const src = readFileSync(join(root, 'js/games/digitequation/play.js'), 'utf8');
  assert.match(src, /export async function mountDigitEquation\(main, args = \[\]\)/);
  assert.match(src, /css\/digitequation\.css/);
  assert.ok(existsSync(join(root, 'css/digitequation.css')));
});
