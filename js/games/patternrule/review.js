// Pattern Rule review adapter (pure). Generated puzzles rebuild from the seed in their id. Run
// variants are reshuffles drawn from the run's random stream, so they cannot be rebuilt from a seed
// alone; they store the permutation of the base puzzle's panels (a few small integers) instead.

import { SET_CONFIGS, generateFresh } from './gen.js';
import { coachPuzzle, HABITS } from './coach.js';
import { explainPuzzle } from './explain.js';
import { letter, attemptPicks } from './state.js';
import { panelKey, atom } from './rules.js';
import { checksumOf, seedFromId, splitVariant, fixIds } from '../../core/learn-util.js';
import { accuracyDim, firstMoveDim, tagDim } from '../../core/dims.js';

export const GAME_ID = 'patternrule';
export const GENERATOR_VERSION = 1;
const DIMS_ALL = ['count', 'type', 'fill', 'direction', 'size', 'position', 'symmetry', 'relation'];

const paceSec = (set) => SET_CONFIGS.find((c) => c.set === set)?.paceSec ?? 30;

export function checksum(p) {
  return checksumOf({ rule: p.rule, answer: p.answer, fits: p.fits.map(panelKey), counters: p.counters.map(panelKey), candidates: p.candidates.map(panelKey) });
}

function kindOf(pid) {
  if (pid.includes('~')) return 'variant';
  if (seedFromId(pid) !== null) return 'generated';
  return 'pool';
}

// Indices into `from` matching each panel of `to` by panel key (each source panel used once).
function permutation(from, to) {
  const used = new Set();
  const out = [];
  for (const panel of to) {
    const key = panelKey(panel);
    const i = from.findIndex((x, j) => !used.has(j) && panelKey(x) === key);
    if (i < 0) return null;
    used.add(i);
    out.push(i);
  }
  return out;
}

// perm for a variant given its base puzzle: { f, c, k } index lists.
export function variantPerm(base, variant) {
  const f = permutation(base.fits, variant.fits);
  const c = permutation(base.counters, variant.counters);
  const k = permutation(base.candidates, variant.candidates);
  return f && c && k ? { f, c, k } : null;
}

export function applyPerm(base, perm, id) {
  const key = new Set(base.answer);
  return {
    ...base,
    id,
    variantOf: base.id,
    fits: perm.f.map((i) => base.fits[i]),
    counters: perm.c.map((i) => base.counters[i]),
    candidates: perm.k.map((i) => base.candidates[i]),
    violates: perm.k.map((i) => base.violates[i]),
    answer: perm.k.map((i, j) => (key.has(i) ? j : -1)).filter((j) => j >= 0),
  };
}

// base: the pool puzzle a variant came from (needed to record its permutation).
export function refFor(attempt, puzzle = null, { base = null } = {}) {
  const pid = attempt.puzzleId;
  const src = kindOf(pid);
  const ref = { pid, set: attempt.set, src, gv: GENERATOR_VERSION };
  if (src === 'generated') ref.seed = seedFromId(pid);
  if (puzzle) {
    ref.check = checksum(puzzle);
    if (src === 'variant' && base) {
      const perm = variantPerm(base, puzzle);
      if (perm) ref.perm = perm;
    }
  }
  return ref;
}

export const needsSet = (ref) => ref.src !== 'generated';
export const slowRebuild = () => false;

export function regenerate(ref, setData = null) {
  if (ref.src === 'generated') {
    try {
      return Number.isFinite(ref.seed) ? generateFresh(ref.set, ref.seed) : null;
    } catch {
      return null;
    }
  }
  const { base } = splitVariant(ref.pid);
  const p = setData?.puzzles?.find((x) => x.id === base);
  if (!p) return null;
  if (ref.src !== 'variant') return p;
  return ref.perm ? applyPerm(p, ref.perm, ref.pid) : null;
}

export function tagsFor(attempt, puzzle) {
  return fixIds(coachPuzzle(attempt, puzzle, { paceSec: paceSec(attempt.set) }).findings);
}

export function features(p) {
  const atoms = p.rule.map((id) => atom(id));
  const out = [p.rule.length > 1 ? 'two-part rule' : 'single rule'];
  for (const a of atoms) out.push(`${a.dim} rule`);
  out.push(`${p.answer.length} ${p.answer.length === 1 ? 'answer' : 'answers'} to find`);
  if (p.distractor) out.push('with a distractor feature');
  return [...new Set(out)];
}

export function userPath(attempt, puzzle) {
  const key = new Set(puzzle.answer);
  const out = [];
  for (const ev of attempt.events ?? []) {
    if (ev.type !== 'move' || !Number.isInteger(ev.p)) continue;
    const on = ev.d !== 'off';
    const ok = on ? key.has(ev.p) : !key.has(ev.p);
    out.push({ text: `${on ? 'Picked' : 'Unpicked'} ${letter(ev.p)}${ok ? '' : on ? ' (does not fit)' : ' (it fits)'}`, ok, t: ev.t });
  }
  const picks = new Set(attemptPicks(attempt));
  const missed = puzzle.answer.filter((i) => !picks.has(i));
  if (missed.length && attempt.outcome !== 'timeout') out.push({ text: `Missed ${missed.map(letter).join(', ')}`, ok: false, t: null });
  return out;
}

export function divergence(attempt, puzzle) {
  const path = userPath(attempt, puzzle);
  const i = path.findIndex((s) => s.ok === false);
  if (i < 0) return null;
  const ex = explainPuzzle(puzzle);
  return { index: i, text: `${path[i].text}. The rule: ${ex.rule}.` };
}

export function optimalSteps(puzzle) {
  const ex = explainPuzzle(puzzle);
  return [...ex.steps, ...ex.verdicts.map((v) => `${v.letter}: ${v.summary}`)];
}

export const timeOf = (a) => a.metrics?.totalMs ?? 0;
export const parMs = (a) => paceSec(a.set) * 1000;
export const tagLabel = (id) => HABITS[id]?.label ?? id;
export const TAG_IDS = Object.keys(HABITS);

export const DIMS = [
  accuracyDim,
  firstMoveDim('Time to first pick', 15000),
  tagDim('false', 'False picks (chose a panel that breaks the rule)', ['false-pick']),
  tagDim('miss', 'Missed fitting panels', ['miss']),
  tagDim('overlooked', 'Overlooked a rule dimension', DIMS_ALL.map((d) => `overlooked-${d}`)),
  tagDim('surface', 'Fooled by a surface feature', DIMS_ALL.map((d) => `surface-${d}`)),
];
