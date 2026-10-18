// Mistake notebook rules (pure): which attempts become review items, how a review encounter updates
// an item, catch-up sync from the play archive, and filters.

import { NOTEBOOK_EFF, CAPS, DAY_MS, grade, newSchedule, schedule, isMastered } from './srs.js';

export const PATH_CAP = 200;
const BACKFILL_DAYS = 30;
const solved = (a) => a.outcome === 'solved';
const METRIC_KEYS = ['efficiency', 'moves', 'grossMoves', 'optimal', 'totalMs', 'firstMoveMs', 'blocked', 'undos', 'hints'];

// The few metrics a replay needs once the attempt itself has been pruned from the archive.
export function pickMetrics(m = {}) {
  const out = {};
  for (const k of METRIC_KEYS) if (Number.isFinite(m?.[k])) out[k] = m[k];
  return out;
}

// An attempt-shaped record for the adapters: the archived attempt when it still has its events,
// otherwise rebuilt from the item.
export function attemptFromItem(item, archived = null) {
  if (archived && archived.events?.length) return archived;
  return {
    id: item.attemptId, game: item.game, set: item.set, puzzleId: item.puzzleId, mode: item.mode,
    source: item.source, startedAt: item.createdAt, outcome: item.outcome, optimal: item.metrics?.optimal ?? 0,
    moves: item.metrics?.moves ?? null, hintsUsed: item.metrics?.hints ?? 0,
    events: item.path ?? [], metrics: { ...item.metrics, efficiency: item.efficiency },
  };
}

// Auto-add on a fail or efficiency under 0.7. Clock cut-offs, samples and review retries are not added.
export function qualifies(a, correct = solved) {
  if (!a || a.sample || a.source === 'review' || a.outcome === 'timeout') return false;
  return !correct(a) || (a.metrics?.efficiency ?? 0) < NOTEBOOK_EFF;
}

export function makeItem(a, { ref, tags = [], now = Date.now() } = {}) {
  const sched = newSchedule(now);
  return {
    id: a.id,
    attemptId: a.id,
    game: a.game,
    set: a.set,
    puzzleId: a.puzzleId,
    source: a.source,
    mode: a.mode,
    createdAt: a.startedAt ?? now,
    outcome: a.outcome,
    efficiency: a.metrics?.efficiency ?? 0,
    metrics: pickMetrics(a.metrics),
    ref: ref ?? { pid: a.puzzleId, set: a.set },
    tags: tags.slice(0, 12),
    note: '',
    ...sched,
    // The user path is kept only because this attempt failed or was inefficient.
    path: (a.events ?? []).slice(0, PATH_CAP),
  };
}

// One review encounter. revealed: the walkthrough was opened before the retry.
export function applyReview(item, retry, { correct = solved, revealed = false, now = Date.now() } = {}) {
  const result = grade({ solved: correct(retry), efficiency: retry.metrics?.efficiency ?? 0 });
  const next = schedule(item, result, now, { attemptId: retry.id, retryFirst: !revealed, eff: retry.metrics?.efficiency ?? 0 });
  return { item: { ...item, ...next }, result };
}

// Catch-up: qualifying attempts since the last sync (or the last 30 days on first run) that have no
// item yet. Returns new items; refFor(a) builds the seed reference without the puzzle.
export function syncItems(attempts, items, { lastSync = 0, now = Date.now(), correctFor = () => solved, refFor = null, tagsOf = () => [] } = {}) {
  const have = new Set(items.map((i) => i.attemptId));
  const since = lastSync || now - BACKFILL_DAYS * DAY_MS;
  const out = [];
  for (const a of attempts) {
    if (a.startedAt <= since || have.has(a.id) || !qualifies(a, correctFor(a.game))) continue;
    out.push(makeItem(a, { ref: refFor ? refFor(a) : undefined, tags: tagsOf(a) ?? [], now: a.startedAt }));
  }
  return out;
}

// Filter by game, tag and age in days (null = any).
export function filterItems(items, { game = null, tag = null, days = null, now = Date.now(), status = null } = {}) {
  return items.filter((i) =>
    (game === null || i.game === game) &&
    (tag === null || i.tags.includes(tag)) &&
    (days === null || now - i.createdAt <= days * DAY_MS) &&
    (status === null || (status === 'mastered' ? isMastered(i) : status === 'due' ? i.dueAt <= now : true)));
}

export const clampNote = (s) => String(s ?? '').slice(0, CAPS.note);
