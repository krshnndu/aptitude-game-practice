// Grid Memory UI: set menu, practice mode, timed run (exam mode with an adaptive staircase) and the
// per-trial explanation. Rules and scoring live in state.js; this file renders, runs the timers and
// wires input. Every attempt is saved through the shared recorder and reviewed by the coach.

import { el } from '../../core/dom.js';
import { runExtras } from '../../core/board.js';
import { Countdown, formatClock } from '../../core/timer.js';
import { createStore } from '../../core/store.js';
import { createRecorder, summarizeRun, newId } from '../../core/recorder.js';
import { averageEfficiency, pct, round2, UNLOCK_THRESHOLD } from '../../core/score.js';
import { createTrial, cellLabel, ANSWERS, POINTS } from './state.js';
import { SET_CONFIGS, PUZZLES_PER_SET, GAP_MS, trialSeconds, puzzleId } from './gen.js';
import { createStaircase, createRunSource, tutorialTrial } from './stream.js';
import { explainTrial, questionText, answerWord, OP_TEXT, STRATEGY, landmark } from './explain.js';
import { coachTrial, coachRun } from './coach.js';
import { noteAttempt, noteRun, trackExplain, peekRetry, completeRetry, stampDvs } from '../../core/learn-hooks.js';
import { dvsPanel, dvsRunSection } from '../../core/dvs-ui.js';
import { endButton, guardRun, saveEndedRun, isLeave, isPartial, partialBanner, runLearning, studyLink, resume } from '../../core/endrun-ui.js';
import { reviewAttempt } from './coach.js';
import { buildAttempt, GAME_ID } from './record.js';

const RUN_MS = 6 * 60 * 1000;
const READY_MS = 900;
const SVG_NS = 'http://www.w3.org/2000/svg';
const KIND_NAMES = { sym: 'mirror symmetry (yes or no)', parity: 'even or odd sums' };

const store = createStore();
const recorder = createRecorder();
const setCache = new Map();
// Practice option, kept for the session: side questions without a time limit.
let relaxedPractice = false;

function ensureCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-gridmemory-css]')) return;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('../../../css/gridmemory.css', import.meta.url).href, 'data-gridmemory-css': '' }));
}

function loadSet(setNo) {
  if (!setCache.has(setNo)) {
    const url = new URL(`../../../data/sets/gridmemory/set${setNo}.json`, import.meta.url);
    setCache.set(
      setNo,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`could not load set ${setNo} (${r.status})`);
        return r.json();
      }),
    );
  }
  return setCache.get(setNo).catch((err) => {
    setCache.delete(setNo);
    throw err;
  });
}

function isUnlocked(setNo) {
  return store.isUnlocked(GAME_ID, setNo, PUZZLES_PER_SET);
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const fmtSec = (ms) => (ms === null || ms === undefined ? 'none' : `${(ms / 1000).toFixed(1)} s`);
const now = () => Date.now();

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  for (const c of children) if (c) node.append(c);
  return node;
}

// ---------------------------------------------------------------- side question figure

function shapeFigure(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const s = svg('svg', { viewBox: `-0.5 -0.9 ${w + 1} ${h + 1.8}`, class: 'gm-shape', 'aria-hidden': 'true' });
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      s.append(svg('rect', { x: c + 0.04, y: r + 0.04, width: 0.92, height: 0.92, class: rows[r][c] === '#' ? 'gm-px is-on' : 'gm-px' }));
    }
  }
  // Ticks above and below mark where the mirror line would be.
  s.append(svg('path', { d: `M ${w / 2 - 0.3} -0.8 L ${w / 2 + 0.3} -0.8 L ${w / 2} -0.25 Z`, class: 'gm-axis' }));
  s.append(svg('path', { d: `M ${w / 2 - 0.3} ${h + 0.8} L ${w / 2 + 0.3} ${h + 0.8} L ${w / 2} ${h + 0.25} Z`, class: 'gm-axis' }));
  return s;
}

function shapeAria(rows) {
  return `Shape of ${rows.length} rows, filled cells marked X: ${rows.map((r, i) => `row ${i + 1} ${r.replace(/#/g, 'X').replace(/\./g, 'o')}`).join(', ')}`;
}

function sideFigure(d) {
  if (d.kind === 'sym') return el('div', { class: 'gm-figure', role: 'img', 'aria-label': shapeAria(d.rows) }, shapeFigure(d.rows));
  return el('div', { class: 'gm-figure gm-sum', role: 'img', 'aria-label': `${d.a} ${d.op === '*' ? 'times' : d.op === '-' ? 'minus' : 'plus'} ${d.b}` },
    el('span', { 'aria-hidden': 'true', text: `${d.a} ${OP_TEXT[d.op]} ${d.b}` }));
}

const OPTION_KEYS = { yes: 'Y', no: 'N', even: 'E', odd: 'O' };

// ---------------------------------------------------------------- trial area (one trial)

// opts: { mode: 'practice'|'exam', relaxed (no side window), autoStart, onBegin(ms), onDone(trial) }
// Exam mode has no undo and no hints; its trial info and Skip button are returned in hudItems.
function createTrialArea(puzzle, opts) {
  const exam = opts.mode === 'exam';
  const relaxed = !!opts.relaxed && !exam;
  const trial = createTrial(puzzle, { mode: exam ? 'exam' : 'practice' });
  const n = puzzle.n;
  const L = puzzle.length;
  const timers = new Set();
  let windowTick = null;
  let destroyed = false;

  const later = (fn, ms) => {
    const h = setTimeout(() => {
      timers.delete(h);
      if (!destroyed) fn();
    }, ms);
    timers.add(h);
  };
  const clearTimers = () => {
    for (const h of timers) clearTimeout(h);
    timers.clear();
    if (windowTick !== null) clearInterval(windowTick);
    windowTick = null;
  };

  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' });
  const status = el('p', { class: 'gm-status', role: 'status' });
  const message = el('p', { class: 'play-message' });
  const pips = el('ol', { class: 'gm-pips', 'aria-hidden': 'true' }, Array.from({ length: L }, () => el('li', {})));

  const grid = el('div', { class: 'gm-grid', style: { '--n': n }, role: 'group', 'aria-label': `Grid, ${n} by ${n}` });
  const cells = [];
  for (let cell = 0; cell < n * n; cell++) {
    const b = el('button', {
      type: 'button',
      class: 'gm-cell',
      'data-cell': cell,
      tabindex: cell === 0 ? '0' : '-1',
      'aria-label': `Cell ${cellLabel(n, cell)}`,
      onclick: () => doTap(cell),
    }, el('span', { class: 'gm-mark', 'aria-hidden': 'true' }));
    cells.push(b);
    grid.append(b);
  }

  const sideCard = el('div', { class: 'gm-side', hidden: true });
  const startBtn = el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => begin() }, 'Start trial');
  const readyCard = el('div', { class: 'gm-ready' }, startBtn,
    el('p', { class: 'muted small', text: `${L} cells will light one at a time. Answer the question after each one, then tap the cells in order.` }));
  const stage = el('div', { class: 'gm-stage', tabindex: '-1' }, grid, sideCard, readyCard);

  const undoBtn = exam ? null : el('button', { type: 'button', class: 'btn', onclick: () => doUndo() }, 'Undo');
  const hintBtn = exam ? null : el('button', { type: 'button', class: 'btn', onclick: () => doHint() }, 'Hint');
  const submitBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => doSubmit() }, 'Submit');
  const skipBtn = el('button', { type: 'button', class: 'btn btn-warn', onclick: () => doSkip() }, exam ? 'Skip' : 'Skip and show answer');
  const info = el('span', { class: 'stat' }, 'Length ', el('strong', { class: 'stat-value', text: String(L) }));

  const root = exam
    ? el('div', { class: 'gm-area is-exam' }, status, pips, stage, el('div', { class: 'controls gm-controls' }, submitBtn), message, live)
    : el('div', { class: 'gm-area' },
      el('div', { class: 'gm-col' }, status, pips, stage),
      el('div', { class: 'side-col' },
        el('div', { class: 'stats' }, info,
          el('span', { class: 'stat' }, 'Side window ', el('strong', { class: 'stat-value', text: relaxed ? 'off' : fmtSec(puzzle.windowMs) }))),
        el('div', { class: 'controls' }, undoBtn, hintBtn, submitBtn, skipBtn),
        message,
        live,
        el('details', { class: 'help' },
          el('summary', {}, 'Controls'),
          el('ul', {},
            el('li', {}, 'Side questions: click an answer, or press Y or N (shapes), E or O (sums), or the left and right arrows.'),
            el('li', {}, 'Recall: tap the cells in the order they lit. Arrow keys move between cells, Enter or Space enters one.'),
            el('li', {}, 'Keys: Backspace or Z undo, H hint (enters the next cell for you; that position scores 0).'),
            el('li', {}, 'You can submit early; empty positions score 0. The trial submits itself when all cells are entered.'),
          ),
        ),
      ),
    );

  function say(text) {
    live.textContent = '';
    requestAnimationFrame(() => (live.textContent = text));
  }

  function render() {
    const phase = trial.phase;
    const recall = trial.recall;
    const lit = trial.litCell;
    grid.classList.toggle('is-recall', phase === 'recall');
    grid.classList.toggle('is-dim', phase === 'side');
    cells.forEach((b, cell) => {
      const k = recall.indexOf(cell);
      const isLit = cell === lit;
      b.classList.toggle('is-lit', isLit);
      b.classList.toggle('is-entered', k >= 0);
      b.classList.toggle('is-hinted', k >= 0 && trial.hinted.includes(k));
      b.querySelector('.gm-mark').textContent = isLit ? String(trial.step + 1) : k >= 0 ? String(k + 1) : '';
      b.disabled = phase !== 'recall';
      b.setAttribute('aria-label', `Cell ${cellLabel(n, cell)}${k >= 0 ? `, entered as number ${k + 1}` : ''}`);
    });
    [...pips.children].forEach((li, i) => {
      const doneStep = phase === 'recall' || phase === 'done' || i < trial.step || (i === trial.step && phase === 'side');
      li.className = i === trial.step && phase === 'show' ? 'is-now' : doneStep ? 'is-done' : '';
    });
    const inRecall = phase === 'recall';
    if (undoBtn) undoBtn.disabled = !inRecall || recall.length === 0;
    if (hintBtn) hintBtn.disabled = !inRecall;
    submitBtn.disabled = !inRecall;
    submitBtn.hidden = exam && !inRecall;
    skipBtn.disabled = phase === 'done';
    readyCard.hidden = phase !== 'ready' || !!opts.autoStart;
    sideCard.hidden = phase !== 'side';
    if (phase === 'ready') status.textContent = opts.autoStart ? 'Get ready...' : 'Press Start when you are ready.';
    else if (phase === 'show') status.textContent = `Watch: cell ${trial.step + 1} of ${L}`;
    else if (phase === 'side') status.textContent = `Side question ${trial.step + 1} of ${L}`;
    else if (phase === 'recall') status.textContent = `Recall: tap the cells in order (${recall.length} of ${L} entered)`;
    else status.textContent = trial.outcome === 'skipped' ? 'Skipped.' : trial.outcome === 'timeout' ? 'Time is up.' : 'Submitted.';
  }

  function begin() {
    if (trial.phase !== 'ready' || destroyed) return;
    trial.begin(now());
    opts.onBegin?.(Date.now());
    startBtn.blur();
    showStep();
  }

  function showStep() {
    render();
    say(`Cell ${trial.step + 1}: ${cellLabel(n, trial.litCell)}, ${landmark(n, trial.litCell)}.`);
    later(() => {
      // Blank the grid briefly, then the side question.
      cells[trial.litCell]?.classList.remove('is-lit');
      cells[trial.litCell].querySelector('.gm-mark').textContent = '';
      later(() => {
        trial.endShow(now());
        showSide();
      }, GAP_MS);
    }, puzzle.showMs);
  }

  function showSide() {
    const d = trial.distractor;
    const [a, b] = ANSWERS[d.kind];
    const bar = el('span', { class: 'gm-bar-fill' });
    const left = el('span', { class: 'gm-time-left' });
    sideCard.replaceChildren(
      el('p', { class: 'gm-question', text: d.kind === 'sym' ? questionText(d) : 'Is the result even or odd?' }),
      sideFigure(d),
      el('div', { class: 'gm-answers' },
        el('button', { type: 'button', class: 'btn gm-answer', 'data-answer': a, onclick: () => doAnswer(a) }, answerWord(a), el('kbd', { text: OPTION_KEYS[a] })),
        el('button', { type: 'button', class: 'btn gm-answer', 'data-answer': b, onclick: () => doAnswer(b) }, answerWord(b), el('kbd', { text: OPTION_KEYS[b] })),
      ),
      ...(relaxed
        ? [el('p', { class: 'muted small', text: 'Relaxed practice: no time limit.' })]
        : [el('div', { class: 'gm-bar', 'aria-hidden': 'true' }, bar), left]),
    );
    render();
    sideCard.querySelector('.gm-answer')?.focus({ preventScroll: true });
    say(`${questionText(d)}${d.kind === 'parity' ? '' : ' Answer yes or no.'}`);
    if (relaxed) return;
    const started = now();
    const tick = () => {
      const remaining = Math.max(0, puzzle.windowMs - (now() - started));
      bar.style.width = `${(remaining / puzzle.windowMs) * 100}%`;
      left.textContent = `${(remaining / 1000).toFixed(1)} s`;
      bar.classList.toggle('is-low', remaining < 1000);
    };
    tick();
    windowTick = setInterval(tick, 100);
    later(() => {
      const res = trial.sideTimeout(now());
      if (res) afterAnswer(res);
    }, puzzle.windowMs);
  }

  function doAnswer(v) {
    if (trial.phase !== 'side') return;
    const res = trial.answer(v, now());
    if (res) afterAnswer(res);
  }

  function afterAnswer(res) {
    clearTimers();
    if (res.answer === 'miss') message.textContent = 'Too slow: that side question timed out.';
    else message.textContent = '';
    sideCard.hidden = true;
    if (trial.phase === 'show') {
      render();
      later(showStep, GAP_MS);
    } else if (trial.phase === 'recall') {
      render();
      say(`Recall: tap the ${L} cells in the order they lit.`);
      roveTo(0);
    }
  }

  function doTap(cell) {
    if (trial.phase !== 'recall') return;
    const res = trial.tap(cell, now());
    if (!res.ok) {
      if (res.reason === 'repeat') {
        message.textContent = `Cell ${cellLabel(n, cell)} is already entered as number ${trial.recall.indexOf(cell) + 1}.`;
        say(message.textContent);
      }
      return;
    }
    message.textContent = '';
    render();
    say(`Entered ${cellLabel(n, cell)} as number ${trial.recall.length}.`);
    if (trial.done) finish();
  }

  function doUndo() {
    if (trial.undo(now())) {
      message.textContent = '';
      render();
      say(`Undone. ${trial.recall.length} of ${L} entered.`);
    }
  }

  function doHint() {
    const h = trial.hint(now());
    if (!h) return;
    if (h.already !== undefined) {
      message.textContent = `Hint: number ${h.position + 1} is a cell you entered as number ${h.already + 1}. Undo back to it first.`;
      say(message.textContent);
      return;
    }
    message.textContent = `Hint: number ${h.position + 1} was ${cellLabel(n, h.cell)}. That position scores 0.`;
    render();
    say(message.textContent);
    if (trial.done) finish();
  }

  function doSubmit() {
    if (trial.submit(now())) finish();
  }

  function doSkip() {
    if (trial.skip(now())) finish();
  }

  function finish() {
    clearTimers();
    render();
    opts.onDone?.(trial);
  }

  // Roving focus inside the grid during recall.
  let focusCell = 0;
  function roveTo(cell) {
    focusCell = Math.max(0, Math.min(n * n - 1, cell));
    cells.forEach((b, i) => b.setAttribute('tabindex', i === focusCell ? '0' : '-1'));
    cells[focusCell].focus({ preventScroll: true });
  }

  function onKey(e) {
    if (destroyed || e.altKey || e.metaKey || e.ctrlKey) return;
    const active = document.activeElement;
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return;
    const phase = trial.phase;
    if (phase === 'side') {
      const d = trial.distractor;
      const [a, b] = ANSWERS[d.kind];
      const k = e.key.toLowerCase();
      let pick = null;
      if (k === 'arrowleft' || k === '1') pick = a;
      else if (k === 'arrowright' || k === '2') pick = b;
      else if (k === OPTION_KEYS[a].toLowerCase()) pick = a;
      else if (k === OPTION_KEYS[b].toLowerCase()) pick = b;
      if (pick) {
        e.preventDefault();
        doAnswer(pick);
      }
      return;
    }
    if (phase !== 'recall') return;
    const moves = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in moves) {
      e.preventDefault();
      const inGrid = active && grid.contains(active);
      const from = inGrid ? Number(active.dataset.cell) : focusCell;
      const d = moves[e.key];
      const r = Math.floor(from / n);
      let to = from + d;
      if ((d === -1 || d === 1) && Math.floor(to / n) !== r) to = from;
      if (to < 0 || to >= n * n) to = from;
      roveTo(inGrid ? to : from);
      return;
    }
    if (exam) return;
    if (e.key === 'Backspace' || e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      doUndo();
    } else if (e.key === 'h' || e.key === 'H') doHint();
  }
  document.addEventListener('keydown', onKey);

  render();
  if (opts.autoStart) later(begin, READY_MS);

  return {
    root,
    trial,
    hudItems: exam ? [info, skipBtn] : [],
    focus() {
      (trial.phase === 'ready' && !opts.autoStart ? startBtn : stage).focus?.({ preventScroll: true });
    },
    // End and review or leaving in practice: close the trial as skipped without calling onDone.
    forceSkip() {
      clearTimers();
      trial.skip(now());
      render();
      return trial;
    },
    // The run clock ended: close the trial as a time-out without calling onDone.
    forceTimeout() {
      clearTimers();
      trial.timeout(now());
      render();
      return trial;
    },
    destroy() {
      destroyed = true;
      clearTimers();
      document.removeEventListener('keydown', onKey);
    },
  };
}

// ---------------------------------------------------------------- explanation panel

const STATUS_BADGE = { ok: 'badge-ok', hint: 'badge-mid', order: 'badge-mid', wrong: 'badge-warn', missing: 'badge-warn' };
const STATUS_WORD = { ok: 'Right', hint: 'Hint', order: 'Order', wrong: 'Wrong cell', missing: 'Empty' };

// Correct sequence as a numbered path (circles, solid line) with the player's taps on top
// (squares, dashed line). Errors get a heavy outline and a cross, so colour is never the only cue.
function pathOverlay(puzzle, recall, positions, { showCorrect = true, showYours = true } = {}) {
  const n = puzzle.n;
  const S = 10;
  const at = (cell, dx = 0, dy = 0) => [(cell % n) * S + S / 2 + dx, Math.floor(cell / n) * S + S / 2 + dy];
  const s = svg('svg', { viewBox: `0 0 ${n * S} ${n * S}`, class: 'gm-overlay', 'aria-hidden': 'true' });
  for (let i = 0; i <= n; i++) {
    s.append(svg('line', { x1: 0, y1: i * S, x2: n * S, y2: i * S, class: 'gm-ov-grid' }));
    s.append(svg('line', { x1: i * S, y1: 0, x2: i * S, y2: n * S, class: 'gm-ov-grid' }));
  }
  if (showCorrect) {
    const pts = puzzle.sequence.map((c) => at(c, -1.4, -1.4).join(',')).join(' ');
    s.append(svg('polyline', { points: pts, class: 'gm-ov-path' }));
  }
  if (showYours && recall.length > 1) {
    const pts = recall.map((c) => at(c, 1.8, 1.8).join(',')).join(' ');
    s.append(svg('polyline', { points: pts, class: 'gm-ov-yours' }));
  }
  if (showCorrect) {
    puzzle.sequence.forEach((c, i) => {
      const [x, y] = at(c, -1.4, -1.4);
      s.append(svg('circle', { cx: x, cy: y, r: 2.4, class: 'gm-ov-dot' }));
      const t = svg('text', { x, y: y + 1.05, class: 'gm-ov-num' });
      t.textContent = String(i + 1);
      s.append(t);
    });
  }
  if (showYours) {
    recall.forEach((c, i) => {
      const [x, y] = at(c, 1.8, 1.8);
      const bad = positions[i]?.status !== 'ok';
      s.append(svg('rect', { x: x - 2, y: y - 2, width: 4, height: 4, class: `gm-ov-sq${bad ? ' is-err' : ''}` }));
      const t = svg('text', { x, y: y + 0.95, class: 'gm-ov-num gm-ov-num-yours' });
      t.textContent = String(i + 1);
      s.append(t);
      if (bad) s.append(svg('path', { d: `M ${x + 1.4} ${y - 3.4} l 1.6 1.6 m 0 -1.6 l -1.6 1.6`, class: 'gm-ov-cross' }));
    });
  }
  return s;
}

// trial null: study mode. Nothing was played, so only the correct sequence and side answers show.
function createExplainPanel(puzzle, trial) {
  const study = !trial;
  const result = study ? createTrial(puzzle, { mode: 'practice' }).result() : trial.result();
  const ex = explainTrial(puzzle, result, study ? [] : trial.answers);
  const recall = study ? [] : trial.recall;
  const holder = el('div', { class: 'gm-overlay-wrap', role: 'img', 'aria-label': `Correct order: ${puzzle.sequence.map((c, i) => `${i + 1} ${cellLabel(puzzle.n, c)}`).join(', ')}.${study ? '' : ` Your order: ${recall.length ? recall.map((c, i) => `${i + 1} ${cellLabel(puzzle.n, c)}`).join(', ') : 'nothing entered'}.`}` });
  const layers = { showCorrect: true, showYours: !study };
  const draw = () => holder.replaceChildren(pathOverlay(puzzle, recall, ex.positions, layers));
  const toggle = (key, label) => {
    const id = `gm-layer-${key}-${Math.random().toString(36).slice(2, 7)}`;
    const box = el('input', { type: 'checkbox', id, onchange: (e) => { layers[key] = e.target.checked; draw(); } });
    box.checked = true;
    return el('label', { class: 'toggle', for: id }, box, ` ${label}`);
  };
  draw();

  const badge = study ? null : result.outcome !== 'submitted'
    ? el('span', { class: 'badge badge-warn', text: result.outcome === 'skipped' ? 'Skipped' : 'Time up' })
    : el('span', { class: `badge ${result.efficiency >= 1 ? 'badge-ok' : result.efficiency >= UNLOCK_THRESHOLD ? 'badge-mid' : 'badge-warn'}`, text: pct(result.efficiency) });

  return el('section', { class: 'explain gm-explain', 'aria-label': 'How to solve this trial' },
    study
      ? el('p', { class: 'muted', text: `${puzzle.length} cells to remember, with a side question after each.` })
      : el('div', { class: 'result-line' }, badge, el('p', { text: ex.summary })),
    el('h3', { text: study ? 'The sequence' : 'The sequence and your answer' }),
    el('div', { class: 'explain-body' },
      el('div', { class: 'explain-board' },
        holder,
        el('div', { class: 'gm-legend' },
          el('span', {}, el('span', { class: 'gm-key gm-key-dot', 'aria-hidden': 'true' }), ' Circles, solid line: correct order'),
          study ? null : el('span', {}, el('span', { class: 'gm-key gm-key-sq', 'aria-hidden': 'true' }), ' Squares, dashed line: your taps (cross = wrong)'),
        ),
        study ? null : el('div', { class: 'replay-controls' }, toggle('showCorrect', 'Correct path'), toggle('showYours', 'Your taps')),
      ),
      el('div', { class: 'explain-steps' },
        study ? null : el('p', { class: 'step-reason', text: ex.divergence }),
        study ? null : el('div', { class: 'table-wrap' },
          el('table', { class: 'results gm-positions' },
            el('caption', { class: 'sr-only', text: 'Recall by position' }),
            el('thead', {}, el('tr', {}, ['#', 'Correct', 'You', 'Result'].map((h) => el('th', { scope: 'col', text: h })))),
            el('tbody', {}, ex.positions.map((p) => el('tr', {},
              el('td', { text: String(p.i + 1) }),
              el('td', { text: `${p.expectedLabel} ${landmark(puzzle.n, p.expected)}` }),
              el('td', { text: p.gotLabel }),
              el('td', {}, el('span', { class: `badge ${STATUS_BADGE[p.status]}`, text: STATUS_WORD[p.status] }), ` ${p.status === 'order' ? `(cell ${p.belongsAt + 1})` : ''}`),
            ))),
          ),
        ),
        el('h4', { text: 'The path in words' }),
        el('ol', { class: 'step-list' }, ex.path.steps.map((s) => el('li', { text: s.text }))),
      ),
    ),
    el('h3', { text: 'Side questions' }),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'results gm-sides' },
        el('caption', { class: 'sr-only', text: 'Side questions with answers and reasons' }),
        el('thead', {}, el('tr', {}, (study ? ['#', 'Question', 'Answer', 'Why'] : ['#', 'Question', 'Answer', 'You', 'Time', 'Why']).map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, ex.side.map((r) => el('tr', {},
          el('td', { text: String(r.i + 1) }),
          el('td', { text: r.question }),
          el('td', { text: answerWord(r.correct) }),
          study ? null : el('td', {}, r.given === null ? 'not reached' : el('span', { class: `badge ${r.ok ? 'badge-ok' : 'badge-warn'}`, text: `${answerWord(r.given)}${r.ok ? '' : ' (wrong)'}` })),
          study ? null : el('td', { text: r.given && r.given !== 'miss' ? fmtSec(r.rt) : '' }),
          el('td', { text: r.reason }),
        ))),
      ),
    ),
    study ? null : el('details', { class: 'strategy', open: true },
      el('summary', {}, 'Memory tips for this trial'),
      el('ul', {}, ex.tips.map((t) => el('li', { text: t }))),
    ),
    el('details', { class: 'strategy' },
      el('summary', {}, 'Strategy checklist'),
      el('ul', {}, STRATEGY.map((t) => el('li', { text: t }))),
    ),
    el('p', { class: 'muted small', text: `Cells are named (row,column), counted from the top left corner. Each position is worth ${POINTS.recall} points and each side question ${POINTS.side}.` }),
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

function coachHost(attempt, puzzle) {
  let res;
  try {
    res = coachTrial(attempt, puzzle, { history: recorder.attempts({ game: GAME_ID, set: attempt.set }) });
    noteAttempt(GAME_ID, attempt, res.findings, puzzle);
  } catch (err) {
    console.error(err);
    return el('section', { class: 'coach' }, el('h3', { text: 'Coach' }), el('p', { class: 'muted', text: 'The coach could not review this attempt.' }));
  }
  const r = res.result;
  const cells = [
    ['Time', fmtSec(attempt.metrics.totalMs)],
    ['Recall', `${r.recall.correct} / ${r.recall.total}`],
    ['Side', `${r.side.correct} / ${r.side.total}`],
    ['Side median', fmtSec(res.sideRtMedian)],
    ['Per cell', fmtSec(res.timing.perItemMs)],
    ['Score', pct(r.efficiency)],
  ];
  return el('section', { class: 'coach', 'aria-label': 'Coach' },
    el('h3', { text: 'Coach' }),
    el('dl', { class: 'metric-strip' }, cells.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v })))),
    el('ul', { class: 'findings', role: 'list' }, res.findings.map(findingItem)),
  );
}

// ---------------------------------------------------------------- menu

function setMeta(cfg) {
  return `${cfg.n}x${cfg.n} grid, sequences of ${cfg.lengths[0]} to ${cfg.lengths[1]} cells, side questions: ${cfg.kinds.map((k) => KIND_NAMES[k]).join(' and ')}. ` +
    `Each cell shows for ${(cfg.showMs / 1000).toFixed(1)} s; ${cfg.windowMs / 1000} s to answer each side question.`;
}

function renderMenu(ctx) {
  const { root } = ctx;
  const unlockToggle = el('input', {
    type: 'checkbox',
    id: 'gm-unlock-all',
    onchange: (e) => {
      store.setUnlockAll(e.target.checked);
      ctx.rerender();
    },
  });
  unlockToggle.checked = store.unlockAll();

  root.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Grid Memory' }),
      el('p', { class: 'lede' },
        'Cells of a grid light up one at a time. After each one, answer a quick side question before the window closes. ',
        'At the end, tap the cells in the order they lit. Holding the path in mind while you judge something else is the skill being trained.'),
    ),
    el('div', { class: 'mode-explainer' },
      el('div', {}, el('h2', { text: 'Practice' }), el('p', { text: 'One trial at a time, no run clock, with undo and hints at recall and an optional relaxed mode with no side question window. Afterwards the coach reviews your answers and the path is shown with where you diverged.' })),
      el('div', {}, el('h2', { text: 'Timed run (exam mode)' }), el('p', { text: '6:00 of trials. Pass a trial (every position right, at most 1 side error) and the next is one cell longer; miss and it is one shorter. No undo, no hints, skips are final. Score is the sum of trial scores; your span is the longest length you passed.' })),
    ),
    el('div', { class: 'toolbar' },
      el('label', { class: 'toggle gm-unlock', for: 'gm-unlock-all' }, unlockToggle, ' Unlock all sets'),
      el('a', { class: 'btn', href: '#/analytics' }, 'Progress and analytics'),
    ),
    el('p', { class: 'muted small', text: `Scoring: each position recalled in the right place earns ${POINTS.recall} points and each side question answered right earns ${POINTS.side}; a trial's score is points out of the maximum. Reach ${pct(UNLOCK_THRESHOLD)} average in a set to unlock the next.` }),
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
    const label = best === undefined ? `Trial ${k}, not played` : `Trial ${k}, best score ${pct(best)}`;
    chips.push(
      open
        ? el('a', { class: `chip${best >= 1 ? ' chip-perfect' : best > 0 ? ' chip-done' : ''}`, href: `#/gridmemory/practice/${cfg.set}/${k}`, 'aria-label': label, title: label }, String(k))
        : el('span', { class: 'chip chip-locked', 'aria-hidden': 'true' }, String(k)),
    );
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
        el('div', { class: 'chips', role: 'group', 'aria-label': `Practice trials in set ${cfg.set}` }, chips),
        el('a', { class: 'btn btn-primary', href: `#/gridmemory/run/${cfg.set}` }, 'Start timed run (6:00)'),
        studyLink(GAME_ID, cfg.set),
      )
      : el('p', { class: 'muted', text: `Reach ${pct(UNLOCK_THRESHOLD)} average in set ${cfg.set - 1} (timed run, or practice bests across all its trials) to unlock, or tick Unlock all sets.` }),
  );
}

function lockedNotice(root, setNo) {
  root.append(
    el('section', { class: 'prose' },
      el('h1', { text: `Set ${setNo} is locked` }),
      el('p', { text: `Reach ${pct(UNLOCK_THRESHOLD)} average in set ${setNo - 1}, or turn on Unlock all sets.` }),
      el('p', {}, el('a', { class: 'btn', href: '#/gridmemory' }, 'Back to sets')),
    ),
  );
}

// ---------------------------------------------------------------- practice

// retry: a puzzle handed over by the review library (any set or source), played blind.
async function renderPractice(ctx, setNo, k, retry = null) {
  const { root } = ctx;
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg || (!retry && !(k >= 1 && k <= PUZZLES_PER_SET))) {
    root.append(el('p', { class: 'notice' }, 'Unknown trial. ', el('a', { href: '#/gridmemory' }, 'Back to sets')));
    return;
  }
  if (!retry && !isUnlocked(setNo)) return lockedNotice(root, setNo);
  const puzzle = retry ? retry.puzzle : (await loadSet(setNo)).puzzles[k - 1];

  const after = el('div', { class: 'after' });
  const prevLink = !retry && k > 1 ? el('a', { class: 'btn btn-quiet', href: `#/gridmemory/practice/${setNo}/${k - 1}` }, 'Previous trial') : null;
  const nextHref = retry ? retry.returnHash : k < PUZZLES_PER_SET ? `#/gridmemory/practice/${setNo}/${k + 1}` : '#/gridmemory';
  const nextLabel = retry ? 'Compare with the optimal solution' : k < PUZZLES_PER_SET ? 'Next trial' : 'Back to sets';
  const host = el('div', {});
  let area = null;
  let startedAt = 0;

  // A trial that was started but not finished is saved as skipped (End and review, leaving).
  function saveUnfinished() {
    if (retry || !area || !startedAt || area.trial.phase === 'ready' || area.trial.done) return false;
    const attempt = buildAttempt(area.forceSkip(), { set: setNo, mode: 'practice', source: relaxedPractice ? 'relaxed' : 'pool', startedAt });
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

  const relaxedBox = el('input', {
    type: 'checkbox',
    id: 'gm-relaxed',
    onchange: (e) => {
      relaxedPractice = e.target.checked;
      start();
    },
  });
  relaxedBox.checked = relaxedPractice;

  function start() {
    area?.destroy();
    after.replaceChildren();
    startedAt = 0;
    area = createTrialArea(puzzle, {
      mode: 'practice',
      relaxed: relaxedPractice,
      onBegin: (t) => (startedAt = t),
      onDone: (trial) => finish(trial),
    });
    host.replaceChildren(area.root);
  }

  function finish(trial) {
    const attempt = buildAttempt(trial, { set: setNo, mode: 'practice', source: retry ? 'review' : relaxedPractice ? 'relaxed' : 'pool', startedAt: startedAt || Date.now() });
    stampDvs(GAME_ID, attempt, puzzle);
    recorder.saveAttempt(attempt);
    resume().clear(GAME_ID, 'practice');
    if (retry) {
      // Retrieval first: grade and reschedule now, compare with the optimal solution on the review page.
      completeRetry(GAME_ID, attempt);
      after.replaceChildren(
        el('div', { class: 'after-actions' }, el('a', { class: 'btn btn-primary', href: nextHref }, nextLabel)),
        dvsPanel(GAME_ID, attempt, puzzle),
        coachHost(attempt, puzzle),
      );
      after.querySelector('.after-actions .btn-primary')?.focus({ preventScroll: true });
      return;
    }
    store.recordPractice(GAME_ID, setNo, puzzle.id, attempt.metrics.efficiency);
    after.replaceChildren(
      el('div', { class: 'after-actions' },
        el('button', { type: 'button', class: 'btn', onclick: () => start() }, 'Try again'),
        el('a', { class: 'btn btn-primary', href: nextHref }, nextLabel),
      ),
      dvsPanel(GAME_ID, attempt, puzzle),
      coachHost(attempt, puzzle),
      trackExplain(createExplainPanel(puzzle, trial), attempt),
    );
    after.querySelector('.after-actions .btn-primary')?.focus({ preventScroll: true });
    after.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  root.append(
    el('div', { class: 'page-head play-head' },
      el('p', { class: 'crumbs' }, el('a', { href: '#/gridmemory' }, 'Grid Memory'), ` / Set ${setNo}: ${cfg.name}`),
      el('h1', {}, retry ? 'Review: solve it again before you look' : `Practice: trial ${k} of ${PUZZLES_PER_SET}`),
      el('p', { class: 'muted' }, `${puzzle.length} cells on a ${cfg.n}x${cfg.n} grid. No run clock in practice mode.`),
      el('label', { class: 'toggle', for: 'gm-relaxed' }, relaxedBox, ' Relaxed: no time limit on side questions'),
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

async function renderRun(ctx, setNo) {
  const { root } = ctx;
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg) {
    root.append(el('p', { class: 'notice' }, 'Unknown set. ', el('a', { href: '#/gridmemory' }, 'Back to sets')));
    return;
  }
  if (!isUnlocked(setNo)) return lockedNotice(root, setNo);
  const data = await loadSet(setNo);

  const head = el('div', { class: 'page-head play-head' },
    el('p', { class: 'crumbs' }, el('a', { href: '#/gridmemory' }, 'Grid Memory'), ` / Set ${setNo}: ${cfg.name}`),
    el('h1', {}, 'Timed run'),
  );
  const body = el('div', {});
  root.append(head, body);

  let timer = null;
  let area = null;
  let tutorialArea = null;
  let finished = false;
  let advanceHandle = null;
  let staircase = null;
  let source = null;
  let current = null;
  let runSeed = 0;
  let runId = null;
  let startedAt = 0;
  let unguard = null;
  const results = [];
  ctx.onDispose(() => {
    timer?.stop();
    area?.destroy();
    tutorialArea?.destroy();
    clearTimeout(advanceHandle);
    setExamChrome(false);
  });

  // ---- pre-run tutorial
  const sample = tutorialTrial(cfg);
  const startBtn = el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => begin() }, 'I am ready: start the 6:00 run');
  const tutorialSlot = el('span', { class: 'hud-slot' });
  const tutorialHud = el('div', { class: 'exam-hud is-tutorial' },
    el('span', { class: 'clock', 'aria-label': 'Time left (not running in the sample)' }, '6:00'),
    el('span', { class: 'run-progress', text: 'Sample' }), tutorialSlot);
  const tutorialMsg = el('p', { class: 'flash', role: 'status' });
  const tutorialHost = el('div', {});
  function startTutorial() {
    tutorialArea?.destroy();
    tutorialMsg.textContent = '';
    tutorialArea = createTrialArea(sample, {
      mode: 'exam',
      onDone: (trial) => {
        const r = trial.result();
        tutorialMsg.textContent = trial.outcome === 'skipped'
          ? 'Skipped. In the run a skip scores 0, counts as a miss, and the next trial starts at once.'
          : `Recall ${r.recall.correct} of ${r.recall.total}, side questions ${r.side.correct} of ${r.side.total}: this trial would score ${pct(r.efficiency)}${r.success ? ' and the next one would be 1 cell longer' : ' and the next one would be 1 cell shorter'}.`;
      },
    });
    tutorialSlot.replaceChildren(...tutorialArea.hudItems);
    tutorialHost.replaceChildren(tutorialArea.root);
  }
  const sec = trialSeconds(cfg, cfg.lengths[0]);
  body.append(
    el('section', { class: 'run-intro' },
      el('h2', { text: 'Before you start' }),
      el('ol', { class: 'exam-rules' },
        el('li', {}, el('strong', { text: '6:00 on the clock. ' }), 'Trials keep coming until time is up: first this set\'s 10 trials as their lengths come up, then freshly generated ones.'),
        el('li', {}, el('strong', { text: 'Watch, judge, remember. ' }), `Cells light one at a time on a ${cfg.n}x${cfg.n} grid. After each one answer the side question (${cfg.kinds.map((k) => KIND_NAMES[k]).join(', or ')}) within ${cfg.windowMs / 1000} s.`),
        el('li', {}, el('strong', { text: 'Recall in order. ' }), 'Tap the cells in the order they lit. The trial submits itself when every cell is entered. No undo, no hints.'),
        el('li', {}, el('strong', { text: 'Staircase. ' }), `The first trial has ${cfg.lengths[0]} cells. Pass (every position right, at most 1 side error) and the next is 1 longer; otherwise 1 shorter. Your span is the longest length you pass.`),
        el('li', {}, el('strong', { text: 'Score: ' }), `${POINTS.recall} points per position in the right place, ${POINTS.side} per side question right, as a share of the maximum. The run score is the sum.`),
        el('li', {}, el('strong', { text: 'Skip is final. ' }), 'A skipped trial scores 0 and counts as a miss; a best guess always scores at least as much.'),
        el('li', {}, el('strong', { text: 'Pace: ' }), `a ${cfg.lengths[0]}-cell trial takes about ${sec} s.`),
        el('li', {}, el('strong', { text: 'Afterwards: ' }), 'the coach reviews every trial and the whole run. End and review stops the run at any point and shows your score so far; leaving the page saves it the same way. Runs ended early count toward progress and review but not the leaderboard.'),
      ),
      el('h3', { text: 'Try the sample trial (untimed, not scored)' }),
      el('p', { class: 'muted', text: 'This is the exact exam screen: grid, side questions, clock and Skip.' }),
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
  const hudSlot = el('span', { class: 'hud-slot' });
  const announcer = el('p', { class: 'sr-only', 'aria-live': 'assertive' });
  const host = el('div', {});
  const flash = el('p', { class: 'flash', role: 'status' });
  const endBtn = endButton({ game: GAME_ID, onEnd: (exit) => finish(exit) });
  let warned60 = false;
  let warned10 = false;

  function buildRun() {
    const run = summarizeRun({ id: runId, game: GAME_ID, set: setNo, seed: runSeed, startedAt, endedAt: Date.now(), budgetMs: RUN_MS, attempts: results.map((r) => r.attempt) });
    run.maxSpan = staircase.maxSpan;
    run.trail = staircase.trail;
    return run;
  }
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
    staircase = createStaircase({ start: cfg.lengths[0], max: cfg.runMax });
    source = createRunSource({ puzzles: data.puzzles, cfg, seed: runSeed });
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
    area?.destroy();
    const { puzzle, source: src, index } = source.next(staircase.length);
    current = { puzzle, source: src, index, startedAt: Date.now(), done: false };
    area = createTrialArea(puzzle, { mode: 'exam', autoStart: true, onBegin: (t) => (current.startedAt = t), onDone: (trial) => record(trial) });
    hudSlot.replaceChildren(...area.hudItems);
    host.replaceChildren(area.root);
    progress.textContent = `Trial ${index + 1}`;
    area.focus();
  }

  function record(trial) {
    if (!current || current.done) return;
    current.done = true;
    const attempt = buildAttempt(trial, { set: setNo, mode: 'exam', runId, source: current.source, startedAt: current.startedAt });
    stampDvs(GAME_ID, attempt, current.puzzle);
    recorder.saveAttempt(attempt);
    const r = trial.result();
    results.push({ attempt, puzzle: current.puzzle, source: current.source, index: current.index, trial, result: r });
    if (trial.outcome === 'timeout') return;
    const before = staircase.length;
    const next = staircase.update(r.success);
    flash.textContent = trial.outcome === 'skipped'
      ? `Skipped trial ${current.index + 1}. Next length ${next}.`
      : `${r.success ? 'Passed' : 'Missed'} at length ${before}. Next length ${next}.`;
    advanceHandle = setTimeout(showNext, 700);
  }

  // exit: 'time' (clock ran out), 'early' (End and review), 'nav' or 'unload' (left the page).
  function finish(exit = 'time') {
    if (finished) return;
    finished = true;
    clearTimeout(advanceHandle);
    timer?.stop();
    unguard?.();
    // Ended early: a trial that had not started yet counts as not attempted.
    if (area && current && !current.done && (exit === 'time' || area.trial.phase !== 'ready')) record(area.forceTimeout());
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
    // Leaving the page: save to the review library without the coach, and render nothing.
    if (isLeave(exit)) {
      noteRun(GAME_ID, run, results.map((r) => r.attempt), [], puzzlesById);
      return;
    }
    const history = recorder.attempts({ game: GAME_ID, set: setNo });
    const runCoach = coachRun(run, results.map((r) => r.attempt), puzzlesById, { budgetMs: RUN_MS, history });
    noteRun(GAME_ID, run, results.map((r) => r.attempt), runCoach.perTrial, puzzlesById);
    const partial = isPartial(run);
    const [takeawaysNode, notAttemptedNode] = runLearning({ game: GAME_ID, run, attempts: results.map((r) => r.attempt), habits: runCoach.habits, perPuzzle: runCoach.perTrial, pool: data.puzzles, solve: studyWalkthrough, onDispose: ctx.onDispose, label: 'trial' });

    const review = el('div', { class: 'review-host' });
    const rows = results.map((r) => {
      const label = r.trial.outcome === 'submitted' ? (r.result.success ? 'Passed' : 'Missed') : r.trial.outcome === 'timeout' ? 'Time up' : 'Skipped';
      return el('tr', {},
        el('td', { text: String(r.index + 1) }),
        el('td', { text: String(r.puzzle.length) }),
        el('td', {}, el('span', { class: `badge ${label === 'Passed' ? 'badge-ok' : label === 'Missed' ? 'badge-mid' : 'badge-warn'}`, text: label })),
        el('td', { text: `${r.result.recall.correct} / ${r.result.recall.total}` }),
        el('td', { text: `${r.result.side.correct} / ${r.result.side.total}` }),
        el('td', { text: pct(r.attempt.metrics.efficiency) }),
        el('td', { text: fmtSec(r.attempt.metrics.totalMs) }),
        el('td', {},
          el('button', {
            type: 'button',
            class: 'btn btn-small',
            onclick: () => {
              review.replaceChildren(
                el('h3', { text: `Trial ${r.index + 1}, length ${r.puzzle.length}${r.source === 'pool' ? '' : ' (freshly generated)'}` }),
                coachHost(r.attempt, r.puzzle),
                trackExplain(createExplainPanel(r.puzzle, r.trial), r.attempt),
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
        partialBanner(run, { label: 'trial' }),
        el('div', { class: 'score-tiles' },
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Span reached' }), el('strong', { text: run.maxSpan ? String(run.maxSpan) : 'none' })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Run score' }), el('strong', { text: round2(run.score).toFixed(2) })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Average' }), el('strong', { text: `${pct(avg)} of ${slots}` })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Best for this set' }), el('strong', { text: `${round2(best).toFixed(2)}${improved ? ' (new best)' : ''}` })),
        ),
        el('ol', { class: 'gm-trail', 'aria-label': 'Staircase: length of each trial and whether it passed' },
          run.trail.map((s) => el('li', { class: s.success ? 'is-pass' : 'is-miss', style: { '--len': s.length } },
            el('span', { class: 'gm-trail-bar', 'aria-hidden': 'true' }),
            el('span', { class: 'gm-trail-label', text: `${s.length} ${s.success ? 'pass' : 'miss'}` })))),
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
                el('strong', { text: h.label }), ` (in ${h.count} of ${h.of} trials). `, h.tip))))
            : el('p', { class: 'muted', text: 'No repeated habit to fix in this run.' }),
        ),
        el('div', { class: 'table-wrap' },
          el('table', { class: 'results' },
            el('caption', { class: 'sr-only', text: 'Results per trial' }),
            el('thead', {}, el('tr', {}, ['#', 'Length', 'Result', 'Recall', 'Side', 'Score', 'Time', 'Coach and answer'].map((h) => el('th', { scope: 'col', text: h })))),
            el('tbody', {}, rows),
          ),
        ),
        dvsRunSection(GAME_ID, results.map((r) => ({ attempt: r.attempt, puzzle: r.puzzle }))),
        notAttemptedNode,
        el('div', { class: 'after-actions' },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => ctx.rerender() }, 'Run again'),
          studyLink(GAME_ID, setNo),
          el('a', { class: 'btn', href: '#/analytics' }, 'Progress and analytics'),
          el('a', { class: 'btn', href: '#/gridmemory' }, 'Back to sets'),
        ),
        review,
      ),
    );
    body.querySelector('h2')?.setAttribute('tabindex', '-1');
    body.querySelector('h2')?.focus();
  }
}

// ---------------------------------------------------------------- review library hooks

function renderRetry(ctx) {
  const r = peekRetry(GAME_ID);
  if (!r?.puzzle) {
    ctx.root.append(el('p', { class: 'notice' }, 'No review puzzle is waiting. ', el('a', { href: '#/review/gridmemory' }, 'Open the Grid Memory review library')));
    return null;
  }
  return renderPractice(ctx, r.set, 0, r);
}

// Watch mode on the review page: the worked solution, with the original result line.
export function reviewWalkthrough(puzzle, attempt) {
  const r = reviewAttempt(attempt, puzzle);
  return createExplainPanel(puzzle, { result: () => r.result, answers: r.log.answers, recall: r.log.recall, hinted: r.log.hinted });
}

// Study mode: the sequence and side answers for a trial nobody played yet (no result line).
export function studyWalkthrough(puzzle, onDispose = () => {}) {
  void onDispose;
  return createExplainPanel(puzzle, null);
}

// ---------------------------------------------------------------- entry

export async function mountGridMemory(main, args = []) {
  ensureCss();
  const root = el('div', { class: 'gridmemory' });
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
      else root.append(el('p', { class: 'notice' }, 'Unknown page. ', el('a', { href: '#/gridmemory' }, 'Back to Grid Memory')));
    } catch (err) {
      console.error(err);
      root.replaceChildren(el('p', { class: 'notice' }, `Could not load the trial: ${err.message}. If you opened the file directly, serve the folder over http (python3 -m http.server).`));
    }
  }
  await draw();
  return disposeAll;
}

