// Latin Square files: no Unicode dashes, pure modules load without a DOM, the mount export exists,
// and the stylesheet covers every symbol in both themes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYMBOLS } from '../js/games/latinsquare/state.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function files(dir) {
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return [dir];
  return readdirSync(dir).flatMap((name) => files(join(dir, name)));
}

const OWNED = [
  'js/games/latinsquare', 'data/sets/latinsquare', 'css/latinsquare.css', 'tools/latinsquare-gen.mjs',
  'tools/latinsquare-verify.mjs', 'docs/latinsquare.md',
  ...readdirSync(join(root, 'test')).filter((f) => f.startsWith('latinsquare-')).map((f) => `test/${f}`),
].flatMap((p) => files(join(root, p)));

test('no Unicode em or en dashes (or similar) in any Latin Square file', () => {
  const codes = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d]);
  const offenders = [];
  for (const f of OWNED) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if ([...line].some((ch) => codes.has(ch.codePointAt(0)))) offenders.push(`${relative(root, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
  assert.ok(OWNED.length >= 20);
});

test('play.js exports mountLatinSquare and loads without a DOM', async () => {
  const mod = await import('../js/games/latinsquare/play.js');
  assert.equal(typeof mod.mountLatinSquare, 'function');
});

test('the stylesheet colours every symbol in light and dark themes', () => {
  const css = readFileSync(join(root, 'css/latinsquare.css'), 'utf8');
  for (const s of SYMBOLS) {
    assert.match(css, new RegExp(`\\.sym-${s.id} \\.ls-shape`));
    assert.equal(css.match(new RegExp(`--sym-${s.id}:`, 'g'))?.length, 2, `${s.id} in both themes`);
  }
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /prefers-reduced-motion/);
});

test('no vendor game names in Latin Square files', () => {
  const vendorNames = /\b(Motion|Switch|Digit|Grid|Deductive|Inductive)[ -]Challenge\b|smartPredict/i;
  const offenders = OWNED.filter((f) => /\.(js|html|css|json|md)$/.test(f) && vendorNames.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => relative(root, f)), []);
});
