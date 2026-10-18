// Digit Equation did vs should: the per-blank comparison, the note, the compact codes, and what
// survives recording (stampDvs before saveAttempt keeps attempt.dvs through sanitizeAttempt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttemptLog, sanitizeAttempt } from '../js/core/recorder.js';
import { stampDvs } from '../js/core/learn-hooks.js';
import { didVsShould, formatCode } from '../js/games/digitequation/review.js';
import { loadSet } from '../tools/digitequation-verify.mjs';

const GAME = 'digitequation';
const CHARSET = /^[A-Za-z0-9.,:+*/=_<>^]*$/;

// A multi-blank puzzle with one answer, from the shipped sets.
const puzzle = [1, 2, 3, 4, 5].flatMap((n) => loadSet(n).puzzles).find((p) => p.answer.length >= 2 && p.unique);

// Builds a saved attempt from a fill (null = blank left empty). Clock advances 1.5 s per action.
function attemptFor(fill, outcome = 'solved') {
  let t = 1_000_000;
  const log = createAttemptLog({ game: GAME, set: 1, puzzleId: puzzle.id, mode: 'practice', optimal: puzzle.optimal, now: () => (t += 1500) });
  fill.forEach((d, p) => {
    if (Number.isInteger(d)) log.move(p, d);
  });
  return sanitizeAttempt(log.end(outcome, { moves: fill.filter(Number.isInteger).length }));
}

const wrongAt = (i) => puzzle.answer.map((d, k) => (k === i ? (d + 1) % 10 : d));

test('perfect attempt: no divergence, codes equal', () => {
  const a = attemptFor(puzzle.answer);
  const r = didVsShould(a, puzzle);
  assert.equal(r.div, -1);
  assert.equal(r.rows.length, puzzle.answer.length);
  assert.ok(r.rows.every((row) => row.ok === true));
  assert.equal(r.ans, r.opt);
  assert.match(r.note, /Every blank matches/);
});

test('wrong blank: first divergence, rows side by side, note names the right digit and the reason', () => {
  const a = attemptFor(wrongAt(1));
  const r = didVsShould(a, puzzle);
  assert.equal(r.div, 1);
  assert.equal(r.rows[0].ok, true);
  assert.equal(r.rows[1].ok, false);
  assert.equal(r.rows[1].did, `B = ${(puzzle.answer[1] + 1) % 10}`);
  assert.equal(r.rows[1].should, `B = ${puzzle.answer[1]}`);
  assert.ok(r.note.includes(`should be ${puzzle.answer[1]}`), r.note);
  assert.ok(r.note.length > 30);
  assert.equal(r.ans, wrongAt(1).join(''));
  assert.equal(r.opt, puzzle.answer.join(''));
});

test('lat is the time of the last tile placed in the divergent blank', () => {
  const a = attemptFor(wrongAt(1));
  const r = didVsShould(a, puzzle);
  const lastMove = a.events.filter((e) => e.type === 'move' && e.p === 1).pop();
  assert.equal(r.lat, lastMove.t);
});

test('skipped attempt with no events: blanks shown empty, first blank diverges', () => {
  const a = sanitizeAttempt({ id: 'a-skip', puzzleId: puzzle.id, set: 1, optimal: puzzle.optimal, startedAt: 1_000_000, outcome: 'skipped', events: [] });
  const r = didVsShould(a, puzzle);
  assert.equal(r.div, 0);
  assert.equal(r.rows[0].did, 'A empty');
  assert.equal(r.ans, '_'.repeat(puzzle.answer.length));
  assert.ok(r.note.length > 0);
  assert.equal(Number.isInteger(r.lat), true);
});

test('attempt with pruned events does not throw and reports no false divergence', () => {
  const a = sanitizeAttempt({ id: 'a-pruned', puzzleId: puzzle.id, set: 1, optimal: puzzle.optimal, startedAt: 1_000_000, outcome: 'solved', events: [], eventsPruned: true, metrics: { totalMs: 4200 } });
  const r = didVsShould(a, puzzle);
  assert.equal(r.div, -1);
  assert.deepEqual(r.rows, []);
  assert.equal(r.ans, r.opt);
  assert.equal(r.lat, 4200);
});

test('partly filled skip: the empty blank is the divergence', () => {
  const fill = puzzle.answer.map((d, k) => (k === 0 ? d : null));
  const a = attemptFor(fill, 'skipped');
  const r = didVsShould(a, puzzle);
  assert.equal(r.div, 1);
  assert.equal(r.rows[1].did, `${'B'} empty`);
});

test('ans and opt use only the allowed charset, at most 40 characters, and lat is an integer', () => {
  const cases = [
    attemptFor(puzzle.answer),
    attemptFor(wrongAt(0), 'timeout'),
    attemptFor(puzzle.answer.map(() => null), 'skipped'),
    sanitizeAttempt({ id: 'a-empty', puzzleId: puzzle.id, set: 1, optimal: puzzle.optimal, startedAt: 1_000_000, outcome: 'timeout', events: [] }),
  ];
  for (const a of cases) {
    const r = didVsShould(a, puzzle);
    for (const code of [r.ans, r.opt]) {
      assert.match(code, CHARSET);
      assert.ok(code.length <= 40, `code too long: ${code}`);
    }
    assert.equal(Number.isInteger(r.lat), true, `lat ${r.lat}`);
    assert.ok(r.lat >= 0);
    assert.equal(typeof r.note, 'string');
  }
});

test('formatCode reads codes back in words', () => {
  assert.equal(formatCode('43_'), 'A=4, B=3, C empty');
  assert.equal(formatCode(''), '');
});

test('stampDvs keeps attempt.dvs through sanitizeAttempt', () => {
  const log = createAttemptLog({ game: GAME, set: 1, puzzleId: puzzle.id, mode: 'practice', optimal: puzzle.optimal });
  wrongAt(0).forEach((d, p) => log.move(p, d));
  const raw = log.end('skipped', { moves: puzzle.answer.length });
  const stamped = stampDvs(GAME, raw, puzzle);
  assert.ok(stamped);
  const kept = sanitizeAttempt(raw);
  assert.deepEqual(kept.dvs, { ans: wrongAt(0).join(''), opt: puzzle.answer.join(''), div: 0, lat: stamped.lat });
});
