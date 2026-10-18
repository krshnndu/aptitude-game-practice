// Small hooks the game pages call so the learning layer sees what the coach saw: coach tags per
// attempt, auto-added notebook items (with the live puzzle, so the seed reference carries an exact
// checksum), explain-walkthrough views, and the hand-off of a review puzzle to a retry page.
// Every hook swallows its own errors: learning data must never break play.

import { createLearnStore } from './learn-store.js';
import { ADAPTERS, correctFor } from './learn-registry.js';
import { fixIds } from './learn-util.js';
import { qualifies, makeItem, applyReview } from './notebook.js';
import { dueItems } from './srs.js';
import { dvsCodes } from './dvs.js';
import { ev } from './board.js';

let store = null;
export function learnStore() {
  store ??= createLearnStore();
  return store;
}
// Tests swap in a memory-backed store.
export function useLearnStore(s) {
  store = s;
}

function safe(fn) {
  try {
    return fn();
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Before an attempt is saved: keep the compact did vs should codes ({ ans, opt, div, lat }) with it,
// so history views and item telemetry have them without rebuilding the puzzle.
export function stampDvs(game, attempt, puzzle) {
  return safe(() => {
    if (!attempt || !puzzle) return null;
    const fn = ADAPTERS[game]?.didVsShould;
    const d = fn ? dvsCodes(fn(attempt, puzzle)) : null;
    if (d) attempt.dvs = d;
    return d;
  });
}

// After the coach reviewed one attempt. opts: { run, base } for run variants (see adapters).
export function noteAttempt(game, attempt, findings, puzzle, opts = {}) {
  return safe(() => {
    if (!attempt?.id || attempt.sample) return;
    const s = learnStore();
    s.setTags(attempt.id, fixIds(findings));
    if (!qualifies(attempt, correctFor(game)) || s.item(attempt.id)) return;
    const ad = ADAPTERS[game];
    const ref = ad ? ad.refFor(attempt, puzzle, opts) : undefined;
    s.upsertItem(makeItem({ ...attempt, game }, { ref, tags: fixIds(findings) }));
  });
}

// After a timed test's coaching: perPuzzle[i] holds the findings (or { findings }) of attempts[i].
export function noteRun(game, run, attempts, perPuzzle, puzzlesById) {
  return safe(() => {
    const get = (id) => (puzzlesById instanceof Map ? puzzlesById.get(id) : puzzlesById?.[id]);
    attempts.forEach((a, i) => {
      const entry = perPuzzle?.[i];
      const findings = Array.isArray(entry) ? entry : entry?.findings ?? [];
      const puzzle = get(a.puzzleId) ?? null;
      const base = puzzle?.variantOf ? get(puzzle.variantOf) ?? null : null;
      noteAttempt(game, a, findings, puzzle, { run, base });
    });
  });
}

// Log the first real interaction with a walkthrough panel (a button press or opening a section).
export function trackExplain(panel, attempt) {
  if (!panel || !attempt) return panel;
  let done = false;
  const failed = attempt.outcome !== 'solved' || (attempt.metrics?.efficiency ?? 0) < 1;
  const fire = (e) => {
    if (done || !(e.target instanceof Element) || !e.target.closest('button, summary, a')) return;
    done = true;
    safe(() => learnStore().addEvent({ t: Date.now(), type: 'explain_viewed', game: attempt.game, attemptId: attempt.id, afterFail: failed }));
  };
  panel.addEventListener('click', fire);
  return panel;
}

// ---------------------------------------------------------------- retry hand-off

const RETRY_KEY = 'cogprep.retry.v1';
let pendingRetry = null;
const session = () => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

// { game, itemId, attemptId, puzzle, set, revealed, startedAt, returnHash }
export function setRetry(r) {
  pendingRetry = { ...r, startedAt: Date.now() };
  safe(() => session()?.setItem(RETRY_KEY, JSON.stringify(pendingRetry)));
  return pendingRetry;
}

export function peekRetry(game = null) {
  if (!pendingRetry) pendingRetry = safe(() => JSON.parse(session()?.getItem(RETRY_KEY) || 'null'));
  return pendingRetry && (game === null || pendingRetry.game === game) ? pendingRetry : null;
}

export function clearRetry() {
  pendingRetry = null;
  safe(() => session()?.removeItem(RETRY_KEY));
}

// A retry from the review library finished: grade it, reschedule the item, log the review and,
// when that emptied the game's due queue, a queue_cleared event. Returns { result } or null.
export function completeRetry(game, attempt, now = Date.now()) {
  return safe(() => {
    const r = peekRetry(game);
    if (!r || !attempt) return null;
    const s = learnStore();
    const item = s.item(r.itemId);
    if (!item) return null;
    const wasDue = dueItems([item], now).length > 0;
    const { item: next, result } = applyReview(item, attempt, { correct: correctFor(game), revealed: !!r.revealed, now });
    s.upsertItem(next);
    s.addEvent({ t: now, type: 'review', game, itemId: item.id, attemptId: attempt.id, result, retryFirst: !r.revealed, solved: correctFor(game)(attempt), wasDue });
    const items = s.items();
    if (wasDue && !dueItems(items, now, game).length) {
      s.addEvent({ t: now, type: 'queue_cleared', game });
      if (!dueItems(items, now).length) s.addEvent({ t: now, type: 'queue_cleared', game: 'all' });
    }
    ev('review_done', game, { game, result, rf: !r.revealed, div: attempt.dvs ? attempt.dvs.div : -1 });
    pendingRetry = { ...r, doneAttemptId: attempt.id, result };
    safe(() => session()?.setItem(RETRY_KEY, JSON.stringify(pendingRetry)));
    return { result, item: next };
  });
}
