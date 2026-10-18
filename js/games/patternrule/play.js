// Pattern Rule UI: set menu, practice, pre-run tutorial, timed test, coach and the
// worked explanation. Game rules live in state.js, reasons in explain.js, coaching in coach.js;
// this file only renders and wires input. Every attempt is logged through the core recorder.

import { el } from '../../core/dom.js';
import { gameStart, setActions, setListHead, lockedHint, lockedPage, progressLine, unlockToggle, trackModes } from '../../core/start-ui.js';
import { runExtras } from '../../core/board.js';
import { Countdown, formatClock } from '../../core/timer.js';
import { createStore } from '../../core/store.js';
import { createRecorder, summarizeRun, newId } from '../../core/recorder.js';
import { averageEfficiency, pct, round2, UNLOCK_THRESHOLD } from '../../core/score.js';
import { GAME_ID, letter, createSession, createPickLog, attemptResult, attemptPicks } from './state.js';
import { explainPuzzle, resultSummary, pickMarks, MARK_TEXT, STRATEGY } from './explain.js';
import { SET_CONFIGS, PUZZLES_PER_SET } from './gen.js';
import { createRunStream, freshSource, tutorialPuzzle } from './stream.js';
import { coachPuzzle, coachRun } from './coach.js';
import { noteAttempt, noteRun, trackExplain, peekRetry, completeRetry, stampDvs } from '../../core/learn-hooks.js';
import { dvsPanel, dvsRunSection } from '../../core/dvs-ui.js';
import { endButton, guardRun, saveEndedRun, isLeave, isPartial, partialBanner, runLearning, studyLink, resume } from '../../core/endrun-ui.js';
import { panelSvg, shapeIcon } from './render.js';
import { describePanel, TYPES, TYPE_NAMES, FILLS, FILL_NAMES } from './rules.js';

const RUN_MS = 6 * 60 * 1000;
const TICK = String.fromCharCode(0x2713);
const CROSS = String.fromCharCode(0x2717);
const BASE = '#/patternrule';

const store = createStore();
const recorder = createRecorder();
const setCache = new Map();

function ensureCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-patternrule-css]')) return;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('../../../css/patternrule.css', import.meta.url).href, 'data-patternrule-css': 'true' }));
}

function loadSet(setNo) {
  if (!setCache.has(setNo)) {
    const url = new URL(`../../../data/sets/patternrule/set${setNo}.json`, import.meta.url);
    setCache.set(setNo, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`could not load set ${setNo} (${r.status})`);
      return r.json();
    }));
  }
  return setCache.get(setNo).catch((err) => {
    setCache.delete(setNo);
    throw err;
  });
}

const puzzleId = (setNo, k) => `pr${setNo}-${String(k).padStart(2, '0')}`;
const isUnlocked = (setNo) => store.isUnlocked(GAME_ID, setNo, PUZZLES_PER_SET);
const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtSec = (ms) => (ms === null || ms === undefined ? 'none' : `${(ms / 1000).toFixed(1)} s`);
const letters = (xs) => (xs.length ? xs.map(letter).join(', ') : 'none');

// ---------------------------------------------------------------- shared pieces

function shapeKey() {
  return el('details', { class: 'pr-key' },
    el('summary', {}, 'Shape key'),
    el('div', { class: 'pr-key-body' },
      el('ul', { class: 'pr-key-list', role: 'list', 'aria-label': 'Shape types' },
        TYPES.map((t) => el('li', {}, shapeIcon({ t, f: 'outline' }), el('span', { text: TYPE_NAMES[t] })))),
      el('ul', { class: 'pr-key-list', role: 'list', 'aria-label': 'Fills' },
        FILLS.map((f) => el('li', {}, shapeIcon({ t: 'drop', f }), el('span', { text: FILL_NAMES[f] })))),
      el('ul', { class: 'pr-key-list', role: 'list', 'aria-label': 'Size and direction' },
        el('li', {}, shapeIcon({ t: 'arrow', f: 'solid', k: 1 }), el('span', { text: 'large, points up' })),
        el('li', {}, shapeIcon({ t: 'arrow', f: 'solid', k: 0.58, d: 'R' }), el('span', { text: 'small, points right' }))),
      el('p', { class: 'muted small', text: 'Every shape points somewhere: the tip of a triangle, half-disc (curved side), arrow or drop. Each panel is a 3 x 3 grid; rows are top, middle, bottom and columns left, centre, right.' }),
    ),
  );
}

function wordsView(puzzle) {
  const item = (label, p) => el('li', {}, el('strong', { text: `${label}: ` }), describePanel(p));
  return el('details', { class: 'pr-words' },
    el('summary', {}, 'Describe the panels in words'),
    el('ul', {},
      puzzle.fits.map((p, i) => item(`Fits ${i + 1}`, p)),
      puzzle.counters.map((p, i) => item(`Does not fit ${i + 1}`, p)),
      puzzle.candidates.map((p, i) => item(`Candidate ${letter(i)}`, p)),
    ),
  );
}

function exampleFigure(panel, kind, k) {
  const label = kind === 'fit' ? `Fits ${k}` : `Does not fit ${k}`;
  return el('li', { class: `pr-panel pr-${kind}` },
    el('figure', {},
      panelSvg(panel, { label }),
      el('figcaption', {}, el('span', { class: 'pr-mark', 'aria-hidden': 'true', text: kind === 'fit' ? TICK : CROSS }), ` ${label}`),
    ),
  );
}

// ---------------------------------------------------------------- one puzzle

// opts: { mode: 'practice'|'exam'|'sample', log, onAnswer(session), onSkip(session) }
// Exam and sample modes have no hints; their Submit and Skip buttons are returned in hudItems
// for the caller to place next to the clock.
function createBoard(puzzle, opts) {
  const exam = opts.mode !== 'practice';
  const log = opts.log ?? null;
  const session = createSession(puzzle, { mode: exam ? 'exam' : 'practice' });
  const n = puzzle.candidates.length;
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' });
  const message = el('p', { class: 'play-message', role: 'status' });
  const hintList = el('ul', { class: 'pr-hints' });
  const pickedOut = el('strong', { class: 'stat-value', text: '0' });

  const states = [];
  const candButtons = puzzle.candidates.map((p, i) => {
    const state = el('span', { class: 'pr-state', 'aria-hidden': 'true' });
    states.push(state);
    const svgNode = panelSvg(p);
    svgNode.setAttribute('aria-hidden', 'true');
    return el('button', {
      type: 'button',
      class: 'pr-cand',
      'aria-pressed': 'false',
      'aria-label': `Candidate ${letter(i)}. ${describePanel(p)}`,
      onclick: () => toggle(i),
    }, el('span', { class: 'pr-letter', 'aria-hidden': 'true', text: letter(i) }), svgNode, state);
  });

  const submitBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => submit() }, exam ? 'Submit' : 'Check answer');
  const clearBtn = el('button', { type: 'button', class: 'btn', onclick: () => clearAll() }, 'Clear');
  const hintBtn = exam ? null : el('button', { type: 'button', class: 'btn', onclick: () => hint() }, 'Hint');
  const skipBtn = el('button', { type: 'button', class: 'btn btn-warn', onclick: () => skip() }, exam ? 'Skip' : 'Skip and show answer');
  const pickedStat = el('span', { class: 'stat' }, 'Selected ', pickedOut);

  const root = el('div', { class: `pr-board${exam ? ' is-exam' : ''}` },
    el('section', { class: 'pr-examples', 'aria-label': 'Example panels' },
      el('div', { class: 'pr-group' },
        el('h2', { class: 'pr-group-title' }, el('span', { class: 'pr-mark', 'aria-hidden': 'true', text: TICK }), ' Fit the rule'),
        el('ul', { class: 'pr-row', role: 'list' }, puzzle.fits.map((p, i) => exampleFigure(p, 'fit', i + 1)))),
      el('div', { class: 'pr-group is-not' },
        el('h2', { class: 'pr-group-title' }, el('span', { class: 'pr-mark', 'aria-hidden': 'true', text: CROSS }), ' Do not fit'),
        el('ul', { class: 'pr-row', role: 'list' }, puzzle.counters.map((p, i) => exampleFigure(p, 'not', i + 1)))),
    ),
    el('section', { class: 'pr-question', 'aria-label': 'Candidates' },
      el('h2', { class: 'pr-group-title', text: 'Select every candidate that fits the rule' }),
      el('p', { class: 'muted small', text: `At least one fits and at least one does not. Keys: ${letter(0)} to ${letter(n - 1)} select, Enter ${exam ? 'submits' : 'checks'} when no button has focus${exam ? '' : ', H hint'}.` }),
      el('div', { class: 'pr-cands', role: 'group', 'aria-label': 'Candidates' }, candButtons),
      exam ? null : el('div', { class: 'pr-controls' }, pickedStat, submitBtn, clearBtn, hintBtn, skipBtn),
      exam ? el('div', { class: 'pr-controls' }, clearBtn) : null,
      message,
      hintList,
      live,
    ),
    wordsView(puzzle),
  );

  function say(text) {
    live.textContent = '';
    requestAnimationFrame(() => (live.textContent = text));
  }

  function render() {
    const playing = session.status === 'playing';
    const ruled = new Set(session.ruledOut);
    candButtons.forEach((b, i) => {
      const on = session.isPicked(i);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('is-picked', on);
      b.classList.toggle('is-ruled-out', ruled.has(i));
      if (playing) states[i].textContent = on ? `${TICK} Selected` : ruled.has(i) ? 'Hint: does not fit' : '';
      b.disabled = !playing;
    });
    pickedOut.textContent = String(session.picks.length);
    submitBtn.disabled = !session.canSubmit();
    clearBtn.disabled = !playing || !session.picks.length;
    skipBtn.disabled = !playing;
    if (hintBtn) hintBtn.disabled = !playing;
  }

  function toggle(i) {
    const on = session.toggle(i);
    if (on === null) return;
    log?.toggle(i, on);
    message.textContent = '';
    render();
    say(`Candidate ${letter(i)} ${on ? 'selected' : 'unselected'}. ${session.picks.length} selected.`);
  }

  function clearAll() {
    for (const i of session.clear()) log?.toggle(i, false);
    render();
    say('Selection cleared.');
  }

  function submit() {
    if (!session.canSubmit()) {
      message.textContent = 'Select at least one candidate first.';
      say(message.textContent);
      return;
    }
    session.submit();
    render();
    opts.onAnswer?.(session);
  }

  function skip() {
    if (!session.skip()) return;
    render();
    opts.onSkip?.(session);
  }

  function hint() {
    const h = session.hint();
    if (!h) {
      message.textContent = 'No more hints. Check your answer to see the rule and the reasons.';
      say(message.textContent);
      return;
    }
    log?.hint();
    hintList.append(el('li', {}, el('strong', { text: `Hint ${session.hintsUsed}: ` }), h.text));
    message.textContent = '';
    render();
    say(h.text);
  }

  // After an answer: mark every candidate with its outcome (text and border style, not colour alone).
  function showMarks() {
    const marks = pickMarks(puzzle, session.picks);
    candButtons.forEach((b, i) => {
      b.classList.add(`mark-${marks[i]}`);
      const icon = marks[i] === 'hit' || marks[i] === 'miss' ? TICK : CROSS;
      states[i].textContent = `${icon} ${MARK_TEXT[marks[i]]}`;
      b.setAttribute('aria-label', `Candidate ${letter(i)}: ${MARK_TEXT[marks[i]]}. ${describePanel(puzzle.candidates[i])}`);
    });
  }

  function onKey(e) {
    if (session.status !== 'playing' || e.altKey || e.metaKey || e.ctrlKey) return;
    const active = document.activeElement;
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return;
    const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const idx = k.length === 1 ? k.charCodeAt(0) - 65 : -1;
    if (idx >= 0 && idx < n) {
      e.preventDefault();
      toggle(idx);
    } else if (k === 'Enter' && !(active && /^(BUTTON|A|SUMMARY)$/.test(active.tagName))) {
      e.preventDefault();
      submit();
    } else if (k === 'H' && hintBtn) hint();
  }
  document.addEventListener('keydown', onKey);

  render();
  return {
    root,
    session,
    hudItems: exam ? [pickedStat, submitBtn, skipBtn] : [],
    showMarks,
    focus() {
      candButtons[0]?.focus({ preventScroll: true });
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
}

// ---------------------------------------------------------------- explanation and coach

const VERDICT_BADGE = { rule: ['badge-ok', 'Part of the rule'], shared: ['badge-mid', 'Shared, not the rule'], varies: ['badge-soon', 'Varies: cross off'] };

// outcome null: study mode, nothing was played so there is no result line.
function createExplainPanel(puzzle, outcome, attempt = null) {
  const ex = explainPuzzle(puzzle);
  const marks = outcome?.picks ? pickMarks(puzzle, outcome.picks) : null;
  const status = outcome?.status;
  const exact = status === 'answered' && outcome.exact;
  const badge = status === 'skipped' ? ['badge-warn', 'Skipped'] : status === 'timeout' ? ['badge-warn', 'Time up'] : exact ? ['badge-ok', 'Correct'] : ['badge-warn', 'Not quite'];
  return el('section', { class: 'explain pr-explain', 'aria-label': 'How to solve it' },
    outcome ? el('div', { class: 'result-line' },
      el('span', { class: `badge ${badge[0]}`, text: badge[1] }),
      el('p', { text: resultSummary({ status, exact, falsePicks: outcome.falsePicks ?? [], misses: outcome.misses ?? [] }, puzzle) }),
    ) : el('p', { class: 'muted', text: `Answer: ${letters(puzzle.answer)}.` }),
    attempt ? dvsPanel(GAME_ID, attempt, puzzle) : null,
    el('h3', { text: 'The rule' }),
    el('p', { class: 'pr-rule', text: ex.rule }),
    el('h3', { text: 'How to find it' }),
    el('ol', { class: 'pr-steps' }, ex.steps.map((s) => el('li', { text: s }))),
    el('h4', { text: 'Dimension scan: one dimension at a time' }),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'results pr-scan' },
        el('caption', { class: 'sr-only', text: 'What the fitting panels show on each dimension' }),
        el('thead', {}, el('tr', {}, ['Dimension', 'Verdict', 'Why'].map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, ex.scan.map((r) => el('tr', { class: `verdict-${r.verdict}` },
          el('th', { scope: 'row', text: r.name }),
          el('td', {}, el('span', { class: `badge ${VERDICT_BADGE[r.verdict][0]}`, text: VERDICT_BADGE[r.verdict][1] })),
          el('td', { text: r.text })))),
      ),
    ),
    el('h3', { text: 'Every candidate' }),
    el('ul', { class: 'pr-verdicts', role: 'list' }, ex.verdicts.map((v) => {
      const mark = marks ? marks[v.index] : null;
      const svgNode = panelSvg(puzzle.candidates[v.index], { label: `Candidate ${v.letter}` });
      return el('li', { class: `pr-verdict ${v.fits ? 'is-fit' : 'is-not'}${mark ? ` mark-${mark}` : ''}` },
        el('div', { class: 'pr-verdict-fig' }, el('span', { class: 'pr-letter', text: v.letter }), svgNode),
        el('div', {},
          el('p', { class: 'pr-verdict-head' },
            el('span', { class: 'pr-mark', 'aria-hidden': 'true', text: v.fits ? TICK : CROSS }),
            el('strong', { text: v.fits ? ' Fits' : ' Does not fit' }),
            mark ? el('span', { class: 'pr-your', text: ` (you: ${MARK_TEXT[mark].toLowerCase()})` }) : null),
          el('p', { text: v.summary }),
          v.fits ? null : el('p', { class: 'muted small', text: `Breaks: ${v.broken.join(', ')}` })),
      );
    })),
    el('details', { class: 'strategy', open: true },
      el('summary', {}, 'Strategy: isolate one dimension at a time'),
      el('ul', {}, STRATEGY.map((s) => el('li', { text: s })))),
  );
}

const KIND_BADGE = { fix: ['badge-warn', 'Fix'], good: ['badge-ok', 'Good'], info: ['badge-soon', 'Note'] };

function findingItem(f) {
  const [cls, word] = KIND_BADGE[f.kind] ?? KIND_BADGE.info;
  return el('li', { class: `finding finding-${f.kind}` },
    el('span', { class: `badge ${cls}`, text: word }),
    el('div', {},
      el('p', { class: 'finding-title' }, el('strong', { text: f.title })),
      el('p', { class: 'finding-detail', text: f.detail }),
      f.tip ? el('p', { class: 'finding-tip' }, el('strong', { text: 'Try: ' }), f.tip) : null,
    ),
  );
}

function coachPanel(attempt, puzzle, paceSec) {
  const m = attempt.metrics;
  const toggles = (attempt.events || []).filter((e) => e.type === 'move');
  const cells = [
    ['Time', fmtSec(m.totalMs)],
    ['First pick', fmtSec(m.firstMoveMs)],
    ['Your picks', letters(attemptPicks(attempt))],
    ['Answer', letters(puzzle.answer)],
    ['Picks taken back', String(toggles.filter((e) => e.d === 'off').length)],
  ];
  if (attempt.hintsUsed) cells.push(['Hints', String(attempt.hintsUsed)]);
  let list;
  try {
    const res = coachPuzzle(attempt, puzzle, { history: recorder.attempts({ game: GAME_ID, set: attempt.set }), paceSec });
    noteAttempt(GAME_ID, attempt, res.findings, puzzle);
    list = el('ul', { class: 'findings', role: 'list' }, res.findings.map(findingItem));
  } catch (err) {
    console.error(err);
    list = el('p', { class: 'muted', text: 'The coach could not review this attempt.' });
  }
  return el('section', { class: 'coach', 'aria-label': 'Coach' },
    el('h3', { text: 'Coach' }),
    el('dl', { class: 'metric-strip' }, cells.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v })))),
    list,
  );
}

function outcomeOf(session) {
  const r = session.result ?? {};
  return { status: session.status, exact: !!r.exact, picks: session.picks, falsePicks: r.falsePicks ?? [], misses: r.misses ?? [] };
}

// ---------------------------------------------------------------- menu

function renderMenu(ctx) {
  const { root } = ctx;
  trackModes(root, GAME_ID);
  root.append(
    gameStart({
      game: GAME_ID,
      idOf: puzzleId,
      lede: 'Spot the rule that separates the panels that fit from those that do not.',
      rules: [el('p', {}, 'Some panels follow a hidden rule and some do not. Work out the rule, then select every candidate that follows it. ',
        'A rule is one feature, or two features together: number of shapes, shape type, fill, direction, size, position, mirror symmetry, or how two shapes relate.'),
      shapeKey()],
      practiceText: 'One puzzle, no clock, with hints. After you answer, every candidate is marked, the rule is named, and a feature by feature scan shows how to find it.',
      timedText: '6 minutes on the clock and puzzles keep coming. No hints, no feedback until the end, and a skipped puzzle never comes back. Each exactly right answer scores 1.',
      setName: (s) => `Set ${s}: ${SET_CONFIGS[s - 1].name}`,
    }),
    setListHead(),
    el('div', { class: 'toolbar' },
      unlockToggle('pr-unlock-all', ctx.rerender),
      el('a', { class: 'btn', href: '#/analytics' }, 'My progress'),
      el('button', {
        type: 'button',
        class: 'btn btn-quiet',
        onclick: () => {
          if (confirm('Clear saved scores and unlocks in this browser? This clears progress for every game here. (Your play history stays; clear it on the analytics page.)')) {
            store.reset();
            ctx.rerender();
          }
        },
      }, 'Clear my progress'),
    ),
    el('ol', { class: 'set-list', role: 'list' }, SET_CONFIGS.map(setCard)),
  );
}

function setCard(cfg) {
  const open = isUnlocked(cfg.set);
  const entry = store.getSet(GAME_ID, cfg.set);
  const practiceAvg = store.practiceAverage(GAME_ID, cfg.set, PUZZLES_PER_SET);
  const chips = [];
  for (let k = 1; k <= PUZZLES_PER_SET; k++) {
    const best = entry.practice[puzzleId(cfg.set, k)];
    const label = best === undefined ? `Puzzle ${k}, not played` : best >= 1 ? `Puzzle ${k}, solved` : `Puzzle ${k}, not solved yet`;
    chips.push(open
      ? el('a', { class: `chip${best >= 1 ? ' chip-perfect' : best !== undefined ? ' chip-done' : ''}`, href: `${BASE}/practice/${cfg.set}/${k}`, 'aria-label': label, title: label }, String(k))
      : el('span', { class: 'chip chip-locked', 'aria-hidden': 'true' }, String(k)));
  }
  return el('li', { class: `set-card${open ? '' : ' is-locked'}` },
    el('div', { class: 'card-head' },
      el('h2', {}, `Set ${cfg.set}: ${cfg.name}`),
      el('span', { class: `badge ${open ? 'badge-ok' : 'badge-soon'}`, text: open ? 'Open' : 'Locked' }),
    ),
    el('p', { class: 'set-meta' }, `${cfg.blurb} ${cfg.fits} fitting and ${cfg.counters} non-fitting ${cfg.counters === 1 ? 'example' : 'examples'}, ${cfg.candidates} candidates. Pace: about ${cfg.paceSec} s per puzzle.`),
    progressLine(entry, practiceAvg),
    open
      ? setActions({ game: GAME_ID, set: cfg.set, idOf: puzzleId, chips, unit: 'puzzle' })
      : lockedHint(cfg.set, 'puzzle'),
  );
}

function lockedNotice(root, setNo) {
  lockedPage(root, GAME_ID, setNo, 'puzzle');
}

// ---------------------------------------------------------------- practice

// retry: a puzzle handed over by the review library (any set or source), played blind.
async function renderPractice(ctx, setNo, k, retry = null) {
  const { root } = ctx;
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg || (!retry && !(k >= 1 && k <= PUZZLES_PER_SET))) {
    root.append(el('p', { class: 'notice' }, 'Unknown puzzle. ', el('a', { href: BASE }, 'Back to sets')));
    return;
  }
  if (!retry && !isUnlocked(setNo)) return lockedNotice(root, setNo);
  const puzzle = retry ? retry.puzzle : (await loadSet(setNo)).puzzles[k - 1];
  const after = el('div', { class: 'after' });
  const host = el('div', {});
  const nextHref = retry ? retry.returnHash : k < PUZZLES_PER_SET ? `${BASE}/practice/${setNo}/${k + 1}` : BASE;
  const nextLabel = retry ? 'Compare with the optimal solution' : k < PUZZLES_PER_SET ? 'Next puzzle' : 'Back to sets';
  let board = null;
  let curLog = null;

  // An unfinished puzzle with at least one action is saved as skipped (End and review, leaving).
  function saveUnfinished() {
    if (retry || !board || !curLog || curLog.ended || !curLog.events.length || board.session.status !== 'playing') return false;
    const attempt = curLog.end('skipped', { picks: board.session.picks, hintsUsed: board.session.hintsUsed });
    stampDvs(GAME_ID, attempt, puzzle);
    recorder.saveAttempt(attempt);
    noteAttempt(GAME_ID, attempt, [], puzzle);
    return true;
  }
  function leave() {
    if (saveUnfinished()) resume().save({ game: GAME_ID, kind: 'practice', set: setNo, k });
  }
  function endPractice() {
    saveUnfinished();
    resume().clear(GAME_ID, 'practice');
    location.hash = `#/review/${GAME_ID}/practice/${setNo}`;
  }

  function start() {
    board?.destroy();
    after.replaceChildren();
    const log = createPickLog({ set: setNo, puzzleId: puzzle.id, mode: 'practice', source: retry ? 'review' : 'pool', optimal: puzzle.answer.length });
    curLog = log;
    board = createBoard(puzzle, {
      mode: 'practice',
      log,
      onAnswer: (s) => finish(s, log),
      onSkip: (s) => finish(s, log),
    });
    host.replaceChildren(board.root);
  }

  function finish(session, log) {
    const out = outcomeOf(session);
    const result = session.status === 'skipped' ? 'skipped' : out.exact ? 'correct' : 'wrong';
    const attempt = log.end(result, { picks: session.picks, hintsUsed: session.hintsUsed });
    stampDvs(GAME_ID, attempt, puzzle);
    recorder.saveAttempt(attempt);
    resume().clear(GAME_ID, 'practice');
    if (retry) {
      // Retrieval first: grade and reschedule now, compare with the optimal solution on the review page.
      completeRetry(GAME_ID, attempt);
      after.replaceChildren(
        el('div', { class: 'after-actions' }, el('a', { class: 'btn btn-primary', href: nextHref }, nextLabel)),
        dvsPanel(GAME_ID, attempt, puzzle),
        coachPanel(attempt, puzzle, cfg.paceSec),
      );
      after.querySelector('.after-actions .btn-primary')?.focus({ preventScroll: true });
      return;
    }
    store.recordPractice(GAME_ID, setNo, puzzle.id, result === 'correct' ? 1 : 0);
    board.showMarks();
    after.replaceChildren(
      el('div', { class: 'after-actions' },
        el('button', { type: 'button', class: 'btn', onclick: () => start() }, 'Try again'),
        el('a', { class: 'btn btn-primary', href: nextHref }, nextLabel)),
      trackExplain(createExplainPanel(puzzle, out, attempt), attempt),
      coachPanel(attempt, puzzle, cfg.paceSec),
    );
    after.querySelector('.after-actions .btn-primary')?.focus({ preventScroll: true });
    after.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  root.append(
    el('div', { class: 'page-head play-head' },
      el('p', { class: 'crumbs' }, el('a', { href: BASE }, 'Pattern Rule'), ` / Set ${setNo}: ${cfg.name}`),
      el('h1', {}, retry ? 'Review: solve it again before you look' : `Practice: puzzle ${k} of ${PUZZLES_PER_SET}`),
      el('p', { class: 'muted' }, `Suggested pace: about ${cfg.paceSec} s. No clock in practice mode.`),
      retry ? null : el('div', { class: 'after-actions' }, endButton({ game: GAME_ID, practice: true, onEnd: endPractice }), studyLink(GAME_ID, setNo)),
    ),
    shapeKey(),
    host,
    after,
    el('div', { class: 'after-actions' },
      !retry && k > 1 ? el('a', { class: 'btn btn-quiet', href: `${BASE}/practice/${setNo}/${k - 1}` }, 'Previous puzzle') : null,
      el('a', { class: 'btn btn-quiet', href: nextHref }, retry ? 'Back to the review' : nextLabel)),
  );
  start();
  const unguard = guardRun({ onLeave: leave });
  ctx.onDispose(() => {
    unguard();
    leave();
    board?.destroy();
  });
}

// ---------------------------------------------------------------- timed test

function setExamChrome(on) {
  document.body.classList.toggle('exam-active', on);
}

async function renderRun(ctx, setNo) {
  const { root } = ctx;
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg) {
    root.append(el('p', { class: 'notice' }, 'Unknown set. ', el('a', { href: BASE }, 'Back to sets')));
    return;
  }
  if (!isUnlocked(setNo)) return lockedNotice(root, setNo);
  const data = await loadSet(setNo);

  const head = el('div', { class: 'page-head play-head' },
    el('p', { class: 'crumbs' }, el('a', { href: BASE }, 'Pattern Rule'), ` / Set ${setNo}: ${cfg.name}`),
    el('h1', {}, 'Timed test'));
  const body = el('div', {});
  root.append(head, body);

  let timer = null;
  let board = null;
  let sample = null;
  let finished = false;
  let stream = null;
  let current = null;
  let runSeed = 0;
  let runId = null;
  let startedAt = 0;
  let unguard = null;
  const results = [];
  ctx.onDispose(() => {
    timer?.stop();
    board?.destroy();
    sample?.destroy();
    setExamChrome(false);
  });

  // ---- pre-run screen with an untimed sample on the exam screen
  const atPace = Math.floor(RUN_MS / (cfg.paceSec * 1000));
  const startBtn = el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => begin() }, 'I am ready: start the 6:00 run');
  const sampleSlot = el('span', { class: 'hud-slot' });
  const sampleHud = el('div', { class: 'exam-hud is-tutorial' },
    el('span', { class: 'clock', 'aria-label': 'Time left (not running in the sample)' }, '6:00'),
    el('span', { class: 'run-progress', text: 'Sample' }), sampleSlot);
  const sampleMsg = el('p', { class: 'flash', role: 'status' });
  const sampleHost = el('div', {});
  let tut = null;
  function startSample() {
    sample?.destroy();
    sampleMsg.textContent = '';
    tut ??= tutorialPuzzle();
    sample = createBoard(tut, {
      mode: 'sample',
      onAnswer: (s) => {
        sample.showMarks();
        sampleMsg.textContent = s.result.exact
          ? `Correct: ${letters(tut.answer)}. That scores 1. The rule was: ${explainPuzzle(tut).rule}`
          : `Not quite: the answer is ${letters(tut.answer)}. The rule was: ${explainPuzzle(tut).rule} In the run you get no feedback until the end.`;
      },
      onSkip: () => {
        sampleMsg.textContent = 'Skipped. In the run, the next puzzle appears at once and this one never comes back.';
      },
    });
    sampleSlot.replaceChildren(...sample.hudItems);
    sampleHost.replaceChildren(sample.root);
  }
  body.append(el('section', { class: 'run-intro' },
    el('h2', { text: 'Before you start' }),
    el('ol', { class: 'exam-rules' },
      el('li', {}, el('strong', { text: '6:00 on the clock. ' }), 'Puzzles keep coming until time is up: this set\'s 10 in a shuffled order, then freshly generated puzzles of the same kind.'),
      el('li', {}, el('strong', { text: 'Find the rule. ' }), 'The top panels fit a hidden rule; the panels marked with a cross do not. Select every candidate that fits, then Submit.'),
      el('li', {}, el('strong', { text: 'No hints, no feedback. ' }), 'Answers are scored at the end, as in the real format.'),
      el('li', {}, el('strong', { text: 'Skip is final. ' }), 'A skipped puzzle scores 0 and never comes back.'),
      el('li', {}, el('strong', { text: 'Score: ' }), 'an exactly right selection scores 1; anything else scores 0. The run score is the sum.'),
      el('li', {}, el('strong', { text: 'Pace: ' }), `about ${cfg.paceSec} s per puzzle, so about ${atPace} puzzles in 6:00. A good skip rule: no shared feature after ${Math.round(cfg.paceSec / 2)} s, or ${2 * cfg.paceSec} s spent, means skip.`),
      el('li', {}, el('strong', { text: 'Afterwards: ' }), 'the coach reviews every puzzle and the whole run. End and review stops the run at any point and shows your score so far; leaving the page saves it the same way. Runs ended early count toward progress and review but not the leaderboard.'),
    ),
    el('h3', { text: 'Try the sample puzzle (untimed, not scored)' }),
    el('p', { class: 'muted', text: 'This is the exam screen: panels, clock, Submit and Skip.' }),
    sampleHud,
    sampleMsg,
    sampleHost,
    el('div', { class: 'after-actions' },
      el('button', { type: 'button', class: 'btn', onclick: () => startSample() }, 'Restart sample'),
      startBtn),
  ));
  startSample();
  startBtn.focus({ preventScroll: true });

  // ---- the run
  const clock = el('span', { class: 'clock', role: 'timer', 'aria-label': 'Time left' }, formatClock(RUN_MS));
  const progress = el('span', { class: 'run-progress' });
  const hudSlot = el('span', { class: 'hud-slot' });
  const announcer = el('p', { class: 'sr-only', 'aria-live': 'assertive' });
  const host = el('div', {});
  const flash = el('p', { class: 'flash', role: 'status' });
  const endBtn = endButton({ game: GAME_ID, onEnd: (exit) => finish(exit) });
  let warned60 = false;
  let warned10 = false;

  const buildRun = () => summarizeRun({ id: runId, game: GAME_ID, set: setNo, seed: runSeed, startedAt, endedAt: Date.now(), budgetMs: RUN_MS, attempts: results.map((r) => r.attempt) });
  // Tab hidden mid-run: keep a silent partial copy in case the browser never comes back.
  function checkpoint() {
    if (!finished && startedAt) saveEndedRun({ recorder, run: buildRun(), exit: 'hidden' });
  }

  function begin() {
    sample?.destroy();
    sample = null;
    setExamChrome(true);
    head.hidden = true;
    runSeed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    runId = newId('r');
    startedAt = Date.now();
    stream = createRunStream({ puzzles: data.puzzles, seed: runSeed, takeFresh: freshSource(setNo, runSeed) });
    unguard = guardRun({ onLeave: (exit) => finish(exit), onHide: checkpoint });
    // Registered after the page disposer, so it runs first: a route change mid-run saves it.
    ctx.onDispose(() => {
      if (!finished) finish('nav');
    });
    body.replaceChildren(el('div', { class: 'exam-hud' }, clock, progress, hudSlot, endBtn), flash, announcer, host);
    timer = new Countdown(RUN_MS, {
      onTick: (left) => {
        clock.textContent = formatClock(left);
        clock.classList.toggle('is-low', left <= 60_000);
        if (!warned60 && left <= 60_000) {
          warned60 = true;
          announcer.textContent = 'One minute left.';
        }
        if (!warned10 && left <= 10_000) {
          warned10 = true;
          announcer.textContent = 'Ten seconds left.';
        }
      },
      onEnd: () => finish(),
    });
    timer.start();
    showNext();
  }

  function showNext() {
    if (finished) return;
    board?.destroy();
    const { puzzle, source, index } = stream.next();
    const log = createPickLog({ set: setNo, puzzleId: puzzle.id, mode: 'exam', runId, source, optimal: puzzle.answer.length });
    current = { puzzle, source, index, log, done: false };
    board = createBoard(puzzle, {
      mode: 'exam',
      log,
      onAnswer: (s) => {
        record(s.result.exact ? 'correct' : 'wrong');
        flash.textContent = `Answer to puzzle ${index + 1} recorded.`;
        showNext();
      },
      onSkip: () => {
        record('skipped');
        flash.textContent = `Skipped puzzle ${index + 1}.`;
        showNext();
      },
    });
    hudSlot.replaceChildren(...board.hudItems);
    host.replaceChildren(board.root);
    progress.textContent = `Puzzle ${index + 1}`;
    board.focus();
  }

  function record(result) {
    if (!current || current.done) return;
    current.done = true;
    const attempt = current.log.end(result, { picks: board.session.picks });
    stampDvs(GAME_ID, attempt, current.puzzle);
    recorder.saveAttempt(attempt);
    results.push({ attempt, puzzle: current.puzzle, source: current.source, index: current.index });
  }

  // exit: 'time' (clock ran out), 'early' (End and review), 'nav' or 'unload' (left the page).
  function finish(exit = 'time') {
    if (finished) return;
    finished = true;
    timer?.stop();
    unguard?.();
    // Ended early: an untouched puzzle on screen counts as not attempted.
    if (exit === 'time' || current?.log.events.length) {
      if (board && current && !current.done) board.session.timeout();
      record('timeout');
    }
    board?.destroy();
    board = null;
    setExamChrome(false);
    head.hidden = false;

    const run = saveEndedRun({ recorder, run: buildRun(), exit });
    const slots = Math.max(PUZZLES_PER_SET, results.length);
    const avg = averageEfficiency(run.score, slots);
    const wasOpen = setNo < SET_CONFIGS.length ? isUnlocked(setNo + 1) : true;
    const { improved, best } = store.recordRun(GAME_ID, setNo, run.score, slots);
    const nowOpen = setNo < SET_CONFIGS.length ? isUnlocked(setNo + 1) : true;
    const puzzlesById = new Map(results.map((r) => [r.puzzle.id, r.puzzle]));
    // Leaving the page: save to the review library without the coach, and render nothing.
    if (isLeave(exit)) {
      noteRun(GAME_ID, run, results.map((r) => r.attempt), [], puzzlesById);
      return;
    }
    const history = recorder.attempts({ game: GAME_ID, set: setNo });
    const runCoach = coachRun(run, results.map((r) => r.attempt), puzzlesById, { paceSec: cfg.paceSec, budgetMs: RUN_MS, history });
    noteRun(GAME_ID, run, results.map((r) => r.attempt), runCoach.perPuzzle, puzzlesById);
    const partial = isPartial(run);
    const [takeawaysNode, notAttemptedNode] = runLearning({ game: GAME_ID, run, attempts: results.map((r) => r.attempt), habits: runCoach.habits, perPuzzle: runCoach.perPuzzle, pool: data.puzzles, solve: studyWalkthrough, onDispose: ctx.onDispose });
    const correct = results.filter((r) => attemptResult(r.attempt) === 'correct').length;

    const review = el('div', { class: 'review-host' });
    const RESULT_LABEL = { correct: ['badge-ok', 'Correct'], wrong: ['badge-warn', 'Wrong'], skipped: ['badge-warn', 'Skipped'], timeout: ['badge-warn', 'Time up'] };
    const rows = results.map((r) => {
      const res = attemptResult(r.attempt);
      const picks = attemptPicks(r.attempt);
      const m = r.attempt.metrics;
      return el('tr', {},
        el('td', { text: String(r.index + 1) }),
        el('td', {}, el('span', { class: `badge ${RESULT_LABEL[res][0]}`, text: RESULT_LABEL[res][1] })),
        el('td', { text: letters(picks) }),
        el('td', { text: letters(r.puzzle.answer) }),
        el('td', { text: fmtSec(m.totalMs) }),
        el('td', { text: fmtSec(m.firstMoveMs) }),
        el('td', {}, el('button', {
          type: 'button',
          class: 'btn btn-small',
          onclick: () => {
            const status = res === 'skipped' ? 'skipped' : res === 'timeout' ? 'timeout' : 'answered';
            const g = { status, exact: res === 'correct', picks, falsePicks: picks.filter((i) => !r.puzzle.answer.includes(i)), misses: r.puzzle.answer.filter((i) => !picks.includes(i)) };
            review.replaceChildren(
              el('h3', { text: `Puzzle ${r.index + 1}${r.source === 'pool' ? '' : r.source === 'generated' ? ' (freshly generated)' : ' (reshuffled repeat)'}` }),
              reviewBoard(r.puzzle, picks),
              trackExplain(createExplainPanel(r.puzzle, g), r.attempt),
              coachPanel(r.attempt, r.puzzle, cfg.paceSec),
            );
            review.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
          },
        }, 'Review')),
      );
    });

    body.replaceChildren(el('section', { class: 'run-summary' },
      el('h2', { text: partial ? 'Run ended early' : 'Time is up' }),
      partialBanner(run),
      el('div', { class: 'score-tiles' },
        el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Run score' }), el('strong', { text: String(round2(run.score)) })),
        el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Correct' }), el('strong', { text: `${correct} of ${results.length} reached` })),
        el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Average (unlock measure)' }), el('strong', { text: pct(avg) })),
        el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Best for this set' }), el('strong', { text: `${round2(best)}${improved ? ' (new best)' : ''}` })),
      ),
      runExtras(GAME_ID, setNo, improved, { partial }),
      takeawaysNode,
      !wasOpen && nowOpen ? el('p', { class: 'callout callout-ok', text: `Set ${setNo + 1} unlocked. Nice work.` }) : null,
      avg < UNLOCK_THRESHOLD && setNo < SET_CONFIGS.length && !nowOpen
        ? el('p', { class: 'callout', text: `Reach ${pct(UNLOCK_THRESHOLD)} (score / ${slots}) to unlock set ${setNo + 1}.` })
        : null,
      el('section', { class: 'coach run-coach', 'aria-label': 'Run coaching' },
        el('h3', { text: 'Run coaching' }),
        el('ul', { class: 'findings', role: 'list' }, runCoach.lines.map((l) => findingItem({ ...l, detail: l.text }))),
        runCoach.habits.length
          ? el('div', {}, el('h4', { text: 'Top habits to fix' }),
            el('ol', { class: 'habits' }, runCoach.habits.map((h) => el('li', {}, el('strong', { text: h.label }), ` (in ${h.count} of ${h.of} puzzles). `, h.tip))))
          : el('p', { class: 'muted', text: 'No repeated habit to fix in this run.' }),
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'results' },
          el('caption', { class: 'sr-only', text: 'Results per puzzle' }),
          el('thead', {}, el('tr', {}, ['#', 'Result', 'Your picks', 'Answer', 'Time', 'First pick', 'Coach and explanation'].map((h) => el('th', { scope: 'col', text: h })))),
          el('tbody', {}, rows))),
      dvsRunSection(GAME_ID, results.map((r) => ({ attempt: r.attempt, puzzle: r.puzzle }))),
      notAttemptedNode,
      el('div', { class: 'after-actions' },
        el('button', { type: 'button', class: 'btn btn-primary', onclick: () => ctx.rerender() }, 'Run again'),
        studyLink(GAME_ID, setNo),
        el('a', { class: 'btn', href: '#/analytics' }, 'Progress and analytics'),
        el('a', { class: 'btn', href: BASE }, 'Back to sets')),
      review,
    ));
    body.querySelector('h2')?.setAttribute('tabindex', '-1');
    body.querySelector('h2')?.focus();
  }
}

// Read-only copy of a puzzle with the player's picks marked, for the run review.
function reviewBoard(puzzle, picks) {
  const marks = pickMarks(puzzle, picks);
  return el('div', { class: 'pr-board is-review' },
    el('section', { class: 'pr-examples', 'aria-label': 'Example panels' },
      el('div', { class: 'pr-group' }, el('h4', { class: 'pr-group-title' }, `${TICK} Fit the rule`),
        el('ul', { class: 'pr-row', role: 'list' }, puzzle.fits.map((p, i) => exampleFigure(p, 'fit', i + 1)))),
      el('div', { class: 'pr-group is-not' }, el('h4', { class: 'pr-group-title' }, `${CROSS} Do not fit`),
        el('ul', { class: 'pr-row', role: 'list' }, puzzle.counters.map((p, i) => exampleFigure(p, 'not', i + 1))))),
    el('ul', { class: 'pr-cands', role: 'list' }, puzzle.candidates.map((p, i) => el('li', { class: `pr-cand is-static mark-${marks[i]}` },
      el('span', { class: 'pr-letter', text: letter(i) }),
      panelSvg(p, { label: `Candidate ${letter(i)}, ${MARK_TEXT[marks[i]]}` }),
      el('span', { class: 'pr-state', text: `${marks[i] === 'hit' || marks[i] === 'miss' ? TICK : CROSS} ${MARK_TEXT[marks[i]]}` })))),
  );
}

// ---------------------------------------------------------------- review library hooks

function renderRetry(ctx) {
  const r = peekRetry(GAME_ID);
  if (!r?.puzzle) {
    ctx.root.append(el('p', { class: 'notice' }, 'No review puzzle is waiting. ', el('a', { href: '#/review/patternrule' }, 'Open the Pattern Rule review library')));
    return null;
  }
  return renderPractice(ctx, r.set, 0, r);
}

// Watch mode on the review page: the worked solution, with the original result line.
export function reviewWalkthrough(puzzle, attempt) {
  const picks = attemptPicks(attempt);
  const res = attemptResult(attempt);
  const status = res === 'skipped' ? 'skipped' : res === 'timeout' ? 'timeout' : 'answered';
  return createExplainPanel(puzzle, { status, exact: res === 'correct', picks, falsePicks: picks.filter((i) => !puzzle.answer.includes(i)), misses: puzzle.answer.filter((i) => !picks.includes(i)) });
}

// Study mode: the worked rule explanation for a puzzle nobody played yet (no result line, not scored).
export function studyWalkthrough(puzzle, onDispose = () => {}) {
  void onDispose;
  const examples = el('section', { class: 'pr-examples', 'aria-label': 'Example panels' },
    el('div', { class: 'pr-group' }, el('h4', { class: 'pr-group-title' }, `${TICK} Fit the rule`),
      el('ul', { class: 'pr-row', role: 'list' }, puzzle.fits.map((p, i) => exampleFigure(p, 'fit', i + 1)))),
    el('div', { class: 'pr-group is-not' }, el('h4', { class: 'pr-group-title' }, `${CROSS} Do not fit`),
      el('ul', { class: 'pr-row', role: 'list' }, puzzle.counters.map((p, i) => exampleFigure(p, 'not', i + 1)))));
  return el('div', { class: 'pr-study' }, el('div', { class: 'pr-board is-review' }, examples), createExplainPanel(puzzle, null));
}

// ---------------------------------------------------------------- entry

export async function mountPatternRule(main, args = []) {
  ensureCss();
  const root = el('div', { class: 'patternrule' });
  main.append(root);
  const disposers = [];
  const ctx = {
    root,
    onDispose: (fn) => disposers.push(fn),
    rerender: () => {
      disposeAll();
      root.replaceChildren();
      draw();
    },
  };
  function disposeAll() {
    while (disposers.length) {
      try {
        disposers.pop()();
      } catch (err) {
        console.error(err);
      }
    }
  }
  const [mode, a, b] = args;
  async function draw() {
    try {
      if (!mode) renderMenu(ctx);
      else if (mode === 'practice') await renderPractice(ctx, Number(a), Number(b) || 1);
      else if (mode === 'run') await renderRun(ctx, Number(a));
      else if (mode === 'retry') await renderRetry(ctx);
      else root.append(el('p', { class: 'notice' }, 'Unknown page. ', el('a', { href: BASE }, 'Back to Pattern Rule')));
    } catch (err) {
      console.error(err);
      root.replaceChildren(el('p', { class: 'notice' }, `Could not load the puzzle: ${err.message}. If you opened the file directly, serve the folder over http (python3 -m http.server).`));
    }
  }
  await draw();
  return disposeAll;
}
