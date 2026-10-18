// Independent validator for Grid Memory puzzles. It shares no rule code with gen.js or state.js:
// symmetry, connectivity and arithmetic are recomputed here from the stored content, so a bug in
// the generator cannot hide behind the same bug in the checker.
//
// A puzzle has exactly one correct response when:
//   - the sequence holds `length` distinct in-grid cells (so one ordered list of taps is right),
//   - every side question has exactly two possible answers and the stored one is the only true one.

const SIDE_OPTIONS = { sym: ['yes', 'no'], parity: ['even', 'odd'] };

// Independent mirror test: reverse each row string and compare whole rows; count differing pairs.
export function mirrorDiffPairs(rows) {
  let diff = 0;
  for (const row of rows) {
    const mirrored = row.split('').reverse().join('');
    for (let c = 0; c < row.length; c++) if (row[c] !== mirrored[c]) diff++;
  }
  // Every differing pair was seen twice (from each side).
  return diff / 2;
}

function oneShape(rows) {
  // Flood fill by rows and columns through '#' cells, as a union of labels.
  const h = rows.length;
  const w = rows[0].length;
  const label = Array.from({ length: h }, () => new Array(w).fill(0));
  let next = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (rows[r][c] !== '#' || label[r][c]) continue;
      next++;
      const queue = [[r, c]];
      label[r][c] = next;
      for (let q = 0; q < queue.length; q++) {
        const [y, x] = queue[q];
        for (const [yy, xx] of [[y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]]) {
          if (yy >= 0 && xx >= 0 && yy < h && xx < w && rows[yy][xx] === '#' && !label[yy][xx]) {
            label[yy][xx] = next;
            queue.push([yy, xx]);
          }
        }
      }
    }
  }
  return next === 1;
}

function evaluate(a, op, b) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': {
      let s = 0;
      for (let i = 0; i < b; i++) s += a;
      return s;
    }
    default: return NaN;
  }
}

// The single correct answer to a side question, computed here.
export function solveSide(d) {
  if (d.kind === 'sym') return mirrorDiffPairs(d.rows) === 0 ? 'yes' : 'no';
  if (d.kind === 'parity') {
    const v = evaluate(d.a, d.op, d.b);
    return v % 2 === 0 ? 'even' : 'odd';
  }
  return null;
}

// The single correct recall response: the sequence itself, after checking it is unambiguous.
export function solveRecall(p) {
  return p.sequence.slice();
}

function isLine(n, cells) {
  if (cells.length < 3) return true;
  const pt = (x) => ({ r: (x - (x % n)) / n, c: x % n });
  const a = pt(cells[0]);
  const b = pt(cells[1]);
  return cells.every((x) => {
    const q = pt(x);
    return (b.r - a.r) * (q.c - a.c) === (b.c - a.c) * (q.r - a.r);
  });
}

// Returns a list of problem strings for one puzzle.
export function checkPuzzle(p, cfg) {
  const problems = [];
  const bad = (m) => problems.push(m);
  if (p.n !== cfg.n) bad(`grid ${p.n} != ${cfg.n}`);
  if (!(p.length >= cfg.lengths[0] && p.length <= cfg.lengths[1])) bad(`length ${p.length} outside ${cfg.lengths.join('-')}`);
  if (p.showMs !== cfg.showMs) bad(`showMs ${p.showMs} != ${cfg.showMs}`);
  if (p.windowMs !== cfg.windowMs) bad(`windowMs ${p.windowMs} != ${cfg.windowMs}`);
  if (!Array.isArray(p.sequence) || p.sequence.length !== p.length) bad('sequence length != length');
  else {
    const cells = new Set();
    for (const x of p.sequence) {
      if (!Number.isInteger(x) || x < 0 || x >= p.n * p.n) bad(`cell ${x} off the grid`);
      if (cells.has(x)) bad(`cell ${x} repeats, so the order would be ambiguous`);
      cells.add(x);
    }
    if (cfg.noLine && p.length >= 3 && isLine(p.n, p.sequence)) bad('sequence lies on one straight line');
  }
  if (!Array.isArray(p.distractors) || p.distractors.length !== p.length) {
    bad('need one side question after every highlight');
    return problems;
  }
  const shapes = new Set();
  p.distractors.forEach((d, i) => {
    const at = `side ${i + 1}`;
    if (!cfg.kinds.includes(d.kind)) return bad(`${at}: kind ${d.kind} not used in this set`);
    if (!SIDE_OPTIONS[d.kind].includes(d.answer)) return bad(`${at}: answer ${d.answer} is not one of ${SIDE_OPTIONS[d.kind]}`);
    if (d.kind === 'sym') {
      const size = cfg.shapeSize;
      if (!Array.isArray(d.rows) || d.rows.length !== size || d.rows.some((row) => typeof row !== 'string' || row.length !== size || /[^#.]/.test(row))) {
        return bad(`${at}: shape must be ${size} rows of ${size} '#' or '.'`);
      }
      if (!oneShape(d.rows)) bad(`${at}: shape is not one connected piece`);
      const pairs = mirrorDiffPairs(d.rows);
      if (d.answer === 'yes' && pairs !== 0) bad(`${at}: marked symmetric but ${pairs} mirror pair(s) differ`);
      if (d.answer === 'no' && pairs === 0) bad(`${at}: marked not symmetric but it is symmetric`);
      if (d.answer === 'no' && (pairs < cfg.asymDiff[0] || pairs > cfg.asymDiff[1])) bad(`${at}: ${pairs} differing pairs outside ${cfg.asymDiff.join('-')}`);
      const key = d.rows.join('/');
      if (shapes.has(key)) bad(`${at}: shape repeats inside the trial`);
      shapes.add(key);
    } else {
      if (!cfg.arith || !cfg.arith.ops.includes(d.op)) return bad(`${at}: operator ${d.op} not used in this set`);
      if (!Number.isInteger(d.a) || !Number.isInteger(d.b) || d.a < 0 || d.b < 0) return bad(`${at}: operands must be whole numbers`);
      const v = evaluate(d.a, d.op, d.b);
      if (!(v >= 0)) bad(`${at}: result ${v} is negative`);
    }
    const truth = solveSide(d);
    if (truth !== d.answer) bad(`${at}: stored answer ${d.answer}, correct answer ${truth}`);
  });
  return problems;
}

// Returns a list of problem strings for a whole set file.
export function checkSetData(data, cfg, { count = 10 } = {}) {
  const tag = `set ${cfg.set}`;
  const problems = [];
  if (data.game !== 'gridmemory') problems.push(`${tag}: game ${data.game}`);
  if (data.set !== cfg.set) problems.push(`${tag}: file says set ${data.set}`);
  if (data.n !== cfg.n) problems.push(`${tag}: n ${data.n} != ${cfg.n}`);
  if (!Array.isArray(data.puzzles) || data.puzzles.length !== count) {
    problems.push(`${tag}: ${data.puzzles?.length} puzzles, expected ${count}`);
    return problems;
  }
  const ids = new Set();
  const seqs = new Set();
  let prevLen = 0;
  const tally = { yes: 0, no: 0, even: 0, odd: 0 };
  const kinds = new Set();
  for (const p of data.puzzles) {
    const where = `${tag} ${p.id}`;
    if (ids.has(p.id)) problems.push(`${where}: duplicate id`);
    ids.add(p.id);
    for (const m of checkPuzzle(p, cfg)) problems.push(`${where}: ${m}`);
    const key = (p.sequence || []).join(',');
    if (seqs.has(key)) problems.push(`${where}: duplicate sequence`);
    seqs.add(key);
    if (p.length < prevLen) problems.push(`${where}: length ${p.length} drops below the previous ${prevLen} (sets climb in difficulty)`);
    prevLen = p.length;
    for (const d of p.distractors || []) {
      if (d.answer in tally) tally[d.answer]++;
      kinds.add(d.kind);
    }
  }
  const lens = data.puzzles.map((p) => p.length);
  if (Math.min(...lens) !== cfg.lengths[0] || Math.max(...lens) !== cfg.lengths[1]) {
    problems.push(`${tag}: lengths ${Math.min(...lens)}-${Math.max(...lens)} do not span ${cfg.lengths.join('-')}`);
  }
  for (const k of cfg.kinds) if (!kinds.has(k)) problems.push(`${tag}: no ${k} questions`);
  // Answers balanced across the set, so always pressing one button cannot pass.
  for (const [a, b] of [['yes', 'no'], ['even', 'odd']]) {
    const total = tally[a] + tally[b];
    if (total && (tally[a] / total < 0.3 || tally[a] / total > 0.7)) problems.push(`${tag}: ${a}/${b} answers unbalanced (${tally[a]}/${tally[b]})`);
  }
  return problems;
}
