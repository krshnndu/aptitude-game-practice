// Play recorder: action log, metrics, versioned storage, migration, limits, backup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAttemptLog, computeMetrics, createRecorder, summarizeRun, migrate, sanitizeAttempt, enforceLimits,
  makeBackup, parseBackup, RECORDER_KEY, RECORDER_VERSION, BACKUP_KIND,
} from '../js/core/recorder.js';
import { createStore, memoryStorage } from '../js/core/store.js';

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t, at: (ms) => (c.t = start + ms) };
  return c;
}

function memory() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

// A finished attempt: actions are [ms, method, ...args].
function attempt(actions, { outcome = 'solved', optimal = 3, moves, set = 1, puzzleId = 'bs1-01', mode = 'practice', end, runId = null } = {}) {
  const c = clock();
  const log = createAttemptLog({ game: 'blockslide', set, puzzleId, mode, runId, optimal, now: c.now });
  for (const [ms, fn, ...args] of actions) {
    c.at(ms);
    log[fn](...args);
  }
  if (end !== undefined) c.at(end);
  return log.end(outcome, { moves });
}

test('attempt log: timestamps, metrics and a closing event', () => {
  const a = attempt([
    [800, 'select', 1],
    [4000, 'move', 1, 'U'],
    [4500, 'blocked', 0, 'U'],
    [9000, 'move', 0, 'R'],
    [9500, 'undo'],
    [10_000, 'move', 0, 'R'],
    [11_000, 'move', 0, 'R'],
  ], { optimal: 3, moves: 3, end: 12_000 });
  assert.deepEqual(a.events.map((e) => e.type), ['select', 'move', 'blocked', 'move', 'undo', 'move', 'move', 'solve']);
  assert.deepEqual(a.events[1], { t: 4000, type: 'move', p: 1, d: 'U' });
  const m = a.metrics;
  assert.equal(m.firstMoveMs, 4000, 'thinking time before the first move');
  assert.equal(m.longestPauseMs, 4500, 'blocked at 4.5 s to the move at 9 s');
  assert.equal(m.totalMs, 12_000);
  assert.equal(m.grossMoves, 4);
  assert.equal(m.moves, 3);
  assert.equal(m.wastedMoves, 1);
  assert.equal(m.undos, 1);
  assert.equal(m.blocked, 1);
  assert.equal(m.selects, 1);
  assert.equal(m.efficiency, 1);
  assert.equal(a.outcome, 'solved');
  assert.match(a.id, /^a[0-9a-z]+$/);
});

test('attempt log: end is final and idempotent; unknown outcome throws', () => {
  const c = clock();
  const log = createAttemptLog({ game: 'blockslide', set: 1, puzzleId: 'x', mode: 'exam', optimal: 4, now: c.now });
  assert.throws(() => log.end('won'), /unknown outcome/);
  c.at(2000);
  const a = log.end('skipped', { moves: 0 });
  assert.equal(log.move(0, 'R'), false, 'no events after the end');
  assert.equal(log.end('solved'), a, 'second end returns the same record');
  assert.equal(a.metrics.skipped, true);
  assert.equal(a.metrics.firstMoveMs, null);
  assert.equal(a.metrics.longestPauseMs, 2000, 'the whole wait counts as a pause');
  assert.equal(a.metrics.wastedMoves, null, 'no waste figure for an unsolved attempt');
  assert.equal(a.metrics.efficiency, 0);
});

test('metrics: empty log, and net moves recomputed through undo and reset', () => {
  const e = computeMetrics([]);
  assert.equal(e.totalMs, 0);
  assert.equal(e.firstMoveMs, null);
  assert.equal(e.longestPauseMs, 0);
  assert.equal(e.moves, 0);
  const evs = [
    { t: 1, type: 'move', p: 0, d: 'R' },
    { t: 2, type: 'move', p: 0, d: 'R' },
    { t: 3, type: 'reset' },
    { t: 4, type: 'undo' },
    { t: 5, type: 'move', p: 1, d: 'U' },
    { t: 9, type: 'timeout' },
  ];
  const m = computeMetrics(evs, { optimal: 2, outcome: 'timeout' });
  assert.equal(m.moves, 1, 'undo on an empty board does not go negative');
  assert.equal(m.grossMoves, 3);
  assert.equal(m.resets, 1);
  assert.equal(m.timedOut, true);
  assert.equal(m.longestPauseMs, 4);
});

test('recorder: saves, filters and survives a reload', () => {
  const mem = memory();
  const r = createRecorder(mem);
  const a1 = attempt([[1000, 'move', 0, 'R']], { outcome: 'solved', optimal: 1, moves: 1, set: 1 });
  const a2 = attempt([], { outcome: 'skipped', set: 2, puzzleId: 'bs2-01' });
  assert.ok(r.saveAttempt(a1));
  assert.ok(r.saveAttempt(a2));
  assert.equal(r.saveAttempt({ junk: true }), false, 'invalid records are refused');
  assert.ok(mem.m.has(RECORDER_KEY));
  const again = createRecorder(mem);
  assert.equal(again.attempts().length, 2);
  assert.equal(again.attempts({ set: 2 })[0].puzzleId, 'bs2-01');
  assert.deepEqual(again.attempts({ set: 1 })[0].metrics, a1.metrics);
  assert.equal(JSON.parse(mem.m.get(RECORDER_KEY)).v, RECORDER_VERSION);
  // Saving the same id again replaces it instead of duplicating.
  assert.ok(again.saveAttempt({ ...a1, hintsUsed: 2 }));
  assert.equal(again.attempts().length, 2);
  again.clear();
  assert.equal(createRecorder(mem).attempts().length, 0);
});

test('run summary: score and counts from the attempts', () => {
  const as = [
    attempt([[1000, 'move', 0, 'R'], [2000, 'move', 0, 'R']], { optimal: 2, moves: 2, runId: 'r1', mode: 'exam' }),
    attempt([[1000, 'move', 0, 'R'], [2000, 'move', 0, 'L'], [3000, 'move', 0, 'R'], [4000, 'move', 0, 'R']], { optimal: 2, moves: 4, runId: 'r1', mode: 'exam' }),
    attempt([], { outcome: 'skipped', optimal: 5, runId: 'r1', mode: 'exam' }),
    attempt([[500, 'move', 1, 'U']], { outcome: 'timeout', optimal: 5, moves: 1, runId: 'r1', mode: 'exam' }),
  ];
  const run = summarizeRun({ id: 'r1', game: 'blockslide', set: 1, seed: 7, startedAt: 0, endedAt: 360_000, budgetMs: 360_000, attempts: as });
  assert.equal(run.score, 1.5);
  assert.equal(run.attempted, 4);
  assert.equal(run.solved, 2);
  assert.equal(run.skipped, 1);
  assert.equal(run.timedOut, 1);
  assert.equal(run.durationMs, 360_000);
  assert.equal(run.puzzles[1].grossMoves, 4);
  assert.equal(run.puzzles[0].firstMoveMs, 1000);
  const mem = memory();
  const r = createRecorder(mem);
  assert.ok(r.saveRun(run));
  assert.equal(r.runs({ set: 1 })[0].score, 1.5);
  assert.equal(r.saveRun({ id: 'bad' }), false);
});

test('migration: unversioned data upgrades; bad records are dropped, not fatal', () => {
  const good = attempt([[1000, 'move', 0, 'R']], { optimal: 1, moves: 1 });
  const res = migrate({ attempts: [good, { id: 'x' }, null], runs: [{ id: 'nope' }] });
  assert.equal(res.ok, true);
  assert.equal(res.data.v, RECORDER_VERSION);
  assert.equal(res.data.attempts.length, 1);
  assert.equal(res.dropped, 3);
  assert.equal(migrate(null).ok, false);
  assert.equal(migrate([]).ok, false);
  assert.equal(migrate({ v: 'one' }).ok, false);
  assert.equal(migrate({ v: -1 }).ok, false);
  // Events with an unknown type make the record unusable.
  assert.equal(sanitizeAttempt({ ...good, events: [{ t: 1, type: 'teleport' }] }), null);
  // Metrics are recomputed from the log, so a tampered metric is corrected.
  assert.equal(sanitizeAttempt({ ...good, metrics: { ...good.metrics, grossMoves: 99 } }).metrics.grossMoves, 1);
  // A pruned record (no events) keeps its stored metrics.
  const pruned = sanitizeAttempt({ ...good, events: [], eventsPruned: true });
  assert.equal(pruned.metrics.grossMoves, 1);
  assert.equal(pruned.eventsPruned, true);
});

test('migration: newer archive is left untouched and the recorder goes read only', () => {
  const mem = memory();
  const future = JSON.stringify({ v: RECORDER_VERSION + 1, attempts: [{ anything: 1 }] });
  mem.setItem(RECORDER_KEY, future);
  const r = createRecorder(mem);
  assert.equal(r.attempts().length, 0);
  assert.equal(r.readOnly, true);
  assert.match(r.problem, /newer/);
  assert.equal(r.saveAttempt(attempt([], { outcome: 'skipped' })), false);
  r.clear();
  assert.equal(mem.m.get(RECORDER_KEY), future, 'never overwritten or cleared');
  assert.throws(() => r.importData({ v: 1, attempts: [], runs: [] }), /read only/);
});

test('corrupt JSON is kept aside and a fresh history starts', () => {
  const mem = memory();
  mem.setItem(RECORDER_KEY, '{oops');
  const r = createRecorder(mem);
  assert.equal(r.attempts().length, 0);
  assert.equal(mem.m.get(`${RECORDER_KEY}.corrupt`), '{oops');
  assert.match(r.problem, /could not be read/);
  assert.ok(r.saveAttempt(attempt([], { outcome: 'skipped' })));
});

test('limits: oldest records go first', () => {
  const mem = memory();
  const r = createRecorder(mem, { limits: { attempts: 3, runs: 2 } });
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const a = { ...attempt([], { outcome: 'skipped' }), id: `a${i}`, startedAt: 1000 + i };
    ids.push(a.id);
    r.saveAttempt(a);
  }
  assert.deepEqual(r.attempts().map((a) => a.id), ['a2', 'a3', 'a4']);
  const d = enforceLimits({ attempts: [{ startedAt: 2 }, { startedAt: 1 }], runs: [] }, { attempts: 1, runs: 1 });
  assert.deepEqual(d.attempts, [{ startedAt: 2 }]);
});

test('quota: old event logs are shed so a save still succeeds', () => {
  const m = new Map();
  let cap = Infinity;
  const tight = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      if (String(v).length > cap) throw new Error('QuotaExceededError');
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
  };
  const r = createRecorder(tight);
  const moves = Array.from({ length: 40 }, (_, i) => [100 * (i + 1), 'move', 0, i % 2 ? 'L' : 'R']);
  for (let i = 0; i < 6; i++) r.saveAttempt({ ...attempt(moves, { outcome: 'skipped' }), id: `q${i}`, startedAt: i });
  const full = m.get(RECORDER_KEY).length;
  cap = Math.floor(full * 0.75);
  assert.ok(r.saveAttempt({ ...attempt(moves, { outcome: 'skipped' }), id: 'q6', startedAt: 6 }), 'saved after pruning');
  const saved = r.attempts();
  assert.equal(saved.length, 7, 'no attempt lost, only old event logs');
  assert.ok(saved[0].eventsPruned);
  assert.equal(saved[0].metrics.grossMoves, 40, 'metrics survive pruning');
  assert.equal(saved.at(-1).events.length, 41);
});

test('export and import: merge keeps existing ids, replace swaps; backup files', () => {
  const a = attempt([[1000, 'move', 0, 'R']], { optimal: 1, moves: 1 });
  const b = attempt([], { outcome: 'skipped', puzzleId: 'bs1-02' });
  const src = createRecorder(memory());
  src.saveAttempt(a);
  src.saveAttempt(b);
  const exported = src.exportData();
  assert.equal(exported.attempts.length, 2);

  const dst = createRecorder(memory());
  dst.saveAttempt({ ...a, hintsUsed: 3 });
  const res = dst.importData(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual({ added: res.added, skipped: res.skipped }, { added: 1, skipped: 1 });
  assert.equal(dst.attempts().find((x) => x.id === a.id).hintsUsed, 3, 'existing record wins');
  const rep = dst.importData(exported, { mode: 'replace' });
  assert.equal(rep.added, 2);
  assert.equal(dst.attempts().find((x) => x.id === a.id).hintsUsed, 0);
  assert.throws(() => dst.importData({ v: 99 }), /newer/);

  const store = createStore(memoryStorage());
  store.recordRun('blockslide', 1, 6, 10);
  const backup = makeBackup({ recorder: exported, progress: store.get(), now: 0 });
  assert.equal(backup.kind, BACKUP_KIND);
  assert.equal(backup.exportedAt, '1970-01-01T00:00:00.000Z');
  const parsed = parseBackup(JSON.stringify(backup));
  assert.equal(parsed.recorder.attempts.length, 2);
  assert.equal(parsed.progress.games.blockslide[1].bestScore, 6);
  assert.equal(parseBackup(JSON.stringify(exported)).progress, null, 'a bare archive is accepted');
  assert.throws(() => parseBackup('not json'), /not valid JSON/);
  assert.throws(() => parseBackup('{"hello":1}'), /not a CogPrep backup/);
  assert.throws(() => parseBackup(JSON.stringify({ kind: BACKUP_KIND })), /no play history/);
  assert.throws(() => parseBackup('3'), /does not contain/);
});

test('store: merging progress from a backup keeps the better values', () => {
  const s = createStore(memoryStorage());
  s.recordRun('blockslide', 1, 5, 10);
  s.recordPractice('blockslide', 1, 'bs1-01', 0.5);
  const other = createStore(memoryStorage());
  other.recordRun('blockslide', 1, 8, 10);
  other.recordRun('blockslide', 2, 2, 10);
  other.recordPractice('blockslide', 1, 'bs1-01', 0.25);
  other.recordPractice('blockslide', 1, 'bs1-02', 1);
  s.mergeData(other.get());
  assert.equal(s.getSet('blockslide', 1).bestScore, 8);
  assert.equal(s.getSet('blockslide', 1).practice['bs1-01'], 0.5);
  assert.equal(s.getSet('blockslide', 1).practice['bs1-02'], 1);
  assert.equal(s.getSet('blockslide', 2).runs, 1);
  assert.throws(() => s.mergeData({ v: 2, games: {} }), /unknown format/);
});
