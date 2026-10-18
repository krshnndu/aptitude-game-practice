// Builds recorder-compatible attempt records from a finished Grid Memory trial (pure, no DOM).
// The shared recorder (js/core/recorder.js) knows only Block Slide's event types, so the trial
// session already logs in that vocabulary (see state.js), and points are mapped onto optimal/moves
// by recorderFields() so metrics.efficiency is the trial's combined score.

import { computeMetrics, newId } from '../../core/recorder.js';
import { recorderFields } from './state.js';

export const GAME_ID = 'gridmemory';

export function buildAttempt(trial, { set, mode, runId = null, source = 'pool', startedAt = Date.now() }) {
  const result = trial.result();
  const f = recorderFields(trial.puzzle, result);
  const events = trial.events;
  return {
    id: newId('a', startedAt),
    game: GAME_ID,
    set,
    puzzleId: trial.puzzle.id,
    mode,
    runId,
    source,
    startedAt,
    optimal: f.optimal,
    outcome: f.outcome,
    moves: f.moves,
    hintsUsed: trial.hinted.length,
    events,
    metrics: computeMetrics(events, { optimal: f.optimal, moves: f.moves, outcome: f.outcome }),
  };
}
