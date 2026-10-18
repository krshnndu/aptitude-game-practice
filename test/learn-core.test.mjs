// Learning layer, pure modules: SM-2 lite schedule and caps, skill score and badge, learn data
// migration and backup versions, notebook rules, achievement rules, report data and snapshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTERVALS, DAY_MS, grade, newSchedule, schedule, isMastered, dueItems, mixedQueue, enforceItemCaps, endOfDay, CAPS } from '../js/core/srs.js';
import { gameSkill, tierFor, skillSummary, consistency, trend, MIN_N } from '../js/core/skill.js';
import { migrateLearn, createLearnStore, mergeLearn, emptyLearn, LEARN_KEY, sanitizeItem } from '../js/core/learn-store.js';
import { makeBackup, parseBackup, BACKUP_VERSION, BACKUP_KIND, memoryStorage } from '../js/core/recorder.js';
import { qualifies, makeItem, applyReview, syncItems, filterItems, attemptFromItem } from '../js/core/notebook.js';
import { computeAchievements, ACHIEVEMENTS, fluent, habitBroken, calibrated, fastLane, spacer, comeback, patternSpotter, mergeUnlocked } from '../js/core/achievements.js';
import { buildReport, tagWeeks, paceBuckets, weakPatterns } from '../js/core/report-data.js';
import { makeSnapshot, weeklyDue, diffSnapshots } from '../js/core/snapshots.js';
import { exportHtml } from '../js/core/report-export.js';
import * as bs from '../js/games/blockslide/review.js';

const T0 = new Date(2026, 8, 1, 10).getTime();
let seq = 0;
// Attempt factory: solved by default, efficiency 1, 20 s.
function att(over = {}) {
  seq++;
  const { eff = 1, ms = 20000, at = T0 + seq * 60000, game = 'blockslide', outcome = 'solved', ...rest } = over;
  return { id: `a${String(seq).padStart(5, '0')}`, game, set: 1, puzzleId: `bs1-0${seq % 9 + 1}`, mode: 'practice', source: 'pool', startedAt: at, optimal: 4, outcome, moves: 4, hintsUsed: 0, events: [], metrics: { efficiency: outcome === 'solved' ? eff : 0, totalMs: ms, firstMoveMs: 3000, moves: 4, grossMoves: 4 }, ...rest };
}
const days = (k) => k * DAY_MS;

// ---------------------------------------------------------------- SM-2 lite

test('srs: pass climbs the 1-3-7-14-30 ladder, inefficient repeats, fail resets to 1', () => {
  assert.deepEqual(INTERVALS, [1, 3, 7, 14, 30]);
  assert.equal(grade({ solved: true, efficiency: 1 }), 'pass');
  assert.equal(grade({ solved: true, efficiency: 0.6 }), 'inefficient');
  assert.equal(grade({ solved: false, efficiency: 0 }), 'fail');
  let it = { ...newSchedule(T0), createdAt: T0 };
  assert.equal(it.interval, 1);
  assert.equal(it.dueAt, T0 + days(1));
  const seen = [];
  for (let k = 0; k < 6; k++) {
    it = { ...it, ...schedule(it, 'pass', T0 + days(k)) };
    seen.push(it.interval);
  }
  assert.deepEqual(seen, [3, 7, 14, 30, 30, 30], 'caps at 30');
  const same = schedule({ ...it, interval: 7 }, 'inefficient', T0);
  assert.equal(same.interval, 7);
  assert.equal(same.dueAt, T0 + days(7));
  const reset = schedule({ ...it, interval: 14 }, 'fail', T0);
  assert.equal(reset.interval, 1);
  assert.ok(reset.ease < it.ease);
});

test('srs: mastered = 3 correct in a row at 14+ day intervals', () => {
  const h = (results, interval) => results.map((result, i) => ({ t: i, result, interval }));
  assert.equal(isMastered({ history: h(['pass', 'pass', 'inefficient'], 14) }), true);
  assert.equal(isMastered({ history: h(['pass', 'pass', 'pass'], 7) }), false);
  assert.equal(isMastered({ history: [...h(['pass', 'pass'], 14), { t: 9, result: 'fail', interval: 30 }] }), false);
});

test('srs: daily mixed queue interleaves games, oldest due first, capped at 20', () => {
  const items = [];
  for (let i = 0; i < 15; i++) items.push({ id: `b${i}`, game: 'blockslide', dueAt: T0 - days(10) + i, createdAt: 0 });
  for (let i = 0; i < 15; i++) items.push({ id: `l${i}`, game: 'latinsquare', dueAt: T0 - days(5) + i, createdAt: 0 });
  items.push({ id: 'future', game: 'gridmemory', dueAt: endOfDay(T0) + 1, createdAt: 0 });
  const q = mixedQueue(items, T0);
  assert.equal(q.length, 20);
  assert.deepEqual(q.slice(0, 4).map((i) => i.id), ['b0', 'l0', 'b1', 'l1']);
  assert.ok(!q.some((i) => i.id === 'future'));
  assert.equal(dueItems(items, T0, 'latinsquare').length, 15);
});

test('srs: caps keep 100 per game and 600 in total, evicting mastered first, then oldest', () => {
  const mastered = { history: [1, 2, 3].map((t) => ({ t, result: 'pass', interval: 14 })) };
  const items = [];
  for (let i = 0; i < 105; i++) items.push({ id: `x${i}`, game: 'blockslide', createdAt: i, dueAt: 0, ...(i === 50 ? mastered : {}) });
  const out = enforceItemCaps(items);
  assert.equal(out.length, CAPS.perGame);
  assert.ok(!out.some((i) => i.id === 'x50'), 'mastered evicted first');
  assert.ok(!out.some((i) => i.id === 'x0'), 'then the oldest');
  const many = [];
  for (const g of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) for (let i = 0; i < 100; i++) many.push({ id: `${g}${i}`, game: g, createdAt: i, dueAt: 0 });
  assert.equal(enforceItemCaps(many).length, CAPS.total);
});

// ---------------------------------------------------------------- skill score

test('skill: GSS formula over the last 30, consistency from the CV of solve times', () => {
  const list = Array.from({ length: 30 }, () => att({ eff: 1, ms: 20000 }));
  const s = gameSkill(list, { now: T0 + days(1) });
  assert.equal(s.accuracy, 1);
  assert.equal(s.efficiency, 1);
  assert.equal(s.consistency, 1, 'identical times: CV 0');
  assert.equal(s.score, 100);
  const mixed = Array.from({ length: 40 }, (_, i) => att({ outcome: i % 2 ? 'solved' : 'skipped', eff: 0.8, ms: i % 4 === 1 ? 10000 : 30000 }));
  const m = gameSkill(mixed, { now: T0 + days(2) });
  assert.equal(m.n, 30);
  assert.equal(m.accuracy, 0.5);
  const expected = 100 * (0.5 * 0.5 + 0.3 * m.efficiency + 0.2 * m.consistency);
  assert.ok(Math.abs(m.score - Math.round(expected * 10) / 10) < 1e-9);
  assert.equal(consistency([10]), 0, 'needs 2 times');
  assert.equal(consistency([10, 30, 1000]) >= 0, true, 'clamped');
});

test('skill: tiers, Master needs every game at 70, untouched games count 0', () => {
  assert.equal(tierFor(10), 'Novice');
  assert.equal(tierFor(30), 'Apprentice');
  assert.equal(tierFor(69.9), 'Practitioner');
  assert.equal(tierFor(84), 'Adept');
  assert.equal(tierFor(90, [90, 90, 90, 90, 90, 69]), 'Adept');
  assert.equal(tierFor(90, [90, 90, 90, 90, 90, 90]), 'Master');
  const games = ['blockslide', 'latinsquare'];
  const sum = skillSummary(games, { blockslide: Array.from({ length: 10 }, () => att()) }, { now: T0 + days(1) });
  assert.equal(sum.cards[1].n, 0);
  assert.equal(sum.overall, 50, 'mean of 100 and 0');
});

test('skill: 14-day delta and trends are suppressed under n=5, stale after 14 days', () => {
  const base = T0;
  const early = Array.from({ length: 4 }, (_, i) => att({ at: base + i * 1000 }));
  const sum = skillSummary(['blockslide'], { blockslide: early }, { now: base + days(20) });
  assert.equal(sum.cards[0].delta, null);
  assert.equal(sum.cards[0].stale, true);
  const lots = [...Array.from({ length: 10 }, (_, i) => att({ at: base + i * 1000, outcome: 'skipped' })), ...Array.from({ length: 10 }, (_, i) => att({ at: base + days(15) + i * 1000 }))];
  const s2 = skillSummary(['blockslide'], { blockslide: lots }, { now: base + days(15) + 20000 });
  assert.ok(s2.cards[0].delta > 0);
  assert.equal(trend(lots.slice(0, 3), 7, { now: base + days(1) }).delta, null);
  assert.equal(MIN_N, 5);
});

// ---------------------------------------------------------------- migration and backups

test('learn store: migrates unversioned data, refuses newer versions, sanitises and caps', () => {
  assert.deepEqual(migrateLearn(null).data, emptyLearn());
  const v0 = { items: [{ id: 'a1', game: 'blockslide', puzzleId: 'bs1-01', createdAt: 1, dueAt: 2, note: 'x'.repeat(500) }, { junk: true }], events: [{ t: 1, type: 'review' }, { t: 2, type: 'nope' }] };
  const res = migrateLearn(v0);
  assert.equal(res.ok, true);
  assert.equal(res.data.v, 1);
  assert.equal(res.data.items.length, 1);
  assert.equal(res.data.items[0].note.length, CAPS.note);
  assert.equal(res.data.events.length, 1);
  const newer = migrateLearn({ v: 99 });
  assert.equal(newer.ok, false);
  assert.equal(newer.newer, true);
  assert.equal(sanitizeItem({ id: 1 }), null);
});

test('learn store: persists items, notes, events, tags and snapshots; quota sheds blobs', () => {
  const storage = memoryStorage();
  const s = createLearnStore(storage);
  const it = makeItem(att({ outcome: 'skipped' }), { ref: { pid: 'bs1-01', set: 1, blob: 'x'.repeat(100) }, now: T0 });
  assert.ok(s.upsertItem(it));
  s.setNote(it.id, 'y'.repeat(300));
  assert.equal(s.item(it.id).note.length, 200);
  s.addEvent({ t: 1, type: 'explain_viewed', game: 'blockslide' });
  s.setTags('a1', ['wasted', 'wasted', 'undo']);
  s.addSnapshot({ id: 's1', game: 'blockslide', at: 5, kind: 'manual' });
  for (let i = 0; i < 30; i++) s.addSnapshot({ id: `w${i}`, game: 'blockslide', at: 10 + i, kind: 'weekly' });
  const d = s.load();
  assert.deepEqual(d.tags.a1, ['wasted', 'undo']);
  assert.equal(d.snapshots.blockslide.length, 26);
  assert.ok(JSON.parse(storage.getItem(LEARN_KEY)).v === 1);
  // A storage that refuses large writes: the store drops blobs to fit.
  let limit = Infinity;
  const tight = { ...memoryStorage(), setItem(k, v) { if (String(v).length > limit) throw new Error('quota'); storage.setItem(k, v); }, getItem: (k) => storage.getItem(k), removeItem: (k) => storage.removeItem(k) };
  const s2 = createLearnStore(tight);
  limit = JSON.stringify(s2.load()).length - 50;
  assert.ok(s2.save(s2.load()));
  assert.equal(s2.load().items[0].ref.blob, undefined);
});

test('learn store: merge on import keeps existing records and adds new ones', () => {
  const a = migrateLearn({ v: 1, items: [{ id: 'i1', game: 'blockslide', puzzleId: 'p', createdAt: 1, dueAt: 2, note: '' }] }).data;
  const b = migrateLearn({ v: 1, items: [{ id: 'i1', game: 'blockslide', puzzleId: 'p', createdAt: 1, dueAt: 9, note: 'mine' }, { id: 'i2', game: 'blockslide', puzzleId: 'q', createdAt: 1, dueAt: 2 }], unlocked: { 'week-one': 5 } }).data;
  const { data, added } = mergeLearn(a, b);
  assert.equal(added, 1);
  assert.equal(data.items.find((i) => i.id === 'i1').dueAt, 2, 'existing schedule wins');
  assert.equal(data.items.find((i) => i.id === 'i1').note, 'mine', 'a note only in the import is kept');
  assert.equal(data.unlocked['week-one'], 5);
});

test('backup: version 2 carries learn data; version 1 files migrate with learn = null', () => {
  assert.equal(BACKUP_VERSION, 2);
  const learn = { v: 1, items: [], snapshots: {}, events: [], tags: {}, unlocked: {} };
  const b = makeBackup({ recorder: { v: 1, attempts: [], runs: [] }, progress: null, learn, now: 0 });
  assert.equal(b.v, 2);
  assert.deepEqual(parseBackup(JSON.stringify(b)).learn, learn);
  const old = { kind: BACKUP_KIND, v: 1, exportedAt: 'x', recorder: { v: 1, attempts: [], runs: [] }, progress: null };
  const p = parseBackup(JSON.stringify(old));
  assert.equal(p.learn, null);
  assert.deepEqual(p.recorder, old.recorder);
  assert.throws(() => parseBackup(JSON.stringify({ ...old, v: 3 })), /newer/);
});

// ---------------------------------------------------------------- notebook

test('notebook: auto-add on fail or efficiency under 0.7; review grades reschedule the item', () => {
  assert.equal(qualifies(att({ outcome: 'skipped' })), true);
  assert.equal(qualifies(att({ eff: 0.6 })), true);
  assert.equal(qualifies(att({ eff: 0.7 })), false);
  assert.equal(qualifies(att({ outcome: 'timeout' })), false, 'clock cut-offs are not mistakes');
  assert.equal(qualifies(att({ outcome: 'skipped', source: 'review' })), false, 'retries update their item instead');
  const a = att({ outcome: 'skipped', events: Array.from({ length: 300 }, (_, t) => ({ t, type: 'move', p: 0, d: 'U' })) });
  const it = makeItem(a, { ref: bs.refFor(a), now: T0 });
  assert.equal(it.path.length, 200, 'user path capped');
  assert.equal(it.dueAt, T0 + days(1));
  const { item, result } = applyReview(it, att({ eff: 1 }), { revealed: false, now: T0 + days(1) });
  assert.equal(result, 'pass');
  assert.equal(item.interval, 3);
  assert.equal(item.history[0].retryFirst, true);
  const fake = attemptFromItem(it);
  assert.equal(fake.events.length, 200);
  assert.equal(fake.metrics.efficiency, 0);
});

test('notebook: catch-up sync adds qualifying attempts since the last sync, once', () => {
  const list = [att({ outcome: 'skipped', at: T0 + 1000 }), att({ eff: 1, at: T0 + 2000 }), att({ eff: 0.5, at: T0 + 3000 })];
  const fresh = syncItems(list, [], { lastSync: T0, now: T0 + 5000 });
  assert.equal(fresh.length, 2);
  assert.equal(syncItems(list, fresh, { lastSync: T0, now: T0 + 5000 }).length, 0);
  assert.equal(syncItems(list, [], { lastSync: T0 + 2500, now: T0 + 5000 }).length, 1);
  assert.equal(filterItems(fresh.map((i, k) => ({ ...i, tags: k ? ['wasted'] : [] })), { tag: 'wasted' }).length, 1);
});

// ---------------------------------------------------------------- achievements

test('achievements: 24 rules, each with progress 0..1 and a hint; old data degrades to 0', () => {
  const list = computeAchievements({ attempts: [], learn: {}, now: T0 });
  assert.equal(list.length, ACHIEVEMENTS.length);
  assert.equal(list.length, 24);
  for (const a of list) {
    assert.equal(a.unlocked, false, a.id);
    assert.ok(a.progress >= 0 && a.progress <= 1, a.id);
    assert.equal(typeof a.hint, 'string');
    assert.ok(!/[\u2010-\u2015\u2212]/.test(a.name + a.desc + a.hint), `no unicode dashes in ${a.id}`);
  }
  assert.ok(!list.some((a) => /total attempts|leaderboard/i.test(a.desc)));
});

test('achievements: Fluent needs 20 attempts, 85% correct, median efficiency 0.9, 3 days', () => {
  const crammed = Array.from({ length: 20 }, (_, i) => att({ at: T0 + i * 1000 }));
  const f1 = fluent(crammed);
  assert.equal(f1.unlocked, false, 'one day of cramming is not enough');
  assert.match(f1.hint, /1 of 3 days/);
  const spread = Array.from({ length: 20 }, (_, i) => att({ at: T0 + days(i % 3) + i * 1000, outcome: i === 0 ? 'skipped' : 'solved' }));
  assert.equal(fluent(spread).unlocked, true);
  const all = computeAchievements({ attempts: spread, now: T0 + days(4) });
  assert.equal(all.find((a) => a.id === 'fluent-blockslide').unlocked, true);
  assert.ok(all.find((a) => a.id === 'transfer').progress > 0.3);
  assert.equal(all.find((a) => a.id === 'transfer').unlocked, false);
});

test('achievements: Habit Broken (5 in 30, then 30 clean) uses saved coach tags only', () => {
  const list = Array.from({ length: 60 }, (_, i) => att({ at: T0 + i * 1000 }));
  const tags = {};
  list.forEach((a, i) => (tags[a.id] = i < 30 && i % 5 === 0 ? ['wasted'] : []));
  const r = habitBroken(list, (a) => tags[a.id]);
  assert.equal(r.unlocked, true);
  assert.equal(r.tag, 'wasted');
  const half = habitBroken(list.slice(0, 45), (a) => tags[a.id]);
  assert.equal(half.unlocked, false);
  assert.ok(half.progress > 0.4 && half.progress < 0.6);
  assert.equal(habitBroken(list, () => undefined).progress, 0, 'no tags recorded: progress 0');
});

test('achievements: Steady Hand, Par Shooter, Fast Lane, Calibrated', () => {
  const run = Array.from({ length: 25 }, (_, i) => att({ outcome: i < 2 ? 'skipped' : 'solved', at: T0 + i * 1000, ms: 10000 }));
  const res = computeAchievements({ attempts: run, now: T0 + days(1), par: () => () => 20000 });
  assert.equal(res.find((a) => a.id === 'steady-hand').unlocked, true, '23 of 25 is 92%');
  assert.equal(res.find((a) => a.id === 'par-shooter').unlocked, true);
  assert.equal(res.find((a) => a.id === 'fast-lane').unlocked, true);
  assert.equal(fastLane(run, undefined, undefined, null).progress, 0, 'no par, no progress');
  const noisy = Array.from({ length: 30 }, (_, i) => att({ ms: i % 2 ? 5000 : 40000 }));
  const calm = Array.from({ length: 30 }, () => att({ ms: 20000 + (seq % 3) * 100 }));
  assert.equal(calibrated([...noisy, ...calm]).unlocked, true);
  assert.equal(calibrated(noisy).unlocked, false);
});

test('achievements: streaks, Spacer, Comeback, Pattern Spotter, Notebook, Second Look, First Light', () => {
  const daily = Array.from({ length: 7 }, (_, d) => att({ at: T0 + days(d) }));
  const r = computeAchievements({ attempts: daily, now: T0 + days(7) });
  assert.equal(r.find((a) => a.id === 'week-one').unlocked, true);
  assert.ok(Math.abs(r.find((a) => a.id === 'fortnight').progress - 0.5) < 1e-9);
  const spaced = [0, 2, 4, 6].flatMap((d) => Array.from({ length: 10 }, (_, i) => att({ at: T0 + days(d) + i * 1000 })));
  assert.equal(spacer(spaced).unlocked, true);
  assert.equal(spacer(spaced.slice(0, 30)).best, 3);
  const back = [att({ at: T0 }), att({ at: T0 + days(9) })];
  assert.equal(comeback(back, []).progress, 0.5);
  assert.equal(comeback(back, [{ t: T0 + days(9) + 5, type: 'queue_cleared', game: 'blockslide' }]).unlocked, true);
  // Three sessions of correct Pattern Rule attempts, each session quicker.
  const ps = [0, 1, 2].flatMap((s) => Array.from({ length: 4 }, (_, i) => att({ game: 'patternrule', at: T0 + days(s) + i * 1000, ms: 30000 - s * 5000 })));
  assert.equal(patternSpotter(ps).unlocked, true);
  assert.equal(patternSpotter(ps.slice(0, 8)).unlocked, false);
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, note: 'a careful note, twenty+', outcome: 'skipped' }));
  const events = [
    ...Array.from({ length: 10 }, (_, i) => ({ t: i, type: 'review', retryFirst: true, solved: true, itemId: `n${i}` })),
    { t: 1, type: 'explain_viewed', afterFail: true },
    { t: 2, type: 'queue_cleared', game: 'blockslide' },
  ];
  const r2 = computeAchievements({ attempts: [], learn: { items, events }, now: T0 });
  for (const id of ['notebook', 'second-look', 'first-light', 'lesson-learned', 'cleared-queue']) assert.equal(r2.find((a) => a.id === id).unlocked, true, id);
});

test('achievements: unlocks are permanent once recorded', () => {
  const list = computeAchievements({ attempts: [], now: T0 });
  const { list: merged, newly } = mergeUnlocked(list, { 'week-one': 123 }, T0);
  assert.equal(merged.find((a) => a.id === 'week-one').unlocked, true);
  assert.equal(merged.find((a) => a.id === 'week-one').unlockedAt, 123);
  assert.deepEqual(newly, []);
});

// ---------------------------------------------------------------- report data and snapshots

test('report: header, dims with sparklines, tag weeks with top and resolved tags, pace, weak patterns', () => {
  const now = new Date(2026, 9, 18, 12).getTime();
  const list = [];
  const tags = {};
  for (let i = 0; i < 60; i++) {
    const a = att({ at: now - days(55) + i * days(0.9), outcome: i % 4 === 0 ? 'skipped' : 'solved', eff: 0.8, ms: 15000 + (i % 5) * 5000 });
    list.push(a);
    tags[a.id] = i < 40 ? ['wasted', ...(i % 3 === 0 ? ['undo'] : [])] : [];
  }
  const featuresOf = (a) => [Number(a.id.slice(1)) % 2 ? 'odd puzzles' : 'even puzzles', 'everything'];
  const r = buildReport({ game: 'blockslide', attempts: list, tagsOf: (a) => tags[a.id], adapter: bs, featuresOf, now });
  assert.equal(r.header.n, 30);
  assert.equal(r.header.total, 60);
  assert.ok(r.header.trend7.delta !== undefined);
  assert.equal(r.dims.length, bs.DIMS.length);
  assert.equal(r.dims[0].spark.length, 30);
  assert.equal(r.weeks.rows.length, 8);
  assert.equal(r.weeks.top[0], 'wasted');
  assert.ok(r.weeks.resolved.includes('wasted'), 'gone in the last two weeks');
  assert.equal(r.pace.rows.reduce((s, x) => s + x.n, 0), r.pace.n);
  assert.ok(r.weak.shown.every((w) => w.n >= 5));
  assert.equal(r.prescriptions.length, 3);
  assert.ok(r.prescriptions.every((p) => p.href.startsWith('#/')));
  assert.equal(tagWeeks([], () => undefined).top.length, 0);
  const pb = paceBuckets([att({ ms: 1000 })], { time: (a) => a.metrics.totalMs, par: () => 20000 });
  assert.equal(pb.rows[0].n, 1);
  assert.equal(pb.rows[0].accuracy, null, 'n under 5 is not rated');
  assert.equal(weakPatterns([att()], () => ['x']).shown.length, 0);
});

test('snapshots: summary only, weekly rule, diff marks better and worse', () => {
  const now = T0 + days(30);
  const list = Array.from({ length: 30 }, (_, i) => att({ at: T0 + i * days(0.5), eff: 0.7 }));
  const r = buildReport({ game: 'blockslide', attempts: list, adapter: bs, now });
  const s = makeSnapshot(r, { kind: 'weekly', now });
  assert.ok(!('attempts' in s) && JSON.stringify(s).length < 3000, 'a summary, not raw attempts');
  assert.equal(weeklyDue([], r, now), true);
  assert.equal(weeklyDue([s], r, now + days(3)), false);
  assert.equal(weeklyDue([s], r, now + days(7)), true);
  const better = { ...s, gss: s.gss + 10, accuracy: 1, tier: s.tier === 'Novice' ? 'Adept' : 'Novice' };
  const d = diffSnapshots(s, better);
  const row = d.rows.find((x) => x.label === 'Game Skill Score');
  assert.equal(row.delta, 10);
  assert.equal(row.improved, true);
  assert.equal(d.tierChange.to, better.tier);
});

test('export: standalone HTML embeds styles, body and data, escaping script breaks', () => {
  const html = exportHtml({ title: 'R <1>', css: 'body{}', body: '<p>hi</p>', data: { x: '</script>' } });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>body\{\}<\/style>/);
  assert.match(html, /<title>R &lt;1&gt;<\/title>/);
  assert.ok(!html.includes('"</script>"'));
  assert.match(html, /Independent practice/);
});
