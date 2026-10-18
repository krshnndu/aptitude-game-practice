// Grid Memory coach (pure, no DOM). Replays an attempt's event log against the trial and turns
// measured facts into findings, each with a plain-English suggestion:
//   recall errors split into order errors (right cell, wrong position) and location errors (a cell
//   that never lit), where in the sequence they fall (start against end: primacy and recency),
//   side question accuracy, time-outs and fast guesses, the trade-off between the two tasks,
//   time per recalled item and the longest hesitation, wasted steps (repeat taps, undo, hints),
//   and the cost of a skip or a time-out.
// coachRun() adds run-level coaching for a timed run: span reached on the staircase, the task
// trade-off, the error curve by serial position, order against location errors, time per trial,
// side question speed, skip policy and the top 3 habits to fix.

import { replayLog, scoreTrial, cellLabel, POINTS } from './state.js';
import { trialFromId } from './gen.js';
import { median, mean } from '../../core/analytics.js';

export const RUN_BUDGET_MS = 6 * 60 * 1000;
// Side answers faster than this that are wrong look like guesses.
export const GUESS_MS = 600;

export const HABITS = {
  'order-errors': {
    label: 'Losing the order',
    tip: 'Link each cell to the next as a movement ("then 2 down") and rehearse the whole chain, not just the cells.',
  },
  'location-errors': {
    label: 'Tapping cells that never lit',
    tip: 'Name a landmark for each cell the moment it lights (corner, edge, centre) before the side question takes over.',
  },
  'early-errors': {
    label: 'Losing the first cells',
    tip: 'Keep saying the path from cell 1 every time: the first cells fade when you only rehearse the newest one.',
  },
  'late-errors': {
    label: 'Losing the last cells',
    tip: 'Attach each new cell to the chunk you already hold ("and then the corner"); the last side question can wipe a cell held on its own.',
  },
  'short-recall': {
    label: 'Submitting with positions empty',
    tip: 'Fill every position: positions score separately, so a best guess can still earn points.',
  },
  'side-dropped': {
    label: 'Dropping the side questions',
    tip: 'Side questions are 30% of each trial. Give each a real look, then go back to rehearsing.',
  },
  'side-timeout': {
    label: 'Side questions timing out',
    tip: 'Answer first and rehearse after. An answer that times out scores 0 and still costs the whole window.',
  },
  'side-guess': {
    label: 'Guessing side questions',
    tip: 'Very fast wrong answers look like guesses. Half a second more for a real check is worth it.',
  },
  'side-overfocus': {
    label: 'Side task crowding out memory',
    tip: 'You are slow and careful on the side task while recall suffers. Answer at a steady pace and use the spare time to rehearse.',
  },
  'wasted-steps': {
    label: 'Wasted taps',
    tip: 'Say the next cell to yourself before you tap. Repeat taps and undo cost time in a timed run.',
  },
  hint: {
    label: 'Relying on hints',
    tip: 'Hinted positions score 0, and the timed run has none. Try the same trial again without them.',
  },
  'skip-cost': {
    label: 'Skipping instead of guessing',
    tip: 'A skipped trial scores 0, but every position and side question scores on its own. Finish with your best guess.',
  },
  timeout: {
    label: 'Running out of time mid-trial',
    tip: 'In the last 30 seconds a long trial may not finish. It scores 0 either way, so keep going and do not rush.',
  },
};

const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const pctText = (x) => `${Math.round(x * 100)}%`;
const listAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function finding(id, kind, severity, title, detail, data = {}, tip = HABITS[id]?.tip ?? '') {
  return { id, kind, severity, title, detail, tip, data };
}

const OUTCOME_FROM_RECORDER = { solved: 'submitted', skipped: 'skipped', timeout: 'timeout' };

// Thirds of a sequence: which serial positions count as start and end.
export function serialBuckets(length) {
  const k = Math.max(1, Math.floor(length / 3));
  return { first: [0, k - 1], last: [length - k, length - 1] };
}

// Time per recalled item: from the recall grid appearing to the last tap, over the taps made.
export function recallTiming(log) {
  if (log.recallStart === null || !log.tapTimes.length) return { firstTapMs: null, perItemMs: null, longestGapMs: null, longestGapAt: null };
  const times = [log.recallStart, ...log.tapTimes];
  let longest = 0;
  let at = null;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > longest) {
      longest = gap;
      at = i - 1;
    }
  }
  return {
    firstTapMs: log.tapTimes[0] - log.recallStart,
    perItemMs: (log.tapTimes[log.tapTimes.length - 1] - log.recallStart) / log.tapTimes.length,
    longestGapMs: longest,
    longestGapAt: at,
  };
}

// Replay plus score for one attempt.
export function reviewAttempt(attempt, puzzle) {
  const log = replayLog(puzzle, attempt.events || []);
  const outcome = log.outcome ?? OUTCOME_FROM_RECORDER[attempt.outcome] ?? 'submitted';
  const result = scoreTrial(puzzle, { recall: log.recall, hinted: log.hinted, answers: log.answers, outcome });
  const rts = log.answers.filter((a) => a && a.answer !== 'miss' && Number.isFinite(a.rt)).map((a) => a.rt);
  return { log, result, timing: recallTiming(log), sideRtMedian: rts.length ? median(rts) : null };
}

function perItemBaseline(attempt, history, minN = 3) {
  const vals = [];
  for (const a of history) {
    if (a.id === attempt.id || a.set !== attempt.set || a.outcome !== 'solved') continue;
    const evs = a.events || [];
    const start = evs.find((e) => e.type === 'select' && e.d === 'recall');
    const taps = evs.filter((e) => e.type === 'move');
    if (!start || !taps.length) continue;
    vals.push((taps[taps.length - 1].t - start.t) / taps.length);
  }
  return vals.length >= minN ? { ms: median(vals), n: vals.length } : null;
}

// attempt: a recorder attempt record. puzzle: the trial played.
export function coachTrial(attempt, puzzle, { history = [] } = {}) {
  const { log, result, timing, sideRtMedian } = reviewAttempt(attempt, puzzle);
  const findings = [];
  const L = puzzle.length;
  const rec = result.recall;
  const side = result.side;
  const n = puzzle.n;

  // ---- skip and time-out
  if (result.outcome === 'skipped') {
    const where = log.endPhase === 'recall'
      ? `during recall, after entering ${plural(log.recall.length, 'cell')} of ${L}`
      : `while the sequence was still running (after cell ${Math.min(L, (log.endStep ?? 0) + 1)} of ${L})`;
    const couldHave = rec.correct * POINTS.recall + side.correct * POINTS.side;
    findings.push(finding('skip-cost', 'fix', 2, 'Skipped: trial scores 0',
      `You skipped ${where} at ${sec(log.endT)}.` +
      (couldHave > 0 ? ` What you had entered by then was worth ${couldHave} of ${result.maxPoints} points if submitted.` : ''),
      { phase: log.endPhase, couldHave }));
  } else if (result.outcome === 'timeout') {
    findings.push(finding('timeout', 'info', 1, 'Time ran out mid-trial', `The run clock ended during the ${log.endPhase ?? 'trial'} phase. The trial scores 0.`));
  }

  // ---- recall
  const answeredRecall = result.outcome === 'submitted' || log.recall.length > 0;
  if (answeredRecall) {
    if (rec.perfect) {
      findings.push(finding('recall-perfect', 'good', 0, 'Every position right', `All ${L} cells recalled in order.`, {}, ''));
    } else {
      const errs = rec.positions.filter((p) => p.status !== 'ok');
      const order = errs.filter((p) => p.status === 'order');
      const wrong = errs.filter((p) => p.status === 'wrong');
      const missing = errs.filter((p) => p.status === 'missing');
      if (order.length) {
        findings.push(finding('order-errors', 'fix', order.length,
          `Order lost on ${plural(order.length, 'position')}`,
          `${listAnd(order.map((p) => `position ${p.i + 1} got ${cellLabel(n, p.got)} (cell ${p.belongsAt + 1} of the sequence)`))}. You remembered these cells but not when they lit.`,
          { positions: order.map((p) => p.i) }));
      }
      if (wrong.length) {
        findings.push(finding('location-errors', 'fix', wrong.length,
          `${plural(wrong.length, 'cell')} that never lit`,
          `${listAnd(wrong.map((p) => `position ${p.i + 1}: you tapped ${cellLabel(n, p.got)}, it was ${cellLabel(n, p.expected)}`))}.`,
          { positions: wrong.map((p) => p.i) }));
      }
      if (missing.length && result.outcome === 'submitted') {
        findings.push(finding('short-recall', 'fix', 1, `${plural(missing.length, 'position')} left empty`,
          `You submitted ${log.recall.length} of ${L} cells. Empty positions always score 0.`));
      }
      // Serial position: where in the sequence the errors fall.
      if (L >= 4 && result.outcome === 'submitted') {
        const { first, last } = serialBuckets(L);
        const inRange = ([a, b]) => errs.filter((p) => p.i >= a && p.i <= b).length;
        const early = inRange(first);
        const late = inRange(last);
        if (early > 0 && late === 0 && early >= errs.length / 2) {
          findings.push(finding('early-errors', 'fix', 1, 'Errors at the start of the sequence',
            `${plural(early, 'error')} in positions ${first[0] + 1} to ${first[1] + 1} and none in the last positions: the first cells faded while you held the later ones.`));
        } else if (late > 0 && early === 0 && late >= errs.length / 2) {
          findings.push(finding('late-errors', 'fix', 1, 'Errors at the end of the sequence',
            `${plural(late, 'error')} in positions ${last[0] + 1} to ${last[1] + 1} and none at the start: the newest cells were not tied into the path before the next side question.`));
        }
      }
    }
  }

  // ---- side questions
  const reached = log.answers.filter(Boolean);
  if (reached.length) {
    const misses = reached.filter((a) => a.answer === 'miss').length;
    const guesses = reached.filter((a) => a.answer !== 'miss' && !a.ok && Number.isFinite(a.rt) && a.rt < GUESS_MS).length;
    const sideAcc = reached.filter((a) => a.ok).length / reached.length;
    if (misses) {
      findings.push(finding('side-timeout', 'fix', misses, `${plural(misses, 'side question')} timed out`,
        `The ${sec(puzzle.windowMs)} window ran out ${misses === 1 ? 'once' : `${misses} times`}. Each counts as a wrong answer.`));
    }
    if (guesses) {
      findings.push(finding('side-guess', 'fix', guesses, `${plural(guesses, 'fast wrong answer')}`,
        `Wrong in under ${sec(GUESS_MS)}: too quick for a real check of the shape or sum.`));
    }
    if (reached.length >= 2 && sideAcc < 2 / 3) {
      findings.push(finding('side-dropped', 'fix', 2, `Side questions ${pctText(sideAcc)} right`,
        rec.accuracy >= 0.8
          ? `Recall was ${pctText(rec.accuracy)}: memory was protected at the cost of the side task.`
          : `Both tasks slipped (recall ${pctText(rec.accuracy)}). At this length, aim for accuracy on both first.`));
    } else if (sideAcc === 1 && reached.length === L) {
      findings.push(finding('side-perfect', 'good', 0, 'Every side question right',
        sideRtMedian !== null ? `Median answer time ${sec(sideRtMedian)} of the ${sec(puzzle.windowMs)} window.` : 'All answered in time.', {}, ''));
    }
    if (result.outcome === 'submitted' && rec.accuracy < 0.5 && sideAcc >= 0.9 && sideRtMedian !== null && sideRtMedian > 0.6 * puzzle.windowMs) {
      findings.push(finding('side-overfocus', 'fix', 1, 'Careful side answers, weak recall',
        `Median side answer ${sec(sideRtMedian)} (${pctText(sideRtMedian / puzzle.windowMs)} of the window) with recall at ${pctText(rec.accuracy)}.`));
    }
  }

  // ---- time per item
  if (timing.perItemMs !== null) {
    const base = perItemBaseline(attempt, history);
    const baseText = base ? ` Your usual pace in this set: ${sec(base.ms)} per cell (median of ${base.n}).` : '';
    const gapCell = timing.longestGapAt;
    const brokeThere = gapCell !== null && rec.positions[gapCell] && rec.positions[gapCell].status !== 'ok';
    findings.push(finding('recall-pace', 'info', 0, 'Recall pace',
      `First tap ${sec(timing.firstTapMs)} after the grid appeared, ${sec(timing.perItemMs)} per cell on average.` +
      (timing.longestGapMs > 3000 ? ` Longest pause ${sec(timing.longestGapMs)} before position ${gapCell + 1}${brokeThere ? ', and that position was wrong: that is where the path broke' : ''}.` : '') +
      baseText,
      { ...timing, baseline: base?.ms ?? null },
      timing.longestGapMs > 3000 ? 'When you stall, tap the cells you are sure of in the remaining path, then fill the gap.' : ''));
  }

  // ---- wasted steps
  const wasted = log.repeats + log.undos;
  if (wasted) {
    findings.push(finding('wasted-steps', log.repeats >= 2 || log.undos >= 2 ? 'fix' : 'info', wasted,
      `${plural(wasted, 'wasted step')}`,
      [log.repeats ? `${plural(log.repeats, 'repeat tap')} on a cell already entered` : '', log.undos ? `${plural(log.undos, 'undo')}` : ''].filter(Boolean).join(' and ') + '.'));
  }
  if (log.hints) {
    findings.push(finding('hint', 'fix', log.hints, `${plural(log.hints, 'hint')} used`, `Hinted positions score 0 (${plural(rec.hints, 'position')} given).`));
  }
  return { findings, result, log, timing, sideRtMedian };
}

// ---------------------------------------------------------------- run level

export function topHabits(findingLists, top = 3) {
  const agg = new Map();
  findingLists.forEach((list, i) => {
    const seen = new Set();
    for (const f of list) {
      if (f.kind !== 'fix' || !HABITS[f.id]) continue;
      const h = agg.get(f.id) ?? { id: f.id, label: HABITS[f.id].label, tip: HABITS[f.id].tip, weight: 0, count: 0, trials: [] };
      h.weight += f.severity;
      if (!seen.has(f.id)) {
        h.count++;
        h.trials.push(i);
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

// Error rate by serial position bucket over submitted trials of length 3 or more.
export function serialCurve(reviews) {
  const tally = { first: [0, 0], middle: [0, 0], last: [0, 0] };
  for (const { result } of reviews) {
    if (result.outcome !== 'submitted' || result.recall.total < 3) continue;
    const L = result.recall.total;
    const { first, last } = serialBuckets(L);
    for (const p of result.recall.positions) {
      const b = p.i <= first[1] ? 'first' : p.i >= last[0] ? 'last' : 'middle';
      tally[b][1]++;
      if (p.status !== 'ok') tally[b][0]++;
    }
  }
  const rate = ([e, t]) => (t ? e / t : null);
  return { first: rate(tally.first), middle: rate(tally.middle), last: rate(tally.last), counts: tally };
}

// run: run record (recorder.summarizeRun plus maxSpan and trail). attempts: its attempt records.
// puzzles: Map or object puzzleId -> puzzle (generated trials are rebuilt from their id if missing).
export function coachRun(run, attempts = [], puzzles = {}, { budgetMs = RUN_BUDGET_MS, history = [] } = {}) {
  const getPuzzle = (id) => (puzzles instanceof Map ? puzzles.get(id) : puzzles[id]) ?? trialFromId(id);
  const rows = run.puzzles || [];
  const lines = [];
  if (!rows.length) {
    lines.push({ id: 'empty', kind: 'info', title: 'No trials finished', text: 'The run ended before any trial was finished.', tip: 'Start the next run and keep going until the clock ends.' });
    return { lines, habits: [], perTrial: [] };
  }
  const byId = new Map(attempts.map((a) => [a.id, a]));
  const reviews = [];
  const lists = [];
  for (const r of rows) {
    const a = byId.get(r.attemptId);
    const p = getPuzzle(r.puzzleId);
    if (!a || !p) continue;
    const c = coachTrial(a, p, { history });
    reviews.push({ ...c, puzzle: p, attempt: a });
    lists.push(c.findings);
  }

  // Span.
  const trail = run.trail || [];
  const span = run.maxSpan ?? 0;
  const passes = trail.filter((s) => s.success).length;
  lines.push({
    id: 'span',
    kind: span ? 'good' : 'fix',
    title: span ? `Span reached: ${span}` : 'No trial passed',
    text: `Lengths played: ${trail.map((s) => `${s.length}${s.success ? ' pass' : ' miss'}`).join(', ') || 'none'}. ${passes} of ${trail.length} passed (every position right and at most 1 side error).`,
    tip: span ? 'The staircase settles where you pass about half the trials: that length is your current span under load.' : 'Start each trial by naming the first cell aloud in your head; aim for a perfect short trial before speed.',
    data: { span, passes, played: trail.length },
  });

  const submitted = reviews.filter((r) => r.result.outcome === 'submitted');
  if (submitted.length) {
    // Trade-off between the two tasks.
    const recAcc = mean(submitted.map((r) => r.result.recall.accuracy));
    const sideAcc = mean(submitted.map((r) => r.result.side.accuracy));
    let kind = 'good';
    let text = `Recall ${pctText(recAcc)} against side questions ${pctText(sideAcc)} on average.`;
    let tip = 'Both tasks are holding up: keep the same split of attention.';
    if (sideAcc < 0.7 && recAcc >= 0.75) {
      kind = 'fix';
      text += ' You protect memory by letting the side task slide.';
      tip = HABITS['side-dropped'].tip;
    } else if (recAcc < 0.6 && sideAcc >= 0.9) {
      kind = 'fix';
      text += ' The side task gets your full attention and recall pays for it.';
      tip = HABITS['side-overfocus'].tip;
    } else if (recAcc < 0.6 && sideAcc < 0.7) {
      kind = 'fix';
      text += ' Both tasks slip together: the lengths reached are past your current span.';
      tip = 'Accuracy first: a passed trial at length 4 scores more than two failed ones at 6.';
    }
    lines.push({ id: 'trade-off', kind, title: 'Memory against side questions', text, tip, data: { recAcc, sideAcc } });

    // Serial position curve.
    const curve = serialCurve(submitted);
    if (curve.first !== null && curve.last !== null) {
      const parts = [['start', curve.first], ['middle', curve.middle], ['end', curve.last]].filter(([, v]) => v !== null);
      let ckind = 'info';
      let ctip = 'Errors are spread evenly across the sequence.';
      if (curve.first > curve.last + 0.15) {
        ckind = 'fix';
        ctip = HABITS['early-errors'].tip;
      } else if (curve.last > curve.first + 0.15) {
        ckind = 'fix';
        ctip = HABITS['late-errors'].tip;
      }
      lines.push({
        id: 'serial',
        kind: ckind,
        title: 'Where errors fall in the sequence',
        text: `Error rate by position: ${parts.map(([k, v]) => `${k} ${pctText(v)}`).join(', ')}.` +
          (curve.first > curve.last + 0.15 ? ' Weak start (low primacy): early cells fade.' : curve.last > curve.first + 0.15 ? ' Weak end (low recency): late cells are lost.' : ''),
        tip: ctip,
        data: curve,
      });
    }

    // Order against location errors.
    const order = submitted.reduce((s, r) => s + r.result.recall.order, 0);
    const wrong = submitted.reduce((s, r) => s + r.result.recall.wrong, 0);
    if (order + wrong) {
      lines.push({
        id: 'error-types',
        kind: 'fix',
        title: 'Order errors against location errors',
        text: `${plural(order, 'order error')} (right cell, wrong position) and ${plural(wrong, 'location error')} (a cell that never lit).`,
        tip: order >= wrong ? HABITS['order-errors'].tip : HABITS['location-errors'].tip,
        data: { order, wrong },
      });
    }
  }

  // Time per trial and side speed. The trial cut off by the clock says nothing about pace.
  const times = rows.filter((r) => r.outcome !== 'timeout').map((r) => r.totalMs);
  const rts = reviews.flatMap((r) => r.log.answers.filter((a) => a && a.answer !== 'miss' && Number.isFinite(a.rt)).map((a) => a.rt));
  const misses = reviews.reduce((s, r) => s + r.log.answers.filter((a) => a && a.answer === 'miss').length, 0);
  const windowMs = reviews[0]?.puzzle.windowMs ?? null;
  lines.push({
    id: 'time',
    kind: misses ? 'fix' : 'info',
    title: 'Time per trial and side question speed',
    text: (times.length ? `Average ${sec(mean(times))} per finished trial (median ${sec(median(times))}), ` : 'No trial finished before the clock ran out; ') +
      `${plural(rows.length, 'trial')} reached in ${Math.round(budgetMs / 60000)}:00.` +
      (rts.length ? ` Side answers: median ${sec(median(rts))}${windowMs ? ` of a ${sec(windowMs)} window` : ''}.` : '') +
      (misses ? ` ${plural(misses, 'side question')} timed out.` : ''),
    tip: misses ? HABITS['side-timeout'].tip : 'Trials take as long as the sequence runs; your speed shows in the side answers and the recall taps.',
    data: { avgMs: mean(times), medianRt: rts.length ? median(rts) : null, misses },
  });

  // Skip policy.
  const skips = reviews.filter((r) => r.result.outcome === 'skipped');
  if (skips.length) {
    const worth = skips.reduce((s, r) => s + r.result.recall.correct * POINTS.recall + r.result.side.correct * POINTS.side, 0);
    lines.push({
      id: 'skips',
      kind: 'fix',
      title: `${plural(skips.length, 'skip')}`,
      text: `Skipped ${skips.map((r) => `trial ${rows.findIndex((x) => x.attemptId === r.attempt.id) + 1} (${r.log.endPhase === 'recall' ? 'at recall' : 'mid-sequence'})`).join(', ')}.` +
        (worth ? ` What you had entered was worth ${worth} points, lost to the skip.` : '') +
        ' A skip also counts as a miss on the staircase.',
      tip: HABITS['skip-cost'].tip,
      data: { skips: skips.length, worth },
    });
  } else {
    lines.push({ id: 'skips', kind: 'good', title: 'No skips', text: 'Every trial was finished: partial credit counted each time.', tip: '' });
  }

  return { lines, habits: topHabits(lists), perTrial: reviews };
}
