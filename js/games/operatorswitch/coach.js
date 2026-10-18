// Operator Switch coach (pure, no DOM). Turns a recorded attempt into findings, each with a
// plain-English suggestion. Every finding is measured from the attempt's event log:
//   time to the first answer (against your own median, else the set's pace guide), each wrong
//   answer named by the misreading that produces it (recomputed here from the puzzle, see
//   state.js puzzleMistakes), wasted answers and quick re-guesses in practice, hints, the cost of a
//   wrong answer in a timed test, and skip timing (with what slot 1 alone would have been worth).
// coachRun() adds run-level coaching: time per puzzle, accuracy, the most common error type,
// guessing, skip policy, pace against the 6:00 budget and the top 3 habits to fix.
//
// Event mapping onto the core recorder: each answer is a 'move' event with p = option index;
// 'hint' events are hints; the closing event is solve, skip or timeout. A wrong final answer in a
// timed test is stored with outcome 'skipped' after its 'move' event (see docs/operatorswitch.md).

import { MISTAKES, diagnose, wrongPenalty } from './state.js';
import { eliminate, optionText } from './explain.js';
import { median, mean } from '../../core/analytics.js';

export const RUN_BUDGET_MS = 6 * 60 * 1000;

const HIDDEN_LINK = 'Work the known boxes first: forward from the start up to the gap, backward from the output to the gap. The hidden box only links those two rows.';

export const HABITS = {
  'err-original': {
    label: 'Applying boxes to the start row',
    tip: 'Write the row after each box (as numbers) before you read the next box. Every box reads the row in front of it, never the start.',
  },
  'err-inverse': {
    label: 'Reading boxes backwards (inverse)',
    tip: 'Say the rule for slot 1 out loud: "slot 1 takes from position <first digit>". The digits say where each slot reads from, not where an item goes.',
  },
  'err-reversed': {
    label: 'Boxes in the wrong order',
    tip: 'Boxes run left to right, in reading order. Put your finger on box 1 first.',
  },
  'err-dropped': {
    label: 'Leaving a box out',
    tip: 'Count the boxes before you start and tick each one off as you apply it.',
  },
  'err-hidden-inverse': {
    label: 'Hidden box written backwards',
    tip: 'For each slot coming out, find its entry in the row going in: the position you find is the digit. Do not write where the entry goes.',
  },
  'err-hidden-direct': { label: 'Ignoring the known boxes', tip: HIDDEN_LINK },
  'err-hidden-skip-before': { label: 'Ignoring boxes before the gap', tip: HIDDEN_LINK },
  'err-hidden-skip-after': { label: 'Ignoring boxes after the gap', tip: HIDDEN_LINK },
  'err-hidden-undo-forward': {
    label: 'Applying later boxes instead of undoing them',
    tip: 'To undo a box, put each entry back: the entry in slot i returns to position digit i. Applying the box again moves things further, not back.',
  },
  'err-slip': {
    label: 'Tracking slips',
    tip: 'The method was right. Before answering, check one more slot against the option you picked.',
  },
  'err-other': {
    label: 'Unclassified wrong answers',
    tip: 'Replay the explanation and compare its number rows with yours, box by box.',
  },
  'slow-answer': {
    label: 'Slow to answer',
    tip: 'Trace slot 1 backwards first and rule options out: you often do not need the whole row.',
  },
  rushed: {
    label: 'Answering before checking',
    tip: 'Take one extra second to check slot 2 as well. A fast wrong answer costs more than a skip.',
  },
  'guess-retry': {
    label: 'Guessing after a wrong pick',
    tip: 'After a wrong pick, re-run the chain (or ask for a hint) instead of clicking the next option.',
  },
  wasted: {
    label: 'Wrong answers before the right one',
    tip: 'Only answer once one option is left after slot by slot elimination.',
  },
  'skip-late': {
    label: 'Skipping too late',
    tip: 'Set a skip cutoff before the run starts and keep to it. Time sunk into a puzzle you then skip scores nothing.',
  },
  'skip-early': {
    label: 'Skipping too early',
    tip: 'Give each puzzle a slot 1 trace before skipping: it takes a few seconds and often leaves only two options.',
  },
  timeout: {
    label: 'Running out of time mid-puzzle',
    tip: 'Watch the clock in the last minute. A puzzle cut off by time scores 0.',
  },
};

const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

function finding(id, kind, severity, title, detail, data = {}, tip = HABITS[id]?.tip ?? '') {
  return { id, kind, severity, title, detail, tip, data };
}

function kindOrder(k) {
  return k === 'fix' ? 0 : k === 'good' ? 1 : 2;
}

// Answers (valid 'move' events) and hints from a log.
export function readLog(puzzle, events = []) {
  const answers = [];
  let hints = 0;
  let invalid = 0;
  for (const ev of events) {
    if (ev.type === 'move') {
      if (Number.isInteger(ev.p) && ev.p >= 0 && ev.p < puzzle.options.length) answers.push({ t: ev.t, p: ev.p, correct: ev.p === puzzle.answer });
      else invalid++;
    } else if (ev.type === 'hint') hints++;
  }
  return { answers, hints, invalid };
}

// What happened in one attempt: correct | wrong | skipped | timeout.
export function attemptResult(attempt) {
  if (attempt.outcome === 'solved') return 'correct';
  if (attempt.outcome === 'timeout') return 'timeout';
  const answered = (attempt.events || []).some((e) => e.type === 'move') || (attempt.metrics?.grossMoves ?? 0) > 0;
  return answered ? 'wrong' : 'skipped';
}

// Same, from a compact run row (recorder.puzzleRow).
export function rowResult(row) {
  if (row.outcome === 'solved') return 'correct';
  if (row.outcome === 'timeout') return 'timeout';
  return (row.grossMoves ?? 0) > 0 ? 'wrong' : 'skipped';
}

// Median time to first answer from your other attempts: same puzzle with 3 or more, else the set.
export function answerBaseline(attempt, history = [], minN = 3) {
  const others = history.filter((a) => a.id !== attempt.id && Number.isFinite(a.metrics?.firstMoveMs));
  const same = others.filter((a) => a.puzzleId === attempt.puzzleId).map((a) => a.metrics.firstMoveMs);
  if (same.length >= minN) return { ms: median(same), scope: 'puzzle', n: same.length };
  const set = others.filter((a) => a.set === attempt.set && a.game === attempt.game).map((a) => a.metrics.firstMoveMs);
  if (set.length >= minN) return { ms: median(set), scope: 'set', n: set.length };
  return null;
}

// Named error behind one wrong option: { kind, habit, label, text }.
export function errorFor(puzzle, optionIndex) {
  const d = diagnose(puzzle, puzzle.options[optionIndex]);
  const kind = d.primary ?? 'other';
  const m = d.matches?.find((x) => x.kind === kind);
  let you = MISTAKES[kind].you;
  if (kind === 'dropped' && m) you = `leave out box ${m.box}`;
  if (kind === 'slip') you = `use the right method but swap ${puzzle.kind === 'hidden' ? 'digits' : 'slots'} ${d.slots[0] + 1} and ${d.slots[1] + 1}`;
  const chain = m && m.chain !== undefined ? ` in chain ${'AB'[m.chain]}` : '';
  return { kind, kinds: d.kinds, habit: `err-${kind}`, label: MISTAKES[kind].label, text: `what you get if you ${you}${chain}` };
}

// Value of what slot 1 alone tells you: options left and the expected points of guessing among them.
export function slotOneValue(puzzle) {
  const el = eliminate(puzzle);
  const left = el.steps.length ? el.steps[0].left.length : 1;
  const pen = wrongPenalty(puzzle.options.length);
  const ev = 1 / left - ((left - 1) / left) * pen;
  return { left, ev };
}

// ---------------------------------------------------------------- per puzzle

export function coachPuzzle(attempt, puzzle, { history = [], paceSec = 20 } = {}) {
  const log = readLog(puzzle, attempt.events || []);
  const out = [];
  const exam = attempt.mode === 'exam';
  const result = attemptResult(attempt);
  const paceMs = paceSec * 1000;
  const first = log.answers[0] ?? null;
  const firstMs = attempt.metrics?.firstMoveMs ?? first?.t ?? null;
  const wrong = log.answers.filter((a) => !a.correct);
  const options = puzzle.options.length;

  if (result === 'correct' && wrong.length === 0) {
    out.push(finding('correct-first', 'good', 0, 'Correct first time', `Right answer at the first attempt${firstMs !== null ? `, after ${sec(firstMs)}` : ''}.`, { firstMs }, 'Keep the same routine: number the positions, carry the row, eliminate by slot 1.'));
  }

  // Each wrong answer, named by the misreading that produces it.
  for (const w of wrong) {
    const e = errorFor(puzzle, w.p);
    const sev = e.kind === 'slip' || e.kind === 'other' ? 1 : 2;
    out.push(finding(e.habit, 'fix', sev, e.label,
      `You picked option ${w.p + 1} (${optionText(puzzle, w.p)}) after ${sec(w.t)}. It is ${e.text}.`,
      { option: w.p, error: e.kind, kinds: e.kinds, t: w.t }));
  }

  // Practice: wrong answers before the right one, and quick re-guesses.
  if (!exam && wrong.length) {
    if (result === 'correct') {
      out.push(finding('wasted', 'fix', wrong.length >= 2 ? 2 : 1, plural(wrong.length, 'wasted answer'),
        `${plural(wrong.length, 'wrong answer')} before the right one, so efficiency is ${Math.round(100 / log.answers.length)}% (1 / ${log.answers.length} answers).`,
        { wrong: wrong.length, answers: log.answers.length }));
    }
    const quick = [];
    for (let i = 1; i < log.answers.length; i++) {
      const gap = log.answers[i].t - log.answers[i - 1].t;
      if (!log.answers[i - 1].correct && gap < 3000) quick.push({ n: i + 1, gap });
    }
    if (quick.length) {
      out.push(finding('guess-retry', 'fix', 1, 'Quick re-guess',
        `You answered again ${quick.map((q) => sec(q.gap)).join(', ')} after a wrong pick: too fast to have re-run the chain.`,
        { count: quick.length }));
    }
  }

  // Timed test: what the wrong answer cost.
  if (exam && result === 'wrong') {
    const pen = wrongPenalty(options);
    const sv = slotOneValue(puzzle);
    out.push(finding('exam-wrong-cost', 'info', 1, 'Cost of the wrong answer',
      `In a timed test a wrong answer costs 1/${options - 1} = ${pen.toFixed(2)} points with ${options} options; a skip costs 0. Slot 1 alone would have left ${plural(sv.left, 'option')}.`,
      { penalty: pen, slotOneLeft: sv.left }, 'Answer when you have ruled out all but one option, guess only between two, otherwise skip.'));
  }

  // Time to first answer.
  if (firstMs !== null) {
    const base = answerBaseline(attempt, history);
    const firstWrong = first && !first.correct;
    if (firstWrong && firstMs < 0.35 * paceMs) {
      out.push(finding('rushed', 'fix', exam ? 2 : 1, 'Rushed answer',
        `Your first answer came after ${sec(firstMs)}, under a third of the ${paceSec} s pace guide, and it was wrong.`, { firstMs, paceMs }));
    } else if (base) {
      const ratio = base.ms > 0 ? firstMs / base.ms : Infinity;
      const where = base.scope === 'puzzle' ? 'this puzzle' : `set ${attempt.set}`;
      const vs = `your median of ${sec(base.ms)} for ${where} (${base.n} attempts)`;
      const data = { firstMs, medianMs: base.ms, scope: base.scope, ratio };
      if (ratio >= 1.75 && firstMs - base.ms >= 3000) out.push(finding('slow-answer', 'fix', ratio >= 3 ? 2 : 1, 'Slow to answer', `First answer after ${sec(firstMs)}, ${ratio.toFixed(1)}x ${vs}.`, data));
      else if (ratio <= 0.75 && result === 'correct' && !wrong.length) out.push(finding('quick', 'good', 0, 'Quick and correct', `First answer after ${sec(firstMs)}, faster than ${vs}, and right.`, data, 'Fast tracking is paying off.'));
      else out.push(finding('answer-time', 'info', 0, 'Time to answer', `First answer after ${sec(firstMs)}; ${vs}.`, data, ''));
    } else if (firstMs > paceMs) {
      out.push(finding('slow-answer', 'fix', 1, 'Slow to answer', `First answer after ${sec(firstMs)}, over the ${paceSec} s pace guide for this set. (A personal median appears after 3 attempts.)`, { firstMs, medianMs: null }));
    } else {
      out.push(finding('answer-time', 'info', 0, 'Time to answer', `First answer after ${sec(firstMs)} against a pace guide of ${paceSec} s. A personal median appears after 3 attempts in this set.`, { firstMs, medianMs: null }, ''));
    }
  }

  if (log.hints) {
    out.push(finding('hints', 'info', 0, plural(log.hints, 'hint'), `You used ${plural(log.hints, 'hint')} on this puzzle.`, { count: log.hints }, 'Try a similar puzzle again without hints before moving on.'));
  }

  // Skip timing and what slot 1 alone was worth.
  const spent = attempt.metrics?.totalMs ?? 0;
  if (result === 'skipped') {
    const sv = slotOneValue(puzzle);
    const data = { spentMs: spent, paceMs, slotOneLeft: sv.left, guessValue: sv.ev };
    const worth = sv.left === 1
      ? 'Slot 1 alone would have settled it: only one option has the right item there.'
      : `Slot 1 alone would have left ${sv.left} options${exam ? `; a guess among them is worth ${sv.ev >= 0 ? '+' : ''}${sv.ev.toFixed(2)} points on average, against 0 for a skip` : ''}.`;
    if (spent > 2 * paceMs) {
      out.push(finding('skip-late', 'fix', spent > 3 * paceMs ? 3 : 2, 'Skipped late',
        `You spent ${sec(spent)} (${(spent / paceMs).toFixed(1)}x the ${paceSec} s pace guide) and then skipped: that time scored nothing. ${worth}`, data));
    } else if (spent < 0.25 * paceMs) {
      out.push(finding('skip-early', 'fix', 1, 'Skipped early', `You skipped after ${sec(spent)}, before a slot 1 trace was likely. ${worth}`, data));
    } else {
      out.push(finding('skip-cost', 'info', 1, 'Skip', `Skipped after ${sec(spent)}. ${worth}`, data, 'If you skip, do it early; if you have slot 1, use it.'));
    }
  } else if (result === 'timeout') {
    out.push(finding('timeout', 'fix', 1, 'Cut off by time', `The clock ran out ${sec(spent)} into this puzzle, so it scored 0.`, { spentMs: spent, paceMs }));
  }

  if (log.invalid) out.push(finding('log', 'info', 0, 'Log note', `${plural(log.invalid, 'recorded answer')} could not be read and ${log.invalid === 1 ? 'was' : 'were'} ignored.`, {}, ''));

  out.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || b.severity - a.severity);
  return { findings: out, result, answers: log.answers, errors: wrong.map((w) => errorFor(puzzle, w.p)) };
}

// ---------------------------------------------------------------- habits across puzzles

export function topHabits(findingLists, top = 3) {
  const agg = new Map();
  findingLists.forEach((list, i) => {
    const seen = new Set();
    for (const f of list) {
      if (f.kind !== 'fix' || !HABITS[f.id]) continue;
      const h = agg.get(f.id) ?? { id: f.id, label: HABITS[f.id].label, tip: HABITS[f.id].tip, weight: 0, count: 0, puzzles: [] };
      h.weight += f.severity;
      if (!seen.has(f.id)) {
        h.count++;
        h.puzzles.push(i);
        seen.add(f.id);
      }
      agg.set(f.id, h);
    }
  });
  return [...agg.values()]
    .sort((a, b) => b.weight - a.weight || b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, top)
    .map((h) => ({ ...h, of: findingLists.length }));
}

// ---------------------------------------------------------------- run level

// run: recorder run record (score already in points). attempts: its attempt records.
// puzzles: Map or object puzzleId -> puzzle.
export function coachRun(run, attempts = [], puzzles = {}, { paceSec = 20, budgetMs = RUN_BUDGET_MS, history = [] } = {}) {
  const getPuzzle = (id) => (puzzles instanceof Map ? puzzles.get(id) : puzzles[id]);
  const rows = run.puzzles.map((r, i) => ({ ...r, i: i + 1, result: rowResult(r) }));
  const paceMs = paceSec * 1000;
  const lines = [];
  if (!rows.length) {
    lines.push({ id: 'empty', kind: 'info', title: 'No puzzles finished', text: 'The run ended before any puzzle was finished.', tip: 'Start the next run with a slot 1 trace on the first puzzle.' });
    return { lines, habits: [], perPuzzle: [], errors: [] };
  }

  // Time per puzzle.
  const times = rows.map((r) => r.totalMs);
  const avgMs = mean(times);
  const slowest = rows.reduce((a, b) => (b.totalMs > a.totalMs ? b : a));
  const correctRows = rows.filter((r) => r.result === 'correct');
  lines.push({
    id: 'time-per-puzzle',
    kind: avgMs > 1.5 * paceMs ? 'fix' : 'info',
    title: 'Time per puzzle',
    text: `Average ${sec(avgMs)} per puzzle (median ${sec(median(times))}) against a pace guide of ${paceSec} s.` +
      (correctRows.length ? ` Correct answers took ${sec(mean(correctRows.map((r) => r.totalMs)))} on average.` : '') +
      ` Slowest: puzzle ${slowest.i} at ${sec(slowest.totalMs)}.`,
    tip: avgMs > 1.5 * paceMs ? `Aim for about ${paceSec} s: trace slot 1, eliminate, and only build full rows when two options are left.` : 'Pace per puzzle is in a good range.',
    data: { avgMs, medianMs: median(times), slowest: slowest.i },
  });

  // Accuracy.
  const wrongRows = rows.filter((r) => r.result === 'wrong');
  const answered = correctRows.length + wrongRows.length;
  const acc = answered ? correctRows.length / answered : 0;
  lines.push({
    id: 'accuracy',
    kind: answered && acc < 0.7 ? 'fix' : answered ? 'good' : 'info',
    title: 'Accuracy',
    text: answered
      ? `${correctRows.length} of ${answered} answers correct (${Math.round(acc * 100)}%). Wrong answers cost ${wrongRows.length ? (-wrongRows.reduce((s, r) => s - wrongPenalty(getPuzzle(r.puzzleId)?.options.length ?? 4), 0)).toFixed(2) : '0.00'} points in total.`
      : 'No answers given in this run.',
    tip: answered && acc < 0.7 ? 'Accuracy below 70% means the penalties are eating your score: answer only once slot by slot elimination leaves one option.' : 'Accuracy is holding up; push the pace a little.',
    data: { correct: correctRows.length, answered, accuracy: acc },
  });

  // Most common error type, recomputed from the puzzles.
  const byId = new Map(attempts.map((a) => [a.id, a]));
  const errors = [];
  for (const r of wrongRows) {
    const a = byId.get(r.attemptId);
    const p = getPuzzle(r.puzzleId);
    if (!a || !p) continue;
    const ans = readLog(p, a.events).answers.find((x) => !x.correct);
    if (ans) errors.push({ ...errorFor(p, ans.p), puzzle: r.i });
  }
  if (errors.length) {
    const counts = new Map();
    for (const e of errors) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    const [topKind, topN] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const where = errors.filter((e) => e.kind === topKind).map((e) => `#${e.puzzle}`).join(', ');
    lines.push({
      id: 'common-error',
      kind: 'fix',
      title: 'Most common error',
      text: `${MISTAKES[topKind].label}: ${topN} of ${errors.length} wrong answers (${where}). Those picks are what you get if you ${MISTAKES[topKind].you}.`,
      tip: HABITS[`err-${topKind}`]?.tip ?? '',
      data: { kind: topKind, count: topN, of: errors.length, all: Object.fromEntries(counts) },
    });
  }

  // Guessing: fast wrong answers.
  const fastWrong = wrongRows.filter((r) => Number.isFinite(r.firstMoveMs) && r.firstMoveMs < 0.35 * paceMs);
  if (fastWrong.length) {
    lines.push({
      id: 'guessing',
      kind: 'fix',
      title: 'Fast wrong answers',
      text: `${plural(fastWrong.length, 'wrong answer')} came in under ${sec(0.35 * paceMs)} (${fastWrong.map((r) => `#${r.i} after ${sec(r.firstMoveMs)}`).join(', ')}). At that speed they look like guesses, and blind guesses average zero at best.`,
      tip: 'Do the slot 1 trace before every answer. If it leaves three or more options and you are short of time, skip instead.',
      data: { count: fastWrong.length },
    });
  }

  // Skip policy.
  const skips = rows.filter((r) => r.result === 'skipped');
  const late = skips.filter((r) => r.totalMs > 2 * paceMs);
  const early = skips.filter((r) => r.totalMs < 0.25 * paceMs);
  const stuck = rows.filter((r) => r.result !== 'skipped' && r.totalMs > 3 * paceMs);
  const parts = [];
  let skipKind = 'good';
  if (late.length) {
    skipKind = 'fix';
    parts.push(`Skipped too late on ${plural(late.length, 'puzzle')} (${late.map((r) => `#${r.i} after ${sec(r.totalMs)}`).join(', ')}): ${sec(late.reduce((s, r) => s + r.totalMs, 0))} spent for no score.`);
  }
  if (early.length) {
    skipKind = 'fix';
    parts.push(`Skipped very early on ${plural(early.length, 'puzzle')} (${early.map((r) => `#${r.i} after ${sec(r.totalMs)}`).join(', ')}), before a slot 1 trace.`);
  }
  if (stuck.length) {
    skipKind = 'fix';
    parts.push(`Held on past 3x the pace guide on ${plural(stuck.length, 'puzzle')} (${stuck.map((r) => `#${r.i} ${sec(r.totalMs)}`).join(', ')}).`);
  }
  if (!parts.length) parts.push(skips.length ? `${plural(skips.length, 'skip')}, all at sensible times.` : 'No skips, and no puzzle ran far past the pace guide.');
  lines.push({
    id: 'skip-policy',
    kind: skipKind,
    title: 'Skip policy',
    text: parts.join(' '),
    tip: `Skip rule for this set: if slot 1 has not narrowed it to two options by about ${paceSec} s, skip; never stay past ${2 * paceSec} s.`,
    data: { skips: skips.length, late: late.length, early: early.length, stuck: stuck.length },
  });

  // Pace against the budget.
  const atPace = Math.floor(budgetMs / paceMs);
  const perMin = run.score / (Math.max(1, run.durationMs || budgetMs) / 60000);
  let paceKind = 'good';
  let paceTip = 'You are on pace for the 6:00 budget. Keep the same rhythm.';
  if (rows.length < 0.7 * atPace) {
    paceKind = 'fix';
    paceTip = `To reach about ${atPace} puzzles in 6:00, trace slot 1 first and stop as soon as one option is left.`;
  } else if (rows.length > 1.4 * atPace && acc < 0.7) {
    paceKind = 'fix';
    paceTip = 'You are moving fast but losing accuracy. Slow down a little: one checked slot more saves a penalty.';
  }
  lines.push({
    id: 'pace',
    kind: paceKind,
    title: 'Pace against the 6:00 budget',
    text: `You reached ${plural(rows.length, 'puzzle')} in ${Math.round(budgetMs / 60000)}:00; at the ${paceSec} s pace guide that would be about ${atPace}. Score ${run.score.toFixed(2)} (${perMin.toFixed(2)} per minute).`,
    tip: paceTip,
    data: { reached: rows.length, atPace, perMin },
  });

  // Habits from the per-puzzle findings.
  const lists = [];
  for (const r of rows) {
    const a = byId.get(r.attemptId);
    const p = getPuzzle(r.puzzleId);
    if (!a || !p) continue;
    lists.push(coachPuzzle(a, p, { history, paceSec }).findings);
  }
  return { lines, habits: topHabits(lists), perPuzzle: lists, errors };
}

