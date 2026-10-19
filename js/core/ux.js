// Pure onboarding logic: per-game status, the recommended set and puzzle, mode choice from a link,
// the result screen Termly nudge rule, and the one-time UI flags (welcome strip, coach marks) kept in localStorage.
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

// Result screen Termly nudge: counts results shown on this browser and allows the nudge once per tab
// session, from the second result onward. local, session: Storage-like. Returns true to show it.
export const RUNS_KEY = 'cogprep.runs.v1';
export const NUDGE_KEY = 'cogprep.makernudge.v1';
export function makerNudgeDue(local, session) {
  try {
    const n = (Number(local.getItem(RUNS_KEY)) || 0) + 1;
    local.setItem(RUNS_KEY, String(n));
    if (n < 2 || session.getItem(NUDGE_KEY)) return false;
    session.setItem(NUDGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
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
