// Pattern Rule did vs should: rows, first divergence, note, answer codes, latency, and that the
// stamped codes survive the recorder's sanitizer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttemptLog, sanitizeAttempt } from '../js/core/recorder.js';
import { createPickLog } from '../js/games/patternrule/state.js';
import { didVsShould, formatCode } from '../js/games/patternrule/review.js';
import { stampDvs } from '../js/core/learn-hooks.js';
import { cleanCode, CODE_MAX, firstDivergence } from '../js/core/dvs.js';
import { loadSet } from '../tools/patternrule-verify.mjs';

const puzzles = loadSet(1).puzzles;
const puzzle = puzzles[0];
const CODE_OK = /^[A-Za-z0-9.,:+*/=_<>^]*$/;

// Toggles at [t, candidate, on] ms; closing result at `end` ms.
function attemptWith(p, toggles, { result = 'correct', end = 9000, picks = null } = {}) {
  let t = 0;
  const log = createPickLog({ set: 1, puzzleId: p.id, mode: 'practice', optimal: p.answer.length, now: () => t });
  for (const [at, i, on] of toggles) {
    t = at;
    log.toggle(i, on);
  }
  t = end;
  const final = picks ?? replay(toggles);
  return sanitizeAttempt(log.end(result, { picks: final }));
}
function replay(toggles) {
  const s = new Set();
  for (const [, i, on] of toggles) (on ? s.add(i) : s.delete(i));
  return [...s].sort((a, b) => a - b);
}
const notFit = (p) => p.candidates.map((_, i) => i).filter((i) => !p.answer.includes(i));

test('perfect attempt: no divergence, codes match, lat is the attempt time', () => {
  for (const p of puzzles) {
    const toggles = p.answer.map((i, k) => [1000 * (k + 1), i, true]);
    const a = attemptWith(p, toggles, { end: 7000 });
    const r = didVsShould(a, p);
    assert.equal(r.div, -1, p.id);
    assert.equal(r.rows.length, p.candidates.length);
    assert.ok(r.rows.every((row) => row.ok), p.id);
    assert.equal(r.ans, r.opt, p.id);
    assert.equal(r.lat, 7000, p.id);
    assert.match(r.note, /^Matched/);
    assert.match(r.note, /The rule: /);
  }
});

test('wrong attempt: first divergence at the false pick, side-by-side rows, note names rule and fitting set', () => {
  const wrong = notFit(puzzle)[0];
  const toggles = [...puzzle.answer.map((i, k) => [1000 * (k + 1), i, true]), [5000, wrong, true]];
  const a = attemptWith(puzzle, toggles, { result: 'wrong', end: 6000 });
  const r = didVsShould(a, puzzle);
  assert.equal(r.div, wrong, 'row index of the false pick');
  assert.equal(firstDivergence(r.rows), r.div);
  assert.equal(r.rows[r.div].ok, false);
  assert.match(r.rows[r.div].did, /^Picked /);
  assert.match(r.rows[r.div].should, /does not fit/);
  assert.ok(r.note.length > 40 && r.note.length < 400);
  assert.match(r.note, new RegExp(`You picked ${String.fromCharCode(65 + wrong)}, which does not fit`));
  assert.ok(r.note.includes('The rule: '));
  assert.equal(r.lat, 5000, 'latency is the action at the divergence');
  assert.notEqual(r.ans, r.opt);
  assert.equal(r.opt, cleanCode(puzzle.answer.map((i) => String.fromCharCode(65 + i)).join('')));
});

test('missed fitting candidate diverges and the note says it fits', () => {
  const missed = puzzle.answer[0];
  const others = puzzle.answer.slice(1).map((i, k) => [1000 * (k + 1), i, true]);
  const a = attemptWith(puzzle, others, { result: 'wrong', end: 4000 });
  const r = didVsShould(a, puzzle);
  assert.equal(r.div, missed);
  assert.match(r.note, /You left out [A-F], which fits/);
  assert.equal(r.lat, 4000, 'no action on the missed candidate: the attempt end');
});

test('skipped attempt with no events does not throw and keeps the same shape', () => {
  const a = { id: 'x', game: 'patternrule', set: 1, puzzleId: puzzle.id, outcome: 'skipped', events: [], startedAt: 1, optimal: 1, moves: 0, metrics: {} };
  const r = didVsShould(a, puzzle);
  assert.equal(r.rows.length, puzzle.candidates.length);
  assert.equal(r.ans, '');
  assert.equal(r.lat, 0);
  assert.equal(r.div, firstDivergence(r.rows));
  assert.ok(r.div >= 0);
  assert.match(r.note, /No picks were recorded/);
  assert.equal(formatCode(r.ans), 'nothing');
});

test('attempt with pruned events (events: []) and a correct outcome does not throw', () => {
  const r = didVsShould({ events: [], outcome: 'solved' }, puzzle);
  assert.equal(r.div, -1);
  assert.equal(r.ans, r.opt);
});

test('timeout attempt with no events and missing fields does not throw', () => {
  assert.doesNotThrow(() => didVsShould({ outcome: 'timeout' }, puzzle));
  assert.doesNotThrow(() => didVsShould({}, puzzle));
});

test('codes use only the allowed charset, stay within the length limit, and lat is an integer', () => {
  for (const p of puzzles) {
    const wrong = notFit(p).slice(0, 2);
    const a = attemptWith(p, [...wrong.map((i, k) => [1234 * (k + 1), i, true])], { result: 'wrong', end: 3333 });
    for (const x of [didVsShould(a, p), didVsShould(attemptWith(p, [], { result: 'skipped', end: 100 }), p)]) {
      assert.match(x.ans, CODE_OK);
      assert.match(x.opt, CODE_OK);
      assert.ok(x.ans.length <= CODE_MAX && x.opt.length <= CODE_MAX);
      assert.ok(Number.isInteger(x.lat) && x.lat >= 0, `lat ${x.lat}`);
    }
  }
});

test('stampDvs keeps the codes on the attempt through sanitizeAttempt', () => {
  const log = createAttemptLog({ game: 'patternrule', set: 1, puzzleId: puzzle.id, mode: 'practice', optimal: puzzle.answer.length });
  const raw = log.end('skipped', { moves: 0 });
  const a = sanitizeAttempt(raw);
  const d = stampDvs('patternrule', a, puzzle);
  assert.ok(d, 'stamp returns the codes');
  assert.equal(a.dvs.div, d.div);
  assert.equal(sanitizeAttempt(a).dvs.opt, d.opt);
  assert.deepEqual(sanitizeAttempt(a).dvs, { ans: d.ans, opt: d.opt, div: d.div, lat: d.lat });
});

test('formatCode reads codes back as candidate letters', () => {
  assert.equal(formatCode('BD'), 'candidates B and D');
  assert.equal(formatCode('C'), 'candidate C');
  assert.equal(formatCode(''), 'nothing');
});
