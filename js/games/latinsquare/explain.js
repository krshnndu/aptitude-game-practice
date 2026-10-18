// "How it should be solved": turns the deduction engine's justifications into ordered steps with a
// plain-English reason each. Nothing is written by hand per puzzle:
//   - the steps are exactly the derived cells the targets depend on (solver.chainFor), in order,
//   - a naked single lists what the cell's row and column already hold and the one symbol left,
//   - a hidden single names the missing symbol and why every other open cell of the line refuses it,
//   - a wrong pick is explained by where that symbol already sits, or by the chain cell that takes it.

import { parsePuzzle, cellLabel, rowOf, colOf, findInRow, findInCol, BLANK } from './state.js';
import { deduce, chainFor } from './solver.js';
import { pct } from '../../core/score.js';

export const STRATEGY = [
  'Start at the ? cell: list what its row already holds, then add what its column holds. If one symbol is left, that is the answer.',
  'If two or more symbols are left, look for a blank in the same row or column that you can fill first. Its symbol then rules one more out.',
  'Also ask the reverse question: where in this row can the missing symbol still go? If only one open cell is left, it goes there.',
  'Check both lines every time. Most wrong answers are a symbol that was already sitting in the row or column.',
  'In a timed run, a wrong answer costs points and a skip costs nothing. Skip when you cannot finish the chain in reasonable time.',
];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const listAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function symName(P, v) {
  return P.symbols[v].name;
}

// Deduction for a puzzle (parsed once, reused by explain, hints, wrong-pick reasons and the coach).
export function analyse(puzzle) {
  const P = parsePuzzle(puzzle);
  const ded = deduce(P.n, P.grid);
  const chain = chainFor(ded, P.targets);
  const stepOf = new Map(chain.map((cell, k) => [cell, k + 1]));
  return { P, ded, chain, stepOf };
}

function cite(A, cell) {
  const k = A.stepOf.get(cell);
  return k ? ` (step ${k})` : '';
}

function stepText(A, cell) {
  const { P, ded } = A;
  const { n } = P;
  const w = ded.why[cell];
  const r = rowOf(n, cell) + 1;
  const c = colOf(n, cell) + 1;
  const val = symName(P, w.value);
  const where = cellLabel(n, cell);
  if (w.rule === 'naked') {
    // In reading order along each line, the way the eye checks it.
    const fromRow = w.sources.filter((s) => s.line === 'row').sort((a, b) => a.cell - b.cell);
    const fromCol = w.sources.filter((s) => s.line === 'col').sort((a, b) => a.cell - b.cell);
    const names = (list) => list.map((s) => `${symName(P, s.sym)}${cite(A, s.cell)}`).join(', ');
    const parts = [];
    if (fromRow.length) parts.push(`row ${r} already has ${names(fromRow)}`);
    if (fromCol.length) parts.push(`column ${c} ${fromRow.length ? 'has' : 'already has'} ${names(fromCol)}`);
    return `${cap(parts.join('; '))}; only ${val} remains, so ${where} is ${val}.`;
  }
  const isRow = w.rule === 'hidden-row';
  const line = isRow ? `row ${r}` : `column ${c}`;
  const reasons = w.others.map((o) => {
    const at = cellLabel(n, o.cell);
    if (o.kind === 'filled') return `${at} already holds ${symName(P, ded.value[o.cell])}${cite(A, o.cell)}`;
    const cross = isRow ? `column ${colOf(n, o.cell) + 1}` : `row ${rowOf(n, o.cell) + 1}`;
    return `${at} because ${cross} has ${val} at ${cellLabel(n, o.by)}${cite(A, o.by)}`;
  });
  const others = reasons.length
    ? ` Its other open cells cannot take ${val}: ${reasons.join('; ')}.`
    : '';
  return `${cap(val)} is still missing from ${line}.${others} The only place left is ${where}, so ${where} is ${val}.`;
}

// Cells to highlight while showing a step: the line(s) it reads and the cells it cites.
function stepFocus(A, cell) {
  const { n } = A.P;
  const w = A.ded.why[cell];
  if (w.rule === 'naked') return { rows: [rowOf(n, cell)], cols: [colOf(n, cell)], cited: w.sources.map((s) => s.cell) };
  const isRow = w.rule === 'hidden-row';
  return {
    rows: isRow ? [rowOf(n, cell)] : w.others.map((o) => rowOf(n, o.cell)),
    cols: isRow ? w.others.map((o) => colOf(n, o.cell)) : [colOf(n, cell)],
    cited: w.others.map((o) => o.by),
  };
}

// Returns { steps, answers, summary } where each step is
// { index, cell, label, value, symbol, rule, round, isTarget, targetIndex, text, focus }.
export function explainPuzzle(puzzle, A = analyse(puzzle)) {
  const { P, ded, chain } = A;
  if (P.targets.some((t) => ded.round[t] < 0)) throw new Error(`${puzzle.id}: a target is not forced by row and column elimination`);
  const steps = chain.map((cell, i) => {
    const t = P.targets.indexOf(cell);
    const w = ded.why[cell];
    return {
      index: i,
      cell,
      label: cellLabel(P.n, cell),
      value: w.value,
      symbol: P.symbols[w.value],
      rule: w.rule,
      round: ded.round[cell],
      isTarget: t >= 0,
      targetIndex: t,
      text: stepText(A, cell),
      focus: stepFocus(A, cell),
    };
  });
  const answers = P.targets.map((t) => ({ cell: t, label: cellLabel(P.n, t), value: ded.value[t], name: symName(P, ded.value[t]) }));
  const helpers = steps.filter((s) => !s.isTarget).length;
  const summary = `${answers.length === 1 ? 'Answer' : 'Answers'}: ${answers.map((a) => `${a.label} is ${a.name}`).join(', ')}. ` +
    (helpers ? `It takes ${steps.length} steps: ${helpers === 1 ? '1 helper cell has' : `${helpers} helper cells have`} to be filled first.` : 'Each answer can be read straight from its row and column.');
  return { steps, answers, summary, analysis: A };
}

// Why is `sym` wrong at target cell `cell`? Returns { kind: 'row'|'col'|'chain', cell?, text }.
// row / col: the symbol was already visible in that line among the givens (a check was missed).
// chain: it is only ruled out after filling a helper cell, or by the chain as a whole.
export function wrongPickReason(A, cell, sym) {
  const { P, ded } = A;
  const { n, grid } = P;
  const name = symName(P, sym);
  const r = rowOf(n, cell);
  const c = colOf(n, cell);
  const inRow = findInRow(n, grid, r, sym);
  if (inRow >= 0) return { kind: 'row', cell: inRow, text: `${cap(name)} is already in row ${r + 1}, at ${cellLabel(n, inRow)}.` };
  const inCol = findInCol(n, grid, c, sym);
  if (inCol >= 0) return { kind: 'col', cell: inCol, text: `${cap(name)} is already in column ${c + 1}, at ${cellLabel(n, inCol)}.` };
  let helper = -1;
  for (const x of findAll(n, r, c)) {
    if (grid[x] === BLANK && ded.value[x] === sym && ded.round[x] > 0 && (helper < 0 || ded.round[x] < ded.round[helper])) helper = x;
  }
  if (helper >= 0) {
    return {
      kind: 'chain',
      cell: helper,
      text: `${cap(name)} is not in row ${r + 1} or column ${c + 1} yet, but ${cellLabel(n, helper)} must be ${name} (fill it first from its own row and column), so ${name} cannot go here.`,
    };
  }
  return {
    kind: 'chain',
    text: `${cap(name)} is not ruled out by row ${r + 1} or column ${c + 1} directly; the steps below force ${symName(P, ded.value[cell])} here instead.`,
  };
}

function findAll(n, r, c) {
  const out = [];
  for (let k = 0; k < n; k++) {
    if (k !== c) out.push(r * n + k);
    if (k !== r) out.push(k * n + c);
  }
  return out;
}

// One line under a finished practice puzzle.
export function resultSummary({ outcome, picks, targets }) {
  if (outcome === 'skipped') return `Skipped: efficiency 0%. ${targets === 1 ? 'The answer is' : 'The answers are'} shown below.`;
  if (outcome === 'wrong') return 'Not all answers were right. The reasoning is below.';
  const eff = Math.min(1, targets / Math.max(1, picks));
  if (eff >= 1) return `Correct first time: efficiency 100%.`;
  const wrong = picks - targets;
  return `Solved after ${wrong} wrong ${wrong === 1 ? 'pick' : 'picks'}: efficiency ${pct(eff)} (${targets} needed / ${picks} made).`;
}
