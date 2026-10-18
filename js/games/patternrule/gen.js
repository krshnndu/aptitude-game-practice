// Offline puzzle generator for Pattern Rule. Deterministic per seed (mulberry32).
//
// For one puzzle:
//   1. pick a rule (one or two atoms) from the set's rule families,
//   2. build fitting panels: random panels pushed into shape by small "force" steps until the
//      rule holds (set 2 also styles a distractor dimension, see below),
//   3. list every catalogue hypothesis the fitting panels support (conjunctions of up to 3 atoms),
//   4. pick does-not-fit panels from a pool of near misses (each breaks exactly one part of the
//      rule) so that they rule out as many rival hypotheses as possible,
//   5. build candidates: fitting ones satisfy every surviving hypothesis, non-fitting ones are
//      near misses that break exactly one part of the rule and every surviving hypothesis,
//   6. keep the puzzle only if the solver (solver.js) finds a unique answer equal to the key.
//
// Set 2 distractor: one dimension outside the rule (type, fill, size or direction) is styled so
// that most fitting panels share a look (all shapes one value), the non-fitting candidates copy
// that look, and the fitting candidates avoid it. Matching by overall look then fails.

import { createRng } from '../../core/rng.js';
import {
  ATOMS,
  TYPES,
  FILLS,
  SIZES,
  DIRS,
  GRID,
  OPPOSITE,
  ATTR_VALUES,
  atom,
  holds,
  ruleHolds,
  failingAtoms,
  ruleText,
  panelKey,
  drawData,
  sortShapes,
  mirrorShape,
  shapeAt,
  rayCells,
} from './rules.js';
import { solvePuzzle, MAX_RULE_ATOMS } from './solver.js';

export const PUZZLES_PER_SET = 10;

export const SET_CONFIGS = [
  {
    set: 1, name: 'Warm-up', blurb: 'One feature decides. Size and direction stay fixed unless they are the rule.',
    paceSec: 25, seed: 7101, counts: [1, 3], fits: 3, counters: 1, candidates: 4, positives: [1, 1], fixed: { s: 'L', d: 'U' },
    rules: ['type-all', 'fill-all', 'count-eq', 'dir-all', 'size-all'],
  },
  {
    set: 2, name: 'Noise on purpose', blurb: 'One feature decides, and another feature is styled to mislead.',
    paceSec: 30, seed: 7202, counts: [1, 4], fits: 3, counters: 2, candidates: 5, positives: [1, 2], distractor: true,
    rules: ['fill-all', 'type-all', 'row-all', 'dir-all', 'sym-v', 'size-all', 'col-all', 'count-eq', 'sym-h', 'centre-filled'],
  },
  {
    set: 3, name: 'Two features at once', blurb: 'The rule joins two features; a panel must have both.',
    paceSec: 40, seed: 7303, counts: [1, 3], fits: 3, counters: 2, candidates: 5, positives: [1, 2],
    rules: [['fill-all', 'type-all'], ['fill-all', 'dir-all'], ['type-all', 'size-all'], ['size-all', 'fill-all'], ['dir-all', 'type-all'],
      ['count-eq', 'fill-all'], ['row-all', 'type-all'], ['col-all', 'fill-all'], ['sym-v', 'fill-all'], ['size-all', 'dir-all']],
  },
  {
    set: 4, name: 'Relations', blurb: 'Two shapes per panel; the rule is about how they relate.',
    paceSec: 45, seed: 7404, counts: [2, 2], fits: 3, counters: 2, candidates: 5, positives: [1, 2],
    rules: ['same-fill', 'diff-type', 'same-size', 'opp-dir', 'aligned', 'touch', 'points-at', 'large-above', 'large-left', 'facing'],
  },
  {
    set: 5, name: 'Expert', blurb: 'A feature and a relation together, with six candidates.',
    paceSec: 60, seed: 7505, counts: [2, 2], fits: 3, counters: 2, candidates: 6, positives: [2, 3],
    rules: [['fill-all', 'diff-type'], ['type-all', 'opp-dir'], ['size-all', 'points-at'], ['dir-all', 'aligned'], ['fill-all', 'touch'],
      ['type-all', 'large-above'], ['col-all', 'diff-fill'], ['fill-all', 'points-at'], ['dir-all', 'diff-fill'], ['size-all', 'diff-type']],
  },
];

export function configFor(setNo) {
  const cfg = SET_CONFIGS.find((c) => c.set === setNo);
  if (!cfg) throw new Error(`unknown set ${setNo}`);
  return cfg;
}

// ---------------------------------------------------------------- rule instantiation

const FAMILY_KEY = { 'type-all': 't', 'fill-all': 'f', 'size-all': 's', 'dir-all': 'd' };

export function instantiate(family, rng, cfg) {
  if (FAMILY_KEY[family]) return `${family}:${rng.pick(ATTR_VALUES[FAMILY_KEY[family]])}`;
  if (family === 'count-eq') return `count-eq:${rng.int(cfg.counts[0], Math.min(3, cfg.counts[1]))}`;
  if (family === 'row-all' || family === 'col-all') return `${family}:${rng.int(0, GRID - 1)}`;
  return family;
}

export function ruleFor(families, rng, cfg) {
  const list = Array.isArray(families) ? families : [families];
  return list.map((f) => instantiate(f, rng, cfg));
}

const familyOf = (id) => id.split(':')[0];
const valueOf = (id) => id.split(':')[1];
const keysOfRule = (rule) => new Set(rule.map((id) => atom(id).key).filter(Boolean));

// ---------------------------------------------------------------- panels

const clone = (p) => ({ shapes: p.shapes.map((s) => ({ t: s.t, f: s.f, s: s.s, d: s.d, r: s.r, c: s.c })) });

export function finalize(p) {
  return { shapes: sortShapes(p.shapes).map((s) => ({ t: s.t, f: s.f, s: s.s, d: s.d, r: s.r, c: s.c, ...drawData(s) })) };
}

function freeCells(p, except = null) {
  const out = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const s = shapeAt(p, r, c);
      if (!s || s === except) out.push([r, c]);
    }
  }
  return out;
}

function randomShape(rng, fixed, r, c) {
  return { t: rng.pick(TYPES), f: rng.pick(FILLS), s: fixed.s ?? rng.pick(SIZES), d: fixed.d ?? rng.pick(DIRS), r, c };
}

function otherValue(rng, key, v) {
  return rng.pick(ATTR_VALUES[key].filter((x) => x !== v));
}

// Mirror symmetric layout: pairs across the fold plus shapes on the fold line that mirror onto
// themselves.
function symmetricPanel(rng, fixed, count, axis) {
  const pairsMax = 3;
  const onLineMax = 3;
  let pairs = Math.floor(count / 2);
  let line = count - 2 * pairs;
  if (pairs > pairsMax) return null;
  if (rng.chance(0.4) && pairs > 0 && line + 2 <= onLineMax) {
    pairs--;
    line += 2;
  }
  const lanes = rng.shuffle([0, 1, 2]);
  const shapes = [];
  for (let i = 0; i < pairs; i++) {
    const lane = lanes[i];
    const s = axis === 'v' ? randomShape(rng, fixed, lane, 0) : randomShape(rng, fixed, 0, lane);
    shapes.push(s, mirrorShape(s, axis));
  }
  const lineLanes = rng.shuffle([0, 1, 2]).slice(0, line);
  for (const lane of lineLanes) {
    const s = axis === 'v' ? randomShape(rng, fixed, lane, 1) : randomShape(rng, fixed, 1, lane);
    const ok = axis === 'v' ? ['U', 'D'] : ['L', 'R'];
    if (!ok.includes(s.d)) s.d = fixed.d && ok.includes(fixed.d) ? fixed.d : rng.pick(ok);
    shapes.push(s);
  }
  return { shapes };
}

function fixedFor(cfg, rule) {
  const keys = keysOfRule(rule);
  const fixed = {};
  for (const [k, v] of Object.entries(cfg.fixed ?? {})) if (!keys.has(k)) fixed[k] = v;
  return fixed;
}

function basePanel(ctx) {
  const { rng, cfg, rule, fixed } = ctx;
  let count = rng.int(cfg.counts[0], cfg.counts[1]);
  const eq = rule.find((id) => familyOf(id) === 'count-eq');
  if (eq) count = Number(valueOf(eq));
  if (rule.some((id) => /^(row|col)-all/.test(id))) count = Math.min(count, GRID);
  const sym = rule.find((id) => id === 'sym-v' || id === 'sym-h');
  if (sym) return symmetricPanel(rng, fixed, count, sym.slice(-1));
  const cells = rng.shuffle(freeCells({ shapes: [] })).slice(0, count);
  return { shapes: cells.map(([r, c]) => randomShape(rng, fixed, r, c)) };
}

// ---------------------------------------------------------------- forces

function place(p, s, rng, cells) {
  const free = cells.filter(([r, c]) => {
    const o = shapeAt(p, r, c);
    return !o || o === s;
  });
  if (!free.length) return false;
  const [r, c] = rng.pick(free);
  s.r = r;
  s.c = c;
  return true;
}

function lineCells(kind, k) {
  const out = [];
  for (let i = 0; i < GRID; i++) out.push(kind === 'row' ? [k, i] : [i, k]);
  return out;
}

const FORCES = {
  'row-all': (p, v, rng) => {
    const cols = rng.shuffle([0, 1, 2]);
    p.shapes.forEach((s, i) => {
      s.r = Number(v);
      s.c = cols[i];
    });
  },
  'col-all': (p, v, rng) => {
    const rows = rng.shuffle([0, 1, 2]);
    p.shapes.forEach((s, i) => {
      s.c = Number(v);
      s.r = rows[i];
    });
  },
  'centre-filled': (p, v, rng) => {
    if (!shapeAt(p, 1, 1)) {
      const s = rng.pick(p.shapes);
      s.r = 1;
      s.c = 1;
    }
  },
  'centre-empty': (p, v, rng) => {
    const s = shapeAt(p, 1, 1);
    if (s) place(p, s, rng, freeCells(p).filter(([r, c]) => !(r === 1 && c === 1)));
  },
  'same-type': (p) => p.shapes.forEach((s) => (s.t = p.shapes[0].t)),
  'same-fill': (p) => p.shapes.forEach((s) => (s.f = p.shapes[0].f)),
  'same-size': (p) => p.shapes.forEach((s) => (s.s = p.shapes[0].s)),
  'same-dir': (p) => p.shapes.forEach((s) => (s.d = p.shapes[0].d)),
  'diff-type': (p, v, rng) => spread(p, 't', rng),
  'diff-fill': (p, v, rng) => spread(p, 'f', rng),
  'diff-size': (p, v, rng) => spread(p, 's', rng),
  'diff-dir': (p, v, rng) => spread(p, 'd', rng),
  'opp-dir': (p) => {
    if (p.shapes.length === 2) p.shapes[1].d = OPPOSITE[p.shapes[0].d];
  },
  aligned: (p, v, rng) => {
    const a = p.shapes[0];
    const kind = rng.pick(['row', 'col']);
    const cells = lineCells(kind, kind === 'row' ? a.r : a.c);
    for (const s of p.shapes.slice(1)) {
      const inLine = kind === 'row' ? s.r === a.r : s.c === a.c;
      if (!inLine) place(p, s, rng, cells);
    }
  },
  touch: (p, v, rng) => {
    if (p.shapes.length !== 2) return;
    const [a, b] = rng.shuffle(p.shapes);
    const nb = [[a.r - 1, a.c], [a.r + 1, a.c], [a.r, a.c - 1], [a.r, a.c + 1]].filter(([r, c]) => r >= 0 && c >= 0 && r < GRID && c < GRID);
    place(p, b, rng, nb);
  },
  'points-at': (p, v, rng) => {
    if (p.shapes.length !== 2 || holds('points-at', p)) return;
    const [a, b] = rng.shuffle(p.shapes);
    const options = [];
    if (rayCells(a).length) options.push(() => place(p, b, rng, rayCells(a)));
    // Move a behind b so that b lies on a's ray.
    const behind = rayCells({ ...b, d: OPPOSITE[a.d] });
    if (behind.length) options.push(() => place(p, a, rng, behind));
    if (a.r === b.r || a.c === b.c) {
      options.push(() => {
        a.d = a.r === b.r ? (b.c > a.c ? 'R' : 'L') : b.r > a.r ? 'D' : 'U';
      });
    }
    if (options.length) rng.pick(options)();
  },
  facing: (p, v, rng) => {
    if (p.shapes.length !== 2) return;
    const [a, b] = rng.shuffle(p.shapes);
    const dirs = rng.shuffle(DIRS).filter((d) => rayCells({ ...a, d }).length);
    if (!dirs.length) return;
    const d = dirs[0];
    a.d = d;
    if (place(p, b, rng, rayCells({ ...a, d }))) b.d = OPPOSITE[d];
  },
  'large-above': (p, v, rng) => order(p, 'r', rng),
  'large-left': (p, v, rng) => order(p, 'c', rng),
};

function spread(p, key, rng) {
  const vals = rng.shuffle(ATTR_VALUES[key]);
  p.shapes.forEach((s, i) => (s[key] = vals[i % vals.length]));
}

function order(p, axis, rng) {
  if (p.shapes.length !== 2) return;
  let [a, b] = p.shapes;
  if (a[axis] === b[axis]) {
    const cells = freeCells(p).filter(([r, c]) => (axis === 'r' ? r : c) !== a[axis]);
    place(p, b, rng, cells);
  }
  if (a[axis] > b[axis]) [a, b] = [b, a];
  a.s = 'L';
  b.s = 'S';
}

const POSITION_FAMILIES = new Set(['row-all', 'col-all', 'centre-filled', 'centre-empty']);

function applyForces(p, ctx) {
  const { rule, rng } = ctx;
  const pos = rule.filter((id) => POSITION_FAMILIES.has(familyOf(id)));
  const attrs = rule.filter((id) => FAMILY_KEY[familyOf(id)]);
  const rels = rng.shuffle(rule.filter((id) => FORCES[id]));
  for (const id of pos) FORCES[familyOf(id)](p, valueOf(id), rng);
  for (const id of attrs) {
    const key = FAMILY_KEY[familyOf(id)];
    for (const s of p.shapes) s[key] = valueOf(id);
  }
  for (const id of rels) FORCES[id](p, null, rng);
  // Relations may move or turn a shape: re-apply attribute forces once.
  for (const id of attrs) {
    const key = FAMILY_KEY[familyOf(id)];
    for (const s of p.shapes) s[key] = valueOf(id);
  }
}

// ---------------------------------------------------------------- distractor style (set 2)

function pickDistractor(rule, rng) {
  const ruleKeys = keysOfRule(rule);
  const symRule = rule.some((id) => id.startsWith('sym-'));
  const keys = ['t', 'f', 's', 'd'].filter((k) => !ruleKeys.has(k) && !(symRule && k === 'd'));
  if (!keys.length) return null;
  const key = rng.pick(keys);
  return { key, value: rng.pick(ATTR_VALUES[key]) };
}

function applyStyle(p, style, rng) {
  if (!style) return;
  for (const s of p.shapes) {
    if (style.mode === 'all') s[style.key] = style.value;
    else if (s[style.key] === style.value) s[style.key] = otherValue(rng, style.key, style.value);
  }
}

function styleHolds(p, style) {
  if (!style) return true;
  return style.mode === 'all' ? p.shapes.every((s) => s[style.key] === style.value) : p.shapes.every((s) => s[style.key] !== style.value);
}

// ---------------------------------------------------------------- panel makers

function countOk(p, cfg) {
  return p.shapes.length >= cfg.counts[0] && p.shapes.length <= cfg.counts[1];
}

function fixedOk(p, fixed) {
  return Object.entries(fixed).every(([k, v]) => p.shapes.every((s) => s[k] === v));
}

// A panel that follows the rule (and the style), passing extra(panel) if given.
function makePositive(ctx, { style = null, extra = null, tries = 300 } = {}) {
  const { rng, cfg, rule, used, fixed } = ctx;
  for (let t = 0; t < tries; t++) {
    const p = basePanel(ctx);
    if (!p) continue;
    applyForces(p, ctx);
    applyStyle(p, style, rng);
    const f = finalize(p);
    if (!countOk(f, cfg) || !fixedOk(f, fixed) || !ruleHolds(rule, f) || !styleHolds(f, style)) continue;
    if (used.has(panelKey(f))) continue;
    if (extra && !extra(f)) continue;
    return f;
  }
  return null;
}

// One small change aimed at the target atom's dimension.
function mutate(p, target, ctx) {
  const { rng, cfg, fixed } = ctx;
  const a = atom(target);
  const q = clone(p);
  const s = rng.pick(q.shapes);
  const free = () => freeCells(q);
  const setAttr = (key) => {
    if (fixed[key]) return false;
    s[key] = otherValue(rng, key, s[key]);
    return true;
  };
  const move = (sh = s) => place(q, sh, rng, free().filter(([r, c]) => !(r === sh.r && c === sh.c)));
  const fam = familyOf(target);
  if (a.key && fam.endsWith('-all')) {
    // Change one shape so that it no longer has the value.
    const holders = q.shapes.filter((x) => x[a.key] === a.value);
    const h = rng.pick(holders.length ? holders : q.shapes);
    h[a.key] = otherValue(rng, a.key, h[a.key]);
  } else if (a.key && fam.endsWith('-any')) {
    for (const x of q.shapes) if (x[a.key] === a.value) x[a.key] = otherValue(rng, a.key, a.value);
  } else if (a.dim === 'count') {
    const grow = q.shapes.length < cfg.counts[1] && (q.shapes.length <= 1 || rng.chance(0.5));
    if (grow) {
      const cell = rng.pick(free());
      const base = rng.pick(q.shapes);
      q.shapes.push(rng.chance(0.5) ? { ...base, r: cell[0], c: cell[1] } : randomShape(rng, fixed, cell[0], cell[1]));
    } else if (q.shapes.length > 1) q.shapes.splice(q.shapes.indexOf(s), 1);
  } else if (a.dim === 'position') move();
  else if (a.dim === 'symmetry') {
    const keys = ['t', 'f', 's', 'd'].filter((k) => !fixed[k]);
    if (rng.chance(0.6) && keys.length) setAttr(rng.pick(keys));
    else move();
  } else if (a.about && /^(same|diff)-/.test(target)) {
    const key = { type: 't', fill: 'f', size: 's', direction: 'd' }[a.about];
    if (target.startsWith('same-')) setAttr(key);
    else {
      const [x, y] = rng.shuffle(q.shapes);
      y[key] = x[key];
    }
  } else if (target === 'opp-dir') setAttr('d');
  else if (target === 'aligned' || target === 'touch') move();
  else if (target === 'points-at' || target === 'facing') {
    if (rng.chance(0.5)) move();
    else setAttr('d');
  } else if (target === 'large-above' || target === 'large-left') {
    const pick = rng.int(0, 2);
    if (pick === 0 && q.shapes.length === 2) [q.shapes[0].s, q.shapes[1].s] = [q.shapes[1].s, q.shapes[0].s];
    else if (pick === 1) setAttr('s');
    else move();
  } else if (rng.chance(0.5)) setAttr(rng.pick(['t', 'f', 's', 'd']));
  else move();
  return q;
}

// A near miss: breaks exactly the target part of the rule, keeps every other part.
function makeNearMiss(ctx, target, { style = null, extra = null, tries = 400 } = {}) {
  const { cfg, rule, used, fixed } = ctx;
  const others = rule.filter((id) => id !== target);
  for (let t = 0; t < tries; t++) {
    const base = makePositive(ctx, { style, tries: 20 });
    if (!base) continue;
    const f = finalize(mutate(base, target, ctx));
    if (!countOk(f, cfg) || !fixedOk(f, fixed) || holds(target, f) || !ruleHolds(others, f) || !styleHolds(f, style)) continue;
    if (used.has(panelKey(f))) continue;
    if (extra && !extra(f)) continue;
    return f;
  }
  return null;
}

// ---------------------------------------------------------------- hypotheses

// Conjunctions (up to MAX_RULE_ATOMS) of the atoms that hold on every fitting panel.
function supportedHypotheses(fits) {
  const pool = ATOMS.map((a, i) => i).filter((i) => fits.every((p) => ATOMS[i].test(p)));
  const out = [];
  for (let a = 0; a < pool.length; a++) {
    out.push([pool[a]]);
    for (let b = a + 1; b < pool.length; b++) {
      out.push([pool[a], pool[b]]);
      if (MAX_RULE_ATOMS >= 3) for (let c = b + 1; c < pool.length; c++) out.push([pool[a], pool[b], pool[c]]);
    }
  }
  return out;
}

const hypHolds = (h, truth) => h.every((i) => truth[i]);
const truthOf = (p) => ATOMS.map((a) => a.test(p));

// ---------------------------------------------------------------- one puzzle

export function buildPuzzle(cfg, rule, rng) {
  const ctx = { cfg, rule, rng, used: new Set(), fixed: fixedFor(cfg, rule) };
  const distractor = cfg.distractor ? pickDistractor(rule, rng) : null;
  const style = (mode) => (distractor ? { ...distractor, mode } : null);
  const accept = (p) => {
    ctx.used.add(panelKey(p));
    return p;
  };

  const fits = [];
  for (let j = 0; j < cfg.fits; j++) {
    const p = makePositive(ctx, { style: style(j < cfg.fits - 1 ? 'all' : 'none') });
    if (!p) return null;
    fits.push(accept(p));
  }

  let alive = supportedHypotheses(fits);
  const ruleIdx = rule.map((id) => ATOMS.findIndex((a) => a.id === id));

  // Does-not-fit panels: greedy, each breaking one part of the rule in turn.
  const counters = [];
  for (let j = 0; j < cfg.counters; j++) {
    const target = rule[j % rule.length];
    let best = null;
    for (let k = 0; k < 12; k++) {
      const p = makeNearMiss(ctx, target, { style: style('all') });
      if (!p) continue;
      const truth = truthOf(p);
      const kills = alive.filter((h) => hypHolds(h, truth)).length;
      if (!best || kills > best.kills) best = { p, kills, truth };
    }
    if (!best) return null;
    counters.push(accept(best.p));
    alive = alive.filter((h) => !hypHolds(h, best.truth));
  }
  if (!alive.some((h) => h.length === ruleIdx.length && ruleIdx.every((i) => h.includes(i)))) return null;

  // Candidates.
  const nPos = rng.int(cfg.positives[0], cfg.positives[1]);
  const pos = [];
  for (let j = 0; j < nPos; j++) {
    const p = makePositive(ctx, { style: style('none'), extra: (q) => alive.every((h) => hypHolds(h, truthOf(q))) });
    if (!p) return null;
    pos.push(accept(p));
  }
  const neg = [];
  for (let j = 0; j < cfg.candidates - nPos; j++) {
    const target = rule[j % rule.length];
    const p = makeNearMiss(ctx, target, { style: style('all'), extra: (q) => { const t = truthOf(q); return alive.every((h) => !hypHolds(h, t)); } });
    if (!p) return null;
    neg.push(accept(p));
  }
  const order = rng.shuffle([...pos.map((p) => ({ p, fit: true })), ...neg.map((p) => ({ p, fit: false }))]);
  const candidates = order.map((o) => o.p);
  const answer = order.map((o, i) => (o.fit ? i : -1)).filter((i) => i >= 0);
  const puzzle = {
    id: '',
    rule,
    ruleText: ruleText(rule),
    fits,
    counters,
    candidates,
    answer,
    violates: candidates.map((p) => failingAtoms(rule, p)),
  };
  if (distractor) puzzle.distractor = distractor;
  const res = solvePuzzle(puzzle);
  if (!res.unique || res.answer.join() !== answer.join()) return null;
  return puzzle;
}

// Rough difficulty for ordering a set: shapes to inspect, answers to find, rule kind.
export function difficulty(p) {
  const shapes = [...p.fits, ...p.counters, ...p.candidates].reduce((s, q) => s + q.shapes.length, 0);
  const kind = p.rule.some((id) => /^sym-|^(row|col)-all|^centre/.test(id)) ? 3 : 0;
  return shapes + 4 * p.answer.length + kind;
}

export function generatePuzzle(cfg, rng, families, { maxAttempts = 400, avoid = null } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const rule = ruleFor(families, rng, cfg);
    // Within a set, avoid repeating a rule while other values are still available.
    if (avoid && avoid.has(rule.join('+')) && attempt <= 20) continue;
    const p = buildPuzzle(cfg, rule, rng);
    if (p) return { puzzle: p, attempts: attempt };
  }
  throw new Error(`set ${cfg.set}: no valid puzzle for ${[].concat(families).join(' + ')} after ${maxAttempts} attempts`);
}

export function generateSet(cfg, { count = PUZZLES_PER_SET, seed = cfg.seed, log = null } = {}) {
  const rng = createRng(seed);
  const puzzles = [];
  const usedRules = new Set();
  for (let i = 0; i < count; i++) {
    const families = cfg.rules[i % cfg.rules.length];
    const { puzzle, attempts } = generatePuzzle(cfg, rng, families, { avoid: usedRules });
    usedRules.add(puzzle.rule.join('+'));
    puzzles.push(puzzle);
    if (log) log(`  ${puzzle.ruleText} (attempt ${attempts})`);
  }
  // Present the set as a ladder: easier puzzles first (stable for ties).
  const ranked = puzzles.map((p, i) => ({ p, i, d: difficulty(p) })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.p);
  ranked.forEach((p, k) => (p.id = `pr${cfg.set}-${String(k + 1).padStart(2, '0')}`));
  return {
    game: 'patternrule',
    version: 1,
    set: cfg.set,
    name: cfg.name,
    paceSec: cfg.paceSec,
    seed,
    puzzles: ranked.map(({ id, ...rest }) => ({ id, ...rest })),
  };
}

// One fresh puzzle for a timed run (in the browser). Same checks as the shipped sets.
export function generateFresh(setNo, seed) {
  const cfg = configFor(setNo);
  const rng = createRng(seed);
  const { puzzle } = generatePuzzle(cfg, rng, rng.pick(cfg.rules));
  return { ...puzzle, id: `pr${setNo}-g${(seed >>> 0).toString(36)}` };
}
