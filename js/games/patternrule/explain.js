// "How it should be solved", computed from the puzzle (pure, no DOM):
//   - the rule in plain English,
//   - a dimension scan: for each dimension, what the fitting panels show and why it is or is not
//     part of the rule (varies across fitting panels, shared but also present in a does-not-fit
//     panel, or broken alone by a does-not-fit panel),
//   - for every candidate, each part of the rule with the reason it holds or fails, and the
//     dimension a non-fitting candidate breaks,
//   - the strategy: isolate one dimension at a time.

import {
  ATOMS,
  DIMENSIONS,
  DIM_NAMES,
  TYPE_NAMES,
  FILL_NAMES,
  SIZE_NAMES,
  DIR_NAMES,
  atom,
  atomDimLabel,
  ruleText,
  cellName,
  listAnd,
  cap,
} from './rules.js';
import { letter } from './state.js';

export const STRATEGY = [
  'Isolate one dimension at a time: number of shapes, shape type, fill, direction, size, position, symmetry, and with two shapes, how they relate.',
  'For each dimension ask: do all the fitting panels agree on it? If they differ, it is not part of the rule; cross it off.',
  'Use the does-not-fit panels: a feature they also have is not the whole rule, and the one feature a does-not-fit panel breaks is part of it.',
  'Say the rule as one short sentence before you look at the candidates.',
  'Test each candidate against each part of the rule, one part at a time. Ignore everything else, even when a candidate looks different overall.',
  'In a timed test, skip when no shared feature stands out after about half the pace guide.',
];

const uniq = (xs) => [...new Set(xs)];

// What one panel shows on one dimension, in a few words.
export function dimValue(panel, dim) {
  const sh = panel.shapes;
  switch (dim) {
    case 'count':
      return String(sh.length);
    case 'type':
      return uniq(sh.map((s) => TYPE_NAMES[s.t])).join(', ');
    case 'fill':
      return uniq(sh.map((s) => FILL_NAMES[s.f])).join(', ');
    case 'direction':
      return uniq(sh.map((s) => DIR_NAMES[s.d])).join(', ');
    case 'size':
      return uniq(sh.map((s) => SIZE_NAMES[s.s])).join(', ');
    case 'position':
      return sh.map((s) => cellName(s.r, s.c)).join(', ');
    case 'symmetry': {
      const v = atom('sym-v').test(panel);
      const h = atom('sym-h').test(panel);
      return v && h ? 'mirror both ways' : v ? 'mirror left to right' : h ? 'mirror top to bottom' : 'no mirror';
    }
    default:
      return '';
  }
}

const allOn = (a, panels) => panels.every((p) => a.test(p));
const noneOn = (a, panels) => panels.every((p) => !a.test(p));

// Most telling shared features first: "every shape" and exact counts, then relations, then
// "at least one", then "no shape", then count bounds and parity.
function rank(a) {
  if (/-all:|^count-eq|^sym-/.test(a.id)) return 0;
  if (a.kind === 'relation' || /^centre/.test(a.id)) return 1;
  if (/-any:/.test(a.id)) return 2;
  if (/-none:/.test(a.id)) return 3;
  return 4;
}
function strongest(atoms) {
  return atoms.slice().sort((a, b) => rank(a) - rank(b));
}

export function dimensionScan(puzzle) {
  const fits = puzzle.fits;
  const counters = puzzle.counters;
  const all = [...fits, ...counters, ...puzzle.candidates];
  const ruleSet = new Set(puzzle.rule);
  const showRelation = fits.some((p) => p.shapes.length >= 2);
  const rows = [];
  for (const d of DIMENSIONS) {
    if (d.id === 'relation' && !showRelation) continue;
    const shared = ATOMS.filter((a) => a.dim === d.id && allOn(a, fits));
    const ruleAtoms = shared.filter((a) => ruleSet.has(a.id));
    const values = d.id === 'relation' ? [] : fits.map((p) => dimValue(p, d.id));
    let verdict;
    let text;
    if (ruleAtoms.length) {
      verdict = 'rule';
      const clauses = ruleAtoms.map((a) => a.clause);
      const evidence = [];
      for (const a of ruleAtoms) {
        const others = puzzle.rule.filter((id) => id !== a.id);
        const alone = counters
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => !a.test(p) && others.every((id) => atom(id).test(p)))
          .map(({ i }) => i + 1);
        if (alone.length && others.length) evidence.push(`does-not-fit panel ${listAnd(alone.map(String))} ${alone.length === 1 ? 'breaks' : 'break'} only this part, so it belongs in the rule`);
        else if (alone.length) evidence.push(`${alone.length === counters.length ? 'every does-not-fit panel breaks it' : `does-not-fit panel ${listAnd(alone.map(String))} ${alone.length === 1 ? 'breaks' : 'break'} it`}`);
      }
      text = `Every fitting panel agrees: ${listAnd(clauses)}.${evidence.length ? ` ${cap(evidence.join('; '))}.` : ''} Part of the rule.`;
    } else if (shared.length) {
      verdict = 'shared';
      const show = strongest(shared).slice(0, 1);
      const a = show[0];
      const constant = allOn(a, all);
      const inCounter = counters.findIndex((p) => a.test(p));
      let reason;
      if (constant) reason = 'every panel in the puzzle has it, so it cannot tell candidates apart';
      else if (inCounter >= 0) reason = `does-not-fit panel ${inCounter + 1} has it too, so on its own it is not the rule`;
      else if (noneOn(a, puzzle.candidates.filter((_, i) => !puzzle.answer.includes(i))) && allOn(a, puzzle.answer.map((i) => puzzle.candidates[i]))) reason = 'here it picks the same candidates as the rule, so it does not change the answer';
      else reason = 'it is not needed to separate the panels';
      text = `The fitting panels share: ${listAnd(show.map((x) => x.clause))}. But ${reason}.`;
    } else {
      verdict = 'varies';
      if (d.id === 'relation') text = 'No relation between the shapes is shared by every fitting panel. Not part of the rule.';
      else if (d.id === 'symmetry' && values.every((v) => v === 'no mirror')) text = 'None of the fitting panels is mirror symmetric, so symmetry is not part of the rule.';
      else text = `It varies across the fitting panels (${values.map((v, i) => `panel ${i + 1}: ${v}`).join('; ')}). Not part of the rule.`;
    }
    rows.push({ dim: d.id, name: d.name, verdict, values, text });
  }
  return rows;
}

// Each candidate against each part of the rule.
export function candidateVerdicts(puzzle) {
  const key = new Set(puzzle.answer);
  return puzzle.candidates.map((p, i) => {
    const parts = puzzle.rule.map((id) => {
      const a = atom(id);
      const ok = a.test(p);
      return { atom: id, holds: ok, dim: a.dim, dimLabel: atomDimLabel(id), text: a.why(p) };
    });
    const fits = key.has(i);
    const broken = parts.filter((x) => !x.holds);
    const summary = fits
      ? `${letter(i)} fits: ${listAnd(parts.map((x) => x.text))}.`
      : `${letter(i)} does not fit: ${listAnd(broken.map((x) => x.text))}. Breaks: ${listAnd(uniq(broken.map((x) => x.dimLabel)))}.`;
    return { index: i, letter: letter(i), fits, parts, broken: broken.map((x) => x.dimLabel), summary };
  });
}

// Pick outcome per candidate after an answer: hit | false | miss | reject.
export function pickMarks(puzzle, picks) {
  const chosen = new Set(picks);
  const key = new Set(puzzle.answer);
  return puzzle.candidates.map((_, i) => {
    if (chosen.has(i)) return key.has(i) ? 'hit' : 'false';
    return key.has(i) ? 'miss' : 'reject';
  });
}

export const MARK_TEXT = { hit: 'Correct pick', false: 'Wrong pick: does not fit', miss: 'Missed: this one fits', reject: 'Correctly left out' };

export function explainPuzzle(puzzle) {
  const scan = dimensionScan(puzzle);
  const verdicts = candidateVerdicts(puzzle);
  const ruleDims = scan.filter((r) => r.verdict === 'rule').map((r) => DIM_NAMES[r.dim]);
  const crossed = scan.filter((r) => r.verdict === 'varies').map((r) => DIM_NAMES[r.dim]);
  const steps = [
    crossed.length ? `Cross off what the fitting panels do not all share: ${listAnd(crossed)}.` : 'Every dimension has something the fitting panels share: use the does-not-fit panels to find what matters.',
    `What is left and broken by the does-not-fit panels: ${listAnd(ruleDims)}. Rule: ${ruleText(puzzle.rule)}`,
    `Test each candidate on ${listAnd(ruleDims)} only: ${listAnd(verdicts.map((v) => `${v.letter} ${v.fits ? 'fits' : `breaks ${listAnd(v.broken)}`}`))}.`,
  ];
  return { rule: ruleText(puzzle.rule), scan, verdicts, steps };
}

export function resultSummary(result, puzzle) {
  const n = puzzle.answer.length;
  if (result.status === 'skipped') return `Skipped: scores 0. ${n === 1 ? 'One candidate fits' : `${n} candidates fit`}: ${listAnd(puzzle.answer.map(letter))}.`;
  if (result.status === 'timeout') return 'Time ran out on this puzzle: scores 0.';
  if (result.exact) return `Correct: ${listAnd(puzzle.answer.map(letter))} ${n === 1 ? 'is the only candidate that fits' : 'are exactly the candidates that fit'}. Scores 1.`;
  const parts = [];
  if (result.falsePicks.length) parts.push(`${listAnd(result.falsePicks.map(letter))} ${result.falsePicks.length === 1 ? 'does' : 'do'} not fit`);
  if (result.misses.length) parts.push(`you missed ${listAnd(result.misses.map(letter))}`);
  return `Not quite: ${parts.join(', and ')}. Scores 0. The fitting ${n === 1 ? 'candidate is' : 'candidates are'} ${listAnd(puzzle.answer.map(letter))}.`;
}
