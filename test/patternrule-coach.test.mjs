// Pattern Rule coach: findings computed from the player's own picks, timing and skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachPuzzle, coachRun, topHabits, surfaceFeatures, HABITS, DIM_TIPS } from '../js/games/patternrule/coach.js';
import { createPickLog } from '../js/games/patternrule/state.js';
import { atom } from '../js/games/patternrule/rules.js';
import { summarizeRun } from '../js/core/recorder.js';
import { loadSet } from '../tools/patternrule-verify.mjs';

const neg = (p) => p.candidates.map((_, i) => i).filter((i) => !p.answer.includes(i));
const ids = (res) => res.findings.map((f) => f.id);
const get = (res, id) => res.findings.find((f) => f.id === id);

// steps: [t, i, on] toggles; end at `end` ms with `result`.
function play(p, steps, { result, end, mode = 'practice', set = 1, hints = 0, id = null, picks = null } = {}) {
  let t = 0;
  const log = createPickLog({ set, puzzleId: p.id, mode, optimal: p.answer.length, now: () => t });
  for (const [at, i, on] of steps) {
    t = at;
    log.toggle(i, on);
  }
  for (let k = 0; k < hints; k++) log.hint();
  t = end;
  const finalPicks = picks ?? (() => {
    const s = new Set();
    for (const [, i, on] of steps) (on ? s.add(i) : s.delete(i));
    return [...s].sort((a, b) => a - b);
  })();
  const a = log.end(result, { picks: finalPicks, hintsUsed: hints });
  if (id) a.id = id;
  return a;
}

const S3 = loadSet(3).puzzles[4];

test('a correct, unhurried answer has no fix items', () => {
  const p = S3;
  const a = play(p, p.answer.map((i, k) => [8000 + k * 1000, i, true]), { result: 'correct', end: 20000, set: 3 });
  const res = coachPuzzle(a, p, { paceSec: 40 });
  assert.ok(ids(res).includes('correct'));
  assert.deepEqual(res.findings.filter((f) => f.kind === 'fix'), []);
});

test('a wrong pick names the dimension it breaks: the overlooked dimension', () => {
  const p = S3;
  const bad = neg(p)[0];
  const dim = atom(p.violates[bad][0]).dim;
  const a = play(p, [[5000, bad, true], ...p.answer.map((i, k) => [6000 + k * 500, i, true])], { result: 'wrong', end: 20000, set: 3 });
  const res = coachPuzzle(a, p, { paceSec: 40 });
  assert.ok(ids(res).includes('false-pick'));
  const o = get(res, `overlooked-${dim === 'relation' ? 'relation' : dim}`);
  assert.ok(o, `overlooked-${dim} in ${ids(res)}`);
  assert.equal(o.kind, 'fix');
  assert.deepEqual(o.data.candidates, [bad]);
  assert.match(o.detail, /breaks the .+ part of the rule/);
  assert.equal(o.tip, DIM_TIPS[dim]);
});

test('a miss reports the surface feature that likely put the player off (set 2 distractor)', () => {
  const p = loadSet(2).puzzles.find((q) => q.answer.length >= 1 && q.distractor && surfaceFeatures(q, q.answer[0]).length);
  assert.ok(p, 'a set 2 puzzle whose fitting candidate lacks a look most fitting panels share');
  const missed = p.answer[0];
  const others = p.answer.filter((i) => i !== missed);
  const steps = [...others.map((i, k) => [4000 + k * 500, i, true]), [9000, neg(p)[0], true]];
  const a = play(p, steps, { result: 'wrong', end: 15000, set: 2 });
  const res = coachPuzzle(a, p, { paceSec: 30 });
  assert.ok(ids(res).includes('miss'));
  const surf = res.findings.find((f) => f.id.startsWith('surface-'));
  assert.ok(surf, ids(res).join(','));
  assert.ok(surf.data.candidates.includes(missed));
  assert.match(surf.detail, /is not part of the rule here/);
});

test('changed picks, slow and rushed answers, hints', () => {
  const p = S3;
  const bad = neg(p)[0];
  const flip = [[1000, bad, true], [2000, bad, false], [3000, bad, true], [4000, bad, false], [5000, bad, true], [6000, bad, false], [7000, bad, true], [8000, bad, false]];
  const a = play(p, [...flip, ...p.answer.map((i) => [9000, i, true])], { result: 'correct', end: 100000, set: 3, hints: 2 });
  const res = coachPuzzle(a, p, { paceSec: 40 });
  assert.equal(get(res, 'changed').kind, 'fix');
  assert.equal(get(res, 'changed').data.offs, 4);
  assert.ok(get(res, 'slow'));
  assert.ok(get(res, 'hints'));
  const r = play(p, [[500, bad, true]], { result: 'wrong', end: 3000, set: 3 });
  assert.ok(get(coachPuzzle(r, p, { paceSec: 40 }), 'rushed'));
});

test('skip timing: early, late, and a skip that was already right', () => {
  const p = S3;
  const early = play(p, [], { result: 'skipped', end: 3000, set: 3 });
  assert.ok(get(coachPuzzle(early, p, { paceSec: 40 }), 'skip-early'));
  const late = play(p, [[5000, neg(p)[0], true]], { result: 'skipped', end: 100000, set: 3 });
  const lr = coachPuzzle(late, p, { paceSec: 40 });
  assert.ok(get(lr, 'skip-late'));
  assert.equal(get(lr, 'skip-late').severity, 2);
  const right = play(p, p.answer.map((i) => [5000, i, true]), { result: 'skipped', end: 30000, set: 3 });
  const rr = coachPuzzle(right, p, { paceSec: 40 });
  assert.ok(get(rr, 'skip-cost') && get(rr, 'was-right'));
  const to = play(p, [], { result: 'timeout', end: 9000, set: 3, mode: 'exam' });
  assert.ok(get(coachPuzzle(to, p, { paceSec: 40 }), 'timeout'));
});

test('first-pick latency is compared with your own median once there are 3 attempts', () => {
  const p = S3;
  const history = [1, 2, 3].map((k) => play(p, [[4000, p.answer[0], true]], { result: 'skipped', end: 9000, set: 3, id: `h${k}` }));
  const a = play(p, [[8000, p.answer[0], true]], { result: 'skipped', end: 20000, set: 3, id: 'now' });
  const f = get(coachPuzzle(a, p, { paceSec: 40, history }), 'first-pick');
  assert.equal(f.data.medianMs, 4000);
  assert.match(f.detail, /your median is 4\.0 s for this puzzle \(3 attempts\)/);
});

test('run coaching: time per puzzle, wrong picks against misses, overlooked dimension, skips, pace, habits', () => {
  const set = loadSet(3).puzzles;
  const attempts = [];
  const puzzles = new Map();
  set.slice(0, 6).forEach((p, k) => {
    puzzles.set(p.id, p);
    const bad = neg(p)[0];
    // Over-select: every answer adds one wrong pick.
    attempts.push(play(p, [...p.answer.map((i) => [3000, i, true]), [4000, bad, true]], { result: 'wrong', end: 30000 + k * 1000, set: 3, mode: 'exam', id: `a${k}` }));
  });
  const run = summarizeRun({ id: 'r', game: 'patternrule', set: 3, seed: 1, startedAt: 0, endedAt: 360000, budgetMs: 360000, attempts });
  const rc = coachRun(run, attempts, puzzles, { paceSec: 40 });
  const line = (id) => rc.lines.find((l) => l.id === id);
  assert.ok(line('time-per-puzzle'));
  assert.equal(line('accuracy').kind, 'fix');
  assert.match(line('accuracy').tip, /over-select/);
  assert.equal(line('accuracy').data.falsePicks, 6);
  assert.ok(line('overlooked'));
  assert.ok(line('skip-policy'));
  assert.ok(line('pace'));
  assert.ok(rc.habits.length >= 1);
  assert.equal(rc.habits[0].id, 'false-pick');
  for (const h of rc.habits) assert.ok(HABITS[h.id]);
  assert.equal(rc.perPuzzle.length, 6);
  const empty = coachRun({ ...run, puzzles: [] }, [], puzzles);
  assert.equal(empty.lines[0].id, 'empty');
});

test('topHabits ranks by summed severity and counts puzzles once', () => {
  const f = (id, severity) => ({ id, kind: 'fix', severity });
  const res = topHabits([[f('miss', 2), f('miss', 2)], [f('false-pick', 2)], [f('miss', 1), { id: 'correct', kind: 'good', severity: 0 }]]);
  assert.equal(res[0].id, 'miss');
  assert.equal(res[0].weight, 5);
  assert.equal(res[0].count, 2);
  assert.equal(res[0].of, 3);
});
