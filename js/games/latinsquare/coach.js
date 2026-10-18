// Latin Square coach (pure, no DOM). Reads an attempt's event log and turns measured facts into
// findings, each with a plain-English suggestion.
//
// Event log (core recorder types, Latin Square meaning):
//   select { p: cell }                        the player selected a cell (its row and column light up)
//   move   { p: symbol, d: target }          a pick of symbol p (index in puzzle.symbols) for target d
//   hint, and one closing event: solve | skip | timeout.
// A timed-run puzzle whose targets were all answered with at least one wrong is stored by the core
// recorder as outcome 'skipped' (it has no 'wrong' outcome yet); effectiveOutcome() reads the log
// to tell the two apart.
//
// Per puzzle: time to the first pick against your own median and the pace guide, every wrong pick
// classified by what was missed (a symbol already in the row, already in the column, or a helper
// cell of the chain), guessing (wrong picks faster than a row and column check can take), hints,
// helper cells you looked at, and skip timing.
// Per run: time per puzzle, accuracy with the wrong picks by kind, guessing, skip policy, pace
// against the 6:00 budget, and the top 3 habits to fix.

import { analyse, wrongPickReason, symName } from './explain.js';
import { cellLabel, examPoints } from './state.js';
import { median, mean } from '../../core/analytics.js';

export const RUN_BUDGET_MS = 6 * 60 * 1000;

export const HABITS = {
  'missed-row': {
    label: 'Not checking the whole row',
    tip: 'Before you pick, say the row out loud in your head: every symbol it already holds. Only then add the column.',
  },
  'missed-col': {
    label: 'Not checking the whole column',
    tip: 'After the row, run your eye down the full column, top to bottom. A symbol in the column rules the cell out just as firmly.',
  },
  'missed-chain': {
    label: 'Answering before the chain is done',
    tip: 'When the row and column leave two or more symbols, do not choose between them. Find a blank in that row or column that you can fill first.',
  },
  guess: {
    label: 'Guessing',
    tip: 'A blind pick is right 1 time in n and a wrong answer loses points. If you cannot finish the check, skip instead: a skip scores 0, a guess scores less on average.',
  },
  'slow-start': {
    label: 'Slow first answer',
    tip: 'Use a fixed order: row first, then column, then list what is left. A routine is faster than scanning the whole grid.',
  },
  'skip-late': {
    label: 'Skipping too late',
    tip: 'Set a skip cutoff before the run and keep to it. Time spent on a puzzle you then skip scores nothing.',
  },
  'skip-early': {
    label: 'Skipping too early',
    tip: 'Give every puzzle one full row and column check before skipping. Many puzzles end after that one check.',
  },
  'stuck-long': {
    label: 'Holding on to one puzzle',
    tip: 'When a puzzle passes twice the pace guide, skipping and taking the next one usually scores more.',
  },
  hints: {
    label: 'Leaning on hints',
    tip: 'Try the same puzzle again without hints. The timed test has none.',
  },
  timeout: {
    label: 'Running out of time mid-puzzle',
    tip: 'Watch the clock in the last minute. A puzzle cut off by time scores 0, the same as a skip.',
  },
};

const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

function finding(id, kind, severity, title, detail, data = {}, tip = HABITS[id]?.tip ?? '') {
  return { id, kind, severity, title, detail, tip, data };
}

// A wrong pick faster than this (from the puzzle start or the previous pick) is too quick for a
// full row and column check, so it is treated as a guess. Grows with grid size and chain depth.
export function guessFloorMs(n, depth = 1) {
  return 1000 + 400 * n * depth;
}

// 'solved' | 'wrong' | 'skipped' | 'timeout', from the attempt and its log. P: parsed puzzle.
// A timed-run attempt stored as skipped with every target answered (and one wrong) was not a skip.
export function effectiveOutcome(attempt, P) {
  if (attempt.outcome !== 'skipped' || attempt.mode !== 'exam') return attempt.outcome;
  const moves = (attempt.events || []).filter((e) => e.type === 'move' && Number.isInteger(e.d) && e.d >= 0 && e.d < P.targets.length);
  const answered = new Set(moves.map((e) => e.d));
  const anyWrong = moves.some((e) => e.p !== P.answers[e.d]);
  return answered.size >= P.targets.length && anyWrong ? 'wrong' : 'skipped';
}

// Picks from the log with their timing and, for wrong ones, what was missed.
export function readPicks(attempt, A) {
  const { P } = A;
  const picks = [];
  let prevT = 0;
  for (const ev of attempt.events || []) {
    if (ev.type !== 'move') continue;
    const t = Number.isInteger(ev.d) ? ev.d : 0;
    const cell = P.targets[t];
    if (cell === undefined || !(ev.p >= 0 && ev.p < P.n)) continue;
    const ok = ev.p === A.ded.value[cell];
    const reason = ok ? null : wrongPickReason(A, cell, ev.p);
    picks.push({ t: ev.t, sinceMs: ev.t - prevT, target: t, cell, sym: ev.p, ok, kind: reason?.kind ?? null, reason });
    prevT = ev.t;
  }
  return picks;
}

// Median time to the first pick from your other attempts: same puzzle with 3 or more, else the set.
export function latencyBaseline(attempt, history = [], minN = 3) {
  const others = history.filter((a) => a.id !== attempt.id && a.metrics && Number.isFinite(a.metrics.firstMoveMs));
  const same = others.filter((a) => a.puzzleId === attempt.puzzleId).map((a) => a.metrics.firstMoveMs);
  if (same.length >= minN) return { ms: median(same), scope: 'puzzle', n: same.length };
  const set = others.filter((a) => a.set === attempt.set && a.game === attempt.game).map((a) => a.metrics.firstMoveMs);
  if (set.length >= minN) return { ms: median(set), scope: 'set', n: set.length };
  return null;
}

const KIND_ID = { row: 'missed-row', col: 'missed-col', chain: 'missed-chain' };

export function coachPuzzle(attempt, puzzle, { history = [], paceSec = 20, A = analyse(puzzle) } = {}) {
  const { P, chain } = A;
  const n = P.n;
  const exam = attempt.mode === 'exam';
  const events = attempt.events || [];
  const totalMs = events.length ? events[events.length - 1].t : 0;
  const paceMs = paceSec * 1000;
  const outcome = effectiveOutcome(attempt, P);
  const picks = readPicks(attempt, A);
  const wrong = picks.filter((p) => !p.ok);
  const depth = puzzle.depth ?? 1;
  const floor = guessFloorMs(n, depth);
  const hints = events.filter((e) => e.type === 'hint').length;
  const findings = [];

  // Wrong picks, grouped by what was missed.
  for (const kind of ['row', 'col', 'chain']) {
    const list = wrong.filter((p) => p.kind === kind);
    if (!list.length) continue;
    const id = KIND_ID[kind];
    const what = kind === 'row' ? 'already in the row' : kind === 'col' ? 'already in the column' : 'ruled out by the chain';
    const lines = list.map((p) => `${symName(P, p.sym)} for ${cellLabel(n, p.cell)}: ${p.reason.text}`);
    findings.push(finding(id, 'fix', list.length, `${plural(list.length, 'wrong pick')}: symbol ${what}`, lines.join(' '), { picks: list.length }));
  }

  // Guessing: wrong picks faster than a full check.
  const fast = wrong.filter((p) => p.sinceMs < floor);
  if (fast.length) {
    findings.push(finding('guess', 'fix', 1 + fast.length,
      'Answers too fast to have been checked',
      `${plural(fast.length, 'wrong pick')} came after ${fast.map((p) => sec(p.sinceMs)).join(', ')}; a full row and column check on this grid takes about ${sec(floor)} or more.` +
        (exam ? ` Each wrong answer cost ${(1 / (n - 1)).toFixed(2)} points.` : ''),
      { fast: fast.length, floorMs: floor }));
  }

  // The row and column check, from the evidence of the picks.
  if (picks.length && !wrong.some((p) => p.kind === 'row' || p.kind === 'col')) {
    findings.push(finding('row-col-check', 'good', 0, 'Row and column checked',
      wrong.length ? 'No pick was a symbol already visible in the row or column of its cell.' : 'Every pick fitted its row and column.'));
  }

  // Helper cells: did you look at a cell of the chain before the answer that needs it?
  const helpers = chain.filter((x) => !P.targets.includes(x));
  if (helpers.length) {
    const firstPickT = picks.length ? picks[0].t : totalMs;
    const looked = new Set(events.filter((e) => e.type === 'select' && e.t <= firstPickT && helpers.includes(e.p)).map((e) => e.p));
    if (looked.size) {
      findings.push(finding('helper-look', 'good', 0, 'You looked at the chain',
        `You selected helper ${looked.size === 1 ? 'cell' : 'cells'} ${[...looked].map((x) => cellLabel(n, x)).join(', ')} before answering. That is the right instinct when a row and column leave more than one symbol.`));
    } else if (outcome !== 'solved' || wrong.length) {
      findings.push(finding('helper-miss', 'info', 0, 'This puzzle needs a chain',
        `The answer needs ${plural(helpers.length, 'helper cell')} filled first: ${helpers.map((x) => cellLabel(n, x)).join(', ')}. Selecting a cell lights up its row and column, which makes the check easier.`,
        {}, HABITS['missed-chain'].tip));
    }
  }

  // Time to the first pick.
  const firstMs = picks.length ? picks[0].t : null;
  if (firstMs !== null) {
    const base = latencyBaseline(attempt, history);
    const slowLimit = base ? Math.max(2 * base.ms, base.ms + 5000) : 2 * paceMs;
    if (firstMs > slowLimit) {
      findings.push(finding('slow-start', 'fix', 1, 'Slow first answer',
        `First answer after ${sec(firstMs)}, against ${base ? `your median of ${sec(base.ms)} for this ${base.scope}` : `a pace guide of ${paceSec} s`}.`,
        { firstMs, base: base?.ms ?? null }));
    } else if (picks[0].ok) {
      findings.push(finding('pace-ok', 'good', 0, 'Good pace',
        `First answer after ${sec(firstMs)}, and it was right${base ? ` (your median: ${sec(base.ms)})` : ` (pace guide: ${paceSec} s)`}.`));
    }
  }

  if (hints) {
    findings.push(finding('hints', exam ? 'fix' : 'info', hints, `${plural(hints, 'hint')} used`,
      'Hinted solves still count in practice, but the timed test has no hints.'));
  }

  // Skip and time-out.
  if (outcome === 'skipped') {
    if (totalMs > 2 * paceMs) {
      findings.push(finding('skip-late', 'fix', 2, 'Skipped late',
        `Skipped after ${sec(totalMs)}, more than twice the ${paceSec} s pace guide.`, { totalMs }));
    } else if (totalMs < 0.25 * paceMs && !picks.length) {
      findings.push(finding('skip-early', 'fix', 1, 'Skipped very early',
        `Skipped after ${sec(totalMs)} without an answer. One row and column check takes about ${sec(floor)}.`, { totalMs }));
    } else {
      findings.push(finding('skip-ok', 'info', 0, 'Skip timing',
        `Skipped after ${sec(totalMs)}. ${exam ? 'A skip scores 0, better than a wrong answer.' : 'The reasoning is below.'}`));
    }
  } else if (outcome === 'timeout') {
    findings.push(finding('timeout', 'info', 1, 'Cut off by the clock', `Time ran out ${sec(totalMs)} into this puzzle.`));
  } else if (outcome !== 'skipped' && totalMs > 3 * paceMs) {
    findings.push(finding('stuck-long', exam ? 'fix' : 'info', 1, 'Long time on one puzzle',
      `This puzzle took ${sec(totalMs)}, more than 3x the ${paceSec} s pace guide.`, { totalMs }));
  }

  if (outcome === 'solved' && !wrong.length && !hints && totalMs <= 2 * paceMs && !findings.some((f) => f.id === 'pace-ok')) {
    findings.push(finding('clean', 'good', 0, 'Clean solve', `Right first time in ${sec(totalMs)}.`));
  }

  const order = { fix: 0, info: 1, good: 2 };
  findings.sort((a, b) => order[a.kind] - order[b.kind] || b.severity - a.severity);
  return {
    findings,
    facts: { outcome, totalMs, firstMs, picks, wrong: wrong.length, fast: fast.length, hints, floorMs: floor, points: examPoints(outcome, n) },
  };
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

// run: run record. attempts: the run's attempt records. puzzles: Map or object puzzleId -> puzzle.
export function coachRun(run, attempts = [], puzzles = {}, { paceSec = 20, budgetMs = RUN_BUDGET_MS, history = [] } = {}) {
  const getPuzzle = (id) => (puzzles instanceof Map ? puzzles.get(id) : puzzles[id]);
  const lines = [];
  const items = [];
  for (const a of attempts) {
    const p = getPuzzle(a.puzzleId);
    if (!p) continue;
    const res = coachPuzzle(a, p, { history, paceSec });
    items.push({ attempt: a, puzzle: p, ...res });
  }
  if (!items.length) {
    lines.push({ id: 'empty', kind: 'info', title: 'No puzzles finished', text: 'The run ended before any puzzle was answered.', tip: 'Start the next run with a row and column check on the first puzzle.' });
    return { lines, habits: [], perPuzzle: [], totals: null };
  }
  const paceMs = paceSec * 1000;
  const n = items[0].puzzle.n;
  const count = (o) => items.filter((it) => it.facts.outcome === o).length;
  const totals = {
    reached: items.length,
    solved: count('solved'),
    wrong: count('wrong'),
    skipped: count('skipped'),
    timedOut: count('timeout'),
  };
  totals.answered = totals.solved + totals.wrong;
  totals.points = Math.max(0, items.reduce((s, it) => s + examPoints(it.facts.outcome, it.puzzle.n), 0));

  // Time per puzzle (the last, cut-off one excluded).
  const done = items.filter((it) => it.facts.outcome !== 'timeout');
  const times = done.map((it) => it.facts.totalMs);
  if (times.length) {
    const avg = mean(times);
    const slowest = done.reduce((a, b) => (b.facts.totalMs > a.facts.totalMs ? b : a));
    lines.push({
      id: 'time-per-puzzle',
      kind: avg > 1.5 * paceMs ? 'fix' : 'info',
      title: 'Time per puzzle',
      text: `Average ${sec(avg)} per puzzle (median ${sec(median(times))}) against a pace guide of ${paceSec} s. Slowest: puzzle ${items.indexOf(slowest) + 1} at ${sec(slowest.facts.totalMs)}.`,
      tip: avg > 1.5 * paceMs ? `Aim for about ${paceSec} s: row, column, what is left, answer.` : 'Pace per puzzle is in a good range.',
    });
  }

  // Accuracy and what the wrong answers missed.
  const kinds = { row: 0, col: 0, chain: 0 };
  for (const it of items) for (const p of it.facts.picks) if (!p.ok) kinds[p.kind]++;
  const wrongPicks = kinds.row + kinds.col + kinds.chain;
  const acc = totals.answered ? totals.solved / totals.answered : null;
  const parts = [];
  if (kinds.row) parts.push(`${kinds.row} already in the row`);
  if (kinds.col) parts.push(`${kinds.col} already in the column`);
  if (kinds.chain) parts.push(`${kinds.chain} needed a helper cell first`);
  lines.push({
    id: 'accuracy',
    kind: acc !== null && acc < 0.8 ? 'fix' : 'good',
    title: 'Accuracy',
    text: totals.answered
      ? `${totals.solved} of ${totals.answered} answered puzzles right (${Math.round(acc * 100)}%).` + (wrongPicks ? ` Wrong picks: ${parts.join(', ')}.` : '')
      : 'No puzzle was answered.',
    tip: kinds.row + kinds.col > kinds.chain
      ? 'Most misses were symbols already in plain sight: check the full row and the full column before every answer.'
      : kinds.chain
        ? 'Most misses needed a chain: when two symbols are left, fill a helper cell instead of choosing.'
        : 'Keep the same routine: row, column, what is left.',
  });

  // Guessing.
  const fastPicks = items.flatMap((it) => it.facts.picks.filter((p) => p.sinceMs < it.facts.floorMs));
  const fastWrong = fastPicks.filter((p) => !p.ok).length;
  if (fastWrong) {
    lines.push({
      id: 'guess',
      kind: 'fix',
      title: 'Guessing',
      text: `${plural(fastPicks.length, 'answer')} came faster than a full check takes, and ${fastWrong} of them ${fastWrong === 1 ? 'was' : 'were'} wrong, costing ${(fastWrong / (n - 1)).toFixed(2)} points.`,
      tip: HABITS.guess.tip,
    });
  } else if (fastPicks.length) {
    lines.push({ id: 'guess', kind: 'good', title: 'Fast and right', text: `${plural(fastPicks.length, 'answer')} came very fast and all were right.`, tip: 'Speed is paying off. Keep checking both lines.' });
  }

  // Skip policy.
  const skips = items.map((it, i) => ({ ...it, i: i + 1 })).filter((it) => it.facts.outcome === 'skipped');
  const late = skips.filter((it) => it.facts.totalMs > 2 * paceMs);
  const early = skips.filter((it) => it.facts.totalMs < 0.25 * paceMs && !it.facts.picks.length);
  const stuck = items.map((it, i) => ({ ...it, i: i + 1 })).filter((it) => it.facts.outcome !== 'skipped' && it.facts.totalMs > 3 * paceMs);
  const skipParts = [];
  if (late.length) skipParts.push(`Skipped late on ${plural(late.length, 'puzzle')} (${late.map((it) => `#${it.i} after ${sec(it.facts.totalMs)}`).join(', ')}).`);
  if (early.length) skipParts.push(`Skipped very early on ${plural(early.length, 'puzzle')} (${early.map((it) => `#${it.i}`).join(', ')}) without a full check.`);
  if (stuck.length) skipParts.push(`Held on past 3x the pace guide on ${plural(stuck.length, 'puzzle')} (${stuck.map((it) => `#${it.i} ${sec(it.facts.totalMs)}`).join(', ')}).`);
  if (!skipParts.length) skipParts.push(skips.length ? `${plural(skips.length, 'skip')}, all at sensible times.` : 'No skips, and no puzzle ran far past the pace guide.');
  lines.push({
    id: 'skip-policy',
    kind: late.length || early.length || stuck.length ? 'fix' : 'good',
    title: 'Skip policy',
    text: skipParts.join(' '),
    tip: `Skip rule for this set: if the row and column leave several symbols and no helper cell is clear after about ${paceSec} s, skip; at the latest at ${2 * paceSec} s.`,
  });

  // Pace against the budget.
  const atPace = Math.floor(budgetMs / paceMs);
  const perMin = totals.points / (Math.max(1, run?.durationMs || budgetMs) / 60000);
  let paceKind = 'good';
  let paceTip = 'You are on pace for the 6:00 budget. Keep the same rhythm.';
  if (items.length < 0.7 * atPace) {
    paceKind = 'fix';
    paceTip = `To reach about ${atPace} puzzles in 6:00, keep a fixed check routine and use the skip rule on long chains.`;
  } else if (items.length > 1.4 * atPace && acc !== null && acc < 0.7) {
    paceKind = 'fix';
    paceTip = 'You are fast but losing points to wrong answers. One more second per check pays for itself.';
  }
  lines.push({
    id: 'pace',
    kind: paceKind,
    title: 'Pace against the 6:00 budget',
    text: `You reached ${plural(items.length, 'puzzle')}; at the ${paceSec} s pace guide that would be about ${atPace}. Score ${totals.points.toFixed(2)} (${perMin.toFixed(2)} per minute).`,
    tip: paceTip,
  });

  const lists = items.map((it) => it.findings);
  return { lines, habits: topHabits(lists), perPuzzle: lists, totals };
}
