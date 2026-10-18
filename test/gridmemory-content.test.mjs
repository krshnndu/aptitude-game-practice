// Content rules for the Grid Memory files: no Unicode dashes, original naming, required files,
// the stylesheet linked by the mount function exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function files(dir) {
  if (!existsSync(dir)) return [];
  if (statSync(dir).isFile()) return [dir];
  return readdirSync(dir).flatMap((name) => files(join(dir, name)));
}

const MINE = [
  'js/games/gridmemory', 'data/sets/gridmemory', 'css/gridmemory.css', 'tools/gridmemory-gen.mjs',
  'tools/gridmemory-verify.mjs', 'docs/gridmemory.md',
  ...readdirSync(join(root, 'test')).filter((f) => f.startsWith('gridmemory-')).map((f) => `test/${f}`),
].flatMap((p) => files(join(root, p)));

test('no Unicode em or en dashes (or similar) in Grid Memory files', () => {
  const codes = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d]);
  const offenders = [];
  for (const f of MINE) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if ([...line].some((ch) => codes.has(ch.codePointAt(0)))) offenders.push(`${relative(root, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('names are original, not assessment vendor names', () => {
  const vendorNames = /\b(Motion|Switch|Digit|Grid|Deductive|Inductive)[ -]Challenge\b|smartPredict/i;
  // Same scope as test/content.test.mjs: site files only (this test holds the pattern itself).
  const site = MINE.filter((f) => /\.(js|html|css|json|md)$/.test(f));
  assert.ok(site.length > 10);
  assert.deepEqual(site.filter((f) => vendorNames.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f)), []);
});

test('required Grid Memory files exist', () => {
  const need = [
    'js/games/gridmemory/state.js', 'js/games/gridmemory/gen.js', 'js/games/gridmemory/validate.js',
    'js/games/gridmemory/explain.js', 'js/games/gridmemory/coach.js', 'js/games/gridmemory/stream.js',
    'js/games/gridmemory/record.js', 'js/games/gridmemory/play.js', 'css/gridmemory.css',
    'tools/gridmemory-gen.mjs', 'tools/gridmemory-verify.mjs', 'docs/gridmemory.md',
    ...[1, 2, 3, 4, 5].map((k) => `data/sets/gridmemory/set${k}.json`),
  ];
  for (const f of need) assert.ok(existsSync(join(root, f)), `missing ${f}`);
});

test('play.js exports mountGridMemory and links its own stylesheet', () => {
  const src = readFileSync(join(root, 'js/games/gridmemory/play.js'), 'utf8');
  assert.match(src, /export async function mountGridMemory\(main, args = \[\]\)/);
  assert.match(src, /css\/gridmemory\.css/);
});
