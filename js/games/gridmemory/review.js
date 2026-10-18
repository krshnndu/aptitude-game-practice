// Grid Memory review adapter (pure). Generated trials rebuild from their id (trialFromId); pool
// trials from the set file. Efficiency here is points earned / points possible, so a trial is
// counted correct only when recall is perfect and at most one side answer was wrong.

import { SET_CONFIGS, trialFromId } from './gen.js';
import { coachTrial, reviewAttempt, HABITS } from './coach.js';
import { explainTrial, describePath, pathChunks } from './explain.js';
import { POINTS } from './state.js';
import { checksumOf, fixIds } from '../../core/learn-util.js';
import { accuracyDim, efficiencyDim, tagDim } from '../../core/dims.js';

export const GAME_ID = 'gridmemory';
export const GENERATOR_VERSION = 1;
const PER_POSITION_PAR_MS = 1500;

export function checksum(p) {
  return checksumOf({ n: p.n, sequence: p.sequence, answers: (p.distractors ?? []).map((d) => d.answer) });
}

// Span of an attempt: points possible / points per position (recall + side).
export const spanOf = (a) => Math.max(1, Math.round((a.moves ?? a.metrics?.moves ?? 0) / (POINTS.recall + POINTS.side)));
export const correct = (a) => a.outcome === 'solved' && (a.moves ?? 0) - (a.optimal ?? 0) <= POINTS.side;

export function refFor(attempt, puzzle = null) {
  const pid = attempt.puzzleId;
  const generated = /^gm\d-g[0-9a-z]+-\d+$/.test(pid);
  const ref = { pid, set: attempt.set, src: generated ? 'generated' : 'pool', gv: GENERATOR_VERSION };
  if (puzzle) ref.check = checksum(puzzle);
  return ref;
}

export const needsSet = (ref) => ref.src !== 'generated';
export const slowRebuild = () => false;

export function regenerate(ref, setData = null) {
  if (ref.src === 'generated') return trialFromId(ref.pid);
  return setData?.puzzles?.find((x) => x.id === ref.pid) ?? null;
}

export function tagsFor(attempt, puzzle) {
  return fixIds(coachTrial(attempt, puzzle).findings);
}

export function features(p) {
  const kinds = new Set((p.distractors ?? []).map((d) => d.kind));
  const lines = pathChunks(p.n, p.sequence).filter((c) => c.kind === 'line').length;
  return [
    `${p.n}x${p.n} grid`,
    `span ${p.length}`,
    kinds.size > 1 ? 'mixed side questions' : kinds.has('parity') ? 'sum parity side questions' : 'symmetry side questions',
    lines ? 'path has a straight run' : 'no straight runs',
  ];
}

export function userPath(attempt, puzzle) {
  const r = reviewAttempt(attempt, puzzle);
  const ex = explainTrial(puzzle, r.result, r.log.answers);
  return ex.positions.map((p, i) => ({
    text: `Position ${i + 1}: ${p.got === null ? 'left empty' : `you chose ${p.gotLabel}`}${p.status === 'ok' ? '' : `, it was ${p.expectedLabel} (${p.text})`}`,
    ok: p.status === 'ok',
  }));
}

export function divergence(attempt, puzzle) {
  const r = reviewAttempt(attempt, puzzle);
  const k = r.result.recall?.firstError;
  if (k === null || k === undefined) return null;
  return { index: k, text: explainTrial(puzzle, r.result, r.log.answers).divergence };
}

export const optimalSteps = (puzzle) => describePath(puzzle.n, puzzle.sequence).steps.map((s) => s.text);

// Recall time: from the recall grid appearing to the closing event (presentation is paced by the game).
export function timeOf(a) {
  const evs = a.events ?? [];
  const start = evs.find((e) => e.type === 'select' && e.d === 'recall');
  if (!start || !evs.length) return a.metrics?.totalMs ?? 0;
  return Math.max(0, evs[evs.length - 1].t - start.t);
}
export const parMs = (a) => PER_POSITION_PAR_MS * spanOf(a);
export const tagLabel = (id) => HABITS[id]?.label ?? id;
export const TAG_IDS = Object.keys(HABITS);
export const paceSec = (set) => {
  const cfg = SET_CONFIGS.find((c) => c.set === set);
  return cfg ? Math.round((cfg.lengths[1] * PER_POSITION_PAR_MS) / 1000) : 6;
};

export const DIMS = [
  { ...accuracyDim, label: 'Perfect trials (all positions, at most 1 side slip)', value: (as) => (as.length ? as.filter(correct).length / as.length : null) },
  efficiencyDim('Points efficiency'),
  { key: 'span', label: 'Span: longest perfect trial', fmt: 'num', better: 'high', target: 6, value: (as) => { const ok = as.filter(correct).map(spanOf); return ok.length ? Math.max(...ok) : null; } },
  tagDim('order', 'Position errors (right cell, wrong order)', ['order-errors']),
  tagDim('location', 'Content errors (cell never lit)', ['location-errors']),
  tagDim('side', 'Side task dropped or guessed', ['side-dropped', 'side-timeout', 'side-guess']),
];
