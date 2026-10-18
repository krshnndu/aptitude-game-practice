// Hooks the game pages call: coach tags and auto-added notebook items with an exact checksum, run
// coaching feeding the notebook, and a finished retry rescheduling its item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStorage, createAttemptLog, sanitizeAttempt } from '../js/core/recorder.js';
import { createLearnStore } from '../js/core/learn-store.js';
import { useLearnStore, noteAttempt, noteRun, setRetry, completeRetry, clearRetry } from '../js/core/learn-hooks.js';
import { rebuild } from '../js/core/learn-registry.js';
import { loadSet } from '../tools/operatorswitch-verify.mjs';
import { generateFresh } from '../js/games/operatorswitch/gen.js';

const DAY = 24 * 3600 * 1000;
function attempt(puzzle, picks, { set = 1, mode = 'practice', source = 'pool', runId = null } = {}) {
  let t = 5_000_000;
  const log = createAttemptLog({ game: 'operatorswitch', set, puzzleId: puzzle.id, mode, runId, source, optimal: 1, now: () => (t += 2000) });
  for (const p of picks) log.move(p, 'answer');
  const solved = picks[picks.length - 1] === puzzle.answer;
  return sanitizeAttempt(log.end(solved ? 'solved' : 'skipped', { moves: picks.length }));
}

test('noteAttempt saves fix tags and adds a failed attempt to the notebook with a seed reference', async () => {
  const store = createLearnStore(memoryStorage());
  useLearnStore(store);
  const puzzle = loadSet(2).puzzles[3];
  const wrong = (puzzle.answer + 1) % puzzle.options.length;
  const a = attempt(puzzle, [wrong, puzzle.answer], { set: 2 });
  noteAttempt('operatorswitch', a, [{ id: 'err-reversed', kind: 'fix' }, { id: 'quick', kind: 'good' }], puzzle);
  assert.deepEqual(store.load().tags[a.id], ['err-reversed']);
  const it = store.item(a.id);
  assert.ok(it, 'efficiency 0.5 goes to the notebook');
  assert.equal(it.ref.src, 'pool');
  assert.ok(it.ref.check);
  assert.ok(it.path.length >= 2);
  noteAttempt('operatorswitch', a, [], puzzle);
  assert.equal(store.items().length, 1, 'idempotent');
  const clean = attempt(puzzle, [puzzle.answer], { set: 2 });
  noteAttempt('operatorswitch', clean, [], puzzle);
  assert.equal(store.item(clean.id), null, 'a clean solve is not a mistake');
});

test('noteRun maps per-puzzle coaching onto the run attempts, generated puzzles by seed', () => {
  const store = createLearnStore(memoryStorage());
  useLearnStore(store);
  const p = generateFresh(3, 4242);
  const a = attempt(p, [(p.answer + 1) % p.options.length], { set: 3, mode: 'exam', source: 'generated', runId: 'r1' });
  noteRun('operatorswitch', { id: 'r1', seed: 9 }, [a], [[{ id: 'err-dropped', kind: 'fix' }]], new Map([[p.id, p]]));
  const it = store.item(a.id);
  assert.equal(it.ref.src, 'generated');
  assert.equal(it.ref.seed, 4242);
  assert.deepEqual(it.tags, ['err-dropped']);
});

test('completeRetry grades the retry, reschedules, logs a retry-first review and the cleared queue', () => {
  const store = createLearnStore(memoryStorage());
  useLearnStore(store);
  const puzzle = loadSet(1).puzzles[0];
  const a = attempt(puzzle, [(puzzle.answer + 1) % puzzle.options.length]);
  noteAttempt('operatorswitch', a, [], puzzle);
  const it = store.item(a.id);
  store.upsertItem({ ...it, dueAt: Date.now() - DAY });
  setRetry({ game: 'operatorswitch', itemId: it.id, attemptId: a.id, puzzle, set: 1, revealed: false, returnHash: '#/x' });
  const retry = attempt(puzzle, [puzzle.answer], { source: 'review' });
  const res = completeRetry('operatorswitch', retry);
  assert.equal(res.result, 'pass');
  const after = store.item(it.id);
  assert.equal(after.interval, 3);
  const events = store.load().events;
  const review = events.find((e) => e.type === 'review');
  assert.equal(review.retryFirst, true);
  assert.equal(review.solved, true);
  assert.ok(events.some((e) => e.type === 'queue_cleared' && e.game === 'operatorswitch'));
  clearRetry();
  assert.equal(completeRetry('operatorswitch', retry), null, 'no pending retry, nothing graded');
});

test('rebuild flags a stale reference whose checksum no longer matches', async () => {
  const puzzle = loadSet(1).puzzles[0];
  globalThis.fetch = async () => ({ ok: true, json: async () => loadSet(1) });
  const ok = await rebuild('operatorswitch', { pid: puzzle.id, set: 1, src: 'pool', gv: 1, check: 'deadbeef' });
  assert.equal(ok.stale, true);
  const gen = await rebuild('operatorswitch', { pid: 'os1-g1', set: 1, src: 'generated', seed: 1, gv: 1 });
  assert.equal(gen.stale, false);
  assert.equal(gen.puzzle.id, 'os1-g1');
  delete globalThis.fetch;
});
