// Latin Square UI: set menu, practice mode, timed test, coach and the step-by-step
// explanation. All rules live in state.js and solver.js; this file only renders and wires input.
// Every attempt is logged through the core recorder and reviewed by coach.js.

import { el } from '../../core/dom.js';
import { gameStart, setActions, setListHead, lockedHint, lockedPage, progressLine, unlockToggle, trackModes, timedNudge, runModeNote, practiceTitle } from '../../core/start-ui.js';
import { practicePuzzle, runSetup, seenFilter, markSeen, isFreshArg } from '../../core/fresh-play.js';
import { runExtras } from '../../core/board.js';
import { Countdown, formatClock } from '../../core/timer.js';
import { createStore } from '../../core/store.js';
import { createRecorder, createAttemptLog, summarizeRun, newId } from '../../core/recorder.js';
import { efficiency, averageEfficiency, pct, round2, UNLOCK_THRESHOLD } from '../../core/score.js';
import { SYMBOLS, createGame, parsePuzzle, cellLabel, rowOf, colOf, BLANK, examPoints, examRunScore } from './state.js';
import { analyse, explainPuzzle, wrongPickReason, resultSummary, STRATEGY, symName } from './explain.js';
import { SET_CONFIGS, PUZZLES_PER_SET } from './gen.js';
import { createRunStream, freshKit, TUTORIAL_PUZZLE } from './stream.js';
import { coachPuzzle, coachRun } from './coach.js';
import { noteAttempt, noteRun, trackExplain, peekRetry, completeRetry, stampDvs } from '../../core/learn-hooks.js';
import { dvsPanel, dvsRunSection } from '../../core/dvs-ui.js';
import { endButton, guardRun, saveEndedRun, isLeave, isPartial, partialBanner, runLearning, studyLink, resume } from '../../core/endrun-ui.js';
import { effectiveOutcome } from './coach.js';

const GAME_ID = 'latinsquare';
const RUN_MS = 6 * 60 * 1000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const KEY_MOVES = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

const store = createStore();
const recorder = createRecorder();
const setCache = new Map();

function ensureStyles() {
  if (typeof document === 'undefined' || document.querySelector('link[data-game-css="latinsquare"]')) return;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('../../../css/latinsquare.css', import.meta.url).href, 'data-game-css': 'latinsquare' }));
}

function loadSet(setNo) {
  if (!setCache.has(setNo)) {
    const url = new URL(`../../../data/sets/latinsquare/set${setNo}.json`, import.meta.url);
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

function puzzleId(setNo, k) {
  return `ls${setNo}-${String(k).padStart(2, '0')}`;
}

function isUnlocked(setNo) {
  return store.isUnlocked(GAME_ID, setNo, PUZZLES_PER_SET);
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// The core recorder knows solved, skipped and timeout. A wrong timed-run answer is stored as
// skipped (no credit); coach.effectiveOutcome() reads it back from the log.
function recorderOutcome(status) {
  return status === 'solved' ? 'solved' : status === 'timeout' ? 'timeout' : 'skipped';
}

// ---------------------------------------------------------------- symbols

const SHAPES = {
  circle: ['circle', { cx: 50, cy: 50, r: 36 }],
  square: ['rect', { x: 16, y: 16, width: 68, height: 68, rx: 4 }],
  triangle: ['polygon', { points: '50,10 90,84 10,84' }],
  diamond: ['polygon', { points: '50,6 94,50 50,94 6,50' }],
  plus: ['polygon', { points: '37,10 63,10 63,37 90,37 90,63 63,63 63,90 37,90 37,63 10,63 10,37 37,37' }],
  heart: ['path', { d: 'M50 88 C22 68 8 50 14 32 C20 14 42 12 50 30 C58 12 80 14 86 32 C92 50 78 68 50 88 Z' }],
};

function symbolSvg(sym) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', `ls-shape ls-shape-${sym.id}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const [tag, attrs] = SHAPES[sym.id];
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  svg.append(node);
  return svg;
}

function symbolBadge(sym, { withName = false } = {}) {
  return el('span', { class: `ls-sym sym-${sym.id}` },
    symbolSvg(sym),
    el('span', { class: 'ls-letter', 'aria-hidden': 'true', text: sym.letter }),
    withName ? el('span', { class: 'ls-sym-name', text: sym.name }) : null,
  );
}

// ---------------------------------------------------------------- grid view

// interactive grids use a roving tabindex: one Tab stop, arrow keys move between cells.
function createGridView(P, { interactive = false, small = false, label = 'Latin Square grid' } = {}) {
  const { n } = P;
  const grid = el('div', {
    class: `ls-grid${small ? ' is-small' : ''}`,
    style: { '--n': n },
    role: interactive ? 'grid' : 'img',
    'aria-label': label,
  });
  const cells = [];
  for (let r = 0; r < n; r++) {
    const row = el('div', { class: 'ls-row', role: interactive ? 'row' : null });
    for (let c = 0; c < n; c++) {
      const cell = r * n + c;
      const node = el('div', {
        class: 'ls-cell',
        'data-cell': cell,
        role: interactive ? 'gridcell' : null,
        tabindex: interactive ? '-1' : null,
      });
      cells.push(node);
      row.append(node);
    }
    grid.append(row);
  }

  // state: { valueAt(cell), targets: [cell], selected, focus, rows, cols, cited, current, derived: Set, flash }
  function update(state) {
    const targets = state.targets ?? P.targets;
    const rows = new Set(state.rows ?? (state.selected !== null && state.selected !== undefined ? [rowOf(n, state.selected)] : []));
    const cols = new Set(state.cols ?? (state.selected !== null && state.selected !== undefined ? [colOf(n, state.selected)] : []));
    const cited = new Set(state.cited ?? []);
    cells.forEach((node, cell) => {
      const v = state.valueAt(cell);
      const isTarget = targets.includes(cell);
      const derived = state.derived?.has(cell) ?? false;
      const given = P.grid[cell] !== BLANK;
      const key = `${v}|${isTarget}|${derived}`;
      if (node.dataset.key !== key) {
        node.dataset.key = key;
        node.replaceChildren();
        if (v !== BLANK) node.append(symbolBadge(P.symbols[v]));
        else if (isTarget) node.append(el('span', { class: 'ls-q', 'aria-hidden': 'true', text: '?' }));
      }
      node.classList.toggle('is-given', given);
      node.classList.toggle('is-target', isTarget);
      node.classList.toggle('is-answered', isTarget && v !== BLANK);
      node.classList.toggle('is-derived', derived);
      node.classList.toggle('in-line', rows.has(rowOf(n, cell)) || cols.has(colOf(n, cell)));
      node.classList.toggle('is-cited', cited.has(cell));
      node.classList.toggle('is-current', state.current === cell);
      node.classList.toggle('is-selected', state.selected === cell);
      node.classList.toggle('is-flash', state.flash === cell);
      if (interactive) {
        node.setAttribute('tabindex', state.focus === cell ? '0' : '-1');
        node.setAttribute('aria-selected', state.selected === cell ? 'true' : 'false');
      }
      const what = v !== BLANK
        ? `${P.symbols[v].name}${isTarget ? ', your answer' : derived ? ', worked out' : ''}`
        : isTarget ? 'question mark, the cell to solve' : 'blank';
      node.setAttribute('aria-label', `Row ${rowOf(n, cell) + 1}, column ${colOf(n, cell) + 1}: ${what}`);
    });
  }

  return { root: el('div', { class: `ls-grid-wrap${small ? ' is-small' : ''}` }, grid), grid, cells, update };
}

// ---------------------------------------------------------------- play area (one puzzle)

// opts: { mode: 'practice'|'exam', log, onDone(game, { hintsUsed }), sample }
// Exam mode has no hints and no feedback on right or wrong; its answer counter and Skip button are
// returned in hudItems for the caller to place next to the clock.
function createPlayArea(puzzle, opts) {
  const exam = opts.mode === 'exam';
  const log = opts.log ?? null;
  const game = createGame(puzzle, { mode: opts.mode });
  const P = game.parsed;
  const { n } = P;
  const A = analyse(puzzle);
  const steps = exam ? [] : explainPuzzle(puzzle, A).steps;
  let focus = P.targets[0];
  let flash = null;
  let hintStep = null;
  let hintsUsed = 0;

  const view = createGridView(P, {
    interactive: true,
    label: `Latin Square, ${n} by ${n}. Each symbol appears once in every row and column. ${P.targets.length === 1 ? 'Find the symbol for the question mark cell' : `Find the symbols for the ${P.targets.length} question mark cells`}.`,
  });
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' });
  const message = el('p', { class: 'play-message', role: 'status' });
  const targetOut = el('strong', { class: 'stat-value' });
  const picksOut = el('strong', { class: 'stat-value', text: '0' });

  const palette = el('div', { class: 'ls-palette', role: 'group', 'aria-label': 'Symbols: pick one for the selected question mark cell' });
  const palButtons = P.symbols.map((sym, i) => {
    const b = el('button', { type: 'button', class: 'ls-pal-btn', 'data-sym': i, onclick: () => doPick(i) },
      symbolBadge(sym, { withName: true }),
      el('span', { class: 'ls-key', 'aria-hidden': 'true', text: String(i + 1) }),
    );
    palette.append(b);
    return b;
  });

  const hintBtn = exam ? null : el('button', { type: 'button', class: 'btn', onclick: () => doHint() }, 'Hint');
  const skipBtn = el('button', { type: 'button', class: 'btn btn-warn', onclick: () => doSkip() }, exam ? 'Skip' : 'Skip and show solution');
  const stats = el('div', { class: 'stats' },
    el('span', { class: 'stat' }, P.targets.length > 1 ? 'Answer ' : 'Cells to solve ', targetOut),
    exam ? null : el('span', { class: 'stat' }, 'Picks ', picksOut),
  );

  const root = exam
    ? el('div', { class: 'play-area is-exam ls-play' }, el('div', { class: 'board-col' }, view.root, palette, message, live))
    : el('div', { class: 'play-area ls-play' },
      el('div', { class: 'board-col' }, view.root, palette),
      el('div', { class: 'side-col' },
        stats,
        el('div', { class: 'controls' }, hintBtn, skipBtn),
        message,
        live,
        el('details', { class: 'help' },
          el('summary', {}, 'Controls'),
          el('ul', {},
            el('li', {}, 'Tap a symbol, or press its number (1 to ', String(n), ') or its letter, to answer the selected ? cell.'),
            el('li', {}, 'Tap or click any cell to light up its row and column. Arrow keys move around the grid, Enter selects.'),
            el('li', {}, 'With two ? cells, select the one you want to answer first.'),
            el('li', {}, 'A wrong pick is crossed out with the reason; pick again.'),
          ),
        ),
      ),
    );

  function say(text) {
    live.textContent = '';
    requestAnimationFrame(() => (live.textContent = text));
  }

  function selectCell(cell) {
    const before = game.selected;
    game.select(cell);
    if (game.selected !== before) log?.select(game.selected);
  }

  function render() {
    const hint = hintStep;
    view.update({
      valueAt: (cell) => game.valueAt(cell),
      selected: game.selected,
      focus,
      rows: hint ? hint.focus.rows : undefined,
      cols: hint ? hint.focus.cols : undefined,
      cited: hint ? hint.focus.cited : [],
      current: hint ? hint.cell : null,
      flash,
    });
    const t = game.activeTarget;
    const answered = P.targets.filter((_, k) => game.filledAt(k) !== BLANK).length;
    targetOut.textContent = P.targets.length > 1 ? `${Math.min(P.targets.length, answered + 1)} of ${P.targets.length}` : '1';
    picksOut.textContent = String(game.pickCount);
    palButtons.forEach((b, i) => {
      const ruled = t >= 0 && game.isRuledOut(t, i);
      b.classList.toggle('is-ruled', ruled);
      b.disabled = !game.playing || ruled;
      b.setAttribute('aria-label', `${P.symbols[i].name}, key ${i + 1}${ruled ? ', ruled out' : ''}`);
    });
    if (hintBtn) hintBtn.disabled = !game.playing;
    skipBtn.disabled = !game.playing;
  }

  function doPick(sym) {
    if (!game.playing) return;
    const t = game.activeTarget;
    if (t < 0) return;
    const cell = P.targets[t];
    const res = game.pick(sym, t);
    if (!res) return;
    log?.move(sym, t);
    const name = symName(P, sym);
    hintStep = null;
    if (exam) {
      message.textContent = res.done ? 'Answer recorded.' : `Answer recorded. Now ${cellLabel(n, P.targets[game.activeTarget])}.`;
      say(message.textContent);
    } else if (res.ok) {
      message.textContent = `Right: ${cellLabel(n, cell)} is ${name}.`;
      say(message.textContent);
    } else {
      const why = wrongPickReason(A, cell, sym);
      message.textContent = `Not ${name}. ${why.text}`;
      flash = why.cell ?? null;
      say(message.textContent);
    }
    if (!exam && res.ok) flash = null;
    if (game.selected !== null) focus = game.selected;
    render();
    if (res.done) opts.onDone?.(game, { hintsUsed });
  }

  function doSkip() {
    if (game.skip()) {
      hintStep = null;
      render();
      opts.onDone?.(game, { hintsUsed });
    }
  }

  function doHint() {
    if (!game.playing || !hintBtn) return;
    // The next step whose cell is not an already answered target.
    const done = new Set(P.targets.filter((_, t) => game.filledAt(t) !== BLANK));
    const from = hintStep ? hintStep.index + 1 : 0;
    const next = steps.slice(from).find((s) => !done.has(s.cell)) ?? steps.find((s) => !done.has(s.cell));
    if (!next) return;
    hintsUsed++;
    log?.hint();
    hintStep = next;
    message.textContent = `Hint (step ${next.index + 1} of ${steps.length}): ${next.text}`;
    flash = null;
    render();
    say(message.textContent);
  }

  view.grid.addEventListener('click', (e) => {
    const node = e.target.closest('[data-cell]');
    if (!node || !game.playing) return;
    const cell = Number(node.dataset.cell);
    focus = cell;
    selectCell(cell);
    hintStep = null;
    flash = null;
    render();
  });

  function onKey(e) {
    if (!game.playing || e.altKey || e.metaKey || e.ctrlKey) return;
    const active = document.activeElement;
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return;
    const inGrid = active && view.grid.contains(active);
    const mv = KEY_MOVES[e.key];
    if (mv && inGrid) {
      e.preventDefault();
      const r = Math.max(0, Math.min(n - 1, rowOf(n, focus) + mv[0]));
      const c = Math.max(0, Math.min(n - 1, colOf(n, focus) + mv[1]));
      focus = r * n + c;
      selectCell(focus);
      hintStep = null;
      render();
      view.cells[focus].focus();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && inGrid) {
      e.preventDefault();
      selectCell(focus);
      render();
      return;
    }
    if (e.key === 'Escape') {
      hintStep = null;
      flash = null;
      render();
      return;
    }
    const digit = Number(e.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= n) {
      e.preventDefault();
      doPick(digit - 1);
      return;
    }
    const byLetter = P.symbols.findIndex((s) => s.letter === e.key.toUpperCase());
    if (e.key.length === 1 && byLetter >= 0) {
      e.preventDefault();
      doPick(byLetter);
    }
  }
  document.addEventListener('keydown', onKey);

  render();
  return {
    root,
    game,
    hudItems: exam ? [stats, skipBtn] : [],
    get hintsUsed() {
      return hintsUsed;
    },
    focus() {
      view.cells[focus]?.focus({ preventScroll: true });
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
}

// ---------------------------------------------------------------- explanation

function createExplainPanel(puzzle, result) {
  const ex = explainPuzzle(puzzle);
  const P = ex.analysis.P;
  const view = createGridView(P, { small: true, label: 'Worked solution' });
  let k = 0;

  const reason = el('p', { class: 'step-reason', 'aria-live': 'polite' });
  const counter = el('span', { class: 'step-counter' });
  const prevBtn = el('button', { type: 'button', class: 'btn', onclick: () => go(k - 1) }, 'Prev');
  const nextBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => go(k + 1) }, 'Next');
  const startBtn = el('button', { type: 'button', class: 'btn', onclick: () => go(0) }, 'Start');
  const items = ex.steps.map((s, i) =>
    el('li', {}, el('button', { type: 'button', class: 'step-link', onclick: () => go(i + 1) },
      s.isTarget ? el('strong', { text: `? ${s.label}: ` }) : el('span', { text: `Helper ${s.label}: ` }),
      s.text)),
  );

  function go(j) {
    k = Math.max(0, Math.min(ex.steps.length, j));
    const step = k > 0 ? ex.steps[k - 1] : null;
    const shown = new Map(ex.steps.slice(0, k).map((s) => [s.cell, s.value]));
    view.update({
      valueAt: (cell) => (P.grid[cell] !== BLANK ? P.grid[cell] : shown.get(cell) ?? BLANK),
      derived: new Set(shown.keys()),
      targets: P.targets.filter((t) => !shown.has(t)),
      rows: step ? step.focus.rows : [],
      cols: step ? step.focus.cols : [],
      cited: step ? step.focus.cited : [],
      current: step ? step.cell : null,
    });
    counter.textContent = `Step ${k} of ${ex.steps.length}`;
    reason.textContent = step ? `${k}. ${step.text}` : 'The puzzle as given. Press Next to fill one cell at a time.';
    items.forEach((li, i) => li.toggleAttribute('aria-current', i === k - 1));
    prevBtn.disabled = k === 0;
    nextBtn.disabled = k === ex.steps.length;
  }

  // result null: study mode, nothing was played so there is no result line.
  const badge = !result ? null : result.outcome === 'solved'
    ? (result.eff >= 1 ? ['badge-ok', pct(result.eff)] : ['badge-mid', pct(result.eff)])
    : result.outcome === 'wrong' ? ['badge-warn', 'Wrong'] : ['badge-warn', result.outcome === 'timeout' ? 'Time up' : 'Skipped'];
  const panel = el('section', { class: 'explain', 'aria-label': 'How to solve it' },
    badge ? el('div', { class: 'result-line' },
      el('span', { class: `badge ${badge[0]}`, text: badge[1] }),
      el('p', { text: result.text }),
    ) : null,
    result?.dvs ?? null,
    el('h3', { text: 'How to solve it' }),
    el('p', { class: 'ls-answer' }, ex.summary),
    el('div', { class: 'explain-body' },
      el('div', { class: 'explain-board' }, view.root,
        el('div', { class: 'replay-controls' }, startBtn, prevBtn, nextBtn),
        counter),
      el('div', { class: 'explain-steps' },
        reason,
        el('ol', { class: 'step-list' }, items),
      ),
    ),
    el('p', { class: 'muted small', text: 'Cells are named (row,column), counted from the top left. Lit rows and columns are the lines a step reads; outlined cells are the ones it cites; dashed symbols were worked out in an earlier step.' }),
    el('details', { class: 'strategy', open: true },
      el('summary', {}, 'Strategy checklist'),
      el('ul', {}, STRATEGY.map((s) => el('li', { text: s }))),
    ),
  );
  go(0);
  return panel;
}

// ---------------------------------------------------------------- coach panel

const fmtSec = (ms) => (ms === null || ms === undefined ? 'none' : `${(ms / 1000).toFixed(1)} s`);
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

function metricStrip(m, targets) {
  const cells = [
    ['Time', fmtSec(m.totalMs)],
    ['First answer', fmtSec(m.firstMoveMs)],
    ['Picks made', String(m.grossMoves)],
    ['Needed', String(targets)],
  ];
  if (m.hints) cells.push(['Hints', String(m.hints)]);
  return el('dl', { class: 'metric-strip' }, cells.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v }))));
}

function coachHost(attempt, puzzle, paceSec) {
  const host = el('section', { class: 'coach', 'aria-label': 'Coach' },
    el('h3', { text: 'Coach' }),
    metricStrip(attempt.metrics, puzzle.targets.length),
  );
  try {
    const res = coachPuzzle(attempt, puzzle, { history: recorder.attempts({ game: GAME_ID, set: attempt.set }), paceSec });
    noteAttempt(GAME_ID, attempt, res.findings, puzzle);
    host.append(res.findings.length
      ? el('ul', { class: 'findings', role: 'list' }, res.findings.map(findingItem))
      : el('p', { class: 'muted', text: 'Nothing to flag on this puzzle.' }));
  } catch (err) {
    console.error(err);
    host.append(el('p', { class: 'muted', text: 'The coach could not review this attempt.' }));
  }
  return host;
}

// ---------------------------------------------------------------- menu

function rulesBlock() {
  return el('div', { class: 'ls-rules' },
    el('p', { class: 'lede' },
      'Every symbol appears exactly once in each row and each column. Some cells are blank. ',
      'Work out which symbol must go in the cell marked ?, using only the rows and columns.'),
    el('ul', {},
      el('li', {}, el('strong', { text: 'Direct: ' }), 'list what the ? cell\'s row already holds, add its column. If one symbol is left, that is the answer.'),
      el('li', {}, el('strong', { text: 'Chains (set 3 on): ' }), 'when several symbols are left, fill another blank in the same row or column first. Its symbol rules one more out.'),
      el('li', {}, el('strong', { text: 'Symbols: ' }), 'each has its own outline and letter as well as a colour: ', symbolsLegend(), '.'),
    ),
  );
}

function symbolsLegend() {
  return el('span', { class: 'ls-legend' }, SYMBOLS.map((s) => symbolBadge(s, { withName: true })));
}

function renderMenu(ctx) {
  const { root } = ctx;
  trackModes(root, GAME_ID);
  root.append(
    gameStart({
      game: GAME_ID,
      idOf: puzzleId,
      lede: 'Work out which symbol goes in the ? cell: every symbol appears once in each row and column.',
      rules: [rulesBlock()],
      practiceText: 'One puzzle, no clock, with hints. A wrong pick is crossed out with the reason and you pick again. Afterwards the coach reviews your picks and the solution is shown step by step.',
      timedText: '6 minutes on the clock, puzzles keep coming. Each answer is final, no hints, and a skipped puzzle never comes back. Right +1, wrong loses a little, skip 0.',
      setName: (s) => `Set ${s}: ${SET_CONFIGS[s - 1].name}`,
    }),
    setListHead(),
    el('div', { class: 'toolbar' },
      unlockToggle('ls-unlock-all', ctx.rerender),
      el('a', { class: 'btn', href: '#/analytics' }, 'My progress'),
    ),
    el('ol', { class: 'set-list', role: 'list' }, SET_CONFIGS.map((cfg) => setCard(cfg))),
  );
}

function setMeta(cfg) {
  const depth = cfg.depth === 1 ? 'answer read straight from its row and column' : `chains of ${cfg.depth} steps`;
  const targets = cfg.targets[0] === cfg.targets[1] ? `${cfg.targets[0]} ? ${cfg.targets[0] === 1 ? 'cell' : 'cells'}` : `${cfg.targets[0]} or ${cfg.targets[1]} ? cells`;
  return `${cfg.n}x${cfg.n} grid, ${cfg.blanks[0]} to ${cfg.blanks[1]} blanks, ${targets}, ${depth}. Pace: about ${cfg.paceSec} s per puzzle.`;
}

function setCard(cfg) {
  const open = isUnlocked(cfg.set);
  const entry = store.getSet(GAME_ID, cfg.set);
  const practiceAvg = store.practiceAverage(GAME_ID, cfg.set, PUZZLES_PER_SET);
  const chips = [];
  for (let k = 1; k <= PUZZLES_PER_SET; k++) {
    const best = entry.practice[puzzleId(cfg.set, k)];
    const label = best === undefined ? `Puzzle ${k}, not played` : `Puzzle ${k}, best efficiency ${pct(best)}`;
    chips.push(
      open
        ? el('a', { class: `chip${best >= 1 ? ' chip-perfect' : best > 0 ? ' chip-done' : ''}`, href: `#/latinsquare/practice/${cfg.set}/${k}`, 'aria-label': label, title: label }, String(k))
        : el('span', { class: 'chip chip-locked', 'aria-hidden': 'true' }, String(k)),
    );
  }
  return el('li', { class: `set-card${open ? '' : ' is-locked'}` },
    el('div', { class: 'card-head' },
      el('h2', {}, `Set ${cfg.set}: ${cfg.name}`),
      el('span', { class: `badge ${open ? 'badge-ok' : 'badge-soon'}`, text: open ? 'Open' : 'Locked' }),
    ),
    el('p', { class: 'set-meta' }, setMeta(cfg)),
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
  if (!cfg || (!retry && !(Number.isInteger(k) && k >= 1))) {
    root.append(el('p', { class: 'notice' }, 'Unknown puzzle. ', el('a', { href: '#/latinsquare' }, 'Back to sets')));
    return;
  }
  if (!retry && !isUnlocked(setNo)) return lockedNotice(root, setNo);
  // Past the shipped 10: a fresh puzzle for this browser, never one it has seen.
  const slot = retry ? { puzzle: retry.puzzle, source: 'review' } : practicePuzzle({ game: GAME_ID, set: setNo, k, puzzles: (await loadSet(setNo)).puzzles, kit: freshKit });
  const { puzzle, source } = slot;
  const targets = puzzle.targets.length;

  const after = el('div', { class: 'after' });
  const prevLink = !retry && k > 1 ? el('a', { class: 'btn btn-quiet', href: `#/latinsquare/practice/${setNo}/${k - 1}` }, 'Previous puzzle') : null;
  const nextHref = retry ? retry.returnHash : `#/latinsquare/practice/${setNo}/${k + 1}`;
  const nextLabel = retry ? 'Compare with the optimal solution' : 'Next puzzle';
  let area = null;
  let curLog = null;
  const host = el('div', {});

  // An unfinished puzzle with at least one action is saved as skipped (End and review, leaving).
  function saveUnfinished() {
    if (retry || !area || !curLog || curLog.ended || !curLog.events.length || area.game.status !== 'playing') return false;
    const attempt = curLog.end('skipped', { moves: area.game.pickCount, hintsUsed: area.hintsUsed });
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
    const log = createAttemptLog({ game: GAME_ID, set: setNo, puzzleId: puzzle.id, mode: 'practice', source, optimal: targets });
    curLog = log;
    area = createPlayArea(puzzle, { mode: 'practice', log, onDone: (game, { hintsUsed }) => finish(game, hintsUsed, log) });
    host.replaceChildren(area.root);
    area.focus();
  }

  function finish(game, hintsUsed, log) {
    const solved = game.status === 'solved';
    const eff = efficiency(targets, game.pickCount, solved);
    const attempt = log.end(recorderOutcome(game.status), { moves: game.pickCount, hintsUsed });
    stampDvs(GAME_ID, attempt, puzzle);
    recorder.saveAttempt(attempt);
    resume().clear(GAME_ID, 'practice');
    if (retry) {
      // Retrieval first: grade and reschedule now, compare with the optimal solution on the review page.
      completeRetry(GAME_ID, attempt);
      after.replaceChildren(
        el('div', { class: 'after-actions' }, el('a', { class: 'btn btn-primary', href: nextHref }, nextLabel)),
        dvsPanel(GAME_ID, attempt, puzzle),
        coachHost(attempt, puzzle, cfg.paceSec),
      );
      after.querySelector('.after-actions .btn-primary')?.focus({ preventScroll: true });
      return;
    }
    // Only the shipped 10 make up the practice average; fresh puzzles count in history and review.
    if (k <= PUZZLES_PER_SET) store.recordPractice(GAME_ID, setNo, puzzle.id, eff);
    after.replaceChildren(
      el('div', { class: 'after-actions' },
        el('button', { type: 'button', class: 'btn', onclick: () => start() }, 'Try again'),
        el('a', { class: 'btn btn-primary', href: nextHref }, nextLabel),
      ),
      coachHost(attempt, puzzle, cfg.paceSec),
      trackExplain(createExplainPanel(puzzle, { outcome: game.status, eff, text: resultSummary({ outcome: game.status, picks: game.pickCount, targets }), dvs: dvsPanel(GAME_ID, attempt, puzzle) }), attempt),
    );
    after.querySelector('.after-actions .btn-primary')?.focus({ preventScroll: true });
    after.append(timedNudge('latinsquare', setNo));
    after.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  root.append(
    el('div', { class: 'page-head play-head' },
      el('p', { class: 'crumbs' }, el('a', { href: '#/latinsquare' }, 'Latin Square'), ` / Set ${setNo}: ${cfg.name}`),
      el('h1', {}, retry ? 'Review: solve it again before you look' : practiceTitle(k, PUZZLES_PER_SET)),
      el('p', { class: 'muted' }, `Every symbol once per row and column. Suggested pace: about ${cfg.paceSec} s. No clock in practice mode.`),
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

// ---------------------------------------------------------------- timed test

function setExamChrome(on) {
  document.body.classList.toggle('exam-active', on);
}

const OUTCOME_LABEL = { solved: ['badge-ok', 'Right'], wrong: ['badge-warn', 'Wrong'], skipped: ['badge-soon', 'Skipped'], timeout: ['badge-soon', 'Time up'] };

async function renderRun(ctx, setNo, freshMode = false) {
  const { root } = ctx;
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg) {
    root.append(el('p', { class: 'notice' }, 'Unknown set. ', el('a', { href: '#/latinsquare' }, 'Back to sets')));
    return;
  }
  if (!isUnlocked(setNo)) return lockedNotice(root, setNo);
  const data = await loadSet(setNo);
  const penalty = (1 / (cfg.n - 1)).toFixed(2);

  const head = el('div', { class: 'page-head play-head' },
    el('p', { class: 'crumbs' }, el('a', { href: '#/latinsquare' }, 'Latin Square'), ` / Set ${setNo}: ${cfg.name}`),
    el('h1', {}, freshMode ? 'Fresh timed practice (not ranked)' : 'Timed test (ranked)'),
  );
  const body = el('div', {});
  root.append(head, body);
  const ranked = freshMode ? null : runSetup(GAME_ID, setNo, false);

  let timer = null;
  let area = null;
  let tutorialArea = null;
  let finished = false;
  let advanceHandle = null;
  let stream = null;
  let rank = 1;
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

  // ---- pre-run tutorial screen
  const atPace = Math.floor(RUN_MS / (cfg.paceSec * 1000));
  const startBtn = el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => begin() }, 'I am ready: start the 6:00 run');
  const tutorialHud = el('div', { class: 'exam-hud is-tutorial' }, el('span', { class: 'clock', 'aria-label': 'Time left (not running in the sample)' }, '6:00'), el('span', { class: 'run-progress', text: 'Sample' }));
  const tutorialSlot = el('span', { class: 'hud-slot' });
  tutorialHud.append(tutorialSlot);
  const tutorialMsg = el('p', { class: 'flash', role: 'status' });
  const tutorialHost = el('div', {});
  const tutorialWhy = explainPuzzle(TUTORIAL_PUZZLE).steps.at(-1).text;
  function startTutorial() {
    tutorialArea?.destroy();
    tutorialMsg.textContent = '';
    tutorialArea = createPlayArea(TUTORIAL_PUZZLE, {
      mode: 'exam',
      onDone: (game) => {
        tutorialMsg.textContent = game.status === 'solved'
          ? `Right. ${tutorialWhy} In the run that scores +1.`
          : game.status === 'wrong'
            ? `Not quite. ${tutorialWhy} In the run a wrong answer costs ${penalty} points.`
            : 'Skipped. In the run, the next puzzle appears at once and this one never comes back.';
      },
    });
    tutorialSlot.replaceChildren(...tutorialArea.hudItems);
    tutorialHost.replaceChildren(tutorialArea.root);
  }
  body.append(
    el('section', { class: 'run-intro' },
      el('h2', { text: 'Before you start' }),
      el('ol', { class: 'exam-rules' },
        el('li', {}, el('strong', { text: '6:00 on the clock. ' }), freshMode
          ? 'Puzzles keep coming until time is up: freshly generated puzzles of this set\'s difficulty that you have not seen before.'
          : 'Puzzles keep coming until time is up: first this set\'s 10, then freshly generated puzzles of the same difficulty, in the same order for every player.'),
        el('li', {}, el('strong', { text: 'Answers are final. ' }), 'Pick a symbol for each ? cell (tap it, or press its number or letter). You will not be told right or wrong until the end.'),
        el('li', {}, el('strong', { text: 'Scoring: ' }), `right +1, wrong -${penalty} (so blind guessing averages 0), skip 0. With two ? cells, both must be right.`),
        el('li', {}, el('strong', { text: 'No hints. Skip is final. ' }), 'A skipped puzzle never comes back.'),
        el('li', {}, el('strong', { text: 'Pace: ' }), `about ${cfg.paceSec} s per puzzle, so about ${atPace} puzzles in 6:00 for set ${setNo}. Skip rule: several symbols left and no helper cell in sight after about ${cfg.paceSec} s means skip.`),
        el('li', {}, el('strong', { text: 'Afterwards: ' }), 'the coach reviews every puzzle and the whole run. End and review stops the run at any point and shows your score so far; leaving the page saves it the same way. Runs ended early count toward progress and review but not the leaderboard.'),
      ),
      runModeNote(GAME_ID, setNo, freshMode),
      el('h3', { text: 'Try the sample puzzle (untimed, not scored)' }),
      el('p', { class: 'muted', text: 'This is the exact exam screen: grid, symbols, clock, answer counter and Skip.' }),
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

  // Latin Square runs score in exam points (right +1, wrong -1/(n-1), skip 0), not efficiency.
  function buildRun() {
    const run = summarizeRun({ id: runId, game: GAME_ID, set: setNo, seed: runSeed, startedAt, endedAt: Date.now(), budgetMs: RUN_MS, attempts: results.map((r) => r.attempt), rank });
    run.score = examRunScore(results.map((r) => r.status), cfg.n);
    run.wrong = results.filter((r) => r.status === 'wrong').length;
    run.scoring = 'exam-points';
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
    const setup = ranked ?? runSetup(GAME_ID, setNo, true);
    runSeed = setup.seed;
    rank = setup.rank;
    runId = newId('r');
    startedAt = Date.now();
    stream = ranked
      ? createRunStream({ puzzles: data.puzzles, seed: runSeed, setNo, shuffle: false })
      : createRunStream({ puzzles: data.puzzles, seed: runSeed, setNo, usePool: false, isSeen: seenFilter(GAME_ID) });
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
    const { puzzle, source, index } = stream.next();
    if (!ranked) markSeen(GAME_ID, freshKit.keyOf(puzzle));
    const log = createAttemptLog({ game: GAME_ID, set: setNo, puzzleId: puzzle.id, mode: 'exam', runId, source, optimal: puzzle.targets.length, rank });
    current = { puzzle, source, index, log, done: false };
    area = createPlayArea(puzzle, {
      mode: 'exam',
      log,
      onDone: (game) => {
        if (game.status === 'skipped') {
          record('skipped');
          flash.textContent = `Skipped puzzle ${index + 1}.`;
          showNext();
        } else {
          record(game.status);
          flash.textContent = `Puzzle ${index + 1} answered.`;
          advanceHandle = setTimeout(showNext, 300);
        }
      },
    });
    hudSlot.replaceChildren(...area.hudItems);
    host.replaceChildren(area.root);
    progress.textContent = `Puzzle ${index + 1}`;
    area.focus();
  }

  function record(status) {
    if (!current || current.done) return;
    current.done = true;
    const game = area.game;
    const attempt = current.log.end(recorderOutcome(status), { moves: game.pickCount });
    stampDvs(GAME_ID, attempt, current.puzzle);
    recorder.saveAttempt(attempt);
    results.push({ attempt, status, puzzle: current.puzzle, source: current.source, index: current.index, picks: game.picks });
  }

  // exit: 'time' (clock ran out), 'early' (End and review), 'nav' or 'unload' (left the page).
  function finish(exit = 'time') {
    if (finished) return;
    finished = true;
    clearTimeout(advanceHandle);
    timer?.stop();
    unguard?.();
    // Ended early: an untouched puzzle on screen counts as not attempted.
    if (exit === 'time' || current?.log.events.length) record('timeout');
    area?.destroy();
    area = null;
    setExamChrome(false);
    head.hidden = false;

    const run = saveEndedRun({ recorder, run: buildRun(), exit });
    const slots = Math.max(PUZZLES_PER_SET, results.length);
    const avg = averageEfficiency(run.score, slots);
    const wasOpen = setNo < SET_CONFIGS.length ? isUnlocked(setNo + 1) : true;
    // Fresh timed practice counts in history and review but not in the set's best ranked score.
    const { improved, best } = ranked ? store.recordRun(GAME_ID, setNo, run.score, slots) : { improved: false, best: store.getSet(GAME_ID, setNo).bestScore };
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
    const [takeawaysNode, notAttemptedNode] = runLearning({ game: GAME_ID, run, attempts: results.map((r) => r.attempt), habits: runCoach.habits, perPuzzle: runCoach.perPuzzle, pool: ranked ? data.puzzles : [], solve: studyWalkthrough, onDispose: ctx.onDispose });
    const answered = results.filter((r) => r.status === 'solved' || r.status === 'wrong').length;
    const right = results.filter((r) => r.status === 'solved').length;
    const minutes = Math.max(1, run.durationMs) / 60000;

    const review = el('div', { class: 'review-host' });
    const answerText = (r) => {
      const P = parsePuzzle(r.puzzle);
      const given = P.targets.map((_, t) => r.picks.find((p) => p.target === t));
      return {
        yours: given.map((p) => (p ? symName(P, p.sym) : 'none')).join(', '),
        correct: P.answers.map((v) => symName(P, v)).join(', '),
      };
    };
    const rows = results.map((r) => {
      const m = r.attempt.metrics;
      const [cls, word] = OUTCOME_LABEL[r.status] ?? OUTCOME_LABEL.skipped;
      const ans = answerText(r);
      const pts = examPoints(r.status, r.puzzle.n);
      return el('tr', {},
        el('td', { text: String(r.index + 1) }),
        el('td', {}, el('span', { class: `badge ${cls}`, text: word })),
        el('td', { text: ans.yours }),
        el('td', { text: ans.correct }),
        el('td', { text: pts === 0 ? '0' : pts > 0 ? '+1' : `-${(-pts).toFixed(2)}` }),
        el('td', { text: fmtSec(m.totalMs) }),
        el('td', {},
          el('button', {
            type: 'button',
            class: 'btn btn-small',
            onclick: () => {
              review.replaceChildren(
                el('h3', { text: `Puzzle ${r.index + 1}${r.source === 'pool' ? '' : r.source === 'generated' ? ' (freshly generated)' : ' (reshuffled variant)'}` }),
                coachHost(r.attempt, r.puzzle, cfg.paceSec),
                trackExplain(createExplainPanel(r.puzzle, {
                  outcome: r.status,
                  eff: r.status === 'solved' ? 1 : 0,
                  text: r.status === 'solved' ? 'Right: +1 point.' : r.status === 'wrong' ? `Wrong: -${(1 / (r.puzzle.n - 1)).toFixed(2)} points. You answered ${ans.yours}; the answer is ${ans.correct}.` : r.status === 'timeout' ? 'Time ran out on this puzzle.' : 'Skipped: 0 points.',
                }), r.attempt),
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
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Run score' }), el('strong', { text: round2(run.score).toFixed(2) })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Right' }), el('strong', { text: `${right} of ${answered} answered` })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Accuracy' }), el('strong', { text: answered ? pct(right / answered) : 'none' })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Points per minute' }), el('strong', { text: (run.score / minutes).toFixed(2) })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: ranked ? 'Best for this set' : 'Best ranked run' }), el('strong', { text: `${round2(best).toFixed(2)}${improved ? ' (new best)' : ''}` })),
        ),
        runExtras(GAME_ID, setNo, improved, { partial, ranked: !!ranked }),
        takeawaysNode,
        !wasOpen && nowOpen ? el('p', { class: 'callout callout-ok', text: `Set ${setNo + 1} unlocked. Nice work.` }) : null,
        avg < UNLOCK_THRESHOLD && setNo < SET_CONFIGS.length && !nowOpen
          ? el('p', { class: 'callout', text: `Reach ${pct(UNLOCK_THRESHOLD)} (score / ${slots} = ${pct(avg)} this run) to unlock set ${setNo + 1}.` })
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
            el('thead', {}, el('tr', {}, ['#', 'Result', 'Your answer', 'Answer', 'Points', 'Time', 'Coach and solution'].map((h) => el('th', { scope: 'col', text: h })))),
            el('tbody', {}, rows),
          ),
        ),
        dvsRunSection(GAME_ID, results.map((r) => ({ attempt: r.attempt, puzzle: r.puzzle }))),
        notAttemptedNode,
        el('div', { class: 'after-actions' },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => ctx.rerender() }, 'Run again'),
          studyLink(GAME_ID, setNo),
          el('a', { class: 'btn', href: '#/analytics' }, 'Progress and analytics'),
          el('a', { class: 'btn', href: '#/latinsquare' }, 'Back to sets'),
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
    ctx.root.append(el('p', { class: 'notice' }, 'No review puzzle is waiting. ', el('a', { href: '#/review/latinsquare' }, 'Open the Latin Square review library')));
    return null;
  }
  return renderPractice(ctx, r.set, 0, r);
}

// Watch mode on the review page: the worked solution, with the original result line.
export function reviewWalkthrough(puzzle, attempt) {
  const outcome = effectiveOutcome(attempt, parsePuzzle(puzzle));
  const words = { solved: 'Your original attempt was right.', wrong: 'Your original attempt was wrong.', skipped: 'You skipped this puzzle.', timeout: 'Time ran out on this puzzle.' };
  return createExplainPanel(puzzle, { outcome, eff: attempt.metrics?.efficiency ?? 0, text: words[outcome] ?? '' });
}

// Study mode: the worked solution for a puzzle nobody played yet (no result line, nothing scored).
export function studyWalkthrough(puzzle, onDispose = () => {}) {
  return createExplainPanel(puzzle, null);
}

// ---------------------------------------------------------------- entry

export async function mountLatinSquare(main, args = []) {
  ensureStyles();
  const root = el('div', { class: 'latinsquare' });
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
      else if (mode === 'run') await renderRun(ctx, Number(a), isFreshArg(b));
      else if (mode === 'retry') await renderRetry(ctx);
      else root.append(el('p', { class: 'notice' }, 'Unknown page. ', el('a', { href: '#/latinsquare' }, 'Back to Latin Square')));
    } catch (err) {
      console.error(err);
      root.replaceChildren(el('p', { class: 'notice' }, `Could not load the puzzle: ${err.message}. If you opened the file directly, serve the folder over http (python3 -m http.server).`));
    }
  }
  await draw();
  return disposeAll;
}
