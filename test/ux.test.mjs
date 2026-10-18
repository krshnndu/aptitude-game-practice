// Onboarding logic: game status chips, recommended set and puzzle, next step, mode links, one-time prefs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameStatus, recommendedSet, nextPractice, modeFromHref, nextStep, createUxPrefs, setPassed, UX_KEY } from '../js/core/ux.js';
import { memoryStorage } from '../js/core/store.js';

const idOf = (s, k) => `bs${s}-${String(k).padStart(2, '0')}`;
const prog = (sets, unlockAll = false) => ({ v: 1, unlockAll, games: { blockslide: sets } });
const full = (s, eff) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [idOf(s, i + 1), eff]));

test('gameStatus: new, in progress, mastered', () => {
  assert.equal(gameStatus(prog({}), 'blockslide'), 'new');
  assert.equal(gameStatus(null, 'blockslide'), 'new');
  assert.equal(gameStatus(prog({}), 'blockslide', { attempts: 2 }), 'progress');
  assert.equal(gameStatus(prog({ 1: { bestScore: 0, bestAvg: 0, runs: 0, practice: { 'bs1-01': 0.5 } } }), 'blockslide'), 'progress');
  assert.equal(gameStatus(prog({ 1: { runs: 1, bestAvg: 0.2, practice: {} } }), 'blockslide'), 'progress');
  assert.equal(gameStatus(prog({ 5: { runs: 1, bestAvg: 0.7, practice: {} } }), 'blockslide'), 'mastered');
  assert.equal(gameStatus(prog({ 5: { runs: 0, bestAvg: 0, practice: full(5, 0.8) } }), 'blockslide'), 'mastered');
  assert.equal(gameStatus(prog({ 5: { runs: 1, bestAvg: 0.69, practice: {} } }), 'blockslide'), 'progress');
});

test('setPassed uses timed best or the practice average over the whole set', () => {
  assert.ok(setPassed({ bestAvg: 0.7, practice: {} }));
  assert.ok(!setPassed({ bestAvg: 0, practice: { a: 1, b: 1 } }));
  assert.ok(setPassed({ bestAvg: 0, practice: full(1, 0.7) }));
});

test('recommendedSet: first open set not yet passed', () => {
  assert.equal(recommendedSet(prog({}), 'blockslide'), 1);
  assert.equal(recommendedSet(prog({ 1: { bestAvg: 0.8, practice: {} } }), 'blockslide'), 2);
  assert.equal(recommendedSet(prog({ 1: { bestAvg: 0.8, practice: {} }, 2: { bestAvg: 0.9, practice: {} } }), 'blockslide'), 3);
  const all = Object.fromEntries([1, 2, 3, 4, 5].map((s) => [s, { bestAvg: 1, practice: {} }]));
  assert.equal(recommendedSet(prog(all), 'blockslide'), 5);
  // Unlock all does not skip unpassed sets.
  assert.equal(recommendedSet(prog({}, true), 'blockslide'), 1);
});

test('nextPractice: first unplayed, then first imperfect, else 1', () => {
  assert.equal(nextPractice(prog({}), 'blockslide', 1, idOf), 1);
  assert.equal(nextPractice(prog({ 1: { practice: { 'bs1-01': 1, 'bs1-02': 0.5 } } }), 'blockslide', 1, idOf), 3);
  const p = full(1, 1);
  p['bs1-04'] = 0.6;
  assert.equal(nextPractice(prog({ 1: { practice: p } }), 'blockslide', 1, idOf), 4);
  assert.equal(nextPractice(prog({ 1: { practice: full(1, 1) } }), 'blockslide', 1, idOf), 1);
});

test('modeFromHref maps start links to modes', () => {
  assert.equal(modeFromHref('#/blockslide/practice/1/3'), 'practice');
  assert.equal(modeFromHref('#/latinsquare/run/2'), 'timed');
  assert.equal(modeFromHref('#/study/gridmemory/1'), 'study');
  assert.equal(modeFromHref('#/analytics'), null);
  assert.equal(modeFromHref(null), null);
});

test('nextStep: start, review, timed, continue, new game, done', () => {
  const g = (id, status, practiced = 0, timed = 0) => ({ id, name: id.toUpperCase(), status, practiced, timed });
  assert.equal(nextStep({ games: [] }), null);
  assert.equal(nextStep({ games: [g('a', 'new'), g('b', 'new')] }).kind, 'start');
  assert.equal(nextStep({ games: [g('a', 'new'), g('b', 'new')] }).game, 'a');
  assert.equal(nextStep({ games: [g('a', 'progress', 1)], due: 2 }).kind, 'review');
  const t = nextStep({ games: [g('a', 'progress', 4, 0)] });
  assert.equal(t.kind, 'timed');
  assert.equal(t.href, '#/a');
  assert.equal(nextStep({ games: [g('a', 'progress', 4, 1)] }).kind, 'continue');
  assert.equal(nextStep({ games: [g('a', 'mastered'), g('b', 'new')] }).game, 'b');
  assert.equal(nextStep({ games: [g('a', 'mastered')] }).kind, 'done');
});

test('ux prefs: welcome and tips are remembered, skip all and reset', () => {
  const s = memoryStorage();
  const p = createUxPrefs(s);
  assert.equal(p.welcomeSeen(), false);
  p.dismissWelcome(5);
  assert.equal(p.welcomeSeen(), true);
  assert.equal(createUxPrefs(s).welcomeSeen(), true);
  assert.equal(p.tipSeen('blockslide:practice'), false);
  p.dismissTip('blockslide:practice');
  assert.equal(p.tipSeen('blockslide:practice'), true);
  assert.equal(p.tipSeen('blockslide:run'), false);
  p.skipAllTips();
  assert.equal(p.tipSeen('latinsquare:run'), true);
  p.resetTips();
  assert.equal(p.tipSeen('blockslide:practice'), false);
  assert.equal(p.welcomeSeen(), false);
  s.setItem(UX_KEY, '{bad json');
  assert.equal(createUxPrefs(s).welcomeSeen(), false);
});
