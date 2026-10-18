// Pattern Rule review adapter (pure). Generated puzzles rebuild from the seed in their id. Run
// variants are reshuffles drawn from the run's random stream, so they cannot be rebuilt from a seed
// alone; they store the permutation of the base puzzle's panels (a few small integers) instead.

import { SET_CONFIGS, generateFresh } from './gen.js';
import { coachPuzzle, HABITS } from './coach.js';
import { explainPuzzle } from './explain.js';
import { letter, attemptPicks, attemptResult } from './state.js';
import { panelKey, atom, listAnd } from './rules.js';
import { checksumOf, seedFromId, splitVariant, fixIds } from '../../core/learn-util.js';
import { accuracyDim, firstMoveDim, tagDim } from '../../core/dims.js';
import { cleanCode, firstDivergence } from '../../core/dvs.js';

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

// Did vs should, per candidate: picked or not against fits or not. ans / opt are the picked and the
// fitting candidate letters in order (e.g. "BD"). lat: ms of the last action on the first wrong
// candidate, or the last event time when every candidate is right (0 with no events).
export function didVsShould(attempt, puzzle) {
  const ex = explainPuzzle(puzzle);
  const events = Array.isArray(attempt?.events) ? attempt.events : [];
  const result = attemptResult(attempt ?? {});
  // Without events the picks are unknown: a correct result implies the fitting set was picked.
  const picks = events.length ? attemptPicks(attempt) : result === 'correct' ? puzzle.answer.slice().sort((a, b) => a - b) : [];
  const chosen = new Set(picks);
  const key = new Set(puzzle.answer);
  const rows = puzzle.candidates.map((_, i) => {
    const picked = chosen.has(i), fits = key.has(i);
    return { did: `${picked ? 'Picked' : 'Left out'} ${letter(i)}`, should: `${letter(i)} ${fits ? 'fits' : 'does not fit'}`, ok: picked === fits };
  });
  const div = firstDivergence(rows);
  const lastT = events.length ? Math.max(0, Math.round(Number(events[events.length - 1].t) || 0)) : 0;
  let lat = lastT;
  if (div >= 0) {
    const touches = events.filter((e) => e.type === 'move' && e.p === div);
    if (touches.length) lat = Math.max(0, Math.round(Number(touches[touches.length - 1].t) || 0));
  }
  const rule = /[.!?]$/.test(ex.rule) ? ex.rule : `${ex.rule}.`;
  const L = div >= 0 ? letter(div) : '';
  let note;
  if (div < 0) {
    note = `Matched: ${listAnd(puzzle.answer.map(letter))} ${puzzle.answer.length === 1 ? 'is the only candidate that fits' : 'are exactly the candidates that fit'}. The rule: ${rule}`;
  } else if (!events.length) {
    note = `No picks were recorded. ${listAnd(puzzle.answer.map(letter))} ${puzzle.answer.length === 1 ? 'fits' : 'fit'}. The rule: ${rule}`;
  } else {
    const v = ex.verdicts[div];
    const fits = key.has(div);
    const reasons = (fits ? v.parts : v.parts.filter((p) => !p.holds)).map((p) => p.text);
    note = `You ${chosen.has(div) ? 'picked' : 'left out'} ${L}, which ${fits ? 'fits' : 'does not fit'}: ${listAnd(reasons)}. The rule: ${rule}`;
  }
  return {
    rows,
    div,
    note,
    ans: cleanCode(picks.map(letter).join('')),
    opt: cleanCode(puzzle.answer.slice().sort((a, b) => a - b).map(letter).join('')),
    lat,
  };
}

// Readable text for an ans / opt code from didVsShould ("BD" -> "candidates B and D").
export function formatCode(code) {
  const s = String(code ?? '');
  if (!s) return 'nothing';
  if (/^[A-Z]+$/.test(s)) return s.length === 1 ? `candidate ${s}` : `candidates ${listAnd(s.split(''))}`;
  return s;
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
