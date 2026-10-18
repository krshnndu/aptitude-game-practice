// Latin Square deduction engine.
//
// deduce() fills the grid by row and column elimination in parallel rounds. Round 0 is the givens.
// Round k places every blank that is forced by the cells known after round k - 1, using two rules:
//   naked single:  the cell's row and column already hold every symbol but one;
//   hidden single: a symbol missing from a row (or column) has only one open cell left there,
//                  because every other open cell of that line sees the symbol in its own column (row).
// The round in which a cell is placed is its deduction depth: depth 1 can be read straight from the
// givens, depth 2 needs one other blank filled first, depth 3 a chain of two, and so on. Rounds take
// every forced cell at once, so the depth is the minimum over all orders of applying the two rules.
//
// Each placed cell keeps a justification (rule, cited source cells, and deps: the derived cells the
// reason relies on), chosen to cite givens wherever possible. chainFor() walks the deps to list
// exactly the steps a target needs, in solving order.

import { BLANK, rowOf, colOf, rowCells, colCells } from './state.js';

export const RULES = ['naked', 'hidden-row', 'hidden-col'];

// Best source cell for "symbol v is in this line": a given beats a derived cell, then lower rounds.
function bestSource(cells, snap, round, v) {
  let best = -1;
  for (const x of cells) {
    if (snap[x] !== v) continue;
    if (best < 0 || round[x] < round[best]) best = x;
  }
  return best;
}

function nakedOption(n, snap, round, cell) {
  const r = rowOf(n, cell);
  const c = colOf(n, cell);
  const row = rowCells(n, r).filter((x) => x !== cell);
  const col = colCells(n, c).filter((x) => x !== cell);
  const seen = new Set();
  for (const x of [...row, ...col]) if (snap[x] !== BLANK) seen.add(snap[x]);
  if (seen.size !== n - 1) return null;
  let value = -1;
  for (let v = 0; v < n; v++) if (!seen.has(v)) value = v;
  // One source per ruled-out symbol: the row first unless the column has it as a given and the row
  // only has it as a derived cell.
  const sources = [];
  for (let v = 0; v < n; v++) {
    if (v === value) continue;
    const a = bestSource(row, snap, round, v);
    const b = bestSource(col, snap, round, v);
    let pick;
    if (a < 0) pick = { sym: v, cell: b, line: 'col' };
    else if (b < 0) pick = { sym: v, cell: a, line: 'row' };
    else pick = round[b] < round[a] ? { sym: v, cell: b, line: 'col' } : { sym: v, cell: a, line: 'row' };
    sources.push(pick);
  }
  const deps = [...new Set(sources.map((s) => s.cell).filter((x) => round[x] > 0))];
  return { rule: 'naked', value, sources, deps };
}

// Hidden single for `cell` holding symbol v in its row (line 'row') or column (line 'col').
// Every other cell of the line that is blank in the givens must be explained: either it already
// holds another symbol (a derived cell, so a dependency), or symbol v sits in its crossing line.
function hiddenOption(n, snap, round, cell, v, line, givenBlank) {
  const r = rowOf(n, cell);
  const c = colOf(n, cell);
  const cells = line === 'row' ? rowCells(n, r) : colCells(n, c);
  if (cells.some((x) => snap[x] === v)) return null;
  const others = [];
  for (const x of cells) {
    if (x === cell || !givenBlank[x]) continue;
    const cross = line === 'row' ? colCells(n, colOf(n, x)) : rowCells(n, rowOf(n, x));
    const src = bestSource(cross, snap, round, v);
    if (src >= 0 && (round[src] === 0 || snap[x] === BLANK || round[src] <= round[x])) {
      others.push({ cell: x, kind: 'blocked', by: src });
    } else if (snap[x] !== BLANK) {
      others.push({ cell: x, kind: 'filled', by: x });
    } else return null;
  }
  const deps = [...new Set(others.map((o) => o.by).filter((x) => round[x] > 0))];
  return { rule: line === 'row' ? 'hidden-row' : 'hidden-col', value: v, others, deps };
}

function candidates(n, snap, cell) {
  const r = rowOf(n, cell);
  const c = colOf(n, cell);
  const seen = new Set();
  for (const x of [...rowCells(n, r), ...colCells(n, c)]) if (snap[x] !== BLANK) seen.add(snap[x]);
  const out = [];
  for (let v = 0; v < n; v++) if (!seen.has(v)) out.push(v);
  return out;
}

// Justification for placing `cell` given the snapshot, or null when it is not forced yet.
// Picks the option with the fewest derived dependencies; ties go to naked, then row, then column.
export function justify(n, snap, round, cell, { rules = RULES, givenBlank } = {}) {
  const opts = [];
  if (rules.includes('naked')) {
    const o = nakedOption(n, snap, round, cell);
    if (o) opts.push(o);
  }
  const cands = candidates(n, snap, cell);
  if (!cands.length) throw new Error(`contradiction: no symbol fits cell ${cell}`);
  for (const line of ['row', 'col']) {
    if (!rules.includes(`hidden-${line}`)) continue;
    for (const v of cands) {
      const o = hiddenOption(n, snap, round, cell, v, line, givenBlank);
      if (o) opts.push(o);
    }
  }
  if (!opts.length) return null;
  const values = new Set(opts.map((o) => o.value));
  if (values.size > 1) throw new Error(`contradiction: cell ${cell} forced to two symbols`);
  opts.sort((a, b) => a.deps.length - b.deps.length || RULES.indexOf(a.rule) - RULES.indexOf(b.rule));
  return opts[0];
}

// grid: Int8Array of givens (BLANK or symbol). Returns { n, value, round, why, rounds } where round[cell]
// is 0 for a given, k >= 1 for the round that placed it, -1 when never forced.
export function deduce(n, grid, { rules = RULES, maxRounds = Infinity } = {}) {
  const N = n * n;
  const value = Int8Array.from(grid);
  const round = new Int8Array(N).fill(-1);
  const why = new Array(N).fill(null);
  const givenBlank = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (value[i] !== BLANK) round[i] = 0;
    else givenBlank[i] = 1;
  }
  let rounds = 0;
  for (let k = 1; k <= maxRounds; k++) {
    const snap = value.slice();
    const found = [];
    for (let i = 0; i < N; i++) {
      if (snap[i] !== BLANK) continue;
      const j = justify(n, snap, round, i, { rules, givenBlank });
      if (j) found.push([i, j]);
    }
    if (!found.length) break;
    for (const [i, j] of found) {
      value[i] = j.value;
      round[i] = k;
      why[i] = j;
    }
    rounds = k;
  }
  return { n, value, round, why, rounds };
}

// Deduction depth of one cell (Infinity when row and column elimination never force it).
export function cellDepth(n, grid, cell, opts) {
  const d = deduce(n, grid, opts);
  return d.round[cell] < 0 ? Infinity : d.round[cell];
}

// Every derived cell the targets need, ordered for solving (round, then reading order).
export function chainFor(ded, targets) {
  const need = new Set();
  const stack = [...targets];
  while (stack.length) {
    const x = stack.pop();
    if (need.has(x) || ded.round[x] <= 0) continue;
    need.add(x);
    for (const d of ded.why[x].deps) stack.push(d);
  }
  return [...need].sort((a, b) => ded.round[a] - ded.round[b] || a - b);
}

// ---------------------------------------------------------------- exhaustive completion search

// Depth-first search over completions, most constrained cell first. Calls visit(grid) for each
// completion until it returns true or `limit` completions were seen. Returns the count seen.
export function forEachCompletion(n, grid, visit = () => false, limit = Infinity) {
  const g = Int8Array.from(grid);
  const N = n * n;
  const rowMask = new Int32Array(n);
  const colMask = new Int32Array(n);
  for (let i = 0; i < N; i++) {
    const v = g[i];
    if (v === BLANK) continue;
    const bit = 1 << v;
    const r = Math.floor(i / n);
    const c = i % n;
    if (rowMask[r] & bit || colMask[c] & bit) return 0;
    rowMask[r] |= bit;
    colMask[c] |= bit;
  }
  const full = (1 << n) - 1;
  let count = 0;
  let stop = false;
  const popcount = (m) => {
    let k = 0;
    for (; m; m &= m - 1) k++;
    return k;
  };
  function rec() {
    let best = -1;
    let bestMask = 0;
    let bestCount = 99;
    for (let i = 0; i < N; i++) {
      if (g[i] !== BLANK) continue;
      const mask = full & ~(rowMask[Math.floor(i / n)] | colMask[i % n]);
      const k = popcount(mask);
      if (k < bestCount) {
        best = i;
        bestMask = mask;
        bestCount = k;
        if (k <= 1) break;
      }
    }
    if (best < 0) {
      count++;
      if (visit(g) || count >= limit) stop = true;
      return;
    }
    if (bestCount === 0) return;
    const r = Math.floor(best / n);
    const c = best % n;
    for (let v = 0; v < n && !stop; v++) {
      const bit = 1 << v;
      if (!(bestMask & bit)) continue;
      g[best] = v;
      rowMask[r] |= bit;
      colMask[c] |= bit;
      rec();
      rowMask[r] &= ~bit;
      colMask[c] &= ~bit;
      g[best] = BLANK;
    }
  }
  rec();
  return count;
}

export function countCompletions(n, grid, limit = Infinity) {
  return forEachCompletion(n, grid, () => false, limit);
}

// Symbols a cell takes across all completions (a sorted array). Unique answer <=> length 1.
export function possibleValues(n, grid, cell) {
  const out = [];
  for (let v = 0; v < n; v++) {
    const g = Int8Array.from(grid);
    g[cell] = v;
    if (forEachCompletion(n, g, () => true) > 0) out.push(v);
  }
  return out;
}
