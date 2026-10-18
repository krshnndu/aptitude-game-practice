// Block Slide coach (pure, no DOM). Compares a recorded attempt with the optimal solution and
// turns measured facts into findings, each with a plain-English suggestion.
//
// Every finding is computed from the event log replayed on the board:
//   optimal / wasted moves, first-move latency against your own median, ball moves made while the
//   ball had no open route and the position had already left the optimal line (premature),
//   a block moved and then straight back (oscillation), undo and reset counts, moves on blocks the
//   optimal line never touches, the first move that left the optimal line (with the better move and
//   its reason), and the cost of a skip or a time-out.
// coachRun() adds run-level coaching for a timed run: time per puzzle, skip policy, pace against
// the 6:00 budget, and the top 3 habits to fix.

import { makeBoard, applyMove, ballRoute, canMove, occupancy, stateKey, OPPOSITE, DIRS } from './state.js';
import { solveBoard } from './solver.js';
import { explainSolution, moveText, pieceName } from './explain.js';
import { median, mean } from '../../core/analytics.js';

export const RUN_BUDGET_MS = 6 * 60 * 1000;

// Habit catalogue: label for the run-level top 3, and the suggestion shown with each finding.
export const HABITS = {
  wasted: {
    label: 'Extra moves',
    tip: 'Before the first move, trace the ball\'s path to the exit and name each block in the way. Count the plan and compare it with the fewest-moves target.',
  },
  'latency-slow': {
    label: 'Slow first move',
    tip: 'Start with the lane: find the first block between the ball and the exit and decide only where it goes. The rest of the plan often follows from that one block.',
  },
  'latency-rushed': {
    label: 'Moving before planning',
    tip: 'Take 3 to 5 seconds before the first move. A quick start that costs extra moves loses more than it saves.',
  },
  'premature-ball': {
    label: 'Ball moved before the lane was clear',
    tip: 'Clear the lane first: move blocks until the ball has an open path, then run the ball. Early ball moves often have to be walked back.',
  },
  oscillation: {
    label: 'Moving a block and straight back',
    tip: 'Decide where a block has to end up before you touch it. A block that goes out and comes straight back is two wasted moves.',
  },
  undo: {
    label: 'Relying on undo',
    tip: 'The timed run has no undo. Practise playing the whole line in your head first, then move without taking moves back.',
  },
  reset: {
    label: 'Restarting',
    tip: 'A reset means the first plan failed. Replay the optimal line to see which first move unlocks the puzzle.',
  },
  'off-line-pieces': {
    label: 'Moving blocks that are not in the way',
    tip: 'Only move a block if it sits on the ball\'s path or blocks a block that does. Leave everything else alone.',
  },
  divergence: {
    label: 'Leaving the optimal line',
    tip: 'Compare your move with the better one shown, and ask what that block was waiting for. The replay below shows the full line.',
  },
  'skip-late': {
    label: 'Skipping too late',
    tip: 'Set a skip cutoff before the run starts and keep to it. Time sunk into a puzzle you then skip scores nothing.',
  },
  'skip-early': {
    label: 'Skipping too early',
    tip: 'Give every puzzle a short look for an obvious blocker before skipping. Each skip gives up a full point.',
  },
  timeout: {
    label: 'Running out of time mid-puzzle',
    tip: 'Watch the clock in the last minute. A puzzle cut off by time scores 0, the same as a skip.',
  },
  'stuck-long': {
    label: 'Holding on to one puzzle',
    tip: 'When a puzzle passes twice the pace guide, skipping and taking the next one usually scores more.',
  },
};

const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const listAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const sameMove = (a, b) => !!a && !!b && a.p === b.p && a.d === b.d;

function finding(id, kind, severity, title, detail, data = {}, tip = HABITS[id]?.tip ?? '') {
  return { id, kind, severity, title, detail, tip, data };
}

// ---------------------------------------------------------------- replay

// Replays an attempt's events on the board. With deep = true, positions that left the stored line
// are checked with a bounded search, so an equally short alternative order is not called a mistake.
export function replayLog(puzzle, events, { deep = false, maxStates = 250_000, maxSearches = 8 } = {}) {
  const board = makeBoard(puzzle);
  const sol = puzzle.solution || [];
  const optimal = puzzle.optimal ?? sol.length;
  let pos = board.start.slice();
  const moves = [];
  // Net stack of entries on the board; each carries onPath (after the move) and line (the rest of
  // an optimal line from there, when known).
  let stack = [];
  let invalid = 0;
  let searches = 0;
  let exact = true;
  const cache = new Map();
  // Positions along the stored line: a move that plays the stored line from one of them is a best
  // move from that position, even if earlier waste means the attempt as a whole is off the line.
  const storedAt = new Map();
  {
    let s = board.start.slice();
    sol.forEach((m, j) => {
      if (!storedAt.has(stateKey(s))) storedAt.set(stateKey(s), j);
      s = applyMove(board, s, m);
    });
  }

  function onPath(state, k, prefixOnStored) {
    if (prefixOnStored) return { on: true, line: sol.slice(k) };
    if (!deep) return { on: false, line: null };
    const left = optimal - k;
    if (left < 0) return { on: false, line: null };
    const key = `${stateKey(state)}|${k}`;
    if (cache.has(key)) return cache.get(key);
    if (searches >= maxSearches) {
      exact = false;
      return { on: false, line: null };
    }
    searches++;
    const res = solveBoard(board, state, { cap: left, maxStates });
    let out;
    if (res.status === 'solved' && res.optimal === left) out = { on: true, line: res.moves };
    else if (res.status === 'budget') {
      exact = false;
      out = { on: false, line: null };
    } else out = { on: false, line: null };
    cache.set(key, out);
    return out;
  }

  for (const ev of events) {
    if (ev.type === 'move') {
      const p = ev.p;
      if (!(ev.d in DIRS) || !Number.isInteger(p) || p < 0 || p >= pos.length || !canMove(board, pos, occupancy(board, pos), p, ev.d)) {
        invalid++;
        continue;
      }
      const k = stack.length;
      const prev = k ? stack[k - 1] : null;
      const before = pos;
      const beforeOnPath = prev ? prev.onPath : true;
      const beforeLine = prev ? prev.line : sol;
      const storedBefore = prev ? prev.onStored : true;
      const onStored = storedBefore && k < sol.length && sameMove(ev, sol[k]);
      const after = applyMove(board, before, { p, d: ev.d });
      let onPathAfter = false;
      let line = null;
      if (beforeOnPath) {
        if (beforeLine && sameMove(ev, beforeLine[0])) {
          onPathAfter = true;
          line = beforeLine.slice(1);
        } else {
          const r = onPath(after, k + 1, onStored);
          onPathAfter = r.on;
          line = r.line;
        }
      }
      const entry = {
        n: moves.length + 1,
        t: ev.t,
        p,
        d: ev.d,
        k,
        before,
        after,
        routeOpenBefore: ballRoute(board, before).dist !== Infinity,
        bestFromHere: storedAt.has(stateKey(before)) && sameMove(ev, sol[storedAt.get(stateKey(before))]),
        onStored,
        onPathBefore: beforeOnPath,
        onPath: onPathAfter,
        betterLine: beforeOnPath ? beforeLine : null,
        line,
        undone: null,
      };
      moves.push(entry);
      stack.push(entry);
      pos = after;
    } else if (ev.type === 'undo') {
      const e = stack.pop();
      if (e) {
        e.undone = 'undo';
        pos = e.before;
      }
    } else if (ev.type === 'reset') {
      for (const e of stack) e.undone = 'reset';
      stack = [];
      pos = board.start.slice();
    }
  }
  return { board, moves, net: stack, final: pos, invalid, exact, searches };
}

// ---------------------------------------------------------------- latency baseline

// Median first-move latency from your other attempts: same puzzle when there are 3 or more,
// otherwise the same set. Returns { ms, scope, n } or null.
export function latencyBaseline(attempt, history = [], minN = 3) {
  const others = history.filter((a) => a.id !== attempt.id && a.metrics && a.metrics.firstMoveMs !== null && a.metrics.firstMoveMs !== undefined);
  const same = others.filter((a) => a.puzzleId === attempt.puzzleId).map((a) => a.metrics.firstMoveMs);
  if (same.length >= minN) return { ms: median(same), scope: 'puzzle', n: same.length };
  const set = others.filter((a) => a.set === attempt.set && a.game === attempt.game).map((a) => a.metrics.firstMoveMs);
  if (set.length >= minN) return { ms: median(set), scope: 'set', n: set.length };
  return null;
}

// ---------------------------------------------------------------- per puzzle

export function coachPuzzle(attempt, puzzle, { history = [], paceSec = 30, deep = false, maxStates = 250_000 } = {}) {
  const optimal = puzzle.optimal ?? (puzzle.solution || []).length;
  const rep = replayLog(puzzle, attempt.events || [], { deep, maxStates });
  const m = attempt.metrics;
  const out = [];
  const solved = attempt.outcome === 'solved';
  const gross = rep.moves.length;
  const paceMs = paceSec * 1000;
  const perfect = solved && gross === optimal;
  const undoneCount = rep.moves.filter((e) => e.undone).length;
  const firstMoveMs = m?.firstMoveMs ?? (rep.moves[0]?.t ?? null);

  if (perfect) {
    out.push(finding('optimal', 'good', 0, 'Optimal solve', `Solved in ${optimal} moves, the fewest possible, with no wasted moves.`, {}, 'Keep the same approach: plan first, then play the line.'));
  }

  // Wasted moves.
  const wasted = solved ? Math.max(0, gross - optimal) : 0;
  if (solved && wasted > 0) {
    const extraOnBoard = Math.max(0, rep.net.length - optimal);
    const parts = [];
    if (undoneCount) parts.push(`${undoneCount} undone or reset`);
    if (extraOnBoard) parts.push(`${extraOnBoard} still in your final line`);
    const sev = wasted >= optimal ? 3 : wasted >= 0.4 * optimal ? 2 : 1;
    out.push(finding('wasted', 'fix', sev, plural(wasted, 'wasted move'),
      `You made ${gross} moves on a puzzle that needs ${optimal}: ${plural(wasted, 'wasted move')}${parts.length ? ` (${parts.join(', ')})` : ''}.`,
      { wasted, gross, optimal, undone: undoneCount, extraOnBoard }));
  }

  // First-move latency.
  if (firstMoveMs !== null) {
    const base = latencyBaseline(attempt, history);
    const rushedWaste = wasted >= Math.max(2, Math.ceil(optimal * 0.25));
    if (base) {
      const ratio = base.ms > 0 ? firstMoveMs / base.ms : Infinity;
      const where = base.scope === 'puzzle' ? 'this puzzle' : `set ${attempt.set}`;
      const vs = `your median of ${sec(base.ms)} for ${where} (${base.n} attempts)`;
      const data = { firstMoveMs, medianMs: base.ms, scope: base.scope, ratio };
      if (ratio >= 1.75 && firstMoveMs - base.ms >= 3000) {
        out.push(finding('latency-slow', 'fix', ratio >= 3 ? 2 : 1, 'Slow first move', `Your first move came after ${sec(firstMoveMs)}, ${ratio.toFixed(1)}x ${vs}.`, data));
      } else if (ratio <= 0.5 && rushedWaste) {
        out.push(finding('latency-rushed', 'fix', 2, 'Rushed start', `Your first move came after ${sec(firstMoveMs)}, under half ${vs}, and the solve cost ${plural(wasted, 'extra move')}.`, data));
      } else if (ratio <= 0.75 && perfect) {
        out.push(finding('latency-quick', 'good', 0, 'Quick and accurate start', `First move after ${sec(firstMoveMs)}, faster than ${vs}, and still optimal.`, data, 'Fast planning is paying off.'));
      } else {
        out.push(finding('latency', 'info', 0, 'First move', `First move after ${sec(firstMoveMs)}; ${vs}.`, data, ''));
      }
    } else if (firstMoveMs > paceMs * 0.5) {
      out.push(finding('latency-slow', 'fix', 1, 'Slow first move', `Your first move came after ${sec(firstMoveMs)}, over half the ${paceSec} s pace guide for this set. (A personal median appears after 3 attempts.)`, { firstMoveMs, medianMs: null }));
    } else if (firstMoveMs < 1500 && rushedWaste) {
      out.push(finding('latency-rushed', 'fix', 1, 'Rushed start', `Your first move came after ${sec(firstMoveMs)} and the solve cost ${plural(wasted, 'extra move')}.`, { firstMoveMs, medianMs: null }));
    } else {
      out.push(finding('latency', 'info', 0, 'First move', `First move after ${sec(firstMoveMs)}. A personal median for comparison appears after 3 attempts in this set.`, { firstMoveMs, medianMs: null }, ''));
    }
  }

  if (!perfect) {
    // Premature ball moves: no open route yet, the move was not part of an optimal line, and it is
    // not the stored line's move from this very position.
    const premature = rep.moves.filter((e) => e.p === 0 && !e.routeOpenBefore && !e.onPath && !e.bestFromHere);
    if (premature.length) {
      out.push(finding('premature-ball', 'fix', premature.length >= 3 ? 2 : 1, plural(premature.length, 'premature ball move'),
        `The ball moved ${plural(premature.length, 'time')} while blocks still closed every path to the exit (your ${premature.length === 1 ? 'move' : 'moves'} ${listAnd(premature.map((e) => e.n))}).`,
        { count: premature.length, moves: premature.map((e) => e.n) }));
    }

    // Oscillation: a piece's next move (not undone) is straight back. Only the excess over the
    // optimal line's own reversals counts.
    const reversals = countReversals(rep.moves.filter((e) => e.undone !== 'undo'));
    const optReversals = countReversals(puzzle.solution || []).length;
    const excess = reversals.length - optReversals;
    if (excess > 0) {
      const ex = reversals.slice(0, 3).map(([a, b]) => `${pieceName(a.p)} ${DIRS[a.d].word} then ${DIRS[b.d].word} (moves ${a.n} and ${b.n})`);
      out.push(finding('oscillation', 'fix', excess >= 2 ? 2 : 1, plural(excess, 'back-and-forth move pair'),
        `A piece went one way and then straight back: ${ex.join('; ')}.`, { count: excess }));
    }

    // Moves on blocks the optimal line never touches.
    const needed = new Set((puzzle.solution || []).map((s) => s.p));
    const offMoves = rep.moves.filter((e) => e.p !== 0 && !needed.has(e.p));
    if (offMoves.length) {
      const names = [...new Set(offMoves.map((e) => pieceName(e.p)))];
      out.push(finding('off-line-pieces', 'fix', offMoves.length >= 3 ? 2 : 1, plural(offMoves.length, 'move') + ' on blocks not in the way',
        `You moved ${names.join(', ')} ${plural(offMoves.length, 'time')}; the optimal line never moves ${names.length === 1 ? 'it' : 'them'}.`,
        { count: offMoves.length, pieces: [...new Set(offMoves.map((e) => e.p))] }));
    }

    // First move that left the optimal line.
    const div = rep.moves.find((e) => e.onPathBefore && !e.onPath);
    if (div && div.betterLine && div.betterLine.length) {
      const better = div.betterLine[0];
      // Net moves on the board just before the divergence, then the better continuation.
      const line = [...stackBefore(rep.moves, div), ...div.betterLine];
      let betterText = `${moveText(better)}.`;
      try {
        betterText = explainSolution(puzzle, line).steps[div.k]?.text ?? betterText;
      } catch {
        // keep the plain move text
      }
      const exactWord = deep && rep.exact ? 'every optimal line' : 'the optimal line';
      out.push(finding('divergence', 'fix', 2, `Left the optimal line at your move ${div.n}`,
        `At your move ${div.n} you ${moveText(div).replace(/^Move/, 'moved')}, which left ${exactWord}. Better: ${betterText}`,
        { move: div.n, netIndex: div.k, played: { p: div.p, d: div.d }, better, exact: deep && rep.exact }));
    }

    if (m && m.undos) out.push(finding('undo', attempt.mode === 'exam' ? 'fix' : 'info', 1, plural(m.undos, 'undo'), `You took back ${plural(m.undos, 'move')}.`, { count: m.undos }));
    if (m && m.resets) out.push(finding('reset', 'fix', 1, plural(m.resets, 'reset'), `You restarted the board ${plural(m.resets, 'time')}.`, { count: m.resets }));
  }

  if (attempt.hintsUsed) {
    out.push(finding('hints', 'info', 0, plural(attempt.hintsUsed, 'hint'), `You used ${plural(attempt.hintsUsed, 'hint')} on this puzzle.`, { count: attempt.hintsUsed }, 'Try it again without hints before moving on.'));
  }

  // Cost of a skip or time-out.
  const spent = m?.totalMs ?? 0;
  if (attempt.outcome === 'skipped') {
    const data = { spentMs: spent, paceMs, pointsLost: 1, grossMoves: gross };
    if (spent > 2 * paceMs) {
      out.push(finding('skip-late', 'fix', spent > 3 * paceMs ? 3 : 2, 'Skipped late',
        `You spent ${sec(spent)} (${(spent / paceMs).toFixed(1)}x the ${paceSec} s pace guide) and then skipped: that time scored nothing, and the skip gave up the 1 point this puzzle was worth.`, data));
    } else if (spent < 0.25 * paceMs && gross === 0) {
      out.push(finding('skip-early', 'fix', 1, 'Skipped early',
        `You skipped after ${sec(spent)} without trying a move, giving up the 1 point this puzzle was worth.`, data));
    } else {
      out.push(finding('skip-cost', 'info', 1, 'Skip cost',
        `Skipping after ${sec(spent)} gave up the 1 point this puzzle was worth. A skip inside about ${2 * paceSec} s is a reasonable call when you have no plan.`, data,
        'If you skip, do it early; if you start a line, finish it.'));
    }
    const next = (rep.net.length ? rep.net[rep.net.length - 1].line : puzzle.solution)?.[0];
    if (next && (!rep.net.length || rep.net[rep.net.length - 1].onPath)) {
      out.push(finding('next-move', 'info', 0, 'You were still on track', `Your position was still on an optimal line. The next move was: ${moveText(next)}.`, { next }, 'Trust a line that is working: finish it.'));
    }
  } else if (attempt.outcome === 'timeout') {
    out.push(finding('timeout', 'fix', 1, 'Cut off by time',
      `The clock ran out ${sec(spent)} into this puzzle, so it scored 0.`, { spentMs: spent, paceMs }));
  }

  if (rep.invalid) out.push(finding('log', 'info', 0, 'Log note', `${plural(rep.invalid, 'recorded move')} could not be replayed and ${rep.invalid === 1 ? 'was' : 'were'} ignored.`, {}, ''));

  out.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || b.severity - a.severity);
  return { findings: out, replay: rep, exact: rep.exact };
}

function kindOrder(k) {
  return k === 'fix' ? 0 : k === 'good' ? 1 : 2;
}

// Net moves on the board just before entry div was played.
function stackBefore(moves, div) {
  const stack = [];
  for (const e of moves) {
    if (e === div) break;
    stack[e.k] = { p: e.p, d: e.d };
    stack.length = e.k + 1;
  }
  return stack.slice(0, div.k);
}

// Pairs [a, b] where b is the same piece's next move and goes straight back.
export function countReversals(moves) {
  const lastByPiece = new Map();
  const pairs = [];
  moves.forEach((m, i) => {
    const e = { n: m.n ?? i + 1, p: m.p, d: m.d };
    const prev = lastByPiece.get(m.p);
    if (prev && OPPOSITE[prev.d] === m.d) {
      pairs.push([prev, e]);
      lastByPiece.delete(m.p);
    } else lastByPiece.set(m.p, e);
  });
  return pairs;
}

// ---------------------------------------------------------------- habits across puzzles

// findingLists: arrays of findings. Returns up to `top` habits ranked by total severity.
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

// run: a run record (recorder.summarizeRun). attempts: matching attempt records (may be fewer if
// pruned). puzzles: Map or object puzzleId -> puzzle.
export function coachRun(run, attempts = [], puzzles = {}, { paceSec = 30, budgetMs = RUN_BUDGET_MS, history = [] } = {}) {
  const getPuzzle = (id) => (puzzles instanceof Map ? puzzles.get(id) : puzzles[id]);
  const rows = run.puzzles;
  const paceMs = paceSec * 1000;
  const lines = [];
  if (!rows.length) {
    lines.push({ id: 'empty', kind: 'info', title: 'No puzzles finished', text: 'The run ended before any puzzle was finished.', tip: 'Start the next run with a plan for the first puzzle.' });
    return { lines, habits: [], perPuzzle: [] };
  }

  const times = rows.map((r) => r.totalMs);
  const solvedRows = rows.filter((r) => r.outcome === 'solved');
  const avgMs = mean(times);
  const slowest = rows.reduce((a, b) => (b.totalMs > a.totalMs ? b : a));
  const slowIdx = rows.indexOf(slowest) + 1;
  lines.push({
    id: 'time-per-puzzle',
    kind: avgMs > 1.5 * paceMs ? 'fix' : 'info',
    title: 'Time per puzzle',
    text: `Average ${sec(avgMs)} per puzzle (median ${sec(median(times))}) against a pace guide of ${paceSec} s.` +
      (solvedRows.length ? ` Solved puzzles took ${sec(mean(solvedRows.map((r) => r.totalMs)))} on average.` : '') +
      ` Slowest: puzzle ${slowIdx} at ${sec(slowest.totalMs)}.`,
    tip: avgMs > 1.5 * paceMs ? `Aim for about ${paceSec} s per puzzle: plan the lane first, then play the line without stopping.` : 'Pace per puzzle is in a good range.',
    data: { avgMs, medianMs: median(times), slowest: slowIdx },
  });

  // Skip policy.
  const skips = rows.map((r, i) => ({ ...r, i: i + 1 })).filter((r) => r.outcome === 'skipped');
  const late = skips.filter((r) => r.totalMs > 2 * paceMs);
  const early = skips.filter((r) => r.totalMs < 0.25 * paceMs && r.grossMoves === 0);
  const stuck = rows.map((r, i) => ({ ...r, i: i + 1 })).filter((r) => r.outcome !== 'skipped' && r.totalMs > 3 * paceMs);
  const cutoff = `skip if you have no plan after about ${Math.round(paceSec / 2)} s, and at the latest at ${2 * paceSec} s on one puzzle`;
  const skipParts = [];
  let skipKind = 'good';
  if (late.length) {
    skipKind = 'fix';
    const sunk = late.reduce((s, r) => s + r.totalMs, 0);
    skipParts.push(`Skipped too late on ${plural(late.length, 'puzzle')} (${late.map((r) => `#${r.i} after ${sec(r.totalMs)}`).join(', ')}): ${sec(sunk)} spent for no score.`);
  }
  if (early.length) {
    skipKind = 'fix';
    skipParts.push(`Skipped too early on ${plural(early.length, 'puzzle')} (${early.map((r) => `#${r.i} after ${sec(r.totalMs)}`).join(', ')}) without trying a move.`);
  }
  if (stuck.length) {
    skipKind = 'fix';
    skipParts.push(`Held on past 3x the pace guide on ${plural(stuck.length, 'puzzle')} (${stuck.map((r) => `#${r.i} ${sec(r.totalMs)}`).join(', ')}); skipping at 2x would have freed ${sec(stuck.reduce((s, r) => s + r.totalMs - 2 * paceMs, 0))}.`);
  }
  if (!skipParts.length) skipParts.push(skips.length ? `${plural(skips.length, 'skip')}, all at sensible times.` : 'No skips, and no puzzle ran far past the pace guide.');
  lines.push({
    id: 'skip-policy',
    kind: skipKind,
    title: 'Skip policy',
    text: skipParts.join(' '),
    tip: `Skip rule for this set: ${cutoff}.`,
    data: { skips: skips.length, late: late.length, early: early.length, stuck: stuck.length },
  });

  // Pace against the budget.
  const atPace = Math.floor(budgetMs / paceMs);
  const avgEff = rows.length ? run.score / rows.length : 0;
  const perMin = run.score / (Math.max(1, run.durationMs || budgetMs) / 60000);
  let paceKind = 'good';
  let paceTip = 'You are on pace for the 6:00 budget. Keep the same rhythm.';
  if (rows.length < 0.7 * atPace) {
    paceKind = 'fix';
    paceTip = `To reach about ${atPace} puzzles in 6:00, cut the planning time on easy puzzles and use the skip rule on hard ones.`;
  } else if (rows.length > 1.4 * atPace && avgEff < 0.6) {
    paceKind = 'fix';
    paceTip = 'You are moving fast but losing efficiency. Slow down a little: one extra second of planning saves several moves.';
  }
  lines.push({
    id: 'pace',
    kind: paceKind,
    title: 'Pace against the 6:00 budget',
    text: `You reached ${plural(rows.length, 'puzzle')} in ${Math.round(budgetMs / 60000)}:00; at the ${paceSec} s pace guide that would be about ${atPace}. Score ${run.score.toFixed(2)} (${perMin.toFixed(2)} per minute), average efficiency ${Math.round(avgEff * 100)}%.`,
    tip: paceTip,
    data: { reached: rows.length, atPace, perMin, avgEff },
  });

  // Habits from per-puzzle coaching (fast mode: stored line, no search).
  const byId = new Map(attempts.map((a) => [a.id, a]));
  const lists = [];
  for (const r of rows) {
    const a = byId.get(r.attemptId);
    const p = getPuzzle(r.puzzleId);
    if (!a || !p) continue;
    lists.push(coachPuzzle(a, p, { history, paceSec, deep: false }).findings);
  }
  const habits = topHabits(lists);
  return { lines, habits, perPuzzle: lists };
}
