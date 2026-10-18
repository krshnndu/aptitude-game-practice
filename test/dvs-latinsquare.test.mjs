// Did vs should for Latin Square: perfect, wrong and skipped attempts, the code limits, and that the
// stored codes survive the recorder's sanitizer after stampDvs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttemptLog, sanitizeAttempt } from '../js/core/recorder.js';
import { stampDvs } from '../js/core/learn-hooks.js';
import { ADAPTERS } from '../js/core/learn-registry.js';
import { didVsShould, formatCode } from '../js/games/latinsquare/review.js';
import { parsePuzzle } from '../js/games/latinsquare/state.js';
import { loadSet } from '../tools/latinsquare-verify.mjs';

const GAME = 'latinsquare';
const CODE = /^[A-Za-z0-9.,:+*/=_<>^]*$/;

// A puzzle with at least two target cells, so the first divergence can sit on the second answer.
function multiTarget() {
  for (let k = 1; k <= 5; k++) {
    const p = loadSet(k).puzzles.find((x) => x.targets.length >= 2);
    if (p) return p;
  }
  throw new Error('no set puzzle with two targets');
}

// Fake clock: 1.5 s per logged action.
function logFor(puzzle, mode = 'practice') {
  let t = 1_000_000;
  return createAttemptLog({ game: GAME, set: 5, puzzleId: puzzle.id, mode, optimal: puzzle.targets.length, now: () => (t += 1500) });
}

const puzzle = multiTarget();
const P = parsePuzzle(puzzle);
const n = P.n;
const wrongSym = (t) => (P.answers[t] + 1) % n;

function perfect() {
  const log = logFor(puzzle);
  P.answers.forEach((sym, t) => log.move(sym, t));
  return sanitizeAttempt(log.end('solved', { moves: P.answers.length }));
}

// First target right, second target wrong, then the right answer: diverges at index 1.
function wrong() {
  const log = logFor(puzzle);
  log.move(P.answers[0], 0);
  log.move(wrongSym(1), 1);
  log.move(P.answers[1], 1);
  return sanitizeAttempt(log.end('solved', { moves: 3 }));
}

test('a perfect attempt matches every answer', () => {
  const r = didVsShould(perfect(), puzzle);
  assert.equal(r.div, -1);
  assert.equal(r.ans, r.opt);
  assert.equal(r.rows.length, P.targets.length);
  assert.ok(r.rows.every((row) => row.ok === true));
  assert.match(r.note, /matched/i);
});

test('a wrong attempt diverges at the first wrong answer and explains it', () => {
  const r = didVsShould(wrong(), puzzle);
  assert.equal(r.div, 1);
  assert.equal(r.rows[0].ok, true);
  assert.equal(r.rows[1].ok, false);
  assert.match(r.rows[1].did, /\(\d,\d\) /);
  assert.notEqual(r.rows[1].did, r.rows[1].should);
  assert.ok(r.rows[1].should.includes(`(${Math.floor(P.targets[1] / n) + 1},${(P.targets[1] % n) + 1})`));
  assert.ok(r.note.length > 20);
  const answerName = formatCode(r.opt.charAt(1));
  assert.ok(r.note.includes(answerName), `note names the correct symbol: ${r.note}`);
  assert.equal(r.ans.charAt(1), P.symbols[wrongSym(1)].letter);
  assert.notEqual(r.opt, r.ans);
  assert.equal(r.opt, P.answers.map((v) => P.symbols[v].letter).join(''));
});

test('a skipped attempt with no events does not throw and reports no entries', () => {
  const attempt = { id: 'x1', game: GAME, set: 5, puzzleId: puzzle.id, mode: 'practice', startedAt: 1, outcome: 'skipped', events: [], metrics: null };
  const r = didVsShould(attempt, puzzle);
  assert.equal(r.div, 0);
  assert.ok(r.rows.every((row) => row.did === '' && row.ok === false));
  assert.equal(r.ans, '.'.repeat(P.targets.length));
  assert.equal(r.lat, 0);
  assert.match(r.note, /no answer/);
});

test('a pruned attempt (events removed, metrics kept) is handled without throwing', () => {
  const attempt = { id: 'x2', game: GAME, set: 5, puzzleId: puzzle.id, mode: 'exam', startedAt: 1, outcome: 'timeout', events: [], eventsPruned: true, metrics: { totalMs: 360000 } };
  const r = didVsShould(attempt, puzzle);
  assert.equal(r.lat, 360000);
  assert.ok(Number.isInteger(r.lat));
});

test('ans and opt use only the allowed charset, stay under 40 characters, and lat is an integer', () => {
  for (const a of [perfect(), wrong()]) {
    const r = didVsShould(a, puzzle);
    for (const code of [r.ans, r.opt]) {
      assert.match(code, CODE);
      assert.ok(code.length <= 40, code);
    }
    assert.ok(Number.isInteger(r.lat) && r.lat >= 0, `lat ${r.lat}`);
  }
});

test('stampDvs keeps the compact codes on the attempt through sanitizeAttempt', () => {
  const log = logFor(puzzle);
  P.answers.forEach((sym, t) => log.move(sym, t));
  const attempt = log.end('solved', { moves: P.answers.length });
  const d = stampDvs(GAME, attempt, puzzle);
  assert.ok(d && d.div === -1);
  const clean = sanitizeAttempt(attempt);
  assert.deepEqual(clean.dvs, { ans: d.ans, opt: d.opt, div: d.div, lat: d.lat });
});

test('formatCode reads letters back as symbol names', () => {
  assert.equal(formatCode('HC'), 'heart, circle');
  assert.equal(formatCode('.H'), 'nothing, heart');
  assert.equal(formatCode(''), '');
});

test('the adapter is registered for the learning layer', () => {
  assert.equal(typeof ADAPTERS[GAME].didVsShould, 'function');
});
