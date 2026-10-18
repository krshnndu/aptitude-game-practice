// Pattern Rule game state: session, grading, hints, attempt log and the core recorder round trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, gradeSelection, nextHint, createPickLog, replayPicks, attemptResult, attemptPicks, ruleDimsText, letter } from '../js/games/patternrule/state.js';
import { createRecorder, memoryStorage, summarizeRun } from '../js/core/recorder.js';
import { loadSet } from '../tools/patternrule-verify.mjs';

const P5 = loadSet(5).puzzles[0];
const negatives = (p) => p.candidates.map((_, i) => i).filter((i) => !p.answer.includes(i));

test('grading: exact, false picks, misses, correct rejects', () => {
  const p = P5;
  const g = gradeSelection(p, p.answer);
  assert.equal(g.exact, true);
  assert.equal(g.score, 1);
  const wrong = negatives(p)[0];
  const h = gradeSelection(p, [p.answer[0], wrong]);
  assert.equal(h.exact, false);
  assert.equal(h.score, 0);
  assert.deepEqual(h.falsePicks, [wrong]);
  assert.deepEqual(h.misses, p.answer.slice(1));
  assert.equal(h.hits.length + h.falsePicks.length + h.misses.length + h.correctRejects.length, p.candidates.length);
});

test('session: toggle, clear, submit only with a pick, answer is final', () => {
  const p = P5;
  const s = createSession(p);
  assert.equal(s.canSubmit(), false);
  assert.equal(s.submit(), null);
  assert.equal(s.toggle(99), null);
  assert.equal(s.toggle(0), true);
  assert.equal(s.toggle(0), false);
  for (const i of p.answer) s.toggle(i);
  s.toggle(negatives(p)[0]);
  assert.deepEqual(s.clear().length, p.answer.length + 1);
  assert.deepEqual(s.picks, []);
  for (const i of p.answer) s.toggle(i);
  const r = s.submit();
  assert.equal(r.exact, true);
  assert.equal(s.status, 'answered');
  assert.equal(s.toggle(0), null, 'no changes after answering');
  assert.equal(s.skip(), false);
  assert.equal(s.toggles.length, 2 + (p.answer.length + 1) * 2 + p.answer.length);
});

test('session: skip and timeout score 0 and keep the picks for the review', () => {
  const s = createSession(P5);
  for (const i of P5.answer) s.toggle(i);
  assert.ok(s.skip());
  assert.equal(s.status, 'skipped');
  assert.equal(s.result.score, 0);
  assert.equal(s.result.exact, false);
  const t = createSession(P5);
  assert.ok(t.timeout());
  assert.equal(t.status, 'timeout');
  assert.equal(t.timeout(), false);
});

test('hints: dimensions, then the count, then rule out non-fitting candidates (picked ones first), never all', () => {
  const p = P5;
  const s = createSession(p);
  const bad = negatives(p);
  s.toggle(bad[bad.length - 1]);
  const h0 = s.hint();
  assert.equal(h0.kind, 'dims');
  assert.match(h0.text, new RegExp(ruleDimsText(p.rule).replace(/[()]/g, '\\$&')));
  const h1 = s.hint();
  assert.match(h1.text, new RegExp(`^${p.answer.length} of the ${p.candidates.length} candidates`));
  const h2 = s.hint();
  assert.equal(h2.kind, 'rule-out');
  assert.equal(h2.candidate, bad[bad.length - 1], 'a wrong pick is ruled out first');
  assert.match(h2.text, new RegExp(`^Candidate ${letter(h2.candidate)} does not fit: .+\\(breaks the .+ part of the rule\\)\\.$`));
  let more = 0;
  while (s.hint()) more++;
  assert.equal(more, bad.length - 2, 'one non-fitting candidate is always left to find');
  assert.equal(s.ruledOut.length, bad.length - 1);
  assert.equal(s.hintsUsed, 2 + bad.length - 1);
  assert.equal(createSession(p, { mode: 'exam' }).hint(), null, 'no hints in exam mode');
  assert.equal(nextHint(p, 0).level, 0);
});

test('pick log: events, metrics and outcome mapping for the core recorder', () => {
  let t = 0;
  const now = () => t;
  const p = P5;
  const log = createPickLog({ set: 5, puzzleId: p.id, mode: 'practice', optimal: p.answer.length, now });
  t = 4000;
  log.toggle(p.answer[0], true);
  t = 6000;
  log.toggle(negatives(p)[0], true);
  t = 7000;
  log.toggle(negatives(p)[0], false);
  t = 9000;
  for (const i of p.answer.slice(1)) log.toggle(i, true);
  log.hint();
  t = 12000;
  const a = log.end('correct', { picks: p.answer, hintsUsed: 1 });
  assert.equal(a.game, 'patternrule');
  assert.equal(a.outcome, 'solved');
  assert.equal(a.metrics.efficiency, 1);
  assert.equal(a.metrics.firstMoveMs, 4000);
  assert.equal(a.metrics.totalMs, 12000);
  assert.equal(a.metrics.grossMoves, 3 + p.answer.length - 1);
  assert.equal(a.metrics.wastedMoves, 2, 'a pick and unpick of a wrong candidate');
  assert.deepEqual(replayPicks(a.events), p.answer);
  assert.equal(attemptResult(a), 'correct');
  assert.equal(log.end('wrong'), a, 'end is final');

  const w = createPickLog({ set: 5, puzzleId: p.id, mode: 'exam', optimal: p.answer.length, now });
  w.toggle(negatives(p)[0], true);
  const wa = w.end('wrong', { picks: [negatives(p)[0]] });
  assert.equal(wa.outcome, 'skipped', 'the core recorder has no wrong outcome: stored as skipped, scores 0');
  assert.equal(wa.metrics.efficiency, 0);
  assert.equal(attemptResult(wa), 'wrong');
  assert.deepEqual(attemptPicks(wa), [negatives(p)[0]]);
  assert.throws(() => createPickLog({ set: 1, puzzleId: 'x', mode: 'practice', optimal: 1 }).end('nope'), /unknown result/);
});

test('recorder round trip keeps the closing event details, and runs score 1 per correct answer', () => {
  const rec = createRecorder(memoryStorage());
  let t = 1000;
  const now = () => t;
  const p = P5;
  const make = (result, picks) => {
    const log = createPickLog({ set: 5, puzzleId: p.id, mode: 'exam', runId: 'r1', optimal: p.answer.length, now });
    t += 2000;
    for (const i of picks) log.toggle(i, true);
    t += 3000;
    return log.end(result, { picks });
  };
  const atts = [make('correct', p.answer), make('wrong', [negatives(p)[0]]), make('skipped', []), make('timeout', [p.answer[0]])];
  for (const a of atts) assert.ok(rec.saveAttempt(a));
  const back = rec.attempts({ game: 'patternrule' });
  assert.equal(back.length, 4);
  assert.deepEqual(back.map(attemptResult), ['correct', 'wrong', 'skipped', 'timeout']);
  assert.deepEqual(attemptPicks(back[1]), [negatives(p)[0]]);
  const run = summarizeRun({ id: 'r1', game: 'patternrule', set: 5, seed: 1, startedAt: 0, endedAt: t, budgetMs: 360000, attempts: atts });
  assert.equal(run.score, 1);
  assert.equal(run.solved, 1);
  assert.ok(rec.saveRun(run));
});
