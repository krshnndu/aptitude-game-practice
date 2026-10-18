// Operator Switch: pure model (no DOM), shared by the generator, explainer, coach, UI and tests.
// The solver (solver.js) re-implements the rule on its own and does not import this file.
//
// Items: up to five shapes, each with a one-letter code. An arrangement is a string of codes,
// slot 1 first, for example 'CSTD'. An operator ("box") is a string of digits such as '3142':
// output slot i takes the item that was at input position digit i, so '3142' on 'CSTD' gives 'TCDS'.
//
// Puzzle JSON shape:
//   { id, kind: 'forward'|'hidden'|'twin', n, start, chains: [[op, ...], ...],
//     hidden: { chain, at } | null, target: arrangement | null,
//     options: [arrangement or op, ...], answer, optimal: 1 }
//   forward: one chain, every box shown, the options are arrangements, the answer is the result.
//   hidden:  one chain with chains[0][at] === null, target is the shown output, the options are
//            operators, the answer is the operator that makes the chain produce the target.
//   twin:    two chains from the same start that end in the same arrangement; the options are
//            arrangements, the answer is that common result.

export const ITEMS = {
  C: { code: 'C', name: 'circle', colour: 'blue', hex: '#0072B2', pattern: 'dots' },
  S: { code: 'S', name: 'square', colour: 'orange', hex: '#E69F00', pattern: 'diag' },
  T: { code: 'T', name: 'triangle', colour: 'green', hex: '#009E73', pattern: 'hlines' },
  D: { code: 'D', name: 'diamond', colour: 'pink', hex: '#CC79A7', pattern: 'grid' },
  H: { code: 'H', name: 'hexagon', colour: 'sky blue', hex: '#56B4E9', pattern: 'vlines' },
};
export const ITEM_CODES = Object.keys(ITEMS);
export const KINDS = ['forward', 'hidden', 'twin'];

export function itemName(code) {
  const it = ITEMS[code];
  return it ? `${it.name} ${it.code}` : String(code);
}

export function arrangementText(arr) {
  return [...arr].map(itemName).join(', ');
}

// '3142' -> '3 1 4 2'; also used for number rows.
export function spaced(seq) {
  return [...seq].join(' ');
}

export function identityOp(n) {
  let s = '';
  for (let i = 1; i <= n; i++) s += String(i);
  return s;
}

export function isOp(op, n) {
  if (typeof op !== 'string' || op.length !== n) return false;
  const seen = new Set();
  for (const ch of op) {
    const d = Number(ch);
    if (!Number.isInteger(d) || d < 1 || d > n || seen.has(d)) return false;
    seen.add(d);
  }
  return true;
}

export function isArrangement(arr, n) {
  if (typeof arr !== 'string' || arr.length !== n) return false;
  return new Set(arr).size === n && [...arr].every((c) => c in ITEMS);
}

// Slot i of the output takes the entry at position op[i] of the input.
// Works on strings (returns a string) and arrays (returns an array).
export function applyOp(seq, op) {
  const out = [...op].map((d) => seq[Number(d) - 1]);
  return typeof seq === 'string' ? out.join('') : out;
}

// Reverses applyOp: the entry in slot i goes back to position op[i].
export function undoOp(seq, op) {
  const out = new Array(op.length);
  [...op].forEach((d, i) => (out[Number(d) - 1] = seq[i]));
  return typeof seq === 'string' ? out.join('') : out;
}

export function invertOp(op) {
  return undoOp(identityOp(op.length), op);
}

// The operator that turns arrangement `from` into `to` (both hold the same distinct entries).
export function opBetween(from, to) {
  return [...to].map((x) => String([...from].indexOf(x) + 1)).join('');
}

// One operator equal to applying a then b.
export function composeOps(a, b) {
  return applyOp(a, b);
}

export function fixedPoints(op) {
  return [...op].filter((d, i) => Number(d) === i + 1).length;
}

export function isInvolution(op) {
  return invertOp(op) === op;
}

// Rows after each box: rows[0] is the input, rows[k] the result after box k.
export function runChain(seq, ops) {
  const rows = [seq];
  for (const op of ops) rows.push(applyOp(rows[rows.length - 1], op));
  return rows;
}

export function chainResult(seq, ops) {
  return runChain(seq, ops).pop();
}

// Slots (0-based) where two arrangements differ.
export function diffSlots(a, b) {
  const out = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

export function swapSlots(seq, i, j) {
  const a = [...seq];
  [a[i], a[j]] = [a[j], a[i]];
  return typeof seq === 'string' ? a.join('') : a;
}

// ---------------------------------------------------------------- puzzle level

// For a hidden puzzle: the row just before the hidden box (start run forward) and the row just
// after it (target with the later boxes undone, last box first).
export function hiddenRows(puzzle) {
  const ops = puzzle.chains[puzzle.hidden.chain];
  const at = puzzle.hidden.at;
  const before = chainResult(puzzle.start, ops.slice(0, at));
  let after = puzzle.target;
  for (let j = ops.length - 1; j > at; j--) after = undoOp(after, ops[j]);
  return { before, after, ops, at };
}

// The correct answer value (an arrangement, or an operator for hidden puzzles).
export function correctValue(puzzle) {
  if (puzzle.kind === 'hidden') {
    const { before, after } = hiddenRows(puzzle);
    return opBetween(before, after);
  }
  return chainResult(puzzle.start, puzzle.chains[0]);
}

export function optionCount(puzzle) {
  return puzzle.options.length;
}

export function boxCount(puzzle) {
  return puzzle.chains.reduce((s, c) => s + c.length, 0);
}

// ---------------------------------------------------------------- misreadings

// Plain-English names for wrong answers that common misreadings of the rule produce. The generator
// uses them as distractors; the coach and the explainer use them to name the error behind a pick.
export const MISTAKES = {
  original: {
    label: 'Box applied to the start row',
    you: 'apply each box to the start row instead of the row before it, so only the last box counts',
  },
  inverse: {
    label: 'Digits read backwards (inverse)',
    you: 'read each box backwards, as "the item in position i moves to slot digit i" instead of "slot i takes the item from position digit i"',
  },
  reversed: {
    label: 'Boxes taken in the wrong order',
    you: 'apply the boxes from right to left instead of left to right',
  },
  dropped: {
    label: 'A box left out',
    you: 'leave one box out of the chain',
  },
  'hidden-inverse': {
    label: 'Hidden box read backwards (inverse)',
    you: 'write the hidden box backwards: where each entry goes, instead of where each slot takes its entry from',
  },
  'hidden-direct': {
    label: 'Other boxes ignored',
    you: 'treat the hidden box as the only box, going straight from the start row to the output',
  },
  'hidden-skip-before': {
    label: 'Boxes before the gap ignored',
    you: 'ignore the boxes before the hidden one and start from the start row',
  },
  'hidden-skip-after': {
    label: 'Boxes after the gap ignored',
    you: 'ignore the boxes after the hidden one, as if the output came straight out of the hidden box',
  },
  'hidden-undo-forward': {
    label: 'Later boxes applied, not undone',
    you: 'apply the later boxes to the output again instead of undoing them',
  },
  slip: {
    label: 'One slot pair swapped',
    you: 'use the right method but swap two slots by a slip while tracking',
  },
  other: {
    label: 'Unclassified error',
    you: 'make an error that does not match a common misreading of the rule',
  },
};

// Answers produced by the misreadings for one chain. Returns [{ kind, value, box? }] in priority
// order, values that equal the correct answer removed. Single-chain arrangement version.
export function chainMistakes(start, ops) {
  const right = chainResult(start, ops);
  const out = [];
  const add = (kind, value, extra = {}) => {
    if (value !== right) out.push({ kind, value, ...extra });
  };
  add('inverse', chainResult(start, ops.map(invertOp)));
  if (ops.length >= 2) {
    add('original', applyOp(start, ops[ops.length - 1]));
    add('reversed', chainResult(start, ops.slice().reverse()));
    for (let j = ops.length - 1; j >= 0; j--) add('dropped', chainResult(start, ops.filter((_, k) => k !== j)), { box: j + 1 });
  }
  return out;
}

export function hiddenMistakes(puzzle) {
  const { before, after, ops, at } = hiddenRows(puzzle);
  const right = opBetween(before, after);
  const out = [];
  const add = (kind, value) => {
    if (value !== right) out.push({ kind, value });
  };
  add('hidden-inverse', invertOp(right));
  if (ops.length > 1) add('hidden-direct', opBetween(puzzle.start, puzzle.target));
  if (at > 0) add('hidden-skip-before', opBetween(puzzle.start, after));
  if (at < ops.length - 1) {
    add('hidden-skip-after', opBetween(before, puzzle.target));
    let fwd = puzzle.target;
    for (let j = ops.length - 1; j > at; j--) fwd = applyOp(fwd, ops[j]);
    add('hidden-undo-forward', opBetween(before, fwd));
  }
  return out;
}

// Every named wrong answer for a puzzle: [{ kind, value, chain?, box? }].
export function puzzleMistakes(puzzle) {
  if (puzzle.kind === 'hidden') return hiddenMistakes(puzzle);
  const out = [];
  puzzle.chains.forEach((ops, c) => {
    for (const m of chainMistakes(puzzle.start, ops)) out.push(puzzle.chains.length > 1 ? { ...m, chain: c } : m);
  });
  return out;
}

// Why a value is wrong: { kinds: [...], primary, slots } (slots: 0-based differing positions).
export function diagnose(puzzle, value) {
  const right = correctValue(puzzle);
  if (value === right) return { kinds: [], primary: null, slots: [] };
  const matches = puzzleMistakes(puzzle).filter((m) => m.value === value);
  const kinds = [...new Set(matches.map((m) => m.kind))];
  const slots = diffSlots(right, value);
  if (!kinds.length && slots.length === 2) kinds.push('slip');
  if (!kinds.length) kinds.push('other');
  return { kinds, primary: kinds[0], slots, matches };
}

// ---------------------------------------------------------------- scoring

// Timed test points: +1 correct, 0 skip or time-out, and a wrong answer costs 1 / (options - 1),
// so blind guessing averages zero.
export function wrongPenalty(options) {
  return options > 1 ? 1 / (options - 1) : 1;
}

export function examPoints(result, options) {
  if (result === 'correct') return 1;
  if (result === 'wrong') return -wrongPenalty(options);
  return 0;
}

// ---------------------------------------------------------------- session

// Interactive session for one puzzle. Practice: a wrong pick is crossed out and you may try
// again (efficiency = 1 / answers given). Exam: the first answer is final.
export function createSession(puzzle, { mode = 'practice', maxHints = 0 } = {}) {
  const exam = mode === 'exam';
  const answers = [];
  const crossed = new Set();
  let status = 'playing'; // playing | correct | wrong | skipped | timeout
  let hints = 0;

  const s = {
    puzzle,
    mode,
    get status() {
      return status;
    },
    get playing() {
      return status === 'playing';
    },
    get answers() {
      return answers.slice();
    },
    get submissions() {
      return answers.length;
    },
    get hintsUsed() {
      return hints;
    },
    isCrossed(i) {
      return crossed.has(i);
    },
    canAnswer(i) {
      return status === 'playing' && Number.isInteger(i) && i >= 0 && i < puzzle.options.length && !crossed.has(i);
    },
    // Returns { ok, correct } (ok false when the pick is not allowed).
    answer(i) {
      if (!s.canAnswer(i)) return { ok: false, correct: false };
      answers.push(i);
      if (i === puzzle.answer) {
        status = 'correct';
        return { ok: true, correct: true };
      }
      crossed.add(i);
      if (exam) status = 'wrong';
      return { ok: true, correct: false };
    },
    canHint() {
      return !exam && status === 'playing' && hints < maxHints;
    },
    useHint() {
      if (!s.canHint()) return false;
      hints++;
      return true;
    },
    skip() {
      if (status !== 'playing') return false;
      status = 'skipped';
      return true;
    },
    timeout() {
      if (status !== 'playing') return false;
      status = 'timeout';
      return true;
    },
    // Practice efficiency: 1 / answers given when solved, else 0.
    efficiency() {
      return status === 'correct' ? 1 / answers.length : 0;
    },
    // Recorder outcome: the core recorder knows solved, skipped and timeout. A wrong final answer
    // is stored as skipped with its answer event in the log (see docs/operatorswitch.md).
    outcome() {
      if (status === 'correct') return 'solved';
      if (status === 'timeout') return 'timeout';
      return 'skipped';
    },
    examPoints() {
      return examPoints(status, puzzle.options.length);
    },
  };
  return s;
}
