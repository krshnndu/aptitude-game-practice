// Did vs should for Grid Memory: rows side by side, the first divergence, the plain-language note,
// the compact codes kept with the attempt, and the skipped or pruned cases that must not throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAttempt } from '../js/core/recorder.js';
import { didVsShould, formatCode } from '../js/games/gridmemory/review.js';
import { buildAttempt } from '../js/games/gridmemory/record.js';
import { stampDvs } from '../js/core/learn-hooks.js';
import { ADAPTERS } from '../js/core/learn-registry.js';
import { HAND, playTrial } from './gridmemory-helpers.mjs';
import { loadSet as gmSet } from '../tools/gridmemory-verify.mjs';

const CODE_RE = /^[A-Za-z0-9.,:+*/=_<>^]*$/;
const save = (a) => sanitizeAttempt(a);
const swapFirstTwo = (seq) => [seq[1], seq[0], ...seq.slice(2)];

test('gridmemory dvs: a perfect trial has no divergence and matching codes', () => {
  const puzzle = gmSet(3).puzzles[4];
  const good = save(buildAttempt(playTrial(puzzle), { set: 3, mode: 'practice', startedAt: 1 }));
  const r = didVsShould(good, puzzle);
  assert.equal(r.div, -1);
  assert.equal(r.ans, r.opt);
  assert.ok(r.rows.length >= puzzle.length);
  assert.ok(r.rows.every((row) => row.ok));
  assert.match(r.note, /in order/);
});

test('gridmemory dvs: a swapped recall diverges at the first swapped position, with the right cell in the note', () => {
  const puzzle = HAND;
  const bad = save(buildAttempt(playTrial(puzzle, { recall: swapFirstTwo(puzzle.sequence) }), { set: 1, mode: 'practice', startedAt: 2 }));
  const r = didVsShould(bad, puzzle);
  assert.equal(r.div, 0);
  assert.equal(r.rows[0].did, '(1,3)');
  assert.equal(r.rows[0].should, '(1,1)');
  assert.equal(r.rows[0].ok, false);
  assert.equal(r.rows[1].ok, false);
  assert.equal(r.rows[2].ok, true);
  assert.match(r.note, /Position error/);
  assert.match(r.note, /\(1,1\)/);
  assert.match(r.note, /swapped/);
  assert.equal(formatCode(r.ans), '(1,3), (1,1), (3,3), (2,2)');
});

test('gridmemory dvs: a wrong side answer adds a side row and a note that gives the answer and reason', () => {
  const puzzle = HAND;
  const side = ['no', 'odd', 'no', 'even'];
  const bad = save(buildAttempt(playTrial(puzzle, { side }), { set: 1, mode: 'practice', startedAt: 3 }));
  const r = didVsShould(bad, puzzle);
  assert.equal(r.div, puzzle.length);
  assert.equal(r.rows[puzzle.length].did, 'Side 1: no');
  assert.equal(r.rows[puzzle.length].should, 'Side 1: yes');
  assert.match(r.note, /Side question 1/);
  assert.match(r.note, /the answer was yes/);
});

test('gridmemory dvs: a skipped trial with no events does not throw and reports the first missed cell', () => {
  const puzzle = HAND;
  const skipped = { id: 'gm-skip', puzzleId: puzzle.id, set: 1, outcome: 'skipped', optimal: 0, moves: 0, startedAt: 5, events: [], metrics: {} };
  const r = didVsShould(skipped, puzzle);
  assert.equal(r.div, 0);
  assert.equal(r.ans, '');
  assert.match(r.note, /stopped after 0/);
  assert.equal(Number.isInteger(r.lat), true);
  assert.equal(didVsShould(null, puzzle).div, -1);
});

test('gridmemory dvs: pruned events (solved, no log) do not throw and report nothing to compare', () => {
  const puzzle = HAND;
  const pruned = { id: 'gm-pruned', puzzleId: puzzle.id, set: 1, outcome: 'solved', optimal: 10, moves: 40, startedAt: 9, events: [], eventsPruned: true, metrics: { totalMs: 4200 } };
  const r = didVsShould(pruned, puzzle);
  assert.equal(r.div, -1);
  assert.deepEqual(r.rows, []);
  assert.equal(r.lat, 4200);
});

test('gridmemory dvs: codes use only the allowed charset, stay within 40 characters and lat is an integer', () => {
  const puzzle = gmSet(5).puzzles[6];
  const bad = save(buildAttempt(playTrial(puzzle, { recall: swapFirstTwo(puzzle.sequence) }), { set: 5, mode: 'practice', startedAt: 7 }));
  for (const r of [didVsShould(bad, puzzle), didVsShould(save(buildAttempt(playTrial(puzzle), { set: 5, mode: 'practice', startedAt: 8 })), puzzle)]) {
    assert.match(r.ans, CODE_RE);
    assert.match(r.opt, CODE_RE);
    assert.ok(r.ans.length <= 40 && r.opt.length <= 40);
    assert.ok(Number.isInteger(r.lat) && r.lat >= 0);
  }
});

test('gridmemory dvs: stampDvs keeps attempt.dvs through sanitizeAttempt', () => {
  const puzzle = HAND;
  const bad = buildAttempt(playTrial(puzzle, { recall: swapFirstTwo(puzzle.sequence) }), { set: 1, mode: 'practice', startedAt: 4 });
  const d = stampDvs('gridmemory', bad, puzzle);
  assert.ok(d && d.div === 0);
  const kept = sanitizeAttempt(bad);
  assert.deepEqual(kept.dvs, { ans: d.ans, opt: d.opt, div: 0, lat: d.lat });
});

test('gridmemory dvs: the adapter is registered and formatCode reads cell codes', () => {
  assert.equal(ADAPTERS.gridmemory.didVsShould, didVsShould);
  assert.equal(formatCode('13.32'), '(1,3), (3,2)');
  assert.equal(formatCode(''), 'nothing');
});
