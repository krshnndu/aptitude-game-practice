import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hash32, rankedSeed, practiceSeed, freshRunSeed, seenId, createSeenList, pickPracticePuzzle, pickPracticePuzzleAsync,
  practiceOwner, SEEN_KEY, FRESH_OWNER,
} from '../js/core/fresh.js';
import { memoryStorage } from '../js/core/store.js';
import { createRecorder, createAttemptLog, summarizeRun, sanitizeAttempt, sanitizeRun } from '../js/core/recorder.js';
import { isRanked, isUploadable, finalizeRun } from '../js/core/partial.js';
import { itemExtra, rankField } from '../js/core/board.js';

test('seeds: ranked seed depends on game and set only; browser seeds depend on the browser id', () => {
  assert.equal(rankedSeed('blockslide', 3), rankedSeed('blockslide', 3));
  assert.notEqual(rankedSeed('blockslide', 3), rankedSeed('blockslide', 4));
  assert.notEqual(rankedSeed('blockslide', 3), rankedSeed('latinsquare', 3));
  assert.notEqual(practiceSeed('cid-a', 'blockslide', 1, 11), practiceSeed('cid-b', 'blockslide', 1, 11));
  assert.notEqual(practiceSeed('cid-a', 'blockslide', 1, 11), practiceSeed('cid-a', 'blockslide', 1, 12));
  assert.notEqual(practiceSeed('cid-a', 'blockslide', 1, 11, 0), practiceSeed('cid-a', 'blockslide', 1, 11, 1));
  assert.notEqual(freshRunSeed('cid-a', 'blockslide', 1, 0), freshRunSeed('cid-b', 'blockslide', 1, 0));
  assert.notEqual(freshRunSeed('cid-a', 'blockslide', 1, 0), freshRunSeed('cid-a', 'blockslide', 1, 1));
  for (const s of [rankedSeed('x', 1), practiceSeed('c', 'x', 1, 11), hash32('')]) assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
});

test('seen-list: add, has, owner exemption, persistence and run counter', () => {
  const storage = memoryStorage();
  const seen = createSeenList(storage);
  assert.equal(seen.has('blockslide', 'k1'), false);
  assert.equal(seen.add('blockslide', 'k1', practiceOwner(1, 11)), true);
  assert.equal(seen.add('blockslide', 'k1', 'other'), false, 'first owner kept');
  assert.equal(seen.has('blockslide', 'k1'), true);
  assert.equal(seen.has('latinsquare', 'k1'), false, 'keys are per game');
  // The slot that showed it may show it again (a reload); any other slot skips it.
  assert.equal(seen.has('blockslide', 'k1', practiceOwner(1, 11)), false);
  assert.equal(seen.has('blockslide', 'k1', practiceOwner(1, 12)), true);
  assert.equal(seen.nextRun('blockslide', 1), 0);
  assert.equal(seen.nextRun('blockslide', 1), 1);
  assert.equal(seen.nextRun('blockslide', 2), 0);
  seen.noteSlot('blockslide', 1, 14);
  seen.noteSlot('blockslide', 1, 12);
  const again = createSeenList(storage);
  assert.equal(again.has('blockslide', 'k1'), true);
  assert.equal(again.ownerOf('blockslide', 'k1'), practiceOwner(1, 11));
  assert.equal(again.nextRun('blockslide', 1), 2);
  assert.equal(again.lastSlot('blockslide', 1), 14);
  // Stored keys are short hashes, not puzzle content.
  const raw = JSON.parse(storage.getItem(SEEN_KEY));
  assert.deepEqual(raw.keys[0], [seenId('blockslide', 'k1'), 'p1.11']);
});

test('seen-list: capped, oldest first out, and tolerant of broken storage', () => {
  const storage = memoryStorage();
  const seen = createSeenList(storage, { cap: 5 });
  for (let i = 0; i < 8; i++) seen.add('g', `k${i}`, FRESH_OWNER);
  assert.equal(seen.size, 5);
  assert.equal(seen.has('g', 'k0'), false);
  assert.equal(seen.has('g', 'k2'), false);
  assert.equal(seen.has('g', 'k3'), true);
  assert.equal(seen.has('g', 'k7'), true);
  assert.equal(createSeenList(storage, { cap: 5 }).size, 5);

  storage.setItem(SEEN_KEY, '{not json');
  const broken = createSeenList(storage);
  assert.equal(broken.size, 0);
  broken.add('g', 'x');
  assert.equal(broken.has('g', 'x'), true);
  const noStorage = createSeenList(null);
  noStorage.add('g', 'x');
  assert.equal(noStorage.has('g', 'x'), true);
  const throwing = createSeenList({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } });
  throwing.add('g', 'y');
  assert.equal(throwing.has('g', 'y'), true);
});

test('practice slot: skips shipped and seen keys, keeps its own puzzle on reload', () => {
  // A fake generator: the key is seed mod 5, so collisions are frequent.
  const make = (seed) => ({ id: `g${seed}`, key: `k${seed % 5}` });
  const keyOf = (p) => p.key;
  const seen = createSeenList(memoryStorage());
  const args = { game: 'g', set: 1, cid: 'c', make, keyOf, seen };
  const first = pickPracticePuzzle({ ...args, k: 11 });
  assert.ok(first);
  seen.add('g', first.key, practiceOwner(1, 11));
  // Reload of slot 11: the same puzzle.
  assert.equal(pickPracticePuzzle({ ...args, k: 11 }).id, first.id);
  // Slot 12 never repeats slot 11, nor a shipped key.
  const shipped = new Set(['k0', 'k1']);
  const second = pickPracticePuzzle({ ...args, k: 12, shipped });
  assert.ok(second);
  assert.notEqual(second.key, first.key);
  assert.ok(!shipped.has(second.key));
  // Every key used: nothing new can be built, the caller falls back.
  for (let i = 0; i < 5; i++) seen.add('g', `k${i}`, FRESH_OWNER);
  assert.equal(pickPracticePuzzle({ ...args, k: 13 }), null);
  // Generators that throw or return null are skipped.
  let calls = 0;
  const flaky = (seed) => {
    calls++;
    if (calls < 3) throw new Error('no');
    return { id: `f${seed}`, key: `fresh${seed}` };
  };
  assert.ok(pickPracticePuzzle({ ...args, k: 14, make: flaky }));
});

test('practice slot (async): same choice as the sync picker', async () => {
  const make = (seed) => ({ id: `g${seed}`, key: `k${seed % 7}` });
  const seen = createSeenList(memoryStorage());
  seen.add('g', 'k3', FRESH_OWNER);
  const a = pickPracticePuzzle({ game: 'g', set: 2, k: 15, cid: 'c', make, keyOf: (p) => p.key, seen });
  const b = await pickPracticePuzzleAsync({ game: 'g', set: 2, k: 15, cid: 'c', make: async (s) => make(s), keyOf: (p) => p.key, seen });
  assert.equal(a.id, b.id);
});

// ---------------------------------------------------------------- rank field and upload

function run(rank, exit = 'time') {
  const log = createAttemptLog({ game: 'blockslide', set: 1, puzzleId: 'bs1-01', mode: 'exam', runId: 'r1', optimal: 3, rank, now: () => 1000 });
  log.move(0, 'R');
  const a = log.end('solved', { moves: 3 });
  return finalizeRun(summarizeRun({ id: `r${rank}${exit}`, game: 'blockslide', set: 1, seed: 7, startedAt: 0, endedAt: 360000, budgetMs: 360000, attempts: [a], rank }), exit);
}

test('rank: attempts and runs carry it, sanitizers keep it, telemetry sends it', () => {
  const ranked = run(1);
  const fresh = run(0);
  assert.equal(ranked.rank, 1);
  assert.equal(fresh.rank, 0);
  assert.equal(sanitizeRun(fresh).rank, 0);
  const log = createAttemptLog({ game: 'blockslide', set: 1, puzzleId: 'p', mode: 'exam', optimal: 1, rank: 0 });
  const a = log.end('skipped', { moves: 0 });
  assert.equal(a.rank, 0);
  assert.equal(sanitizeAttempt(a).rank, 0);
  assert.equal(itemExtra(a, 'r1', 1).rank, 0);
  assert.deepEqual(rankField({}), {});
  const practice = createAttemptLog({ game: 'blockslide', set: 1, puzzleId: 'p', mode: 'practice', optimal: 1 }).end('skipped', { moves: 0 });
  assert.equal('rank' in practice, false);
  assert.equal('rank' in itemExtra(practice, 'x', 1), false);
});

test('upload gate: only complete ranked runs; fresh timed practice is never uploaded', () => {
  assert.equal(isRanked(run(1)), true);
  assert.equal(isRanked(run(0)), false);
  assert.equal(isRanked({ id: 'old' }), true, 'runs from before the rank field were ranked');
  assert.equal(isUploadable(run(1)), true);
  assert.equal(isUploadable(run(0)), false);
  assert.equal(isUploadable(run(1, 'early')), false);
  assert.equal(isUploadable(run(0, 'early')), false);
});

test('fresh timed run: saved locally but never queued or posted to /submit', async () => {
  const mem = memoryStorage();
  const posts = [];
  const saved = { localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  globalThis.localStorage = mem;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).endsWith('/submit')) posts.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ url: 'https://board.test' }) };
  };
  try {
    const { startBoard } = await import('../js/core/board.js');
    startBoard();
    const rec = createRecorder(memoryStorage());
    rec.saveRun(run(0));
    rec.saveRun(run(1, 'early'));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(posts.length, 0, 'nothing uploaded for fresh or ended-early runs');
    assert.deepEqual(JSON.parse(mem.getItem('cogprep.queue.v1') || '[]'), []);
    assert.equal(rec.runs().length, 2, 'both runs are kept locally');
    rec.saveRun(run(1));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(posts.length, 1, 'the ranked run is uploaded');
    assert.equal(posts[0].game, 'blockslide');
    assert.equal(posts[0].score, 1);
  } finally {
    globalThis.localStorage = saved.localStorage;
    globalThis.fetch = saved.fetch;
  }
});
