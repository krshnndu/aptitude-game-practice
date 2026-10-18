// Replay of one review item (#/review/<game>/<attemptId>). Retry first is the default: the puzzle is
// rebuilt from its seed reference and handed to the game's own practice view to be solved blind.
// Afterwards (or on request) Compare shows the original puzzle facts, your move list stepped
// through with the divergence point, and the optimal walkthrough; Watch replays the optimal line
// on the game's own board.

import { el } from './dom.js';
import { gameName } from './games.js';
import { ADAPTERS, rebuild, correctFor } from './learn-registry.js';
import { loadContext, fmtDate, pctText } from './learn-ui.js';
import { attemptFromItem } from './notebook.js';
import { setRetry, peekRetry } from './learn-hooks.js';
import { isMastered } from './srs.js';
import { noteEditor, tagEditor } from './notebook-ui.js';
import { reviewWalkthrough as bsWalk } from '../games/blockslide/play.js';
import { reviewWalkthrough as lsWalk } from '../games/latinsquare/play.js';
import { reviewWalkthrough as gmWalk } from '../games/gridmemory/play.js';
import { reviewWalkthrough as osWalk } from '../games/operatorswitch/play.js';
import { reviewWalkthrough as deWalk } from '../games/digitequation/play.js';
import { reviewWalkthrough as prWalk } from '../games/patternrule/play.js';

const WALK = { blockslide: bsWalk, latinsquare: lsWalk, gridmemory: gmWalk, operatorswitch: osWalk, digitequation: deWalk, patternrule: prWalk };
const RESULT_TEXT = { pass: 'Correct and efficient: the interval moves up.', inefficient: 'Correct but inefficient: same interval again.', fail: 'Not solved: back to a 1-day interval.' };

// Items whose solution was revealed before a retry (that retry then does not count as retry-first).
const REVEAL_KEY = 'cogprep.revealed.v1';
function revealedSet() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(REVEAL_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
function setRevealed(id, on) {
  const s = revealedSet();
  if (on) s.add(id);
  else s.delete(id);
  try {
    sessionStorage.setItem(REVEAL_KEY, JSON.stringify([...s].slice(-100)));
  } catch {
    // ignore
  }
}

// Step-through list: Prev / Next move a highlight; the divergence step is marked.
function stepList(title, steps, { divergence = null, id }) {
  let k = divergence?.index ?? 0;
  const items = steps.map((s, i) => el('li', { class: `${s.ok === false ? 'step-off' : s.ok === true ? 'step-on' : ''}${divergence && divergence.index === i ? ' step-diverge' : ''}` },
    s.text,
    divergence && divergence.index === i ? el('span', { class: 'badge badge-warn', text: 'Left the optimal path here' }) : null,
    s.ok === false && !(divergence && divergence.index === i) ? el('span', { class: 'sr-only', text: ' (off the solution)' }) : null));
  const counter = el('span', { class: 'step-counter', 'aria-live': 'polite' });
  const prev = el('button', { type: 'button', class: 'btn btn-small', onclick: () => go(k - 1) }, 'Prev');
  const next = el('button', { type: 'button', class: 'btn btn-small', onclick: () => go(k + 1) }, 'Next');
  function go(j) {
    if (!steps.length) return;
    k = Math.max(0, Math.min(steps.length - 1, j));
    items.forEach((li, i) => li.toggleAttribute('aria-current', i === k));
    counter.textContent = `Step ${k + 1} of ${steps.length}`;
    prev.disabled = k === 0;
    next.disabled = k === steps.length - 1;
  }
  const pane = el('section', { class: 'replay-pane', 'aria-labelledby': id },
    el('h3', { id, text: title }),
    steps.length ? el('div', { class: 'replay-controls' }, prev, next, counter) : null,
    steps.length ? el('ol', { class: 'step-list replay-steps' }, items) : el('p', { class: 'muted', text: 'No moves were recorded.' }));
  go(k);
  return pane;
}

export async function mountReplay(main, game, attemptId, query) {
  const ctx = loadContext({ sync: false });
  const ad = ADAPTERS[game];
  const item = ctx.store.item(attemptId);
  const archived = ctx.data.attempts.find((a) => a.id === attemptId) ?? null;
  const root = el('div', { class: 'learn replay' });
  main.append(root);
  const back = query.get('from') === 'today' ? '#/review/today' : `#/review/${game}`;
  root.append(el('p', { class: 'crumbs' }, el('a', { href: back }, query.get('from') === 'today' ? 'Today\'s queue' : `${gameName(game)} review library`), ' / Replay'));
  if (!item && !archived) {
    root.append(el('p', { class: 'notice', text: 'This entry is no longer in your notebook or play history.' }));
    return () => {};
  }
  const attempt = item ? attemptFromItem(item, archived) : archived;
  const ref = item?.ref ?? ad.refFor(archived);
  const status = el('p', { class: 'muted', role: 'status', text: 'Rebuilding the puzzle from its seed...' });
  root.append(status);
  const disposers = [];
  const cleanup = () => disposers.splice(0).forEach((f) => { try { f(); } catch { /* ignore */ } });

  let built = await rebuild(game, ref);
  if (built.reason === 'slow') {
    status.replaceChildren('This freshly generated expert puzzle was recorded before compact storage existed and takes several seconds to rebuild. ',
      el('button', {
        type: 'button', class: 'btn btn-small',
        onclick: async () => {
          status.textContent = 'Rebuilding, please wait...';
          await new Promise((r) => setTimeout(r, 30));
          built = await rebuild(game, ref, { allowSlow: true });
          render();
        },
      }, 'Rebuild it now'));
    return cleanup;
  }
  render();
  return cleanup;

  function render() {
    cleanup();
    const puzzle = built.puzzle;
    if (!puzzle) {
      status.textContent = `This puzzle cannot be rebuilt (${built.reason ?? 'unknown'}). Its notes and history are kept.`;
      return;
    }
    const retry = peekRetry(game);
    const done = retry && retry.attemptId === attemptId && retry.doneAttemptId ? ctx.recorder.attempts({ id: retry.doneAttemptId })[0] ?? null : null;
    if (done && item) setRevealed(item.id, false);
    let mode = done ? 'compare' : query.get('mode') || 'retry';
    const body = el('div', {});
    const modeBtns = ['retry', 'compare', 'watch'].map((m) => el('button', {
      type: 'button', class: 'btn', 'aria-pressed': 'false',
      onclick: () => {
        if (m !== 'retry' && item && !done) setRevealed(item.id, true);
        mode = m;
        draw();
      },
    }, { retry: 'Retry first', compare: 'Compare', watch: 'Watch the optimal line' }[m]));

    const meta = el('section', { class: 'replay-meta', 'aria-label': 'Original puzzle' },
      el('h1', { text: `${gameName(game)}: set ${attempt.set}, ${attempt.puzzleId}` }),
      el('p', {}, `${fmtDate(attempt.startedAt)}, ${attempt.mode === 'exam' ? 'timed run' : 'practice'}. Original result: ${attempt.outcome === 'solved' ? `solved at ${pctText(attempt.metrics?.efficiency)} efficiency` : attempt.outcome === 'timeout' ? 'time ran out' : 'skipped or wrong'}.`),
      el('p', { class: 'small' }, el('strong', { text: 'Puzzle features: ' }), safe(() => ad.features(puzzle).join(', '), 'unknown')),
      built.stale ? el('p', { class: 'callout callout-warn', text: 'The puzzle generator changed since this was recorded: the rebuilt puzzle differs from the one you played. Treat it as a fresh puzzle of the same kind.' }) : null);

    function draw() {
      cleanup();
      modeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['retry', 'compare', 'watch'][i] === mode)));
      const revealed = item ? revealedSet().has(item.id) : false;
      if (mode === 'retry') {
        body.replaceChildren(el('section', { class: 'replay-retry' },
          el('h2', { text: 'Retry first' }),
          el('p', { text: 'Solve the puzzle again before looking at any solution: recalling it yourself fixes the lesson better than re-reading. It opens in the game\'s practice view and comes back here to compare.' }),
          revealed ? el('p', { class: 'callout', text: 'You have already looked at the solution for this entry, so this retry will not count as a retry-first solve.' }) : null,
          el('button', {
            type: 'button', class: 'btn btn-primary',
            onclick: () => {
              setRetry({ game, itemId: item?.id ?? null, attemptId, puzzle, set: attempt.set, revealed, returnHash: `#/review/${game}/${encodeURIComponent(attemptId)}${query.get('from') === 'today' ? '?from=today' : ''}` });
              location.hash = `#/${game}/retry`;
            },
          }, 'Start the retry'),
          item ? null : el('p', { class: 'muted small', text: 'This attempt is not in your notebook, so the retry will not be scheduled.' })));
        return;
      }
      if (mode === 'watch') {
        body.replaceChildren(el('section', { class: 'replay-watch' }, el('h2', { text: 'Watch the optimal line' }),
          safe(() => WALK[game](puzzle, attempt, (f) => disposers.push(f)), el('p', { class: 'notice', text: 'The walkthrough could not be drawn.' }))));
        return;
      }
      const div = safe(() => ad.divergence(attempt, puzzle), null);
      const panes = [
        stepList('Your moves (original attempt)', safe(() => ad.userPath(attempt, puzzle), []), { divergence: div, id: 'pane-yours' }),
      ];
      if (done) panes.push(stepList('Your retry', safe(() => ad.userPath(done, puzzle), []), { divergence: safe(() => ad.divergence(done, puzzle), null), id: 'pane-retry' }));
      panes.push(stepList('Optimal walkthrough', safe(() => ad.optimalSteps(puzzle), []).map((t) => ({ text: t, ok: null })), { id: 'pane-optimal' }));
      body.replaceChildren(...[
        done ? el('p', { class: `callout ${retry.result === 'pass' ? 'callout-ok' : ''}`, role: 'status' },
          el('strong', { text: `Retry ${correctFor(game)(done) ? 'solved' : 'not solved'}${done.outcome === 'solved' ? ` at ${pctText(done.metrics?.efficiency)} efficiency` : ''}. ` }),
          RESULT_TEXT[retry.result] ?? '') : null,
        div ? el('p', { class: 'callout callout-warn' }, el('strong', { text: 'Divergence point. ' }), div.text) : el('p', { class: 'callout callout-ok', text: 'Your original attempt never left the optimal path.' }),
        el('div', { class: 'replay-panes' }, ...panes),
      ].filter(Boolean));
    }

    const extras = item ? el('section', { class: 'replay-item', 'aria-label': 'Notebook entry' },
      el('h2', { class: 'section-title', text: 'Notebook entry' }),
      el('p', { class: 'muted small' }, `Interval ${item.interval} ${item.interval === 1 ? 'day' : 'days'}, next due ${fmtDate(ctx.store.item(item.id)?.dueAt ?? item.dueAt)}, ease ${item.ease}${isMastered(item) ? ', mastered' : ''}.`),
      noteEditor(ctx.store.item(item.id) ?? item, ctx.store),
      tagEditor(item, ctx.store),
      item.history.length ? el('details', {}, el('summary', {}, `Review history (${item.history.length})`),
        el('ul', {}, item.history.map((h) => el('li', { text: `${fmtDate(h.t)}: ${h.result}${h.retryFirst ? ', retry first' : ''}` })))) : null) : null;

    status.remove();
    root.append(meta, el('div', { class: 'mode-switch', role: 'group', 'aria-label': 'Replay mode' }, modeBtns), body, extras);
    draw();
  }
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch (err) {
    console.error(err);
    return fallback;
  }
}
