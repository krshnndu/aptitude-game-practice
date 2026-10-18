// Breadth-first search over piece positions. Returns an optimal (fewest moves) move list.
//
// Optional cap: only solutions of length <= cap are searched, and a state is pruned when
// depth + manhattan(ball, exit) > cap. Every move shifts the ball by at most one cell, so the
// prune is admissible: BFS still returns the true optimum whenever it is <= cap.

import {
  makeBoard,
  occupancy,
  canMove,
  applyMove,
  manhattan,
  stateKey,
  DIR_KEYS,
  DIRS,
  OPPOSITE,
} from './state.js';

export function solveBoard(board, startPositions = board.start, { cap = Infinity, maxStates = 5_000_000 } = {}) {
  const { exitIdx, n } = board;
  const exitR = Math.floor(exitIdx / n);
  const exitC = exitIdx % n;
  const dist = (pos) => Math.abs(Math.floor(pos / n) - exitR) + Math.abs((pos % n) - exitC);

  if (startPositions[0] === exitIdx) return { status: 'solved', optimal: 0, moves: [], states: 1 };
  if (dist(startPositions[0]) > cap) return { status: 'unsolvable', states: 1 };

  const keys = [stateKey(startPositions)];
  const parent = [-1];
  const moveP = [-1];
  const moveD = [''];
  const depth = [0];
  const seen = new Set(keys);
  const pieceCount = startPositions.length;

  for (let qi = 0; qi < keys.length; qi++) {
    const key = keys[qi];
    const pos = new Array(pieceCount);
    for (let i = 0; i < pieceCount; i++) pos[i] = key.charCodeAt(i);
    const d0 = depth[qi];
    if (d0 >= cap) continue;
    const occ = occupancy(board, pos);
    const lastP = moveP[qi];
    const lastBack = lastP >= 0 ? OPPOSITE[moveD[qi]] : '';
    for (let i = 0; i < pieceCount; i++) {
      for (const d of DIR_KEYS) {
        if (i === lastP && d === lastBack) continue; // undoing the previous move is never useful
        if (!canMove(board, pos, occ, i, d)) continue;
        const next = applyMove(board, pos, { p: i, d });
        if (i === 0 && d0 + 1 + dist(next[0]) > cap) continue;
        const nk = stateKey(next);
        if (seen.has(nk)) continue;
        seen.add(nk);
        keys.push(nk);
        parent.push(qi);
        moveP.push(i);
        moveD.push(d);
        depth.push(d0 + 1);
        if (next[0] === exitIdx) {
          const moves = [];
          for (let x = keys.length - 1; x > 0; x = parent[x]) moves.push({ p: moveP[x], d: moveD[x] });
          moves.reverse();
          return { status: 'solved', optimal: moves.length, moves, states: keys.length };
        }
        if (keys.length > maxStates) return { status: 'budget', states: keys.length };
      }
    }
  }
  return { status: 'unsolvable', states: keys.length };
}

export function solve(puzzle, opts) {
  return solveBoard(makeBoard(puzzle), undefined, opts);
}

// Replay a move list from the start; returns the final positions or throws on an illegal move.
export function replay(board, moves, from = board.start) {
  let pos = from.slice();
  for (const [k, m] of moves.entries()) {
    const occ = occupancy(board, pos);
    if (!(m.d in DIRS) || !canMove(board, pos, occ, m.p, m.d)) {
      throw new Error(`illegal move ${k + 1}: piece ${m.p} ${m.d}`);
    }
    pos = applyMove(board, pos, m);
  }
  return pos;
}

// Best next move from an arbitrary position. Uses the stored optimal line when the player
// is on it, otherwise searches (bounded) from the current position.
export function hint(puzzle, positions, movesSoFar = 0, { maxStates = 400_000 } = {}) {
  const board = makeBoard(puzzle);
  const sol = puzzle.solution || [];
  let pos = board.start.slice();
  const here = stateKey(positions);
  for (let k = 0; k <= sol.length; k++) {
    if (stateKey(pos) === here) {
      return k < sol.length ? { move: sol[k], remaining: sol.length - k, source: 'stored' } : null;
    }
    if (k < sol.length) pos = applyMove(board, pos, sol[k]);
  }
  // Undoing every move then playing the stored line is always possible, so this bounds the search.
  const cap = movesSoFar + (puzzle.optimal ?? sol.length);
  const res = solveBoard(board, positions, { cap, maxStates });
  if (res.status !== 'solved') return { move: null, remaining: null, source: res.status };
  return { move: res.moves[0] ?? null, remaining: res.optimal, source: 'search' };
}

export { manhattan };
