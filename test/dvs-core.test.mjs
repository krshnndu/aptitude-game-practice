// Did vs should core: divergence, side-by-side rows, compact codes, recorder persistence and the
// item telemetry size budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstDivergence, alignRows, cleanCode, dvsCodes, sanitizeDvs, dvsTelemetry, recentMistakes, codesNote, CODE_MAX, TELEMETRY_CODE_MAX, LAT_MAX } from '../js/core/dvs.js';
import { createAttemptLog, sanitizeAttempt } from '../js/core/recorder.js';
import { itemExtra } from '../js/core/board.js';

test('firstDivergence finds the first row that is not ok', () => {
  assert.equal(firstDivergence([{ ok: true }, { ok: false }, { ok: false }]), 1);
  assert.equal(firstDivergence([{ ok: true }, { ok: null }]), -1);
  assert.equal(firstDivergence([]), -1);
  assert.equal(firstDivergence(null), -1);
});

test('alignRows pairs steps and marks one-sided steps as off', () => {
  const rows = alignRows(['a', 'b', 'x'], ['a', 'b', 'c', 'd']);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { did: 'a', should: 'a', ok: true });
  assert.deepEqual(rows[2], { did: 'x', should: 'c', ok: false });
  assert.deepEqual(rows[3], { did: '', should: 'd', ok: false });
  assert.equal(firstDivergence(rows), 2);
  const custom = alignRows([1, 2], [1, 3], (a, b) => a === b, (x) => `n${x}`);
  assert.equal(custom[1].did, 'n2');
  assert.equal(custom[1].ok, false);
});

test('cleanCode keeps only the code charset and caps the length', () => {
  assert.equal(cleanCode('0R 1U\n"<script>"'), '0R1U<script>');
  assert.equal(cleanCode('a\u2013b'), 'ab');
  assert.equal(cleanCode('x'.repeat(100)).length, CODE_MAX);
  assert.equal(cleanCode(null), '');
});

test('dvsCodes and sanitizeDvs keep four bounded fields only', () => {
  const d = dvsCodes({ ans: 'AB', opt: 'AC', div: 1.4, lat: 1234.6, note: 'free text', rows: [] });
  assert.deepEqual(d, { ans: 'AB', opt: 'AC', div: 1, lat: 1235 });
  assert.deepEqual(sanitizeDvs({ ans: 5, opt: undefined, div: 'x', lat: 1e12 }), { ans: '5', opt: '', div: -1, lat: LAT_MAX });
  assert.equal(sanitizeDvs(null), null);
  assert.equal(sanitizeDvs('AB'), null);
});

test('dvsTelemetry shortens codes for the item event', () => {
  const t = dvsTelemetry({ ans: '1'.repeat(40), opt: '2'.repeat(40), div: 3, lat: 900 });
  assert.equal(t.ans.length, TELEMETRY_CODE_MAX);
  assert.equal(t.opt.length, TELEMETRY_CODE_MAX);
  assert.equal(t.div, 3);
  assert.deepEqual(dvsTelemetry(undefined), {});
});

test('recorder keeps a sanitized dvs record and drops a bad one', () => {
  let t = 1000;
  const log = createAttemptLog({ game: 'latinsquare', set: 1, puzzleId: 'p1', mode: 'practice', optimal: 1, now: () => (t += 500) });
  log.move(0, 'x');
  const a = log.end('skipped');
  a.dvs = { ans: 'C', opt: 'H', div: 0, lat: 500, junk: 'nope' };
  assert.deepEqual(sanitizeAttempt(a).dvs, { ans: 'C', opt: 'H', div: 0, lat: 500 });
  a.dvs = 'bad';
  assert.equal('dvs' in sanitizeAttempt(a), false);
});

test('recentMistakes lists diverged attempts of one game, newest first', () => {
  const mk = (id, game, startedAt, div, extra = {}) => ({ id, game, startedAt, dvs: { ans: 'a', opt: 'b', div, lat: 1 }, ...extra });
  const list = [mk('a1', 'g', 1, 0), mk('a2', 'g', 3, 2), mk('a3', 'g', 2, -1), mk('a4', 'h', 4, 0), mk('a5', 'g', 5, 0, { sample: true }), { id: 'a6', game: 'g', startedAt: 9 }];
  assert.deepEqual(recentMistakes(list, { game: 'g' }).map((a) => a.id), ['a2', 'a1']);
  assert.deepEqual(recentMistakes(list, { limit: 1 }).map((a) => a.id), ['a4']);
});

test('codesNote reads stored codes in plain language', () => {
  assert.match(codesNote({ ans: '12', opt: '13', div: 1, lat: 2500 }), /You gave 12; the answer was 13\. First went wrong at step 2, 2\.5 s in\./);
  assert.match(codesNote({ ans: '13', opt: '13', div: -1, lat: 1000 }, (c) => `[${c}]`), /Matched the answer \(\[13\]\)/);
  assert.equal(codesNote(null), '');
});

test('item telemetry with worst-case codes stays under 512 bytes', () => {
  const a = { game: 'operatorswitch', set: 5, mode: 'practice', metrics: { totalMs: 3599999 }, outcome: 'skipped', hintsUsed: 3,
    dvs: { ans: '9'.repeat(40), opt: '8'.repeat(40), div: 999, lat: LAT_MAX } };
  const extra = itemExtra(a, 'a'.repeat(30), 99999);
  const body = { cid: 'c'.repeat(36), sid: 's'.repeat(10), page: 'operatorswitch', ev: 'item', dev: 'desktop', v: '2026-10-18', self: true, ...extra };
  const bytes = Buffer.byteLength(JSON.stringify(body));
  assert.ok(bytes < 512, `item event is ${bytes} bytes`);
  assert.equal(extra.ans.length, TELEMETRY_CODE_MAX);
  for (const k of ['ans', 'opt', 'div', 'lat']) assert.ok(k in extra);
});
