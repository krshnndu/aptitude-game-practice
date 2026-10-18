// Operator Switch UI: set menu, practice mode, timed run (exam mode), coach and explanation panels.
// Rules live in state.js; this file only renders and wires input. Every attempt is logged through
// the core recorder and reviewed by the coach.

import { el } from '../../core/dom.js';
import { runExtras } from '../../core/board.js';
import { Countdown, formatClock } from '../../core/timer.js';
import { createStore } from '../../core/store.js';
import { createRecorder, createAttemptLog, summarizeRun, newId } from '../../core/recorder.js';
import { averageEfficiency, pct, round2, UNLOCK_THRESHOLD } from '../../core/score.js';
import { ITEMS, createSession, spaced, itemName, arrangementText, wrongPenalty } from './state.js';
import { explainPuzzle, hintSteps, resultSummary, chainName } from './explain.js';
import { SET_CONFIGS, PUZZLES_PER_SET, GAME_ID, puzzleId } from './gen.js';
import { createRunStream, TUTORIAL_PUZZLE } from './stream.js';
import { coachPuzzle, coachRun, attemptResult } from './coach.js';
import { noteAttempt, noteRun, trackExplain, peekRetry, completeRetry, stampDvs } from '../../core/learn-hooks.js';
import { dvsPanel, dvsRunSection } from '../../core/dvs-ui.js';
import { endButton, guardRun, saveEndedRun, isLeave, isPartial, partialBanner, runLearning, studyLink, resume } from '../../core/endrun-ui.js';

const RUN_MS = 6 * 60 * 1000;
const ARROW = '→';
const CHECK = '✓';
const CROSS = '✗';
const SVG_NS = 'http://www.w3.org/2000/svg';

const store = createStore();
const recorder = createRecorder();
const setCache = new Map();

function loadSet(setNo) {
  if (!setCache.has(setNo)) {
    const url = new URL(`../../../data/sets/${GAME_ID}/set${setNo}.json`, import.meta.url);
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

function ensureStyles() {
  if (document.querySelector(`link[data-game-css="${GAME_ID}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL(`../../../css/${GAME_ID}.css`, import.meta.url).href;
  link.dataset.gameCss = GAME_ID;
  document.head.append(link);
}

function isUnlocked(setNo) {
  return store.isUnlocked(GAME_ID, setNo, PUZZLES_PER_SET);
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const fmtSec = (ms) => (ms === null || ms === undefined ? 'none' : `${(ms / 1000).toFixed(1)} s`);
const signed = (x) => (x > 0 ? `+${x.toFixed(2)}` : x < 0 ? x.toFixed(2) : '0');

// ---------------------------------------------------------------- shapes

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

const SHAPES = {
  C: (a) => svgEl('circle', { cx: 20, cy: 20, r: 16.5, ...a }),
  S: (a) => svgEl('rect', { x: 4.5, y: 4.5, width: 31, height: 31, rx: 3, ...a }),
  T: (a) => svgEl('polygon', { points: '20,2.5 37.5,35.5 2.5,35.5', ...a }),
  D: (a) => svgEl('polygon', { points: '20,1.5 38.5,20 20,38.5 1.5,20', ...a }),
  H: (a) => svgEl('polygon', { points: '11,3.5 29,3.5 38.5,20 29,36.5 11,36.5 1.5,20', ...a }),
};
const LABEL_Y = { C: 20, S: 20, T: 25.5, D: 20, H: 20 };

// Pattern fills (a second cue besides colour), defined once per mounted page.
function patternDefs() {
  const pat = (id, size, ...kids) => svgEl('pattern', { id: `os-pat-${id}`, width: size, height: size, patternUnits: 'userSpaceOnUse' }, ...kids);
  return svgEl('svg', { class: 'os-defs', width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' },
    svgEl('defs', {},
      pat('dots', 6, svgEl('circle', { cx: 3, cy: 3, r: 1.3, fill: 'rgba(0,0,0,0.45)' })),
      pat('diag', 7, svgEl('path', { d: 'M-1,8 L8,-1 M-1,1 L1,-1 M6,8 L8,6', stroke: 'rgba(255,255,255,0.6)', 'stroke-width': 2 })),
      pat('hlines', 6, svgEl('rect', { x: 0, y: 0, width: 6, height: 2, fill: 'rgba(255,255,255,0.55)' })),
      pat('grid', 7, svgEl('path', { d: 'M0,0 H7 M0,0 V7', stroke: 'rgba(255,255,255,0.6)', 'stroke-width': 1.6, fill: 'none' })),
      pat('vlines', 6, svgEl('rect', { x: 0, y: 0, width: 2, height: 6, fill: 'rgba(0,0,0,0.35)' })),
    ),
  );
}

function token(code, size = 'md') {
  const it = ITEMS[code];
  const draw = SHAPES[code];
  return svgEl('svg', { viewBox: '0 0 40 40', class: `os-token os-token-${size}`, 'aria-hidden': 'true', focusable: 'false' },
    draw({ fill: it.hex, class: 'os-shape-fill' }),
    draw({ fill: `url(#os-pat-${it.pattern})` }),
    draw({ fill: 'none', class: 'os-shape-edge' }),
    svgEl('circle', { cx: 20, cy: LABEL_Y[code], r: 7.6, class: 'os-label-bg' }),
    svgEl('text', { x: 20, y: LABEL_Y[code], class: 'os-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, code),
  );
}

function rowView(arr, { label, caption = null, size = 'md', numbers = true } = {}) {
  return el('div', { class: `os-row os-row-${size}`, role: 'img', 'aria-label': `${label}: ${[...arr].map((c, i) => `slot ${i + 1} ${itemName(c)}`).join(', ')}` },
    caption ? el('span', { class: 'os-caption', 'aria-hidden': 'true', text: caption }) : null,
    el('span', { class: 'os-slots', 'aria-hidden': 'true' },
      [...arr].map((c, i) => el('span', { class: 'os-slot' },
        numbers ? el('span', { class: 'os-slot-no', text: String(i + 1) }) : null,
        token(c, size)))),
  );
}

function opBox(op, k, n) {
  const hidden = op === null;
  return el('div', {
    class: `os-op${hidden ? ' is-hidden' : ''}`,
    role: 'img',
    'aria-label': hidden ? `Box ${k}: hidden, the box to find` : `Box ${k}: ${spaced(op)}`,
  },
  el('span', { class: 'os-caption', 'aria-hidden': 'true', text: `Box ${k}` }),
  el('span', { class: 'os-digits', 'aria-hidden': 'true', text: hidden ? Array(n).fill('?').join(' ') : spaced(op) }));
}

const arrow = () => el('span', { class: 'os-arrow', 'aria-hidden': 'true', text: ARROW });

function chainView(puzzle, c) {
  const ops = puzzle.chains[c];
  const twin = puzzle.kind === 'twin';
  const parts = [rowView(puzzle.start, { label: 'Start', caption: 'Start' })];
  ops.forEach((op, k) => parts.push(arrow(), opBox(op, k + 1, puzzle.n)));
  parts.push(arrow());
  if (puzzle.kind === 'hidden') parts.push(rowView(puzzle.target, { label: 'Output', caption: 'Output' }));
  else parts.push(el('div', { class: 'os-unknown', role: 'img', 'aria-label': twin ? 'Result: the same for both chains, to find' : 'Result: to find' },
    el('span', { class: 'os-caption', 'aria-hidden': 'true', text: twin ? 'Same result' : 'Result' }),
    el('span', { class: 'os-q', 'aria-hidden': 'true', text: '?' })));
  const name = twin ? `${chainName(c)[0].toUpperCase()}${chainName(c).slice(1)}` : 'Chain';
  return el('div', { class: 'os-chain', role: 'group', 'aria-label': `${name}, ${ops.length} ${ops.length === 1 ? 'box' : 'boxes'}` },
    twin ? el('span', { class: 'os-chain-name', text: name }) : null,
    el('div', { class: 'os-chain-body' }, parts));
}

function questionText(puzzle) {
  if (puzzle.kind === 'hidden') return 'Which box fills the gap so that the chain turns the start into the output?';
  if (puzzle.kind === 'twin') return 'Both chains end in the same arrangement. Which one is it?';
  return puzzle.chains[0].length === 1 ? 'Which arrangement comes out of the box?' : 'Which arrangement comes out at the end of the chain?';
}

function optionLabel(puzzle, i) {
  const v = puzzle.options[i];
  return puzzle.kind === 'hidden' ? `box ${spaced(v)}` : arrangementText(v);
}

function optionBody(puzzle, v) {
  return puzzle.kind === 'hidden'
    ? el('span', { class: 'os-digits', text: spaced(v) })
    : el('span', { class: 'os-slots' }, [...v].map((c) => token(c, 'sm')));
}

// ---------------------------------------------------------------- play area (one puzzle)

// opts: { mode: 'practice'|'exam', log, onDone(session) }.
// Exam mode has no hints; its Skip button is returned in hudItems for the caller's HUD.
function createPlayArea(puzzle, opts) {
  const exam = opts.mode === 'exam';
  const log = opts.log ?? null;
  const hints = exam ? [] : hintSteps(puzzle);
  const session = createSession(puzzle, { mode: opts.mode, maxHints: hints.length });
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' });
  const message = el('p', { class: 'play-message', role: 'status' });
  const question = el('p', { class: 'os-question', tabindex: '-1', text: questionText(puzzle) });
  const hintList = el('ol', { class: 'os-hints', 'aria-label': 'Hints' });
  let locked = false;

  const buttons = puzzle.options.map((v, i) => el('button', {
    type: 'button',
    class: 'os-option',
    'data-option': i,
    'aria-label': `Option ${i + 1}: ${optionLabel(puzzle, i)}`,
    onclick: () => pick(i),
  },
  el('span', { class: 'os-key', 'aria-hidden': 'true', text: String(i + 1) }),
  optionBody(puzzle, v),
  el('span', { class: 'os-mark', 'aria-hidden': 'true' })));
  const grid = el('div', { class: `os-options${puzzle.kind === 'hidden' ? ' is-ops' : ''}`, role: 'group', 'aria-label': 'Options' }, buttons);

  const hintBtn = exam ? null : el('button', { type: 'button', class: 'btn', onclick: () => doHint() }, 'Hint');
  const skipBtn = el('button', { type: 'button', class: 'btn btn-warn', onclick: () => doSkip() }, exam ? 'Skip' : 'Skip and show solution');

  const board = el('div', { class: 'os-board' }, puzzle.chains.map((_, c) => chainView(puzzle, c)));
  const root = el('div', { class: `os-play${exam ? ' is-exam' : ''}` },
    board,
    question,
    grid,
    exam ? null : el('div', { class: 'controls' }, hintBtn, skipBtn),
    message,
    exam ? null : hintList,
    live,
    exam ? null : el('details', { class: 'help' },
      el('summary', {}, 'Rules and controls'),
      el('ul', {},
        el('li', {}, 'A box such as 3 1 4 2 means: slot 1 takes the item from position 3, slot 2 from position 1, and so on.'),
        el('li', {}, 'Boxes apply left to right, each to the row coming out of the box before it.'),
        el('li', {}, `Click or tap an option, or press its number key (1 to ${puzzle.options.length}). H shows a hint.`),
        el('li', {}, 'A wrong pick is crossed out and you can try again; efficiency is 1 divided by the answers you give.'),
      ),
    ),
  );

  function say(text) {
    live.textContent = '';
    requestAnimationFrame(() => (live.textContent = text));
  }

  function render() {
    buttons.forEach((b, i) => {
      const crossed = session.isCrossed(i);
      const isAnswer = i === puzzle.answer;
      const done = !session.playing;
      b.classList.toggle('is-crossed', crossed);
      b.classList.toggle('is-correct', done && isAnswer && (session.status === 'correct' || !exam));
      b.disabled = locked || !session.canAnswer(i);
      const mark = b.querySelector('.os-mark');
      mark.textContent = crossed ? `${CROSS} Wrong` : done && isAnswer && (session.status === 'correct' || !exam) ? `${CHECK} Answer` : '';
      b.setAttribute('aria-label', `Option ${i + 1}: ${optionLabel(puzzle, i)}${crossed ? ', wrong' : ''}${b.classList.contains('is-correct') ? ', the answer' : ''}`);
    });
    if (hintBtn) {
      hintBtn.disabled = !session.canHint();
      hintBtn.textContent = hints.length ? `Hint (${session.hintsUsed} of ${hints.length})` : 'Hint';
    }
    skipBtn.disabled = locked || !session.playing;
  }

  function pick(i) {
    if (locked || !session.canAnswer(i)) return;
    const r = session.answer(i);
    if (!r.ok) return;
    log?.move(i, 'answer');
    if (r.correct) {
      message.textContent = exam ? 'Correct.' : `Correct${session.submissions > 1 ? ` after ${session.submissions} answers` : ' first time'}.`;
      say(message.textContent);
    } else if (exam) {
      message.textContent = 'Not correct.';
      say(message.textContent);
    } else {
      message.textContent = `Option ${i + 1} is not it. Try again, take a hint, or show the solution.`;
      say(`Option ${i + 1} is wrong and crossed out.`);
    }
    render();
    if (!session.playing) opts.onDone?.(session);
  }

  function doSkip() {
    if (locked || !session.skip()) return;
    render();
    opts.onDone?.(session);
  }

  function doHint() {
    if (!session.useHint()) return;
    log?.hint();
    const text = hints[session.hintsUsed - 1];
    hintList.append(el('li', { text }));
    message.textContent = '';
    say(`Hint ${session.hintsUsed}: ${text}`);
    render();
  }

  function onKey(e) {
    if (e.altKey || e.metaKey || e.ctrlKey || !session.playing || locked) return;
    const active = document.activeElement;
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return;
    const d = Number(e.key);
    if (Number.isInteger(d) && d >= 1 && d <= puzzle.options.length) {
      e.preventDefault();
      pick(d - 1);
    } else if (!exam && (e.key === 'h' || e.key === 'H')) doHint();
  }
  document.addEventListener('keydown', onKey);

  render();
  return {
    root,
    session,
    hudItems: exam ? [skipBtn] : [],
    focus() {
      question.focus({ preventScroll: true });
    },
    // Stop input (used when time runs out or between run puzzles).
    lock() {
      locked = true;
      render();
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
}

// ---------------------------------------------------------------- explanation panel

function stepVisual(step) {
  if (!step.numbers) return null;
  return el('div', { class: 'os-step-row', 'aria-hidden': 'true' },
    el('span', { class: 'os-numbers', text: spaced(step.numbers) }),
    step.items ? el('span', { class: 'os-slots' }, [...step.items].map((c) => token(c, 'xs'))) : el('span', { class: 'os-digits os-digits-sm', text: `box ${spaced(step.numbers)}` }),
  );
}

// result null: study mode, nothing was played so there is no result line.
function createExplainPanel(puzzle, result, attempt = null) {
  const ex = explainPuzzle(puzzle);
  const status = result?.status;
  const badge = !result ? null : status === 'correct'
    ? (result.mode === 'exam' || result.submissions <= 1 ? ['badge-ok', `${CHECK} Correct`] : ['badge-mid', `${CHECK} ${pct(1 / result.submissions)}`])
    : status === 'wrong' ? ['badge-warn', `${CROSS} Wrong`] : status === 'timeout' ? ['badge-warn', 'Time up'] : ['badge-warn', 'Skipped'];
  const answerText = puzzle.kind === 'hidden' ? `box ${spaced(ex.value)}` : arrangementText(ex.value);
  return el('section', { class: 'explain os-explain', 'aria-label': 'How to solve it' },
    result ? el('div', { class: 'result-line' },
      el('span', { class: `badge ${badge[0]}`, text: badge[1] }),
      el('p', { text: resultSummary({ status, submissions: result.submissions, options: puzzle.options.length, mode: result.mode }) }),
    ) : null,
    attempt ? dvsPanel(GAME_ID, attempt, puzzle) : null,
    el('p', { class: 'os-answer-line' }, el('strong', { text: `Answer: option ${puzzle.answer + 1}` }), `, ${answerText}.`),
    el('h3', { text: 'How to solve it: track digits, not shapes' }),
    el('ol', { class: 'os-steps' }, ex.steps.map((s) => el('li', {},
      el('p', {}, el('strong', { text: `${s.title}. ` }), s.text),
      stepVisual(s)))),
    ex.trace ? el('p', { class: 'callout' }, el('strong', { text: 'Fastest check: ' }), ex.trace.text) : null,
    el('h3', { text: 'Eliminate options' }),
    el('ol', { class: 'os-elim' }, ex.elimination.steps.map((s) => el('li', { text: s.text }))),
    el('p', { class: 'muted small', text: ex.elimination.slotsNeeded === 1
      ? `Here ${puzzle.kind === 'hidden' ? 'the first digit' : 'slot 1'} alone was enough.`
      : `Here ${ex.elimination.slotsNeeded} ${puzzle.kind === 'hidden' ? 'digits' : 'slots'} were needed; you never need the whole row.` }),
    el('h3', { text: 'Why the other options are wrong' }),
    el('ul', { class: 'os-others' }, ex.others.map((o) => el('li', { text: o.text }))),
    el('details', { class: 'strategy', open: true },
      el('summary', {}, 'Strategy checklist'),
      el('ul', {}, ex.strategy.map((s) => el('li', { text: s }))),
    ),
  );
}

// ---------------------------------------------------------------- coach panel

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

function coachHost(attempt, puzzle, paceSec) {
  const m = attempt.metrics;
  const cells = [
    ['Time', fmtSec(m.totalMs)],
    ['First answer', fmtSec(m.firstMoveMs)],
    ['Answers given', String(m.grossMoves)],
    ['Pace guide', `${paceSec} s`],
  ];
  if (m.hints) cells.push(['Hints', String(m.hints)]);
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

// ---------------------------------------------------------------- menu

function setMeta(cfg) {
  const boxes = cfg.boxes[0] === cfg.boxes[1] ? `${cfg.boxes[0]} ${cfg.boxes[0] === 1 ? 'box' : 'boxes'}` : `${cfg.boxes[0]} to ${cfg.boxes[1]} boxes`;
  const opts = cfg.options[0] === cfg.options[1] ? `${cfg.options[0]}` : `${cfg.options[0]} to ${cfg.options[1]}`;
  const kind = cfg.kind === 'hidden' ? ', one box hidden: find it' : '';
  const twins = cfg.twins ? `; ${cfg.twins} puzzles show two chains with the same result` : '';
  return `${cfg.n} items, ${boxes}${kind}${twins}. ${opts} options. Pace: about ${cfg.paceSec} s per puzzle.`;
}

function renderMenu(ctx) {
  const { root } = ctx;
  const unlockToggle = el('input', {
    type: 'checkbox',
    id: 'os-unlock-all',
    onchange: (e) => {
      store.setUnlockAll(e.target.checked);
      ctx.rerender();
    },
  });
  unlockToggle.checked = store.unlockAll();
  const example = { kind: 'forward', n: 4, start: 'CSTD', chains: [['3142']] };

  root.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Operator Switch' }),
      el('p', { class: 'lede' },
        'Four shapes (five in the last set) sit in numbered slots. Each box is a four digit code that rearranges them: ',
        'slot 1 takes the item from the position named by the first digit, slot 2 from the second digit, and so on. ',
        'Work out where the shapes end up after a chain of boxes, or which box is missing.'),
    ),
    el('figure', { class: 'os-example' },
      el('div', { class: 'os-chain-body' },
        rowView(example.start, { label: 'Example start', caption: 'Start', size: 'sm' }),
        arrow(), opBox('3142', 1, 4), arrow(),
        rowView('TCDS', { label: 'Example result', caption: 'Result', size: 'sm' })),
      el('figcaption', { class: 'muted small', text: 'Box 3 1 4 2: slot 1 takes position 3 (triangle), slot 2 position 1 (circle), slot 3 position 4 (diamond), slot 4 position 2 (square).' }),
    ),
    el('div', { class: 'mode-explainer' },
      el('div', {}, el('h2', { text: 'Practice' }), el('p', { text: 'One puzzle, no clock, with hints. A wrong pick is crossed out and you can try again. Afterwards the coach reviews your answers and the solution is worked step by step.' })),
      el('div', {}, el('h2', { text: 'Timed run (exam mode)' }), el('p', { text: '6:00 on the clock and puzzles keep coming until time is up. No hints, one answer per puzzle, and a skipped puzzle never comes back. Correct +1, wrong loses a fraction, skip 0.' })),
    ),
    el('div', { class: 'toolbar os-toolbar' },
      el('div', { class: 'os-unlock' },
        el('label', { class: 'toggle', for: 'os-unlock-all' }, unlockToggle, ' Unlock all sets'),
        el('span', { class: 'muted small', text: `Off by default: sets open at ${pct(UNLOCK_THRESHOLD)} average in the set before. The switch is shared by every game on this site.` }),
      ),
      el('a', { class: 'btn', href: '#/analytics' }, 'Progress and analytics'),
      typeof store.resetGame === 'function'
        ? el('button', {
          type: 'button',
          class: 'btn btn-quiet',
          onclick: () => {
            if (confirm('Clear saved Operator Switch scores and unlocks in this browser? (Your play history stays; clear it on the analytics page.)')) {
              store.resetGame(GAME_ID);
              ctx.rerender();
            }
          },
        }, 'Clear my progress')
        : null,
    ),
    el('ol', { class: 'set-list', role: 'list' }, SET_CONFIGS.map((cfg) => setCard(cfg))),
  );
}

function setCard(cfg) {
  const open = isUnlocked(cfg.set);
  const entry = store.getSet(GAME_ID, cfg.set);
  const practiceAvg = store.practiceAverage(GAME_ID, cfg.set, PUZZLES_PER_SET);
  const chips = [];
  for (let k = 1; k <= PUZZLES_PER_SET; k++) {
    const best = entry.practice[puzzleId(cfg.set, k)];
    const label = best === undefined ? `Puzzle ${k}, not played` : `Puzzle ${k}, best efficiency ${pct(best)}`;
    chips.push(open
      ? el('a', { class: `chip${best >= 1 ? ' chip-perfect' : best > 0 ? ' chip-done' : ''}`, href: `#/${GAME_ID}/practice/${cfg.set}/${k}`, 'aria-label': label, title: label }, String(k))
      : el('span', { class: 'chip chip-locked', 'aria-hidden': 'true' }, String(k)));
  }
  return el('li', { class: `set-card${open ? '' : ' is-locked'}` },
    el('div', { class: 'card-head' },
      el('h2', {}, `Set ${cfg.set}: ${cfg.name}`),
      el('span', { class: `badge ${open ? 'badge-ok' : 'badge-soon'}`, text: open ? 'Open' : 'Locked' }),
    ),
    el('p', { class: 'set-meta', text: setMeta(cfg) }),
    el('p', { class: 'set-progress' },
      `Best timed run score: ${round2(entry.bestScore)} (${pct(entry.bestAvg)} average)`,
      ` | Practice average: ${pct(practiceAvg)}`),
    open
      ? el('div', { class: 'set-actions' },
        el('div', { class: 'chips', role: 'group', 'aria-label': `Practice puzzles in set ${cfg.set}` }, chips),
        el('a', { class: 'btn btn-primary', href: `#/${GAME_ID}/run/${cfg.set}` }, 'Start timed run (6:00)'),
        studyLink(GAME_ID, cfg.set),
      )
      : el('p', { class: 'muted', text: `Reach ${pct(UNLOCK_THRESHOLD)} average in set ${cfg.set - 1} (a timed run, or practice bests across all its puzzles) to unlock, or tick Unlock all sets.` }),
  );
}

function lockedNotice(root, setNo) {
  root.append(el('section', { class: 'prose' },
    el('h1', { text: `Set ${setNo} is locked` }),
    el('p', { text: `Reach ${pct(UNLOCK_THRESHOLD)} average in set ${setNo - 1}, or turn on Unlock all sets.` }),
    el('p', {}, el('a', { class: 'btn', href: `#/${GAME_ID}` }, 'Back to sets')),
  ));
}

// ---------------------------------------------------------------- practice

// retry: a puzzle handed over by the review library (any set or source), played blind.
async function renderPractice(ctx, setNo, k, retry = null) {
  const { root } = ctx;
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg || (!retry && !(k >= 1 && k <= PUZZLES_PER_SET))) {
    root.append(el('p', { class: 'notice' }, 'Unknown puzzle. ', el('a', { href: `#/${GAME_ID}` }, 'Back to sets')));
    return;
  }
  if (!retry && !isUnlocked(setNo)) return lockedNotice(root, setNo);
  const puzzle = retry ? retry.puzzle : (await loadSet(setNo)).puzzles[k - 1];

  const after = el('div', { class: 'after' });
  const host = el('div', {});
  const prevLink = !retry && k > 1 ? el('a', { class: 'btn btn-quiet', href: `#/${GAME_ID}/practice/${setNo}/${k - 1}` }, 'Previous puzzle') : null;
  const nextHref = retry ? retry.returnHash : k < PUZZLES_PER_SET ? `#/${GAME_ID}/practice/${setNo}/${k + 1}` : `#/${GAME_ID}`;
  const nextLabel = retry ? 'Compare with the optimal solution' : k < PUZZLES_PER_SET ? 'Next puzzle' : 'Back to sets';
  let area = null;
  let curLog = null;

  // An unfinished puzzle with at least one action is saved as skipped (End and review, leaving).
  function saveUnfinished() {
    if (retry || !area || !curLog || curLog.ended || !curLog.events.length || !area.session.playing) return false;
    const attempt = curLog.end('skipped', { moves: area.session.submissions, hintsUsed: area.session.hintsUsed });
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
    area?.destroy();
    after.replaceChildren();
    const log = createAttemptLog({ game: GAME_ID, set: setNo, puzzleId: puzzle.id, mode: 'practice', source: retry ? 'review' : 'pool', optimal: 1 });
    curLog = log;
    area = createPlayArea(puzzle, { mode: 'practice', log, onDone: (s) => finish(s, log) });
    host.replaceChildren(area.root);
  }

  function finish(session, log) {
    const attempt = log.end(session.outcome(), { moves: session.submissions, hintsUsed: session.hintsUsed });
    stampDvs(GAME_ID, attempt, puzzle);
    recorder.saveAttempt(attempt);
    resume().clear(GAME_ID, 'practice');
    if (retry) {
      // Retrieval first: grade and reschedule now, compare with the optimal solution on the review page.
      completeRetry(GAME_ID, attempt);
      after.replaceChildren(
        el('div', { class: 'after-actions' }, el('a', { class: 'btn btn-primary', href: nextHref }, nextLabel)),
        coachHost(attempt, puzzle, cfg.paceSec),
      );
      after.querySelector('.after-actions .btn-primary')?.focus({ preventScroll: true });
      return;
    }
    // Hinted solves still count, as in Block Slide; the coach flags them.
    store.recordPractice(GAME_ID, setNo, puzzle.id, session.efficiency());
    after.replaceChildren(
      el('div', { class: 'after-actions' },
        el('button', { type: 'button', class: 'btn', onclick: () => start() }, 'Try again'),
        el('a', { class: 'btn btn-primary', href: nextHref }, nextLabel),
      ),
      coachHost(attempt, puzzle, cfg.paceSec),
      trackExplain(createExplainPanel(puzzle, { status: session.status, submissions: session.submissions, mode: 'practice' }, attempt), attempt),
    );
    after.querySelector('.after-actions .btn-primary')?.focus({ preventScroll: true });
    after.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  root.append(
    el('div', { class: 'page-head play-head' },
      el('p', { class: 'crumbs' }, el('a', { href: `#/${GAME_ID}` }, 'Operator Switch'), ` / Set ${setNo}: ${cfg.name}`),
      el('h1', {}, retry ? 'Review: solve it again before you look' : `Practice: puzzle ${k} of ${PUZZLES_PER_SET}`),
      el('p', { class: 'muted' }, `Suggested pace: about ${cfg.paceSec} s. No clock in practice mode.`),
      retry ? null : el('div', { class: 'after-actions' }, endButton({ game: GAME_ID, practice: true, onEnd: endPractice }), studyLink(GAME_ID, setNo)),
    ),
    host,
    after,
    el('div', { class: 'after-actions' }, prevLink, el('a', { class: 'btn btn-quiet', href: nextHref }, retry ? 'Back to the review' : nextLabel)),
  );
  start();
  const unguard = guardRun({ onLeave: leave });
  ctx.onDispose(() => {
    unguard();
    leave();
    area?.destroy();
  });
}

// ---------------------------------------------------------------- timed run (exam mode)

function setExamChrome(on) {
  document.body.classList.toggle('exam-active', on);
}

const RESULT_LABEL = { correct: `${CHECK} Correct`, wrong: `${CROSS} Wrong`, skipped: 'Skipped', timeout: 'Time up' };

async function renderRun(ctx, setNo) {
  const { root } = ctx;
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg) {
    root.append(el('p', { class: 'notice' }, 'Unknown set. ', el('a', { href: `#/${GAME_ID}` }, 'Back to sets')));
    return;
  }
  if (!isUnlocked(setNo)) return lockedNotice(root, setNo);
  const data = await loadSet(setNo);

  const head = el('div', { class: 'page-head play-head' },
    el('p', { class: 'crumbs' }, el('a', { href: `#/${GAME_ID}` }, 'Operator Switch'), ` / Set ${setNo}: ${cfg.name}`),
    el('h1', {}, 'Timed run'),
  );
  const body = el('div', {});
  root.append(head, body);

  let timer = null;
  let area = null;
  let tutorialArea = null;
  let finished = false;
  let advanceHandle = null;
  let stream = null;
  let current = null;
  let runSeed = 0;
  let runId = null;
  let startedAt = 0;
  let points = 0;
  let unguard = null;
  const results = [];
  ctx.onDispose(() => {
    timer?.stop();
    area?.destroy();
    tutorialArea?.destroy();
    clearTimeout(advanceHandle);
    setExamChrome(false);
  });

  // ---- pre-run tutorial screen
  const atPace = Math.floor(RUN_MS / (cfg.paceSec * 1000));
  const pen4 = wrongPenalty(cfg.options[0]);
  const startBtn = el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => begin() }, 'I am ready: start the 6:00 run');
  const tutorialSlot = el('span', { class: 'hud-slot' });
  const tutorialHud = el('div', { class: 'exam-hud is-tutorial' },
    el('span', { class: 'clock', 'aria-label': 'Time left (not running in the sample)' }, '6:00'),
    el('span', { class: 'run-progress', text: 'Sample' }),
    tutorialSlot);
  const tutorialMsg = el('p', { class: 'flash', role: 'status' });
  const tutorialHost = el('div', {});
  function startTutorial() {
    tutorialArea?.destroy();
    tutorialMsg.textContent = '';
    tutorialArea = createPlayArea(TUTORIAL_PUZZLE, {
      mode: 'exam',
      onDone: (s) => {
        const pen = wrongPenalty(TUTORIAL_PUZZLE.options.length).toFixed(2);
        tutorialMsg.textContent = s.status === 'correct'
          ? 'Correct: in the run that scores +1 and the next puzzle appears at once.'
          : s.status === 'wrong'
            ? `Wrong: in the run that costs ${pen} points. The answer was option ${TUTORIAL_PUZZLE.answer + 1}: box 2 4 1 3 sends square to slot 1, diamond to slot 2, circle to slot 3, triangle to slot 4.`
            : 'Skipped: 0 points. In the run the next puzzle appears at once and this one never comes back.';
      },
    });
    tutorialSlot.replaceChildren(...tutorialArea.hudItems);
    tutorialHost.replaceChildren(tutorialArea.root);
  }
  body.append(
    el('section', { class: 'run-intro' },
      el('h2', { text: 'Before you start' }),
      el('ol', { class: 'exam-rules' },
        el('li', {}, el('strong', { text: '6:00 on the clock. ' }), 'Puzzles keep coming until time is up: first this set\'s 10 in a shuffled order, then freshly generated puzzles of the same kind.'),
        el('li', {}, el('strong', { text: 'One answer per puzzle. ' }), `Click or tap an option, or press its number key. There are no hints and no second tries.`),
        el('li', {}, el('strong', { text: 'Scoring: ' }), `correct +1, skip 0, wrong loses 1 / (options - 1), for example ${pen4.toFixed(2)} with ${cfg.options[0]} options. Blind guessing averages zero, so skip rather than guess, unless you have it down to two options.`),
        el('li', {}, el('strong', { text: 'Skip is final. ' }), 'A skipped puzzle never comes back.'),
        el('li', {}, el('strong', { text: 'Pace: ' }), `about ${cfg.paceSec} s per puzzle, so about ${atPace} puzzles in 6:00 for set ${setNo}.`),
        el('li', {}, el('strong', { text: 'Method: ' }), 'number the start positions, carry the number row through the boxes, and rule options out by slot 1 first.'),
        el('li', {}, el('strong', { text: 'Afterwards: ' }), 'the coach reviews every puzzle and the whole run. End and review stops the run at any point and shows your score so far; leaving the page saves it the same way. Runs ended early count toward progress and review but not the leaderboard.'),
      ),
      el('h3', { text: 'Try the sample puzzle (untimed, not scored)' }),
      el('p', { class: 'muted', text: 'This is the exact exam screen: chain, options, clock and Skip.' }),
      tutorialHud,
      tutorialMsg,
      tutorialHost,
      el('div', { class: 'after-actions' },
        el('button', { type: 'button', class: 'btn', onclick: () => startTutorial() }, 'Restart sample'),
        startBtn,
      ),
    ),
  );
  startTutorial();
  startBtn.focus({ preventScroll: true });

  // ---- the run
  const clock = el('span', { class: 'clock', role: 'timer', 'aria-label': 'Time left' }, formatClock(RUN_MS));
  const progress = el('span', { class: 'run-progress' });
  const scoreOut = el('span', { class: 'run-score' });
  const hudSlot = el('span', { class: 'hud-slot' });
  const announcer = el('p', { class: 'sr-only', 'aria-live': 'assertive' });
  const host = el('div', {});
  const flash = el('p', { class: 'flash', role: 'status' });
  const endBtn = endButton({ game: GAME_ID, onEnd: (exit) => finish(exit) });
  let warned60 = false;
  let warned10 = false;

  const buildRun = () => {
    const run = summarizeRun({ id: runId, game: GAME_ID, set: setNo, seed: runSeed, startedAt, endedAt: Date.now(), budgetMs: RUN_MS, attempts: results.map((r) => r.attempt) });
    // Run score in points: wrong answers carry a penalty the core efficiency cannot express.
    run.score = Math.max(0, results.reduce((s, r) => s + r.points, 0));
    return run;
  };
  // Tab hidden mid-run: keep a silent partial copy in case the browser never comes back.
  function checkpoint() {
    if (!finished && startedAt) saveEndedRun({ recorder, run: buildRun(), exit: 'hidden' });
  }

  function begin() {
    tutorialArea?.destroy();
    tutorialArea = null;
    setExamChrome(true);
    head.hidden = true;
    runSeed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    runId = newId('r');
    startedAt = Date.now();
    stream = createRunStream({ puzzles: data.puzzles, seed: runSeed, setNo });
    unguard = guardRun({ onLeave: (exit) => finish(exit), onHide: checkpoint });
    // Registered after the page disposer, so it runs first: a route change mid-run saves it.
    ctx.onDispose(() => {
      if (!finished) finish('nav');
    });
    body.replaceChildren(el('div', { class: 'exam-hud' }, clock, progress, scoreOut, hudSlot, endBtn), flash, announcer, host);
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
    area?.destroy();
    const { puzzle, source, index } = stream.next();
    const log = createAttemptLog({ game: GAME_ID, set: setNo, puzzleId: puzzle.id, mode: 'exam', runId, source, optimal: 1 });
    current = { puzzle, source, index, log, done: false };
    area = createPlayArea(puzzle, {
      mode: 'exam',
      log,
      onDone: (s) => {
        record(s);
        flash.textContent = s.status === 'correct' ? `${CHECK} Correct.` : s.status === 'wrong' ? `${CROSS} Wrong.` : `Skipped puzzle ${index + 1}.`;
        if (s.status === 'skipped') showNext();
        else {
          area.lock();
          advanceHandle = setTimeout(showNext, 450);
        }
      },
    });
    hudSlot.replaceChildren(...area.hudItems);
    host.replaceChildren(area.root);
    progress.textContent = `Puzzle ${index + 1}`;
    scoreOut.textContent = `Score ${points.toFixed(2)}`;
    announcer.textContent = `Puzzle ${index + 1}. ${questionText(puzzle)}`;
    area.focus();
  }

  function record(session) {
    if (!current || current.done) return;
    current.done = true;
    const attempt = current.log.end(session.outcome(), { moves: session.submissions });
    stampDvs(GAME_ID, attempt, current.puzzle);
    recorder.saveAttempt(attempt);
    const pts = session.examPoints();
    points += pts;
    scoreOut.textContent = `Score ${points.toFixed(2)}`;
    results.push({ attempt, puzzle: current.puzzle, source: current.source, index: current.index, status: session.status, points: pts });
  }

  // exit: 'time' (clock ran out), 'early' (End and review), 'nav' or 'unload' (left the page).
  function finish(exit = 'time') {
    if (finished) return;
    finished = true;
    clearTimeout(advanceHandle);
    timer?.stop();
    unguard?.();
    // Ended early: an untouched puzzle on screen counts as not attempted.
    if (current && !current.done && area && (exit === 'time' || current.log.events.length)) {
      area.session.timeout();
      record(area.session);
    }
    area?.destroy();
    area = null;
    setExamChrome(false);
    head.hidden = false;

    const run = saveEndedRun({ recorder, run: buildRun(), exit });
    const slots = Math.max(PUZZLES_PER_SET, results.length);
    const avg = averageEfficiency(run.score, slots);
    const wasOpen = setNo < SET_CONFIGS.length ? isUnlocked(setNo + 1) : true;
    const { improved, best } = store.recordRun(GAME_ID, setNo, run.score, slots);
    const nowOpen = setNo < SET_CONFIGS.length ? isUnlocked(setNo + 1) : true;

    const puzzlesById = new Map(results.map((r) => [r.puzzle.id, r.puzzle]));
    // Leaving the page: save to the review library without the (slower) coach, and render nothing.
    if (isLeave(exit)) {
      noteRun(GAME_ID, run, results.map((r) => r.attempt), [], puzzlesById);
      return;
    }
    const history = recorder.attempts({ game: GAME_ID, set: setNo });
    const runCoach = coachRun(run, results.map((r) => r.attempt), puzzlesById, { paceSec: cfg.paceSec, budgetMs: RUN_MS, history });
    noteRun(GAME_ID, run, results.map((r) => r.attempt), runCoach.perPuzzle, puzzlesById);
    const partial = isPartial(run);
    const [takeawaysNode, notAttemptedNode] = runLearning({ game: GAME_ID, run, attempts: results.map((r) => r.attempt), habits: runCoach.habits, perPuzzle: runCoach.perPuzzle, pool: data.puzzles, solve: studyWalkthrough, onDispose: ctx.onDispose });
    const errorByPuzzle = new Map(runCoach.errors.map((e) => [e.puzzle, e.label]));
    const correct = results.filter((r) => r.status === 'correct').length;
    const answered = results.filter((r) => r.status === 'correct' || r.status === 'wrong').length;

    const review = el('div', { class: 'review-host' });
    const rows = results.map((r, i) => {
      const m = r.attempt.metrics;
      const res = attemptResult(r.attempt);
      return el('tr', {},
        el('td', { text: String(r.index + 1) }),
        el('td', {}, el('span', { class: `badge ${res === 'correct' ? 'badge-ok' : 'badge-warn'}`, text: RESULT_LABEL[res] })),
        el('td', { text: signed(r.points) }),
        el('td', { text: fmtSec(m.totalMs) }),
        el('td', { text: errorByPuzzle.get(i + 1) ?? '' }),
        el('td', {},
          el('button', {
            type: 'button',
            class: 'btn btn-small',
            onclick: () => {
              review.replaceChildren(
                el('h3', { text: `Puzzle ${r.index + 1}${r.source === 'generated' ? ' (freshly generated)' : ''}` }),
                createPlayAreaSnapshot(r.puzzle, r.attempt),
                coachHost(r.attempt, r.puzzle, cfg.paceSec),
                trackExplain(createExplainPanel(r.puzzle, { status: r.status, submissions: m.grossMoves, mode: 'exam' }), r.attempt),
              );
              review.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
            },
          }, 'Review'),
        ),
      );
    });

    body.replaceChildren(
      el('section', { class: 'run-summary' },
        el('h2', { text: partial ? 'Run ended early' : 'Time is up' }),
        partialBanner(run),
        el('div', { class: 'score-tiles' },
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Run score (points)' }), el('strong', { text: round2(run.score).toFixed(2) })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Correct' }), el('strong', { text: `${correct} of ${answered} answered (${results.length} reached)` })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Average per slot' }), el('strong', { text: pct(avg) })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Best for this set' }), el('strong', { text: `${round2(best).toFixed(2)}${improved ? ' (new best)' : ''}` })),
        ),
        runExtras(GAME_ID, setNo, improved, { partial }),
        takeawaysNode,
        !wasOpen && nowOpen ? el('p', { class: 'callout callout-ok', text: `Set ${setNo + 1} unlocked. Nice work.` }) : null,
        avg < UNLOCK_THRESHOLD && setNo < SET_CONFIGS.length && !nowOpen
          ? el('p', { class: 'callout', text: `Reach ${pct(UNLOCK_THRESHOLD)} average (score / ${slots}) to unlock set ${setNo + 1}.` })
          : null,
        el('section', { class: 'coach run-coach', 'aria-label': 'Run coaching' },
          el('h3', { text: 'Run coaching' }),
          el('ul', { class: 'findings', role: 'list' }, runCoach.lines.map((l) => findingItem({ ...l, detail: l.text }))),
          runCoach.habits.length
            ? el('div', {},
              el('h4', { text: 'Top habits to fix' }),
              el('ol', { class: 'habits' }, runCoach.habits.map((h) => el('li', {},
                el('strong', { text: h.label }), ` (in ${h.count} of ${h.of} puzzles). `, h.tip))))
            : el('p', { class: 'muted', text: 'No repeated habit to fix in this run.' }),
        ),
        el('div', { class: 'table-wrap' },
          el('table', { class: 'results' },
            el('caption', { class: 'sr-only', text: 'Results per puzzle' }),
            el('thead', {}, el('tr', {}, ['#', 'Result', 'Points', 'Time', 'Error type', 'Coach and solution'].map((h) => el('th', { scope: 'col', text: h })))),
            el('tbody', {}, rows),
          ),
        ),
        dvsRunSection(GAME_ID, results.map((r) => ({ attempt: r.attempt, puzzle: r.puzzle }))),
        notAttemptedNode,
        el('div', { class: 'after-actions' },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => ctx.rerender() }, 'Run again'),
          studyLink(GAME_ID, setNo),
          el('a', { class: 'btn', href: '#/analytics' }, 'Progress and analytics'),
          el('a', { class: 'btn', href: `#/${GAME_ID}` }, 'Back to sets'),
        ),
        review,
      ),
    );
    body.querySelector('h2')?.setAttribute('tabindex', '-1');
    body.querySelector('h2')?.focus();
  }
}

// Read-only view of a finished puzzle with the player's pick marked, for run review.
function createPlayAreaSnapshot(puzzle, attempt) {
  const picked = (attempt.events || []).filter((e) => e.type === 'move').map((e) => e.p);
  return el('div', { class: 'os-play is-review' },
    el('div', { class: 'os-board' }, puzzle.chains.map((_, c) => chainView(puzzle, c))),
    el('p', { class: 'os-question', text: questionText(puzzle) }),
    el('div', { class: `os-options${puzzle.kind === 'hidden' ? ' is-ops' : ''}`, role: 'list' },
      puzzle.options.map((v, i) => {
        const yours = picked.includes(i);
        const right = i === puzzle.answer;
        const mark = right ? `${CHECK} Answer${yours ? ' (yours)' : ''}` : yours ? `${CROSS} Your pick` : '';
        return el('div', { class: `os-option${right ? ' is-correct' : ''}${yours && !right ? ' is-crossed' : ''}`, role: 'listitem', 'aria-label': `Option ${i + 1}: ${optionLabel(puzzle, i)}${mark ? `, ${mark.slice(2)}` : ''}` },
          el('span', { class: 'os-key', 'aria-hidden': 'true', text: String(i + 1) }),
          optionBody(puzzle, v),
          el('span', { class: 'os-mark', 'aria-hidden': 'true', text: mark }));
      })),
  );
}

// ---------------------------------------------------------------- review library hooks

function renderRetry(ctx) {
  const r = peekRetry(GAME_ID);
  if (!r?.puzzle) {
    ctx.root.append(el('p', { class: 'notice' }, 'No review puzzle is waiting. ', el('a', { href: '#/review/operatorswitch' }, 'Open the Operator Switch review library')));
    return null;
  }
  return renderPractice(ctx, r.set, 0, r);
}

// Watch mode on the review page: the worked solution, with the original result line.
export function reviewWalkthrough(puzzle, attempt) {
  return createExplainPanel(puzzle, { status: attemptResult(attempt), submissions: attempt.metrics?.grossMoves ?? 0, mode: attempt.mode });
}

// Study mode: the worked solution for a puzzle nobody played yet (no result line, nothing scored).
export function studyWalkthrough(puzzle, onDispose = () => {}) {
  return createExplainPanel(puzzle, null);
}

// ---------------------------------------------------------------- entry

export async function mountOperatorSwitch(main, args = []) {
  ensureStyles();
  const root = el('div', { class: GAME_ID });
  main.append(root);
  const disposers = [];
  const ctx = {
    root,
    onDispose: (fn) => disposers.push(fn),
    rerender: () => {
      disposeAll();
      root.replaceChildren(patternDefs());
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
  root.append(patternDefs());
  const [mode, a, b] = args;
  async function draw() {
    try {
      if (!mode) renderMenu(ctx);
      else if (mode === 'practice') await renderPractice(ctx, Number(a), Number(b) || 1);
      else if (mode === 'run') await renderRun(ctx, Number(a));
      else if (mode === 'retry') await renderRetry(ctx);
      else root.append(el('p', { class: 'notice' }, 'Unknown page. ', el('a', { href: `#/${GAME_ID}` }, 'Back to Operator Switch')));
    } catch (err) {
      console.error(err);
      root.replaceChildren(patternDefs(), el('p', { class: 'notice' }, `Could not load the puzzle: ${err.message}. If you opened the file directly, serve the folder over http (python3 -m http.server).`));
    }
  }
  await draw();
  return disposeAll;
}

