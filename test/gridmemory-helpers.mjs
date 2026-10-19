// Shared fixtures for the Grid Memory suites: a hand-built trial and a scripted player.
import { createTrial } from '../js/games/gridmemory/state.js';

export const SYM = ['..#..', '.###.', '#####', '.#.#.', '.#.#.'];
export const ASYM1 = ['..#..', '.###.', '####.', '.#.#.', '.#.#.'];

// 3x3, length 4: (1,1) -> (1,3) -> (3,3) -> (2,2).
export const HAND = {
  id: 'gm-hand',
  n: 3,
  length: 4,
  sequence: [0, 2, 8, 4],
  showMs: 1000,
  windowMs: 4000,
  distractors: [
    { kind: 'sym', rows: SYM, answer: 'yes' },
    { kind: 'parity', a: 7, op: '+', b: 8, answer: 'odd' },
    { kind: 'sym', rows: ASYM1, answer: 'no' },
    { kind: 'parity', a: 6, op: '*', b: 3, answer: 'even' },
  ],
};

// Plays a whole trial on a fake clock. side: 'right' | 'wrong' | array of answers ('miss' = time-out).
// recall: cells to tap (then submit if fewer than length). rt: side answer time in ms.
export function playTrial(puzzle, { side = 'right', recall = puzzle.sequence, mode = 'practice', rt = 900, tapMs = 700, skipAt = null, extra = null } = {}) {
  const trial = createTrial(puzzle, { mode });
  let t = 1000;
  trial.begin(t);
  for (let i = 0; i < puzzle.length; i++) {
    if (skipAt && skipAt.phase === 'show' && skipAt.step === i) {
      trial.skip(t + 100);
      return trial;
    }
    t += puzzle.showMs + 300;
    trial.endShow(t);
    t += rt;
    const d = puzzle.distractors[i];
    let ans = Array.isArray(side) ? side[i] : side === 'right' ? d.answer : (d.kind === 'sym' ? (d.answer === 'yes' ? 'no' : 'yes') : (d.answer === 'even' ? 'odd' : 'even'));
    if (ans === 'miss') {
      t = t - rt + puzzle.windowMs;
      trial.sideTimeout(t);
    } else trial.answer(ans, t);
    t += 300;
  }
  // Circles with a retention pause: recall opens when the pause ends.
  if (trial.phase === 'pause') trial.endPause((t += puzzle.pauseMs));
  if (extra) extra(trial, () => (t += tapMs));
  for (const cell of recall) {
    if (trial.done) break;
    if (skipAt && skipAt.phase === 'recall' && trial.recall.length === skipAt.after) {
      trial.skip((t += tapMs));
      return trial;
    }
    trial.tap(cell, (t += tapMs));
  }
  if (!trial.done) {
    if (skipAt && skipAt.phase === 'recall') trial.skip((t += tapMs));
    else trial.submit((t += tapMs));
  }
  return trial;
}

// A minimal attempt record (what the coach needs) from a played trial.
export function attemptOf(trial, extra = {}) {
  const outcome = { submitted: 'solved', skipped: 'skipped', timeout: 'timeout' }[trial.outcome];
  return { id: `a-${Math.random().toString(36).slice(2)}`, game: 'gridmemory', set: 1, puzzleId: trial.puzzle.id, mode: trial.mode, outcome, events: trial.events, ...extra };
}
