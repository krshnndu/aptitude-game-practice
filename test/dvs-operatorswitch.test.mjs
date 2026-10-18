// Operator Switch did vs should: the pure adapter on recorded attempts, the compact codes, the
// registry wiring, and that the recorder keeps attempt.dvs after stampDvs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttemptLog, sanitizeAttempt } from '../js/core/recorder.js';
import { ADAPTERS } from '../js/core/learn-registry.js';
import { stampDvs } from '../js/core/learn-hooks.js';
import { dvsCodes } from '../js/core/dvs.js';
import { didVsShould, formatCode } from '../js/games/operatorswitch/review.js';
import { loadSet } from '../tools/operatorswitch-verify.mjs';

const GAME = 'operatorswitch';
const LETTERS = 'ABCDEFGH';
const CHARSET = /^[A-Za-z0-9.,:+*/=_<>^]*$/;
const puzzles = loadSet(1).puzzles;
const hiddenPuzzle = loadSet(4).puzzles.find((p) => p.kind === 'hidden');
const wrongOf = (p) => (p.answer + 1) % p.options.length;

// A recorded attempt: picks are option indexes, one action every `gap` ms, then the outcome.
function attemptFor(puzzle, picks, { outcome = null, gap = 4000, ending = 1000 } = {}) {
  let t = 1_000_000;
  const log = createAttemptLog({ game: GAME, set: 1, puzzleId: puzzle.id, mode: 'practice', optimal: 1, now: () => t });
  for (const p of picks) {
    t += gap;
    log.move(p, 'answer');
  }
  t += ending;
  const final = outcome ?? (picks.includes(puzzle.answer) ? 'solved' : 'skipped');
  return sanitizeAttempt(log.end(final, { moves: picks.length }));
}

test('registry exposes the adapter and the perfect attempt matches the answer', () => {
  assert.equal(ADAPTERS[GAME].didVsShould, didVsShould);
  const p = puzzles[0];
  const d = didVsShould(attemptFor(p, [p.answer]), p);
  assert.equal(d.div, -1);
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].ok, true);
  assert.equal(d.ans, d.opt);
  assert.equal(d.ans, LETTERS[p.answer]);
  assert.match(d.note, /right answer first time/);
  assert.ok(Number.isInteger(d.lat) && d.lat >= 4000);
});

test('wrong first pick: rows side by side, divergence at the wrong pick, rule in the note', () => {
  const p = puzzles[0];
  const bad = attemptFor(p, [wrongOf(p), p.answer]);
  const d = didVsShould(bad, p);
  assert.equal(d.div, 0);
  assert.equal(d.rows.length, 2);
  assert.equal(d.rows[0].ok, false);
  assert.equal(d.rows[1].ok, true);
  assert.match(d.rows[0].did, new RegExp(`option ${LETTERS[wrongOf(p)]}`));
  assert.match(d.rows[0].should, new RegExp(`option ${LETTERS[p.answer]}`));
  assert.ok(d.note.length > 40);
  assert.match(d.note, new RegExp(`option ${LETTERS[p.answer]}`), 'note names the correct option');
  assert.match(d.note, /You needed 2 answers/);
  assert.equal(d.ans, `${LETTERS[wrongOf(p)]}${LETTERS[p.answer]}`);
  assert.equal(d.opt, LETTERS[p.answer]);
  assert.equal(d.lat, 4000, 'divergence time is the wrong pick');
});

test('skipped after a wrong pick: the missing correct row is the divergence', () => {
  const p = puzzles[1];
  const d = didVsShould(attemptFor(p, [wrongOf(p)], { outcome: 'skipped' }), p);
  assert.equal(d.rows.length, 2);
  assert.equal(d.rows[1].did, '');
  assert.equal(d.div, 0);
  assert.match(d.note, /never found it/);
});

test('skipped attempt with no events and a timeout with no picks do not throw', () => {
  const p = puzzles[2];
  const bare = { id: 'a1', puzzleId: p.id, set: 1, outcome: 'skipped', events: [], metrics: { grossMoves: 0, totalMs: 0 } };
  const d = didVsShould(bare, p);
  assert.equal(d.div, 0);
  assert.equal(d.rows.length, 1);
  assert.equal(d.ans, '');
  assert.equal(d.opt, LETTERS[p.answer]);
  assert.equal(d.lat, 0);
  assert.ok(d.note.length > 0);

  const timed = didVsShould(attemptFor(p, [], { outcome: 'timeout' }), p);
  assert.equal(timed.div, 0);
  assert.match(timed.note, /out of time/);
  assert.ok(Number.isInteger(timed.lat));
});

test('pruned attempt (events kept as an empty list) is handled without throwing', () => {
  const p = puzzles[3];
  const pruned = { id: 'a2', puzzleId: p.id, set: 1, outcome: 'solved', events: [], eventsPruned: true, metrics: { grossMoves: 1, totalMs: 7000 } };
  const d = didVsShould(pruned, p);
  assert.equal(d.div, -1);
  assert.deepEqual(d.rows, []);
  assert.equal(d.ans, LETTERS[p.answer]);
  assert.equal(d.lat, 7000);
  assert.match(d.note, /not kept/);
});

test('ans and opt use only the allowed charset, stay under 40 characters, and lat is an integer', () => {
  let checked = 0;
  for (let setNo = 1; setNo <= 5; setNo++) {
    for (const p of loadSet(setNo).puzzles) {
      const order = [...p.options.keys()].sort((a, b) => (a === p.answer) - (b === p.answer));
      for (const picks of [[p.answer], order, []]) {
        const d = didVsShould(attemptFor(p, picks), p);
        assert.match(d.ans, CHARSET);
        assert.match(d.opt, CHARSET);
        assert.ok(d.ans.length <= 40 && d.opt.length <= 40);
        assert.ok(Number.isInteger(d.lat) && d.lat >= 0, `lat for ${p.id}`);
        assert.ok(Number.isInteger(d.div) && d.div >= -1);
        assert.ok(d.note.length > 0);
        checked++;
      }
    }
  }
  assert.ok(checked >= 150);
});

test('hidden-box puzzles: the note gives the rule and the operator as the answer', () => {
  assert.ok(hiddenPuzzle, 'set 4 has a hidden-box puzzle');
  const good = didVsShould(attemptFor(hiddenPuzzle, [hiddenPuzzle.answer]), hiddenPuzzle);
  assert.equal(good.div, -1);
  const bad = didVsShould(attemptFor(hiddenPuzzle, [wrongOf(hiddenPuzzle), hiddenPuzzle.answer]), hiddenPuzzle);
  assert.equal(bad.div, 0);
  assert.match(bad.note, /box /);
  assert.ok(bad.rows.every((r) => typeof r.did === 'string' && typeof r.should === 'string'));
});

test('stampDvs stores compact codes that survive sanitizeAttempt', () => {
  const p = puzzles[4];
  const attempt = attemptFor(p, [wrongOf(p), p.answer]);
  const codes = stampDvs(GAME, attempt, p);
  assert.deepEqual(attempt.dvs, dvsCodes(didVsShould(attempt, p)));
  assert.deepEqual(codes, attempt.dvs);
  const again = sanitizeAttempt(JSON.parse(JSON.stringify(attempt)));
  assert.deepEqual(again.dvs, attempt.dvs);
  assert.equal(again.dvs.div, 0);
});

test('formatCode turns option letters into readable text', () => {
  assert.equal(formatCode('BA'), 'option B, option A');
  assert.equal(formatCode('C'), 'option C');
  assert.equal(formatCode(''), 'nothing');
  assert.equal(formatCode('box 3 1'), 'box 3 1');
});
