// Block Slide UI: set menu, practice mode, timed run (exam mode) and the optimal solution replay.
// All game rules live in state.js; this file only renders and wires input. Every attempt is logged
// through the recorder and reviewed by the coach.

import { el } from '../../core/dom.js';
import { runExtras } from '../../core/board.js';
import { Countdown, formatClock } from '../../core/timer.js';
import { createStore } from '../../core/store.js';
import { createRecorder, createAttemptLog, summarizeRun, newId } from '../../core/recorder.js';
import { efficiency, averageEfficiency, pct, round2, UNLOCK_THRESHOLD } from '../../core/score.js';
import { createGame, DIRS, DIR_KEYS, cellLabel } from './state.js';
import { hint } from './solver.js';
import { explainSolution, resultSummary, STRATEGY, pieceName, blockStyle, moveText } from './explain.js';
import { SET_CONFIGS, PUZZLES_PER_SET } from './gen.js';
import { createRunStream, generateFresh, freshSeed, TUTORIAL_PUZZLE } from './stream.js';
import { coachPuzzle, coachRun } from './coach.js';

const GAME_ID = 'blockslide';
const RUN_MS = 6 * 60 * 1000;
const ARROWS = { U: String.fromCharCode(0x2191), D: String.fromCharCode(0x2193), L: String.fromCharCode(0x2190), R: String.fromCharCode(0x2192) };
const KEY_DIRS = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R' };

const store = createStore();
const recorder = createRecorder();
const setCache = new Map();

function loadSet(setNo) {
  if (!setCache.has(setNo)) {
    const url = new URL(`../../../data/sets/blockslide/set${setNo}.json`, import.meta.url);
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
  return `bs${setNo}-${String(k).padStart(2, '0')}`;
}

function isUnlocked(setNo) {
  return store.isUnlocked(GAME_ID, setNo, PUZZLES_PER_SET);
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------- board view

function pieceAria(board, i, pos) {
  const { len, dir } = board.shapes[i];
  const shape = i === 0 ? '' : len === 1 ? ', single cell' : `, ${dir === 'h' ? 'horizontal' : 'vertical'} length ${len}`;
  const name = pieceName(i);
  return `${name[0].toUpperCase()}${name.slice(1)}${shape}, at ${cellLabel(board, pos)}`;
}

function createBoardView(board, { interactive = false, small = false, label = 'Block Slide board' } = {}) {
  const { n } = board;
  const grid = el('div', {
    class: 'board',
    style: { '--n': n },
    role: interactive ? 'group' : 'img',
    'aria-label': label,
  });
  const cells = [];
  for (let cell = 0; cell < n * n; cell++) {
    const isWall = board.walls[cell] === 1;
    const isExit = cell === board.exitIdx;
    const c = el('div', {
      class: `cell${isWall ? ' wall' : ''}${isExit ? ' exit-cell' : ''}`,
      'data-cell': cell,
      style: { '--r': Math.floor(cell / n), '--c': cell % n },
      'aria-hidden': 'true',
    });
    if (isWall) c.append(el('span', { class: 'sr-only', text: 'wall' }));
    cells.push(c);
    grid.append(c);
  }
  const { side, r: er, c: ec } = board.exit;
  const exitArrow = { top: ARROWS.U, bottom: ARROWS.D, left: ARROWS.L, right: ARROWS.R }[side];
  grid.append(
    el('div', { class: `exit-marker side-${side}`, style: { '--r': er, '--c': ec }, 'aria-hidden': 'true' },
      el('span', { class: 'exit-arrow', text: exitArrow }),
      el('span', { class: 'exit-text', text: 'EXIT' }),
    ),
  );
  const pieces = board.shapes.map((shape, i) => {
    const w = shape.dir === 'h' ? shape.len : 1;
    const h = shape.dir === 'h' ? 1 : shape.len;
    const tag = interactive ? 'button' : 'div';
    const attrs = {
      class: i === 0 ? 'piece ball' : `piece block pat-${blockStyle(i).pattern}`,
      style: { '--w': w, '--h': h, ...(i === 0 ? {} : { '--pc': blockStyle(i).hex }) },
      'data-piece': i,
    };
    if (interactive) attrs.type = 'button';
    else attrs['aria-hidden'] = 'true';
    const node = el(tag, attrs, el('span', { class: 'piece-label', 'aria-hidden': 'true', text: i === 0 ? '' : blockStyle(i).letter }));
    node.append(el('span', { class: 'move-badge', 'aria-hidden': 'true' }));
    grid.append(node);
    return node;
  });

  const wrap = el('div', { class: `board-wrap${small ? ' is-small' : ''}` }, grid);

  function update(positions, { selected = null, highlight = null, highlightDir = null, hintPiece = null, hintDir = null } = {}) {
    positions.forEach((pos, i) => {
      const node = pieces[i];
      node.style.setProperty('--r', Math.floor(pos / n));
      node.style.setProperty('--c', pos % n);
      node.classList.toggle('is-selected', selected === i);
      node.classList.toggle('is-moved', highlight === i);
      node.classList.toggle('is-hint', hintPiece === i);
      const badge = node.querySelector('.move-badge');
      badge.textContent = hintPiece === i && hintDir ? ARROWS[hintDir] : highlight === i && highlightDir ? ARROWS[highlightDir] : '';
      if (interactive) {
        node.setAttribute('aria-pressed', selected === i ? 'true' : 'false');
        node.setAttribute('aria-label', pieceAria(board, i, pos));
      }
    });
  }

  function shake(i) {
    const node = pieces[i];
    if (!node) return;
    node.classList.remove('is-blocked');
    void node.offsetWidth;
    node.classList.add('is-blocked');
  }

  return { root: wrap, grid, cells, pieces, update, shake };
}

// ---------------------------------------------------------------- play area (one puzzle)

// Builds the interactive board plus controls for one puzzle.
// opts: { mode: 'practice'|'exam', log (recorder attempt log, optional), onSolved(game), onSkip(game), onChange(game) }
// Exam mode has no undo, reset or hints; its move counter and Skip button are returned in
// hudItems for the caller to place next to the clock.
function createPlayArea(puzzle, opts) {
  const exam = opts.mode === 'exam';
  const log = opts.log ?? null;
  const game = createGame(puzzle);
  game.select(0);
  const view = createBoardView(game.board, { interactive: true, label: `Puzzle board, ${puzzle.n} by ${puzzle.n}. Exit at ${cellLabel(game.board, game.board.exitIdx)}.` });
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' });
  const message = el('p', { class: 'play-message', role: 'status' });
  const movesOut = el('strong', { class: 'stat-value', text: '0' });
  let hintState = null;
  let hintsUsed = 0;

  const pad = el('div', { class: 'arrow-pad', role: 'group', 'aria-label': 'Move selected piece' });
  const padButtons = {};
  for (const d of DIR_KEYS) {
    const b = el('button', { type: 'button', class: `pad-btn pad-${d}`, 'aria-label': `Move selected piece ${DIRS[d].word}`, onclick: () => doMove(d) }, ARROWS[d]);
    padButtons[d] = b;
    pad.append(b);
  }

  const undoBtn = exam ? null : el('button', { type: 'button', class: 'btn', onclick: () => doUndo() }, 'Undo');
  const resetBtn = exam ? null : el('button', { type: 'button', class: 'btn', onclick: () => doReset() }, 'Reset');
  const hintBtn = exam ? null : el('button', { type: 'button', class: 'btn', onclick: () => doHint() }, 'Hint');
  const skipBtn = el(
    'button',
    { type: 'button', class: 'btn btn-warn', onclick: () => doSkip() },
    exam ? 'Skip' : 'Skip and show solution',
  );

  const stats = el('div', { class: 'stats' },
    el('span', { class: 'stat' }, 'Moves ', movesOut),
    el('span', { class: 'stat' }, exam ? 'Fewest ' : 'Fewest possible ', el('strong', { class: 'stat-value', text: String(puzzle.optimal) })),
  );

  const root = exam
    ? el('div', { class: 'play-area is-exam' }, el('div', { class: 'board-col' }, view.root, pad, message, live))
    : el('div', { class: 'play-area' },
      el('div', { class: 'board-col' }, view.root, pad),
      el('div', { class: 'side-col' },
        stats,
        el('div', { class: 'controls' }, undoBtn, resetBtn, hintBtn, skipBtn),
        message,
        live,
        el('details', { class: 'help' },
          el('summary', {}, 'Controls'),
          el('ul', {},
            el('li', {}, 'Tap or click a piece to select it, or Tab to it. The ball starts selected.'),
            el('li', {}, 'Arrow keys or the on-screen arrows slide the selected piece one cell.'),
            el('li', {}, 'You can also tap an empty cell right next to the selected piece.'),
            el('li', {}, 'Keys: Z undo, Esc clear selection, H hint.'),
          ),
        ),
      ),
    );

  function selectPiece(i) {
    const before = game.selected;
    game.select(i);
    if (game.selected !== before) log?.select(game.selected);
  }

  function say(text) {
    live.textContent = '';
    // Re-set on the next frame so repeated identical messages are still announced.
    requestAnimationFrame(() => (live.textContent = text));
  }

  function render() {
    view.update(game.positions, {
      selected: game.selected,
      hintPiece: hintState?.move?.p ?? null,
      hintDir: hintState?.move?.d ?? null,
    });
    movesOut.textContent = String(game.moves);
    const legal = game.legalDirs();
    for (const d of DIR_KEYS) {
      const ok = legal.includes(d);
      padButtons[d].setAttribute('aria-disabled', ok ? 'false' : 'true');
      padButtons[d].classList.toggle('is-off', !ok);
    }
    const playing = game.status === 'playing';
    for (const b of [undoBtn, resetBtn, hintBtn, skipBtn]) if (b) b.disabled = !playing;
    if (playing && undoBtn) undoBtn.disabled = game.moves === 0;
    if (opts.onChange) opts.onChange(game);
  }

  function doMove(d) {
    if (game.status !== 'playing') return;
    if (game.selected === null) {
      message.textContent = 'Select a piece first.';
      return;
    }
    const p = game.selected;
    if (!game.move(p, d)) {
      log?.blocked(p, d);
      view.shake(p);
      message.textContent = `${pieceName(p)} cannot move ${DIRS[d].word}.`;
      say(message.textContent);
      return;
    }
    log?.move(p, d);
    hintState = null;
    message.textContent = '';
    render();
    say(`${pieceName(p)} moved ${DIRS[d].word}. ${game.moves} ${game.moves === 1 ? 'move' : 'moves'}.`);
    if (game.solved) {
      message.textContent = `Solved in ${game.moves} moves.`;
      say(`Solved in ${game.moves} moves. Fewest possible ${puzzle.optimal}.`);
      opts.onSolved?.(game, { hintsUsed });
    }
  }

  function doUndo() {
    if (game.undo()) {
      log?.undo();
      hintState = null;
      message.textContent = '';
      render();
      say(`Undone. ${game.moves} moves.`);
    }
  }

  function doReset() {
    if (game.reset()) {
      log?.reset();
      selectPiece(0);
      hintState = null;
      message.textContent = 'Board reset.';
      render();
      say('Board reset.');
    }
  }

  function doSkip() {
    if (game.skip()) {
      hintState = null;
      render();
      opts.onSkip?.(game, { hintsUsed });
    }
  }

  function doHint() {
    if (game.status !== 'playing' || !hintBtn) return;
    message.textContent = 'Thinking...';
    hintBtn.disabled = true;
    setTimeout(() => {
      const h = hint(puzzle, game.positions, game.moves);
      hintBtn.disabled = game.status !== 'playing';
      if (!h) return;
      if (!h.move) {
        message.textContent = h.source === 'budget'
          ? 'You are far from the optimal line. Try Reset and plan from the exit backwards.'
          : 'No route found from here. Try Undo or Reset.';
        say(message.textContent);
        return;
      }
      hintsUsed++;
      log?.hint();
      hintState = h;
      selectPiece(h.move.p);
      message.textContent = `Hint: ${moveText(h.move)}. Best finish from here: ${h.remaining} ${h.remaining === 1 ? 'move' : 'moves'}.`;
      render();
      say(message.textContent);
    }, 20);
  }

  // Piece and cell clicks.
  view.grid.addEventListener('click', (e) => {
    if (game.status !== 'playing') return;
    const pieceNode = e.target.closest('[data-piece]');
    if (pieceNode) {
      selectPiece(Number(pieceNode.dataset.piece));
      message.textContent = '';
      render();
      return;
    }
    const cellNode = e.target.closest('[data-cell]');
    if (cellNode) {
      const d = game.dirToward(Number(cellNode.dataset.cell));
      if (d) doMove(d);
    }
  });

  function onKey(e) {
    if (game.status !== 'playing' || e.altKey || e.metaKey) return;
    const active = document.activeElement;
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return;
    const d = KEY_DIRS[e.key];
    if (d) {
      if (active && active.dataset && active.dataset.piece !== undefined && view.grid.contains(active)) {
        selectPiece(Number(active.dataset.piece));
      }
      e.preventDefault();
      doMove(d);
      return;
    }
    if (exam) {
      if (e.key === 'Escape') {
        selectPiece(null);
        render();
      }
      return;
    }
    if (e.ctrlKey) {
      if (e.key === 'z') {
        e.preventDefault();
        doUndo();
      }
      return;
    }
    if (e.key === 'z' || e.key === 'Z') doUndo();
    else if (e.key === 'Escape') {
      selectPiece(null);
      render();
    } else if ((e.key === 'h' || e.key === 'H') && hintBtn) doHint();
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
      view.pieces[0]?.focus({ preventScroll: true });
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
}

// ---------------------------------------------------------------- solution replay

function createExplainPanel(puzzle, result, ctx) {
  const ex = explainSolution(puzzle);
  const view = createBoardView(ex.board, { small: true, label: 'Optimal solution replay' });
  let k = 0;
  let timer = null;

  const reason = el('p', { class: 'step-reason', 'aria-live': 'polite' });
  const counter = el('span', { class: 'step-counter' });
  const prevBtn = el('button', { type: 'button', class: 'btn', onclick: () => { stop(); go(k - 1); } }, 'Prev');
  const nextBtn = el('button', { type: 'button', class: 'btn', onclick: () => { stop(); go(k + 1); } }, 'Next');
  const playBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => toggle() }, 'Auto-play');
  const startBtn = el('button', { type: 'button', class: 'btn', onclick: () => { stop(); go(0); } }, 'Start');
  const items = ex.steps.map((s, i) =>
    el('li', {}, el('button', { type: 'button', class: 'step-link', onclick: () => { stop(); go(i + 1); } }, s.text)),
  );

  function go(j) {
    k = Math.max(0, Math.min(ex.steps.length, j));
    const step = k > 0 ? ex.steps[k - 1] : null;
    view.update(ex.states[k], { highlight: step ? step.piece : null, highlightDir: step ? step.dir : null });
    counter.textContent = `Step ${k} of ${ex.steps.length}`;
    reason.textContent = step ? `${k}. ${step.text}` : 'Start position. Press Next or Auto-play to see the optimal line.';
    items.forEach((li, i) => li.toggleAttribute('aria-current', i === k - 1));
    prevBtn.disabled = k === 0;
    nextBtn.disabled = k === ex.steps.length;
  }

  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    playBtn.textContent = 'Auto-play';
  }

  function toggle() {
    if (timer !== null) return stop();
    if (k >= ex.steps.length) go(0);
    playBtn.textContent = 'Pause';
    timer = setInterval(() => {
      if (k >= ex.steps.length) return stop();
      go(k + 1);
    }, prefersReducedMotion() ? 1400 : 1000);
  }
  ctx.onDispose(stop);

  const eff = efficiency(puzzle.optimal, result.moves, result.solved);
  const panel = el('section', { class: 'explain', 'aria-label': 'Optimal solution' },
    el('div', { class: 'result-line' },
      el('span', { class: `badge ${result.solved ? (eff >= 1 ? 'badge-ok' : 'badge-mid') : 'badge-warn'}`, text: result.solved ? pct(eff) : 'Skipped' }),
      el('p', { text: resultSummary({ moves: result.moves, optimal: puzzle.optimal, solved: result.solved }) }),
    ),
    el('h3', { text: 'Optimal solution' }),
    el('div', { class: 'explain-body' },
      el('div', { class: 'explain-board' }, view.root,
        el('div', { class: 'replay-controls' }, startBtn, prevBtn, playBtn, nextBtn),
        counter),
      el('div', { class: 'explain-steps' },
        reason,
        el('ol', { class: 'step-list' }, items),
      ),
    ),
    el('details', { class: 'strategy', open: true },
      el('summary', {}, 'Strategy checklist'),
      el('ul', {}, STRATEGY.map((s) => el('li', { text: s }))),
    ),
    el('p', { class: 'muted small', text: 'Cells are named (row,column), counted from the top left corner. Other move orders with the same count are equally optimal.' }),
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

function metricStrip(m) {
  const cells = [
    ['Time', fmtSec(m.totalMs)],
    ['First move', fmtSec(m.firstMoveMs)],
    ['Longest pause', fmtSec(m.longestPauseMs)],
    ['Moves made', String(m.grossMoves)],
    ['Fewest', String(m.optimal)],
  ];
  if (m.undos || m.resets) cells.push(['Undo / reset', `${m.undos} / ${m.resets}`]);
  return el('dl', { class: 'metric-strip' }, cells.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v }))));
}

// Computes coaching after a short delay so the result shows first; deep search can take a moment.
function coachHost(attempt, puzzle, paceSec) {
  const host = el('section', { class: 'coach', 'aria-label': 'Coach' },
    el('h3', { text: 'Coach' }),
    metricStrip(attempt.metrics),
    el('p', { class: 'muted', text: 'Reviewing your moves...' }),
  );
  setTimeout(() => {
    let res;
    try {
      res = coachPuzzle(attempt, puzzle, { history: recorder.attempts({ game: GAME_ID, set: attempt.set }), paceSec, deep: true });
    } catch (err) {
      console.error(err);
      host.lastChild.textContent = 'The coach could not review this attempt.';
      return;
    }
    host.lastChild.replaceWith(el('ul', { class: 'findings', role: 'list' }, res.findings.map(findingItem)));
  }, 30);
  return host;
}

// ---------------------------------------------------------------- menu

function renderMenu(ctx) {
  const { root } = ctx;
  const unlockToggle = el('input', {
    type: 'checkbox',
    id: 'unlock-all',
    onchange: (e) => {
      store.setUnlockAll(e.target.checked);
      ctx.rerender();
    },
  });
  unlockToggle.checked = store.unlockAll();

  root.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Block Slide' }),
      el('p', { class: 'lede' },
        'Get the ball to the EXIT on the edge of the board in as few moves as possible. ',
        'Each move slides one piece exactly one cell up, down, left or right into empty space. Blocks never rotate. Hatched dark cells are fixed walls.'),
    ),
    el('div', { class: 'mode-explainer' },
      el('div', {}, el('h2', { text: 'Practice' }), el('p', { text: 'One puzzle, no clock, with undo, reset and hints. After you solve or skip, the coach reviews your moves and the optimal line replays step by step.' })),
      el('div', {}, el('h2', { text: 'Timed run (exam mode)' }), el('p', { text: '6:00 on the clock and puzzles keep coming until time is up. No undo, no hints, and a skipped puzzle never comes back. Score is the sum of your efficiencies.' })),
    ),
    el('div', { class: 'toolbar' },
      el('label', { class: 'toggle', for: 'unlock-all' }, unlockToggle, ' Unlock all sets'),
      el('a', { class: 'btn', href: '#/analytics' }, 'Progress and analytics'),
      el('button', {
        type: 'button',
        class: 'btn btn-quiet',
        onclick: () => {
          if (confirm('Clear saved Block Slide scores and unlocks in this browser? (Your play history stays; clear it on the analytics page.)')) {
            store.reset();
            ctx.rerender();
          }
        },
      }, 'Clear my progress'),
    ),
    el('ol', { class: 'set-list', role: 'list' }, SET_CONFIGS.map((cfg) => setCard(cfg))),
  );
}

function setCard(cfg) {
  const open = isUnlocked(cfg.set);
  const entry = store.getSet(GAME_ID, cfg.set);
  const practiceAvg = store.practiceAverage(GAME_ID, cfg.set, PUZZLES_PER_SET);
  const walls = cfg.walls[1] ? `, ${cfg.walls[0]}-${cfg.walls[1]} walls` : '';
  const chips = [];
  for (let k = 1; k <= PUZZLES_PER_SET; k++) {
    const best = entry.practice[puzzleId(cfg.set, k)];
    const label = best === undefined ? `Puzzle ${k}, not played` : `Puzzle ${k}, best efficiency ${pct(best)}`;
    chips.push(
      open
        ? el('a', { class: `chip${best >= 1 ? ' chip-perfect' : best > 0 ? ' chip-done' : ''}`, href: `#/blockslide/practice/${cfg.set}/${k}`, 'aria-label': label, title: label }, String(k))
        : el('span', { class: 'chip chip-locked', 'aria-hidden': 'true' }, String(k)),
    );
  }
  return el('li', { class: `set-card${open ? '' : ' is-locked'}` },
    el('div', { class: 'card-head' },
      el('h2', {}, `Set ${cfg.set}: ${cfg.name}`),
      el('span', { class: `badge ${open ? 'badge-ok' : 'badge-soon'}`, text: open ? 'Open' : 'Locked' }),
    ),
    el('p', { class: 'set-meta' },
      `${cfg.n}x${cfg.n} grid, ${cfg.blockers[0]}-${cfg.blockers[1]} blocks${walls}. Fewest moves ${cfg.band[0]} to ${cfg.band[1]}. Pace: about ${cfg.paceSec} s per puzzle.`),
    el('p', { class: 'set-progress' },
      `Best timed run score: ${round2(entry.bestScore)} (${pct(entry.bestAvg)} average efficiency)`,
      ` | Practice average: ${pct(practiceAvg)}`),
    open
      ? el('div', { class: 'set-actions' },
        el('div', { class: 'chips', role: 'group', 'aria-label': `Practice puzzles in set ${cfg.set}` }, chips),
        el('a', { class: 'btn btn-primary', href: `#/blockslide/run/${cfg.set}` }, 'Start timed run (6:00)'),
      )
      : el('p', { class: 'muted', text: `Reach ${pct(UNLOCK_THRESHOLD)} average efficiency in set ${cfg.set - 1} (timed run, or practice bests across all its puzzles) to unlock, or tick Unlock all sets.` }),
  );
}

function lockedNotice(root, setNo) {
  root.append(
    el('section', { class: 'prose' },
      el('h1', { text: `Set ${setNo} is locked` }),
      el('p', { text: `Reach ${pct(UNLOCK_THRESHOLD)} average efficiency in set ${setNo - 1}, or turn on Unlock all sets.` }),
      el('p', {}, el('a', { class: 'btn', href: '#/blockslide' }, 'Back to sets')),
    ),
  );
}

// ---------------------------------------------------------------- practice

async function renderPractice(ctx, setNo, k) {
  const { root } = ctx;
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg || !(k >= 1 && k <= PUZZLES_PER_SET)) {
    root.append(el('p', { class: 'notice' }, 'Unknown puzzle. ', el('a', { href: '#/blockslide' }, 'Back to sets')));
    return;
  }
  if (!isUnlocked(setNo)) return lockedNotice(root, setNo);
  const data = await loadSet(setNo);
  const puzzle = data.puzzles[k - 1];

  const after = el('div', { class: 'after' });
  const prevLink = k > 1 ? el('a', { class: 'btn btn-quiet', href: `#/blockslide/practice/${setNo}/${k - 1}` }, 'Previous puzzle') : null;
  const nextHref = k < PUZZLES_PER_SET ? `#/blockslide/practice/${setNo}/${k + 1}` : '#/blockslide';
  const nextLabel = k < PUZZLES_PER_SET ? 'Next puzzle' : 'Back to sets';

  let area = null;
  const host = el('div', {});

  function start() {
    area?.destroy();
    after.replaceChildren();
    const log = createAttemptLog({ game: GAME_ID, set: setNo, puzzleId: puzzle.id, mode: 'practice', optimal: puzzle.optimal });
    area = createPlayArea(puzzle, {
      mode: 'practice',
      log,
      onSolved: (game, { hintsUsed }) => finish(game, 'solved', hintsUsed, log),
      onSkip: (game, { hintsUsed }) => finish(game, 'skipped', hintsUsed, log),
    });
    host.replaceChildren(area.root);
  }

  function finish(game, outcome, hintsUsed, log) {
    const solved = outcome === 'solved';
    const eff = efficiency(puzzle.optimal, game.moves, solved);
    const attempt = log.end(outcome, { moves: game.moves, hintsUsed });
    recorder.saveAttempt(attempt);
    // Hinted solves still count, but the coach flags them so you know to try again unaided.
    store.recordPractice(GAME_ID, setNo, puzzle.id, eff);
    after.replaceChildren(
      el('div', { class: 'after-actions' },
        el('button', { type: 'button', class: 'btn', onclick: () => start() }, 'Try again'),
        el('a', { class: 'btn btn-primary', href: nextHref }, nextLabel),
      ),
      coachHost(attempt, puzzle, cfg.paceSec),
      createExplainPanel(puzzle, { moves: game.moves, solved }, ctx),
    );
    after.querySelector('.after-actions .btn-primary')?.focus({ preventScroll: true });
    after.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  root.append(
    el('div', { class: 'page-head play-head' },
      el('p', { class: 'crumbs' }, el('a', { href: '#/blockslide' }, 'Block Slide'), ` / Set ${setNo}: ${cfg.name}`),
      el('h1', {}, `Practice: puzzle ${k} of ${PUZZLES_PER_SET}`),
      el('p', { class: 'muted' }, `Suggested pace: about ${cfg.paceSec} s. No clock in practice mode.`),
    ),
    host,
    after,
    el('div', { class: 'after-actions' }, prevLink, el('a', { class: 'btn btn-quiet', href: nextHref }, nextLabel)),
  );
  start();
  ctx.onDispose(() => area?.destroy());
}

// ---------------------------------------------------------------- timed run (exam mode)

// Fresh puzzles for the run, built in a module worker. Without workers, sets 1 to 3 (fast to
// generate) are built on demand; sets 4 and 5 fall back to the stream's instant variants.
function createFreshSource(setNo, seed) {
  const buffer = [];
  let worker = null;
  let syncK = 0;
  try {
    worker = new Worker(new URL('./gen.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if (e.data?.type === 'puzzle') buffer.push(e.data.puzzle);
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
    };
    worker.postMessage({ type: 'start', setNo, seed, count: 4 });
  } catch {
    worker = null;
  }
  return {
    take() {
      const p = buffer.shift() ?? null;
      if (p) {
        worker?.postMessage({ type: 'more', count: 1 });
        return p;
      }
      if (!worker && setNo <= 3) {
        try {
          return generateFresh(setNo, freshSeed(seed ^ 0x5bd1e995, syncK++));
        } catch {
          return null;
        }
      }
      return null;
    },
    stop() {
      worker?.terminate();
      worker = null;
    },
  };
}

function setExamChrome(on) {
  document.body.classList.toggle('exam-active', on);
}

async function renderRun(ctx, setNo) {
  const { root } = ctx;
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg) {
    root.append(el('p', { class: 'notice' }, 'Unknown set. ', el('a', { href: '#/blockslide' }, 'Back to sets')));
    return;
  }
  if (!isUnlocked(setNo)) return lockedNotice(root, setNo);
  const data = await loadSet(setNo);

  const head = el('div', { class: 'page-head play-head' },
    el('p', { class: 'crumbs' }, el('a', { href: '#/blockslide' }, 'Block Slide'), ` / Set ${setNo}: ${cfg.name}`),
    el('h1', {}, 'Timed run'),
  );
  const body = el('div', {});
  root.append(head, body);

  let timer = null;
  let area = null;
  let tutorialArea = null;
  let finished = false;
  let advanceHandle = null;
  let fresh = null;
  let stream = null;
  let current = null;
  let runSeed = 0;
  let runId = null;
  let startedAt = 0;
  const results = [];
  ctx.onDispose(() => {
    timer?.stop();
    area?.destroy();
    tutorialArea?.destroy();
    fresh?.stop();
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
  function startTutorial() {
    tutorialArea?.destroy();
    tutorialMsg.textContent = '';
    tutorialArea = createPlayArea(TUTORIAL_PUZZLE, {
      mode: 'exam',
      onSolved: (game) => {
        tutorialMsg.textContent = game.moves === TUTORIAL_PUZZLE.optimal
          ? `Solved in ${game.moves}, the fewest possible. That is how a puzzle scores 1.`
          : `Solved in ${game.moves}; the fewest is ${TUTORIAL_PUZZLE.optimal}, so this one would score ${pct(efficiency(TUTORIAL_PUZZLE.optimal, game.moves))}.`;
      },
      onSkip: () => {
        tutorialMsg.textContent = 'Skipped. In the run, the next puzzle appears at once and this one never comes back.';
      },
    });
    tutorialSlot.replaceChildren(...tutorialArea.hudItems);
    tutorialHost.replaceChildren(tutorialArea.root);
  }
  const tutorialHost = el('div', {});
  body.append(
    el('section', { class: 'run-intro' },
      el('h2', { text: 'Before you start' }),
      el('ol', { class: 'exam-rules' },
        el('li', {}, el('strong', { text: '6:00 on the clock. ' }), 'Puzzles keep coming until time is up: first this set\'s 10 in a shuffled order, then freshly generated puzzles of the same difficulty.'),
        el('li', {}, el('strong', { text: 'One move = one cell. ' }), 'Select a piece (the ball starts selected), then use the arrow keys or the on-screen arrows.'),
        el('li', {}, el('strong', { text: 'No undo, no reset, no hints. ' }), 'Every move counts, as in the real format. Plan before you move.'),
        el('li', {}, el('strong', { text: 'Skip is final. ' }), 'A skipped puzzle scores 0 and never comes back.'),
        el('li', {}, el('strong', { text: 'Score: ' }), 'each solved puzzle scores fewest / your moves (1 at most). The run score is the sum.'),
        el('li', {}, el('strong', { text: 'Pace: ' }), `about ${cfg.paceSec} s per puzzle, so about ${atPace} puzzles in 6:00 for set ${setNo}. A good skip rule: no plan after ${Math.round(cfg.paceSec / 2)} s, or ${2 * cfg.paceSec} s spent, means skip.`),
        el('li', {}, el('strong', { text: 'Afterwards: ' }), 'the coach reviews every puzzle and the whole run. Leaving this page mid-run ends it without a run score.'),
      ),
      el('h3', { text: 'Try the sample puzzle (untimed, not scored)' }),
      el('p', { class: 'muted', text: 'This is the exact exam screen: board, clock, move counter and Skip.' }),
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
  let warned60 = false;
  let warned10 = false;

  function begin() {
    tutorialArea?.destroy();
    tutorialArea = null;
    setExamChrome(true);
    head.hidden = true;
    runSeed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    runId = newId('r');
    startedAt = Date.now();
    fresh = createFreshSource(setNo, runSeed);
    stream = createRunStream({ puzzles: data.puzzles, seed: runSeed, takeFresh: () => fresh.take() });
    body.replaceChildren(
      el('div', { class: 'exam-hud' }, clock, progress, hudSlot),
      flash,
      announcer,
      host,
    );
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
    const log = createAttemptLog({ game: GAME_ID, set: setNo, puzzleId: puzzle.id, mode: 'exam', runId, source, optimal: puzzle.optimal });
    current = { puzzle, source, index, log, done: false };
    area = createPlayArea(puzzle, {
      mode: 'exam',
      log,
      onSolved: () => {
        record('solved');
        flash.textContent = 'Solved.';
        advanceHandle = setTimeout(showNext, 500);
      },
      onSkip: () => {
        record('skipped');
        flash.textContent = `Skipped puzzle ${index + 1}.`;
        showNext();
      },
    });
    hudSlot.replaceChildren(...area.hudItems);
    host.replaceChildren(area.root);
    progress.textContent = `Puzzle ${index + 1}`;
    area.focus();
  }

  function record(outcome) {
    if (!current || current.done) return;
    current.done = true;
    const attempt = current.log.end(outcome, { moves: area.game.moves });
    recorder.saveAttempt(attempt);
    results.push({ attempt, puzzle: current.puzzle, source: current.source, index: current.index });
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(advanceHandle);
    timer?.stop();
    record('timeout');
    area?.destroy();
    area = null;
    fresh?.stop();
    setExamChrome(false);
    head.hidden = false;

    const run = summarizeRun({ id: runId, game: GAME_ID, set: setNo, seed: runSeed, startedAt, endedAt: Date.now(), budgetMs: RUN_MS, attempts: results.map((r) => r.attempt) });
    recorder.saveRun(run);
    // Endless runs: average over at least the 10 slots of a set, more if you reached more.
    const slots = Math.max(PUZZLES_PER_SET, results.length);
    const avg = averageEfficiency(run.score, slots);
    const wasOpen = setNo < SET_CONFIGS.length ? isUnlocked(setNo + 1) : true;
    const { improved, best } = store.recordRun(GAME_ID, setNo, run.score, slots);
    const nowOpen = setNo < SET_CONFIGS.length ? isUnlocked(setNo + 1) : true;

    const puzzlesById = new Map(results.map((r) => [r.puzzle.id, r.puzzle]));
    const history = recorder.attempts({ game: GAME_ID, set: setNo });
    const runCoach = coachRun(run, results.map((r) => r.attempt), puzzlesById, { paceSec: cfg.paceSec, budgetMs: RUN_MS, history });

    const review = el('div', { class: 'review-host' });
    const rows = results.map((r) => {
      const m = r.attempt.metrics;
      const label = r.attempt.outcome === 'solved' ? 'Solved' : r.attempt.outcome === 'timeout' ? 'Time up' : 'Skipped';
      return el('tr', {},
        el('td', { text: String(r.index + 1) }),
        el('td', {}, el('span', { class: `badge ${r.attempt.outcome === 'solved' ? 'badge-ok' : 'badge-warn'}`, text: label })),
        el('td', { text: String(m.moves) }),
        el('td', { text: String(r.puzzle.optimal) }),
        el('td', { text: pct(m.efficiency) }),
        el('td', { text: fmtSec(m.totalMs) }),
        el('td', { text: fmtSec(m.firstMoveMs) }),
        el('td', {},
          el('button', {
            type: 'button',
            class: 'btn btn-small',
            onclick: () => {
              review.replaceChildren(
                el('h3', { text: `Puzzle ${r.index + 1}${r.source === 'pool' ? '' : r.source === 'generated' ? ' (freshly generated)' : ' (rotated or mirrored variant)'}` }),
                coachHost(r.attempt, r.puzzle, cfg.paceSec),
                createExplainPanel(r.puzzle, { moves: m.moves, solved: r.attempt.outcome === 'solved' }, ctx),
              );
              review.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
            },
          }, 'Review'),
        ),
      );
    });

    body.replaceChildren(
      el('section', { class: 'run-summary' },
        el('h2', { text: 'Time is up' }),
        el('div', { class: 'score-tiles' },
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Run score' }), el('strong', { text: round2(run.score).toFixed(2) })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Solved' }), el('strong', { text: `${run.solved} of ${run.attempted} reached` })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Average efficiency' }), el('strong', { text: pct(avg) })),
          el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: 'Best for this set' }), el('strong', { text: `${round2(best).toFixed(2)}${improved ? ' (new best)' : ''}` })),
        ),
        runExtras(GAME_ID, setNo, improved),
        !wasOpen && nowOpen ? el('p', { class: 'callout callout-ok', text: `Set ${setNo + 1} unlocked. Nice work.` }) : null,
        avg < UNLOCK_THRESHOLD && setNo < SET_CONFIGS.length && !nowOpen
          ? el('p', { class: 'callout', text: `Reach ${pct(UNLOCK_THRESHOLD)} average efficiency (score / ${slots}) to unlock set ${setNo + 1}.` })
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
            el('thead', {}, el('tr', {}, ['#', 'Result', 'Your moves', 'Optimal', 'Efficiency', 'Time', 'First move', 'Coach and solution'].map((h) => el('th', { scope: 'col', text: h })))),
            el('tbody', {}, rows),
          ),
        ),
        el('div', { class: 'after-actions' },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => ctx.rerender() }, 'Run again'),
          el('a', { class: 'btn', href: '#/analytics' }, 'Progress and analytics'),
          el('a', { class: 'btn', href: '#/blockslide' }, 'Back to sets'),
        ),
        review,
      ),
    );
    body.querySelector('h2')?.setAttribute('tabindex', '-1');
    body.querySelector('h2')?.focus();
  }
}

// ---------------------------------------------------------------- entry

export async function mountBlockSlide(main, args = []) {
  const root = el('div', { class: 'blockslide' });
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
      else root.append(el('p', { class: 'notice' }, 'Unknown page. ', el('a', { href: '#/blockslide' }, 'Back to Block Slide')));
    } catch (err) {
      console.error(err);
      root.replaceChildren(el('p', { class: 'notice' }, `Could not load the puzzle: ${err.message}. If you opened the file directly, serve the folder over http (python3 -m http.server).`));
    }
  }
  await draw();
  return disposeAll;
}
