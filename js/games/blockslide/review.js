// Block Slide review adapter (pure): seed reference and regeneration, checksum, coach tags,
// puzzle features, user path vs the optimal line, and report dimensions.

import { configFor, blockMoveCount } from './gen.js';
import { transformPuzzle, generateFresh } from './stream.js';
import { coachPuzzle, replayLog, HABITS } from './coach.js';
import { explainSolution, moveText } from './explain.js';
import { checksumOf, seedFromId, splitVariant, fixIds, makeBlob, readBlob } from '../../core/learn-util.js';
import { accuracyDim, efficiencyDim, firstMoveDim, tagDim, metricMeanDim } from '../../core/dims.js';

export const GAME_ID = 'blockslide';
export const GENERATOR_VERSION = 1;
// Fresh puzzles in sets 4 and 5 take seconds to rebuild, so they also keep a compact encoding.
const SLOW_SETS = 4;

const paceMs = (set) => (configFor(set)?.paceSec ?? 30) * 1000;

export function checksum(p) {
  return checksumOf({ n: p.n, exit: p.exit, walls: p.walls ?? [], ball: p.ball, blocks: p.blocks, optimal: p.optimal });
}

function kindOf(pid) {
  if (pid.includes('~')) return 'variant';
  if (seedFromId(pid) !== null) return 'generated';
  return 'pool';
}

export function refFor(attempt, puzzle = null) {
  const pid = attempt.puzzleId;
  const src = kindOf(pid);
  const ref = { pid, set: attempt.set, src, gv: GENERATOR_VERSION };
  if (src === 'variant') ref.v = splitVariant(pid).tag;
  if (src === 'generated') ref.seed = seedFromId(pid);
  if (puzzle) {
    ref.check = checksum(puzzle);
    if (src === 'generated' && attempt.set >= SLOW_SETS) {
      const blob = makeBlob({ n: puzzle.n, exit: puzzle.exit, walls: puzzle.walls ?? [], ball: puzzle.ball, blocks: puzzle.blocks, optimal: puzzle.optimal, solution: puzzle.solution });
      if (blob) ref.blob = blob;
    }
  }
  return ref;
}

export const needsSet = (ref) => !ref.blob && ref.src !== 'generated';
// Rebuilding is too slow for the page without a blob.
export const slowRebuild = (ref) => !ref.blob && ref.src === 'generated' && ref.set >= SLOW_SETS;

export function regenerate(ref, setData = null) {
  if (ref.blob) {
    const b = readBlob(ref.blob);
    return b ? { id: ref.pid, ...b } : null;
  }
  if (ref.src === 'generated') return ref.seed === null || ref.seed === undefined ? null : generateFresh(ref.set, ref.seed);
  const { base, tag } = splitVariant(ref.pid);
  const p = setData?.puzzles?.find((x) => x.id === base);
  if (!p) return null;
  return tag ? transformPuzzle(p, tag) : p;
}

export function tagsFor(attempt, puzzle) {
  return fixIds(coachPuzzle(attempt, puzzle, { paceSec: configFor(attempt.set)?.paceSec ?? 30 }).findings);
}

export function features(p) {
  const opt = p.optimal ?? 0;
  return [
    `${p.n}x${p.n} grid`,
    `${p.blocks.length} blocks`,
    (p.walls ?? []).length ? 'with walls' : 'no walls',
    opt <= 5 ? 'short line (5 or fewer)' : opt <= 9 ? 'medium line (6 to 9)' : 'long line (10 or more)',
    `${blockMoveCount(p.solution ?? [])} block moves needed`,
  ];
}

// Your moves in order, each marked on or off an optimal line, with undone moves flagged.
export function userPath(attempt, puzzle) {
  const rep = replayLog(puzzle, attempt.events ?? []);
  return rep.moves.map((m) => ({ text: `${moveText(m)}${m.undone ? ' (undone)' : ''}`, ok: m.onPath ?? null, t: m.t }));
}

export function divergence(attempt, puzzle) {
  const res = coachPuzzle(attempt, puzzle, { paceSec: configFor(attempt.set)?.paceSec ?? 30 });
  const f = res.findings.find((x) => x.id === 'divergence');
  return f ? { index: Math.max(0, (f.data.move ?? 1) - 1), text: f.detail } : null;
}

export const optimalSteps = (puzzle) => explainSolution(puzzle).steps.map((s) => s.text);
export const timeOf = (a) => a.metrics?.totalMs ?? 0;
export const parMs = (a) => paceMs(a.set);
export const tagLabel = (id) => HABITS[id]?.label ?? id;
export const TAG_IDS = Object.keys(HABITS);

export const DIMS = [
  accuracyDim,
  efficiencyDim('Move efficiency (optimal / yours)'),
  firstMoveDim('Planning depth: first move time', 8000),
  tagDim('wasted', 'Extra moves (share of attempts)', ['wasted']),
  tagDim('backtracks', 'Backtracks: oscillation, undo, reset', ['oscillation', 'undo', 'reset']),
  tagDim('premature', 'Ball moved before the lane was open', ['premature-ball']),
  metricMeanDim('undos', 'Undos per attempt', (a) => a.metrics?.undos ?? 0, 0.5),
];
