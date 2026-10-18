// Pattern Rule: pure game session, grading, hints and the attempt log (no DOM).
//
// Scoring: a puzzle scores 1 when the picked candidates are exactly the fitting ones, else 0
// (skips and time-outs score 0). Efficiency is that score, so the shared unlock rule (70%
// average efficiency) works as in Block Slide.
//
// Attempt records use the core recorder format (js/core/recorder.js):
//   move events are pick toggles: { t, type: 'move', p: candidate index, d: 'on' | 'off' },
//   hint events: { t, type: 'hint' },
//   the closing event carries { result: 'correct'|'wrong'|'skipped'|'timeout', picks: [...] }.
// The core recorder knows no "wrong answer" outcome, so a wrong answer is stored as outcome
// 'skipped' (it scores 0 like a skip) and told apart by the closing event's result field.
// optimal = number of fitting candidates; a correct answer stores moves = optimal (efficiency 1).

import { computeMetrics, newId } from '../../core/recorder.js';
import { atom, atomDimLabel, DIM_NAMES, holds } from './rules.js';

export const GAME_ID = 'patternrule';
export const LETTERS = 'ABCDEF';

export function letter(i) {
  return LETTERS[i] ?? String(i + 1);
}

export function gradeSelection(puzzle, picks) {
  const chosen = new Set(picks);
  const key = new Set(puzzle.answer);
  const all = puzzle.candidates.map((_, i) => i);
  const hits = all.filter((i) => chosen.has(i) && key.has(i));
  const falsePicks = all.filter((i) => chosen.has(i) && !key.has(i));
  const misses = all.filter((i) => !chosen.has(i) && key.has(i));
  const correctRejects = all.filter((i) => !chosen.has(i) && !key.has(i));
  const exact = falsePicks.length === 0 && misses.length === 0;
  return { exact, hits, falsePicks, misses, correctRejects, picks: [...chosen].sort((a, b) => a - b), score: exact ? 1 : 0 };
}

// Dimensions the rule uses, in words: "fill", "fill and direction", "relation (size)".
export function ruleDimsText(rule) {
  const names = [...new Set(rule.map((id) => {
    const a = atom(id);
    return a.dim === 'relation' ? `how the shapes relate (${DIM_NAMES[a.about] ?? a.about})` : DIM_NAMES[a.dim];
  }))];
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// Progressive practice hints. level 0: which dimensions; 1: how many fit; 2+: rule out one
// non-fitting candidate (a picked one first). Returns null when no hint is left.
export function nextHint(puzzle, level, picks = [], ruledOut = []) {
  if (level === 0) {
    return { level, kind: 'dims', text: `The rule is about ${ruleDimsText(puzzle.rule)}. Compare the fitting panels on ${puzzle.rule.length > 1 ? 'those dimensions' : 'that dimension'} first.` };
  }
  if (level === 1) {
    const k = puzzle.answer.length;
    return { level, kind: 'count', text: `${k} of the ${puzzle.candidates.length} candidates ${k === 1 ? 'fits' : 'fit'}.` };
  }
  const key = new Set(puzzle.answer);
  const out = new Set(ruledOut);
  const negatives = puzzle.candidates.map((_, i) => i).filter((i) => !key.has(i) && !out.has(i));
  // Always leave one non-fitting candidate to find yourself.
  if (negatives.length <= 1) return null;
  const picked = negatives.filter((i) => picks.includes(i));
  const i = (picked.length ? picked : negatives)[0];
  const broken = puzzle.violates?.[i]?.length ? puzzle.violates[i] : puzzle.rule.filter((id) => !holds(id, puzzle.candidates[i]));
  const first = broken[0];
  const why = atom(first).why(puzzle.candidates[i]);
  return { level, kind: 'rule-out', candidate: i, text: `Candidate ${letter(i)} does not fit: ${why} (breaks the ${atomDimLabel(first)} part of the rule).` };
}

export function createSession(puzzle, { mode = 'practice' } = {}) {
  const n = puzzle.candidates.length;
  const picked = new Set();
  const toggles = [];
  const ruledOut = [];
  let status = 'playing'; // playing | answered | skipped | timeout
  let result = null;
  let hintLevel = 0;
  let hintsUsed = 0;

  const session = {
    puzzle,
    mode,
    get status() {
      return status;
    },
    get picks() {
      return [...picked].sort((a, b) => a - b);
    },
    get result() {
      return result;
    },
    get toggles() {
      return toggles.slice();
    },
    get hintsUsed() {
      return hintsUsed;
    },
    get ruledOut() {
      return ruledOut.slice();
    },
    isPicked(i) {
      return picked.has(i);
    },
    // Returns true (now picked), false (now unpicked) or null (ignored).
    toggle(i) {
      if (status !== 'playing' || !Number.isInteger(i) || i < 0 || i >= n) return null;
      const on = !picked.has(i);
      if (on) picked.add(i);
      else picked.delete(i);
      toggles.push({ i, on });
      return on;
    },
    // Unpicks everything; returns the indices that were unpicked.
    clear() {
      if (status !== 'playing') return [];
      const was = session.picks;
      for (const i of was) session.toggle(i);
      return was;
    },
    canSubmit() {
      return status === 'playing' && picked.size > 0;
    },
    submit() {
      if (!session.canSubmit()) return null;
      result = gradeSelection(puzzle, session.picks);
      status = 'answered';
      return result;
    },
    skip() {
      if (status !== 'playing') return false;
      result = { ...gradeSelection(puzzle, session.picks), exact: false, score: 0 };
      status = 'skipped';
      return true;
    },
    timeout() {
      if (status !== 'playing') return false;
      result = { ...gradeSelection(puzzle, session.picks), exact: false, score: 0 };
      status = 'timeout';
      return true;
    },
    hint() {
      if (status !== 'playing' || mode !== 'practice') return null;
      const h = nextHint(puzzle, hintLevel, session.picks, ruledOut);
      if (!h) return null;
      hintLevel++;
      hintsUsed++;
      if (h.kind === 'rule-out') ruledOut.push(h.candidate);
      return h;
    },
  };
  return session;
}

// ---------------------------------------------------------------- attempt log

const END_EVENT = { correct: 'solve', wrong: 'skip', skipped: 'skip', timeout: 'timeout' };
const OUTCOME = { correct: 'solved', wrong: 'skipped', skipped: 'skipped', timeout: 'timeout' };

export function createPickLog({ set, puzzleId, mode, runId = null, source = 'pool', optimal, now = () => Date.now() }) {
  const startedAt = now();
  const events = [];
  let done = null;
  const at = () => Math.max(0, Math.round(now() - startedAt));
  const push = (type, extra = {}) => {
    if (done) return false;
    events.push({ t: at(), type, ...extra });
    return true;
  };
  return {
    startedAt,
    get events() {
      return events.slice();
    },
    get ended() {
      return done !== null;
    },
    elapsed: at,
    toggle: (i, on) => push('move', { p: i, d: on ? 'on' : 'off' }),
    hint: () => push('hint'),
    // result: correct | wrong | skipped | timeout
    end(result, { picks = [], hintsUsed = 0 } = {}) {
      if (done) return done;
      if (!END_EVENT[result]) throw new Error(`unknown result ${result}`);
      push(END_EVENT[result], { result, picks: [...picks].sort((a, b) => a - b) });
      const evs = events.slice();
      const outcome = OUTCOME[result];
      const gross = evs.filter((e) => e.type === 'move').length;
      const moves = result === 'correct' ? optimal : gross;
      done = {
        id: newId('a', startedAt),
        game: GAME_ID,
        set,
        puzzleId,
        mode,
        runId,
        source,
        startedAt,
        optimal,
        outcome,
        moves,
        hintsUsed,
        events: evs,
        metrics: computeMetrics(evs, { optimal, moves, outcome }),
      };
      return done;
    },
  };
}

// Picks at the end of an attempt, replayed from the toggle events.
export function replayPicks(events) {
  const on = new Set();
  for (const e of events) {
    if (e.type !== 'move' || !Number.isInteger(e.p)) continue;
    if (e.d === 'off') on.delete(e.p);
    else on.add(e.p);
  }
  return [...on].sort((a, b) => a - b);
}

// correct | wrong | skipped | timeout, from the closing event (falls back to the outcome).
export function attemptResult(attempt) {
  const last = attempt.events?.[attempt.events.length - 1];
  if (last && typeof last.result === 'string' && END_EVENT[last.result]) return last.result;
  if (attempt.outcome === 'solved') return 'correct';
  return attempt.outcome === 'timeout' ? 'timeout' : 'skipped';
}

export function attemptPicks(attempt) {
  const last = attempt.events?.[attempt.events.length - 1];
  if (last && Array.isArray(last.picks)) return last.picks.slice();
  return replayPicks(attempt.events || []);
}
