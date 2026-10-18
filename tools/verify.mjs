#!/usr/bin/env node
// Re-verify every shipped Block Slide set with the solver.
// Checks per puzzle: legal layout, non-trivial start, solvable, BFS optimum equals the stored
// optimum, optimum inside the set band, stored solution replays legally to a solved board in
// exactly `optimal` moves, and no duplicates. Exits non-zero on any failure.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_CONFIGS, PUZZLES_PER_SET, isTrivial, layoutKey } from '../js/games/blockslide/gen.js';
import { makeBoard, isSolved } from '../js/games/blockslide/state.js';
import { solveBoard, replay } from '../js/games/blockslide/solver.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function setPath(setNo) {
  return join(root, 'data', 'sets', 'blockslide', `set${setNo}.json`);
}

export function loadSet(setNo) {
  return JSON.parse(readFileSync(setPath(setNo), 'utf8'));
}

function checkLayout(p) {
  const { n } = p;
  const inside = (r, c) => r >= 0 && c >= 0 && r < n && c < n;
  const seenCells = new Set();
  const claim = (r, c, what) => {
    if (!inside(r, c)) throw new Error(`${what} off board at (${r},${c})`);
    const k = r * n + c;
    if (seenCells.has(k)) throw new Error(`overlap at (${r},${c})`);
    seenCells.add(k);
  };
  const e = p.exit;
  const onEdge = (e.side === 'top' && e.r === 0) || (e.side === 'bottom' && e.r === n - 1) ||
    (e.side === 'left' && e.c === 0) || (e.side === 'right' && e.c === n - 1);
  if (!onEdge) throw new Error('exit is not on the stated board edge');
  for (const [r, c] of p.walls || []) {
    claim(r, c, 'wall');
    if (r === e.r && c === e.c) throw new Error('wall on exit');
  }
  claim(p.ball.r, p.ball.c, 'ball');
  for (const b of p.blocks) {
    if (!(b.len >= 1 && b.len <= 3)) throw new Error(`block length ${b.len}`);
    for (let k = 0; k < b.len; k++) claim(b.dir === 'h' ? b.r : b.r + k, b.dir === 'h' ? b.c + k : b.c, 'block');
  }
}

// Returns a list of problem strings (empty when the set is valid).
export function checkSet(data, cfg, { maxStates = 5_000_000 } = {}) {
  const problems = [];
  const tag = `set ${cfg.set}`;
  if (data.set !== cfg.set) problems.push(`${tag}: file says set ${data.set}`);
  if (data.n !== cfg.n) problems.push(`${tag}: n ${data.n} != ${cfg.n}`);
  if (data.puzzles.length !== PUZZLES_PER_SET) problems.push(`${tag}: ${data.puzzles.length} puzzles, expected ${PUZZLES_PER_SET}`);
  const [lo, hi] = cfg.band;
  const keys = new Set();
  const ids = new Set();
  for (const p of data.puzzles) {
    const where = `${tag} ${p.id}`;
    try {
      if (ids.has(p.id)) throw new Error('duplicate id');
      ids.add(p.id);
      if (p.n !== cfg.n) throw new Error(`n ${p.n}`);
      checkLayout(p);
      const k = layoutKey(p);
      if (keys.has(k)) throw new Error('duplicate layout');
      keys.add(k);
      const walls = (p.walls || []).length;
      if (walls < cfg.walls[0] || walls > cfg.walls[1]) throw new Error(`${walls} walls outside ${cfg.walls}`);
      if (p.blocks.length < cfg.blockers[0] || p.blocks.length > cfg.blockers[1]) throw new Error(`${p.blocks.length} blockers outside ${cfg.blockers}`);
      if (isTrivial(p)) throw new Error('trivial: ball can reach the exit without moving a block');
      if (!(p.optimal >= lo && p.optimal <= hi)) throw new Error(`stored optimal ${p.optimal} outside band ${lo}-${hi}`);
      const board = makeBoard(p);
      const res = solveBoard(board, board.start, { cap: p.optimal, maxStates });
      if (res.status === 'budget') throw new Error('solver budget exceeded');
      if (res.status !== 'solved') throw new Error(`no solution within stored optimal ${p.optimal} (unsolvable or stored value too low)`);
      if (res.optimal !== p.optimal) throw new Error(`BFS optimum ${res.optimal} != stored ${p.optimal}`);
      if (!Array.isArray(p.solution) || p.solution.length !== p.optimal) throw new Error('stored solution length != optimal');
      const end = replay(board, p.solution);
      if (!isSolved(board, end)) throw new Error('stored solution does not reach the exit');
    } catch (err) {
      problems.push(`${where}: ${err.message}`);
    }
  }
  return problems;
}

export function verifyAll({ log = console.log } = {}) {
  let total = 0;
  let bad = 0;
  const rows = [];
  for (const cfg of SET_CONFIGS) {
    const file = setPath(cfg.set);
    if (!existsSync(file)) {
      log(`FAIL set ${cfg.set}: missing ${file}`);
      bad++;
      continue;
    }
    const t0 = Date.now();
    const data = loadSet(cfg.set);
    const problems = checkSet(data, cfg);
    total += data.puzzles.length;
    bad += problems.length;
    for (const p of problems) log(`FAIL ${p}`);
    const opts = data.puzzles.map((p) => p.optimal);
    rows.push({ set: cfg.set, n: cfg.n, band: cfg.band, opts, ok: problems.length === 0, secs: (Date.now() - t0) / 1000 });
  }
  log('');
  log('Block Slide verification');
  log('set  grid  band    puzzles  optimal moves                 status  time');
  for (const r of rows) {
    log(`${String(r.set).padEnd(5)}${`${r.n}x${r.n}`.padEnd(6)}${`${r.band[0]}-${r.band[1]}`.padEnd(8)}${String(r.opts.length).padEnd(9)}${r.opts.join(',').padEnd(30)}${(r.ok ? 'OK' : 'FAIL').padEnd(8)}${r.secs.toFixed(1)}s`);
  }
  log(`verified ${total} puzzles, ${bad} problem(s)`);
  return bad === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = verifyAll();
  console.log(ok ? 'verify: OK' : 'verify: FAILED');
  process.exit(ok ? 0 : 1);
}

