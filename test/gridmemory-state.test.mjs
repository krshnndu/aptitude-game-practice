// Grid Memory rules and the headless trial session used by play.js (no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mirrorMismatches, isMirrorSymmetric, arithValue, parityOf, correctAnswer, analyzeRecall, scoreSide,
  scoreTrial, createTrial, replayLog, recorderFields, POINTS,
} from '../js/games/gridmemory/state.js';
import { buildAttempt } from '../js/games/gridmemory/record.js';
import { sanitizeAttempt, createRecorder, memoryStorage, summarizeRun } from '../js/core/recorder.js';
import { HAND, SYM, ASYM1, playTrial } from './gridmemory-helpers.mjs';

test('mirror symmetry: counts differing pairs, odd and even widths', () => {
  assert.equal(mirrorMismatches(SYM), 0);
  assert.equal(isMirrorSymmetric(SYM), true);
  assert.equal(mirrorMismatches(ASYM1), 1);
  assert.equal(mirrorMismatches(['#.....', '......']), 1);
  assert.equal(mirrorMismatches(['##..##', '.#..#.']), 0);
  assert.equal(mirrorMismatches(['#....#', '#.....', '.....#']), 2);
});

test('arithmetic and parity', () => {
  assert.equal(arithValue({ a: 7, op: '+', b: 8 }), 15);
  assert.equal(arithValue({ a: 12, op: '-', b: 5 }), 7);
  assert.equal(arithValue({ a: 6, op: '*', b: 3 }), 18);
  assert.throws(() => arithValue({ a: 1, op: '/', b: 1 }));
  assert.equal(parityOf(0), 'even');
  assert.equal(parityOf(15), 'odd');
  for (const d of HAND.distractors) assert.equal(correctAnswer(d), d.answer);
});

test('recall analysis: ok, order, wrong, missing and hint statuses', () => {
  const seq = [0, 2, 8, 4];
  const perfect = analyzeRecall(seq, [0, 2, 8, 4]);
  assert.equal(perfect.correct, 4);
  assert.equal(perfect.perfect, true);
  assert.equal(perfect.firstError, null);

  const swapped = analyzeRecall(seq, [0, 8, 2, 4]);
  assert.deepEqual(swapped.positions.map((p) => p.status), ['ok', 'order', 'order', 'ok']);
  assert.equal(swapped.positions[1].belongsAt, 2);
  assert.equal(swapped.order, 2);
  assert.equal(swapped.firstError, 1);

  const mixed = analyzeRecall(seq, [0, 1, 4]);
  assert.deepEqual(mixed.positions.map((p) => p.status), ['ok', 'wrong', 'order', 'missing']);
  assert.equal(mixed.accuracy, 0.25);

  const hinted = analyzeRecall(seq, [0, 2, 8, 4], [1]);
  assert.equal(hinted.positions[1].status, 'hint');
  assert.equal(hinted.correct, 3);
});

test('side scoring: misses count as wrong, unreached questions too', () => {
  const s = scoreSide(HAND.distractors, [{ answer: 'yes', ok: true }, { answer: 'miss', ok: false }, { answer: 'yes', ok: false }]);
  assert.deepEqual({ correct: s.correct, missed: s.missed, wrong: s.wrong, total: s.total }, { correct: 1, missed: 1, wrong: 3, total: 4 });
});

test('trial score: 7 points per position, 3 per side question, partial credit', () => {
  const answers = HAND.distractors.map((d) => ({ answer: d.answer, ok: true }));
  const full = scoreTrial(HAND, { recall: HAND.sequence, answers });
  assert.equal(full.maxPoints, 40);
  assert.equal(full.points, 40);
  assert.equal(full.efficiency, 1);
  assert.equal(full.success, true);

  const half = scoreTrial(HAND, { recall: [0, 2, 1, 3], answers: answers.map((a, i) => (i < 2 ? a : { answer: 'miss', ok: false })) });
  assert.equal(half.points, 2 * POINTS.recall + 2 * POINTS.side);
  assert.equal(half.efficiency, 20 / 40);
  assert.equal(half.success, false);

  // Perfect recall with exactly one side error still passes the staircase step.
  const oneSlip = scoreTrial(HAND, { recall: HAND.sequence, answers: answers.map((a, i) => (i ? a : { answer: 'no', ok: false })) });
  assert.equal(oneSlip.success, true);
  assert.equal(scoreTrial(HAND, { recall: HAND.sequence, answers, outcome: 'skipped' }).points, 0);
});

test('session: perfect play walks show, side and recall, then locks', () => {
  const trial = createTrial(HAND);
  assert.equal(trial.phase, 'ready');
  assert.equal(trial.tap(0, 0).ok, false);
  trial.begin(100);
  assert.equal(trial.phase, 'show');
  assert.equal(trial.litCell, 0);
  assert.equal(trial.answer('yes', 150), null, 'no answers while a cell shows');
  trial.endShow(1100);
  assert.equal(trial.phase, 'side');
  assert.equal(trial.distractor.kind, 'sym');
  assert.equal(trial.answer('even', 1200), null, 'answer must fit the question kind');
  const r = trial.answer('yes', 1900);
  assert.deepEqual(r, { ok: true, answer: 'yes', rt: 800 });
  assert.equal(trial.phase, 'show');
  assert.equal(trial.litCell, 2);
  for (let i = 1; i < 4; i++) {
    trial.endShow(2000 * i + 1000);
    trial.answer(HAND.distractors[i].answer, 2000 * i + 1500);
  }
  assert.equal(trial.phase, 'recall');
  for (const c of HAND.sequence) trial.tap(c, 10_000 + c);
  assert.equal(trial.done, true, 'auto-submits when every position is entered');
  assert.equal(trial.outcome, 'submitted');
  assert.equal(trial.result().efficiency, 1);
  assert.equal(trial.skip(20_000), false);
  assert.equal(trial.events.at(-1).type, 'solve');
});

test('session: repeat taps are ignored and logged, undo and hint in practice only', () => {
  const p = playTrial(HAND, {
    recall: [],
    extra: (trial, tick) => {
      trial.tap(0, tick());
      assert.equal(trial.tap(0, tick()).reason, 'repeat');
      trial.tap(4, tick());
      assert.equal(trial.undo(tick()), true);
      const h = trial.hint(tick());
      assert.deepEqual(h, { cell: 2, position: 1 });
      trial.tap(8, tick());
      trial.tap(4, tick());
    },
  });
  assert.equal(p.done, true);
  const res = p.result();
  assert.deepEqual(res.recall.positions.map((x) => x.status), ['ok', 'hint', 'ok', 'ok']);
  assert.equal(res.points, 3 * 7 + 4 * 3);
  const types = p.events.map((e) => e.type);
  assert.ok(types.includes('blocked') && types.includes('undo') && types.includes('hint'));

  const exam = createTrial(HAND, { mode: 'exam' });
  exam.begin(0);
  for (let i = 0; i < 4; i++) {
    exam.endShow(i * 10 + 1);
    exam.answer(HAND.distractors[i].answer, i * 10 + 2);
  }
  exam.tap(0, 100);
  assert.equal(exam.undo(101), false);
  assert.equal(exam.hint(102), null);
});

test('session: hint refuses a cell already entered at another position', () => {
  const trial = createTrial(HAND);
  trial.begin(0);
  for (let i = 0; i < 4; i++) {
    trial.endShow(i * 10 + 1);
    trial.answer(HAND.distractors[i].answer, i * 10 + 2);
  }
  trial.tap(2, 100);
  const before = trial.events.length;
  // Position 2 is cell 2 (1,3), already entered as number 1: refused, nothing logged.
  assert.deepEqual(trial.hint(101), { cell: 2, position: 1, already: 0 });
  assert.equal(trial.events.length, before);
  assert.deepEqual(trial.recall, [2]);
  trial.undo(102);
  assert.deepEqual(trial.hint(103), { cell: 0, position: 0 });
  assert.deepEqual(trial.hinted, [0]);
  trial.undo(104);
  assert.deepEqual(trial.hinted, [], 'undoing a hinted cell clears its hint mark');
});

test('session: side time-outs, skips in every phase and the run clock', () => {
  const missed = playTrial(HAND, { side: ['yes', 'miss', 'no', 'miss'] });
  const res = missed.result();
  assert.equal(res.side.missed, 2);
  assert.equal(res.side.correct, 2);
  assert.equal(missed.answers[1].rt, HAND.windowMs);

  const skipShow = playTrial(HAND, { skipAt: { phase: 'show', step: 2 } });
  assert.equal(skipShow.outcome, 'skipped');
  assert.deepEqual(skipShow.events.at(-1), { t: skipShow.events.at(-1).t, type: 'skip', d: 'show', p: 2 });
  assert.equal(skipShow.result().points, 0);

  const skipRecall = playTrial(HAND, { skipAt: { phase: 'recall', after: 2 } });
  assert.equal(skipRecall.events.at(-1).d, 'recall');
  assert.equal(skipRecall.recall.length, 2);

  const t = createTrial(HAND, { mode: 'exam' });
  t.begin(0);
  t.endShow(1000);
  assert.equal(t.timeout(1500), true);
  assert.equal(t.outcome, 'timeout');
  assert.equal(t.events.at(-1).d, 'side');
});

test('replayLog rebuilds recall, hints, answers and timing from events alone', () => {
  const p = playTrial(HAND, {
    side: ['yes', 'even', 'no', 'miss'],
    recall: [],
    extra: (trial, tick) => {
      trial.tap(0, tick());
      trial.tap(0, tick());
      trial.tap(8, tick());
      trial.undo(tick());
      trial.hint(tick());
      trial.tap(4, tick());
    },
  });
  const log = replayLog(HAND, p.events);
  assert.deepEqual(log.recall, p.recall);
  assert.deepEqual(log.hinted, p.hinted);
  assert.equal(log.undos, 1);
  assert.equal(log.repeats, 1);
  assert.equal(log.hints, 1);
  assert.equal(log.outcome, 'submitted');
  assert.deepEqual(log.answers.map((a) => a.answer), ['yes', 'even', 'no', 'miss']);
  assert.deepEqual(log.answers.map((a) => a.ok), [true, false, true, false]);
  assert.ok(log.recallStart !== null && log.tapTimes.length === log.recall.length);
  const again = scoreTrial(HAND, { recall: log.recall, hinted: log.hinted, answers: log.answers });
  assert.equal(again.points, p.result().points);
});

test('recorder round trip: attempt survives sanitize and save with the same efficiency', () => {
  const p = playTrial(HAND, { recall: [0, 2, 4, 8] });
  const res = p.result();
  assert.deepEqual(recorderFields(HAND, res), { outcome: 'solved', optimal: res.points, moves: 40 });
  const a = buildAttempt(p, { set: 1, mode: 'practice', startedAt: 1_700_000_000_000 });
  assert.equal(a.metrics.efficiency, res.efficiency);
  const clean = sanitizeAttempt(a);
  assert.ok(clean, 'passes recorder validation');
  assert.equal(clean.metrics.efficiency, res.efficiency);
  assert.equal(clean.game, 'gridmemory');
  assert.deepEqual(replayLog(HAND, clean.events).recall, p.recall);

  const rec = createRecorder(memoryStorage());
  assert.equal(rec.saveAttempt(a), true);
  const back = rec.attempts({ game: 'gridmemory' })[0];
  assert.equal(back.metrics.efficiency, res.efficiency);

  const skipped = buildAttempt(playTrial(HAND, { skipAt: { phase: 'show', step: 0 } }), { set: 1, mode: 'exam', startedAt: 1_700_000_001_000 });
  assert.equal(skipped.outcome, 'skipped');
  assert.equal(skipped.metrics.efficiency, 0);
  const run = summarizeRun({ game: 'gridmemory', set: 1, seed: 1, startedAt: 0, endedAt: 1000, budgetMs: 360_000, attempts: [a, skipped] });
  assert.equal(run.score, res.efficiency);
  assert.ok(rec.saveRun({ ...run, maxSpan: 4, trail: [{ length: 4, success: false }] }));
  assert.equal(rec.runs({ game: 'gridmemory' })[0].maxSpan, 4, 'extra run fields are kept');
});
