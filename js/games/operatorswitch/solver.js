// Operator Switch solver and validator. Independent of state.js on purpose: the rule is
// re-implemented here with zero-based index maps, and every chain is collapsed into one composite
// map before it is applied, so a bug in the step-by-step model cannot hide in both places.
//
// solvePuzzle() brute-forces every option (and, for a hidden box, every permutation of n) and
// reports which ones satisfy the puzzle. validatePuzzle() returns a list of problems.

const ITEM_SET = new Set(['C', 'S', 'T', 'D', 'H']);

// '3142' -> [2, 0, 3, 1]: output slot i reads input index map[i].
function toMap(op) {
  return [...op].map((ch) => ch.charCodeAt(0) - 49);
}

function validMap(map, n) {
  if (map.length !== n) return false;
  const seen = new Array(n).fill(false);
  for (const x of map) {
    if (!(x >= 0 && x < n) || seen[x]) return false;
    seen[x] = true;
  }
  return true;
}

// Composite of a then b as one map: slot i reads a's output at b[i], which read input a[b[i]].
function compose(a, b) {
  return b.map((x) => a[x]);
}

function composite(ops, n) {
  let m = Array.from({ length: n }, (_, i) => i);
  for (const op of ops) m = compose(m, toMap(op));
  return m;
}

function applyMap(arr, map) {
  return map.map((x) => arr[x]).join('');
}

function isIdentity(map) {
  return map.every((x, i) => x === i);
}

// Every permutation of 0..n-1 as an op string (n <= 5: at most 120).
export function allOps(n) {
  const out = [];
  const used = new Array(n).fill(false);
  const cur = [];
  (function rec() {
    if (cur.length === n) {
      out.push(cur.map((x) => String(x + 1)).join(''));
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(i);
      rec();
      cur.pop();
      used[i] = false;
    }
  })();
  return out;
}

function chainOutput(start, ops) {
  return applyMap([...start], composite(ops, start.length));
}

function withHidden(ops, at, op) {
  return ops.map((o, k) => (k === at ? op : o));
}

// Returns { correct: [option indexes that satisfy the puzzle], value, spaceMatches }.
// value: the unique satisfying arrangement or operator (null if none). spaceMatches: for hidden
// puzzles, how many of all n! operators satisfy it (must be exactly 1).
export function solvePuzzle(puzzle) {
  const { start, kind } = puzzle;
  const n = start.length;
  if (kind === 'hidden') {
    const ops = puzzle.chains[puzzle.hidden.chain];
    const at = puzzle.hidden.at;
    const fits = (op) => chainOutput(start, withHidden(ops, at, op)) === puzzle.target;
    const space = allOps(n).filter(fits);
    const correct = puzzle.options.map((o, i) => (typeof o === 'string' && validMap(toMap(o), n) && fits(o) ? i : -1)).filter((i) => i >= 0);
    return { correct, value: space.length === 1 ? space[0] : null, spaceMatches: space.length };
  }
  const outputs = puzzle.chains.map((ops) => chainOutput(start, ops));
  const agree = outputs.every((o) => o === outputs[0]);
  const value = agree ? outputs[0] : null;
  const correct = puzzle.options.map((o, i) => (value !== null && o === value ? i : -1)).filter((i) => i >= 0);
  return { correct, value, spaceMatches: agree ? 1 : 0 };
}

const OPTION_RANGE = [4, 6];

// Structural and uniqueness checks. cfg (optional) adds the set's own constraints:
// { kind, n, boxes: [lo, hi], options: [lo, hi], twinBoxes?: [lo, hi] }.
export function validatePuzzle(puzzle, cfg = null) {
  const problems = [];
  const p = puzzle;
  const fail = (msg) => problems.push(msg);
  if (!p || typeof p !== 'object') return ['not an object'];
  if (typeof p.id !== 'string' || !p.id) fail('missing id');
  if (!['forward', 'hidden', 'twin'].includes(p.kind)) fail(`unknown kind ${p.kind}`);
  const n = p.n;
  if (!(n === 4 || n === 5)) fail(`n ${n} not 4 or 5`);
  if (typeof p.start !== 'string' || p.start.length !== n || new Set(p.start).size !== n || ![...p.start].every((c) => ITEM_SET.has(c))) {
    fail('start is not n distinct items');
    return problems;
  }
  if (!Array.isArray(p.chains) || !p.chains.length) {
    fail('no chains');
    return problems;
  }
  const expectChains = p.kind === 'twin' ? 2 : 1;
  if (p.chains.length !== expectChains) fail(`${p.chains.length} chains, expected ${expectChains}`);
  if (p.kind === 'hidden') {
    const h = p.hidden;
    if (!h || h.chain !== 0 || !Number.isInteger(h.at) || h.at < 0 || h.at >= p.chains[0].length) fail('hidden box position invalid');
    else if (p.chains[0][h.at] !== null) fail('hidden box is not blank in the chain');
    if (typeof p.target !== 'string' || p.target.length !== n || [...p.target].sort().join('') !== [...p.start].sort().join('')) fail('target is not a rearrangement of the start');
  } else {
    if (p.hidden) fail('hidden set on a non-hidden puzzle');
    if (p.target !== null && p.target !== undefined) fail('target set on a non-hidden puzzle');
  }
  if (problems.length) return problems;

  p.chains.forEach((ops, c) => {
    ops.forEach((op, k) => {
      if (p.kind === 'hidden' && k === p.hidden.at) return;
      const m = typeof op === 'string' ? toMap(op) : [];
      if (!validMap(m, n)) fail(`chain ${c + 1} box ${k + 1} (${op}) is not a permutation of 1..${n}`);
      else if (isIdentity(m)) fail(`chain ${c + 1} box ${k + 1} is the identity (does nothing)`);
    });
  });
  if (problems.length) return problems;

  // Options: count, well-formed, distinct.
  const opts = p.options;
  if (!Array.isArray(opts)) return [...problems, 'options missing'];
  const [olo, ohi] = cfg?.options ?? OPTION_RANGE;
  if (opts.length < olo || opts.length > ohi) fail(`${opts.length} options outside ${olo}-${ohi}`);
  if (new Set(opts).size !== opts.length) fail('duplicate options');
  for (const [i, o] of opts.entries()) {
    if (p.kind === 'hidden') {
      if (typeof o !== 'string' || !validMap(toMap(o), n)) fail(`option ${i + 1} is not an operator`);
      else if (isIdentity(toMap(o))) fail(`option ${i + 1} is the identity`);
    } else if (typeof o !== 'string' || o.length !== n || [...o].sort().join('') !== [...p.start].sort().join('')) {
      fail(`option ${i + 1} is not a rearrangement of the start`);
    }
  }

  const res = solvePuzzle(p);
  if (res.spaceMatches !== 1) fail(p.kind === 'twin' ? 'the two chains do not end in the same arrangement' : `${res.spaceMatches} operators fit the hidden box, expected exactly 1`);
  if (res.correct.length !== 1) fail(`${res.correct.length} options are correct, expected exactly 1`);
  else if (res.correct[0] !== p.answer) fail(`stored answer ${p.answer} but option ${res.correct[0]} is correct`);
  if (p.optimal !== 1) fail('optimal must be 1 (one answer)');

  // Non-trivial results: the chain must change the start (the answer is never "no change").
  if (p.kind !== 'hidden' && res.value === p.start) fail('result equals the start arrangement');
  if (p.kind === 'hidden' && res.value && isIdentity(toMap(res.value))) fail('hidden box is the identity');

  if (cfg) {
    if (cfg.kind && cfg.kind !== p.kind && !(cfg.twins && p.kind === 'twin')) fail(`kind ${p.kind}, set expects ${cfg.kind}`);
    if (cfg.n && cfg.n !== n) fail(`n ${n}, set expects ${cfg.n}`);
    const len = p.chains[0].length;
    if (cfg.boxes && (len < cfg.boxes[0] || len > cfg.boxes[1])) fail(`${len} boxes outside ${cfg.boxes[0]}-${cfg.boxes[1]}`);
    if (p.kind === 'twin' && cfg.twinBoxes) {
      const len2 = p.chains[1].length;
      if (len2 < cfg.twinBoxes[0] || len2 > cfg.twinBoxes[1]) fail(`second chain has ${len2} boxes outside ${cfg.twinBoxes[0]}-${cfg.twinBoxes[1]}`);
    }
  }
  return problems;
}

// Stable identity of a puzzle's question (options excluded), for duplicate checks.
export function questionKey(p) {
  return `${p.kind}|${p.start}|${p.chains.map((c) => c.map((o) => o ?? '?').join(',')).join('/')}|${p.target ?? ''}`;
}
