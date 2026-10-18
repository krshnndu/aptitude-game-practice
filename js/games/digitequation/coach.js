// Digit Equation coach (pure, no DOM). Replays an attempt's event log and turns measured facts
// into findings, each with a plain-English suggestion.
//
// Event log (core recorder types, reused for this game):
//   select { p: blank }      the player selected a blank
//   move { p: blank, d }     tile d placed on blank p (a swap if the blank was filled)
//   undo                     the selected blank was cleared (the UI logs select first)
//   reset                    every blank cleared
//   blocked                  Check pressed on a full but false equation (a wrong check)
//   hint, solve, skip, timeout
//
// Per puzzle: clean solve, extra placements, wrong checks (with the sides each one gave),
// order-of-operations slips (a wrong check that is true read left to right), trial and error
// (many swaps or wrong checks in quick succession), decoy tiles tried, first-placement latency
// against your own median, time against the pace guide, hints, and skip or time-out cost.
// coachRun() adds time per puzzle, accuracy, skip policy, pace against 6:00 and the top 3 habits.

import { parsePuzzle, checkFill, equationText, ERROR_TEXT } from './state.js';
import { solve } from './solver.js';
import { median, mean } from '../../core/analytics.js';

export const RUN_BUDGET_MS = 6 * 60 * 1000;

export const HABITS = {
  wasted: {
    label: 'Extra tile placements',
    tip: 'Pin a blank down before placing it: last digit first, then estimate the size. Place each tile once.',
  },
  'wrong-checks': {
    label: 'Checking wrong answers',
    tip: 'Before pressing Check, test the fill in your head: last digits, rough size, or casting out nines. A quick test is cheaper than a wrong check.',
  },
  precedence: {
    label: 'Order of operations slips',
    tip: 'Put brackets around every x and / chain before you start: those are worked out first, then + and - from left to right.',
  },
  guessing: {
    label: 'Trial and error',
    tip: 'Swapping tiles until something fits is slow and scores badly. Pick one blank you can work out alone (a units digit, or the last number left) and solve it first.',
  },
  decoy: {
    label: 'Falling for decoy tiles',
    tip: 'The tray holds tiles no answer uses. Leftover tiles are normal; never force a tile in because it is still there.',
  },
  'latency-slow': {
    label: 'Slow first placement',
    tip: 'Start with the easiest blank: a units digit you can test with the last-digit rule, or a blank on its own. You do not need the whole plan before the first tile.',
  },
  'latency-rushed': {
    label: 'Placing before thinking',
    tip: 'Take a few seconds to read the equation and the tray. A quick first tile that is wrong costs more than it saves.',
  },
  'time-slow': {
    label: 'Slow solves',
    tip: 'Estimate first: the size of each side rules out most tiles at once, so you try fewer.',
  },
  hints: {
    label: 'Relying on hints',
    tip: 'The timed test has no hints. Try the puzzle again without them, using the steps in the explanation.',
  },
  'skip-late': {
    label: 'Skipping too late',
    tip: 'Decide a skip cutoff before the run and keep to it. Time sunk into a puzzle you then skip scores nothing.',
  },
  'skip-early': {
    label: 'Skipping too early',
    tip: 'Give every puzzle one quick test (a units digit or the size) before skipping. Each skip gives up a full point.',
  },
  timeout: {
    label: 'Running out of time mid-puzzle',
    tip: 'Watch the clock in the last minute. A puzzle cut off by time scores 0, the same as a skip.',
  },
};

const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const listAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function finding(id, kind, severity, title, detail, data = {}, tip = HABITS[id]?.tip ?? '') {
  return { id, kind, severity, title, detail, tip, data };
}

// ---------------------------------------------------------------- replay

// Replays the events. Returns placements, swaps, checks (with the fill at each wrong check),
// clears, resets, hints, gaps between actions and the final fill.
export function replayLog(puzzle, events) {
  const parsed = parsePuzzle(puzzle);
  const n = parsed.slots.length;
  let fill = new Array(n).fill(null);
  let selected = null;
  const placedOn = new Array(n).fill(0);
  const placements = [];
  const checks = [];
  let swaps = 0;
  let clears = 0;
  let resets = 0;
  let hints = 0;
  let invalid = 0;
  const actionTimes = [];
  for (const ev of events || []) {
    if (ev.type === 'select') selected = Number.isInteger(ev.p) ? ev.p : null;
    else if (ev.type === 'move') {
      const p = ev.p;
      const d = ev.d;
      if (!Number.isInteger(p) || p < 0 || p >= n || !Number.isInteger(d) || d < 0 || d > 9) {
        invalid++;
        continue;
      }
      const replaced = fill[p];
      // A swap: the blank already held a tile, or it held one earlier and was cleared.
      const swap = replaced !== null || placedOn[p] > 0;
      if (swap) swaps++;
      placedOn[p]++;
      fill[p] = d;
      placements.push({ t: ev.t, slot: p, d, replaced, swap });
      actionTimes.push(ev.t);
      selected = p;
    } else if (ev.type === 'undo') {
      if (selected !== null && fill[selected] !== null) {
        fill[selected] = null;
        clears++;
      }
      actionTimes.push(ev.t);
    } else if (ev.type === 'reset') {
      fill = new Array(n).fill(null);
      resets++;
      actionTimes.push(ev.t);
    } else if (ev.type === 'blocked') {
      checks.push({ t: ev.t, fill: fill.slice(), res: checkFill(parsed, fill), ltr: checkFill(parsed, fill, { leftToRight: true }) });
      actionTimes.push(ev.t);
    } else if (ev.type === 'hint') hints++;
  }
  const gaps = [];
  for (let k = 1; k < actionTimes.length; k++) gaps.push(actionTimes[k] - actionTimes[k - 1]);
  return { parsed, placements, checks, swaps, clears, resets, hints, invalid, gaps, fill, firstPlaceMs: placements[0]?.t ?? null };
}

// First-placement latency baseline: your median on this puzzle (3+ attempts), else on this set.
function latencyBaseline(attempt, history) {
  const prior = history.filter((a) => a.id !== attempt.id && a.metrics && a.metrics.firstMoveMs !== null && a.metrics.firstMoveMs !== undefined);
  const same = prior.filter((a) => a.puzzleId === attempt.puzzleId);
  if (same.length >= 3) return { ms: median(same.map((a) => a.metrics.firstMoveMs)), n: same.length, scope: 'puzzle' };
  const set = prior.filter((a) => a.set === attempt.set);
  if (set.length >= 3) return { ms: median(set.map((a) => a.metrics.firstMoveMs)), n: set.length, scope: 'set' };
  return null;
}

// ---------------------------------------------------------------- one puzzle

export function coachPuzzle(attempt, puzzle, { history = [], paceSec = 30, solutions = null } = {}) {
  const rep = replayLog(puzzle, attempt.events || []);
  const { parsed } = rep;
  const blanks = parsed.slots.length;
  const out = [];
  const outcome = attempt.outcome;
  const solved = outcome === 'solved';
  const paceMs = paceSec * 1000;
  const totalMs = attempt.metrics?.totalMs ?? (attempt.events?.length ? attempt.events[attempt.events.length - 1].t : 0);
  const placed = rep.placements.length;
  const wrong = rep.checks.length;
  const sols = solutions ?? solve(puzzle).solutions;
  const usedDigits = new Set(sols.flat());
  const slotDigits = parsed.slots.map((s) => new Set(sols.map((f) => f[s.index])));

  if (solved && placed === blanks && wrong === 0 && rep.hints === 0) {
    out.push(finding('clean', 'good', 0, 'Clean solve', `Solved with ${plural(blanks, 'tile')} placed once each and no wrong checks.`, {}, 'Keep the same approach: work each blank out, then place it.'));
  }

  // Extra placements.
  const extra = solved ? Math.max(0, placed - blanks) : 0;
  if (extra > 0) {
    const sev = extra >= 2 * blanks ? 3 : extra >= blanks ? 2 : 1;
    out.push(finding('wasted', 'fix', sev, plural(extra, 'extra placement'),
      `You placed ${plural(placed, 'tile')} for ${plural(blanks, 'blank')}: ${plural(extra, 'extra placement')}${rep.swaps ? ` (${plural(rep.swaps, 'swap')})` : ''}. Score ${blanks} / ${placed}.`,
      { extra, placed, blanks, swaps: rep.swaps }));
  }

  // Wrong checks, with what each one gave.
  if (wrong > 0) {
    const shown = rep.checks.slice(0, 3).map((c, k) => {
      const eq = equationText(parsed, c.fill, { brackets: false });
      const what = c.res.valid ? `${c.res.left} on the left, ${c.res.right} on the right` : ERROR_TEXT[c.res.error];
      return `check ${k + 1} at ${sec(c.t)}: ${eq} gave ${what}`;
    });
    const more = wrong > 3 ? `, and ${wrong - 3} more` : '';
    out.push(finding('wrong-checks', 'fix', wrong >= 3 ? 3 : wrong >= 2 ? 2 : 1, plural(wrong, 'wrong check'),
      `${shown.join('; ')}${more}.`, { wrong }));
  }

  // Order of operations: a wrong check that would be true read strictly left to right.
  const slips = rep.checks.filter((c) => !c.res.true && c.ltr.true);
  if (slips.length) {
    const c = slips[0];
    out.push(finding('precedence', 'fix', 2, 'Order of operations slip',
      `${equationText(parsed, c.fill, { brackets: false })} is true only if you work strictly left to right. With x and / first, the sides are ${c.res.valid ? `${c.res.left} and ${c.res.right}` : 'not whole numbers'}.`,
      { count: slips.length }));
  }

  // Trial and error.
  const medGap = rep.gaps.length ? median(rep.gaps) : null;
  const guessing = rep.swaps >= Math.max(3, 2 * blanks) || wrong >= 3 || (wrong >= 2 && medGap !== null && medGap < 2000);
  if (guessing) {
    out.push(finding('guessing', 'fix', rep.swaps >= 3 * blanks || wrong >= 4 ? 3 : 2, 'Trial and error',
      `You changed tiles ${plural(rep.swaps, 'time')} and checked ${plural(wrong, 'wrong answer')}${medGap !== null ? `, about one action every ${sec(medGap)}` : ''}. That pattern is guessing, not working the blanks out.`,
      { swaps: rep.swaps, wrong, medianGapMs: medGap }));
  }

  // Decoys tried.
  const decoysTried = [...new Set(rep.placements.filter((p) => !usedDigits.has(p.d)).map((p) => p.d))];
  if (decoysTried.length) {
    const inCheck = rep.checks.some((c) => c.fill.some((d) => d !== null && !usedDigits.has(d)));
    out.push(finding('decoy', inCheck ? 'fix' : 'info', inCheck ? 1 : 0, `Decoy ${decoysTried.length === 1 ? 'tile' : 'tiles'} tried`,
      `You placed ${listAnd(decoysTried.map(String))}, which no answer uses${inCheck ? ', and checked an answer with a decoy in it' : ''}.`,
      { decoys: decoysTried }));
  }
  const wrongTiles = rep.placements.filter((p) => usedDigits.has(p.d) && !slotDigits[p.slot].has(p.d)).length;

  // First placement.
  const first = rep.firstPlaceMs;
  if (first !== null) {
    const base = latencyBaseline(attempt, history);
    const rushed = wrong > 0 || extra >= blanks;
    if (base && base.ms > 0) {
      const ratio = first / base.ms;
      const where = base.scope === 'puzzle' ? 'this puzzle' : `set ${attempt.set}`;
      const data = { firstMs: first, medianMs: base.ms, ratio, scope: base.scope };
      if (ratio >= 1.75 && first - base.ms >= 3000) {
        out.push(finding('latency-slow', 'fix', ratio >= 3 ? 2 : 1, 'Slow first placement', `Your first tile went down after ${sec(first)}, ${ratio.toFixed(1)}x your median of ${sec(base.ms)} for ${where} (${base.n} attempts).`, data));
      } else if (ratio <= 0.5 && rushed) {
        out.push(finding('latency-rushed', 'fix', 1, 'Placed before thinking', `Your first tile went down after ${sec(first)}, half your usual ${sec(base.ms)}, and the puzzle then needed extra tiles or checks.`, data));
      } else {
        out.push(finding('latency', 'info', 0, 'First placement', `First tile after ${sec(first)} (your median for ${where}: ${sec(base.ms)}).`, data, ''));
      }
    } else if (first > paceMs * 0.75 && first > 4000) {
      out.push(finding('latency-slow', 'fix', 1, 'Slow first placement', `Your first tile went down after ${sec(first)}, against a pace guide of ${paceSec} s for the whole puzzle.`, { firstMs: first }));
    } else if (first < 1500 && rushed) {
      out.push(finding('latency-rushed', 'fix', 1, 'Placed before thinking', `Your first tile went down after only ${sec(first)}, and the puzzle then needed extra tiles or checks.`, { firstMs: first }));
    }
  }

  // Time against the pace guide.
  if (solved) {
    if (totalMs > 2 * paceMs) {
      out.push(finding('time-slow', 'fix', totalMs > 3 * paceMs ? 2 : 1, 'Slow solve', `Solved in ${sec(totalMs)}, over twice the pace guide of ${paceSec} s.`, { totalMs }));
    } else {
      out.push(finding('time', totalMs <= paceMs ? 'good' : 'info', 0, 'Time', `Solved in ${sec(totalMs)} against a pace guide of ${paceSec} s.`, { totalMs }, ''));
    }
  }

  if (rep.hints > 0) {
    out.push(finding('hints', 'info', 1, plural(rep.hints, 'hint') + ' used', `You asked for ${plural(rep.hints, 'hint')}. The score still counts, but try it again unaided.`, { hints: rep.hints }));
  }

  if (outcome === 'skipped') {
    const kind = totalMs > 2 * paceMs ? 'skip-late' : totalMs < 0.25 * paceMs && placed === 0 ? 'skip-early' : null;
    if (kind === 'skip-late') out.push(finding('skip-late', 'fix', 2, 'Late skip', `Skipped after ${sec(totalMs)}, past twice the pace guide (${2 * paceSec} s): that time scored nothing.`, { totalMs }));
    else if (kind === 'skip-early') out.push(finding('skip-early', 'fix', 1, 'Early skip', `Skipped after ${sec(totalMs)} without placing a tile.`, { totalMs }));
    else out.push(finding('skip', 'info', 0, 'Skip', `Skipped after ${sec(totalMs)}: that gives up the 1 point this puzzle was worth.`, { totalMs }, 'Skipping is fine when no blank gives way within about half the pace guide.'));
  } else if (outcome === 'timeout') {
    out.push(finding('timeout', 'fix', 1, 'Cut off by time', `Time ran out ${sec(totalMs)} into this puzzle, with ${plural(rep.fill.filter((d) => d !== null).length, 'blank')} filled.`, { totalMs }));
  }

  const order = { fix: 0, good: 1, info: 2 };
  out.sort((a, b) => order[a.kind] - order[b.kind] || b.severity - a.severity);
  return {
    findings: out,
    stats: { placed, blanks, wrong, swaps: rep.swaps, clears: rep.clears, resets: rep.resets, hints: rep.hints, firstPlaceMs: first, totalMs, medianGapMs: medGap, decoysTried, wrongTiles },
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

// run: recorder.summarizeRun record. attempts: matching attempt records. puzzles: Map or object id -> puzzle.
export function coachRun(run, attempts = [], puzzles = {}, { paceSec = 30, budgetMs = RUN_BUDGET_MS, history = [] } = {}) {
  const getPuzzle = (id) => (puzzles instanceof Map ? puzzles.get(id) : puzzles[id]);
  const rows = run.puzzles;
  const paceMs = paceSec * 1000;
  const lines = [];
  if (!rows.length) {
    lines.push({ id: 'empty', kind: 'info', title: 'No puzzles finished', text: 'The run ended before any puzzle was finished.', tip: 'Start the next run by testing one units digit straight away.' });
    return { lines, habits: [], perPuzzle: [] };
  }
  const byId = new Map(attempts.map((a) => [a.id, a]));
  const lists = [];
  const stats = [];
  for (const r of rows) {
    const a = byId.get(r.attemptId);
    const p = getPuzzle(r.puzzleId);
    if (!a || !p) continue;
    const res = coachPuzzle(a, p, { history, paceSec });
    lists.push(res.findings);
    stats.push({ row: r, ...res.stats });
  }

  const times = rows.map((r) => r.totalMs);
  const solvedRows = rows.filter((r) => r.outcome === 'solved');
  const avgMs = mean(times);
  const slowest = rows.reduce((a, b) => (b.totalMs > a.totalMs ? b : a));
  lines.push({
    id: 'time-per-puzzle',
    kind: avgMs > 1.5 * paceMs ? 'fix' : 'info',
    title: 'Time per puzzle',
    text: `Average ${sec(avgMs)} per puzzle (median ${sec(median(times))}) against a pace guide of ${paceSec} s.` +
      (solvedRows.length ? ` Solved puzzles took ${sec(mean(solvedRows.map((r) => r.totalMs)))} on average.` : '') +
      ` Slowest: puzzle ${rows.indexOf(slowest) + 1} at ${sec(slowest.totalMs)}.`,
    tip: avgMs > 1.5 * paceMs ? `Aim for about ${paceSec} s: last digit first, then estimate, then undo the operations.` : 'Pace per puzzle is in a good range.',
    data: { avgMs, medianMs: median(times) },
  });

  // Accuracy.
  const wrongTotal = stats.reduce((s, x) => s + x.wrong, 0);
  const firstTry = stats.filter((x) => x.row.outcome === 'solved' && x.wrong === 0).length;
  const guessers = lists.filter((l) => l.some((f) => f.id === 'guessing')).length;
  lines.push({
    id: 'accuracy',
    kind: wrongTotal > rows.length / 2 || guessers >= 2 ? 'fix' : 'good',
    title: 'Accuracy',
    text: `Solved ${solvedRows.length} of ${rows.length}; ${firstTry} on the first check. ${plural(wrongTotal, 'wrong check')} in total${guessers ? `, and trial and error on ${plural(guessers, 'puzzle')}` : ''}.`,
    tip: wrongTotal ? 'Test a fill before pressing Check: does the last digit match, is the size right?' : 'No wrong checks: keep checking in your head first.',
    data: { wrongTotal, firstTry, guessers },
  });

  // Skip policy.
  const indexed = rows.map((r, i) => ({ ...r, i: i + 1 }));
  const skips = indexed.filter((r) => r.outcome === 'skipped');
  const late = skips.filter((r) => r.totalMs > 2 * paceMs);
  const early = skips.filter((r) => r.totalMs < 0.25 * paceMs && r.grossMoves === 0);
  const stuck = indexed.filter((r) => r.outcome !== 'skipped' && r.totalMs > 3 * paceMs);
  const parts = [];
  let skipKind = 'good';
  if (late.length) {
    skipKind = 'fix';
    parts.push(`Skipped too late on ${plural(late.length, 'puzzle')} (${late.map((r) => `#${r.i} after ${sec(r.totalMs)}`).join(', ')}): ${sec(late.reduce((s, r) => s + r.totalMs, 0))} spent for no score.`);
  }
  if (early.length) {
    skipKind = 'fix';
    parts.push(`Skipped too early on ${plural(early.length, 'puzzle')} (${early.map((r) => `#${r.i} after ${sec(r.totalMs)}`).join(', ')}) without placing a tile.`);
  }
  if (stuck.length) {
    skipKind = 'fix';
    parts.push(`Held on past 3x the pace guide on ${plural(stuck.length, 'puzzle')} (${stuck.map((r) => `#${r.i} ${sec(r.totalMs)}`).join(', ')}); skipping at 2x would have freed ${sec(stuck.reduce((s, r) => s + r.totalMs - 2 * paceMs, 0))}.`);
  }
  if (!parts.length) parts.push(skips.length ? `${plural(skips.length, 'skip')}, all at sensible times.` : 'No skips, and no puzzle ran far past the pace guide.');
  lines.push({
    id: 'skip-policy',
    kind: skipKind,
    title: 'Skip policy',
    text: parts.join(' '),
    tip: `Skip rule for this set: skip if no blank gives way after about ${Math.round(paceSec / 2)} s, and at the latest at ${2 * paceSec} s.`,
    data: { skips: skips.length, late: late.length, early: early.length, stuck: stuck.length },
  });

  // Pace against the budget.
  const atPace = Math.floor(budgetMs / paceMs);
  const avgEff = run.score / rows.length;
  const perMin = run.score / (Math.max(1, run.durationMs || budgetMs) / 60000);
  let paceKind = 'good';
  let paceTip = 'You are on pace for the 6:00 budget. Keep the same rhythm.';
  if (rows.length < 0.7 * atPace) {
    paceKind = 'fix';
    paceTip = `To reach about ${atPace} puzzles in 6:00, pin down the easy blanks faster and use the skip rule on hard ones.`;
  } else if (rows.length > 1.4 * atPace && avgEff < 0.6) {
    paceKind = 'fix';
    paceTip = 'You are moving fast but losing score to swaps and wrong checks. One more second of thought per blank pays off.';
  }
  lines.push({
    id: 'pace',
    kind: paceKind,
    title: 'Pace against the 6:00 budget',
    text: `You reached ${plural(rows.length, 'puzzle')} in ${Math.round(budgetMs / 60000)}:00; at the ${paceSec} s pace guide that would be about ${atPace}. Score ${run.score.toFixed(2)} (${perMin.toFixed(2)} per minute), average efficiency ${Math.round(avgEff * 100)}%.`,
    tip: paceTip,
    data: { reached: rows.length, atPace, perMin, avgEff },
  });

  return { lines, habits: topHabits(lists), perPuzzle: lists };
}
