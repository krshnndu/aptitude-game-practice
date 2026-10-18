// Digit Equation review adapter (pure). Generated puzzles rebuild from the seed in their id; when a
// run skipped an already served candidate the rebuild differs, which the checksum catches at save
// time, and a compact encoding is kept instead. Repeats ('~r') map back to their pool puzzle.

import { SET_CONFIGS, generateFresh } from './gen.js';
import { coachPuzzle, replayLog, HABITS } from './coach.js';
import { explainPuzzle } from './explain.js';
import { parsePuzzle, slotName, OPS } from './state.js';
import { checksumOf, seedFromId, splitVariant, fixIds, makeBlob, readBlob } from '../../core/learn-util.js';
import { accuracyDim, efficiencyDim, firstMoveDim, tagDim } from '../../core/dims.js';

export const GAME_ID = 'digitequation';
export const GENERATOR_VERSION = 1;

const paceSec = (set) => SET_CONFIGS.find((c) => c.set === set)?.paceSec ?? 30;

export function checksum(p) {
  return checksumOf({ tokens: p.tokens, tray: p.tray, answer: p.answer });
}

function kindOf(pid) {
  if (pid.includes('~')) return 'repeat';
  if (seedFromId(pid) !== null) return 'generated';
  return 'pool';
}

export function refFor(attempt, puzzle = null) {
  const pid = attempt.puzzleId;
  const src = kindOf(pid);
  const ref = { pid, set: attempt.set, src, gv: GENERATOR_VERSION };
  if (src === 'generated') ref.seed = seedFromId(pid);
  if (puzzle) {
    ref.check = checksum(puzzle);
    if (src === 'generated') {
      let same = false;
      try {
        same = checksum(generateFresh(attempt.set, ref.seed)) === ref.check;
      } catch {
        same = false;
      }
      if (!same) {
        const blob = makeBlob({ tokens: puzzle.tokens, tray: puzzle.tray, blanks: puzzle.blanks, optimal: puzzle.optimal, answer: puzzle.answer, solutions: puzzle.solutions, unique: puzzle.unique, decoys: puzzle.decoys, difficulty: puzzle.difficulty });
        if (blob) ref.blob = blob;
      }
    }
  }
  return ref;
}

export const needsSet = (ref) => !ref.blob && ref.src !== 'generated';
export const slowRebuild = () => false;

export function regenerate(ref, setData = null) {
  if (ref.blob) {
    const b = readBlob(ref.blob);
    return b ? { id: ref.pid, ...b } : null;
  }
  if (ref.src === 'generated') return Number.isFinite(ref.seed) ? generateFresh(ref.set, ref.seed) : null;
  const { base } = splitVariant(ref.pid);
  const p = setData?.puzzles?.find((x) => x.id === base);
  if (!p) return null;
  return ref.src === 'repeat' ? { ...p, id: ref.pid } : p;
}

export function tagsFor(attempt, puzzle) {
  return fixIds(coachPuzzle(attempt, puzzle, { paceSec: paceSec(attempt.set) }).findings);
}

export function features(p) {
  const ops = new Set(p.tokens.filter((t) => Object.hasOwn(OPS, t)));
  const parsed = parsePuzzle(p);
  const right = parsed.slots.some((s) => parsed.numbers[s.num]?.side === 'R');
  const out = [`${p.blanks} ${p.blanks === 1 ? 'blank' : 'blanks'}`];
  if (ops.has('/')) out.push('has division');
  if ((ops.has('x') || ops.has('/')) && (ops.has('+') || ops.has('-'))) out.push('mixed precedence');
  else if (ops.has('x')) out.push('multiplication only');
  else out.push('addition and subtraction only');
  out.push(right ? 'blank in the result' : 'blanks on the left only');
  return out;
}

export function userPath(attempt, puzzle) {
  const parsed = parsePuzzle(puzzle);
  const rep = replayLog(puzzle, attempt.events ?? []);
  return rep.placements.map((pl) => {
    const ok = pl.d === puzzle.answer[pl.slot];
    return { text: `Placed ${pl.d} in ${slotName(parsed, pl.slot)}${ok ? '' : ` (the answer has ${puzzle.answer[pl.slot]})`}`, ok, t: pl.t };
  });
}

export function divergence(attempt, puzzle) {
  const path = userPath(attempt, puzzle);
  const i = path.findIndex((s) => !s.ok);
  return i < 0 ? null : { index: i, text: `Placement ${i + 1} left the solution: ${path[i].text}.` };
}

export const optimalSteps = (puzzle) => explainPuzzle(puzzle).steps.map((s) => s.text);
export const timeOf = (a) => a.metrics?.totalMs ?? 0;
export const parMs = (a) => paceSec(a.set) * 1000;
export const tagLabel = (id) => HABITS[id]?.label ?? id;
export const TAG_IDS = Object.keys(HABITS);

export const DIMS = [
  accuracyDim,
  efficiencyDim('Placement efficiency (blanks / tiles placed)'),
  firstMoveDim('Time to first placement', 12000),
  tagDim('precedence', 'Operator choice: order of operations slips', ['precedence']),
  tagDim('checks', 'Arithmetic slips (wrong checks)', ['wrong-checks']),
  tagDim('guessing', 'Guessing or decoy tiles', ['guessing', 'decoy']),
  tagDim('wasted', 'Extra placements', ['wasted']),
];
