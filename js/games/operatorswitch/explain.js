// "How it should be solved" for Operator Switch. Every line is computed from the puzzle:
//   - index tracking: number the start positions 1..n and carry the number row through each box,
//   - the mapping of the final number row back to shapes,
//   - a quick backward trace of slot 1 (the fastest way to rule options out),
//   - elimination slot by slot, and why each wrong option is wrong (named misreading or slip),
//   - hints for practice mode that never give the final answer away.

import {
  ITEMS, MISTAKES, itemName, spaced, identityOp, undoOp, opBetween, runChain, hiddenRows,
  correctValue, diagnose, examPoints, wrongPenalty,
} from './state.js';
import { pct } from '../../core/score.js';

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
const ordinal = (k) => ORD[k - 1] ?? `${k}th`;
const listAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const cap = (t) => `${t[0].toUpperCase()}${t.slice(1)}`;
const optWord = (idxs) => `${idxs.length === 1 ? 'option' : 'options'} ${listAnd(idxs.map((i) => String(i + 1)))}`;
export const chainName = (c) => `chain ${'AB'[c] ?? c + 1}`;

export const STRATEGY = [
  'Track digits, not shapes: number the start positions 1 to n and carry that number row through the boxes. Turn numbers back into shapes only at the end.',
  'Box rule: slot i takes the entry at position digit i of the row going in. On the numbered start row, the first box simply copies its digits.',
  'Apply each box to the row in front of it (the intermediate result), never to the start row, and work left to right.',
  'Eliminate by slot 1 first: trace slot 1 backwards through the boxes, rule out options that disagree, then check slot 2 only if two or more remain.',
  'Timed run: a wrong answer costs points, a skip costs nothing. Guess only when you have ruled out all but two options.',
];

export const KIND_STRATEGY = {
  forward: [],
  hidden: [
    'Hidden box: run the start forward up to the gap, undo the boxes after the gap from the output backwards, then read each digit as "where did this slot\'s entry sit going in".',
    'Undoing a box: the entry in slot i goes back to position digit i.',
  ],
  twin: [
    'Two chains with the same result: work out the shorter chain only. Use the other one as a check if time allows.',
  ],
};

export function strategyFor(kind) {
  return [...STRATEGY, ...(KIND_STRATEGY[kind] ?? [])];
}

// Number row text: start item numbering, e.g. "circle C = 1, square S = 2, ...".
export function numberingText(start) {
  return [...start].map((c, i) => `${itemName(c)} = ${i + 1}`).join(', ');
}

// Map a number row (digits) back to items of the start.
export function numbersToItems(start, row) {
  return [...row].map((d) => start[Number(d) - 1]).join('');
}

// Start positions of each item of an arrangement, as a number row.
export function itemsToNumbers(start, arr) {
  return opBetween(start, arr);
}

function boxStepText(label, op, before, after) {
  const parts = [...op].map((d, i) => `slot ${i + 1} takes the ${ordinal(Number(d))} entry (${before[Number(d) - 1]})`);
  return `${label} (${spaced(op)}) on ${spaced(before)}: ${parts.join(', ')}. Row now: ${spaced(after)}.`;
}

// Index-tracking steps for one fully known chain. Returns { steps, rows } (rows are number rows).
export function chainSteps(start, ops, { prefix = '' } = {}) {
  const n = start.length;
  const rows = runChain(identityOp(n), ops);
  const steps = ops.map((op, k) => {
    const label = `${prefix}Box ${k + 1}`;
    const text = k === 0
      ? `${label} (${spaced(op)}) on the numbered start ${spaced(rows[0])}: the first box just copies its digits. Row now: ${spaced(rows[1])}.`
      : boxStepText(label, op, rows[k], rows[k + 1]);
    return { title: label, text, numbers: rows[k + 1], items: numbersToItems(start, rows[k + 1]) };
  });
  return { steps, rows };
}

// Slot 1 traced backwards through the boxes: [{ box, from }] and a sentence.
export function slotTrace(start, ops, slot = 1, { prefix = '' } = {}) {
  let pos = slot;
  const hops = [];
  for (let k = ops.length - 1; k >= 0; k--) {
    const from = Number(ops[k][pos - 1]);
    hops.push({ box: k + 1, pos, from });
    pos = from;
  }
  const item = start[pos - 1];
  const words = hops.map((h, i) => (i === 0
    ? `${prefix}box ${h.box} says slot ${h.pos} comes from position ${h.from}`
    : `box ${h.box} says position ${h.pos} comes from position ${h.from}`));
  const text = `Slot ${slot} quick trace: ${words.join('; ')}; start position ${pos} holds ${itemName(item)}.`;
  return { hops, startPos: pos, item, text };
}

// Elimination slot by slot until one option is left.
export function eliminate(puzzle) {
  const right = correctValue(puzzle);
  const isOps = puzzle.kind === 'hidden';
  let left = puzzle.options.map((_, i) => i);
  const steps = [];
  for (let s = 0; s < right.length && left.length > 1; s++) {
    const out = left.filter((i) => puzzle.options[i][s] !== right[s]);
    left = left.filter((i) => puzzle.options[i][s] === right[s]);
    const what = isOps ? `digit ${s + 1} must be ${right[s]}` : `slot ${s + 1} must hold ${itemName(right[s])}`;
    const text = out.length
      ? `${cap(what)}: rules out ${optWord(out)}.${left.length === 1 ? ` Only option ${left[0] + 1} is left.` : ''}`
      : `${cap(what)}: every remaining option agrees, so check the next ${isOps ? 'digit' : 'slot'}.`;
    steps.push({ slot: s + 1, out, left: left.slice(), text });
  }
  return { steps, slotsNeeded: steps.length, answer: left[0] };
}

// Plain-English reason why an option is wrong.
export function wrongReason(puzzle, i) {
  const value = puzzle.options[i];
  const d = diagnose(puzzle, value);
  const kind = d.primary;
  const m = d.matches?.find((x) => x.kind === kind);
  const chain = m && m.chain !== undefined ? ` (${chainName(m.chain)})` : '';
  const isOps = puzzle.kind === 'hidden';
  const unit = isOps ? 'digits' : 'slots';
  let text;
  if (kind === 'dropped') text = `what you get if you leave out box ${m.box}${chain}.`;
  else if (kind === 'slip') text = `${unit} ${d.slots[0] + 1} and ${d.slots[1] + 1} are swapped: right method, one slip while tracking.`;
  else if (kind === 'other') text = `differs from the answer in ${unit} ${listAnd(d.slots.map((s) => String(s + 1)))}.`;
  else text = `what you get if you ${MISTAKES[kind].you}${chain}.`;
  return { option: i, kind, kinds: d.kinds, text: `Option ${i + 1}: ${text}` };
}

function hiddenExplain(puzzle) {
  const { start } = puzzle;
  const n = start.length;
  const ops = puzzle.chains[0];
  const at = puzzle.hidden.at;
  const len = ops.length;
  const steps = [];
  const targetNums = itemsToNumbers(start, puzzle.target);
  steps.push({
    title: 'Number the items',
    text: `Number the start positions: ${numberingText(start)}. The output ${spaced(puzzle.target)} becomes ${spaced(targetNums)} (each item replaced by its start position).`,
    numbers: targetNums,
    items: puzzle.target,
  });
  // Forward to the gap.
  const fwd = runChain(identityOp(n), ops.slice(0, at));
  if (at === 0) {
    steps.push({ title: 'Row going in', text: `The hidden box is box 1, so the row going into it is the numbered start ${spaced(fwd[0])}.`, numbers: fwd[0], items: start });
  } else {
    ops.slice(0, at).forEach((op, k) => {
      const text = k === 0
        ? `Box 1 (${spaced(op)}) on the numbered start: the first box copies its digits. Row now: ${spaced(fwd[1])}.`
        : boxStepText(`Box ${k + 1}`, op, fwd[k], fwd[k + 1]);
      steps.push({ title: `Box ${k + 1}`, text, numbers: fwd[k + 1], items: numbersToItems(start, fwd[k + 1]) });
    });
  }
  const before = fwd[fwd.length - 1];
  // Backward from the output.
  let after = targetNums;
  if (at === len - 1) {
    steps.push({ title: 'Row coming out', text: `The hidden box is the last box, so the row coming out of it is the output ${spaced(after)}.`, numbers: after, items: puzzle.target });
  } else {
    for (let j = len - 1; j > at; j--) {
      const op = ops[j];
      const prev = undoOp(after, op);
      const moves = [...op].map((d, i) => `${after[i]} goes back to position ${d}`);
      steps.push({
        title: `Undo box ${j + 1}`,
        text: `Undo box ${j + 1} (${spaced(op)}) on ${spaced(after)}: the entry in slot i goes back to position digit i, so ${moves.join(', ')}. Row before box ${j + 1}: ${spaced(prev)}.`,
        numbers: prev,
        items: numbersToItems(start, prev),
      });
      after = prev;
    }
  }
  const right = opBetween(before, after);
  const reads = [...after].map((x, i) => `slot ${i + 1} holds ${x}, which sat at position ${right[i]} going in`);
  steps.push({
    title: 'Read the hidden box',
    text: `Going in: ${spaced(before)}. Coming out: ${spaced(after)}. ${cap(reads.join('; '))}. So the hidden box is ${spaced(right)}.`,
    numbers: right,
    items: null,
  });
  return { steps, value: right };
}

function forwardExplain(puzzle) {
  const { start } = puzzle;
  const twin = puzzle.kind === 'twin';
  // Twin: work the shorter chain (ties: the first), check with the other.
  const lens = puzzle.chains.map((c) => c.length);
  const main = twin ? (lens[1] < lens[0] ? 1 : 0) : 0;
  const other = 1 - main;
  const steps = [];
  if (twin) {
    steps.push({
      title: 'Pick the shorter chain',
      text: `Both chains start from the same row and end in the same arrangement, so you only need one. ${cap(chainName(main))} has ${lens[main]} boxes against ${lens[other]}: work that one.`,
      numbers: null,
      items: null,
    });
  }
  steps.push({
    title: 'Number the items',
    text: `Number the start positions: ${numberingText(start)}. Start row: ${spaced(identityOp(start.length))}.`,
    numbers: identityOp(start.length),
    items: start,
  });
  const prefix = twin ? `${cap(chainName(main))}, ` : '';
  const { steps: boxSteps, rows } = chainSteps(start, puzzle.chains[main], { prefix });
  steps.push(...boxSteps);
  const last = rows[rows.length - 1];
  const value = numbersToItems(start, last);
  steps.push({
    title: 'Back to shapes',
    text: `Turn the numbers back into shapes: ${[...last].map((d) => `${d} is ${itemName(start[Number(d) - 1])}`).join(', ')}. Result: ${spaced(value)}.`,
    numbers: last,
    items: value,
  });
  if (twin) {
    const check = runChain(identityOp(start.length), puzzle.chains[other]);
    steps.push({
      title: 'Check',
      text: `Check with ${chainName(other)}: ${check.map(spaced).join(' -> ')}, the same row, so both chains agree on ${spaced(value)}.`,
      numbers: check[check.length - 1],
      items: numbersToItems(start, check[check.length - 1]),
    });
  }
  const trace = slotTrace(start, puzzle.chains[main], 1, { prefix: twin ? `in ${chainName(main)}, ` : '' });
  return { steps, value, trace, mainChain: main };
}

// Full explanation: { kind, steps, value, answer, trace, elimination, others, strategy }.
export function explainPuzzle(puzzle) {
  const body = puzzle.kind === 'hidden' ? hiddenExplain(puzzle) : forwardExplain(puzzle);
  const elimination = eliminate(puzzle);
  const others = puzzle.options.map((_, i) => i).filter((i) => i !== puzzle.answer).map((i) => wrongReason(puzzle, i));
  return {
    kind: puzzle.kind,
    steps: body.steps,
    value: body.value,
    answer: puzzle.answer,
    trace: body.trace ?? null,
    elimination,
    others,
    strategy: strategyFor(puzzle.kind),
  };
}

// Practice hints, in order. None of them gives the final answer away: the last one always leaves
// at least the final step (or the read-off of the hidden digits) to the player.
export function hintSteps(puzzle) {
  const { start } = puzzle;
  const n = start.length;
  if (puzzle.kind === 'hidden') {
    const { before, after, ops, at } = hiddenRows(puzzle);
    const inNums = itemsToNumbers(start, before);
    const outNums = itemsToNumbers(start, after);
    if (at > 0) {
      return [
        `Number the start positions (${numberingText(start)}). Row going into the gap: ${spaced(inNums)}.`,
        `Row coming out of the gap: ${spaced(outNums)}. Now for each slot ask: where did this entry sit going in?`,
      ];
    }
    // Gap in box 1: the row coming out of it on 1..n is the answer itself, so only start the undo.
    const last = ops.length - 1;
    const targetNums = itemsToNumbers(start, puzzle.target);
    const undoneOnce = undoOp(targetNums, ops[last]);
    const second = last - 1 > at
      ? `Undo box ${last + 1} first: the output ${spaced(targetNums)} becomes ${spaced(undoneOnce)}. Then undo box ${last}.`
      : `Undo box ${last + 1}: the entry in slot 1 of the output (${targetNums[0]}) goes back to position ${ops[last][0]}. Place the other entries the same way.`;
    return [
      `Number the start positions (${numberingText(start)}). The hidden box is box 1, so it works on ${spaced(identityOp(n))}: whatever comes out of it, written as numbers, is the box itself.`,
      second,
    ];
  }
  const lens = puzzle.chains.map((c) => c.length);
  const main = puzzle.kind === 'twin' && lens[1] < lens[0] ? 1 : 0;
  const ops = puzzle.chains[main];
  const lead = puzzle.kind === 'twin' ? `Work ${chainName(main)}, the shorter one. ` : '';
  const trace = slotTrace(start, ops, 1);
  const out = [`${lead}${trace.text} Rule out every option without ${itemName(trace.item)} in slot 1.`];
  const rows = runChain(identityOp(n), ops);
  for (let k = 1; k < ops.length; k++) {
    out.push(`Numbering the start ${spaced(identityOp(n))}, the row after box ${k} is ${spaced(rows[k])}. Apply box ${k + 1} to this row, not to the start.`);
  }
  return out;
}

// One line under the result badge.
export function resultSummary({ status, submissions = 0, options, mode = 'practice' }) {
  if (mode === 'exam') {
    if (status === 'correct') return 'Correct: +1 point.';
    if (status === 'wrong') return `Wrong: ${(-examPoints('wrong', options)).toFixed(2)} points (a wrong answer costs 1/${options - 1} with ${options} options).`;
    if (status === 'timeout') return 'Time ran out on this puzzle: 0 points.';
    return 'Skipped: 0 points.';
  }
  if (status === 'correct') {
    const eff = 1 / Math.max(1, submissions);
    return submissions <= 1 ? 'Correct first time. Efficiency 100%.' : `Correct after ${submissions} answers. Efficiency ${pct(eff)}.`;
  }
  if (submissions) return `Not solved after ${submissions} ${submissions === 1 ? 'answer' : 'answers'}: efficiency 0%.`;
  return 'Skipped: efficiency 0%.';
}

export function penaltyText(options) {
  return `1/${options - 1} = ${wrongPenalty(options).toFixed(2)}`;
}

// Short label for an option value, for aria and tables.
export function optionText(puzzle, i) {
  const v = puzzle.options[i];
  return puzzle.kind === 'hidden' ? `box ${spaced(v)}` : [...v].map((c) => ITEMS[c]?.name ?? c).join(', ');
}

