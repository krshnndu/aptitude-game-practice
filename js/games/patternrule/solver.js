// Pattern Rule solver and validator (pure, no DOM).
//
// A puzzle shows fitting panels (fits), panels that do not fit (counters) and candidates. The
// player is told that at least one candidate fits and at least one does not.
//
// Hypotheses are conjunctions of 1 to MAX_RULE_ATOMS atoms from the catalogue in rules.js. A
// hypothesis is consistent with a puzzle when it holds on every fitting panel, fails on every
// does-not-fit panel, and selects at least one but not every candidate. The puzzle has a unique
// answer when every consistent hypothesis selects the same candidates. That covers "a distractor
// fits a simpler rule": a simpler consistent rule that picks other candidates makes the puzzle
// ambiguous, and the generator rejects it.

import { ATOMS, ATOM_INDEX, ruleHolds, failingAtoms, panelKey, drawData, ruleText, TYPES, FILLS, SIZES, DIRS, GRID } from './rules.js';

export const MAX_RULE_ATOMS = 3;

export function puzzlePanels(puzzle) {
  return [...puzzle.fits, ...puzzle.counters, ...puzzle.candidates];
}

// masks[a]: bit j set when atom a holds on panel j.
export function atomMasks(panels) {
  return ATOMS.map((a) => panels.reduce((m, p, j) => (a.test(p) ? m | (1 << j) : m), 0));
}

export function selectionToIndices(sel, n) {
  const out = [];
  for (let i = 0; i < n; i++) if (sel & (1 << i)) out.push(i);
  return out;
}

export function indicesToSelection(indices) {
  return indices.reduce((m, i) => m | (1 << i), 0);
}

// All consistent hypotheses. full = true enumerates every conjunction of the whole catalogue;
// otherwise only atoms that hold on every fitting panel are combined (any conjunction with
// another atom already fails a fitting panel, so both give the same list).
export function versionSpace(puzzle, { maxAtoms = MAX_RULE_ATOMS, full = false } = {}) {
  const nF = puzzle.fits.length;
  const nX = puzzle.counters.length;
  const nK = puzzle.candidates.length;
  if (nF + nX + nK > 30) throw new Error('too many panels for the bit masks');
  const masks = atomMasks(puzzlePanels(puzzle));
  const fitsMask = (1 << nF) - 1;
  const counterMask = ((1 << nX) - 1) << nF;
  const shift = nF + nX;
  const allCands = (1 << nK) - 1;
  const pool = full ? ATOMS.map((_, i) => i) : ATOMS.map((_, i) => i).filter((i) => (masks[i] & fitsMask) === fitsMask);
  const hypotheses = [];
  let checked = 0;
  let trivial = 0;
  const visit = (idx, m) => {
    checked++;
    if ((m & fitsMask) !== fitsMask || (m & counterMask) !== 0) return;
    const sel = (m >>> shift) & allCands;
    if (sel === 0 || sel === allCands) {
      trivial++;
      return;
    }
    hypotheses.push({ atoms: idx.map((i) => ATOMS[i].id), selection: sel });
  };
  const L = pool.length;
  for (let a = 0; a < L; a++) {
    const ma = masks[pool[a]];
    visit([pool[a]], ma);
    if (maxAtoms < 2) continue;
    for (let b = a + 1; b < L; b++) {
      const mb = ma & masks[pool[b]];
      visit([pool[a], pool[b]], mb);
      if (maxAtoms < 3) continue;
      for (let c = b + 1; c < L; c++) visit([pool[a], pool[b], pool[c]], mb & masks[pool[c]]);
    }
  }
  return { hypotheses, checked, trivial, poolSize: L };
}

// Returns { unique, answer (indices or null), selections: Map(selection -> hypotheses), hypotheses, checked }.
export function solvePuzzle(puzzle, opts = {}) {
  const vs = versionSpace(puzzle, opts);
  const selections = new Map();
  for (const h of vs.hypotheses) {
    if (!selections.has(h.selection)) selections.set(h.selection, []);
    selections.get(h.selection).push(h);
  }
  const unique = selections.size === 1;
  const answer = unique ? selectionToIndices([...selections.keys()][0], puzzle.candidates.length) : null;
  return { unique, answer, selections, hypotheses: vs.hypotheses, checked: vs.checked, trivial: vs.trivial };
}

// The simplest consistent hypothesis that picks other candidates than the stored answer, if any.
export function rivalRule(puzzle, opts = {}) {
  const sel = indicesToSelection(puzzle.answer);
  const rivals = versionSpace(puzzle, opts).hypotheses.filter((h) => h.selection !== sel);
  rivals.sort((a, b) => a.atoms.length - b.atoms.length);
  return rivals[0] ?? null;
}

// ---------------------------------------------------------------- structural checks

function checkPanel(panel, where, { counts } = {}) {
  if (!panel || !Array.isArray(panel.shapes)) throw new Error(`${where}: no shapes`);
  const n = panel.shapes.length;
  if (n < 1 || n > 4) throw new Error(`${where}: ${n} shapes`);
  if (counts && (n < counts[0] || n > counts[1])) throw new Error(`${where}: ${n} shapes outside ${counts.join('-')}`);
  const cells = new Set();
  let prev = -1;
  for (const s of panel.shapes) {
    if (!TYPES.includes(s.t) || !FILLS.includes(s.f) || !SIZES.includes(s.s) || !DIRS.includes(s.d)) throw new Error(`${where}: bad shape attributes`);
    if (!(Number.isInteger(s.r) && Number.isInteger(s.c) && s.r >= 0 && s.c >= 0 && s.r < GRID && s.c < GRID)) throw new Error(`${where}: shape off the grid`);
    const cell = s.r * GRID + s.c;
    if (cells.has(cell)) throw new Error(`${where}: two shapes in one cell`);
    if (cell < prev) throw new Error(`${where}: shapes not in reading order`);
    prev = cell;
    cells.add(cell);
    const g = drawData(s);
    if (s.x !== g.x || s.y !== g.y || s.rot !== g.rot || s.k !== g.k) throw new Error(`${where}: drawing data does not match the shape`);
  }
}

// Every check for one puzzle. cfg (optional) adds the set's counts and sizes. Returns problem strings.
export function checkPuzzle(puzzle, cfg = null, { full = true } = {}) {
  const problems = [];
  const tag = puzzle?.id ?? '(no id)';
  const fail = (m) => problems.push(`${tag}: ${m}`);
  try {
    if (!Array.isArray(puzzle.rule) || !puzzle.rule.length) throw new Error('no rule');
    for (const id of puzzle.rule) if (!ATOM_INDEX.has(id)) throw new Error(`unknown atom ${id}`);
    if (puzzle.rule.length > MAX_RULE_ATOMS) throw new Error('rule longer than the catalogue');
    if (puzzle.ruleText !== ruleText(puzzle.rule)) fail('stored rule text differs from the computed text');
    const counts = cfg?.counts;
    puzzle.fits.forEach((p, i) => checkPanel(p, `fit ${i + 1}`, { counts }));
    puzzle.counters.forEach((p, i) => checkPanel(p, `counter ${i + 1}`, { counts }));
    puzzle.candidates.forEach((p, i) => checkPanel(p, `candidate ${i + 1}`, { counts }));
    if (cfg) {
      if (puzzle.fits.length !== cfg.fits) fail(`${puzzle.fits.length} fitting panels, expected ${cfg.fits}`);
      if (puzzle.counters.length !== cfg.counters) fail(`${puzzle.counters.length} does-not-fit panels, expected ${cfg.counters}`);
      if (puzzle.candidates.length !== cfg.candidates) fail(`${puzzle.candidates.length} candidates, expected ${cfg.candidates}`);
      const [lo, hi] = cfg.positives;
      if (puzzle.answer.length < lo || puzzle.answer.length > hi) fail(`${puzzle.answer.length} fitting candidates, expected ${lo}-${hi}`);
    }
    const keys = puzzlePanels(puzzle).map(panelKey);
    if (new Set(keys).size !== keys.length) fail('two panels in the puzzle are identical');
    puzzle.fits.forEach((p, i) => {
      if (!ruleHolds(puzzle.rule, p)) fail(`fitting panel ${i + 1} breaks the rule`);
    });
    puzzle.counters.forEach((p, i) => {
      if (ruleHolds(puzzle.rule, p)) fail(`does-not-fit panel ${i + 1} follows the rule`);
    });
    const answer = [...puzzle.answer].sort((a, b) => a - b);
    if (answer.join() !== puzzle.answer.join()) fail('answer indices not sorted');
    puzzle.candidates.forEach((p, i) => {
      const fits = ruleHolds(puzzle.rule, p);
      if (fits !== answer.includes(i)) fail(`candidate ${i + 1}: rule says ${fits ? 'fits' : 'does not fit'}, answer key disagrees`);
      const v = failingAtoms(puzzle.rule, p);
      if ((puzzle.violates?.[i] ?? []).join() !== v.join()) fail(`candidate ${i + 1}: stored violated parts differ from the computed ones`);
    });
    if (!answer.length || answer.length === puzzle.candidates.length) fail('need at least one fitting and one non-fitting candidate');

    const res = solvePuzzle(puzzle, { full });
    const sel = indicesToSelection(answer);
    const own = res.hypotheses.find((h) => h.atoms.length === puzzle.rule.length && [...h.atoms].sort().join() === [...puzzle.rule].sort().join());
    if (!own) fail('the stored rule is not consistent with the example panels');
    if (!res.unique) {
      const rivals = [...res.selections.entries()].filter(([s]) => s !== sel).map(([, hs]) => hs.sort((a, b) => a.atoms.length - b.atoms.length)[0]);
      const r = rivals[0];
      fail(`ambiguous: ${res.selections.size} different answers; e.g. "${r ? r.atoms.join(' + ') : '?'}" also fits the examples and picks ${r ? selectionToIndices(r.selection, puzzle.candidates.length).map((i) => String.fromCharCode(65 + i)).join(',') : '?'}`);
    } else if (res.answer.join() !== answer.join()) fail(`solver answer ${res.answer} differs from the key ${answer}`);
  } catch (err) {
    fail(err.message);
  }
  return problems;
}
