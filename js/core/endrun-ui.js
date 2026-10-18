// Flexible exit and learning focus widgets shared by every game: the End and review button, the
// leave guard (route change, page close, tab hidden), saving an ended-early run, the result-screen
// extras (score so far, top 3 takeaways, not attempted puzzles with solutions on demand) and the
// home page "Resume or review last run" card. Logic lives in partial.js; this file renders.

import { el } from './dom.js';
import { defaultStorage } from './store.js';
import { ev, bumpStreak } from './board.js';
import { gameName } from './games.js';
import { SHEETS, ADAPTERS, timeFor } from './learn-registry.js';
import { fixIds } from './learn-util.js';
import { finalizeRun, isPartial, isLeave, notAttempted, partialStats, takeaways, createResumeStore, resumeActions } from './partial.js';

let resumeStore = null;
export function resume() {
  resumeStore ??= createResumeStore(defaultStorage());
  return resumeStore;
}

// Practice attempts made since this tab opened the site make up a "practice session".
const SESSION_KEY = 'cogprep.session.v1';
export function sessionStart() {
  try {
    let t = Number(sessionStorage.getItem(SESSION_KEY));
    if (!t) {
      t = Date.now();
      sessionStorage.setItem(SESSION_KEY, String(t));
    }
    return t;
  } catch {
    return 0;
  }
}

const fmtClock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// The End and review button. Confirms first; nothing is lost and nothing is penalised.
export function endButton({ game, onEnd, practice = false, label = 'End and review' }) {
  return el('button', {
    type: 'button',
    class: 'btn btn-end',
    onclick: () => {
      const msg = practice
        ? 'End practice here and review? Your work so far is saved, and you can see the solutions.'
        : 'End the run now and review it? Everything you did so far is saved and counts toward your progress.';
      if (typeof confirm === 'function' && !confirm(msg)) return;
      ev('feat', game, { name: 'end_early', mode: practice ? 'practice' : 'exam' });
      onEnd('early');
    },
  }, label);
}

// Calls onLeave('unload') when the page is closed and onHide() when the tab is hidden (a checkpoint:
// mobile browsers often kill hidden tabs without a pagehide). Route changes arrive through the
// page's own dispose. Capture so the save runs before the telemetry abandon hook. Returns off().
export function guardRun({ onLeave, onHide = null }) {
  if (typeof addEventListener !== 'function') return () => {};
  const leave = () => onLeave('unload');
  const vis = () => {
    if (onHide && document.visibilityState === 'hidden') onHide();
  };
  addEventListener('pagehide', leave, { capture: true });
  document.addEventListener('visibilitychange', vis, { capture: true });
  return () => {
    removeEventListener('pagehide', leave, { capture: true });
    document.removeEventListener('visibilitychange', vis, { capture: true });
  };
}

// Save a finished or ended-early run: status flag, the resume slot, and the streak when no result
// screen will show it (leaving the page). 'hidden' is a silent checkpoint: no upload, no run_end.
export function saveEndedRun({ recorder, run, exit = 'time' }) {
  const r = finalizeRun(run, exit);
  recorder.saveRun(r, { silent: exit === 'hidden' });
  if (isPartial(r)) {
    const s = partialStats(r);
    resume().save({ game: r.game, kind: 'run', set: r.set, runId: r.id, attempted: s.attempted, solved: s.solved, score: s.score });
  } else resume().clear(r.game, 'run');
  if (exit === 'nav' || exit === 'unload') {
    try {
      bumpStreak();
    } catch {
      // ignore
    }
  }
  return r;
}

export { isLeave, isPartial };

// "Score so far" header for an ended-early run.
export function partialBanner(run, { label = 'puzzle' } = {}) {
  if (!isPartial(run)) return null;
  const s = partialStats(run);
  return el('div', { class: 'callout partial-banner', role: 'status' },
    el('p', {}, el('strong', { text: 'Run ended early. ' }), 'Everything up to here is saved and counts toward your progress, streak and review library.'),
    el('div', { class: 'score-tiles' },
      el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Score so far' }), el('strong', { text: s.score.toFixed(2) })),
      el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: `${label[0].toUpperCase()}${label.slice(1)}s seen` }), el('strong', { text: String(s.attempted) })),
      el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Solved' }), el('strong', { text: String(s.solved) })),
      el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Time used' }), el('strong', { text: fmtClock(s.elapsedMs) }))));
}

// Top 3 takeaways plus the notebook link. perPuzzle: coach findings per attempt (arrays or
// { findings }); tagLists may be given instead (review pages read them from the learning store).
export function takeawaysPanel({ game, attempts, habits = [], perPuzzle = null, tagLists = null, label = 'puzzle', seed = 0 }) {
  let list;
  try {
    const lists = tagLists ?? (perPuzzle ? perPuzzle.map((e) => fixIds(Array.isArray(e) ? e : e?.findings ?? [])) : null);
    list = takeaways({ attempts, habits, tagLists: lists, sheet: SHEETS[game], timeOf: timeFor(game), tagLabel: (t) => ADAPTERS[game]?.tagLabel?.(t) ?? t, label, seed });
  } catch (err) {
    console.error(err);
    return null;
  }
  const missed = attempts.some((a) => a.outcome !== 'solved' || (a.metrics?.efficiency ?? 1) < 1);
  return el('section', { class: 'takeaways', 'aria-label': 'Top 3 takeaways' },
    el('h3', { text: 'Top 3 takeaways' }),
    el('ol', { class: 'takeaway-list' }, list.map((t) => el('li', { class: `takeaway takeaway-${t.kind}` }, el('strong', { text: `${t.title}: ` }), t.text))),
    el('p', { class: 'after-actions' },
      missed ? el('a', { class: 'btn btn-small', href: `#/review/${game}` }, 'Open the review notebook for missed items') : null,
      el('a', { class: 'btn btn-small', href: `#/report/${game}` }, 'Strategy sheet and report')));
}

// The pool puzzles a run never reached, each with its optimal solution on demand (study mode).
// solve(puzzle, onDispose) -> walkthrough node.
export function notAttemptedSection({ game, pool, attemptedIds, solve, onDispose = () => {}, label = 'puzzle', set = null }) {
  const left = notAttempted(pool, attemptedIds);
  if (!left.length) return null;
  let logged = false;
  return el('section', { class: 'not-attempted', 'aria-label': 'Not attempted' },
    el('h3', { text: `Not attempted (${left.length})` }),
    el('p', { class: 'muted', text: `These ${label}s from the set were not reached. Open one to study its optimal solution: no timer, not scored.` }),
    left.map((p) => {
      const det = el('details', { class: 'study-item' }, el('summary', {}, `${p.id}: not attempted`));
      det.addEventListener('toggle', () => {
        if (!det.open || det.dataset.built) return;
        det.dataset.built = '1';
        if (!logged) {
          logged = true;
          ev('feat', game, { name: 'study_open', src: 'result' });
        }
        try {
          det.append(solve(p, onDispose));
        } catch (err) {
          console.error(err);
          det.append(el('p', { class: 'notice', text: 'The solution could not be drawn.' }));
        }
      });
      return det;
    }),
    set ? el('p', {}, el('a', { class: 'btn btn-small', href: `#/study/${game}/${set}` }, 'Study mode for this set')) : null);
}

// Everything the learning focus adds under a run result, in order.
export function runLearning({ game, run, attempts, habits, perPuzzle, pool, solve, onDispose, label = 'puzzle' }) {
  return [
    takeawaysPanel({ game, attempts, habits, perPuzzle, label, seed: run.seed ?? 0 }),
    isPartial(run) ? notAttemptedSection({ game, pool, attemptedIds: attempts.map((a) => a.puzzleId), solve, onDispose, label, set: run.set }) : null,
  ];
}

export const studyLink = (game, set, text = 'Study mode') => el('a', { class: 'btn btn-quiet', href: `#/study/${game}/${set}` }, text);

// Home page card for the resume slot.
export function resumeCard() {
  const entry = resume().last();
  const act = resumeActions(entry);
  if (!act) return null;
  const card = el('section', { class: 'resume-card callout', 'aria-label': 'Resume or review last run' },
    el('h2', { class: 'section-title', text: 'Resume or review last run' }),
    el('p', {}, el('strong', { text: `${gameName(entry.game)}. ` }), act.text),
    el('div', { class: 'after-actions' },
      act.resumeHref ? el('a', { class: 'btn btn-primary', href: act.resumeHref, onclick: () => ev('feat', entry.game, { name: 'resume', kind: entry.kind }) }, 'Resume') : null,
      el('a', { class: `btn${act.resumeHref ? '' : ' btn-primary'}`, href: act.reviewHref, onclick: () => ev('feat', entry.game, { name: 'resume', kind: `${entry.kind}_review` }) }, 'Review'),
      el('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { resume().clear(); card.remove(); } }, 'Dismiss')));
  return card;
}
