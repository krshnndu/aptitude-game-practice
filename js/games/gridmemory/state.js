// Grid Memory rules and game session (pure, no DOM, node tested).
//
// A trial: cells of an n x n grid light up one at a time. After every highlight a side question
// appears (is this shape symmetric left to right? is this sum even?) that must be answered inside
// a time window. At the end the player taps the highlighted cells in order.
//
// Puzzle shape (as stored in data/sets/gridmemory/setN.json):
//   { id, n, length, sequence: [cell], showMs, windowMs,
//     distractors: [{ kind: 'sym', rows: ['.#.#.', ...], answer: 'yes'|'no' }
//                 | { kind: 'parity', a, op: '+'|'-'|'*', b, answer: 'even'|'odd' }] }
// Cells are indexed r * n + c from the top left; people see them as 1-based (row,column).
//
// Session events use the shared recorder vocabulary so attempts save through js/core/recorder.js:
//   select { p: step, d: answer|'miss', ok, rt }   a side question answered (or its window ran out)
//   select { p: null, d: 'recall' }                 the recall grid appeared
//   move { p: cell, d: 'r' }                        a recall tap ('h' when entered by a hint)
//   blocked { p: cell, d: 'repeat' }                a tap on a cell already entered (ignored)
//   undo, hint, and one closing event: solve (recall submitted) | skip { d: phase, p: step } | timeout

// Score weights: a trial is worth 10 points per sequence position, 7 for recalling the cell in the
// right position and 3 for the side question shown after it. Efficiency = points / max points.
export const POINTS = { recall: 7, side: 3 };
export const ANSWERS = { sym: ['yes', 'no'], parity: ['even', 'odd'] };
export const PHASES = ['ready', 'show', 'side', 'recall', 'done'];
// A staircase step counts as passed with every position right and at most this many side errors.
export const SIDE_ERRORS_ALLOWED = 1;

export function cellRC(n, cell) {
  return { r: Math.floor(cell / n), c: cell % n };
}

export function cellLabel(n, cell) {
  return `(${Math.floor(cell / n) + 1},${(cell % n) + 1})`;
}

// ---------------------------------------------------------------- side question rules

// Number of mirror pairs (row r, column c and column w-1-c) whose cells differ.
export function mirrorMismatches(rows) {
  let k = 0;
  for (const row of rows) {
    for (let c = 0; c < Math.floor(row.length / 2); c++) {
      if (row[c] !== row[row.length - 1 - c]) k++;
    }
  }
  return k;
}

export function isMirrorSymmetric(rows) {
  return mirrorMismatches(rows) === 0;
}

export function arithValue({ a, op, b }) {
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  throw new Error(`unknown operator ${op}`);
}

export function parityOf(v) {
  return Math.abs(v) % 2 === 0 ? 'even' : 'odd';
}

export function correctAnswer(d) {
  if (d.kind === 'sym') return isMirrorSymmetric(d.rows) ? 'yes' : 'no';
  if (d.kind === 'parity') return parityOf(arithValue(d));
  throw new Error(`unknown side question kind ${d.kind}`);
}

// ---------------------------------------------------------------- scoring

// Per position status:
//   ok       right cell in the right position
//   hint     entered by a hint (scores 0)
//   order    a cell of the sequence, but in the wrong position (item remembered, order lost)
//   wrong    a cell that was never highlighted (location lost)
//   missing  nothing entered for this position
export function analyzeRecall(sequence, recall, hinted = []) {
  const hintSet = new Set(hinted);
  const where = new Map(sequence.map((cell, i) => [cell, i]));
  const positions = sequence.map((expected, i) => {
    const got = i < recall.length ? recall[i] : null;
    let status;
    if (got === null) status = 'missing';
    else if (hintSet.has(i)) status = 'hint';
    else if (got === expected) status = 'ok';
    else if (where.has(got)) status = 'order';
    else status = 'wrong';
    const belongsAt = got !== null && where.has(got) ? where.get(got) : null;
    return { i, expected, got, status, belongsAt };
  });
  const count = (s) => positions.filter((p) => p.status === s).length;
  const correct = count('ok');
  const firstError = positions.find((p) => p.status !== 'ok');
  return {
    positions,
    correct,
    total: sequence.length,
    accuracy: sequence.length ? correct / sequence.length : 0,
    order: count('order'),
    wrong: count('wrong'),
    missing: count('missing'),
    hints: count('hint'),
    firstError: firstError ? firstError.i : null,
    perfect: correct === sequence.length,
  };
}

// answers[i]: { answer, ok, rt } or undefined when the question was never reached.
export function scoreSide(distractors, answers) {
  let correct = 0;
  let missed = 0;
  let answered = 0;
  distractors.forEach((_, i) => {
    const a = answers[i];
    if (!a) return;
    if (a.answer === 'miss') missed++;
    else answered++;
    if (a.ok) correct++;
  });
  const total = distractors.length;
  return { correct, total, answered, missed, wrong: total - correct, accuracy: total ? correct / total : 0 };
}

// Points for one trial. outcome: 'submitted' | 'skipped' | 'timeout'. Skips and time-outs score 0.
export function scoreTrial(puzzle, { recall = [], hinted = [], answers = [], outcome = 'submitted' } = {}) {
  const rec = analyzeRecall(puzzle.sequence, recall, hinted);
  const side = scoreSide(puzzle.distractors, answers);
  const maxPoints = puzzle.length * (POINTS.recall + POINTS.side);
  const counts = outcome === 'submitted';
  const points = counts ? rec.correct * POINTS.recall + side.correct * POINTS.side : 0;
  return {
    recall: rec,
    side,
    points,
    maxPoints,
    efficiency: maxPoints ? points / maxPoints : 0,
    outcome,
    success: counts && rec.perfect && side.wrong <= SIDE_ERRORS_ALLOWED,
  };
}

// ---------------------------------------------------------------- session

// Interactive trial. Pure state: the UI calls these with timestamps (ms) and runs the timers.
// opts: { mode: 'practice'|'exam' } (exam has no undo and no hint).
export function createTrial(puzzle, { mode = 'practice' } = {}) {
  const exam = mode === 'exam';
  let phase = 'ready';
  let step = 0;
  let t0 = null;
  let sideShownAt = null;
  let outcome = null;
  const events = [];
  const answers = [];
  const recall = [];
  const hinted = [];

  const rel = (t) => (t0 === null ? 0 : Math.max(0, Math.round(t - t0)));
  const push = (t, ev) => events.push({ t: rel(t), ...ev });

  function enterRecall(t) {
    phase = 'recall';
    push(t, { type: 'select', p: null, d: 'recall' });
  }

  function close(t, kind, extra = {}) {
    phase = 'done';
    push(t, { type: kind, ...extra });
  }

  function recordAnswer(t, answer) {
    const rt = sideShownAt === null ? 0 : Math.max(0, Math.round(t - sideShownAt));
    const ok = answer !== 'miss' && answer === puzzle.distractors[step].answer;
    answers[step] = { answer, ok, rt };
    push(t, { type: 'select', p: step, d: answer, ok, rt });
    sideShownAt = null;
    if (step + 1 < puzzle.length) {
      step++;
      phase = 'show';
    } else enterRecall(t);
    return { ok, answer, rt };
  }

  const trial = {
    puzzle,
    mode,
    get phase() {
      return phase;
    },
    get step() {
      return step;
    },
    get events() {
      return events.slice();
    },
    get recall() {
      return recall.slice();
    },
    get hinted() {
      return hinted.slice();
    },
    get answers() {
      return answers.slice();
    },
    get outcome() {
      return outcome;
    },
    get done() {
      return phase === 'done';
    },
    // The cell lit during the show phase.
    get litCell() {
      return phase === 'show' ? puzzle.sequence[step] : null;
    },
    get distractor() {
      return phase === 'side' ? puzzle.distractors[step] : null;
    },
    begin(t) {
      if (phase !== 'ready') return false;
      t0 = t;
      phase = 'show';
      step = 0;
      return true;
    },
    endShow(t) {
      if (phase !== 'show') return false;
      phase = 'side';
      sideShownAt = t;
      return true;
    },
    answer(value, t) {
      if (phase !== 'side') return null;
      if (!ANSWERS[puzzle.distractors[step].kind].includes(value)) return null;
      return recordAnswer(t, value);
    },
    sideTimeout(t) {
      if (phase !== 'side') return null;
      return recordAnswer(t, 'miss');
    },
    // Returns { ok, reason?, done }.
    tap(cell, t) {
      if (phase !== 'recall') return { ok: false, reason: 'phase' };
      if (!Number.isInteger(cell) || cell < 0 || cell >= puzzle.n * puzzle.n) return { ok: false, reason: 'cell' };
      if (recall.includes(cell)) {
        push(t, { type: 'blocked', p: cell, d: 'repeat' });
        return { ok: false, reason: 'repeat' };
      }
      recall.push(cell);
      push(t, { type: 'move', p: cell, d: 'r' });
      if (recall.length === puzzle.length) trial.submit(t);
      return { ok: true, done: phase === 'done' };
    },
    undo(t) {
      if (exam || phase !== 'recall' || !recall.length) return false;
      const k = recall.length - 1;
      recall.pop();
      const h = hinted.indexOf(k);
      if (h >= 0) hinted.splice(h, 1);
      push(t, { type: 'undo' });
      return true;
    },
    // Practice only: enters the next correct cell for you. That position scores 0.
    hint(t) {
      if (exam || phase !== 'recall' || recall.length >= puzzle.length) return null;
      const k = recall.length;
      const cell = puzzle.sequence[k];
      // The next cell was already tapped at another position: undo back to it first.
      if (recall.includes(cell)) return { cell, position: k, already: recall.indexOf(cell) };
      push(t, { type: 'hint' });
      hinted.push(k);
      recall.push(cell);
      push(t, { type: 'move', p: cell, d: 'h' });
      if (recall.length === puzzle.length) trial.submit(t);
      return { cell, position: k };
    },
    submit(t) {
      if (phase !== 'recall') return false;
      outcome = 'submitted';
      close(t, 'solve');
      return true;
    },
    skip(t) {
      if (phase === 'done') return false;
      const at = phase;
      outcome = 'skipped';
      close(t, 'skip', { d: at, p: step });
      return true;
    },
    timeout(t) {
      if (phase === 'done') return false;
      const at = phase;
      outcome = 'timeout';
      close(t, 'timeout', { d: at, p: step });
      return true;
    },
    result() {
      return scoreTrial(puzzle, { recall, hinted, answers, outcome: outcome ?? 'submitted' });
    },
  };
  return trial;
}

// ---------------------------------------------------------------- replay a saved log

const CLOSING = { solve: 'submitted', skip: 'skipped', timeout: 'timeout' };

// Rebuilds what the player did from the event log alone (used by the coach and saved history).
export function replayLog(puzzle, events = []) {
  const recall = [];
  const hinted = [];
  const answers = [];
  const tapTimes = [];
  let recallStart = null;
  let undos = 0;
  let repeats = 0;
  let hints = 0;
  let outcome = null;
  let endT = 0;
  let endPhase = null;
  let endStep = null;
  for (const ev of events) {
    endT = ev.t;
    if (ev.type === 'select') {
      if (ev.d === 'recall') recallStart = ev.t;
      else if (Number.isInteger(ev.p) && ev.p >= 0 && ev.p < puzzle.length) {
        answers[ev.p] = { answer: ev.d, ok: !!ev.ok, rt: Number.isFinite(ev.rt) ? ev.rt : null, t: ev.t };
      }
    } else if (ev.type === 'move') {
      if (ev.d === 'h') hinted.push(recall.length);
      recall.push(ev.p);
      tapTimes.push(ev.t);
    } else if (ev.type === 'undo') {
      undos++;
      const k = recall.length - 1;
      if (k >= 0) {
        recall.pop();
        tapTimes.pop();
        const h = hinted.indexOf(k);
        if (h >= 0) hinted.splice(h, 1);
      }
    } else if (ev.type === 'blocked') repeats++;
    else if (ev.type === 'hint') hints++;
    else if (ev.type in CLOSING) {
      outcome = CLOSING[ev.type];
      endPhase = ev.d ?? (ev.type === 'solve' ? 'recall' : null);
      endStep = Number.isInteger(ev.p) ? ev.p : null;
      break;
    }
  }
  return { recall, hinted, answers, tapTimes, recallStart, undos, repeats, hints, outcome, endT, endPhase, endStep };
}

// ---------------------------------------------------------------- recorder record

const RECORDER_OUTCOME = { submitted: 'solved', skipped: 'skipped', timeout: 'timeout' };

// Fields for recorder.computeMetrics / saveAttempt. The shared recorder scores an attempt as
// optimal / moves, so a Grid Memory attempt stores points earned as `optimal` and points possible
// as `moves`: metrics.efficiency then equals the trial's combined efficiency exactly.
export function recorderFields(puzzle, result) {
  const outcome = RECORDER_OUTCOME[result.outcome] ?? 'solved';
  return {
    outcome,
    optimal: outcome === 'solved' ? result.points : 0,
    moves: result.maxPoints,
  };
}
