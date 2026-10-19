// Grid Memory review adapter (pure). Generated trials rebuild from their id (trialFromId); pool
// trials from the set file. Efficiency here is points earned / points possible, so a trial is
// counted correct only when recall is perfect and at most one side answer was wrong.

import { SET_CONFIGS, trialFromId } from './gen.js';
import { coachTrial, reviewAttempt, HABITS } from './coach.js';
import { explainTrial, describePath, pathChunks, divergenceText, questionText, sideReason, answerWord } from './explain.js';
import { POINTS, cellRC, cellLabel, replayLog, analyzeRecall, correctAnswer } from './state.js';
import { firstDivergence } from '../../core/dvs.js';
import { checksumOf, fixIds, splitVariant } from '../../core/learn-util.js';
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
  // A practice repeat of a shipped puzzle ('<id>~r<k>') rebuilds from its base.
  const base = splitVariant(ref.pid).base;
  const p = setData?.puzzles?.find((x) => x.id === base);
  return p ? { ...p, id: ref.pid } : null;
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

// Did vs should. Codes: ans / opt list the cells as row+column digits (1-based, e.g. "13" is row 1,
// column 3) joined by '.', so formatCode can read them without the puzzle. Rows are the positions
// then one row per side question ("Side 2: yes").
const cellCode = (n, cell) => {
  const { r, c } = cellRC(n, cell);
  return `${r + 1}${c + 1}`;
};

// Readable form of a code from this adapter: "13.32" -> "(1,3), (3,2)".
export function formatCode(code) {
  const s = String(code ?? '');
  if (!s) return 'nothing';
  return s.split('.').map((t) => (/^\d\d$/.test(t) ? `(${t[0]},${t[1]})` : t)).join(', ');
}

const KIND_LABEL = { order: 'Position error', wrong: 'Content error' };

export function didVsShould(attempt, puzzle) {
  const empty = { rows: [], div: -1, note: 'There is nothing to compare for this trial.', ans: '', opt: '', lat: 0 };
  if (!attempt || !puzzle || !Array.isArray(puzzle.sequence)) return empty;
  const events = Array.isArray(attempt.events) ? attempt.events : [];
  const lastT = events.length ? events[events.length - 1].t : null;
  const base = Number.isFinite(attempt.startedAt) ? attempt.startedAt : events[0]?.t;
  const elapsed = (t) => (Number.isFinite(t) && Number.isFinite(base) ? Math.max(0, Math.round(t - base)) : Math.round(attempt.metrics?.totalMs ?? 0));
  const n = puzzle.n;
  const sides = puzzle.distractors ?? [];
  if (!events.length && attempt.outcome === 'solved') {
    return { ...empty, note: 'The event log was not kept for this attempt, so the steps cannot be compared.', ans: '', opt: puzzle.sequence.map((c) => cellCode(n, c)).join('.'), lat: elapsed(null) };
  }

  const log = replayLog(puzzle, events);
  const analysis = analyzeRecall(puzzle.sequence, log.recall, log.hinted);
  const posRows = analysis.positions.map((p) => ({
    did: p.got === null ? '' : `${cellLabel(n, p.got)}${p.status === 'hint' ? ' (hint)' : ''}`,
    should: cellLabel(n, p.expected),
    ok: p.status === 'ok',
  }));
  const sideRows = sides.map((d, i) => {
    const a = log.answers[i];
    return {
      did: a ? `Side ${i + 1}: ${answerWord(a.answer).toLowerCase()}` : '',
      should: `Side ${i + 1}: ${answerWord(correctAnswer(d)).toLowerCase()}`,
      ok: !!a?.ok,
    };
  });
  const rows = [...posRows, ...sideRows];
  const div = firstDivergence(rows);

  const parts = [];
  if (analysis.firstError !== null) {
    const p = analysis.positions[analysis.firstError];
    const kind = KIND_LABEL[p.status];
    parts.push(kind ? `${kind}. ${divergenceText(n, analysis)}` : divergenceText(n, analysis));
  }
  const badSide = sides.findIndex((_, i) => !log.answers[i]?.ok && log.answers[i]);
  if (badSide >= 0) {
    const d = sides[badSide];
    const a = log.answers[badSide];
    parts.push(`Side question ${badSide + 1} (${questionText(d)}): you said ${answerWord(a.answer).toLowerCase()}, the answer was ${answerWord(correctAnswer(d)).toLowerCase()}. ${sideReason(d)}`);
  }
  if (!parts.length) {
    parts.push(`You recalled all ${analysis.total} positions in order${sides.length ? ' and got every side question right' : ''}.`);
  }

  // Time of the action at the divergence: the tap for that position, the answer for a side row.
  let at = null;
  if (div >= 0 && div < posRows.length) at = posRows[div].did === '' ? lastT : log.tapTimes[div] ?? lastT;
  else if (div >= 0) at = log.answers[div - posRows.length]?.t ?? lastT;
  else at = lastT;

  return {
    rows,
    div,
    note: parts.join(' '),
    ans: log.recall.slice(0, puzzle.length).map((c) => cellCode(n, c)).join('.'),
    opt: puzzle.sequence.map((c) => cellCode(n, c)).join('.'),
    lat: at === null ? elapsed(null) : elapsed(at),
  };
}

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
