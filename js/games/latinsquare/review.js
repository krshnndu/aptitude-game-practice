// Latin Square review adapter (pure). Variants of a timed run are rebuilt from the run seed; when
// the run was never saved (abandoned), a compact encoding of the puzzle is kept instead.

import { SET_CONFIGS } from './gen.js';
import { generateFresh, variantPuzzle, freshSeed } from './stream.js';
import { coachPuzzle, readPicks, HABITS } from './coach.js';
import { analyse, explainPuzzle, symName } from './explain.js';
import { cellLabel, SYMBOLS } from './state.js';
import { checksumOf, seedFromId, splitVariant, fixIds, makeBlob, readBlob } from '../../core/learn-util.js';
import { accuracyDim, efficiencyDim, firstMoveDim, tagDim } from '../../core/dims.js';
import { alignRows, firstDivergence, cleanCode } from '../../core/dvs.js';

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

// Did vs should. rows: one per target cell in target order, did = the first symbol entered there
// (with any retries after it), should = the stored answer. ans / opt: one letter per target (the
// symbol letter, '.' for no entry), e.g. "HH" for two hearts. lat: ms of the first wrong entry, or the
// last event's time when every answer matched (or the attempt had no entry there).
export function didVsShould(attempt, puzzle) {
  const A = analyse(puzzle);
  const { P } = A;
  const ex = explainPuzzle(puzzle, A);
  const picks = readPicks(attempt ?? { events: [] }, A);
  const firstAt = P.targets.map((_, t) => picks.find((k) => k.target === t) ?? null);
  const cellSym = (cell, sym) => ({ cell, sym });
  const didList = firstAt.map((k, t) => (k ? cellSym(P.targets[t], k.sym) : null));
  const shouldList = P.targets.map((cell, t) => cellSym(cell, P.answers[t]));
  const text = (x) => (x ? `${cellLabel(P.n, x.cell)} ${symName(P, x.sym)}` : '');
  const rows = alignRows(didList, shouldList, (a, b) => !!a && a.sym === b.sym, text);
  const div = firstDivergence(rows);
  const ans = cleanCode(firstAt.map((k) => (k ? P.symbols[k.sym].letter : '.')).join(''));
  const opt = cleanCode(P.answers.map((v) => P.symbols[v].letter).join(''));
  const events = Array.isArray(attempt?.events) ? attempt.events : [];
  const endMs = events.length ? events[events.length - 1].t : (attempt?.metrics?.totalMs ?? 0);
  const lat = div >= 0 && firstAt[div] ? firstAt[div].t : endMs;
  let note;
  if (div < 0) {
    note = `Every answer matched the deduction. ${ex.summary}`;
  } else {
    const k = firstAt[div];
    const cell = P.targets[div];
    const should = symName(P, P.answers[div]);
    const wrong = rows.filter((r) => r.ok === false).length;
    const first = k
      ? `At ${cellLabel(P.n, cell)} you entered ${symName(P, k.sym)}, but the answer is ${should}.`
      : `You gave no answer at ${cellLabel(P.n, cell)}; the answer is ${should}.`;
    const step = ex.steps.find((s) => s.cell === cell);
    const why = step ? step.text : (k?.reason?.text ?? '');
    note = [first, why, wrong > 1 ? `${wrong - 1} other ${wrong - 1 === 1 ? 'answer was' : 'answers were'} also off.` : ''].filter(Boolean).join(' ');
  }
  return { rows, div, note, ans, opt, lat: Math.round(lat) };
}

// Readable text for an ans / opt code from didVsShould (letters are symbol letters, '.' is none).
export function formatCode(code) {
  const names = Object.fromEntries([...SYMBOLS.map((s) => [s.letter, s.name]), ['.', 'nothing']]);
  return [...String(code ?? '')].map((ch) => names[ch] ?? ch).join(', ');
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
