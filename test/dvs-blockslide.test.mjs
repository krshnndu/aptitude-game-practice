// Did vs should for Block Slide: the adapter on real recorded attempts (perfect, wrong, skipped,
// undone, pruned), the code format, the timing budget on set 5, and that stampDvs keeps the codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttemptLog, sanitizeAttempt } from '../js/core/recorder.js';
import { didVsShould, formatCode } from '../js/games/blockslide/review.js';
import { makeBoard, legalMoves, applyMove } from '../js/games/blockslide/state.js';
import { stampDvs } from '../js/core/learn-hooks.js';
import { loadSet } from '../tools/verify.mjs';

const CHARSET = /^[A-Za-z0-9.,:+*/=_<>^]*$/;

// A fake clock that advances 1.5 s per logged action.
function logFor(puzzle, set = 1) {
  let t = 1_000_000;
  return createAttemptLog({ game: 'blockslide', set, puzzleId: puzzle.id, mode: 'practice', optimal: puzzle.optimal, now: () => (t += 1500) });
}

// Solved attempt that plays the given moves, saved the way play.js saves it.
function solvedWith(puzzle, moves, extra = (log) => log) {
  const log = extra(logFor(puzzle));
  for (const m of moves) log.move(m.p, m.d);
  return sanitizeAttempt(log.end('solved', { moves: moves.length }));
}

// A legal move from the start that is not the first optimal move.
function firstDetour(puzzle) {
  const board = makeBoard(puzzle);
  return legalMoves(board, board.start).find((m) => !(m.p === puzzle.solution[0].p && m.d === puzzle.solution[0].d));
}

// Legal move after the first optimal move that is not the second one.
function secondDetour(puzzle) {
  const board = makeBoard(puzzle);
  const s1 = applyMove(board, board.start, puzzle.solution[0]);
  const s2 = puzzle.solution[1];
  return legalMoves(board, s1).find((m) => !(m.p === s2.p && m.d === s2.d));
}

const set1 = loadSet(1).puzzles;
const set5 = loadSet(5).puzzles;

test('perfect attempt: no divergence, ans equals opt, every row ok', () => {
  for (const puzzle of set1.slice(0, 3)) {
    const good = solvedWith(puzzle, puzzle.solution);
    const r = didVsShould(good, puzzle);
    assert.equal(r.div, -1);
    assert.equal(r.ans, r.opt);
    assert.ok(r.rows.length === puzzle.solution.length);
    assert.ok(r.rows.every((row) => row.ok === true && row.did === row.should));
    assert.match(r.note, /every move stayed on an optimal line/);
    assert.match(r.note, new RegExp(`${puzzle.solution.length} moves`));
  }
});

test('undone moves are excluded from the path and the codes', () => {
  const puzzle = set1[0];
  const detour = firstDetour(puzzle);
  const good = solvedWith(puzzle, puzzle.solution, (log) => {
    log.move(detour.p, detour.d);
    log.undo();
    return log;
  });
  const r = didVsShould(good, puzzle);
  assert.equal(r.div, -1);
  assert.equal(r.ans, r.opt);
  assert.equal(r.rows.length, puzzle.solution.length);
});

test('wrong attempt: first divergence at the right step, rows side by side, note names both moves', () => {
  const puzzle = set1[0];
  const detour = secondDetour(puzzle);
  const bad = solvedWith(puzzle, [puzzle.solution[0], detour]);
  const r = didVsShould(bad, puzzle);
  assert.equal(r.div, 1, 'the second move is the first divergence');
  assert.equal(r.rows[0].ok, true);
  assert.equal(r.rows[1].ok, false);
  assert.ok(r.rows[1].did.length > 0 && r.rows[1].should.length > 0);
  assert.ok(r.rows.every((row) => typeof row.did === 'string' && typeof row.should === 'string'));
  assert.ok(r.note.length > 20);
  assert.match(r.note, new RegExp(`against the fewest possible ${puzzle.optimal}`));
  assert.match(r.note, /Move 2 \(/);
  assert.match(r.note, /optimal move there was/);
  assert.ok(r.note.includes(r.rows[1].should), 'the note names the optimal move at the divergence');
  assert.notEqual(r.ans, r.opt);
});

test('wrong attempt from the start: divergence at step 1 with the optimal first move', () => {
  const puzzle = set5[0];
  const bad = solvedWith(puzzle, [firstDetour(puzzle)]);
  const r = didVsShould(bad, puzzle);
  assert.equal(r.div, 0);
  assert.equal(r.rows[0].ok, false);
  assert.ok(r.note.includes(r.rows[0].should));
  assert.ok(r.note.length > 20);
});

test('skipped attempt with no events: rows are the optimal steps, first one diverges', () => {
  const puzzle = set1[2];
  const log = logFor(puzzle);
  const skipped = sanitizeAttempt(log.end('skipped', { moves: 0 }));
  const r = didVsShould(skipped, puzzle);
  assert.equal(r.div, 0);
  assert.equal(r.rows.length, puzzle.solution.length);
  assert.equal(r.rows[0].did, '');
  assert.equal(r.rows[0].ok, false);
  assert.ok(r.note.length > 0);
  assert.equal(r.ans, '');
  assert.equal(r.lat, skipped.metrics.totalMs ?? 0);
});

test('attempts with pruned events do not throw and carry no rows', () => {
  const puzzle = set1[0];
  const pruned = {
    id: 'x', game: 'blockslide', set: 1, puzzleId: puzzle.id, outcome: 'solved', optimal: puzzle.optimal,
    startedAt: 1, events: [], eventsPruned: true, metrics: { moves: puzzle.optimal, totalMs: 9000 },
  };
  const r = didVsShould(pruned, puzzle);
  assert.deepEqual(r.rows, []);
  assert.equal(r.div, -1);
  assert.match(r.note, /not kept/);
  assert.equal(r.lat, 9000);
  assert.doesNotThrow(() => didVsShould({ events: [], outcome: 'timeout' }, puzzle));
});

test('ans and opt use only the allowed charset and stay within 40 characters', () => {
  for (const puzzle of [...set1, ...set5]) {
    const good = solvedWith(puzzle, puzzle.solution);
    const r = didVsShould(good, puzzle);
    for (const code of [r.ans, r.opt]) {
      assert.match(code, CHARSET);
      assert.ok(code.length <= 40, `code length ${code.length}`);
    }
  }
  const puzzle = set5[3];
  const bad = solvedWith(puzzle, [firstDetour(puzzle)]);
  const r = didVsShould(bad, puzzle);
  assert.match(r.ans, CHARSET);
  assert.match(r.opt, CHARSET);
  assert.ok(r.ans.length <= 40 && r.opt.length <= 40);
});

test('lat is an integer; divergent attempts report the time of the divergent action', () => {
  const puzzle = set1[0];
  const good = solvedWith(puzzle, puzzle.solution);
  const rg = didVsShould(good, puzzle);
  assert.ok(Number.isInteger(rg.lat) && rg.lat > 0);
  assert.equal(rg.lat, good.events[good.events.length - 1].t);

  const detour = secondDetour(puzzle);
  const bad = solvedWith(puzzle, [puzzle.solution[0], detour]);
  const rb = didVsShould(bad, puzzle);
  assert.ok(Number.isInteger(rb.lat));
  const moveEvents = bad.events.filter((e) => e.type === 'move');
  assert.equal(rb.lat, moveEvents[1].t);
});

test('formatCode turns a code into readable text and passes other text through', () => {
  assert.equal(formatCode('0R1U'), 'ball right, block A up');
  const perfect = didVsShould(solvedWith(set1[0], set1[0].solution), set1[0]);
  assert.equal(formatCode(perfect.ans), formatCode(perfect.opt));
  assert.equal(formatCode(perfect.ans).split(', ').length, set1[0].solution.length);
  assert.equal(formatCode(''), '');
  assert.equal(formatCode(undefined), '');
  assert.equal(formatCode('free text'), 'free text');
});

test('stampDvs stores the compact codes and sanitizeAttempt keeps them', () => {
  const puzzle = set1[1];
  const bad = solvedWith(puzzle, [puzzle.solution[0], secondDetour(puzzle)]);
  const attempt = { ...bad };
  delete attempt.dvs;
  const d = stampDvs('blockslide', attempt, puzzle);
  assert.ok(d && attempt.dvs, 'stampDvs sets attempt.dvs');
  assert.equal(attempt.dvs.div, 1);
  const kept = sanitizeAttempt(attempt);
  assert.deepEqual(kept.dvs, { ans: attempt.dvs.ans, opt: attempt.dvs.opt, div: 1, lat: attempt.dvs.lat });
});

test('timing: did vs should on every set 5 attempt stays well inside the save budget', () => {
  let worst = 0;
  for (const puzzle of set5) {
    const good = solvedWith(puzzle, puzzle.solution);
    const bad = solvedWith(puzzle, [puzzle.solution[0], secondDetour(puzzle)]);
    for (const a of [good, bad]) {
      const t0 = performance.now();
      didVsShould(a, puzzle);
      worst = Math.max(worst, performance.now() - t0);
    }
  }
  // The target is about 30 ms; the bound here is loose so slow CI machines do not flake.
  assert.ok(worst < 250, `slowest adapter call ${worst.toFixed(1)} ms`);
});
