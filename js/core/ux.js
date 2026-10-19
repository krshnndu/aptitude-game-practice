// Pure onboarding logic: per-game status, the recommended set and puzzle, the home page next step,
// mode choice from a link, and the one-time UI flags (welcome strip, coach marks) kept in localStorage.
// No DOM here so node tests can cover all of it.

import { UNLOCK_THRESHOLD, averageEfficiency } from './score.js';

export const UX_KEY = 'cogprep.ux.v1';
export const SETS = 5;
export const PER_SET = 10;

const EMPTY_SET = { bestScore: 0, bestAvg: 0, runs: 0, practice: {} };
const setOf = (progress, game, s) => progress?.games?.[game]?.[s] ?? EMPTY_SET;
const practiceAvg = (e, n = PER_SET) => averageEfficiency(Object.values(e.practice || {}).reduce((a, b) => a + b, 0), n);
// A set counts as passed at the unlock bar, in a timed test or across practice bests.
export const setPassed = (e, n = PER_SET) => (e.bestAvg || 0) >= UNLOCK_THRESHOLD || practiceAvg(e, n) >= UNLOCK_THRESHOLD;
const setTouched = (e) => (e.runs || 0) > 0 || Object.keys(e.practice || {}).length > 0;

// 'new' (nothing played), 'mastered' (the last set passed) or 'progress'. attempts: count of logged attempts.
export function gameStatus(progress, game, { attempts = 0, sets = SETS, perSet = PER_SET } = {}) {
  if (setPassed(setOf(progress, game, sets), perSet)) return 'mastered';
  for (let s = 1; s <= sets; s++) if (setTouched(setOf(progress, game, s))) return 'progress';
  return attempts > 0 ? 'progress' : 'new';
}

export const STATUS_LABEL = { new: 'New', progress: 'In progress', mastered: 'Mastered' };

// The set a player should work on: the first open set not yet passed (else the last set).
export function recommendedSet(progress, game, { sets = SETS, perSet = PER_SET } = {}) {
  const unlockAll = !!progress?.unlockAll;
  for (let s = 1; s <= sets; s++) {
    const open = s === 1 || unlockAll || setPassed(setOf(progress, game, s - 1), perSet);
    if (!open) return Math.max(1, s - 1);
    if (!setPassed(setOf(progress, game, s), perSet)) return s;
  }
  return sets;
}

// Next practice puzzle in a set: the first never played, then the first not yet perfect, else 1.
export function nextPractice(progress, game, set, idOf, perSet = PER_SET) {
  const pr = setOf(progress, game, set).practice || {};
  for (let k = 1; k <= perSet; k++) if (pr[idOf(set, k)] === undefined) return k;
  for (let k = 1; k <= perSet; k++) if (!(pr[idOf(set, k)] >= 1)) return k;
  return 1;
}

// Which mode a link starts, for the mode_choice event (null for anything else).
export function modeFromHref(href) {
  const h = String(href || '');
  if (/^#\/study\//.test(h)) return 'study';
  if (/^#\/\w+\/practice\//.test(h)) return 'practice';
  if (/^#\/\w+\/run\/\d+\/fresh/.test(h)) return 'fresh';
  if (/^#\/\w+\/run\//.test(h)) return 'timed';
  return null;
}

// Home page suggestion. games: [{ id, name, status, practiced, timed }] in catalogue order; due: review count.
export function nextStep({ games = [], due = 0 } = {}) {
  if (!games.length) return null;
  const first = games[0];
  if (games.every((g) => g.status === 'new')) {
    return { kind: 'start', game: first.id, href: `#/${first.id}`, text: `New here? Start with ${first.name} practice: no timer, hints on, and the solution after every puzzle.`, cta: `Practice ${first.name}` };
  }
  if (due > 0) return { kind: 'review', href: '#/review/today', text: `${due} ${due === 1 ? 'puzzle is' : 'puzzles are'} due for review. Redo them before new ones: that is where the learning sticks.`, cta: 'Review now' };
  const ready = games.find((g) => g.status === 'progress' && g.practiced >= 3 && !g.timed);
  if (ready) return { kind: 'timed', game: ready.id, href: `#/${ready.id}`, text: `You have practised ${ready.name}. Try its 6 minute timed test to see how you do under the clock.`, cta: `Timed test: ${ready.name}` };
  const going = games.find((g) => g.status === 'progress');
  if (going) return { kind: 'continue', game: going.id, href: `#/${going.id}`, text: `Keep going with ${going.name}: pass a set at 70% to unlock the next one.`, cta: `Open ${going.name}` };
  const fresh = games.find((g) => g.status === 'new');
  if (fresh) return { kind: 'start', game: fresh.id, href: `#/${fresh.id}`, text: `Try a new game: ${fresh.name}. Start with practice.`, cta: `Practice ${fresh.name}` };
  return { kind: 'done', href: '#/review/today', text: 'Every game mastered. Keep sharp with timed tests and your review queue.', cta: 'Open review queue' };
}

// One-time flags: { welcome: ts dismissed, tips: { '<game>:<mode>': ts } }.
export function createUxPrefs(storage) {
  const load = () => {
    try {
      const d = JSON.parse(storage.getItem(UX_KEY) || 'null');
      return d && typeof d === 'object' ? { welcome: Number(d.welcome) || 0, tips: d.tips && typeof d.tips === 'object' ? d.tips : {}, tipsOff: !!d.tipsOff } : { welcome: 0, tips: {}, tipsOff: false };
    } catch {
      return { welcome: 0, tips: {}, tipsOff: false };
    }
  };
  const save = (d) => {
    try { storage.setItem(UX_KEY, JSON.stringify(d)); } catch { /* not persisted */ }
  };
  return {
    welcomeSeen: () => load().welcome > 0,
    dismissWelcome(now = Date.now()) { const d = load(); d.welcome = now; save(d); },
    tipSeen: (key) => { const d = load(); return d.tipsOff || !!d.tips[key]; },
    dismissTip(key, now = Date.now()) { const d = load(); d.tips[key] = now; save(d); },
    skipAllTips() { const d = load(); d.tipsOff = true; save(d); },
    resetTips() { save({ welcome: 0, tips: {}, tipsOff: false }); },
  };
}
