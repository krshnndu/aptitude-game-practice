#!/usr/bin/env node
// Re-verify every shipped Latin Square set, independently of the generator's deduction engine.
//
// Per puzzle:
//   - shape: n x n rows, n distinct known symbols, givens never repeat in a row or column,
//     targets are blank, blank count and target count inside the set bands;
//   - unique answer: an exhaustive backtracking search (written here, no deduction rules) tries every
//     symbol in every target and finds a full Latin square only for the stored answer;
//   - depth: a second, plain implementation of row and column elimination (naked and hidden
//     singles, in rounds) gives the stored depth per target; the deepest equals the set depth, and
//     naked-only sets fall to a row plus column check;
//   - explanation: every step from explain.js is replayed against the givens plus earlier steps,
//     checking its rule really forces its symbol, and the target steps give the stored answers;
//   - no duplicate ids or layouts (up to renaming symbols).
// Exits non-zero on any failure.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_CONFIGS, PUZZLES_PER_SET, patternKey } from '../js/games/latinsquare/gen.js';
import { SYMBOLS } from '../js/games/latinsquare/state.js';
import { explainPuzzle } from '../js/games/latinsquare/explain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function setPath(setNo) {
  return join(root, 'data', 'sets', 'latinsquare', `set${setNo}.json`);
}

export function loadSet(setNo) {
  return JSON.parse(readFileSync(setPath(setNo), 'utf8'));
}

// ---------------------------------------------------------------- independent helpers

// Grid as an array of arrays of symbol letters, null for blanks.
function toGrid(p) {
  return p.rows.map((row) => [...row].map((ch) => (ch === '.' ? null : ch)));
}

function letters(p) {
  return p.symbols.map((id) => {
    const s = SYMBOLS.find((x) => x.id === id);
    if (!s) throw new Error(`unknown symbol ${id}`);
    return s.letter;
  });
}

function fits(g, r, c, ch) {
  const n = g.length;
  for (let k = 0; k < n; k++) if (g[r][k] === ch || g[k][c] === ch) return false;
  return true;
}

// Does the grid have at least one completion to a Latin square?
export function completes(g, alphabet) {
  const n = g.length;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (g[r][c] !== null) continue;
      for (const ch of alphabet) {
        if (!fits(g, r, c, ch)) continue;
        g[r][c] = ch;
        const ok = completes(g, alphabet);
        g[r][c] = null;
        if (ok) return true;
      }
      return false;
    }
  }
  return true;
}

export function possibleAt(grid, alphabet, r, c) {
  const out = [];
  for (const ch of alphabet) {
    const g = grid.map((row) => row.slice());
    if (!fits(g, r, c, ch)) continue;
    g[r][c] = ch;
    if (completes(g, alphabet)) out.push(ch);
  }
  return out;
}

// Plain row and column elimination in rounds; returns depth[r][c] (0 given, k round, Infinity never).
export function eliminationDepths(grid, alphabet, { hidden = true } = {}) {
  const n = grid.length;
  const g = grid.map((row) => row.slice());
  const depth = g.map((row) => row.map((v) => (v === null ? Infinity : 0)));
  for (let k = 1; ; k++) {
    const snap = g.map((row) => row.slice());
    const placed = [];
    const left = (r, c) => alphabet.filter((ch) => fits(snap, r, c, ch));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (snap[r][c] !== null) continue;
        const cands = left(r, c);
        if (cands.length === 1) {
          placed.push([r, c, cands[0]]);
          continue;
        }
        if (!hidden) continue;
        for (const ch of cands) {
          const rowSpots = [];
          const colSpots = [];
          for (let x = 0; x < n; x++) {
            if (snap[r][x] === null && fits(snap, r, x, ch)) rowSpots.push(x);
            if (snap[x][c] === null && fits(snap, x, c, ch)) colSpots.push(x);
          }
          if (rowSpots.length === 1 || colSpots.length === 1) {
            placed.push([r, c, ch]);
            break;
          }
        }
      }
    }
    if (!placed.length) break;
    for (const [r, c, ch] of placed) {
      g[r][c] = ch;
      depth[r][c] = k;
    }
  }
  return depth;
}

// Replays explanation steps on the givens; returns a problem string or null.
function checkExplanation(p, grid) {
  const n = grid.length;
  const g = grid.map((row) => row.slice());
  const alpha = letters(p);
  const ex = explainPuzzle(p);
  for (const s of ex.steps) {
    const r = Math.floor(s.cell / n);
    const c = s.cell % n;
    const ch = s.symbol.letter;
    if (g[r][c] !== null) return `step ${s.index + 1}: cell ${s.label} is not open`;
    if (!fits(g, r, c, ch)) return `step ${s.index + 1}: ${ch} clashes in ${s.label}`;
    if (s.rule === 'naked') {
      const left = alpha.filter((x) => fits(g, r, c, x));
      if (left.length !== 1) return `step ${s.index + 1}: row and column leave ${left.length} symbols at ${s.label}`;
    } else {
      const spots = [];
      for (let x = 0; x < n; x++) {
        const [rr, cc] = s.rule === 'hidden-row' ? [r, x] : [x, c];
        if (g[rr][cc] === null && fits(g, rr, cc, ch)) spots.push(x);
      }
      if (spots.length !== 1) return `step ${s.index + 1}: ${ch} has ${spots.length} places in its line`;
    }
    g[r][c] = ch;
  }
  const targets = p.targets.map(([r, c]) => g[r][c]);
  if (targets.join('') !== p.answers.join('')) return `explanation ends with ${targets.join(',')}, stored ${p.answers.join(',')}`;
  return null;
}

// ---------------------------------------------------------------- set check

// Returns a list of problem strings (empty when the set is valid).
export function checkPuzzle(p, cfg) {
  const n = p.n;
  if (n !== cfg.n) throw new Error(`n ${n} != ${cfg.n}`);
  const alpha = letters(p);
  if (new Set(alpha).size !== n) throw new Error('symbols repeat or do not match n');
  if (p.rows.length !== n || p.rows.some((row) => row.length !== n)) throw new Error('rows are not n x n');
  const grid = toGrid(p);
  for (const row of grid) for (const ch of row) if (ch !== null && !alpha.includes(ch)) throw new Error(`letter ${ch} is not a puzzle symbol`);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const ch = grid[r][c];
      if (ch === null) continue;
      grid[r][c] = null;
      const ok = fits(grid, r, c, ch);
      grid[r][c] = ch;
      if (!ok) throw new Error(`given ${ch} at (${r + 1},${c + 1}) repeats in its row or column`);
    }
  }
  const blanks = grid.flat().filter((v) => v === null).length;
  if (blanks !== p.blanks) throw new Error(`stored blanks ${p.blanks}, counted ${blanks}`);
  if (blanks < cfg.blanks[0] || blanks > cfg.blanks[1]) throw new Error(`${blanks} blanks outside ${cfg.blanks.join('-')}`);
  if (p.targets.length < cfg.targets[0] || p.targets.length > cfg.targets[1]) throw new Error(`${p.targets.length} targets outside ${cfg.targets.join('-')}`);
  if (p.answers.length !== p.targets.length) throw new Error('answers do not match targets');
  if (!completes(grid.map((row) => row.slice()), alpha)) throw new Error('no completion exists');
  const depths = eliminationDepths(grid, alpha);
  const nakedDepths = eliminationDepths(grid, alpha, { hidden: false });
  p.targets.forEach(([r, c], k) => {
    if (grid[r][c] !== null) throw new Error(`target (${r + 1},${c + 1}) is not blank`);
    const vals = possibleAt(grid, alpha, r, c);
    if (vals.length !== 1) throw new Error(`target (${r + 1},${c + 1}) has ${vals.length} possible symbols (${vals.join(',')})`);
    if (vals[0] !== p.answers[k]) throw new Error(`target (${r + 1},${c + 1}) must be ${vals[0]}, stored ${p.answers[k]}`);
    if (depths[r][c] !== p.targetDepths[k]) throw new Error(`target (${r + 1},${c + 1}) depth ${depths[r][c]}, stored ${p.targetDepths[k]}`);
    if (cfg.nakedOnly && nakedDepths[r][c] !== 1) throw new Error(`target (${r + 1},${c + 1}) is not a direct row plus column check`);
  });
  const deepest = Math.max(...p.targetDepths);
  if (deepest !== p.depth) throw new Error(`stored depth ${p.depth}, deepest target ${deepest}`);
  if (p.depth !== cfg.depth) throw new Error(`depth ${p.depth} != set depth ${cfg.depth}`);
  if (p.targetDepths.some((d) => d < Math.max(1, cfg.depth - 1))) throw new Error(`a target is shallower than depth ${cfg.depth - 1}`);
  const bad = checkExplanation(p, grid);
  if (bad) throw new Error(`explanation: ${bad}`);
}

export function checkSet(data, cfg) {
  const problems = [];
  const tag = `set ${cfg.set}`;
  if (data.game !== 'latinsquare') problems.push(`${tag}: game is ${data.game}`);
  if (data.set !== cfg.set) problems.push(`${tag}: file says set ${data.set}`);
  if (data.n !== cfg.n) problems.push(`${tag}: n ${data.n} != ${cfg.n}`);
  if (data.puzzles.length !== PUZZLES_PER_SET) problems.push(`${tag}: ${data.puzzles.length} puzzles, expected ${PUZZLES_PER_SET}`);
  const ids = new Set();
  const keys = new Set();
  for (const p of data.puzzles) {
    try {
      if (ids.has(p.id)) throw new Error('duplicate id');
      ids.add(p.id);
      const key = patternKey(p);
      if (keys.has(key)) throw new Error('duplicate layout');
      keys.add(key);
      checkPuzzle(p, cfg);
    } catch (err) {
      problems.push(`${tag} ${p.id}: ${err.message}`);
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
    rows.push({
      set: cfg.set,
      n: cfg.n,
      depth: cfg.depth,
      blanks: data.puzzles.map((p) => p.blanks),
      targets: data.puzzles.reduce((s, p) => s + p.targets.length, 0),
      steps: data.puzzles.map((p) => p.steps),
      ok: problems.length === 0,
      secs: (Date.now() - t0) / 1000,
    });
  }
  log('');
  log('Latin Square verification');
  log('set  grid  depth  puzzles  targets  blanks per puzzle              steps per puzzle      status  time');
  for (const r of rows) {
    log(`${String(r.set).padEnd(5)}${`${r.n}x${r.n}`.padEnd(6)}${String(r.depth).padEnd(7)}${String(r.blanks.length).padEnd(9)}${String(r.targets).padEnd(9)}${r.blanks.join(',').padEnd(31)}${r.steps.join(',').padEnd(22)}${(r.ok ? 'OK' : 'FAIL').padEnd(8)}${r.secs.toFixed(1)}s`);
  }
  log(`verified ${total} puzzles, ${bad} problem(s)`);
  return bad === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = verifyAll();
  console.log(ok ? 'verify: OK' : 'verify: FAILED');
  process.exit(ok ? 0 : 1);
}
