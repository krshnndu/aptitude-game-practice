// Operator Switch review adapter (pure). Generated puzzles rebuild from the seed in their id.

import { SET_CONFIGS, generateFresh } from './gen.js';
import { coachPuzzle, readLog, errorFor, HABITS } from './coach.js';
import { explainPuzzle, optionText } from './explain.js';
import { boxCount } from './state.js';
import { checksumOf, seedFromId, fixIds } from '../../core/learn-util.js';
import { accuracyDim, efficiencyDim, firstMoveDim, tagDim } from '../../core/dims.js';

export const GAME_ID = 'operatorswitch';
export const GENERATOR_VERSION = 1;
const LETTERS = 'ABCDEFGH';

const paceSec = (set) => SET_CONFIGS.find((c) => c.set === set)?.paceSec ?? 20;

export function checksum(p) {
  return checksumOf({ start: p.start, chains: p.chains, hidden: p.hidden ?? null, target: p.target ?? null, options: p.options, answer: p.answer });
}

export function refFor(attempt, puzzle = null) {
  const pid = attempt.puzzleId;
  const seed = seedFromId(pid);
  const ref = { pid, set: attempt.set, src: seed === null ? 'pool' : 'generated', gv: GENERATOR_VERSION };
  if (seed !== null) ref.seed = seed;
  if (puzzle) ref.check = checksum(puzzle);
  return ref;
}

export const needsSet = (ref) => ref.src !== 'generated';
export const slowRebuild = () => false;

export function regenerate(ref, setData = null) {
  if (ref.src === 'generated') return Number.isFinite(ref.seed) ? generateFresh(ref.set, ref.seed) : null;
  return setData?.puzzles?.find((x) => x.id === ref.pid) ?? null;
}

export function tagsFor(attempt, puzzle) {
  return fixIds(coachPuzzle(attempt, puzzle, { paceSec: paceSec(attempt.set) }).findings);
}

export function features(p) {
  const boxes = boxCount(p);
  const out = [`${p.kind} puzzle`, `${p.n} items`, `${boxes} ${boxes === 1 ? 'box' : 'boxes'}`, `${p.options.length} options`];
  if (p.hidden) {
    const len = p.chains[p.hidden.chain].length;
    out.push(p.hidden.at === 0 ? 'hidden box first' : p.hidden.at === len - 1 ? 'hidden box last' : 'hidden box in the middle');
  }
  return out;
}

export function userPath(attempt, puzzle) {
  return readLog(puzzle, attempt.events ?? []).answers.map((a, i) => ({
    text: `Answer ${i + 1}: option ${LETTERS[a.p] ?? a.p + 1} (${optionText(puzzle, a.p)})${a.correct ? ', correct' : `, wrong: ${errorFor(puzzle, a.p).text}`}`,
    ok: a.correct,
    t: a.t,
  }));
}

export function divergence(attempt, puzzle) {
  const answers = readLog(puzzle, attempt.events ?? []).answers;
  const i = answers.findIndex((a) => !a.correct);
  if (i < 0) return null;
  return { index: i, text: `Answer ${i + 1} was option ${LETTERS[answers[i].p] ?? answers[i].p + 1}: ${errorFor(puzzle, answers[i].p).text}` };
}

export const optimalSteps = (puzzle) => explainPuzzle(puzzle).steps.map((s) => s.text);
export const timeOf = (a) => a.metrics?.totalMs ?? 0;
export const parMs = (a) => paceSec(a.set) * 1000;
export const tagLabel = (id) => HABITS[id]?.label ?? id;
export const TAG_IDS = Object.keys(HABITS);

export const DIMS = [
  accuracyDim,
  efficiencyDim('First-answer efficiency (1 / answers)'),
  firstMoveDim('Time to first answer', 15000),
  tagDim('order', 'Box order errors (reversed, dropped, start row)', ['err-reversed', 'err-dropped', 'err-original']),
  tagDim('inverse', 'Inverse errors', ['err-inverse', 'err-hidden-inverse', 'err-hidden-undo-forward']),
  tagDim('hidden', 'Hidden box reasoning', ['err-hidden-direct', 'err-hidden-skip-before', 'err-hidden-skip-after']),
  tagDim('rushed', 'Rushed or guessed answers', ['rushed', 'guess-retry']),
];
