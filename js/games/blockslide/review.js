// Block Slide review adapter (pure): seed reference and regeneration, checksum, coach tags,
// puzzle features, user path vs the optimal line, and report dimensions.

import { configFor, blockMoveCount } from './gen.js';
import { transformPuzzle, generateFresh } from './stream.js';
import { coachPuzzle, replayLog, HABITS } from './coach.js';
import { explainSolution, moveText, blockStyle } from './explain.js';
import { DIRS } from './state.js';
import { cleanCode, firstDivergence } from '../../core/dvs.js';
import { checksumOf, seedFromId, splitVariant, fixIds, makeBlob, readBlob } from '../../core/learn-util.js';
import { accuracyDim, efficiencyDim, firstMoveDim, tagDim, metricMeanDim } from '../../core/dims.js';

export const GAME_ID = 'blockslide';
export const GENERATOR_VERSION = 1;
// Fresh puzzles in sets 4 and 5 take seconds to rebuild, so they also keep a compact encoding.
const SLOW_SETS = 4;

const paceMs = (set) => (configFor(set)?.paceSec ?? 30) * 1000;

export function checksum(p) {
  return checksumOf({ n: p.n, exit: p.exit, walls: p.walls ?? [], ball: p.ball, blocks: p.blocks, optimal: p.optimal });
}

function kindOf(pid) {
  if (pid.includes('~')) return 'variant';
  if (seedFromId(pid) !== null) return 'generated';
  return 'pool';
}

export function refFor(attempt, puzzle = null) {
  const pid = attempt.puzzleId;
  const src = kindOf(pid);
  const ref = { pid, set: attempt.set, src, gv: GENERATOR_VERSION };
  if (src === 'variant') ref.v = splitVariant(pid).tag;
  if (src === 'generated') ref.seed = seedFromId(pid);
  if (puzzle) {
    ref.check = checksum(puzzle);
    if (src === 'generated' && attempt.set >= SLOW_SETS) {
      const blob = makeBlob({ n: puzzle.n, exit: puzzle.exit, walls: puzzle.walls ?? [], ball: puzzle.ball, blocks: puzzle.blocks, optimal: puzzle.optimal, solution: puzzle.solution });
      if (blob) ref.blob = blob;
    }
  }
  return ref;
}

export const needsSet = (ref) => !ref.blob && ref.src !== 'generated';
// Rebuilding is too slow for the page without a blob.
export const slowRebuild = (ref) => !ref.blob && ref.src === 'generated' && ref.set >= SLOW_SETS;

export function regenerate(ref, setData = null) {
  if (ref.blob) {
    const b = readBlob(ref.blob);
    return b ? { id: ref.pid, ...b } : null;
  }
  if (ref.src === 'generated') return ref.seed === null || ref.seed === undefined ? null : generateFresh(ref.set, ref.seed);
  const { base, tag } = splitVariant(ref.pid);
  const p = setData?.puzzles?.find((x) => x.id === base);
  if (!p) return null;
  return tag ? transformPuzzle(p, tag) : p;
}

export function tagsFor(attempt, puzzle) {
  return fixIds(coachPuzzle(attempt, puzzle, { paceSec: configFor(attempt.set)?.paceSec ?? 30 }).findings);
}

export function features(p) {
  const opt = p.optimal ?? 0;
  return [
    `${p.n}x${p.n} grid`,
    `${p.blocks.length} blocks`,
    (p.walls ?? []).length ? 'with walls' : 'no walls',
    opt <= 5 ? 'short line (5 or fewer)' : opt <= 9 ? 'medium line (6 to 9)' : 'long line (10 or more)',
    `${blockMoveCount(p.solution ?? [])} block moves needed`,
  ];
}

// Your moves in order, each marked on or off an optimal line, with undone moves flagged.
export function userPath(attempt, puzzle) {
  const rep = replayLog(puzzle, attempt.events ?? []);
  return rep.moves.map((m) => ({ text: `${moveText(m)}${m.undone ? ' (undone)' : ''}`, ok: m.onPath ?? null, t: m.t }));
}

export function divergence(attempt, puzzle) {
  const res = coachPuzzle(attempt, puzzle, { paceSec: configFor(attempt.set)?.paceSec ?? 30 });
  const f = res.findings.find((x) => x.id === 'divergence');
  return f ? { index: Math.max(0, (f.data.move ?? 1) - 1), text: f.detail } : null;
}

export const optimalSteps = (puzzle) => explainSolution(puzzle).steps.map((s) => s.text);
export const timeOf = (a) => a.metrics?.totalMs ?? 0;
export const parMs = (a) => paceMs(a.set);
export const tagLabel = (id) => HABITS[id]?.label ?? id;
export const TAG_IDS = Object.keys(HABITS);

export const DIMS = [
  accuracyDim,
  efficiencyDim('Move efficiency (optimal / yours)'),
  firstMoveDim('Planning depth: first move time', 8000),
  tagDim('wasted', 'Extra moves (share of attempts)', ['wasted']),
  tagDim('backtracks', 'Backtracks: oscillation, undo, reset', ['oscillation', 'undo', 'reset']),
  tagDim('premature', 'Ball moved before the lane was open', ['premature-ball']),
  metricMeanDim('undos', 'Undos per attempt', (a) => a.metrics?.undos ?? 0, 0.5),
];

// ---------------------------------------------------------------- did vs should

// ans / opt code: one token per move, the piece in base 36 (ball 0, blocks 1 to 8) then the
// direction letter, so "0R1U" is ball right, then block A up. Built from moves only.
const codeOf = (moves) => moves.map((m) => `${m.p.toString(36)}${m.d}`).join('');
const shortMove = (m) => `${m.p === 0 ? 'ball' : `block ${blockStyle(m.p).letter}`} ${DIRS[m.d].word}`;
const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
const sentence = (s) => (s ? `${s.replace(/\.+$/, '')}.` : '');

// Why the move at index i of line is right, from the position reached by prefix. '' if unknown.
function reasonAt(puzzle, prefix, line, i) {
  try {
    const moves = [...prefix.map(({ p, d }) => ({ p, d })), ...line.map(({ p, d }) => ({ p, d }))];
    return explainSolution(puzzle, moves).steps[i]?.reason ?? '';
  } catch {
    return '';
  }
}

// Your net moves (undone ones excluded) next to the optimal line. Rows are per step; ok means the
// move is still on an optimal line (the coach's replay, no deep search, so this runs on save).
// opts.deep: bounded search for other optimal lines (result pages); off on save, where only the
// solver's stored line is checked unless the puzzle was solved in the optimal count.
export function didVsShould(attempt, puzzle, { deep = false } = {}) {
  const a = attempt ?? {};
  const sol = puzzle.solution ?? [];
  const optimal = puzzle.optimal ?? sol.length;
  const events = Array.isArray(a.events) ? a.events : [];
  const total = Math.round(events.length ? events[events.length - 1].t : (a.metrics?.totalMs ?? 0));
  const moves = a.metrics?.moves ?? a.moves ?? null;

  // Pruned events (kept only as metrics): the step detail is gone, so say so instead of guessing.
  if (a.eventsPruned || (!events.length && a.outcome === 'solved')) {
    const result = a.outcome === 'solved' && moves !== null ? `You solved it in ${plural(moves, 'move')}` : 'You did not solve it';
    return {
      rows: [],
      div: -1,
      note: `${sentence(result)} The fewest possible is ${optimal}. Move-by-move detail was not kept for this attempt.`,
      ans: '',
      opt: cleanCode(codeOf(sol)),
      lat: total,
    };
  }

  const rep = replayLog(puzzle, events, { deep });
  const net = rep.net;
  const exact = deep && rep.exact;
  const optimalSolve = a.outcome === 'solved' && net.length === optimal;
  const u = net.length;
  const rows = [];
  for (let i = 0; i < Math.max(u, sol.length); i++) {
    const m = net[i] ?? null;
    const want = sol[i] ?? null;
    rows.push({ did: m ? shortMove(m) : '', should: want ? shortMove(want) : '', ok: !!(m && want && (m.onPath || optimalSolve)) });
  }
  const div = firstDivergence(rows);

  let note;
  let lat = total;
  if (div < 0) {
    note = `You used ${plural(u, 'move')}, the fewest possible, and every move stayed on an optimal line.`;
  } else if (div >= u) {
    // Stopped early: the next optimal move from where you stopped.
    const cont = u ? net[u - 1].line : sol;
    const next = cont?.length ? cont[0] : null;
    if (next) rows[div].should = shortMove(next);
    const why = next ? reasonAt(puzzle, net, cont, u) : '';
    note = `${u === 0 ? 'You stopped without a move' : `You stopped after ${plural(u, 'move')}`}; the fewest possible is ${optimal}.`
      + (next ? ` The next optimal move is ${shortMove(next)}.` : '')
      + (why ? ` Why: ${sentence(why)}` : '');
  } else {
    // First move that left every optimal line, against the optimal move from that position.
    const bad = net[div];
    const line = bad.betterLine?.length ? bad.betterLine : null;
    const better = line ? line[0] : sol[div] ?? null;
    if (better) rows[div].should = shortMove(better);
    const why = line ? reasonAt(puzzle, net.slice(0, div), line, div) : '';
    lat = bad.t;
    note = `You used ${plural(u, 'move')} against the fewest possible ${optimal}. Move ${div + 1} (${shortMove(bad)}) left ${exact ? 'every optimal line' : 'the solver\'s optimal line'}`
      + (better ? `; the optimal move there was ${shortMove(better)}.` : '.')
      + (why ? ` Why: ${sentence(why)}` : '');
  }

  return {
    rows,
    div,
    note,
    ans: cleanCode(codeOf(net)),
    opt: cleanCode(codeOf(sol)),
    lat: Math.round(Number.isFinite(lat) ? lat : 0),
  };
}

// Readable text for an ans / opt code: "0R1U" becomes "ball right, block A up". Other text passes through.
export function formatCode(code) {
  const s = String(code ?? '');
  if (!s) return '';
  if (!/^([0-9a-z][UDLR])+$/.test(s)) return s;
  return s.match(/[0-9a-z][UDLR]/g).map((t) => {
    const p = parseInt(t[0], 36);
    return `${p === 0 ? 'ball' : `block ${blockStyle(p).letter}`} ${DIRS[t[1]].word}`;
  }).join(', ');
}
