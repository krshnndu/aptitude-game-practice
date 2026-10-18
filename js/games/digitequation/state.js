// Digit Equation: pure equation model and game session (no DOM), shared by the solver,
// generator, explainer, coach, UI and tests.
//
// Puzzle JSON shape:
//   { id, tokens: ['4_', 'x', '3', '=', '1_6'], tray: [{ d, n }], blanks, optimal,
//     answer: [digit per blank], solutions, unique, decoys, difficulty }
// A number token is a string of digits and '_' (one '_' per blank). Operators: + - x /.
// Exactly one '=' token. Blanks are numbered left to right in reading order (A, B, C).
// Rules: x and / before + and -, left to right; every division must come out exact;
// a number with two or more digits cannot start with 0; each tray tile can be used as many
// times as its count says; the tray may hold decoys that no answer uses.

export const OPS = {
  '+': { sym: '+', word: 'plus', mul: false },
  '-': { sym: '-', word: 'minus', mul: false },
  x: { sym: '×', word: 'times', mul: true },
  '/': { sym: '÷', word: 'divided by', mul: true },
};
export const SLOT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

const NUM_RE = /^[0-9_]+$/;

export function isNumberToken(t) {
  return typeof t === 'string' && NUM_RE.test(t);
}

// Parse a puzzle into numbers, slots and the two side sequences.
// side items: { num } for a number, { op } for an operator, alternating, starting with a number.
export function parsePuzzle(puzzle) {
  const tokens = puzzle.tokens;
  if (!Array.isArray(tokens)) throw new Error('tokens missing');
  const eq = tokens.indexOf('=');
  if (eq <= 0 || eq === tokens.length - 1 || tokens.lastIndexOf('=') !== eq) throw new Error('need exactly one = with both sides');
  const numbers = [];
  const slots = [];
  const left = [];
  const right = [];
  tokens.forEach((t, ti) => {
    if (ti === eq) return;
    const side = ti < eq ? 'L' : 'R';
    const seq = side === 'L' ? left : right;
    const wantNum = seq.length % 2 === 0;
    if (wantNum) {
      if (!isNumberToken(t)) throw new Error(`expected a number at token ${ti}, got ${t}`);
      const num = { index: numbers.length, tok: ti, pattern: t, side, slots: [] };
      [...t].forEach((ch, pos) => {
        if (ch !== '_') return;
        const s = { index: slots.length, num: num.index, pos, place: t.length - 1 - pos, label: SLOT_LABELS[slots.length] ?? `#${slots.length + 1}` };
        s.leading = pos === 0 && t.length > 1;
        s.units = s.place === 0;
        slots.push(s);
        num.slots.push(s.index);
      });
      numbers.push(num);
      seq.push({ num: num.index });
    } else {
      if (!(t in OPS)) throw new Error(`expected an operator at token ${ti}, got ${t}`);
      seq.push({ op: t });
    }
  });
  if (left.length % 2 === 0 || right.length % 2 === 0) throw new Error('a side ends with an operator');
  return { tokens, eq, numbers, slots, left, right, hasDivision: tokens.includes('/') };
}

export function trayCounts(tray) {
  const c = new Array(10).fill(0);
  for (const t of tray || []) c[t.d] += t.n;
  return c;
}

// Digits of a number with the fill applied ('?' where a blank is still empty).
export function numberText(parsed, n, fill = []) {
  const num = parsed.numbers[n];
  let k = 0;
  return [...num.pattern].map((ch) => {
    if (ch !== '_') return ch;
    const d = fill[num.slots[k++]];
    return d === null || d === undefined ? '?' : String(d);
  }).join('');
}

// { ok, value } or { ok: false, error: 'empty' | 'leading-zero' }.
export function numberValue(parsed, n, fill = []) {
  const s = numberText(parsed, n, fill);
  if (s.includes('?')) return { ok: false, error: 'empty' };
  if (s.length > 1 && s[0] === '0') return { ok: false, error: 'leading-zero' };
  return { ok: true, value: Number(s) };
}

// Evaluate values and operators with standard precedence: x and / first (left to right), then + and -.
// Returns { ok, value } or { ok: false, error: 'div-zero' | 'not-exact' }.
export function evalValues(values, ops) {
  const terms = [values[0]];
  const signs = [1];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const v = values[i + 1];
    if (op === 'x') terms[terms.length - 1] *= v;
    else if (op === '/') {
      if (v === 0) return { ok: false, error: 'div-zero' };
      const cur = terms[terms.length - 1];
      if (cur % v !== 0) return { ok: false, error: 'not-exact' };
      terms[terms.length - 1] = cur / v;
    } else {
      terms.push(v);
      signs.push(op === '+' ? 1 : -1);
    }
  }
  let value = 0;
  for (let i = 0; i < terms.length; i++) value += signs[i] * terms[i];
  return { ok: true, value };
}

// Strict left to right, ignoring precedence: used to spot the order-of-operations trap.
export function evalLeftToRight(values, ops) {
  let acc = values[0];
  for (let i = 0; i < ops.length; i++) {
    const v = values[i + 1];
    const op = ops[i];
    if (op === '+') acc += v;
    else if (op === '-') acc -= v;
    else if (op === 'x') acc *= v;
    else {
      if (v === 0 || acc % v !== 0) return { ok: false, error: v === 0 ? 'div-zero' : 'not-exact' };
      acc /= v;
    }
  }
  return { ok: true, value: acc };
}

function sideParts(parsed, seq, fill) {
  const values = [];
  const ops = [];
  for (const item of seq) {
    if ('op' in item) ops.push(item.op);
    else {
      const r = numberValue(parsed, item.num, fill);
      if (!r.ok) return { ok: false, error: r.error };
      values.push(r.value);
    }
  }
  return { ok: true, values, ops };
}

export function evalSide(parsed, side, fill, { leftToRight = false } = {}) {
  const parts = sideParts(parsed, side === 'L' ? parsed.left : parsed.right, fill);
  if (!parts.ok) return parts;
  return (leftToRight ? evalLeftToRight : evalValues)(parts.values, parts.ops);
}

// Full check of a fill. Returns { complete, valid, true, left, right, error }.
export function checkFill(parsed, fill, opts = {}) {
  const complete = parsed.slots.every((s) => Number.isInteger(fill[s.index]));
  if (!complete) return { complete: false, valid: false, true: false, error: 'incomplete' };
  const L = evalSide(parsed, 'L', fill, opts);
  if (!L.ok) return { complete, valid: false, true: false, error: L.error };
  const R = evalSide(parsed, 'R', fill, opts);
  if (!R.ok) return { complete, valid: false, true: false, error: R.error };
  return { complete, valid: true, true: L.value === R.value, left: L.value, right: R.value, error: null };
}

export function fillUsesTray(fill, tray) {
  const c = trayCounts(tray);
  for (const d of fill) {
    if (!Number.isInteger(d)) continue;
    if (--c[d] < 0) return false;
  }
  return true;
}

// Text of the equation with blanks shown as [A] (empty) or the placed digit.
export function equationText(parsed, fill = [], { brackets = true } = {}) {
  return parsed.tokens.map((t, ti) => {
    if (t === '=') return '=';
    if (t in OPS) return OPS[t].sym;
    const num = parsed.numbers.find((n) => n.tok === ti);
    let k = 0;
    return [...t].map((ch) => {
      if (ch !== '_') return ch;
      const s = parsed.slots[num.slots[k++]];
      const d = fill[s.index];
      if (Number.isInteger(d)) return brackets ? `[${d}]` : String(d);
      return `[${s.label}]`;
    }).join('');
  }).join(' ');
}

export function slotName(parsed, i) {
  return `blank ${parsed.slots[i].label}`;
}

export const ERROR_TEXT = {
  incomplete: 'fill every blank first',
  'leading-zero': 'a number with two or more digits cannot start with 0',
  'not-exact': 'a division does not come out exact',
  'div-zero': 'you cannot divide by 0',
};

// Interactive game session. Pure state, the UI layer renders it.
// Placing a tile on a filled blank swaps the old tile back to the tray.
export function createGame(puzzle) {
  const parsed = parsePuzzle(puzzle);
  const n = parsed.slots.length;
  const total = trayCounts(puzzle.tray);
  let fill = new Array(n).fill(null);
  let selected = n ? 0 : null;
  let status = 'playing'; // 'playing' | 'solved' | 'skipped'
  let placements = 0;
  let wrongChecks = 0;
  let lastCheck = null;

  const used = (d) => fill.filter((x) => x === d).length;
  const firstEmpty = (from = 0) => {
    for (let k = 0; k < n; k++) {
      const i = (from + k) % n;
      if (fill[i] === null) return i;
    }
    return null;
  };

  const game = {
    parsed,
    puzzle,
    get fill() {
      return fill.slice();
    },
    get selected() {
      return selected;
    },
    get status() {
      return status;
    },
    get solved() {
      return status === 'solved';
    },
    get placements() {
      return placements;
    },
    get wrongChecks() {
      return wrongChecks;
    },
    get lastCheck() {
      return lastCheck;
    },
    slotCount: () => n,
    left(d) {
      return total[d] - used(d);
    },
    trayDigits() {
      return puzzle.tray.map((t) => ({ d: t.d, n: t.n, left: total[t.d] - used(t.d) }));
    },
    isFull: () => fill.every((x) => x !== null),
    select(i) {
      if (i === null || (Number.isInteger(i) && i >= 0 && i < n)) selected = i;
      return selected;
    },
    selectNext(step = 1) {
      if (!n) return null;
      selected = selected === null ? 0 : (selected + step + n) % n;
      return selected;
    },
    // Place digit d into slot i (default: the selected blank, else the first empty one).
    // Returns { ok, slot, replaced } or { ok: false, reason: 'not-playing' | 'none-left' | 'no-slot' }.
    place(d, i = selected ?? firstEmpty()) {
      if (status !== 'playing') return { ok: false, reason: 'not-playing' };
      if (!Number.isInteger(i) || i < 0 || i >= n) return { ok: false, reason: 'no-slot' };
      const replaced = fill[i];
      if (replaced === d) return { ok: false, reason: 'same' };
      if (total[d] - used(d) <= 0) return { ok: false, reason: 'none-left' };
      fill[i] = d;
      placements++;
      lastCheck = null;
      const next = firstEmpty(i + 1);
      selected = next ?? i;
      return { ok: true, slot: i, replaced };
    },
    clear(i = selected) {
      if (status !== 'playing' || !Number.isInteger(i) || fill[i] === null) return false;
      fill[i] = null;
      selected = i;
      lastCheck = null;
      return true;
    },
    reset() {
      if (status !== 'playing') return false;
      fill = new Array(n).fill(null);
      selected = n ? 0 : null;
      lastCheck = null;
      return true;
    },
    // Any fill that makes the equation true counts, so a puzzle with two answers accepts both.
    check() {
      if (status !== 'playing') return { ok: false, error: 'not-playing' };
      const res = checkFill(parsed, fill);
      lastCheck = res;
      if (!res.complete) return { ok: false, ...res };
      if (res.true) {
        status = 'solved';
        selected = null;
        return { ok: true, ...res };
      }
      wrongChecks++;
      return { ok: false, ...res };
    },
    skip() {
      if (status !== 'playing') return false;
      status = 'skipped';
      selected = null;
      return true;
    },
  };
  return game;
}
