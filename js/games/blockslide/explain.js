// "How it should have been solved": turns an optimal move list into steps with a plain-English
// reason per step. Reasons are computed, not written by hand:
//   - a block move is linked to the first later move that enters a cell it vacated
//     (the ball's route, the exit cell, or room for another block),
//   - otherwise it is judged by the ball's shortest route with all blocks held fixed,
//   - a ball move is described by its distance to the exit, or as stepping aside for a block.

import {
  makeBoard,
  pieceCells,
  enteringCells,
  applyMove,
  ballRoute,
  manhattan,
  cellLabel,
  isSolved,
  DIRS,
} from './state.js';
import { efficiency, pct } from '../../core/score.js';

// Okabe-Ito based palette plus a distinct pattern and letter per block, so colour is never
// the only cue.
export const PIECE_STYLES = [
  { letter: 'A', colour: 'blue', hex: '#0072B2', pattern: 'diag' },
  { letter: 'B', colour: 'orange', hex: '#E69F00', pattern: 'dots' },
  { letter: 'C', colour: 'green', hex: '#009E73', pattern: 'grid' },
  { letter: 'D', colour: 'pink', hex: '#CC79A7', pattern: 'hlines' },
  { letter: 'E', colour: 'sky blue', hex: '#56B4E9', pattern: 'vlines' },
  { letter: 'F', colour: 'red', hex: '#D55E00', pattern: 'checks' },
  { letter: 'G', colour: 'grey', hex: '#8C8C8C', pattern: 'rdiag' },
  { letter: 'H', colour: 'purple', hex: '#7E57C2', pattern: 'solid' },
];

export function blockStyle(i) {
  return PIECE_STYLES[(i - 1) % PIECE_STYLES.length];
}

export function pieceName(i) {
  if (i === 0) return 'ball';
  const s = blockStyle(i);
  return `block ${s.letter} (${s.colour})`;
}

export function moveText(m) {
  return `Move ${pieceName(m.p)} 1 ${DIRS[m.d].word}`;
}

export const STRATEGY = [
  'Look at the exit lane first: which cells between the ball and the exit are blocked?',
  'Plan backwards from the exit: what must move for the last ball steps to be free?',
  'Count your plan before moving: compare it with the fewest-moves target.',
  'Prefer moving a block out of the lane in one step over a longer detour for the ball.',
  'Skip if you have no plan within about 10 seconds: in a timed run, time is the scarce resource.',
];

function firstDependent(board, states, moves, i, cells) {
  const wanted = new Set(cells);
  for (let j = i + 1; j < moves.length; j++) {
    const m = moves[j];
    const entering = enteringCells(board, m.p, states[j][m.p], m.d) || [];
    const hit = entering.find((c) => wanted.has(c));
    if (hit !== undefined) return { j, move: m, cell: hit };
  }
  return null;
}

function routeText(d) {
  return d === 1 ? '1 move' : `${d} moves`;
}

function reasonFor(board, states, moves, i) {
  const m = moves[i];
  const before = states[i];
  const after = states[i + 1];
  const exit = board.exitIdx;

  if (m.p === 0) {
    if (isSolved(board, after)) return `the ball reaches the exit cell ${cellLabel(board, exit)}. Solved.`;
    const dep = firstDependent(board, states, moves, i, [before[0]]);
    if (dep && dep.move.p !== 0) {
      return `steps aside so ${pieceName(dep.move.p)} can use cell ${cellLabel(board, dep.cell)} at step ${dep.j + 1}.`;
    }
    const dBefore = manhattan(board, before[0], exit);
    const dAfter = manhattan(board, after[0], exit);
    if (dAfter < dBefore) {
      return `heads toward the exit, now ${dAfter} ${dAfter === 1 ? 'cell' : 'cells'} away.`;
    }
    return `detours away from the exit because the direct line is blocked, now ${dAfter} cells away.`;
  }

  const oldCells = pieceCells(board, m.p, before[m.p]);
  const newCells = new Set(pieceCells(board, m.p, after[m.p]));
  const vacated = oldCells.filter((c) => !newCells.has(c));
  const rBefore = ballRoute(board, before).dist;
  const rAfter = ballRoute(board, after).dist;
  const opened = rBefore === Infinity && rAfter !== Infinity;
  const routeNote = opened ? ` The ball now has an open route of ${routeText(rAfter)}.` : '';

  const dep = firstDependent(board, states, moves, i, vacated);
  if (dep) {
    const where = cellLabel(board, dep.cell);
    if (dep.move.p === 0) {
      if (dep.cell === exit) return `clears the exit cell ${where}.${routeNote}`;
      return `clears cell ${where} on the ball's route.${routeNote}`;
    }
    return `makes room for ${pieceName(dep.move.p)} to move ${DIRS[dep.move.d].word} into ${where} at step ${dep.j + 1}.${routeNote}`;
  }
  if (opened) return `opens a route for the ball: ${routeText(rAfter)} to the exit with nothing else moving.`;
  if (rAfter < rBefore) return `shortens the ball's route from ${routeText(rBefore)} to ${routeText(rAfter)}.`;
  return 'moves out of the way of the planned route.';
}

// Returns { steps, states, solved } where states[k] is the position before step k
// (states[steps.length] is the final position).
export function explainSolution(puzzle, moves = puzzle.solution) {
  const board = makeBoard(puzzle);
  const states = [board.start.slice()];
  for (const m of moves) states.push(applyMove(board, states[states.length - 1], m));
  const steps = moves.map((m, i) => {
    const reason = reasonFor(board, states, moves, i);
    return { index: i, move: m, piece: m.p, dir: m.d, text: `${moveText(m)}: ${reason}`, reason };
  });
  return { steps, states, solved: isSolved(board, states[states.length - 1]), board };
}

export function resultSummary({ moves, optimal, solved }) {
  if (!solved) return `Skipped: efficiency 0%. The optimal solution uses ${optimal} moves.`;
  const eff = efficiency(optimal, moves);
  const tail = eff >= 1 ? ' Optimal, well done.' : '';
  return `You used ${moves}, optimal ${optimal}, efficiency ${pct(eff)}.${tail}`;
}
