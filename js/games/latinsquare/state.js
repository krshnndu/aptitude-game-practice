// Latin Square: pure puzzle model and game session (no DOM), shared by the solver, generator,
// explainer, coach, UI and tests.
//
// Puzzle JSON shape:
//   { id, n, symbols: ['circle', ...], rows: ['CS.T', ...], targets: [[r, c]], answers: ['D'],
//     depth, targetDepths: [d], blanks, steps }
// rows hold one letter per cell (the symbol's letter) or '.' for a blank. Targets are blank cells
// the player must fill; answers are the forced symbols, as letters. Inside the code a symbol is
// its index in puzzle.symbols and a cell is r * n + c.

// Every symbol has its own outline and letter, so colour is never the only cue. Colours follow
// the Okabe-Ito palette.
export const SYMBOLS = [
  { id: 'circle', name: 'circle', letter: 'C', colour: 'blue', hex: '#0072B2', hexDark: '#56A8E0' },
  { id: 'square', name: 'square', letter: 'S', colour: 'orange', hex: '#E69F00', hexDark: '#F2B33D' },
  { id: 'triangle', name: 'triangle', letter: 'T', colour: 'green', hex: '#009E73', hexDark: '#2CC596' },
  { id: 'diamond', name: 'diamond', letter: 'D', colour: 'pink', hex: '#CC79A7', hexDark: '#E09BC4' },
  { id: 'plus', name: 'plus', letter: 'P', colour: 'sky blue', hex: '#56B4E9', hexDark: '#8ACDF2' },
  { id: 'heart', name: 'heart', letter: 'H', colour: 'red', hex: '#D55E00', hexDark: '#F07B2C' },
];
export const BLANK = -1;
export const MAX_N = SYMBOLS.length;

const BY_ID = new Map(SYMBOLS.map((s) => [s.id, s]));
const BY_LETTER = new Map(SYMBOLS.map((s) => [s.letter, s]));

export function symbolById(id) {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`unknown symbol ${id}`);
  return s;
}

export function symbolByLetter(letter) {
  const s = BY_LETTER.get(letter);
  if (!s) throw new Error(`unknown symbol letter ${letter}`);
  return s;
}

// Parsed form used everywhere: { n, symbols: [SYMBOL], grid: Int8Array (BLANK or symbol index),
// targets: [cell], answers: [symbol index] }.
export function parsePuzzle(p) {
  const n = p.n;
  if (!(n >= 2 && n <= MAX_N)) throw new Error(`bad size ${n}`);
  const symbols = p.symbols.map(symbolById);
  if (symbols.length !== n) throw new Error(`${symbols.length} symbols for a ${n}x${n} grid`);
  const index = new Map(symbols.map((s, i) => [s.letter, i]));
  if (!Array.isArray(p.rows) || p.rows.length !== n) throw new Error('rows do not match n');
  const grid = new Int8Array(n * n).fill(BLANK);
  p.rows.forEach((row, r) => {
    if (row.length !== n) throw new Error(`row ${r + 1} has ${row.length} cells`);
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      if (!index.has(ch)) throw new Error(`row ${r + 1}: letter ${ch} is not one of the puzzle symbols`);
      grid[r * n + c] = index.get(ch);
    });
  });
  const targets = (p.targets || []).map(([r, c]) => r * n + c);
  const answers = (p.answers || []).map((ch) => {
    if (!index.has(ch)) throw new Error(`answer ${ch} is not one of the puzzle symbols`);
    return index.get(ch);
  });
  for (const t of targets) if (grid[t] !== BLANK) throw new Error('target cell is not blank');
  return { n, symbols, grid, targets, answers };
}

// Inverse of parsePuzzle for the grid part: Int8Array -> row strings.
export function gridRows(n, grid, symbols) {
  const rows = [];
  for (let r = 0; r < n; r++) {
    let s = '';
    for (let c = 0; c < n; c++) {
      const v = grid[r * n + c];
      s += v === BLANK ? '.' : symbols[v].letter;
    }
    rows.push(s);
  }
  return rows;
}

export const rowOf = (n, cell) => Math.floor(cell / n);
export const colOf = (n, cell) => cell % n;

// 1-based (row,column) for people.
export function cellLabel(n, cell) {
  return `(${rowOf(n, cell) + 1},${colOf(n, cell) + 1})`;
}

export function rowCells(n, r) {
  const out = [];
  for (let c = 0; c < n; c++) out.push(r * n + c);
  return out;
}

export function colCells(n, c) {
  const out = [];
  for (let r = 0; r < n; r++) out.push(r * n + c);
  return out;
}

// Other cells sharing a row or a column with `cell`.
export function peers(n, cell) {
  const r = rowOf(n, cell);
  const c = colOf(n, cell);
  return [...rowCells(n, r).filter((x) => x !== cell), ...colCells(n, c).filter((x) => x !== cell)];
}

// Where does symbol v already sit in this row / column? Returns the cell or -1.
export function findInRow(n, grid, r, v) {
  for (let c = 0; c < n; c++) if (grid[r * n + c] === v) return r * n + c;
  return -1;
}

export function findInCol(n, grid, c, v) {
  for (let r = 0; r < n; r++) if (grid[r * n + c] === v) return r * n + c;
  return -1;
}

// True when no symbol repeats in any row or column (blanks ignored).
export function isConsistent(n, grid) {
  for (let i = 0; i < n; i++) {
    const rowSeen = new Set();
    const colSeen = new Set();
    for (let j = 0; j < n; j++) {
      const a = grid[i * n + j];
      const b = grid[j * n + i];
      if (a !== BLANK) {
        if (rowSeen.has(a)) return false;
        rowSeen.add(a);
      }
      if (b !== BLANK) {
        if (colSeen.has(b)) return false;
        colSeen.add(b);
      }
    }
  }
  return true;
}

export function isLatinSquare(n, grid) {
  return grid.length === n * n && grid.every((v) => v >= 0 && v < n) && isConsistent(n, grid);
}

// Points for one timed-run puzzle: +1 when every target is right, minus 1 / (n - 1) when any is
// wrong, 0 for a skip. With n symbols a blind guess is right 1 time in n, so guessing scores 0 on
// average and careful work always pays more.
export function examPoints(outcome, n) {
  if (outcome === 'solved') return 1;
  if (outcome === 'wrong') return -1 / (n - 1);
  return 0;
}

// Run score: the sum of examPoints, never below 0.
export function examRunScore(outcomes, n) {
  return Math.max(0, outcomes.reduce((s, o) => s + examPoints(o, n), 0));
}

// Interactive session. mode 'practice': a wrong pick is ruled out and you pick again; the puzzle is
// solved when every target holds its answer. mode 'exam': each target takes one final pick; when all
// are answered the puzzle is over ('solved' if all are right, else 'wrong').
export function createGame(puzzle, { mode = 'practice' } = {}) {
  const P = parsePuzzle(puzzle);
  const { n, targets, answers } = P;
  const exam = mode === 'exam';
  const filled = targets.map(() => BLANK); // symbol shown in each target
  const ruledOut = targets.map(() => new Set()); // practice: wrong picks per target
  const picks = []; // { target, sym, ok }
  let selected = targets[0] ?? null;
  let status = 'playing'; // 'playing' | 'solved' | 'wrong' | 'skipped'

  const targetIndex = (cell) => targets.indexOf(cell);
  const nextOpen = (from = 0) => {
    for (let k = 0; k < targets.length; k++) {
      const t = (from + k) % targets.length;
      if (filled[t] === BLANK) return t;
    }
    return -1;
  };

  const game = {
    puzzle,
    parsed: P,
    n,
    mode,
    get status() {
      return status;
    },
    get playing() {
      return status === 'playing';
    },
    get selected() {
      return selected;
    },
    get activeTarget() {
      const t = selected === null ? -1 : targetIndex(selected);
      return t >= 0 && filled[t] === BLANK ? t : nextOpen();
    },
    get picks() {
      return picks.slice();
    },
    get pickCount() {
      return picks.length;
    },
    get wrongCount() {
      return picks.filter((p) => !p.ok).length;
    },
    get correctCount() {
      return filled.filter((v, t) => v === answers[t]).length;
    },
    filledAt(t) {
      return filled[t];
    },
    isRuledOut(t, sym) {
      return ruledOut[t]?.has(sym) ?? false;
    },
    // Value to draw in a cell: a given, a target's pick, or BLANK.
    valueAt(cell) {
      if (P.grid[cell] !== BLANK) return P.grid[cell];
      const t = targetIndex(cell);
      return t >= 0 ? filled[t] : BLANK;
    },
    isTarget(cell) {
      return targetIndex(cell) >= 0;
    },
    targetIndex,
    // Any cell may be selected: it highlights that cell's row and column.
    select(cell) {
      if (cell === null || (Number.isInteger(cell) && cell >= 0 && cell < n * n)) selected = cell;
      return selected;
    },
    // Returns { ok, target, done } or null when the pick is not allowed.
    pick(sym, t = game.activeTarget) {
      if (status !== 'playing' || !(sym >= 0 && sym < n)) return null;
      if (!(t >= 0 && t < targets.length) || filled[t] !== BLANK) return null;
      if (!exam && ruledOut[t].has(sym)) return null;
      const ok = sym === answers[t];
      picks.push({ target: t, sym, ok });
      if (ok || exam) filled[t] = sym;
      else ruledOut[t].add(sym);
      const open = nextOpen(t + 1);
      if (open < 0) status = filled.every((v, k) => v === answers[k]) ? 'solved' : 'wrong';
      else if (ok || exam) selected = targets[open];
      return { ok, target: t, done: status !== 'playing' };
    },
    skip() {
      if (status !== 'playing') return false;
      status = 'skipped';
      return true;
    },
  };
  return game;
}
