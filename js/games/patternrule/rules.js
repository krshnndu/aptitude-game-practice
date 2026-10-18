// Pattern Rule: vocabulary, panel helpers and the rule catalogue (pure, no DOM).
//
// A panel is a 3x3 grid holding 1 to 4 shapes, at most one per cell:
//   { shapes: [{ t, f, s, d, r, c, x, y, rot, k }] }
//   t type: tri | dome | arrow | drop     f fill: solid | outline | striped
//   s size: S | L                         d direction the shape points: U | R | D | L
//   r, c: row and column (0..2)           x, y, rot, k: SVG drawing data (see drawData)
// Every shape type is mirror symmetric about its pointing axis, so a left-right mirror maps
// a shape pointing R to one pointing L and keeps U and D.
//
// The catalogue is a list of atoms: named yes/no tests on one panel, each in one dimension.
// A rule is a conjunction of atoms. Every atom also explains itself in plain English (why()).

export const GRID = 3;
export const TYPES = ['tri', 'dome', 'arrow', 'drop'];
export const TYPE_NAMES = { tri: 'triangle', dome: 'half-disc', arrow: 'arrow', drop: 'drop' };
export const TYPE_PLURALS = { tri: 'triangles', dome: 'half-discs', arrow: 'arrows', drop: 'drops' };
export const FILLS = ['solid', 'outline', 'striped'];
export const FILL_NAMES = { solid: 'solid', outline: 'outlined', striped: 'striped' };
export const SIZES = ['S', 'L'];
export const SIZE_NAMES = { S: 'small', L: 'large' };
export const DIRS = ['U', 'R', 'D', 'L'];
export const DIR_NAMES = { U: 'up', R: 'right', D: 'down', L: 'left' };
export const OPPOSITE = { U: 'D', D: 'U', L: 'R', R: 'L' };
export const DIR_STEP = { U: [-1, 0], R: [0, 1], D: [1, 0], L: [0, -1] };
export const ROW_NAMES = ['top', 'middle', 'bottom'];
export const COL_NAMES = ['left', 'centre', 'right'];
export const ATTR_KEYS = { type: 't', fill: 'f', size: 's', direction: 'd' };
export const ATTR_VALUES = { t: TYPES, f: FILLS, s: SIZES, d: DIRS };
const VALUE_NAMES = { t: TYPE_NAMES, f: FILL_NAMES, s: SIZE_NAMES, d: DIR_NAMES };

// Dimensions, in the order the explanation scans them.
export const DIMENSIONS = [
  { id: 'count', name: 'number of shapes' },
  { id: 'type', name: 'shape type' },
  { id: 'fill', name: 'fill' },
  { id: 'direction', name: 'direction' },
  { id: 'size', name: 'size' },
  { id: 'position', name: 'position' },
  { id: 'symmetry', name: 'symmetry' },
  { id: 'relation', name: 'relation between the shapes' },
];
export const DIM_NAMES = Object.fromEntries(DIMENSIONS.map((d) => [d.id, d.name]));

// ---------------------------------------------------------------- panel helpers

export function cellName(r, c) {
  if (r === 1 && c === 1) return 'centre';
  if (r === 1) return `middle ${COL_NAMES[c]}`;
  if (c === 1) return `${ROW_NAMES[r]} centre`;
  return `${ROW_NAMES[r]} ${COL_NAMES[c]}`;
}

export function valueName(key, v) {
  return VALUE_NAMES[key][v];
}

export function shapeName(s) {
  return `${SIZE_NAMES[s.s]} ${FILL_NAMES[s.f]} ${TYPE_NAMES[s.t]} pointing ${DIR_NAMES[s.d]}`;
}

export function shapeText(s) {
  return `${shapeName(s)} (${cellName(s.r, s.c)})`;
}

// Short form for reasons: "the striped arrow (top left)".
export function shapeRef(s, keys = ['f', 't']) {
  const words = [];
  if (keys.includes('s')) words.push(SIZE_NAMES[s.s]);
  if (keys.includes('f')) words.push(FILL_NAMES[s.f]);
  words.push(TYPE_NAMES[s.t]);
  return `the ${words.join(' ')} (${cellName(s.r, s.c)})`;
}

export function describePanel(panel) {
  const n = panel.shapes.length;
  return `${n} ${n === 1 ? 'shape' : 'shapes'}: ${panel.shapes.map(shapeText).join('; ')}.`;
}

export const ROT = { U: 0, R: 90, D: 180, L: 270 };
export const SCALE = { L: 1, S: 0.58 };

// SVG drawing data for one shape in a 300 x 300 view box (100 units per cell).
export function drawData(s) {
  return { x: 50 + 100 * s.c, y: 50 + 100 * s.r, rot: ROT[s.d], k: SCALE[s.s] };
}

export function sortShapes(shapes) {
  return shapes.slice().sort((a, b) => a.r - b.r || a.c - b.c);
}

export function shapeKey(s) {
  return `${s.t}.${s.f}.${s.s}.${s.d}@${s.r}${s.c}`;
}

// Hand-built panels (tests, fixtures): makePanel('tri.solid.L.U@00', 'drop.striped.S.R@11').
export function parseShape(key) {
  const m = /^(tri|dome|arrow|drop)\.(solid|outline|striped)\.([SL])\.([URDL])@([0-2])([0-2])$/.exec(key);
  if (!m) throw new Error(`bad shape key ${key}`);
  return { t: m[1], f: m[2], s: m[3], d: m[4], r: Number(m[5]), c: Number(m[6]) };
}

export function makePanel(...keys) {
  return { shapes: sortShapes(keys.map(parseShape)).map((s) => ({ ...s, ...drawData(s) })) };
}

export function panelKey(panel) {
  return panel.shapes.map(shapeKey).sort().join('|');
}

export function mirrorShape(s, axis) {
  if (axis === 'v') return { ...s, c: GRID - 1 - s.c, d: s.d === 'L' ? 'R' : s.d === 'R' ? 'L' : s.d };
  return { ...s, r: GRID - 1 - s.r, d: s.d === 'U' ? 'D' : s.d === 'D' ? 'U' : s.d };
}

export function shapeAt(panel, r, c) {
  return panel.shapes.find((s) => s.r === r && s.c === c) ?? null;
}

// Cells on the ray from shape a in its pointing direction, nearest first.
export function rayCells(a) {
  const [dr, dc] = DIR_STEP[a.d];
  const out = [];
  for (let r = a.r + dr, c = a.c + dc; r >= 0 && c >= 0 && r < GRID && c < GRID; r += dr, c += dc) out.push([r, c]);
  return out;
}

export function pointsAt(a, b) {
  return rayCells(a).some(([r, c]) => r === b.r && c === b.c);
}

// "a triangle", "an arrow".
export const aType = (t) => `${/^[aeiou]/.test(TYPE_NAMES[t]) ? 'an' : 'a'} ${TYPE_NAMES[t]}`;

const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const isAre = (k) => (k === 1 ? 'is' : 'are');
const listAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function offenderList(shapes, keys) {
  const shown = shapes.slice(0, 3).map((s) => shapeRef(s, keys));
  const more = shapes.length > 3 ? ` and ${shapes.length - 3} more` : '';
  return `${listAnd(shown)}${more}`;
}

// ---------------------------------------------------------------- atoms

// atom: { id, dim, about, kind: 'attr'|'relation', clause, test(panel), why(panel) }
// clause: the rule wording ("every shape is striped"); why: the reason it holds or fails here.
const ATOM_LIST = [];
function def(a) {
  ATOM_LIST.push(a);
}

// Counts.
for (let k = 1; k <= 4; k++) {
  def({
    id: `count-eq:${k}`,
    dim: 'count',
    kind: 'attr',
    clause: `the panel has exactly ${plural(k, 'shape')}`,
    test: (p) => p.shapes.length === k,
    why: (p) => (p.shapes.length === k ? `it has exactly ${plural(k, 'shape')}` : `it has ${plural(p.shapes.length, 'shape')}, not ${k}`),
  });
}
for (const k of [2, 3]) {
  def({
    id: `count-min:${k}`,
    dim: 'count',
    kind: 'attr',
    clause: `the panel has at least ${k} shapes`,
    test: (p) => p.shapes.length >= k,
    why: (p) => `it has ${plural(p.shapes.length, 'shape')}${p.shapes.length >= k ? '' : `, fewer than ${k}`}`,
  });
  def({
    id: `count-max:${k}`,
    dim: 'count',
    kind: 'attr',
    clause: `the panel has at most ${k} shapes`,
    test: (p) => p.shapes.length <= k,
    why: (p) => `it has ${plural(p.shapes.length, 'shape')}${p.shapes.length <= k ? '' : `, more than ${k}`}`,
  });
}
for (const [id, word, odd] of [['count-odd', 'odd', 1], ['count-even', 'even', 0]]) {
  def({
    id,
    dim: 'count',
    kind: 'attr',
    clause: `the panel has an ${word} number of shapes`,
    test: (p) => p.shapes.length % 2 === odd,
    why: (p) => `it has ${plural(p.shapes.length, 'shape')}, an ${p.shapes.length % 2 ? 'odd' : 'even'} number`,
  });
}

// Every shape / at least one shape has a value, for each attribute.
const ATTR_WORDING = {
  t: { all: (v) => `every shape is ${aType(v)}`, any: (v) => `at least one shape is ${aType(v)}`, not: (v) => `${isAre(1)} not ${aType(v)}`, plural: (v) => `${isAre(2)} not ${TYPE_PLURALS[v]}`, keys: ['f', 't'] },
  f: { all: (v) => `every shape is ${FILL_NAMES[v]}`, any: (v) => `at least one shape is ${FILL_NAMES[v]}`, not: (v) => `is not ${FILL_NAMES[v]}`, plural: (v) => `are not ${FILL_NAMES[v]}`, keys: ['f', 't'] },
  s: { all: (v) => `every shape is ${SIZE_NAMES[v]}`, any: (v) => `at least one shape is ${SIZE_NAMES[v]}`, not: (v) => `is not ${SIZE_NAMES[v]}`, plural: (v) => `are not ${SIZE_NAMES[v]}`, keys: ['s', 'f', 't'] },
  d: { all: (v) => `every shape points ${DIR_NAMES[v]}`, any: (v) => `at least one shape points ${DIR_NAMES[v]}`, not: (v) => `does not point ${DIR_NAMES[v]}`, plural: (v) => `do not point ${DIR_NAMES[v]}`, keys: ['f', 't'] },
};
const DIM_OF_KEY = { t: 'type', f: 'fill', s: 'size', d: 'direction' };
function noneText(key, v) {
  if (key === 'd') return `no shape points ${DIR_NAMES[v]}`;
  return key === 't' ? `no shape is ${aType(v)}` : `no shape is ${valueName(key, v)}`;
}
const FAMILY_OF_KEY = { t: 'type', f: 'fill', s: 'size', d: 'dir' };

for (const key of ['t', 'f', 'd', 's']) {
  const w = ATTR_WORDING[key];
  for (const v of ATTR_VALUES[key]) {
    const describe = (sh) => (key === 'd' ? `${shapeRef(sh, w.keys)} points ${DIR_NAMES[sh.d]}` : shapeRef(sh, key === 's' ? ['s', 'f', 't'] : w.keys));
    def({
      id: `${FAMILY_OF_KEY[key]}-all:${v}`,
      dim: DIM_OF_KEY[key],
      kind: 'attr',
      key,
      value: v,
      clause: w.all(v),
      test: (p) => p.shapes.length > 0 && p.shapes.every((sh) => sh[key] === v),
      why: (p) => {
        const bad = p.shapes.filter((sh) => sh[key] !== v);
        if (!bad.length) return `${w.all(v)} (${p.shapes.length} of ${p.shapes.length})`;
        if (key === 'd') return `${listAnd(bad.slice(0, 3).map(describe))}, so not ${w.all(v)}`;
        return `${offenderList(bad, key === 's' ? ['s', 'f', 't'] : w.keys)} ${bad.length === 1 ? w.not(v) : w.plural(v)}`;
      },
    });
    def({
      id: `${FAMILY_OF_KEY[key]}-any:${v}`,
      dim: DIM_OF_KEY[key],
      kind: 'attr',
      key,
      value: v,
      clause: w.any(v),
      test: (p) => p.shapes.some((sh) => sh[key] === v),
      why: (p) => {
        const good = p.shapes.filter((sh) => sh[key] === v);
        if (good.length) return `${w.any(v)}: ${describe(good[0])}`;
        return noneText(key, v);
      },
    });
    def({
      id: `${FAMILY_OF_KEY[key]}-none:${v}`,
      dim: DIM_OF_KEY[key],
      kind: 'attr',
      key,
      value: v,
      clause: noneText(key, v),
      test: (p) => p.shapes.every((sh) => sh[key] !== v),
      why: (p) => {
        const bad = p.shapes.filter((sh) => sh[key] === v);
        return bad.length ? `${describe(bad[0])}${key === 'd' ? '' : ` is ${key === 't' ? aType(v) : valueName(key, v)}`}` : noneText(key, v);
      },
    });
  }
}

// Positions.
for (let r = 0; r < GRID; r++) {
  def({
    id: `row-all:${r}`,
    dim: 'position',
    kind: 'attr',
    clause: `every shape sits in the ${ROW_NAMES[r]} row`,
    test: (p) => p.shapes.length > 0 && p.shapes.every((s) => s.r === r),
    why: (p) => {
      const bad = p.shapes.filter((s) => s.r !== r);
      return bad.length ? `${offenderList(bad, ['f', 't'])} ${isAre(bad.length)} not in the ${ROW_NAMES[r]} row` : `every shape sits in the ${ROW_NAMES[r]} row`;
    },
  });
}
for (let c = 0; c < GRID; c++) {
  def({
    id: `col-all:${c}`,
    dim: 'position',
    kind: 'attr',
    clause: `every shape sits in the ${COL_NAMES[c]} column`,
    test: (p) => p.shapes.length > 0 && p.shapes.every((s) => s.c === c),
    why: (p) => {
      const bad = p.shapes.filter((s) => s.c !== c);
      return bad.length ? `${offenderList(bad, ['f', 't'])} ${isAre(bad.length)} not in the ${COL_NAMES[c]} column` : `every shape sits in the ${COL_NAMES[c]} column`;
    },
  });
}
def({
  id: 'centre-filled',
  dim: 'position',
  kind: 'attr',
  clause: 'the centre cell holds a shape',
  test: (p) => !!shapeAt(p, 1, 1),
  why: (p) => {
    const s = shapeAt(p, 1, 1);
    return s ? `the centre cell holds ${shapeRef(s).replace(/ \(centre\)$/, '')}` : 'the centre cell is empty';
  },
});
def({
  id: 'centre-empty',
  dim: 'position',
  kind: 'attr',
  clause: 'the centre cell is empty',
  test: (p) => !shapeAt(p, 1, 1),
  why: (p) => {
    const s = shapeAt(p, 1, 1);
    return s ? `the centre cell holds ${shapeRef(s).replace(/ \(centre\)$/, '')}` : 'the centre cell is empty';
  },
});

// Mirror symmetry of the whole panel, attributes included.
function asymmetry(p, axis) {
  for (const s of p.shapes) {
    const m = mirrorShape(s, axis);
    const twin = shapeAt(p, m.r, m.c);
    if (!twin) return `${shapeRef(s)} has no mirror twin: the ${cellName(m.r, m.c)} cell is empty`;
    if (shapeKey(twin) !== shapeKey(m)) {
      if (twin === s) return `${shapeRef(s)} sits on the fold line but points ${DIR_NAMES[s.d]}, so it does not mirror onto itself`;
      return `${shapeRef(s)} and ${shapeRef(twin)} do not mirror each other (the twin should be a ${shapeName(m)})`;
    }
  }
  return null;
}
for (const [axis, word, line] of [['v', 'left to right', 'the middle column'], ['h', 'top to bottom', 'the middle row']]) {
  def({
    id: `sym-${axis}`,
    dim: 'symmetry',
    kind: 'attr',
    clause: `the panel is mirror symmetric ${word}`,
    test: (p) => !asymmetry(p, axis),
    why: (p) => asymmetry(p, axis) ?? `it is mirror symmetric ${word}: folding along ${line} maps every shape onto an identical twin`,
  });
}

// Relations. same-* and diff-* need 2 or more shapes; the rest need exactly 2 shapes.
const needPair = (p) => `it has ${plural(p.shapes.length, 'shape')}, and this rule is about a pair of shapes`;
const needTwoPlus = () => 'it has only 1 shape, so there is nothing to compare';
for (const key of ['t', 'f', 's', 'd']) {
  const noun = { t: 'type', f: 'fill', s: 'size', d: 'direction' }[key];
  const valuesOf = (p) => p.shapes.map((s) => valueName(key, s[key]));
  def({
    id: `same-${noun === 'direction' ? 'dir' : noun}`,
    dim: 'relation',
    about: DIM_OF_KEY[key],
    kind: 'relation',
    clause: key === 'd' ? 'all the shapes point the same way' : `all the shapes have the same ${noun}`,
    test: (p) => p.shapes.length >= 2 && p.shapes.every((s) => s[key] === p.shapes[0][key]),
    why: (p) => {
      if (p.shapes.length < 2) return needTwoPlus(p);
      const vals = [...new Set(valuesOf(p))];
      if (vals.length === 1) return key === 'd' ? `all the shapes point ${vals[0]}` : `all the shapes are ${vals[0]}`;
      return key === 'd' ? `the shapes point ${listAnd(vals)}, not all the same way` : `the shapes are ${listAnd(vals)}, not all the same ${noun}`;
    },
  });
  def({
    id: `diff-${noun === 'direction' ? 'dir' : noun}`,
    dim: 'relation',
    about: DIM_OF_KEY[key],
    kind: 'relation',
    clause: key === 'd' ? 'no two shapes point the same way' : `no two shapes have the same ${noun}`,
    test: (p) => p.shapes.length >= 2 && new Set(p.shapes.map((s) => s[key])).size === p.shapes.length,
    why: (p) => {
      if (p.shapes.length < 2) return needTwoPlus(p);
      const vals = valuesOf(p);
      if (new Set(vals).size === vals.length) return key === 'd' ? `the shapes point ${listAnd(vals)}, all different ways` : `the shapes are ${listAnd(vals)}, all different`;
      const dup = vals.find((v, i) => vals.indexOf(v) !== i);
      return key === 'd' ? `two shapes both point ${dup}` : `two shapes are both ${dup}`;
    },
  });
}

const pair = (p) => (p.shapes.length === 2 ? p.shapes : null);
def({
  id: 'opp-dir',
  dim: 'relation',
  about: 'direction',
  kind: 'relation',
  clause: 'the two shapes point in opposite directions',
  test: (p) => !!pair(p) && OPPOSITE[p.shapes[0].d] === p.shapes[1].d,
  why: (p) => {
    const q = pair(p);
    if (!q) return needPair(p);
    const [a, b] = q;
    return OPPOSITE[a.d] === b.d ? `they point ${DIR_NAMES[a.d]} and ${DIR_NAMES[b.d]}, opposite ways` : `they point ${DIR_NAMES[a.d]} and ${DIR_NAMES[b.d]}, not opposite ways`;
  },
});
def({
  id: 'aligned',
  dim: 'relation',
  about: 'position',
  kind: 'relation',
  clause: 'the shapes share a row or a column',
  test: (p) => p.shapes.length >= 2 && (p.shapes.every((s) => s.r === p.shapes[0].r) || p.shapes.every((s) => s.c === p.shapes[0].c)),
  why: (p) => {
    if (p.shapes.length < 2) return needTwoPlus(p);
    if (p.shapes.every((s) => s.r === p.shapes[0].r)) return `the shapes share the ${ROW_NAMES[p.shapes[0].r]} row`;
    if (p.shapes.every((s) => s.c === p.shapes[0].c)) return `the shapes share the ${COL_NAMES[p.shapes[0].c]} column`;
    return 'the shapes do not all share a row or a column';
  },
});
for (const [id, key, names, word] of [['same-row', 'r', ROW_NAMES, 'row'], ['same-col', 'c', COL_NAMES, 'column']]) {
  def({
    id,
    dim: 'relation',
    about: 'position',
    kind: 'relation',
    clause: `all the shapes sit in one ${word}`,
    test: (p) => p.shapes.length >= 2 && p.shapes.every((s) => s[key] === p.shapes[0][key]),
    why: (p) => {
      if (p.shapes.length < 2) return needTwoPlus(p);
      const lines = [...new Set(p.shapes.map((s) => s[key]))];
      return lines.length === 1 ? `all the shapes sit in the ${names[lines[0]]} ${word}` : `the shapes sit in ${lines.length} different ${word}s`;
    },
  });
}
def({
  id: 'touch',
  dim: 'relation',
  about: 'position',
  kind: 'relation',
  clause: 'the two shapes sit in neighbouring cells, sharing a side',
  test: (p) => !!pair(p) && Math.abs(p.shapes[0].r - p.shapes[1].r) + Math.abs(p.shapes[0].c - p.shapes[1].c) === 1,
  why: (p) => {
    const q = pair(p);
    if (!q) return needPair(p);
    const [a, b] = q;
    const gap = Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
    if (gap === 1) return `they sit in neighbouring cells (${cellName(a.r, a.c)} and ${cellName(b.r, b.c)})`;
    if (Math.abs(a.r - b.r) === 1 && Math.abs(a.c - b.c) === 1) return `they only touch at a corner (${cellName(a.r, a.c)} and ${cellName(b.r, b.c)})`;
    return `they are apart (${cellName(a.r, a.c)} and ${cellName(b.r, b.c)})`;
  },
});
def({
  id: 'points-at',
  dim: 'relation',
  about: 'direction',
  kind: 'relation',
  clause: 'one shape points straight at the other',
  test: (p) => !!pair(p) && (pointsAt(p.shapes[0], p.shapes[1]) || pointsAt(p.shapes[1], p.shapes[0])),
  why: (p) => {
    const q = pair(p);
    if (!q) return needPair(p);
    const [a, b] = q;
    if (pointsAt(a, b)) return `${shapeRef(a)} points ${DIR_NAMES[a.d]}, straight at ${shapeRef(b)}`;
    if (pointsAt(b, a)) return `${shapeRef(b)} points ${DIR_NAMES[b.d]}, straight at ${shapeRef(a)}`;
    return `neither shape points at the other (they point ${DIR_NAMES[a.d]} and ${DIR_NAMES[b.d]})`;
  },
});
def({
  id: 'facing',
  dim: 'relation',
  about: 'direction',
  kind: 'relation',
  clause: 'the two shapes point straight at each other',
  test: (p) => !!pair(p) && pointsAt(p.shapes[0], p.shapes[1]) && pointsAt(p.shapes[1], p.shapes[0]),
  why: (p) => {
    const q = pair(p);
    if (!q) return needPair(p);
    const [a, b] = q;
    if (pointsAt(a, b) && pointsAt(b, a)) return `they point straight at each other (${DIR_NAMES[a.d]} and ${DIR_NAMES[b.d]})`;
    if (pointsAt(a, b)) return `${shapeRef(a)} points at ${shapeRef(b)}, but not back`;
    if (pointsAt(b, a)) return `${shapeRef(b)} points at ${shapeRef(a)}, but not back`;
    return `neither shape points at the other (they point ${DIR_NAMES[a.d]} and ${DIR_NAMES[b.d]})`;
  },
});
for (const [id, axis, word, lineWord] of [['large-above', 'r', 'higher than', 'row'], ['large-left', 'c', 'further left than', 'column']]) {
  def({
    id,
    dim: 'relation',
    about: 'size',
    kind: 'relation',
    clause: `the large shape sits ${word} the small one`,
    test: (p) => {
      const q = pair(p);
      if (!q || q[0].s === q[1].s) return false;
      const big = q[0].s === 'L' ? q[0] : q[1];
      const small = big === q[0] ? q[1] : q[0];
      return big[axis] < small[axis];
    },
    why: (p) => {
      const q = pair(p);
      if (!q) return needPair(p);
      if (q[0].s === q[1].s) return `both shapes are ${SIZE_NAMES[q[0].s]}`;
      const big = q[0].s === 'L' ? q[0] : q[1];
      const small = big === q[0] ? q[1] : q[0];
      if (big[axis] < small[axis]) return `the large ${TYPE_NAMES[big.t]} (${cellName(big.r, big.c)}) is ${word} the small ${TYPE_NAMES[small.t]} (${cellName(small.r, small.c)})`;
      if (big[axis] === small[axis]) return `the large and the small shape are in the same ${lineWord}`;
      return `the large ${TYPE_NAMES[big.t]} (${cellName(big.r, big.c)}) is not ${word} the small ${TYPE_NAMES[small.t]} (${cellName(small.r, small.c)})`;
    },
  });
}

export const ATOMS = Object.freeze(ATOM_LIST);
export const ATOM_INDEX = new Map(ATOMS.map((a, i) => [a.id, i]));

export function atom(id) {
  const i = ATOM_INDEX.get(id);
  if (i === undefined) throw new Error(`unknown atom ${id}`);
  return ATOMS[i];
}

export function holds(id, panel) {
  return atom(id).test(panel);
}

// A rule (list of atom ids) holds when every atom holds.
export function ruleHolds(rule, panel) {
  return rule.every((id) => holds(id, panel));
}

export function failingAtoms(rule, panel) {
  return rule.filter((id) => !holds(id, panel));
}

// Plain-English rule: "Every shape is striped, and the two shapes point in opposite directions."
export function ruleText(rule) {
  const clauses = rule.map((id) => atom(id).clause);
  const body = clauses.length <= 1 ? clauses.join('') : `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`;
  return `${cap(body)}.`;
}

// Dimension label for an atom, with the attribute a relation compares: "relation (fill)".
export function atomDimLabel(id) {
  const a = atom(id);
  return a.dim === 'relation' && a.about ? `relation (${DIM_NAMES[a.about] ?? a.about})` : DIM_NAMES[a.dim];
}

export { plural, listAnd, cap };
