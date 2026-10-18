// Ended-early runs, plain-language takeaways and the "resume or review" slot (pure, no DOM).
//
// A timed run normally ends when its clock runs out (exit 'time', status 'complete'). It can also end
// early: the End and review button ('early'), a route change ('nav'), closing or leaving the page
// ('unload'), or a checkpoint taken when the tab is hidden ('hidden'). Those runs are saved with
// status 'partial': they count toward progress, reports, streaks, the review library and did vs
// should, but are never uploaded to the leaderboard or ranked.

import { splitVariant } from './learn-util.js';

export const EXITS = ['time', 'early', 'nav', 'unload', 'hidden'];
export const RESUME_KEY = 'cogprep.resume.v1';
export const RESUME_MAX_AGE = 7 * 24 * 3600 * 1000;

// Stamp a run record with how it ended. Unknown exits count as early.
export function finalizeRun(run, exit = 'time') {
  const e = EXITS.includes(exit) ? exit : 'early';
  if (e === 'time') {
    const { partial, exit: _x, ...rest } = run;
    return { ...rest, status: 'complete' };
  }
  return { ...run, status: 'partial', partial: true, exit: e };
}

export const isPartial = (run) => !!run && (run.status === 'partial' || run.partial === true);

// Leaving the page: there is no result screen to show, only saves.
export const isLeave = (exit) => exit === 'nav' || exit === 'unload' || exit === 'hidden';

// Pool puzzles never shown in the run, in pool order. Variants count as their base puzzle.
export function notAttempted(pool, attemptedIds) {
  const seen = new Set();
  for (const id of attemptedIds ?? []) {
    seen.add(id);
    seen.add(splitVariant(id).base);
  }
  return (pool ?? []).filter((p) => p && !seen.has(p.id));
}

// Score so far, items seen and elapsed time for the result header and the resume card.
export function partialStats(run) {
  return {
    score: Number.isFinite(run?.score) ? run.score : 0,
    attempted: run?.attempted ?? run?.puzzles?.length ?? 0,
    solved: run?.solved ?? 0,
    elapsedMs: Math.max(0, run?.durationMs ?? 0),
  };
}

const secs = (ms) => `${Math.round(ms / 1000)} s`;
const OUTCOME_WORDS = { solved: 'you solved it', skipped: 'you skipped it', timeout: 'it was left unfinished', wrong: 'the answer was wrong' };

// Three plain-language takeaways: biggest time sink, repeated mistake, one strategy tip.
// attempts: finished attempt records in play order. habits: coach habits ({ id, label, count, of }).
// tagLists: per attempt, the coach fix ids (used when no habits are given). sheet: strategy sheet.
// timeOf(attempt) -> ms; tagLabel(id) -> text; label: item noun; seed picks a heuristic.
export function takeaways({ attempts = [], habits = [], tagLists = null, sheet = null, timeOf = (a) => a.metrics?.totalMs ?? 0, tagLabel = (t) => t, label = 'puzzle', seed = 0 } = {}) {
  const out = [];
  const times = attempts.map((a) => Math.max(0, Number(timeOf(a)) || 0));
  const total = times.reduce((s, t) => s + t, 0);
  if (attempts.length >= 2 && total > 0) {
    let k = 0;
    times.forEach((t, i) => { if (t > times[k]) k = i; });
    const share = Math.round((times[k] / total) * 100);
    const how = OUTCOME_WORDS[attempts[k].outcome] ?? 'it ended';
    out.push({ kind: 'time', title: 'Biggest time sink', text: `${cap(label)} ${k + 1} took ${secs(times[k])}, ${share}% of your time, and ${how}. Set yourself a cut-off and move on sooner next time.` });
  } else if (attempts.length === 1) {
    out.push({ kind: 'time', title: 'Biggest time sink', text: `You saw one ${label} in ${secs(times[0] ?? 0)}. Play a few more to see where your time goes.` });
  } else {
    out.push({ kind: 'time', title: 'Biggest time sink', text: `No ${label} was finished, so there is no timing to compare yet.` });
  }

  // Repeated pattern: a coach habit seen in 2 or more items, else the most common fix tag.
  let tag = null;
  let pattern = null;
  const h = habits.find((x) => x.count >= 2);
  if (h) {
    tag = h.id;
    pattern = `${h.label} in ${h.count} of ${h.of} ${label}s.`;
  } else if (tagLists) {
    const counts = new Map();
    for (const list of tagLists) for (const t of new Set(list ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1);
    const top = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (top) {
      tag = top[0];
      pattern = `${tagLabel(top[0])} in ${top[1]} of ${attempts.length} ${label}s.`;
    }
  }
  if (!pattern) {
    const diverged = attempts.filter((a) => a.dvs && a.dvs.div >= 0);
    if (diverged.length >= 2) {
      const steps = diverged.map((a) => a.dvs.div + 1);
      const early = steps.filter((s) => s <= 2).length;
      pattern = `You left the best line in ${diverged.length} of ${attempts.length} ${label}s${early * 2 >= diverged.length ? ', usually in the first two steps: slow down at the start' : ''}.`;
    }
  }
  out.push({ kind: 'pattern', title: 'Repeated mistake pattern', text: pattern ?? `No mistake repeated across ${label}s here. Keep the same approach.` });

  const trap = tag && sheet?.traps?.find((t) => t.tag === tag);
  const tips = sheet?.heuristics ?? [];
  const tip = trap ? trap.text : tips.length ? tips[Math.abs(Math.floor(seed)) % tips.length] : null;
  out.push({ kind: 'tip', title: 'Strategy tip', text: tip ?? 'Read the strategy sheet in this game\'s report before the next run.' });
  return out;
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// ---------------------------------------------------------------- resume or review slot

// One slot: the last run that ended early or the practice puzzle that was left unfinished.
// entry: { game, kind: 'run'|'practice', set, k?, runId?, at, attempted?, solved?, score? }
export function sanitizeResume(e, now = Date.now()) {
  if (!e || typeof e !== 'object' || typeof e.game !== 'string' || !/^[a-z]+$/.test(e.game)) return null;
  if (e.kind !== 'run' && e.kind !== 'practice') return null;
  if (!Number.isInteger(e.set) || e.set < 1 || e.set > 9 || !Number.isFinite(e.at)) return null;
  if (now - e.at > RESUME_MAX_AGE || e.at - now > 60_000) return null;
  const out = { game: e.game, kind: e.kind, set: e.set, at: e.at };
  if (e.kind === 'practice') {
    if (!Number.isInteger(e.k) || e.k < 1 || e.k > 99) return null;
    out.k = e.k;
  } else {
    if (typeof e.runId !== 'string' || !/^[0-9a-z]{1,40}$/.test(e.runId)) return null;
    out.runId = e.runId;
  }
  for (const f of ['attempted', 'solved', 'score']) if (Number.isFinite(e[f])) out[f] = e[f];
  return out;
}

export function createResumeStore(storage) {
  const read = (now) => {
    try {
      return sanitizeResume(JSON.parse(storage.getItem(RESUME_KEY) || 'null'), now);
    } catch {
      return null;
    }
  };
  return {
    save(entry, now = Date.now()) {
      const clean = sanitizeResume({ ...entry, at: entry.at ?? now }, now);
      if (!clean) return null;
      try {
        storage.setItem(RESUME_KEY, JSON.stringify(clean));
      } catch {
        return null;
      }
      return clean;
    },
    last: (now = Date.now()) => read(now),
    // Clear the slot, or only when it belongs to this game (and kind).
    clear(game = null, kind = null, now = Date.now()) {
      const cur = read(now);
      if (game && cur && (cur.game !== game || (kind && cur.kind !== kind))) return;
      try {
        storage.removeItem(RESUME_KEY);
      } catch {
        // ignore
      }
    },
  };
}

// Where the card's buttons go. Timed runs are never resumed (the clock would not be fair), so they
// offer review only; practice puzzles reopen where they were left.
export function resumeActions(entry) {
  if (!entry) return null;
  if (entry.kind === 'practice') {
    return {
      resumeHref: `#/${entry.game}/practice/${entry.set}/${entry.k}`,
      reviewHref: `#/review/${entry.game}/practice/${entry.set}`,
      text: `Practice, set ${entry.set}, puzzle ${entry.k} was left unfinished.`,
    };
  }
  const bits = [];
  if (Number.isFinite(entry.attempted)) bits.push(`${entry.attempted} seen`);
  if (Number.isFinite(entry.solved)) bits.push(`${entry.solved} solved`);
  if (Number.isFinite(entry.score)) bits.push(`score so far ${entry.score.toFixed(2)}`);
  return {
    resumeHref: null,
    reviewHref: `#/review/${entry.game}/run/${entry.runId}`,
    text: `Timed run on set ${entry.set} ended early${bits.length ? ` (${bits.join(', ')})` : ''}. Timed runs restart fresh, so this one is ready to review.`,
  };
}
