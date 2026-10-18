// Latin Square review adapter (pure). Variants of a timed run are rebuilt from the run seed; when
// the run was never saved (abandoned), a compact encoding of the puzzle is kept instead.

import { SET_CONFIGS } from './gen.js';
import { generateFresh, variantPuzzle, freshSeed } from './stream.js';
import { coachPuzzle, readPicks, HABITS } from './coach.js';
import { analyse, explainPuzzle, symName } from './explain.js';
import { cellLabel } from './state.js';
import { checksumOf, seedFromId, splitVariant, fixIds, makeBlob, readBlob } from '../../core/learn-util.js';
import { accuracyDim, efficiencyDim, firstMoveDim, tagDim } from '../../core/dims.js';

export const GAME_ID = 'latinsquare';
export const GENERATOR_VERSION = 1;
const VARIANT_SALT = 0x51ed27;

const paceSec = (set) => SET_CONFIGS.find((c) => c.set === set)?.paceSec ?? 20;

export function checksum(p) {
  return checksumOf({ n: p.n, rows: p.rows, targets: p.targets, answers: p.answers });
}

function kindOf(pid) {
  if (pid.includes('~')) return 'variant';
  if (seedFromId(pid) !== null) return 'generated';
  return 'pool';
}

const blobOf = (p) => makeBlob({ n: p.n, symbols: p.symbols, rows: p.rows, targets: p.targets, answers: p.answers, depth: p.depth, targetDepths: p.targetDepths, blanks: p.blanks, steps: p.steps });

export function refFor(attempt, puzzle = null, { run = null } = {}) {
  const pid = attempt.puzzleId;
  const src = kindOf(pid);
  const ref = { pid, set: attempt.set, src, gv: GENERATOR_VERSION };
  if (src === 'generated') ref.seed = seedFromId(pid);
  if (src === 'variant') {
    ref.v = Number(/^v(\d+)$/.exec(splitVariant(pid).tag)?.[1] ?? NaN);
    if (run && Number.isFinite(run.seed)) ref.seed = run.seed;
  }
  if (puzzle) {
    ref.check = checksum(puzzle);
    if (src === 'variant' && !Number.isFinite(ref.seed)) {
      const blob = blobOf(puzzle);
      if (blob) ref.blob = blob;
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
  if (ref.src !== 'variant') return p;
  if (!Number.isFinite(ref.seed) || !Number.isFinite(ref.v)) return null;
  return variantPuzzle(p, freshSeed(ref.seed ^ VARIANT_SALT, ref.v), `v${ref.v}`);
}

export function tagsFor(attempt, puzzle) {
  return fixIds(coachPuzzle(attempt, puzzle, { paceSec: paceSec(attempt.set) }).findings);
}

export function features(p) {
  const ex = explainPuzzle(p);
  const rules = new Set(ex.steps.map((s) => s.rule));
  const helpers = ex.steps.filter((s) => !s.isTarget).length;
  return [
    `${p.n}x${p.n} grid`,
    `${p.targets.length} ${p.targets.length === 1 ? 'target' : 'targets'}`,
    p.depth <= 1 ? 'direct (no chain)' : `chain depth ${p.depth}`,
    helpers ? `${helpers} helper ${helpers === 1 ? 'cell' : 'cells'}` : 'no helper cells',
    rules.has('hidden-row') || rules.has('hidden-col') ? 'needs a hidden single' : 'naked singles only',
  ];
}

export function userPath(attempt, puzzle) {
  const A = analyse(puzzle);
  return readPicks(attempt, A).map((k) => ({
    text: `Picked ${symName(A.P, k.sym)} for ${cellLabel(A.P.n, k.cell)}${k.ok ? '' : ` (wrong${k.reason?.text ? `: ${k.reason.text}` : ''})`}`,
    ok: k.ok,
    t: k.t,
  }));
}

export function divergence(attempt, puzzle) {
  const A = analyse(puzzle);
  const picks = readPicks(attempt, A);
  const i = picks.findIndex((k) => !k.ok);
  if (i < 0) return null;
  const k = picks[i];
  return { index: i, text: `Pick ${i + 1}: ${symName(A.P, k.sym)} at ${cellLabel(A.P.n, k.cell)} was wrong. ${k.reason?.text ?? ''}`.trim() };
}

export const optimalSteps = (puzzle) => explainPuzzle(puzzle).steps.map((s) => s.text);
export const timeOf = (a) => a.metrics?.totalMs ?? 0;
export const parMs = (a) => paceSec(a.set) * 1000;
// Coach findings that are tagged but not in the habit catalogue.
const EXTRA_TAGS = { 'helper-miss': 'Helper cells not checked' };
export const tagLabel = (id) => HABITS[id]?.label ?? EXTRA_TAGS[id] ?? id;
export const TAG_IDS = [...Object.keys(HABITS), ...Object.keys(EXTRA_TAGS)];

export const DIMS = [
  accuracyDim,
  efficiencyDim('Pick efficiency (targets / picks)'),
  firstMoveDim('First pick time', 10000),
  tagDim('rowcol', 'Row or column duplicate picks', ['missed-row', 'missed-col']),
  tagDim('chain', 'Chain misses (helper cells)', ['missed-chain', 'helper-miss']),
  tagDim('guess', 'Fast guesses', ['guess']),
];
