// Scoring rules shared by every game.
// Efficiency for one puzzle = optimal / yourMoves when solved (capped at 1), 0 when skipped or unsolved.

export const UNLOCK_THRESHOLD = 0.7;

export function efficiency(optimal, moves, solved = true) {
  if (!solved || !moves || moves <= 0) return 0;
  return Math.min(1, optimal / moves);
}

export function runScore(results) {
  return results.reduce((sum, r) => sum + efficiency(r.optimal, r.moves, r.solved), 0);
}

// Average efficiency across the whole set: unattempted puzzles count as 0.
export function averageEfficiency(score, setSize) {
  if (!setSize) return 0;
  return score / setSize;
}

export function pct(x) {
  return `${Math.round(x * 100)}%`;
}

export function round2(x) {
  return Math.round(x * 100) / 100;
}

export function movesSummary(moves, optimal) {
  return `you used ${moves}, optimal ${optimal}, efficiency ${pct(efficiency(optimal, moves))}`;
}
