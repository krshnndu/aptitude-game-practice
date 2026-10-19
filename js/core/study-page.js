// Study mode (#/study/<game>/<set>): browse a set's puzzles with the optimal solution walkthrough.
// No timer, nothing scored or recorded. Also the run review page (#/review/<game>/run/<runId> and
// #/review/<game>/practice/<set>): score so far, takeaways, did vs should per attempted puzzle and
// the not attempted remainder, for runs ended early or left when the page closed.

import { el } from './dom.js';
import { isGame, gameName } from './games.js';
import { ADAPTERS, loadSetData, rebuild } from './learn-registry.js';
import { loadContext, unknownGame, gameTabs, fmtDate } from './learn-ui.js';
import { learnStore } from './learn-hooks.js';
import { dvsPanel } from './dvs-ui.js';
import { ev } from './board.js';
import { partialBanner, takeawaysPanel, notAttemptedSection, sessionStart, resume } from './endrun-ui.js';
import { isPartial } from './partial.js';
import { makerPrompt } from './maker.js';
import { studyWalkthrough as bsStudy } from '../games/blockslide/play.js';
import { studyWalkthrough as lsStudy } from '../games/latinsquare/play.js';
import { studyWalkthrough as gmStudy } from '../games/gridmemory/play.js';
import { studyWalkthrough as osStudy } from '../games/operatorswitch/play.js';
import { studyWalkthrough as deStudy } from '../games/digitequation/play.js';
import { studyWalkthrough as prStudy } from '../games/patternrule/play.js';

export const STUDY = { blockslide: bsStudy, latinsquare: lsStudy, gridmemory: gmStudy, operatorswitch: osStudy, digitequation: deStudy, patternrule: prStudy };
const LABEL = { gridmemory: 'trial' };
const SETS = [1, 2, 3, 4, 5];

function disposerList() {
  const list = [];
  return { add: (f) => list.push(f), run: () => list.splice(0).forEach((f) => { try { f(); } catch { /* ignore */ } }) };
}

function lazySolution(game, puzzle, add, summary) {
  const det = el('details', { class: 'study-item' }, el('summary', {}, summary));
  det.addEventListener('toggle', () => {
    if (!det.open || det.dataset.built) return;
    det.dataset.built = '1';
    try {
      det.append(STUDY[game](puzzle, add));
    } catch (err) {
      console.error(err);
      det.append(el('p', { class: 'notice', text: 'The solution could not be drawn.' }));
    }
  });
  return det;
}

export async function mountStudy(main, rest) {
  const [game, setRaw] = rest;
  if (!isGame(game)) {
    unknownGame(main, 'study');
    return () => {};
  }
  // Extra sets an adapter declares (Grid Memory circles 6..10) follow the standard five.
  const extra = ADAPTERS[game]?.EXTRA_SETS ?? [];
  const sets = [...SETS.map((k) => ({ set: k, label: `Set ${k}` })), ...extra];
  const set = sets.some((x) => x.set === Number(setRaw)) ? Number(setRaw) : 1;
  const setLabel = sets.find((x) => x.set === set).label;
  const d = disposerList();
  const root = el('div', { class: 'learn study' });
  main.append(root);
  ev('feat', game, { name: 'study_open', src: 'page', set });
  const label = LABEL[game] ?? 'puzzle';
  root.append(
    el('div', { class: 'page-head' },
      el('p', { class: 'crumbs' }, el('a', { href: `#/${game}` }, gameName(game)), ' / Study mode'),
      el('h1', { text: `${gameName(game)}: study mode, ${setLabel.toLowerCase()}` }),
      el('p', { class: 'lede', text: `Browse every ${label} in the set with its optimal solution walkthrough. No timer, nothing is scored or saved. Try to solve each one in your head before you open it.` })),
    gameTabs(game, (g) => `#/study/${g}/${set}`, 'Study mode by game'),
    el('div', { class: 'toolbar', role: 'group', 'aria-label': 'Sets' },
      sets.map(({ set: k, label: text }) => el('a', { class: `btn btn-small${k === set ? ' btn-primary' : ''}`, href: `#/study/${game}/${k}`, 'aria-current': k === set ? 'page' : null }, text)),
      el('a', { class: 'btn btn-small', href: `#/report/${game}` }, 'Strategy sheet')),
  );
  const list = el('div', { class: 'study-list' }, el('p', { class: 'muted', text: 'Loading the set...' }));
  root.append(list);
  try {
    const data = await loadSetData(game, set);
    const items = data.puzzles.map((p, i) => lazySolution(game, p, d.add, `${label[0].toUpperCase()}${label.slice(1)} ${i + 1}: show the worked solution`));
    list.replaceChildren(...items);
    // Done message once the last solution is opened, with at most one governed Termly line under it.
    const last = items[items.length - 1];
    last?.addEventListener('toggle', () => {
      if (!last.open || root.querySelector('.study-done')) return;
      root.append(el('p', { class: 'study-done', role: 'status', text: `End of set ${set}. You have reached the last ${label}.` }),
        makerPrompt('review_done', game, 'Going through placements? Termly plans your term') ?? '');
    });
  } catch (err) {
    list.replaceChildren(el('p', { class: 'notice', text: `Could not load set ${set}: ${err.message}` }));
  }
  return d.run;
}

// ---------------------------------------------------------------- run and practice session review

export async function mountRunReview(main, game, kind, id) {
  const ctx = loadContext({ sync: false });
  const ad = ADAPTERS[game];
  const d = disposerList();
  const root = el('div', { class: 'learn run-review' });
  main.append(root);
  const label = LABEL[game] ?? 'puzzle';
  root.append(el('p', { class: 'crumbs' }, el('a', { href: `#/review/${game}` }, `${gameName(game)} review library`), kind === 'run' ? ' / Run review' : ' / Practice review'));

  let run = null;
  let attempts;
  let set;
  if (kind === 'run') {
    run = ctx.recorder.runs({ id })[0] ?? null;
    if (!run) {
      root.append(el('p', { class: 'notice', text: 'This run is no longer in your play history.' }));
      return d.run;
    }
    set = run.set;
    attempts = ctx.recorder.attempts({ runId: id });
  } else {
    set = Number(id);
    const since = sessionStart();
    attempts = ctx.recorder.attempts({ game, set, mode: 'practice' }).filter((a) => a.startedAt >= since);
    if (!attempts.length) attempts = ctx.recorder.attempts({ game, set, mode: 'practice' }).slice(-10);
  }
  attempts.sort((a, b) => a.startedAt - b.startedAt);
  ev('review_open', 'review', { game, kind: kind === 'run' ? 'run' : 'practice_session', part: run && isPartial(run) ? 1 : 0 });
  // Opening the review answers the resume slot for this run.
  if (run) resume().clear(game, 'run');

  const tags = learnStore().load().tags ?? {};
  root.append(
    el('h1', { text: kind === 'run' ? `${gameName(game)}: timed test review, set ${set}` : `${gameName(game)}: practice review, set ${set}` }),
    run ? el('p', { class: 'muted' }, `${fmtDate(run.startedAt)}. ${isPartial(run) ? 'Ended early.' : 'Ran the full clock.'}`) : el('p', { class: 'muted', text: `${attempts.length} practice ${label}s ${attempts.length === 1 ? 'attempt' : 'attempts'} in this session.` }),
    run ? (partialBanner(run, { label }) ?? el('div', { class: 'score-tiles' },
      el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Run score' }), el('strong', { text: run.score.toFixed(2) })),
      el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Solved' }), el('strong', { text: `${run.solved} of ${run.attempted}` })))) : null,
    attempts.length ? takeawaysPanel({ game, attempts, tagLists: attempts.map((a) => tags[a.id] ?? []), label, seed: run?.seed ?? set }) : el('p', { class: 'callout', text: 'No attempts were recorded here yet.' }),
  );

  const items = el('section', { class: 'dvs-run', 'aria-label': 'Did vs should per item' },
    el('h3', { class: 'section-title', text: 'Did vs should, item by item' }));
  attempts.forEach((a, i) => {
    const det = el('details', { class: 'dvs-item' },
      el('summary', {}, `${label[0].toUpperCase()}${label.slice(1)} ${i + 1} (${a.puzzleId}): ${a.outcome === 'solved' ? 'solved' : a.outcome === 'timeout' ? 'unfinished' : 'not solved'}`));
    det.addEventListener('toggle', async () => {
      if (!det.open || det.dataset.built) return;
      det.dataset.built = '1';
      const status = el('p', { class: 'muted', text: 'Rebuilding the puzzle...' });
      det.append(status);
      const built = await rebuild(game, ad.refFor(a, null, { run })).catch(() => ({ puzzle: null }));
      status.replaceWith(built.puzzle
        ? (dvsPanel(game, a, built.puzzle, { title: `${label[0].toUpperCase()}${label.slice(1)} ${i + 1}: did vs should` }) ?? el('p', { class: 'muted', text: 'No did vs should for this item.' }))
        : el('p', { class: 'muted', text: 'This puzzle cannot be rebuilt here.' }),
      el('p', {}, el('a', { class: 'btn btn-small', href: `#/review/${game}/${encodeURIComponent(a.id)}` }, 'Open the full replay')));
    });
    if (a.outcome !== 'solved' && i < 3) det.open = true;
    items.append(det);
  });
  if (attempts.length) root.append(items);
  for (const det of items.querySelectorAll('details[open]')) det.dispatchEvent(new Event('toggle'));

  try {
    const pool = (await loadSetData(game, set)).puzzles;
    const extra = notAttemptedSection({ game, pool, attemptedIds: attempts.map((a) => a.puzzleId), solve: STUDY[game], onDispose: d.add, label, set });
    if (extra && (kind !== 'run' || isPartial(run))) root.append(extra);
  } catch {
    // the set file is not reachable: the not attempted list is optional
  }
  root.append(el('div', { class: 'after-actions' },
    el('a', { class: 'btn btn-primary', href: kind === 'run' ? `#/${game}/run/${set}` : `#/${game}/practice/${set}/1` }, kind === 'run' ? 'Start a new run' : 'Practice again'),
    el('a', { class: 'btn', href: `#/study/${game}/${set}` }, 'Study mode'),
    el('a', { class: 'btn', href: `#/review/${game}` }, 'Review notebook')));
  return d.run;
}
