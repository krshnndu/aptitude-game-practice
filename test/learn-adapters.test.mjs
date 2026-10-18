// Review adapters on real recorded attempts: user path, divergence point, coach tags, puzzle
// features, the optimal walkthrough; and the strategy cheat sheets stay true to explain.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttemptLog, sanitizeAttempt } from '../js/core/recorder.js';
import { ADAPTERS, SHEETS, correctFor } from '../js/core/learn-registry.js';
import { makeBoard, legalMoves } from '../js/games/blockslide/state.js';
import { createPickLog } from '../js/games/patternrule/state.js';
import { buildAttempt } from '../js/games/gridmemory/record.js';
import { HAND, playTrial } from './gridmemory-helpers.mjs';
import { loadSet as bsSet } from '../tools/verify.mjs';
import { loadSet as lsSet } from '../tools/latinsquare-verify.mjs';
import { loadSet as osSet } from '../tools/operatorswitch-verify.mjs';
import { loadSet as deSet } from '../tools/digitequation-verify.mjs';
import { loadSet as prSet } from '../tools/patternrule-verify.mjs';
import { loadSet as gmSet } from '../tools/gridmemory-verify.mjs';

const LOADERS = { blockslide: bsSet, latinsquare: lsSet, operatorswitch: osSet, digitequation: deSet, patternrule: prSet, gridmemory: gmSet };

// A fake clock that advances 1.5 s per logged action.
function logFor(game, puzzle, optimal) {
  let t = 1_000_000;
  return createAttemptLog({ game, set: 1, puzzleId: puzzle.id, mode: 'practice', optimal, now: () => (t += 1500) });
}
const save = (a) => sanitizeAttempt(a);

function check(game, puzzle, good, bad) {
  const ad = ADAPTERS[game];
  const pathBad = ad.userPath(bad, puzzle);
  assert.ok(pathBad.length >= 1, `${game}: user path`);
  assert.ok(pathBad.some((s) => s.ok === false), `${game}: a step off the solution`);
  const div = ad.divergence(bad, puzzle);
  assert.ok(div && Number.isInteger(div.index) && div.text.length > 10, `${game}: divergence point`);
  assert.ok(div.index < pathBad.length, `${game}: divergence inside the path`);
  assert.equal(ad.divergence(good, puzzle), null, `${game}: a clean solve never diverges`);
  assert.ok(ad.userPath(good, puzzle).every((s) => s.ok !== false), `${game}: clean path`);
  const tags = ad.tagsFor(bad, puzzle);
  assert.ok(Array.isArray(tags) && tags.every((t) => typeof t === 'string'));
  assert.ok(ad.features(puzzle).length >= 3);
  assert.ok(ad.optimalSteps(puzzle).length >= 1);
  assert.equal(correctFor(game)(good), true);
  assert.equal(correctFor(game)(bad) && bad.metrics.efficiency >= 0.7, false, `${game}: the bad attempt belongs in the notebook`);
  for (const d of ad.DIMS) {
    const v = d.value([good, bad], (a) => (a === bad ? tags : []));
    assert.ok(v === null || Number.isFinite(v), `${game}: dim ${d.key}`);
  }
  assert.ok(Number.isFinite(ad.parMs(good)) && ad.parMs(good) > 0);
  assert.ok(Number.isFinite(ad.timeOf(good)));
}

test('blockslide adapter: optimal line vs a detour', () => {
  const puzzle = bsSet(1).puzzles[0];
  const g = logFor('blockslide', puzzle, puzzle.optimal);
  for (const m of puzzle.solution) g.move(m.p, m.d);
  const good = save(g.end('solved', { moves: puzzle.optimal }));
  const board = makeBoard(puzzle);
  const first = puzzle.solution[0];
  const detour = legalMoves(board, board.start).find((m) => !(m.p === first.p && m.d === first.d));
  const b = logFor('blockslide', puzzle, puzzle.optimal);
  b.move(detour.p, detour.d);
  const bad = save(b.end('skipped', { moves: 1 }));
  check('blockslide', puzzle, good, bad);
});

test('latinsquare adapter: right pick vs a row or column duplicate', () => {
  const puzzle = lsSet(1).puzzles[0];
  const n = puzzle.symbols.length;
  // The right symbol is the one whose pick the adapter marks as on the solution.
  let right = null;
  for (let v = 0; v < n && right === null; v++) {
    const t = logFor('latinsquare', puzzle, 1);
    t.move(v, 0);
    if (ADAPTERS.latinsquare.userPath(save(t.end('solved', { moves: 1 })), puzzle)[0]?.ok) right = v;
  }
  assert.notEqual(right, null);
  const g = logFor('latinsquare', puzzle, 1);
  g.move(right, 0);
  const good = save(g.end('solved', { moves: 1 }));
  const b = logFor('latinsquare', puzzle, 1);
  b.move((right + 1) % n, 0);
  b.move(right, 0);
  const bad = save(b.end('solved', { moves: 2 }));
  check('latinsquare', puzzle, good, bad);
});

test('operatorswitch adapter: first answer right vs a misreading', () => {
  const puzzle = osSet(2).puzzles[0];
  const g = logFor('operatorswitch', puzzle, 1);
  g.move(puzzle.answer, 'answer');
  const good = save(g.end('solved', { moves: 1 }));
  const b = logFor('operatorswitch', puzzle, 1);
  b.move((puzzle.answer + 1) % puzzle.options.length, 'answer');
  b.move(puzzle.answer, 'answer');
  const bad = save(b.end('solved', { moves: 2 }));
  check('operatorswitch', puzzle, good, bad);
});

test('digitequation adapter: answer digits vs a wrong tile', () => {
  const puzzle = deSet(1).puzzles[0];
  const g = logFor('digitequation', puzzle, puzzle.optimal);
  puzzle.answer.forEach((d, slot) => {
    g.select(slot);
    g.move(slot, d);
  });
  const good = save(g.end('solved', { moves: puzzle.answer.length }));
  const wrong = puzzle.tray.map((x) => x.d).find((d) => d !== puzzle.answer[0]);
  const b = logFor('digitequation', puzzle, puzzle.optimal);
  b.select(0);
  b.move(0, wrong);
  b.move(0, puzzle.answer[0]);
  const bad = save(b.end('skipped', { moves: 2 }));
  check('digitequation', puzzle, good, bad);
});

test('patternrule adapter: exact answer vs a false pick', () => {
  const puzzle = prSet(1).puzzles[0];
  let t = 1_000_000;
  const mk = () => createPickLog({ set: 1, puzzleId: puzzle.id, mode: 'practice', optimal: puzzle.answer.length, now: () => (t += 1500) });
  const g = mk();
  for (const i of puzzle.answer) g.toggle(i, true);
  const good = save(g.end('correct', { picks: puzzle.answer }));
  const wrong = puzzle.candidates.findIndex((_, i) => !puzzle.answer.includes(i));
  const b = mk();
  b.toggle(wrong, true);
  const bad = save(b.end('wrong', { picks: [wrong] }));
  check('patternrule', puzzle, good, bad);
});

test('gridmemory adapter: perfect recall vs swapped positions', () => {
  const puzzle = HAND;
  const good = save(buildAttempt(playTrial(puzzle), { set: 1, mode: 'practice', startedAt: 1 }));
  const swapped = [puzzle.sequence[1], puzzle.sequence[0], ...puzzle.sequence.slice(2)];
  const bad = save(buildAttempt(playTrial(puzzle, { recall: swapped }), { set: 1, mode: 'practice', startedAt: 2 }));
  check('gridmemory', puzzle, good, bad);
  assert.ok(ADAPTERS.gridmemory.tagsFor(bad, puzzle).includes('order-errors'));
});

test('strategy sheets: heuristics, traps on stable coach tags, and a worked example true to explain.js', () => {
  for (const [game, sheet] of Object.entries(SHEETS)) {
    assert.equal(sheet.game, game);
    assert.ok(sheet.heuristics.length >= 4, game);
    assert.ok(sheet.traps.length >= 4, game);
    for (const t of sheet.traps) assert.ok(ADAPTERS[game].TAG_IDS.includes(t.tag), `${game}: trap tag ${t.tag} is a coach habit id`);
    const ex = sheet.example;
    const puzzle = LOADERS[game](ex.set).puzzles.find((p) => p.id === ex.puzzleId);
    assert.ok(puzzle, `${game}: example puzzle ${ex.puzzleId} exists`);
    assert.deepEqual(ex.steps, ADAPTERS[game].optimalSteps(puzzle).slice(0, ex.steps.length), `${game}: example steps match explain.js`);
    const text = JSON.stringify(sheet);
    assert.ok(!/[\u2010-\u2015\u2212]/.test(text), `${game}: no unicode dashes`);
  }
});
