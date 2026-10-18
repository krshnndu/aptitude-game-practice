// Block Slide: pure board model and game session (no DOM), shared by the solver, generator,
// explainer, UI and tests.
//
// Puzzle JSON shape:
//   { id, n, exit: {r, c, side}, walls: [[r, c]], ball: {r, c},
//     blocks: [{r, c, len, dir: 'h'|'v'}], optimal, solution: [{p, d}] }
// Piece index 0 is the ball, blocks are 1..k in array order. A position is the cell index
// (r * n + c) of a piece's top-left cell.

export const DIRS = {
  U: { dr: -1, dc: 0, word: 'up' },
  D: { dr: 1, dc: 0, word: 'down' },
  L: { dr: 0, dc: -1, word: 'left' },
  R: { dr: 0, dc: 1, word: 'right' },
};
export const DIR_KEYS = ['U', 'D', 'L', 'R'];
export const OPPOSITE = { U: 'D', D: 'U', L: 'R', R: 'L' };

export const WALL = -2;
export const EMPTY = -1;

export function makeBoard(puzzle) {
  const n = puzzle.n;
  const walls = new Uint8Array(n * n);
  for (const [r, c] of puzzle.walls || []) walls[r * n + c] = 1;
  const shapes = [{ len: 1, dir: 'h' }];
  const start = [puzzle.ball.r * n + puzzle.ball.c];
  for (const b of puzzle.blocks) {
    shapes.push({ len: b.len, dir: b.len === 1 ? 'h' : b.dir });
    start.push(b.r * n + b.c);
  }
  return {
    n,
    walls,
    shapes,
    start,
    exit: puzzle.exit,
    exitIdx: puzzle.exit.r * n + puzzle.exit.c,
  };
}

export function pieceCells(board, i, pos) {
  const { n } = board;
  const { len, dir } = board.shapes[i];
  const cells = [];
  for (let k = 0; k < len; k++) cells.push(dir === 'h' ? pos + k : pos + k * n);
  return cells;
}

export function occupancy(board, positions) {
  const occ = new Int8Array(board.n * board.n).fill(EMPTY);
  for (let i = 0; i < board.walls.length; i++) if (board.walls[i]) occ[i] = WALL;
  for (let i = 0; i < positions.length; i++) {
    for (const cell of pieceCells(board, i, positions[i])) occ[cell] = i;
  }
  return occ;
}

// Cells a piece would newly enter when sliding one step in direction d (null if off board).
export function enteringCells(board, i, pos, d) {
  const { n } = board;
  const { len, dir } = board.shapes[i];
  const r = Math.floor(pos / n);
  const c = pos % n;
  const { dr, dc } = DIRS[d];
  const h = dir === 'h';
  const w = h ? len : 1;
  const ht = h ? 1 : len;
  const nr = r + dr;
  const nc = c + dc;
  if (nr < 0 || nc < 0 || nr + ht > n || nc + w > n) return null;
  const out = [];
  if (dr === -1) for (let k = 0; k < w; k++) out.push(nr * n + c + k);
  else if (dr === 1) for (let k = 0; k < w; k++) out.push((r + ht) * n + c + k);
  else if (dc === -1) for (let k = 0; k < ht; k++) out.push((r + k) * n + nc);
  else for (let k = 0; k < ht; k++) out.push((r + k) * n + c + w);
  return out;
}

export function canMove(board, positions, occ, i, d) {
  const cells = enteringCells(board, i, positions[i], d);
  if (!cells) return false;
  for (const cell of cells) if (occ[cell] !== EMPTY) return false;
  return true;
}

export function legalMoves(board, positions, occ = occupancy(board, positions)) {
  const moves = [];
  for (let i = 0; i < positions.length; i++) {
    for (const d of DIR_KEYS) if (canMove(board, positions, occ, i, d)) moves.push({ p: i, d });
  }
  return moves;
}

export function applyMove(board, positions, move) {
  const next = positions.slice();
  const { dr, dc } = DIRS[move.d];
  next[move.p] += dr * board.n + dc;
  return next;
}

export function isSolved(board, positions) {
  return positions[0] === board.exitIdx;
}

// Shortest ball-only route to the exit with every block and wall held fixed.
// Returns { dist, path } where path is the list of cells after the start, or dist = Infinity.
export function ballRoute(board, positions) {
  const occ = occupancy(board, positions);
  const { n } = board;
  const start = positions[0];
  if (start === board.exitIdx) return { dist: 0, path: [] };
  const prev = new Int32Array(n * n).fill(-1);
  prev[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const r = Math.floor(cur / n);
    const c = cur % n;
    for (const d of DIR_KEYS) {
      const nr = r + DIRS[d].dr;
      const nc = c + DIRS[d].dc;
      if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
      const nxt = nr * n + nc;
      if (prev[nxt] !== -1 || occ[nxt] !== EMPTY) continue;
      prev[nxt] = cur;
      if (nxt === board.exitIdx) {
        const path = [];
        for (let x = nxt; x !== start; x = prev[x]) path.push(x);
        path.reverse();
        return { dist: path.length, path };
      }
      queue.push(nxt);
    }
  }
  return { dist: Infinity, path: [] };
}

export function manhattan(board, a, b) {
  const { n } = board;
  return Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs((a % n) - (b % n));
}

export function cellLabel(board, cell) {
  // 1-based (row,col) for people.
  return `(${Math.floor(cell / board.n) + 1},${(cell % board.n) + 1})`;
}

export function stateKey(positions) {
  return String.fromCharCode(...positions);
}

// Interactive game session. Pure state, the UI layer renders it.
export function createGame(puzzle) {
  const board = makeBoard(puzzle);
  let positions = board.start.slice();
  let history = [];
  let selected = null;
  let status = 'playing'; // 'playing' | 'solved' | 'skipped'

  const game = {
    board,
    puzzle,
    get positions() {
      return positions;
    },
    get moves() {
      return history.length;
    },
    get history() {
      return history.slice();
    },
    get selected() {
      return selected;
    },
    get status() {
      return status;
    },
    get solved() {
      return status === 'solved';
    },
    pieceCount() {
      return positions.length;
    },
    select(i) {
      if (i === null || (Number.isInteger(i) && i >= 0 && i < positions.length)) selected = i;
      return selected;
    },
    // Select by cell index; returns the piece index there or null.
    selectAt(cell) {
      const occ = occupancy(board, positions);
      const who = occ[cell];
      if (who >= 0) selected = who;
      return who >= 0 ? who : null;
    },
    canMove(i, d) {
      if (status !== 'playing') return false;
      return canMove(board, positions, occupancy(board, positions), i, d);
    },
    legalDirs(i = selected) {
      if (i === null || status !== 'playing') return [];
      return DIR_KEYS.filter((d) => game.canMove(i, d));
    },
    move(i, d) {
      if (!game.canMove(i, d)) return false;
      positions = applyMove(board, positions, { p: i, d });
      history.push({ p: i, d });
      selected = i;
      if (isSolved(board, positions)) status = 'solved';
      return true;
    },
    moveSelected(d) {
      if (selected === null) return false;
      return game.move(selected, d);
    },
    // Direction that would move the selected piece into the given cell, if any.
    dirToward(cell) {
      if (selected === null) return null;
      for (const d of game.legalDirs(selected)) {
        if (enteringCells(board, selected, positions[selected], d).includes(cell)) return d;
      }
      return null;
    },
    undo() {
      if (status !== 'playing' || history.length === 0) return false;
      const last = history.pop();
      positions = applyMove(board, positions, { p: last.p, d: OPPOSITE[last.d] });
      selected = last.p;
      return true;
    },
    reset() {
      if (status !== 'playing') return false;
      positions = board.start.slice();
      history = [];
      selected = null;
      return true;
    },
    skip() {
      if (status !== 'playing') return false;
      status = 'skipped';
      selected = null;
      return true;
    },
    // Is the current position still on the stored optimal line?
    onOptimalLine() {
      const sol = puzzle.solution || [];
      if (history.length > sol.length) return false;
      return history.every((m, k) => m.p === sol[k].p && m.d === sol[k].d);
    },
  };
  return game;
}
