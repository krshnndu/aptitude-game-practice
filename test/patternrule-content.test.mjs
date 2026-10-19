// Pattern Rule files: content rules (no Unicode dashes, original names), required files, and the
// UI module's import graph and entry point (checked without a DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

const OWN = [
  ...files(join(root, 'js/games/patternrule')),
  ...files(join(root, 'data/sets/patternrule')),
  ...files(join(root, 'test')).filter((f) => /patternrule-/.test(f)),
  join(root, 'css/patternrule.css'),
  join(root, 'tools/patternrule-gen.mjs'),
  join(root, 'tools/patternrule-verify.mjs'),
  join(root, 'docs/patternrule.md'),
];

test('required Pattern Rule files exist', () => {
  for (const f of OWN) assert.ok(existsSync(f), relative(root, f));
  for (const m of ['rules', 'solver', 'gen', 'state', 'explain', 'coach', 'stream', 'render', 'play']) {
    assert.ok(existsSync(join(root, `js/games/patternrule/${m}.js`)), m);
  }
  for (const k of [1, 2, 3, 4, 5]) assert.ok(existsSync(join(root, `data/sets/patternrule/set${k}.json`)));
});

test('no Unicode em or en dashes (or similar) in Pattern Rule files', () => {
  const codes = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d]);
  const offenders = [];
  for (const f of OWN) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if ([...line].some((ch) => codes.has(ch.codePointAt(0)))) offenders.push(`${relative(root, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('names are original, not assessment vendor names', () => {
  const vendor = /\b(Motion|Switch|Digit|Grid|Deductive|Inductive)[ -]Challenge\b|smartPredict|\bAon\b|Capgemini/i;
  const offenders = OWN.filter((f) => /\.(js|css|json|mjs)$/.test(f) && !f.endsWith('patternrule-content.test.mjs') && vendor.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => relative(root, f)), []);
});

test('play.js exports mountPatternRule and only touches allowed shared modules', () => {
  const src = readFileSync(join(root, 'js/games/patternrule/play.js'), 'utf8');
  assert.match(src, /export async function mountPatternRule\(main, args = \[\]\)/);
  assert.match(src, /css\/patternrule\.css/);
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  for (const i of imports) assert.ok(i.startsWith('./') || /^\.\.\/\.\.\/core\/(dom|timer|store|recorder|score|board|learn-hooks|dvs-ui|endrun-ui|start-ui|fresh-play|fresh)\.js$/.test(i), i);
});

test('pure modules load without a DOM', async () => {
  for (const m of ['rules', 'solver', 'gen', 'state', 'explain', 'coach', 'stream']) {
    const mod = await import(`../js/games/patternrule/${m}.js`);
    assert.ok(Object.keys(mod).length > 0, m);
  }
});
