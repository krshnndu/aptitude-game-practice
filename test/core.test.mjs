import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, createRng } from '../js/core/rng.js';
import { Countdown, formatClock } from '../js/core/timer.js';
import { efficiency, runScore, averageEfficiency, pct, movesSummary, UNLOCK_THRESHOLD } from '../js/core/score.js';
import { createStore, STORE_KEY } from '../js/core/store.js';

function memory() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test('rng: mulberry32 is deterministic and in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
  const r = createRng(9);
  for (let i = 0; i < 200; i++) {
    const v = r.int(2, 4);
    assert.ok(v >= 2 && v <= 4 && Number.isInteger(v));
  }
  assert.deepEqual(createRng(3).shuffle([1, 2, 3, 4, 5]).sort(), [1, 2, 3, 4, 5]);
});

test('score: efficiency and run score', () => {
  assert.equal(efficiency(6, 9), 6 / 9);
  assert.equal(efficiency(6, 6), 1);
  assert.equal(efficiency(6, 4), 1, 'capped at 1');
  assert.equal(efficiency(6, 9, false), 0, 'skipped scores 0');
  assert.equal(efficiency(6, 0), 0);
  const results = [
    { optimal: 4, moves: 4, solved: true },
    { optimal: 6, moves: 12, solved: true },
    { optimal: 5, moves: 3, solved: false },
  ];
  assert.equal(runScore(results), 1.5);
  assert.equal(averageEfficiency(1.5, 10), 0.15);
  assert.equal(pct(2 / 3), '67%');
  assert.equal(movesSummary(9, 6), 'you used 9, optimal 6, efficiency 67%');
  assert.equal(UNLOCK_THRESHOLD, 0.7);
});

test('timer: countdown with a fake clock', () => {
  let now = 0;
  let ended = 0;
  const ticks = [];
  const t = new Countdown(6 * 60 * 1000, { now: () => now, tickMs: 0, onTick: (l) => ticks.push(l), onEnd: () => ended++ });
  assert.equal(formatClock(t.remaining()), '6:00');
  t.start();
  now = 61_000;
  assert.equal(formatClock(t.remaining()), '4:59');
  t.pause();
  now = 200_000;
  assert.equal(t.remaining(), 299_000, 'paused time does not count');
  t.start();
  now = 200_000 + 299_000;
  t.tick();
  assert.equal(ended, 1);
  assert.equal(t.remaining(), 0);
  t.tick();
  assert.equal(ended, 1, 'onEnd fires once');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(9_001), '0:10');
});

test('store: versioned key, best score, unlock rules', () => {
  const mem = memory();
  const s = createStore(mem);
  assert.equal(s.isUnlocked('blockslide', 1, 10), true);
  assert.equal(s.isUnlocked('blockslide', 2, 10), false);

  s.recordRun('blockslide', 1, 6.5, 10);
  assert.equal(s.isUnlocked('blockslide', 2, 10), false, '65% is not enough');
  const r = s.recordRun('blockslide', 1, 7.2, 10);
  assert.equal(r.improved, true);
  assert.equal(s.getSet('blockslide', 1).bestScore, 7.2);
  assert.equal(s.isUnlocked('blockslide', 2, 10), true, '72% unlocks set 2');
  assert.equal(s.recordRun('blockslide', 1, 3, 10).improved, false);
  assert.equal(s.getSet('blockslide', 1).bestScore, 7.2, 'best is kept');
  assert.equal(s.getSet('blockslide', 1).runs, 3);

  // Practice bests across all puzzles also unlock.
  for (let k = 1; k <= 10; k++) s.recordPractice('blockslide', 2, `bs2-${k}`, 0.8);
  s.recordPractice('blockslide', 2, 'bs2-1', 0.1);
  assert.equal(s.getSet('blockslide', 2).practice['bs2-1'], 0.8, 'practice keeps the best');
  assert.equal(s.isUnlocked('blockslide', 3, 10), true);
  assert.equal(s.isUnlocked('blockslide', 4, 10), false);

  s.setUnlockAll(true);
  assert.equal(s.isUnlocked('blockslide', 5, 10), true);

  assert.ok(mem.m.has(STORE_KEY));
  assert.match(STORE_KEY, /v1$/);
  // A different version is ignored rather than misread.
  mem.setItem(STORE_KEY, JSON.stringify({ v: 999, games: { blockslide: { 1: { bestScore: 10 } } } }));
  assert.equal(createStore(mem).getSet('blockslide', 1).bestScore, 0);
  mem.setItem(STORE_KEY, '{not json');
  assert.equal(createStore(mem).unlockAll(), false);
  s.reset();
  assert.equal(mem.m.has(STORE_KEY), false);
});
