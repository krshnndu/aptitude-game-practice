// "How it should be solved" for one Grid Memory trial. Every sentence is computed from the
// trial and the player's answers:
//   - the sequence as a path: landmark per cell (corner, edge, centre) and the move between cells,
//     with straight runs grouped into one chunk,
//   - where the player's recall first diverged and what kind of error it was,
//   - why each side question has its answer (the first mirror pair that differs, the sum and the
//     parity shortcut),
//   - memory tips picked from what happened (rehearse while judging, chunk the path, anchors).

import { cellRC, cellLabel, analyzeRecall, arithValue, mirrorMismatches, isCircles, circleZone } from './state.js';
import { pct } from '../../core/score.js';

const TIMES = String.fromCharCode(0xd7);
export const OP_TEXT = { '+': '+', '-': '-', '*': TIMES };

// n: the grid size, or the puzzle (grid or circles); circles are named by their third of the area.
const gridSize = (n) => (typeof n === 'object' && n !== null ? n.n : n);

export function landmark(n, cell) {
  if (isCircles(n)) return circleZone(n, cell);
  n = gridSize(n);
  const { r, c } = cellRC(n, cell);
  const top = r === 0;
  const bottom = r === n - 1;
  const left = c === 0;
  const right = c === n - 1;
  if (top && left) return 'top-left corner';
  if (top && right) return 'top-right corner';
  if (bottom && left) return 'bottom-left corner';
  if (bottom && right) return 'bottom-right corner';
  if (n % 2 === 1 && r === (n - 1) / 2 && c === (n - 1) / 2) return 'centre';
  if (top) return 'top edge';
  if (bottom) return 'bottom edge';
  if (left) return 'left edge';
  if (right) return 'right edge';
  return 'inner cell';
}

function dirWord(dr, dc) {
  const v = dr < 0 ? 'up' : dr > 0 ? 'down' : '';
  const h = dc < 0 ? 'left' : dc > 0 ? 'right' : '';
  return v && h ? `${v}-${h}` : v || h;
}

// Direction from circle a to circle b in words ("up and to the left"), and a rough distance.
function circleStep(p, a, b) {
  const [x0, y0] = p.circles[a];
  const [x1, y1] = p.circles[b];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
  // Within 25 degrees of an axis counts as straight across or straight up or down.
  const h = ang < 65 || ang > 115 ? (dx < 0 ? 'left' : 'right') : '';
  const v = ang > 25 && ang < 155 ? (dy < 0 ? 'up' : 'down') : '';
  const far = Math.hypot(dx, dy) > 0.5 ? 'far ' : '';
  return `${far}${v && h ? `${v}-${h}` : v || h}`;
}

// One step of the path from cell a to cell b.
export function stepText(n, a, b) {
  if (isCircles(n)) return circleStep(n, a, b);
  n = gridSize(n);
  const p = cellRC(n, a);
  const q = cellRC(n, b);
  const dr = q.r - p.r;
  const dc = q.c - p.c;
  const parts = [];
  if (dr) parts.push(`${Math.abs(dr)} ${dr < 0 ? 'up' : 'down'}`);
  if (dc) parts.push(`${Math.abs(dc)} ${dc < 0 ? 'left' : 'right'}`);
  const diagonal = Math.abs(dr) === Math.abs(dc);
  return diagonal ? `${Math.abs(dr)} diagonally ${dirWord(dr, dc)}` : parts.join(' and ');
}

// Straight runs: consecutive steps with the same direction and length form one chunk.
export function pathChunks(n, seq) {
  // Circles sit off any grid: there are no repeated steps to group.
  if (isCircles(n)) return seq.map((_, i) => ({ from: i, to: i, kind: 'single' }));
  n = gridSize(n);
  if (seq.length < 2) return [{ from: 0, to: seq.length - 1, kind: 'single' }];
  const delta = (i) => {
    const p = cellRC(n, seq[i]);
    const q = cellRC(n, seq[i + 1]);
    return `${q.r - p.r},${q.c - p.c}`;
  };
  const chunks = [];
  let start = 0;
  for (let i = 1; i < seq.length - 1; i++) {
    if (delta(i) !== delta(start)) {
      chunks.push({ from: start, to: i, kind: i - start >= 2 ? 'line' : 'jump' });
      start = i;
    }
  }
  chunks.push({ from: start, to: seq.length - 1, kind: seq.length - 1 - start >= 2 ? 'line' : 'jump' });
  return chunks;
}

// Spoken version of the path, for example
//   "top-left corner (1,1), then 2 right to the top-right corner (1,3), then ..."
export function describePath(n, seq) {
  if (isCircles(n)) return describeCirclePath(n, seq);
  n = gridSize(n);
  const steps = seq.map((cell, i) => {
    const where = `${landmark(n, cell)} ${cellLabel(n, cell)}`;
    if (i === 0) return { i, cell, text: `Start: ${where}.` };
    return { i, cell, text: `${stepText(n, seq[i - 1], cell)} to the ${where}.` };
  });
  const lines = pathChunks(n, seq).filter((ch) => ch.kind === 'line');
  const chunkText = lines.map((ch) =>
    `cells ${ch.from + 1} to ${ch.to + 1} form one straight line (${stepText(n, seq[ch.from], seq[ch.from + 1])} each step)`);
  const corners = seq.filter((cell) => landmark(n, cell).endsWith('corner')).length;
  const summary = [];
  if (chunkText.length) summary.push(`Chunk it: ${chunkText.join('; ')}.`);
  if (corners >= 2) summary.push(`${corners} of the ${seq.length} cells are corners: name them as you see them ("top-left, bottom-right").`);
  const rows = new Set(seq.map((cell) => cellRC(n, cell).r));
  const cols = new Set(seq.map((cell) => cellRC(n, cell).c));
  if (seq.length >= 3 && (rows.size <= 2 || cols.size <= 2)) {
    summary.push(`All cells sit in ${rows.size <= 2 ? `${rows.size} row${rows.size === 1 ? '' : 's'}` : `${cols.size} column${cols.size === 1 ? '' : 's'}`}: picture it as one band and remember only the order across it.`);
  }
  return { steps, summary };
}

// Circles: "Start: circle 3 (top left)", then "down-right to circle 5 (centre)".
function describeCirclePath(p, seq) {
  const where = (i) => `${cellLabel(p, i)} (${circleZone(p, i)})`;
  const steps = seq.map((cell, i) => ({
    i,
    cell,
    text: i === 0 ? `Start: ${where(cell)}.` : `${circleStep(p, seq[i - 1], cell)} to ${where(cell)}.`,
  }));
  const summary = [];
  const zones = seq.map((cell) => circleZone(p, cell).split(' ')[0]);
  const tops = zones.filter((z) => z === 'top').length;
  const bottoms = zones.filter((z) => z === 'bottom').length;
  if (seq.length >= 3 && (tops === seq.length || bottoms === seq.length)) summary.push(`All ${seq.length} circles sit in the ${tops ? 'top' : 'bottom'} third: remember only the order across it.`);
  if (seq.length >= 3) summary.push('Trace it as one shape: say the moves ("down-right, far left, up") rather than holding each circle on its own.');
  return { steps, summary };
}

const STATUS_TEXT = {
  ok: 'right',
  hint: 'given by a hint',
  order: 'right cell, wrong position',
  wrong: 'not in the sequence',
  missing: 'not entered',
};

export function statusText(s) {
  return STATUS_TEXT[s] ?? s;
}

export function divergenceText(n, analysis) {
  const k = analysis.firstError;
  if (k === null) return 'You recalled every position in order.';
  const p = analysis.positions[k];
  const want = `${cellLabel(n, p.expected)} (${landmark(n, p.expected)})`;
  if (p.status === 'missing') return `You stopped after ${k} of ${analysis.total}: position ${k + 1} was ${want}.`;
  if (p.status === 'hint') return `Position ${k + 1} needed a hint: it was ${want}.`;
  const got = cellLabel(n, p.got);
  const unit = isCircles(n) ? 'circle' : 'cell';
  if (p.status === 'order') {
    const swapped = analysis.positions[p.belongsAt]?.got === p.expected;
    return `You diverged at position ${k + 1}: you chose ${got}, which is ${unit} ${p.belongsAt + 1} of the sequence; position ${k + 1} was ${want}.` +
      (swapped ? ` Positions ${k + 1} and ${p.belongsAt + 1} were swapped.` : '');
  }
  return `You diverged at position ${k + 1}: you chose ${got}, which was never lit; the ${unit} was ${want}.`;
}

// ---------------------------------------------------------------- side questions

export function questionText(d) {
  if (d.kind === 'sym') return 'Is this shape symmetric left to right?';
  return `${d.a} ${OP_TEXT[d.op]} ${d.b}: is the result even or odd?`;
}

export function answerWord(a) {
  return { yes: 'Yes', no: 'No', even: 'Even', odd: 'Odd', miss: 'No answer in time' }[a] ?? String(a);
}

const ordinal = (k) => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][k - 1] ?? `${k}th`;

export function sideReason(d) {
  if (d.kind === 'sym') {
    const w = d.rows[0].length;
    for (let r = 0; r < d.rows.length; r++) {
      for (let c = 0; c < Math.floor(w / 2); c++) {
        const a = d.rows[r][c];
        const b = d.rows[r][w - 1 - c];
        if (a !== b) {
          const k = mirrorMismatches(d.rows);
          const filledLeft = a === '#';
          return `Not symmetric: in row ${r + 1} the ${ordinal(c + 1)} cell from the ${filledLeft ? 'left' : 'right'} is filled but its mirror cell on the ${filledLeft ? 'right' : 'left'} is empty` +
            (k > 1 ? ` (${k} mirror pairs differ in all).` : ' (the only difference).');
        }
      }
    }
    return `Symmetric: each of the ${d.rows.length} rows reads the same from the left and from the right.`;
  }
  const v = arithValue(d);
  const par = v % 2 === 0 ? 'even' : 'odd';
  const pa = d.a % 2 === 0 ? 'even' : 'odd';
  const pb = d.b % 2 === 0 ? 'even' : 'odd';
  let rule;
  if (d.op === '*') rule = pa === 'even' || pb === 'even' ? 'a product is even when either number is even' : 'odd times odd is odd';
  else rule = pa === pb ? `${pa} ${d.op === '+' ? 'plus' : 'minus'} ${pb} is even` : `${pa} ${d.op === '+' ? 'plus' : 'minus'} ${pb} is odd`;
  return `${d.a} ${OP_TEXT[d.op]} ${d.b} = ${v}, which is ${par}. Shortcut: ${rule}, so only the last digits matter.`;
}

export function sideRows(puzzle, answers = []) {
  return puzzle.distractors.map((d, i) => {
    const a = answers[i];
    return {
      i,
      question: questionText(d),
      correct: d.answer,
      given: a ? a.answer : null,
      ok: !!a?.ok,
      rt: a?.rt ?? null,
      reason: sideReason(d),
    };
  });
}

// ---------------------------------------------------------------- tips and summary

export const STRATEGY = [
  'Chunk the cells into a path or a shape: "corner, across 2, down 1" is one idea, not three cells.',
  'Rehearse while judging: say the path so far silently while your eyes check the side question.',
  'Answer the side question at a steady pace: a fast answer frees time to rehearse, a guess costs points.',
  'Anchor each cell to a landmark: corners, edges and the centre are easier to hold than coordinates.',
  'At recall, tap the first cells straight away, then rebuild the rest of the path from the last chunk you said.',
];

export function tipsFor(puzzle, result) {
  const tips = [];
  const rec = result.recall;
  const { summary } = describePath(puzzle, puzzle.sequence);
  tips.push(...summary);
  if (rec.order > 0) tips.push('You had the right cells but lost their order: link each cell to the next as a movement ("then 2 down"), not as a set of places.');
  if (rec.wrong > 0) tips.push('Some taps were on cells that never lit: name the landmark of each cell the moment it lights ("left edge"), before the side question appears.');
  if (result.side.missed > 0) tips.push('A side question timed out: answer first, then use any time left to rehearse.');
  if (result.side.accuracy < 0.67 && rec.accuracy >= 0.67) tips.push('Memory held but side questions slipped: they are 30% of the score. Give each one a real look.');
  if (!tips.length) tips.push(STRATEGY[1]);
  return tips;
}

export function resultSummary(result) {
  if (result.outcome === 'skipped') return 'Skipped: this trial scores 0. Entering your best guess would still have earned partial credit.';
  if (result.outcome === 'timeout') return 'Time ran out during this trial: it scores 0.';
  const r = result.recall;
  const s = result.side;
  const tail = result.efficiency >= 1 ? ' Perfect.' : '';
  return `Recall ${r.correct} of ${r.total} positions (${pct(r.accuracy)}), side questions ${s.correct} of ${s.total} (${pct(s.accuracy)}): trial score ${pct(result.efficiency)}.${tail}`;
}

export function explainTrial(puzzle, result, answers = []) {
  const analysis = result.recall ?? analyzeRecall(puzzle.sequence, []);
  return {
    path: describePath(puzzle, puzzle.sequence),
    positions: analysis.positions.map((p) => ({
      ...p,
      expectedLabel: cellLabel(puzzle, p.expected),
      gotLabel: p.got === null ? 'none' : cellLabel(puzzle, p.got),
      text: statusText(p.status),
    })),
    divergence: divergenceText(puzzle, analysis),
    side: sideRows(puzzle, answers),
    tips: tipsFor(puzzle, result),
    summary: resultSummary(result),
  };
}
