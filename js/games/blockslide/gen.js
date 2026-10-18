// Offline puzzle generator for Block Slide. Deterministic per seed (mulberry32).
// A layout is kept only when:
//   - the ball cannot already walk to the exit with every block fixed (no trivial start),
//   - the BFS optimum lies inside the set's move band,
//   - the optimal line moves at least minBlockMoves blocks,
//   - it is not a duplicate of an earlier puzzle.

import { createRng } from '../../core/rng.js';
import { makeBoard, ballRoute, manhattan, EMPTY } from './state.js';
import { solveBoard } from './solver.js';

export const SET_CONFIGS = [
  { set: 1, name: 'Warm-up', n: 4, blockers: [2, 3], walls: [0, 0], band: [3, 5], minBlockMoves: 1, paceSec: 20, seed: 1101 },
  { set: 2, name: 'Getting moving', n: 5, blockers: [3, 4], walls: [0, 0], band: [5, 7], minBlockMoves: 2, paceSec: 30, seed: 2202 },
  { set: 3, name: 'Planning ahead', n: 5, blockers: [4, 5], walls: [0, 0], band: [7, 10], minBlockMoves: 3, paceSec: 40, seed: 3303 },
  { set: 4, name: 'Walls appear', n: 6, blockers: [5, 6], walls: [1, 2], band: [9, 13], minBlockMoves: 3, paceSec: 50, seed: 4404 },
  { set: 5, name: 'Expert', n: 6, blockers: [7, 8], walls: [2, 3], band: [12, 18], minBlockMoves: 4, paceSec: 60, seed: 5505 },
];

export const PUZZLES_PER_SET = 10;

export function configFor(setNo) {
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg) throw new Error(`unknown set ${setNo}`);
  return cfg;
}

const SIDES = ['top', 'bottom', 'left', 'right'];

function randomExit(rng, n) {
  const side = rng.pick(SIDES);
  const k = rng.int(0, n - 1);
  if (side === 'top') return { r: 0, c: k, side };
  if (side === 'bottom') return { r: n - 1, c: k, side };
  if (side === 'left') return { r: k, c: 0, side };
  return { r: k, c: n - 1, side };
}

// Try to build one random layout; returns a puzzle skeleton or null.
export function randomLayout(rng, cfg) {
  const { n } = cfg;
  const exit = randomExit(rng, n);
  const exitIdx = exit.r * n + exit.c;
  const occ = new Int8Array(n * n).fill(EMPTY);

  // Ball well away from the exit so the route has some length.
  const minDist = Math.max(2, Math.floor(n * 0.6));
  const ballCandidates = [];
  for (let cell = 0; cell < n * n; cell++) {
    const d = Math.abs(Math.floor(cell / n) - exit.r) + Math.abs((cell % n) - exit.c);
    if (d >= minDist) ballCandidates.push(cell);
  }
  const ballCell = rng.pick(ballCandidates);
  occ[ballCell] = 0;

  const walls = [];
  const wallCount = rng.int(cfg.walls[0], cfg.walls[1]);
  for (let tries = 0; walls.length < wallCount && tries < 100; tries++) {
    const cell = rng.int(0, n * n - 1);
    if (occ[cell] !== EMPTY || cell === exitIdx) continue;
    occ[cell] = -2;
    walls.push([Math.floor(cell / n), cell % n]);
  }
  if (walls.length < wallCount) return null;

  const blocks = [];
  const blockCount = rng.int(cfg.blockers[0], cfg.blockers[1]);
  for (let tries = 0; blocks.length < blockCount && tries < 300; tries++) {
    const len = rng.pick([1, 2, 2, 3, 3]);
    const dir = len === 1 ? 'h' : rng.pick(['h', 'v']);
    const w = dir === 'h' ? len : 1;
    const h = dir === 'h' ? 1 : len;
    const r = rng.int(0, n - h);
    const c = rng.int(0, n - w);
    const cells = [];
    for (let k = 0; k < len; k++) cells.push(dir === 'h' ? r * n + c + k : (r + k) * n + c);
    if (cells.some((x) => occ[x] !== EMPTY)) continue;
    for (const x of cells) occ[x] = blocks.length + 1;
    blocks.push({ r, c, len, dir });
  }
  if (blocks.length < blockCount) return null;

  return {
    n,
    exit,
    walls,
    ball: { r: Math.floor(ballCell / n), c: ballCell % n },
    blocks,
  };
}

export function layoutKey(p) {
  const blocks = p.blocks.map((b) => `${b.r},${b.c},${b.len},${b.len === 1 ? 'h' : b.dir}`).sort();
  const walls = (p.walls || []).map((w) => w.join(',')).sort();
  return `${p.n}|${p.exit.r},${p.exit.c}|${p.ball.r},${p.ball.c}|${walls.join(';')}|${blocks.join(';')}`;
}

// Ball can reach the exit without any block moving (includes a clear straight lane).
export function isTrivial(puzzle) {
  const board = makeBoard(puzzle);
  return ballRoute(board, board.start).dist !== Infinity;
}

export function blockMoveCount(moves) {
  return moves.filter((m) => m.p !== 0).length;
}

export function generateSet(cfg, { count = PUZZLES_PER_SET, seed = cfg.seed, maxAttempts = 200_000, maxStates = 1_500_000, log = null } = {}) {
  const rng = createRng(seed);
  const puzzles = [];
  const seen = new Set();
  const [lo, hi] = cfg.band;
  // Spread the set across the band instead of clustering at the easy end.
  const maxPerValue = Math.ceil(count / (hi - lo + 1)) + 2;
  const perValue = new Map();
  let attempts = 0;
  while (puzzles.length < count) {
    attempts++;
    if (attempts > maxAttempts) {
      throw new Error(`set ${cfg.set}: only ${puzzles.length}/${count} puzzles after ${maxAttempts} attempts`);
    }
    const layout = randomLayout(rng, cfg);
    if (!layout) continue;
    const key = layoutKey(layout);
    if (seen.has(key)) continue;
    seen.add(key);
    if (isTrivial(layout)) continue;
    const board = makeBoard(layout);
    if (manhattan(board, board.start[0], board.exitIdx) > hi) continue;
    const res = solveBoard(board, board.start, { cap: hi, maxStates });
    if (res.status !== 'solved') continue;
    if (res.optimal < lo || res.optimal > hi) continue;
    if (blockMoveCount(res.moves) < cfg.minBlockMoves) continue;
    if ((perValue.get(res.optimal) ?? 0) >= maxPerValue) continue;
    perValue.set(res.optimal, (perValue.get(res.optimal) ?? 0) + 1);
    const id = `bs${cfg.set}-${String(puzzles.length + 1).padStart(2, '0')}`;
    puzzles.push({ id, ...layout, optimal: res.optimal, solution: res.moves });
    if (log) log(`  ${id}: optimal ${res.optimal} (${res.states} states, attempt ${attempts})`);
  }
  // Present the set as a ladder: easier puzzles first.
  puzzles.sort((a, b) => a.optimal - b.optimal);
  puzzles.forEach((p, k) => (p.id = `bs${cfg.set}-${String(k + 1).padStart(2, '0')}`));
  return {
    game: 'blockslide',
    version: 1,
    set: cfg.set,
    name: cfg.name,
    n: cfg.n,
    band: cfg.band,
    paceSec: cfg.paceSec,
    seed,
    puzzles,
  };
}

