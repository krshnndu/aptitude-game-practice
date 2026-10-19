// Grid Memory circles variant: generator, independent validator, shipped sets, state, fresh and
// ranked streams, review adapter and telemetry fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CIRCLE_CONFIGS, CIRCLE_SET_BASE, MARGIN, circleConfigFor, generateCircleSet, generateCircleTrial, generateCircleFresh,
  circleTrialFromId, circlePoolTrial, circleKey, circleFreshKit, circleTutorialTrial, drawLayout, isCircleSet, levelOf,
} from '../js/games/gridmemory/circles.js';
import { checkCirclePuzzle, checkCircleSetData, closestPair, solveCircles } from '../js/games/gridmemory/circles-validate.js';
import { createTrial, scoreTrial, cellLabel, spotCount, POINTS } from '../js/games/gridmemory/state.js';
import { createRunSource, createStaircase, freshKit, trialKey, tutorialTrial } from '../js/games/gridmemory/stream.js';
import { lengthLadder, PUZZLES_PER_SET, SET_CONFIGS, generateSet, configFor } from '../js/games/gridmemory/gen.js';
import { solveSide } from '../js/games/gridmemory/validate.js';
import { describePath, divergenceText, explainTrial, landmark } from '../js/games/gridmemory/explain.js';
import { refFor, regenerate, needsSet, didVsShould, formatCode, setFile, EXTRA_SETS, checksum, features } from '../js/games/gridmemory/review.js';
import { coachTrial } from '../js/games/gridmemory/coach.js';
import { buildAttempt } from '../js/games/gridmemory/record.js';
import { rankedSeed, practiceSeed, createSeenList, pickPracticePuzzle, practiceOwner } from '../js/core/fresh.js';
import { sanitizeAttempt } from '../js/core/recorder.js';
import { itemExtra, varField } from '../js/core/board.js';
import { createRng } from '../js/core/rng.js';
import { loadCircleSet, checkCircleSet } from '../tools/gridmemory-circles-verify.mjs';
import { loadSet as gridSet } from '../tools/gridmemory-verify.mjs';
import { playTrial } from './gridmemory-helpers.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

// ---------------------------------------------------------------- configs and shipped sets

test('circle configs: stored as sets 6..10, circles 6 to 14, sequences 3 to 8, all climbing', () => {
  assert.deepEqual(CIRCLE_CONFIGS.map((c) => c.set), [6, 7, 8, 9, 10]);
  assert.deepEqual(CIRCLE_CONFIGS.map((c) => c.level), [1, 2, 3, 4, 5]);
  assert.equal(CIRCLE_CONFIGS[0].circles, 6);
  assert.equal(CIRCLE_CONFIGS[4].circles, 14);
  assert.equal(CIRCLE_CONFIGS[0].lengths[0], 3);
  assert.equal(CIRCLE_CONFIGS[4].lengths[1], 8);
  for (let i = 1; i < CIRCLE_CONFIGS.length; i++) {
    const a = CIRCLE_CONFIGS[i - 1];
    const b = CIRCLE_CONFIGS[i];
    assert.ok(b.circles > a.circles && b.lengths[1] > a.lengths[1] && b.windowMs < a.windowMs && b.pauseMs >= a.pauseMs);
  }
  for (const c of CIRCLE_CONFIGS) {
    assert.ok(c.runMax <= c.circles, 'the staircase never asks for more circles than exist');
    assert.ok(c.lengths[1] <= c.runMax);
  }
  assert.ok(SET_CONFIGS.every((c) => !isCircleSet(c.set)), 'grid sets stay 1..5');
  assert.equal(levelOf(8), 3);
  assert.equal(CIRCLE_SET_BASE, 5);
});

for (const cfg of CIRCLE_CONFIGS) {
  test(`shipped circles set ${cfg.level} passes the validator and equals its seeded regeneration`, () => {
    const data = loadCircleSet(cfg.level);
    assert.equal(data.puzzles.length, PUZZLES_PER_SET);
    assert.deepEqual(checkCircleSet(data, cfg), []);
    assert.deepEqual(generateCircleSet(cfg), data);
    assert.deepEqual(data.puzzles.map((p) => p.length), lengthLadder(cfg));
    for (const p of data.puzzles) {
      assert.deepEqual(solveCircles(p), p.sequence);
      for (const d of p.distractors) assert.equal(solveSide(d), d.answer);
      assert.ok(closestPair(p.circles) >= cfg.minDist);
    }
  });
}

test('circles ids never collide with grid ids', () => {
  const ids = [...CIRCLE_CONFIGS.flatMap((c) => loadCircleSet(c.level).puzzles.map((p) => p.id)), ...SET_CONFIGS.flatMap((c) => gridSet(c.set).puzzles.map((p) => p.id))];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.filter((id) => id.startsWith('gc')).length === 50);
});

test('grid sets are unchanged by the shared side question builder', () => {
  for (const cfg of SET_CONFIGS) assert.deepEqual(generateSet(cfg), gridSet(cfg.set));
});

// ---------------------------------------------------------------- generator

test('generator is deterministic per seed and differs across seeds', () => {
  const cfg = circleConfigFor(9);
  assert.deepEqual(generateCircleSet(cfg, { seed: 77 }), generateCircleSet(cfg, { seed: 77 }));
  assert.notDeepEqual(generateCircleSet(cfg, { seed: 1 }).puzzles, generateCircleSet(cfg, { seed: 2 }).puzzles);
  assert.deepEqual(generateCircleFresh(cfg, 6, 12345), generateCircleFresh(cfg, 6, 12345));
});

test('layouts: no overlap, minimum distance and margin hold over many seeds', () => {
  for (const cfg of CIRCLE_CONFIGS) {
    for (let seed = 1; seed <= 60; seed++) {
      const pts = drawLayout(createRng(seed * 7919 + cfg.level), cfg.circles, cfg.minDist);
      assert.equal(pts.length, cfg.circles);
      assert.ok(closestPair(pts) >= cfg.minDist, `level ${cfg.level} seed ${seed}: ${closestPair(pts)}`);
      for (const [x, y] of pts) assert.ok(x >= MARGIN && x <= 1 - MARGIN && y >= MARGIN && y <= 1 - MARGIN);
      for (let i = 1; i < pts.length; i++) assert.ok(pts[i - 1][1] <= pts[i][1], 'reading order: top to bottom');
    }
  }
});

test('tap targets: at 360 px wide (328 px area) circles are 44 px and never touch', () => {
  const area = 328;
  for (const cfg of CIRCLE_CONFIGS) {
    assert.ok(cfg.minDist * area >= 44 + 8, `level ${cfg.level}: ${cfg.minDist * area} px between centres`);
    assert.ok(MARGIN * area >= 22, 'a 44 px circle stays inside the area');
  }
});

test('sequence lengths stay inside each band; fresh trials of any staircase length are valid', () => {
  for (const cfg of CIRCLE_CONFIGS) {
    for (let len = 2; len <= cfg.runMax; len++) {
      const p = generateCircleFresh(cfg, len, 1000 + len);
      assert.equal(p.sequence.length, len);
      assert.equal(new Set(p.sequence).size, len, 'distinct circles');
      assert.ok(p.sequence.every((i) => i >= 0 && i < cfg.circles));
      assert.equal(p.distractors.length, len);
      const probs = checkCirclePuzzle(p, { ...cfg, lengths: [2, cfg.runMax] });
      assert.deepEqual(probs, []);
    }
    assert.throws(() => generateCircleTrial(createRng(1), cfg, cfg.circles + 1, 'x'));
  }
});

// ---------------------------------------------------------------- validator

test('validator catches overlap, repeats, out of area, bad answers and timing', () => {
  const cfg = circleConfigFor(8);
  const good = loadCircleSet(3).puzzles[0];
  assert.deepEqual(checkCirclePuzzle(good, cfg), []);
  const near = clone(good);
  near.circles[1] = [near.circles[0][0] + 0.05, near.circles[0][1]];
  assert.ok(checkCirclePuzzle(near, cfg).some((m) => /apart/.test(m)));
  const rep = clone(good);
  rep.sequence[1] = rep.sequence[0];
  assert.ok(checkCirclePuzzle(rep, cfg).some((m) => /repeats/.test(m)));
  const off = clone(good);
  off.circles[2] = [0.99, 0.5];
  assert.ok(checkCirclePuzzle(off, cfg).some((m) => /outside/.test(m)));
  const missing = clone(good);
  missing.sequence[0] = 99;
  assert.ok(checkCirclePuzzle(missing, cfg).some((m) => /does not exist/.test(m)));
  const wrongSide = clone(good);
  const d = wrongSide.distractors[0];
  d.answer = d.kind === 'sym' ? (d.answer === 'yes' ? 'no' : 'yes') : (d.answer === 'even' ? 'odd' : 'even');
  assert.ok(checkCirclePuzzle(wrongSide, cfg).some((m) => /stored answer/.test(m)));
  const pause = clone(good);
  pause.pauseMs = 0;
  assert.ok(checkCirclePuzzle(pause, cfg).some((m) => /pauseMs/.test(m)));
  const few = clone(good);
  few.circles.pop();
  assert.ok(checkCirclePuzzle(few, cfg).some((m) => /need 10 circles/.test(m)));
  const set = clone(loadCircleSet(3));
  set.puzzles[3] = clone(set.puzzles[2]);
  assert.ok(checkCircleSetData(set, cfg).some((m) => /duplicate/.test(m)));
});

// ---------------------------------------------------------------- state and scoring

test('trial: taps bound by circle count, pause before recall, scoring same as the grid', () => {
  const p = loadCircleSet(3).puzzles[0];
  assert.equal(spotCount(p), 10);
  assert.ok(p.pauseMs > 0);
  const trial = createTrial(p);
  let t = 0;
  trial.begin(t);
  for (let i = 0; i < p.length; i++) {
    trial.endShow((t += 1000));
    trial.answer(p.distractors[i].answer, (t += 500));
  }
  assert.equal(trial.phase, 'pause');
  assert.deepEqual(trial.tap(p.sequence[0], t + 1), { ok: false, reason: 'phase' });
  assert.ok(trial.endPause((t += p.pauseMs)));
  assert.equal(trial.phase, 'recall');
  assert.equal(trial.tap(10, t + 1).reason, 'cell', 'index past the last circle');
  assert.equal(trial.tap(9, t + 2).ok, true, 'the last circle is tappable');
  const r = trial.result();
  assert.equal(r.maxPoints, p.length * (POINTS.recall + POINTS.side));
  // Wrong taps are entered and scored per position, exactly like the grid.
  const played = playTrial(p, { recall: [p.sequence[1], p.sequence[0], ...p.sequence.slice(2)] });
  const res = played.result();
  assert.equal(res.recall.correct, p.length - 2);
  assert.equal(res.recall.order, 2);
  assert.equal(res.points, (p.length - 2) * POINTS.recall + p.length * POINTS.side);
  assert.deepEqual(scoreTrial(p, { recall: p.sequence, answers: played.answers }).points, p.length * 10);
  const perfect = playTrial(loadCircleSet(1).puzzles[0]).result();
  assert.equal(perfect.efficiency, 1);
  assert.ok(perfect.success);
});

test('labels: circles named by number and third of the area, grid unchanged', () => {
  const p = { circles: [[0.1, 0.1], [0.5, 0.5], [0.9, 0.9], [0.1, 0.5]], sequence: [0, 1, 2], length: 3 };
  assert.equal(cellLabel(p, 2), 'circle 3');
  assert.equal(landmark(p, 0), 'top left');
  assert.equal(landmark(p, 1), 'centre');
  assert.equal(landmark(p, 2), 'bottom right');
  assert.equal(landmark(p, 3), 'middle left');
  assert.equal(cellLabel(3, 5), '(2,3)');
  assert.equal(cellLabel({ n: 3 }, 5), '(2,3)');
  const path = describePath(p, p.sequence);
  assert.equal(path.steps.length, 3);
  assert.match(path.steps[0].text, /^Start: circle 1 \(top left\)/);
  assert.match(path.steps[1].text, /down-right to circle 2/);
});

// ---------------------------------------------------------------- streams: ranked, fresh, practice

test('ranked run: same seed gives every player the same trials, shipped first then generated', () => {
  const cfg = circleConfigFor(7);
  const data = loadCircleSet(2);
  const seed = rankedSeed('gridmemory', 7);
  assert.notEqual(seed, rankedSeed('gridmemory', 2), 'circles and grid ranked seeds differ');
  const play = () => {
    const src = createRunSource({ puzzles: data.puzzles, cfg, seed, shuffle: false });
    const stair = createStaircase({ start: cfg.lengths[0], max: cfg.runMax });
    const out = [];
    for (let i = 0; i < 25; i++) {
      const { puzzle, source } = src.next(stair.length);
      out.push([puzzle.id, source, circleKey(puzzle)]);
      stair.update(i % 3 !== 2);
    }
    return out;
  };
  const a = play();
  assert.deepEqual(a, play());
  assert.equal(a[0][1], 'pool');
  assert.ok(a.some(([, s]) => s === 'generated'));
  for (const [id] of a.filter(([, s]) => s === 'generated')) {
    const rebuilt = circleTrialFromId(id);
    assert.ok(rebuilt, `generated id ${id} rebuilds`);
  }
});

test('fresh timed run: generated only, skips seen trials, never repeats', () => {
  const cfg = circleConfigFor(6);
  const seen = new Set();
  const src = createRunSource({ puzzles: loadCircleSet(1).puzzles, cfg, seed: 99, usePool: false, isSeen: (k) => seen.has(k) });
  const keys = new Set();
  for (let i = 0; i < 30; i++) {
    const { puzzle, source } = src.next(3 + (i % 3));
    assert.equal(source, 'generated');
    assert.equal(puzzle.var, 'circles');
    const k = trialKey(puzzle);
    assert.ok(!keys.has(k));
    keys.add(k);
    seen.add(k);
  }
});

test('practice is endless past the shipped 10: unique valid trials on the length ladder', () => {
  const setNo = 9;
  const cfg = circleConfigFor(setNo);
  const puzzles = loadCircleSet(4).puzzles;
  const shipped = new Set(puzzles.map(freshKit.keyOf));
  const seen = createSeenList(memStorage());
  const keys = new Set();
  for (let k = 11; k <= 60; k++) {
    const p = pickPracticePuzzle({ game: 'gridmemory', set: setNo, k, cid: 'tester', make: (seed) => freshKit.make(setNo, seed, k), keyOf: freshKit.keyOf, shipped, seen });
    assert.ok(p, `slot ${k}`);
    assert.equal(p.length, lengthLadder(cfg)[(k - 1) % PUZZLES_PER_SET]);
    assert.deepEqual(checkCirclePuzzle(p, cfg), []);
    const key = freshKit.keyOf(p);
    assert.ok(!keys.has(key));
    keys.add(key);
    seen.add('gridmemory', key, practiceOwner(setNo, k));
    // The same slot rebuilds the same trial (a reload).
    assert.deepEqual(circleFreshKit.make(setNo, practiceSeed('tester', 'gridmemory', setNo, k, 0), k), freshKit.make(setNo, practiceSeed('tester', 'gridmemory', setNo, k, 0), k));
  }
});

test('tutorial trial: two circles, the set layout rules', () => {
  const cfg = circleConfigFor(10);
  const p = tutorialTrial(cfg);
  assert.deepEqual(p, circleTutorialTrial(cfg));
  assert.equal(p.length, 2);
  assert.equal(p.circles.length, cfg.circles);
  assert.ok(tutorialTrial(configFor(1)).n === 3, 'grid tutorial unchanged');
});

// ---------------------------------------------------------------- review, did vs should, telemetry

test('review adapter: circles trials rebuild without a set file, did vs should names circles', () => {
  const pool = loadCircleSet(2).puzzles[3];
  const fresh = generateCircleFresh(circleConfigFor(7), 5, 4242);
  const played = playTrial(pool, { recall: [pool.sequence[0], pool.sequence[2], pool.sequence[1], ...pool.sequence.slice(3)] });
  const attempt = buildAttempt(played, { set: 7, mode: 'practice', startedAt: 1000 });
  assert.equal(attempt.var, 'circles');
  const refPool = refFor(attempt, pool);
  assert.equal(refPool.src, 'pool');
  assert.equal(needsSet(refPool), false);
  assert.deepEqual(regenerate(refPool), pool);
  assert.equal(checksum(regenerate(refPool)), refPool.check);
  assert.deepEqual(circlePoolTrial(`${pool.id}~r12`).sequence, pool.sequence);
  const refFresh = refFor({ puzzleId: fresh.id, set: 7 }, fresh);
  assert.equal(refFresh.src, 'generated');
  assert.deepEqual(regenerate(refFresh), fresh);
  const dvs = didVsShould(attempt, pool);
  assert.equal(dvs.div, 1, 'first divergence at position 2');
  assert.equal(dvs.rows[1].did, `circle ${pool.sequence[2] + 1}`);
  assert.equal(dvs.rows[1].should, `circle ${pool.sequence[1] + 1}`);
  assert.match(dvs.opt, /^c\d+(\.c\d+)+$/);
  assert.match(formatCode(dvs.ans), /^circle \d+, circle/);
  assert.match(dvs.note, /Position error/);
  const ex = explainTrial(pool, played.result(), played.answers);
  assert.match(ex.divergence, /position 2/);
  assert.ok(features(pool).includes('8 circles'));
  const coach = coachTrial(attempt, pool);
  assert.ok(coach.findings.some((f) => f.id === 'order-errors' || /Order lost/.test(f.title)));
  assert.match(divergenceText(pool, played.result().recall), /circle/);
  assert.equal(setFile(8), 'circles-set3.json');
  assert.equal(setFile(3), null);
  assert.deepEqual(EXTRA_SETS.map((s) => s.set), [6, 7, 8, 9, 10]);
});

test('telemetry: circles attempts carry var through the recorder into item events', () => {
  const p = loadCircleSet(1).puzzles[0];
  const attempt = buildAttempt(playTrial(p), { set: 6, mode: 'exam', runId: 'r1', startedAt: 5 });
  attempt.rank = 0;
  const clean = sanitizeAttempt(attempt);
  assert.equal(clean.var, 'circles');
  const extra = itemExtra(clean, 'r1', 1);
  assert.equal(extra.var, 'circles');
  assert.equal(extra.rank, 0, 'circles runs are unranked');
  const grid = sanitizeAttempt(buildAttempt(playTrial(gridSet(1).puzzles[0]), { set: 1, mode: 'exam', runId: 'r2', startedAt: 5 }));
  assert.equal(grid.var, undefined);
  assert.deepEqual(varField(grid), {});
  assert.equal('var' in itemExtra(grid, 'r2', 1), false);
});
