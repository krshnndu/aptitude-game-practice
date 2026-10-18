// Ended-early runs: status flags, recorder round trip, not attempted remainder, takeaways, resume slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeRun, isPartial, isLeave, notAttempted, partialStats, takeaways, createResumeStore, sanitizeResume, resumeActions, RESUME_KEY, RESUME_MAX_AGE } from '../js/core/partial.js';
import { createRecorder, sanitizeRun, summarizeRun, createAttemptLog, onRunSaved } from '../js/core/recorder.js';
import { memoryStorage } from '../js/core/store.js';
import { STRATEGY_SHEET } from '../js/games/blockslide/strategy.js';

function attempt({ id = 'bs1-01', outcome = 'solved', ms = 10_000, moves = 3, optimal = 3, runId = 'r1', dvs = null } = {}) {
  let t = 1000;
  const log = createAttemptLog({ game: 'blockslide', set: 1, puzzleId: id, mode: 'exam', runId, optimal, now: () => t });
  for (let i = 0; i < moves; i++) {
    t += ms / Math.max(1, moves);
    log.move(0, 'U');
  }
  const a = log.end(outcome, { moves });
  if (dvs) a.dvs = dvs;
  return a;
}

const run = (attempts, extra = {}) => ({ ...summarizeRun({ id: 'r1', game: 'blockslide', set: 1, seed: 7, startedAt: 0, endedAt: 90_000, budgetMs: 360_000, attempts }), ...extra });

test('finalizeRun: time is complete, every other exit is partial', () => {
  const r = run([attempt()]);
  assert.equal(finalizeRun(r, 'time').status, 'complete');
  assert.equal(isPartial(finalizeRun(r, 'time')), false);
  for (const exit of ['early', 'nav', 'unload', 'hidden']) {
    const p = finalizeRun(r, exit);
    assert.equal(p.status, 'partial');
    assert.equal(p.partial, true);
    assert.equal(p.exit, exit);
    assert.ok(isPartial(p));
  }
  assert.equal(finalizeRun(r, 'weird').exit, 'early');
  // A complete stamp clears stale partial flags.
  const back = finalizeRun(finalizeRun(r, 'early'), 'time');
  assert.equal(back.partial, undefined);
  assert.equal(back.exit, undefined);
  assert.ok(isLeave('nav') && isLeave('unload') && isLeave('hidden') && !isLeave('early') && !isLeave('time'));
});

test('recorder keeps the partial flag, drops junk, and a silent save skips listeners', () => {
  const rec = createRecorder(memoryStorage());
  const r = finalizeRun(run([attempt(), attempt({ id: 'bs1-02', outcome: 'skipped', moves: 1 })]), 'early');
  let heard = 0;
  onRunSaved((x) => { if (x.id === 'r1') heard++; });
  assert.ok(rec.saveRun(r, { silent: true }));
  assert.equal(heard, 0);
  assert.ok(rec.saveRun(r));
  assert.equal(heard, 1);
  const saved = rec.runs({ id: 'r1' });
  assert.equal(saved.length, 1, 'upsert by id: a checkpoint is replaced by the final save');
  assert.equal(saved[0].status, 'partial');
  assert.equal(saved[0].exit, 'early');
  assert.equal(saved[0].attempted, 2);
  const junk = sanitizeRun({ ...r, status: 'bogus', partial: 'yes', exit: 'x<script>' });
  assert.equal(junk.status, undefined);
  assert.equal(junk.partial, undefined);
  const odd = sanitizeRun({ ...r, exit: 'NOT valid!' });
  assert.equal(odd.status, 'partial');
  assert.equal(odd.exit, undefined);
});

test('partialStats: score so far, items seen, elapsed', () => {
  const s = partialStats(finalizeRun(run([attempt(), attempt({ id: 'bs1-02', outcome: 'skipped', moves: 1 })]), 'early'));
  assert.equal(s.attempted, 2);
  assert.equal(s.solved, 1);
  assert.equal(s.score, 1);
  assert.equal(s.elapsedMs, 90_000);
  assert.deepEqual(partialStats(null), { score: 0, attempted: 0, solved: 0, elapsedMs: 0 });
});

test('notAttempted: pool order, variants count as their base', () => {
  const pool = ['ls1-01', 'ls1-02', 'ls1-03', 'ls1-04'].map((id) => ({ id }));
  assert.deepEqual(notAttempted(pool, ['ls1-03', 'ls1-01~v2', 'ls1-g9x']).map((p) => p.id), ['ls1-02', 'ls1-04']);
  assert.deepEqual(notAttempted(pool, []).length, 4);
  assert.deepEqual(notAttempted(null, ['x']), []);
});

test('takeaways: time sink, repeated pattern mapped to the strategy sheet, tip', () => {
  const as = [attempt({ ms: 5000 }), attempt({ id: 'bs1-02', ms: 30_000, outcome: 'skipped', moves: 2 }), attempt({ id: 'bs1-03', ms: 5000 })];
  const t = takeaways({ attempts: as, habits: [{ id: 'oscillation', label: 'Back and forth', count: 2, of: 3 }], sheet: STRATEGY_SHEET });
  assert.equal(t.length, 3);
  assert.deepEqual(t.map((x) => x.kind), ['time', 'pattern', 'tip']);
  assert.match(t[0].text, /Puzzle 2 took 30 s, 75% of your time, and you skipped it/);
  assert.match(t[1].text, /Back and forth in 2 of 3 puzzles/);
  assert.equal(t[2].text, STRATEGY_SHEET.traps.find((x) => x.tag === 'oscillation').text);
  for (const x of t) assert.doesNotMatch(x.text, /[\u2010-\u2015]/, 'no Unicode dashes');
});

test('takeaways: tag lists, divergence fallback, and sparse runs', () => {
  const as = [attempt({ dvs: { ans: 'a', opt: 'b', div: 0, lat: 1 } }), attempt({ id: 'bs1-02', dvs: { ans: 'a', opt: 'b', div: 1, lat: 1 } })];
  const byTag = takeaways({ attempts: as, tagLists: [['wasted'], ['wasted', 'undo']], sheet: STRATEGY_SHEET, tagLabel: (x) => `[${x}]` });
  assert.match(byTag[1].text, /\[wasted\] in 2 of 2/);
  assert.equal(byTag[2].text, STRATEGY_SHEET.traps.find((x) => x.tag === 'wasted').text);
  const byDiv = takeaways({ attempts: as, sheet: STRATEGY_SHEET, seed: 1 });
  assert.match(byDiv[1].text, /left the best line in 2 of 2 puzzles, usually in the first two steps/);
  assert.equal(byDiv[2].text, STRATEGY_SHEET.heuristics[1]);
  const one = takeaways({ attempts: [as[0]], label: 'trial' });
  assert.match(one[0].text, /one trial/);
  assert.match(one[1].text, /No mistake repeated/);
  assert.match(one[2].text, /strategy sheet/);
  assert.match(takeaways({ attempts: [] })[0].text, /no timing/);
});

test('resume slot: save, read, expiry, game scoped clear and actions', () => {
  const storage = memoryStorage();
  const rs = createResumeStore(storage);
  const now = 10 * RESUME_MAX_AGE;
  assert.equal(rs.last(now), null);
  assert.ok(rs.save({ game: 'blockslide', kind: 'practice', set: 2, k: 4 }, now));
  assert.deepEqual(rs.last(now), { game: 'blockslide', kind: 'practice', set: 2, k: 4, at: now });
  assert.equal(rs.last(now + RESUME_MAX_AGE + 1), null, 'expires after a week');
  rs.clear('latinsquare', null, now);
  assert.ok(rs.last(now), 'another game does not clear the slot');
  rs.clear('blockslide', 'run', now);
  assert.ok(rs.last(now), 'another kind does not clear the slot');
  rs.clear('blockslide', 'practice', now);
  assert.equal(storage.getItem(RESUME_KEY), null);
  assert.equal(rs.save({ game: 'blockslide', kind: 'run', set: 1, runId: 'bad id!' }, now), null);
  rs.save({ game: 'gridmemory', kind: 'run', set: 3, runId: 'rabc123', attempted: 4, solved: 2, score: 1.5 }, now);
  const act = resumeActions(rs.last(now));
  assert.equal(act.resumeHref, null, 'timed tests are review only');
  assert.equal(act.reviewHref, '#/review/gridmemory/run/rabc123');
  assert.match(act.text, /4 seen, 2 solved, score so far 1.50/);
  const p = resumeActions({ game: 'blockslide', kind: 'practice', set: 2, k: 4, at: now });
  assert.equal(p.resumeHref, '#/blockslide/practice/2/4');
  assert.equal(p.reviewHref, '#/review/blockslide/practice/2');
  assert.equal(resumeActions(null), null);
  assert.equal(sanitizeResume({ game: 'Bad', kind: 'run', set: 1, runId: 'r', at: now }, now), null);
  storage.setItem(RESUME_KEY, '{not json');
  assert.equal(rs.last(now), null);
});
