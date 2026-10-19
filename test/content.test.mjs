// Repository-wide content rules: no Unicode em/en dashes anywhere, the disclaimer is on every
// page, and game names are our own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', 'node_modules']);

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

const ALL = files(root);

test('no Unicode em or en dashes (or similar) in any file', () => {
  const codes = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d]);
  const bad = { test: (line) => [...line].some((ch) => codes.has(ch.codePointAt(0))) };
  const offenders = [];
  for (const f of ALL) {
    const text = readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (bad.test(line)) offenders.push(`${relative(root, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('every HTML page carries the independence disclaimer in its footer', () => {
  const pages = ALL.filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 1);
  for (const f of pages) {
    const html = readFileSync(f, 'utf8');
    const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? '';
    assert.match(footer, /Practice only/i, relative(root, f));
    assert.match(footer, /href="#\/about">Full disclaimer/);
    assert.match(footer, /not affiliated/i);
    assert.match(footer, /Aon/);
    assert.match(footer, /Capgemini/);
    assert.match(footer, /any employer/);
  }
});

test('game names are original, not assessment vendor names', () => {
  const vendorNames = /\b(Motion|Switch|Digit|Grid|Deductive|Inductive)[ -]Challenge\b|smartPredict/i;
  const offenders = ALL.filter((f) => /\.(js|html|css|json)$/.test(f) && vendorNames.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => relative(root, f)), []);
});

test('required layout files exist', () => {
  const need = [
    'index.html', 'css/base.css', 'README.md', 'LEGAL.md',
    'js/core/rng.js', 'js/core/timer.js', 'js/core/store.js', 'js/core/score.js', 'js/core/shell.js',
    'js/core/recorder.js', 'js/core/analytics.js', 'js/core/analytics-page.js', 'js/core/charts.js',
    'js/games/blockslide/gen.js', 'js/games/blockslide/solver.js', 'js/games/blockslide/explain.js', 'js/games/blockslide/play.js',
    'js/games/blockslide/coach.js', 'js/games/blockslide/stream.js', 'js/games/blockslide/gen.worker.js',
    'tools/gen.mjs', 'tools/verify.mjs',
    ...[1, 2, 3, 4, 5].map((k) => `data/sets/blockslide/set${k}.json`),
  ];
  for (const f of need) assert.ok(ALL.includes(join(root, f)), `missing ${f}`);
});
