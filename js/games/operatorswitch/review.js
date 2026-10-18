// Operator Switch review adapter (pure). Generated puzzles rebuild from the seed in their id.

import { SET_CONFIGS, generateFresh } from './gen.js';
import { coachPuzzle, readLog, errorFor, HABITS } from './coach.js';
import { explainPuzzle, optionText } from './explain.js';
import { boxCount } from './state.js';
import { checksumOf, seedFromId, fixIds } from '../../core/learn-util.js';
import { firstDivergence } from '../../core/dvs.js';
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

// ---------------------------------------------------------------- did vs should

// Codes: option letters (A = option 1). ans = the options picked, in order ('BA' = a wrong B, then A);
// opt = the correct option. Built from the puzzle answer and the logged picks only.
const letter = (i) => LETTERS[i] ?? String(i + 1);
const optText = (puzzle, i) => `option ${letter(i)}: ${optionText(puzzle, i)}`;
// The coach's one-line rule for the puzzle: the slot 1 trace, or the last worked step for hidden boxes.
function ruleLine(puzzle) {
  const ex = explainPuzzle(puzzle);
  return ex.trace?.text ?? ex.steps.at(-1)?.text ?? '';
}

// Readable text for an ans / opt code from didVsShould.
export function formatCode(code) {
  const s = String(code ?? '');
  if (!s) return 'nothing';
  if (!/^[A-H]+$/.test(s)) return s;
  return [...s].map((c) => `option ${c}`).join(', ');
}

// Did vs should for one attempt: each logged pick next to the correct option, the first wrong pick
// as the divergence, and the rule behind the right answer. Safe on skipped attempts and pruned events.
export function didVsShould(attempt, puzzle) {
  const events = Array.isArray(attempt?.events) ? attempt.events : [];
  const correct = puzzle.answer;
  const endT = events.length ? events[events.length - 1].t : null;
  const totalMs = Math.round(Number.isFinite(endT) ? endT : (attempt?.metrics?.totalMs ?? 0));
  const opt = letter(correct);
  const why = ruleLine(puzzle);

  // Pruned attempts keep their metrics but not their picks.
  if (!events.length && (attempt?.metrics?.grossMoves ?? 0) > 0) {
    return {
      rows: [], div: -1, ans: attempt.outcome === 'solved' ? opt : '', opt, lat: totalMs,
      note: `The steps for this attempt were not kept, so there is no step-by-step comparison. The right answer was ${optText(puzzle, correct)}. ${why}`.trim(),
    };
  }

  const picks = readLog(puzzle, events).answers;
  const rows = picks.map((a) => ({ did: optText(puzzle, a.p), should: optText(puzzle, correct), ok: a.p === correct }));
  if (!picks.some((a) => a.p === correct)) rows.push({ did: '', should: optText(puzzle, correct), ok: false });
  const div = firstDivergence(rows);
  const lat = div >= 0 && div < picks.length ? Math.round(picks[div].t) : totalMs;

  let note;
  if (div < 0) {
    note = `You picked the right answer first time: ${optText(puzzle, correct)}. ${why}`;
  } else if (div < picks.length) {
    const wrong = picks[div].p;
    const found = picks.some((a) => a.p === correct);
    note = `Pick ${div + 1}, ${optText(puzzle, wrong)}, is wrong: ${errorFor(puzzle, wrong).text}. `
      + `The right answer was ${optText(puzzle, correct)}. ${why}`
      + (found ? ` You needed ${picks.length} answers.` : ' You never found it.');
  } else {
    note = `You gave no answer (skipped or out of time). The right answer was ${optText(puzzle, correct)}. ${why}`;
  }
  return {
    rows, div, note: note.trim(), lat,
    ans: picks.map((a) => letter(a.p)).join(''),
    opt,
  };
}
