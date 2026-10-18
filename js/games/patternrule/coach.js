// Pattern Rule coach (pure, no DOM). Turns one recorded attempt, or a whole timed run, into
// findings with plain-English suggestions. Everything is computed from the attempt's own log:
//   picks and changes of mind (replayed toggles), false picks and the rule dimension each one
//   breaks (the dimension you overlooked), misses and the surface feature that probably put you
//   off (a feature most fitting panels share but the rule does not need), time against the pace
//   guide and against your own median, hints, skip timing and time-outs.

import { atom, atomDimLabel, ATOMS, DIM_NAMES, listAnd, plural } from './rules.js';
import { gradeSelection, attemptResult, attemptPicks, letter } from './state.js';
import { median, mean } from '../../core/analytics.js';

export const RUN_BUDGET_MS = 6 * 60 * 1000;

// What to do about overlooking a dimension (false picks) or over-weighting one (misses).
export const DIM_TIPS = {
  count: 'Count the shapes in every panel before anything else; it takes a second and is easy to skip.',
  type: 'Name each shape (triangle, half-disc, arrow, drop) as you compare; similar outlines hide a different type.',
  fill: 'Look inside every shape: solid, outlined or striped. One different fill is enough to break the rule.',
  direction: 'Check where each shape points. A shape can match in type and fill but point the wrong way.',
  size: 'Compare sizes shape by shape: small shapes are a bit over half the size of large ones.',
  position: 'Check which row and column each shape sits in, not just the overall layout.',
  symmetry: 'Fold the panel along the middle line in your mind: every shape needs an identical twin on the other side, pointing the mirrored way.',
  relation: 'With two shapes, compare them with each other: same or different, where each sits, where each points.',
};

const dimKey = (dim) => (DIM_TIPS[dim] ? dim : 'relation');

export const HABITS = {
  'false-pick': { label: 'Picking candidates that break the rule', tip: 'Before you pick, check the candidate against every part of the rule, one dimension at a time.' },
  miss: { label: 'Missing candidates that fit', tip: 'A candidate can look different and still fit. Judge it only on the rule\'s dimensions and ignore everything that varies.' },
  changed: { label: 'Changing picks back and forth', tip: 'Settle the rule first, then pick. Changing picks usually means the rule was not pinned down yet.' },
  slow: { label: 'Slow answers', tip: 'Scan dimension by dimension in a fixed order; stop at the first one the fitting panels all share and the does-not-fit panels break.' },
  rushed: { label: 'Answering too fast', tip: 'Take a few seconds to say the rule to yourself before picking. A quick wrong answer scores nothing.' },
  'skip-late': { label: 'Skipping too late', tip: 'Set a skip cutoff before the run and keep to it. Time sunk into a puzzle you then skip scores nothing.' },
  'skip-early': { label: 'Skipping too early', tip: 'Give every puzzle one quick dimension scan before skipping. Each skip gives up a full point.' },
  timeout: { label: 'Running out of time mid-puzzle', tip: 'Watch the clock in the last minute. A puzzle cut off by time scores 0.' },
  'stuck-long': { label: 'Holding on to one puzzle', tip: 'When a puzzle passes twice the pace guide, skipping and taking the next one usually scores more.' },
};
for (const [dim, tip] of Object.entries(DIM_TIPS)) {
  HABITS[`overlooked-${dim}`] = { label: `Overlooking ${DIM_NAMES[dim]}`, tip };
  HABITS[`surface-${dim}`] = { label: `Treating ${DIM_NAMES[dim]} as part of the rule when it is not`, tip: `When ${DIM_NAMES[dim]} varies across the fitting panels or is shared by a does-not-fit panel, cross it off and stop looking at it.` };
}

const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;

function finding(id, kind, severity, title, detail, data = {}, tip = HABITS[id]?.tip ?? '') {
  return { id, kind, severity, title, detail, tip, data };
}

// Features most fitting panels share (at least 2 of them, or all when there are 2) that the
// rule does not use and that a missed candidate lacks: the likely reason it was left out.
export function surfaceFeatures(puzzle, i) {
  const need = Math.max(2, Math.ceil(puzzle.fits.length * 0.6));
  const ruleSet = new Set(puzzle.rule);
  const ruleDims = new Set(puzzle.rule.map((id) => atom(id).dim));
  const p = puzzle.candidates[i];
  return ATOMS.filter((a) => !ruleSet.has(a.id) && !ruleDims.has(a.dim) && !/^count-(odd|even)$/.test(a.id))
    .filter((a) => puzzle.fits.filter((f) => a.test(f)).length >= need && !a.test(p));
}

export function latencyBaseline(attempt, history = [], minN = 3) {
  const others = history.filter((a) => a.id !== attempt.id && a.game === attempt.game && Number.isFinite(a.metrics?.firstMoveMs));
  const same = others.filter((a) => a.puzzleId === attempt.puzzleId).map((a) => a.metrics.firstMoveMs);
  if (same.length >= minN) return { ms: median(same), scope: 'puzzle', n: same.length };
  const set = others.filter((a) => a.set === attempt.set).map((a) => a.metrics.firstMoveMs);
  if (set.length >= minN) return { ms: median(set), scope: 'set', n: set.length };
  return null;
}

export function coachPuzzle(attempt, puzzle, { history = [], paceSec = 30 } = {}) {
  const out = [];
  const result = attemptResult(attempt);
  const picks = attemptPicks(attempt);
  const g = gradeSelection(puzzle, picks);
  const moves = (attempt.events || []).filter((e) => e.type === 'move');
  const offs = moves.filter((e) => e.d === 'off').length;
  const m = attempt.metrics ?? {};
  const totalMs = m.totalMs ?? 0;
  const paceMs = paceSec * 1000;
  const answered = result === 'correct' || result === 'wrong';

  if (result === 'correct') {
    out.push(finding('correct', 'good', 0, 'Correct', `You picked exactly the ${plural(puzzle.answer.length, 'candidate')} that ${puzzle.answer.length === 1 ? 'fits' : 'fit'}, in ${sec(totalMs)}.`, {}, 'Keep the same routine: scan the dimensions, name the rule, then test each candidate.'));
  }

  if (answered && g.falsePicks.length) {
    out.push(finding('false-pick', 'fix', 2, plural(g.falsePicks.length, 'wrong pick'),
      `You picked ${listAnd(g.falsePicks.map(letter))}, which ${g.falsePicks.length === 1 ? 'breaks' : 'break'} the rule.`, { candidates: g.falsePicks }));
    // The dimension each wrong pick breaks: what was overlooked.
    const byDim = new Map();
    for (const i of g.falsePicks) {
      const broken = puzzle.violates?.[i]?.length ? puzzle.violates[i] : puzzle.rule.filter((id) => !atom(id).test(puzzle.candidates[i]));
      for (const id of broken) {
        const dim = dimKey(atom(id).dim);
        if (!byDim.has(dim)) byDim.set(dim, []);
        byDim.get(dim).push({ i, id });
      }
    }
    for (const [dim, list] of byDim) {
      const why = list.map(({ i, id }) => `${letter(i)}: ${atom(id).why(puzzle.candidates[i])}`).join('; ');
      out.push(finding(`overlooked-${dim}`, 'fix', 2, `Overlooked: ${DIM_NAMES[dim]}`,
        `${listAnd(list.map((x) => letter(x.i)))} ${list.length === 1 ? 'breaks' : 'break'} the ${atomDimLabel(list[0].id)} part of the rule (${why}). The rule needs ${list.map((x) => atom(x.id).clause).filter((c, k, a) => a.indexOf(c) === k).join(', and ')}.`,
        { dim, candidates: list.map((x) => x.i) }));
    }
  }

  if (answered && g.misses.length) {
    out.push(finding('miss', 'fix', 2, plural(g.misses.length, 'missed candidate'),
      `You left out ${listAnd(g.misses.map(letter))}, which ${g.misses.length === 1 ? 'fits' : 'fit'} the rule.`, { candidates: g.misses }));
    const byDim = new Map();
    for (const i of g.misses) {
      const feats = surfaceFeatures(puzzle, i);
      if (!feats.length) continue;
      const dim = dimKey(feats[0].dim);
      if (!byDim.has(dim)) byDim.set(dim, []);
      byDim.get(dim).push({ i, a: feats[0] });
    }
    for (const [dim, list] of byDim) {
      out.push(finding(`surface-${dim}`, 'fix', 1, `Put off by ${DIM_NAMES[dim]}`,
        `${listAnd(list.map((x) => letter(x.i)))} ${list.length === 1 ? 'fits' : 'fit'} even though most fitting panels share something ${list.length === 1 ? 'it lacks' : 'they lack'} (${list[0].a.clause}). ${DIM_NAMES[dim][0].toUpperCase()}${DIM_NAMES[dim].slice(1)} is not part of the rule here.`,
        { dim, candidates: list.map((x) => x.i) }));
    }
  }

  if (offs >= 2) {
    out.push(finding('changed', offs >= 4 ? 'fix' : 'info', 1, `Changed picks ${plural(offs, 'time')}`,
      `You made ${plural(moves.length, 'pick or unpick', 'picks and unpicks')} for ${plural(picks.length, 'final pick')}; ${plural(offs, 'pick was', 'picks were')} taken back.`, { offs, toggles: moves.length }));
  }

  // Time.
  const firstMs = m.firstMoveMs ?? null;
  if (answered) {
    if (totalMs > 2 * paceMs) {
      out.push(finding('slow', 'fix', totalMs > 3 * paceMs ? 2 : 1, 'Slow answer', `This took ${sec(totalMs)}, ${(totalMs / paceMs).toFixed(1)}x the ${paceSec} s pace guide.`, { totalMs, paceMs }));
    } else if (result === 'wrong' && totalMs < 0.35 * paceMs) {
      out.push(finding('rushed', 'fix', 1, 'Rushed answer', `You answered after ${sec(totalMs)}, under a third of the ${paceSec} s pace guide, and missed the rule.`, { totalMs, paceMs }));
    }
  }
  if (firstMs !== null) {
    const base = latencyBaseline(attempt, history);
    const vs = base ? `; your median is ${sec(base.ms)} for ${base.scope === 'puzzle' ? 'this puzzle' : `set ${attempt.set}`} (${base.n} attempts)` : '. A personal median appears after 3 attempts in this set';
    out.push(finding('first-pick', 'info', 0, 'Thinking time', `First pick after ${sec(firstMs)}${vs}.`, { firstMs, medianMs: base?.ms ?? null }, ''));
  }

  if (attempt.hintsUsed) {
    out.push(finding('hints', 'info', 0, plural(attempt.hintsUsed, 'hint'), `You used ${plural(attempt.hintsUsed, 'hint')} on this puzzle.`, { count: attempt.hintsUsed }, 'Try it again without hints before moving on.'));
  }

  if (result === 'skipped') {
    const data = { spentMs: totalMs, paceMs, picks: picks.length };
    if (totalMs > 2 * paceMs) {
      out.push(finding('skip-late', 'fix', totalMs > 3 * paceMs ? 3 : 2, 'Skipped late',
        `You spent ${sec(totalMs)} (${(totalMs / paceMs).toFixed(1)}x the ${paceSec} s pace guide) and then skipped: that time scored nothing.`, data));
    } else if (totalMs < 0.25 * paceMs && moves.length === 0) {
      out.push(finding('skip-early', 'fix', 1, 'Skipped early', `You skipped after ${sec(totalMs)} without picking anything, giving up the point this puzzle was worth.`, data));
    } else {
      out.push(finding('skip-cost', 'info', 1, 'Skip cost', `Skipping after ${sec(totalMs)} gave up the 1 point this puzzle was worth.`, data, 'If you skip, skip early; once the rule is clear, answer.'));
    }
    if (picks.length && gradeSelection(puzzle, picks).exact) {
      out.push(finding('was-right', 'info', 0, 'Your picks were right', `Your picks when you skipped (${listAnd(picks.map(letter))}) were exactly the answer.`, {}, 'Trust a rule you have checked: submit it.'));
    }
  } else if (result === 'timeout') {
    out.push(finding('timeout', 'fix', 1, 'Cut off by time', `The clock ran out ${sec(totalMs)} into this puzzle, so it scored 0.`, { spentMs: totalMs }));
  }

  const order = { fix: 0, good: 1, info: 2 };
  out.sort((a, b) => order[a.kind] - order[b.kind] || b.severity - a.severity);
  return { findings: out, result, picks, grade: g };
}

// findingLists: arrays of findings. Up to `top` habits ranked by total severity.
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

// run: recorder.summarizeRun record. attempts: the run's attempt records. puzzles: Map or object id -> puzzle.
export function coachRun(run, attempts = [], puzzles = {}, { paceSec = 30, budgetMs = RUN_BUDGET_MS, history = [] } = {}) {
  const getPuzzle = (id) => (puzzles instanceof Map ? puzzles.get(id) : puzzles[id]);
  const rows = run.puzzles;
  const paceMs = paceSec * 1000;
  const lines = [];
  if (!rows.length) {
    lines.push({ id: 'empty', kind: 'info', title: 'No puzzles finished', text: 'The run ended before any puzzle was finished.', tip: 'Start the next run with a quick dimension scan on the first puzzle.' });
    return { lines, habits: [], perPuzzle: [] };
  }
  const byId = new Map(attempts.map((a) => [a.id, a]));
  const items = rows.map((r, k) => {
    const a = byId.get(r.attemptId);
    const p = getPuzzle(r.puzzleId);
    const result = a ? attemptResult(a) : r.outcome === 'solved' ? 'correct' : r.outcome === 'timeout' ? 'timeout' : 'skipped';
    const g = a && p ? gradeSelection(p, attemptPicks(a)) : null;
    return { k: k + 1, r, a, p, result, g };
  });

  const times = rows.map((r) => r.totalMs);
  const avgMs = mean(times);
  const slowest = items.reduce((x, y) => (y.r.totalMs > x.r.totalMs ? y : x));
  lines.push({
    id: 'time-per-puzzle',
    kind: avgMs > 1.5 * paceMs ? 'fix' : 'info',
    title: 'Time per puzzle',
    text: `Average ${sec(avgMs)} per puzzle (median ${sec(median(times))}) against a pace guide of ${paceSec} s. Slowest: puzzle ${slowest.k} at ${sec(slowest.r.totalMs)}.`,
    tip: avgMs > 1.5 * paceMs ? `Aim for about ${paceSec} s: scan the dimensions in a fixed order and stop at the first one that separates the panels.` : 'Pace per puzzle is in a good range.',
    data: { avgMs, medianMs: median(times) },
  });

  // Accuracy and the direction of errors.
  const answered = items.filter((x) => x.result === 'correct' || x.result === 'wrong');
  const correct = items.filter((x) => x.result === 'correct').length;
  const falsePicks = answered.reduce((s, x) => s + (x.g ? x.g.falsePicks.length : 0), 0);
  const misses = answered.reduce((s, x) => s + (x.g ? x.g.misses.length : 0), 0);
  let biasText = '';
  let biasTip = 'Keep testing each candidate against each part of the rule.';
  let accKind = answered.length && correct / answered.length >= 0.8 ? 'good' : 'info';
  if (falsePicks > misses && falsePicks >= 2) {
    accKind = 'fix';
    biasText = ` You picked too much more often than too little: ${plural(falsePicks, 'wrong pick')} against ${plural(misses, 'miss', 'misses')}.`;
    biasTip = 'You over-select: before picking, find the part of the rule a candidate might break and check it.';
  } else if (misses > falsePicks && misses >= 2) {
    accKind = 'fix';
    biasText = ` You left out fitting candidates more often than you picked wrong ones: ${plural(misses, 'miss', 'misses')} against ${plural(falsePicks, 'wrong pick')}.`;
    biasTip = 'You under-select: a candidate that looks different can still fit. Check only the rule\'s dimensions.';
  } else if (falsePicks + misses) biasText = ` ${plural(falsePicks, 'wrong pick')} and ${plural(misses, 'miss', 'misses')}.`;
  lines.push({
    id: 'accuracy',
    kind: accKind,
    title: 'Accuracy: wrong picks against misses',
    text: `${correct} of ${plural(answered.length, 'answer')} correct.${biasText}`,
    tip: biasTip,
    data: { correct, answered: answered.length, falsePicks, misses },
  });

  // Overlooked dimensions across the run.
  const dimCount = new Map();
  for (const x of answered) {
    if (!x.g || !x.p) continue;
    for (const i of x.g.falsePicks) {
      const broken = x.p.violates?.[i]?.length ? x.p.violates[i] : x.p.rule.filter((id) => !atom(id).test(x.p.candidates[i]));
      for (const id of broken) {
        const d = dimKey(atom(id).dim);
        dimCount.set(d, (dimCount.get(d) ?? 0) + 1);
      }
    }
  }
  if (dimCount.size) {
    const ranked = [...dimCount.entries()].sort((a, b) => b[1] - a[1]);
    lines.push({
      id: 'overlooked',
      kind: 'fix',
      title: 'Dimension you overlooked most',
      text: `Your wrong picks broke the rule on ${listAnd(ranked.map(([d, n]) => `${DIM_NAMES[d]} (${n})`))}.`,
      tip: DIM_TIPS[ranked[0][0]],
      data: { dims: Object.fromEntries(ranked) },
    });
  }

  // Skip policy.
  const skips = items.filter((x) => x.result === 'skipped');
  const late = skips.filter((x) => x.r.totalMs > 2 * paceMs);
  const early = skips.filter((x) => x.r.totalMs < 0.25 * paceMs && x.r.grossMoves === 0);
  const stuck = items.filter((x) => x.result !== 'skipped' && x.r.totalMs > 3 * paceMs);
  const parts = [];
  let skipKind = 'good';
  if (late.length) {
    skipKind = 'fix';
    parts.push(`Skipped too late on ${plural(late.length, 'puzzle')} (${late.map((x) => `#${x.k} after ${sec(x.r.totalMs)}`).join(', ')}): ${sec(late.reduce((s, x) => s + x.r.totalMs, 0))} spent for no score.`);
  }
  if (early.length) {
    skipKind = 'fix';
    parts.push(`Skipped too early on ${plural(early.length, 'puzzle')} (${early.map((x) => `#${x.k} after ${sec(x.r.totalMs)}`).join(', ')}) without picking anything.`);
  }
  if (stuck.length) {
    skipKind = 'fix';
    parts.push(`Held on past 3x the pace guide on ${plural(stuck.length, 'puzzle')} (${stuck.map((x) => `#${x.k} ${sec(x.r.totalMs)}`).join(', ')}).`);
  }
  if (!parts.length) parts.push(skips.length ? `${plural(skips.length, 'skip')}, all at sensible times.` : 'No skips, and no puzzle ran far past the pace guide.');
  lines.push({
    id: 'skip-policy',
    kind: skipKind,
    title: 'Skip policy',
    text: parts.join(' '),
    tip: `Skip rule for this set: skip if no shared feature stands out after about ${Math.round(paceSec / 2)} s, and at the latest at ${2 * paceSec} s.`,
    data: { skips: skips.length, late: late.length, early: early.length, stuck: stuck.length },
  });

  // Pace against the budget.
  const atPace = Math.floor(budgetMs / paceMs);
  const perMin = run.score / (Math.max(1, run.durationMs || budgetMs) / 60000);
  let paceKind = 'good';
  let paceTip = 'You are on pace for the 6:00 budget. Keep the same rhythm.';
  if (rows.length < 0.7 * atPace) {
    paceKind = 'fix';
    paceTip = `To reach about ${atPace} puzzles in 6:00, scan faster on clear puzzles and use the skip rule on hard ones.`;
  } else if (rows.length > 1.4 * atPace && answered.length && correct / answered.length < 0.6) {
    paceKind = 'fix';
    paceTip = 'You are fast but often wrong. Spend a few more seconds confirming the rule on the does-not-fit panels.';
  }
  lines.push({
    id: 'pace',
    kind: paceKind,
    title: 'Pace against the 6:00 budget',
    text: `You reached ${plural(rows.length, 'puzzle')}; at the ${paceSec} s pace guide that would be about ${atPace}. Score ${run.score.toFixed(0)} (${perMin.toFixed(2)} per minute).`,
    tip: paceTip,
    data: { reached: rows.length, atPace, perMin },
  });

  const lists = items.filter((x) => x.a && x.p).map((x) => coachPuzzle(x.a, x.p, { history, paceSec }).findings);
  return { lines, habits: topHabits(lists), perPuzzle: lists };
}
