// Digit Equation UI: set menu, practice mode, timed run (exam mode), coach and explanation panels.
// All rules live in state.js; this file only renders and wires input. Every attempt is logged
// through the core recorder and reviewed by the coach.

import { el } from '../../core/dom.js';
import { runExtras } from '../../core/board.js';
import { Countdown, formatClock } from '../../core/timer.js';
import { createStore } from '../../core/store.js';
import { createRecorder, createAttemptLog, summarizeRun, newId } from '../../core/recorder.js';
import { efficiency, averageEfficiency, pct, round2, UNLOCK_THRESHOLD } from '../../core/score.js';
import { createGame, parsePuzzle, equationText, OPS, ERROR_TEXT } from './state.js';
import { solve, hintTarget } from './solver.js';
import { explainPuzzle, resultSummary, STRATEGY } from './explain.js';
import { SET_CONFIGS, PUZZLES_PER_SET } from './gen.js';
import { createRunStream, TUTORIAL_PUZZLE } from './stream.js';
import { coachPuzzle, coachRun } from './coach.js';

const GAME_ID = 'digitequation';
const RUN_MS = 6 * 60 * 1000;
const BASE = '#/digitequation';

const store = createStore();
const recorder = createRecorder();
const setCache = new Map();

const TECHNIQUE = {
  precedence: 'Order of operations',
  'leading-zero': 'Leading zero',
  division: 'Exact division',
  'last-digit': 'Last-digit test',
  estimate: 'Estimate',
  isolate: 'Undo the operations',
  try: 'Try each tile',
  single: 'Tile count',
};

function ensureCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-game-css="digitequation"]')) return;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('../../../css/digitequation.css', import.meta.url).href, 'data-game-css': 'digitequation' }));
}

function loadSet(setNo) {
  if (!setCache.has(setNo)) {
    const url = new URL(`../../../data/sets/digitequation/set${setNo}.json`, import.meta.url);
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

const puzzleId = (setNo, k) => `de${setNo}-${String(k).padStart(2, '0')}`;
const isUnlocked = (setNo) => store.isUnlocked(GAME_ID, setNo, PUZZLES_PER_SET);
const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtSec = (ms) => (ms === null || ms === undefined ? 'none' : `${(ms / 1000).toFixed(1)} s`);

// ---------------------------------------------------------------- equation view

// Renders the equation. Fixed digits are plain; blanks are boxes labelled A, B, C (buttons when
// interactive). update() shows the fill, the selected blank and highlights.
function createEquationView(puzzle, { interactive = false, small = false, label = 'Equation' } = {}) {
  const parsed = parsePuzzle(puzzle);
  const slotNodes = [];
  const row = el('div', { class: `de-eq${small ? ' is-small' : ''}`, role: interactive ? 'group' : 'img', 'aria-label': label });
  parsed.tokens.forEach((t, ti) => {
    if (t === '=') {
      row.append(el('span', { class: 'de-op de-equals', 'aria-hidden': 'true', text: '=' }));
      return;
    }
    if (t in OPS) {
      row.append(el('span', { class: 'de-op', 'aria-hidden': 'true', text: OPS[t].sym }));
      return;
    }
    const num = parsed.numbers.find((x) => x.tok === ti);
    const group = el('span', { class: 'de-num' });
    let k = 0;
    for (const ch of t) {
      if (ch !== '_') {
        group.append(el('span', { class: 'de-digit', 'aria-hidden': 'true', text: ch }));
        continue;
      }
      const s = parsed.slots[num.slots[k++]];
      const node = el(interactive ? 'button' : 'span', {
        class: 'de-slot',
        'data-slot': s.index,
        ...(interactive ? { type: 'button' } : { 'aria-hidden': 'true' }),
      },
      el('span', { class: 'de-slot-digit', 'aria-hidden': 'true' }),
      el('span', { class: 'de-slot-label', 'aria-hidden': 'true', text: s.label }));
      slotNodes.push(node);
      group.append(node);
    }
    row.append(group);
  });

  function update(fill, { selected = null, highlight = [], hintSlot = null, status = 'playing' } = {}) {
    slotNodes.forEach((node, i) => {
      const d = fill[i];
      node.querySelector('.de-slot-digit').textContent = Number.isInteger(d) ? String(d) : '';
      node.classList.toggle('is-filled', Number.isInteger(d));
      node.classList.toggle('is-selected', selected === i);
      node.classList.toggle('is-highlight', highlight.includes(i));
      node.classList.toggle('is-hint', hintSlot === i);
      node.classList.toggle('is-solved', status === 'solved');
      if (interactive) {
        node.setAttribute('aria-pressed', selected === i ? 'true' : 'false');
        node.setAttribute('aria-label', `Blank ${parsed.slots[i].label}: ${Number.isInteger(d) ? d : 'empty'}${selected === i ? ', selected' : ''}`);
        node.disabled = status !== 'playing';
      }
    });
    row.setAttribute('aria-label', `${label}: ${spoken(parsed, fill)}`);
  }

  function shake() {
    row.classList.remove('is-wrong');
    void row.offsetWidth;
    row.classList.add('is-wrong');
    setTimeout(() => row.classList.remove('is-wrong'), 900);
  }

  return { root: row, slotNodes, parsed, update, shake };
}

// Screen reader text: "4 blank A times 3 equals 1 2 6".
function spoken(parsed, fill) {
  return parsed.tokens.map((t, ti) => {
    if (t === '=') return 'equals';
    if (t in OPS) return OPS[t].word;
    const num = parsed.numbers.find((x) => x.tok === ti);
    let k = 0;
    return [...t].map((ch) => {
      if (ch !== '_') return ch;
      const s = parsed.slots[num.slots[k++]];
      return Number.isInteger(fill[s.index]) ? `${fill[s.index]} in blank ${s.label}` : `blank ${s.label}`;
    }).join(' ');
  }).join(', ');
}

// ---------------------------------------------------------------- play area (one puzzle)

// opts: { mode: 'practice'|'exam', log, onSolved(game), onSkip(game), onChange(game) }
function createPlayArea(puzzle, opts) {
  const exam = opts.mode === 'exam';
  const log = opts.log ?? null;
  const game = createGame(puzzle);
  const n = game.slotCount();
  const view = createEquationView(puzzle, { interactive: true, label: 'Equation' });
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' });
  const message = el('p', { class: 'play-message', role: 'status' });
  const placedOut = el('strong', { class: 'stat-value', text: '0' });
  let hintsUsed = 0;
  let hintLevel = 0;
  let hintSlot = null;
  let explanation = null;
  let solutions = null;
  let lastLoggedSelect;

  const trayButtons = new Map();
  const tray = el('div', { class: 'de-tray', role: 'group', 'aria-label': 'Digit tiles' });
  for (const t of puzzle.tray) {
    const count = el('span', { class: 'de-tile-count', 'aria-hidden': 'true' });
    const b = el('button', { type: 'button', class: 'de-tile', 'data-digit': t.d, onclick: () => doPlace(t.d) },
      el('span', { class: 'de-tile-digit', 'aria-hidden': 'true', text: String(t.d) }), count);
    trayButtons.set(t.d, { b, count, total: t.n });
    tray.append(b);
  }

  const checkBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => doCheck() }, 'Check');
  const clearBtn = el('button', { type: 'button', class: 'btn', onclick: () => doClear() }, 'Clear blank');
  const resetBtn = exam ? null : el('button', { type: 'button', class: 'btn', onclick: () => doReset() }, 'Reset');
  const hintBtn = exam ? null : el('button', { type: 'button', class: 'btn', onclick: () => doHint() }, 'Hint');
  const skipBtn = el('button', { type: 'button', class: 'btn btn-warn', onclick: () => doSkip() }, exam ? 'Skip' : 'Skip and show solution');

  const stats = el('div', { class: 'stats' },
    el('span', { class: 'stat' }, 'Tiles placed ', placedOut),
    el('span', { class: 'stat' }, 'Blanks ', el('strong', { class: 'stat-value', text: String(n) })),
  );
  const rules = el('p', { class: 'de-rules muted small' },
    `${OPS.x.sym} and ${OPS['/'].sym} before + and -. Divisions must be exact. No leading zeros. Each tile can be used as often as its count. The tray may hold decoys.`);

  const board = el('div', { class: 'de-board' }, view.root, tray, el('div', { class: 'controls de-controls' }, checkBtn, clearBtn, resetBtn, hintBtn, exam ? null : skipBtn));
  const root = exam
    ? el('div', { class: 'play-area is-exam de-play' }, el('div', { class: 'board-col' }, board, message, live, rules))
    : el('div', { class: 'play-area de-play' },
      el('div', { class: 'board-col' }, board),
      el('div', { class: 'side-col' },
        stats,
        message,
        live,
        rules,
        el('details', { class: 'help' },
          el('summary', {}, 'Controls'),
          el('ul', {},
            el('li', {}, 'Tap a blank to select it, then tap a tile. With no blank selected, a tile goes into the first empty blank.'),
            el('li', {}, 'Placing a tile on a filled blank swaps it; the old tile goes back to the tray.'),
            el('li', {}, 'Keys: digits 0 to 9 place a tile, Left and Right move between blanks, Backspace clears, Enter checks, H hint, Esc clears the selection.'),
          ),
        ),
      ),
    );

  function logSelect() {
    if (game.selected !== lastLoggedSelect) {
      log?.select(game.selected);
      lastLoggedSelect = game.selected;
    }
  }

  function say(text) {
    live.textContent = '';
    requestAnimationFrame(() => (live.textContent = text));
  }

  function render() {
    view.update(game.fill, { selected: game.selected, hintSlot, status: game.status });
    placedOut.textContent = String(game.placements);
    for (const [d, t] of trayButtons) {
      const left = game.left(d);
      t.count.textContent = t.total > 1 || left === 0 ? `${left} left` : '';
      t.b.classList.toggle('is-empty', left <= 0);
      t.b.setAttribute('aria-disabled', left <= 0 || game.status !== 'playing' ? 'true' : 'false');
      t.b.setAttribute('aria-label', `Tile ${d}, ${left} of ${t.total} left`);
      t.b.disabled = game.status !== 'playing';
    }
    const playing = game.status === 'playing';
    for (const b of [checkBtn, clearBtn, resetBtn, hintBtn, skipBtn]) if (b) b.disabled = !playing;
    if (playing) clearBtn.disabled = game.selected === null || game.fill[game.selected] === null;
    opts.onChange?.(game);
  }

  function selectSlot(i, { focus = false } = {}) {
    if (game.status !== 'playing') return;
    game.select(i);
    logSelect();
    render();
    if (focus && i !== null) view.slotNodes[i]?.focus({ preventScroll: true });
  }

  function doPlace(d) {
    if (game.status !== 'playing') return;
    const target = game.selected;
    const res = game.place(d);
    if (!res.ok) {
      if (res.reason === 'none-left') {
        message.textContent = `No ${d} tiles left. Clear or swap a blank to free one.`;
        say(message.textContent);
      }
      return;
    }
    if (target !== res.slot) {
      // The tile went to the first empty blank: log that selection so the replay matches.
      log?.select(res.slot);
    }
    log?.move(res.slot, d);
    lastLoggedSelect = res.slot;
    logSelect();
    hintSlot = null;
    message.textContent = '';
    render();
    const label = view.parsed.slots[res.slot].label;
    say(`${d} placed in blank ${label}${res.replaced !== null ? `, ${res.replaced} back to the tray` : ''}.${game.isFull() ? ' All blanks filled: press Check.' : ''}`);
  }

  function doClear() {
    const i = game.selected;
    if (i === null || !game.clear(i)) return;
    logSelect();
    log?.undo();
    hintSlot = null;
    message.textContent = '';
    render();
    say(`Blank ${view.parsed.slots[i].label} cleared.`);
  }

  function doReset() {
    if (!game.reset()) return;
    log?.reset();
    lastLoggedSelect = undefined;
    logSelect();
    hintSlot = null;
    message.textContent = 'All blanks cleared.';
    render();
    say(message.textContent);
  }

  function doCheck() {
    if (game.status !== 'playing') return;
    const res = game.check();
    if (!res.complete) {
      message.textContent = 'Fill every blank first.';
      say(message.textContent);
      return;
    }
    if (res.ok) {
      render();
      message.textContent = `True. Solved with ${game.placements} ${game.placements === 1 ? 'tile' : 'tiles'} placed.`;
      say(message.textContent);
      opts.onSolved?.(game, { hintsUsed });
      return;
    }
    log?.blocked(null, null);
    view.shake();
    if (exam) message.textContent = 'Not true. Change a tile or skip.';
    else if (!res.valid) message.textContent = `Not allowed: ${ERROR_TEXT[res.error]}.`;
    else message.textContent = `Not true: the left side is ${res.left}, the right side is ${res.right}.`;
    render();
    say(message.textContent);
  }

  function doSkip() {
    if (!game.skip()) return;
    hintSlot = null;
    render();
    opts.onSkip?.(game, { hintsUsed });
  }

  // Two-level hint: first the blank and the technique, then the full reasoning for it.
  function doHint() {
    if (game.status !== 'playing' || !hintBtn) return;
    explanation ??= explainPuzzle(puzzle);
    solutions ??= solve(puzzle).solutions;
    const target = hintTarget(puzzle, game.fill, explanation.unique ? [explanation.answer] : solutions);
    if (!target) {
      message.textContent = 'Every blank is right. Press Check.';
      say(message.textContent);
      return;
    }
    hintsUsed++;
    log?.hint();
    const label = view.parsed.slots[target.slot].label;
    const step = explanation.steps.find((s) => s.fixed.some((f) => f.slot === target.slot));
    const wrongNow = game.fill[target.slot] !== null;
    const sameTarget = hintSlot === target.slot;
    hintSlot = target.slot;
    if (hintLevel === 0 || !sameTarget) {
      hintLevel = 1;
      const how = step ? TECHNIQUE[step.technique] ?? 'Reason it out' : 'Reason it out';
      message.textContent = wrongNow
        ? `Hint: blank ${label} does not fit yet. Technique: ${how.toLowerCase()}. Press Hint again for the full step.`
        : `Hint: work on blank ${label} next. Technique: ${how.toLowerCase()}. Press Hint again for the full step.`;
    } else {
      hintLevel = 0;
      message.textContent = step ? `Hint: ${step.text}` : `Hint: blank ${label} is ${target.digit}.`;
    }
    selectSlot(target.slot);
    say(message.textContent);
  }

  view.root.addEventListener('click', (e) => {
    const node = e.target.closest('[data-slot]');
    if (!node || game.status !== 'playing') return;
    selectSlot(Number(node.dataset.slot));
  });

  function onKey(e) {
    if (game.status !== 'playing' || e.altKey || e.metaKey || e.ctrlKey) return;
    const active = document.activeElement;
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return;
    if (!root.isConnected) return;
    if (/^[0-9]$/.test(e.key)) {
      const d = Number(e.key);
      if (!trayButtons.has(d)) {
        message.textContent = `There is no ${d} tile in the tray.`;
        say(message.textContent);
        return;
      }
      e.preventDefault();
      const inEq = active && view.root.contains(active);
      doPlace(d);
      if (inEq && game.selected !== null) view.slotNodes[game.selected]?.focus({ preventScroll: true });
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (active && tray.contains(active)) return;
      e.preventDefault();
      game.selectNext(e.key === 'ArrowLeft' ? -1 : 1);
      selectSlot(game.selected, { focus: true });
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      doClear();
      return;
    }
    if (e.key === 'Enter') {
      const onButton = active && (active.tagName === 'BUTTON' || active.tagName === 'A') && !view.root.contains(active);
      if (onButton) return;
      e.preventDefault();
      doCheck();
      return;
    }
    if (e.key === 'Escape') {
      selectSlot(null);
      return;
    }
    if (!exam && (e.key === 'h' || e.key === 'H')) doHint();
  }
  document.addEventListener('keydown', onKey);

  logSelect();
  render();
  return {
    root,
    game,
    hudItems: exam ? [stats, skipBtn] : [],
    get hintsUsed() {
      return hintsUsed;
    },
    focus() {
      view.slotNodes[game.selected ?? 0]?.focus({ preventScroll: true });
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
}

// ---------------------------------------------------------------- explanation panel

function createExplainPanel(puzzle, result) {
  const ex = explainPuzzle(puzzle);
  const view = createEquationView(puzzle, { small: true, label: 'Solution' });
  let k = ex.steps.length;
  const reason = el('p', { class: 'step-reason', 'aria-live': 'polite' });
  const counter = el('span', { class: 'step-counter' });
  const prevBtn = el('button', { type: 'button', class: 'btn', onclick: () => go(k - 1) }, 'Prev');
  const nextBtn = el('button', { type: 'button', class: 'btn', onclick: () => go(k + 1) }, 'Next');
  const startBtn = el('button', { type: 'button', class: 'btn', onclick: () => go(0) }, 'Start');
  const items = ex.steps.map((s, i) =>
    el('li', {},
      el('button', { type: 'button', class: 'step-link', onclick: () => go(i + 1) },
        el('span', { class: 'badge badge-soon de-tech', text: TECHNIQUE[s.technique] ?? s.technique }), ' ', s.text),
    ),
  );
  const blankFill = new Array(ex.answer.length).fill(null);
  function go(j) {
    k = Math.max(0, Math.min(ex.steps.length, j));
    const step = k > 0 ? ex.steps[k - 1] : null;
    view.update(step ? step.fillAfter : blankFill, { highlight: step ? step.fixed.map((f) => f.slot) : [], status: 'shown' });
    counter.textContent = `Step ${k} of ${ex.steps.length}`;
    reason.textContent = step ? `${k}. ${step.text}` : 'Start: every blank empty. Press Next to follow the reasoning.';
    items.forEach((li, i) => li.toggleAttribute('aria-current', i === k - 1));
    prevBtn.disabled = k === 0;
    nextBtn.disabled = k === ex.steps.length;
  }

  const eff = efficiency(puzzle.optimal, result.placements, result.solved);
  const others = ex.others.map((f) => equationText(ex.parsed, f, { brackets: false }));
  const panel = el('section', { class: 'explain de-explain', 'aria-label': 'How to solve it' },
    el('div', { class: 'result-line' },
      el('span', { class: `badge ${result.solved ? (eff >= 1 && !result.wrongChecks ? 'badge-ok' : 'badge-mid') : 'badge-warn'}`, text: result.solved ? pct(eff) : result.outcome === 'timeout' ? 'Time up' : 'Skipped' }),
      el('p', { text: resultSummary({ placements: result.placements, blanks: puzzle.optimal, solved: result.solved, wrongChecks: result.wrongChecks }) }),
    ),
    el('h3', { text: 'How to solve it' }),
    el('p', { class: 'de-answer' }, el('strong', { text: 'Answer: ' }), equationText(ex.parsed, ex.answer, { brackets: false }),
      ex.unique ? el('span', { class: 'badge badge-ok de-unique', text: 'Unique answer' }) : el('span', { class: 'badge badge-mid de-unique', text: 'More than one answer' })),
    others.length ? el('p', { class: 'callout' }, `Also true with this tray (any true fill is accepted): ${others.join('; ')}.`) : null,
    el('div', { class: 'explain-body de-explain-body' },
      el('div', { class: 'explain-board' }, view.root, el('div', { class: 'replay-controls' }, startBtn, prevBtn, nextBtn), counter),
      el('div', { class: 'explain-steps' }, reason, el('ol', { class: 'step-list' }, items)),
    ),
    el('p', { class: 'de-check' }, el('strong', { text: 'Check: ' }), ex.check),
    el('details', { class: 'strategy', open: true },
      el('summary', {}, 'Mental-math tips for this puzzle'),
      el('ul', {}, ex.tips.map((t) => el('li', {}, el('strong', { text: `${t.title}: ` }), t.text))),
    ),
    el('details', { class: 'strategy' },
      el('summary', {}, 'Strategy checklist'),
      el('ul', {}, STRATEGY.map((s) => el('li', { text: s }))),
    ),
    el('p', { class: 'muted small', text: 'Blanks are named A, B, C in reading order. Every reason above is computed from the equation and the tray.' }),
  );
  go(ex.steps.length);
  return panel;
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
  let res;
  try {
    res = coachPuzzle(attempt, puzzle, { history: recorder.attempts({ game: GAME_ID, set: attempt.set }), paceSec });
  } catch (err) {
    console.error(err);
    return el('section', { class: 'coach' }, el('h3', { text: 'Coach' }), el('p', { class: 'muted', text: 'The coach could not review this attempt.' }));
  }
  const s = res.stats;
  const cells = [
    ['Time', fmtSec(s.totalMs)],
    ['First tile', fmtSec(s.firstPlaceMs)],
    ['Tiles placed', String(s.placed)],
    ['Blanks', String(s.blanks)],
    ['Wrong checks', String(s.wrong)],
    ['Swaps', String(s.swaps)],
  ];
  return el('section', { class: 'coach', 'aria-label': 'Coach' },
    el('h3', { text: 'Coach' }),
    el('dl', { class: 'metric-strip' }, cells.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v })))),
    el('ul', { class: 'findings', role: 'list' }, res.findings.map(findingItem)),
  );
}

// ---------------------------------------------------------------- menu

function renderMenu(ctx) {
  const { root } = ctx;
  const unlockToggle = el('input', {
    type: 'checkbox',
    id: 'de-unlock-all',
    onchange: (e) => {
      store.setUnlockAll(e.target.checked);
      ctx.rerender();
    },
  });
  unlockToggle.checked = store.unlockAll();
  root.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Digit Equation' }),
      el('p', { class: 'lede' },
        'Fill the blanks with tiles from the tray so the equation is true. ',
        `${OPS.x.sym} and ${OPS['/'].sym} are worked out before + and -, every division must come out exact, and a number of two or more digits cannot start with 0. `,
        'Each tile can be used as many times as its count shows, and the tray may hold decoys that no answer uses.'),
    ),
    el('div', { class: 'mode-explainer' },
      el('div', {}, el('h2', { text: 'Practice' }), el('p', { text: 'One puzzle, no clock, with two-level hints. After you solve or skip, the coach reviews your tiles and the explanation walks through the reasoning step by step.' })),
      el('div', {}, el('h2', { text: 'Timed run (exam mode)' }), el('p', { text: '6:00 on the clock and puzzles keep coming. No hints, and a skipped puzzle never comes back. Each solved puzzle scores blanks / tiles placed.' })),
    ),
    el('div', { class: 'toolbar' },
      el('label', { class: 'toggle de-unlock', for: 'de-unlock-all' }, unlockToggle, ' Unlock all sets (applies to every game)'),
      el('a', { class: 'btn', href: '#/analytics' }, 'Progress and analytics'),
      el('button', {
        type: 'button',
        class: 'btn btn-quiet',
        onclick: () => {
          if (confirm('Clear saved scores and unlocks for all games in this browser? (Your play history stays; clear it on the analytics page.)')) {
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
  const opsText = cfg.ops.map((o) => OPS[o].sym).join(' ');
  const chips = [];
  for (let k = 1; k <= PUZZLES_PER_SET; k++) {
    const best = entry.practice[puzzleId(cfg.set, k)];
    const label = best === undefined ? `Puzzle ${k}, not played` : `Puzzle ${k}, best efficiency ${pct(best)}`;
    chips.push(open
      ? el('a', { class: `chip${best >= 1 ? ' chip-perfect' : best > 0 ? ' chip-done' : ''}`, href: `${BASE}/practice/${cfg.set}/${k}`, 'aria-label': label, title: label }, String(k))
      : el('span', { class: 'chip chip-locked', 'aria-hidden': 'true' }, String(k)));
  }
  return el('li', { class: `set-card${open ? '' : ' is-locked'}` },
    el('div', { class: 'card-head' },
      el('h2', {}, `Set ${cfg.set}: ${cfg.name}`),
      el('span', { class: `badge ${open ? 'badge-ok' : 'badge-soon'}`, text: open ? 'Open' : 'Locked' }),
    ),
    el('p', { class: 'set-meta' }, `${cfg.blanks} ${cfg.blanks === 1 ? 'blank' : 'blanks'}, operators ${opsText}, ${cfg.decoys[0]} to ${cfg.decoys[1]} decoy tiles. Pace: about ${cfg.paceSec} s per puzzle.`),
    el('p', { class: 'set-progress' }, `Best timed run score: ${round2(entry.bestScore)} (${pct(entry.bestAvg)} average efficiency)`, ` | Practice average: ${pct(practiceAvg)}`),
    open
      ? el('div', { class: 'set-actions' },
        el('div', { class: 'chips', role: 'group', 'aria-label': `Practice puzzles in set ${cfg.set}` }, chips),
        el('a', { class: 'btn btn-primary', href: `${BASE}/run/${cfg.set}` }, 'Start timed run (6:00)'))
      : el('p', { class: 'muted', text: `Reach ${pct(UNLOCK_THRESHOLD)} average efficiency in set ${cfg.set - 1} (timed run, or practice bests across all its puzzles) to unlock, or tick Unlock all sets.` }),
  );
}

function lockedNotice(root, setNo) {
  root.append(el('section', { class: 'prose' },
    el('h1', { text: `Set ${setNo} is locked` }),
    el('p', { text: `Reach ${pct(UNLOCK_THRESHOLD)} average efficiency in set ${setNo - 1}, or turn on Unlock all sets.` }),
    el('p', {}, el('a', { class: 'btn', href: BASE }, 'Back to sets'))));
}

// ---------------------------------------------------------------- practice

async function renderPractice(ctx, setNo, k) {
  const { root } = ctx;
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg || !(k >= 1 && k <= PUZZLES_PER_SET)) {
    root.append(el('p', { class: 'notice' }, 'Unknown puzzle. ', el('a', { href: BASE }, 'Back to sets')));
    return;
  }
  if (!isUnlocked(setNo)) return lockedNotice(root, setNo);
  const data = await loadSet(setNo);
  const puzzle = data.puzzles[k - 1];
  const after = el('div', { class: 'after' });
  const nextHref = k < PUZZLES_PER_SET ? `${BASE}/practice/${setNo}/${k + 1}` : BASE;
  const nextLabel = k < PUZZLES_PER_SET ? 'Next puzzle' : 'Back to sets';
  const host = el('div', {});
  let area = null;

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
    area.focus();
  }

  function finish(game, outcome, hintsUsed, log) {
    const solved = outcome === 'solved';
    const attempt = log.end(outcome, { moves: game.placements, hintsUsed });
    recorder.saveAttempt(attempt);
    store.recordPractice(GAME_ID, setNo, puzzle.id, efficiency(puzzle.optimal, game.placements, solved));
    after.replaceChildren(
      el('div', { class: 'after-actions' },
        el('button', { type: 'button', class: 'btn', onclick: () => start() }, 'Try again'),
        el('a', { class: 'btn btn-primary', href: nextHref }, nextLabel)),
      coachHost(attempt, puzzle, cfg.paceSec),
      createExplainPanel(puzzle, { placements: game.placements, solved, wrongChecks: game.wrongChecks, outcome }),
    );
    after.querySelector('.after-actions .btn-primary')?.focus({ preventScroll: true });
    after.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  root.append(
    el('div', { class: 'page-head play-head' },
      el('p', { class: 'crumbs' }, el('a', { href: BASE }, 'Digit Equation'), ` / Set ${setNo}: ${cfg.name}`),
      el('h1', {}, `Practice: puzzle ${k} of ${PUZZLES_PER_SET}`),
      el('p', { class: 'muted' }, `Suggested pace: about ${cfg.paceSec} s. No clock in practice mode.`)),
    host,
    after,
    el('div', { class: 'after-actions' },
      k > 1 ? el('a', { class: 'btn btn-quiet', href: `${BASE}/practice/${setNo}/${k - 1}` }, 'Previous puzzle') : null,
      el('a', { class: 'btn btn-quiet', href: nextHref }, nextLabel)),
  );
  start();
  ctx.onDispose(() => area?.destroy());
}

// ---------------------------------------------------------------- timed run (exam mode)

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
    el('p', { class: 'crumbs' }, el('a', { href: BASE }, 'Digit Equation'), ` / Set ${setNo}: ${cfg.name}`),
    el('h1', {}, 'Timed run'));
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
  const results = [];
  ctx.onDispose(() => {
    timer?.stop();
    area?.destroy();
    tutorialArea?.destroy();
    clearTimeout(advanceHandle);
    setExamChrome(false);
  });

  // ---- pre-run tutorial
  const atPace = Math.floor(RUN_MS / (cfg.paceSec * 1000));
  const startBtn = el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => begin() }, 'I am ready: start the 6:00 run');
  const tutorialSlot = el('span', { class: 'hud-slot' });
  const tutorialHud = el('div', { class: 'exam-hud is-tutorial' }, el('span', { class: 'clock', 'aria-label': 'Time left (not running in the sample)' }, '6:00'), el('span', { class: 'run-progress', text: 'Sample' }), tutorialSlot);
  const tutorialMsg = el('p', { class: 'flash', role: 'status' });
  const tutorialHost = el('div', {});
  function startTutorial() {
    tutorialArea?.destroy();
    tutorialMsg.textContent = '';
    tutorialArea = createPlayArea(TUTORIAL_PUZZLE, {
      mode: 'exam',
      onSolved: (game) => {
        tutorialMsg.textContent = game.placements === TUTORIAL_PUZZLE.optimal
          ? 'True with one tile placed: that is how a puzzle scores 1.'
          : `True, with ${game.placements} tiles placed for 1 blank, so this one would score ${pct(efficiency(1, game.placements))}.`;
      },
      onSkip: () => {
        tutorialMsg.textContent = 'Skipped. In the run the next puzzle appears at once and this one never comes back.';
      },
    });
    tutorialSlot.replaceChildren(...tutorialArea.hudItems);
    tutorialHost.replaceChildren(tutorialArea.root);
  }
  body.append(el('section', { class: 'run-intro' },
    el('h2', { text: 'Before you start' }),
    el('ol', { class: 'exam-rules' },
      el('li', {}, el('strong', { text: '6:00 on the clock. ' }), 'Puzzles keep coming until time is up: first this set\'s 10 in a shuffled order, then freshly generated puzzles of the same kind.'),
      el('li', {}, el('strong', { text: 'Fill the blanks, then Check. ' }), 'Tap a blank, then a tile (or type a digit). A wrong check is allowed: change a tile and check again.'),
      el('li', {}, el('strong', { text: 'Rules: ' }), `${OPS.x.sym} and ${OPS['/'].sym} before + and -, exact division only, no leading zeros, each tile as often as its count. The tray may hold decoys.`),
      el('li', {}, el('strong', { text: 'No hints. Skip is final. ' }), 'A skipped puzzle scores 0 and never comes back.'),
      el('li', {}, el('strong', { text: 'Score: ' }), 'each solved puzzle scores blanks / tiles placed (1 at most), so every swap costs. The run score is the sum.'),
      el('li', {}, el('strong', { text: 'Pace: ' }), `about ${cfg.paceSec} s per puzzle, so about ${atPace} puzzles in 6:00 for set ${setNo}. A good skip rule: no blank pinned down after ${Math.round(cfg.paceSec / 2)} s, or ${2 * cfg.paceSec} s spent, means skip.`),
      el('li', {}, el('strong', { text: 'Afterwards: ' }), 'the coach reviews every puzzle and the whole run. Leaving this page mid-run ends it without a run score.'),
    ),
    el('h3', { text: 'Try the sample puzzle (untimed, not scored)' }),
    el('p', { class: 'muted', text: 'This is the exact exam screen: equation, tray, clock, tile counter and Skip.' }),
    tutorialHud,
    tutorialMsg,
    tutorialHost,
    el('div', { class: 'after-actions' },
      el('button', { type: 'button', class: 'btn', onclick: () => startTutorial() }, 'Restart sample'),
      startBtn),
  ));
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
    stream = createRunStream({ puzzles: data.puzzles, seed: runSeed, setNo });
    body.replaceChildren(el('div', { class: 'exam-hud' }, clock, progress, hudSlot), flash, announcer, host);
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
        flash.textContent = 'True. Next puzzle.';
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
    const attempt = current.log.end(outcome, { moves: area.game.placements });
    recorder.saveAttempt(attempt);
    results.push({ attempt, puzzle: current.puzzle, source: current.source, index: current.index, wrongChecks: area.game.wrongChecks });
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(advanceHandle);
    timer?.stop();
    record('timeout');
    area?.destroy();
    area = null;
    setExamChrome(false);
    head.hidden = false;

    const run = summarizeRun({ id: runId, game: GAME_ID, set: setNo, seed: runSeed, startedAt, endedAt: Date.now(), budgetMs: RUN_MS, attempts: results.map((r) => r.attempt) });
    recorder.saveRun(run);
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
        el('td', { class: 'de-eq-cell', text: equationText(parsePuzzle(r.puzzle), new Array(r.puzzle.optimal).fill(null)) }),
        el('td', { text: String(m.grossMoves) }),
        el('td', { text: String(r.puzzle.optimal) }),
        el('td', { text: String(r.wrongChecks) }),
        el('td', { text: pct(m.efficiency) }),
        el('td', { text: fmtSec(m.totalMs) }),
        el('td', { text: fmtSec(m.firstMoveMs) }),
        el('td', {}, el('button', {
          type: 'button',
          class: 'btn btn-small',
          onclick: () => {
            review.replaceChildren(
              el('h3', { text: `Puzzle ${r.index + 1}${r.source === 'generated' ? ' (freshly generated)' : r.source === 'repeat' ? ' (repeated)' : ''}` }),
              coachHost(r.attempt, r.puzzle, cfg.paceSec),
              createExplainPanel(r.puzzle, { placements: m.grossMoves, solved: r.attempt.outcome === 'solved', wrongChecks: r.wrongChecks, outcome: r.attempt.outcome }),
            );
            review.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
          },
        }, 'Review')),
      );
    });

    body.replaceChildren(el('section', { class: 'run-summary' },
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
            el('ol', { class: 'habits' }, runCoach.habits.map((h) => el('li', {}, el('strong', { text: h.label }), ` (in ${h.count} of ${h.of} puzzles). `, h.tip))))
          : el('p', { class: 'muted', text: 'No repeated habit to fix in this run.' }),
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'results' },
          el('caption', { class: 'sr-only', text: 'Results per puzzle' }),
          el('thead', {}, el('tr', {}, ['#', 'Result', 'Equation', 'Tiles placed', 'Blanks', 'Wrong checks', 'Efficiency', 'Time', 'First tile', 'Coach and solution'].map((h) => el('th', { scope: 'col', text: h })))),
          el('tbody', {}, rows))),
      el('div', { class: 'after-actions' },
        el('button', { type: 'button', class: 'btn btn-primary', onclick: () => ctx.rerender() }, 'Run again'),
        el('a', { class: 'btn', href: '#/analytics' }, 'Progress and analytics'),
        el('a', { class: 'btn', href: BASE }, 'Back to sets')),
      review,
    ));
    body.querySelector('h2')?.setAttribute('tabindex', '-1');
    body.querySelector('h2')?.focus();
  }
}

// ---------------------------------------------------------------- entry

export async function mountDigitEquation(main, args = []) {
  ensureCss();
  const root = el('div', { class: 'digitequation' });
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
      else root.append(el('p', { class: 'notice' }, 'Unknown page. ', el('a', { href: BASE }, 'Back to Digit Equation')));
    } catch (err) {
      console.error(err);
      root.replaceChildren(el('p', { class: 'notice' }, `Could not load the puzzle: ${err.message}. If you opened the file directly, serve the folder over http (python3 -m http.server).`));
    }
  }
  await draw();
  return disposeAll;
}
