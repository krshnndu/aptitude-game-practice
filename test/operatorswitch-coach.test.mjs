// Operator Switch: explanations, hints, coach (per puzzle and per run), recorder integration, and
// the repo content rules for this game's files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { explainPuzzle, hintSteps, eliminate, slotTrace, numbersToItems, itemsToNumbers, resultSummary } from '../js/games/operatorswitch/explain.js';
import { coachPuzzle, coachRun, errorFor, attemptResult, rowResult, slotOneValue, topHabits } from '../js/games/operatorswitch/coach.js';
import { createSession, chainResult, invertOp, applyOp, correctValue, spaced, identityOp, runChain, puzzleMistakes, hiddenRows } from '../js/games/operatorswitch/state.js';
import { SET_CONFIGS } from '../js/games/operatorswitch/gen.js';
import { createAttemptLog, createRecorder, summarizeRun, sanitizeAttempt, memoryStorage } from '../js/core/recorder.js';
import { loadSet } from '../tools/operatorswitch-verify.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const forward = (start, ops, options, answer) => ({ id: 'tp', kind: 'forward', n: start.length, start, chains: [ops], hidden: null, target: null, options, answer, optimal: 1 });

// Builds a finished attempt by playing a session through a real recorder log.
function play(puzzle, picks, { mode = 'practice', set = 1, gapMs = 4000, skipAt = null, hints = 0, timeout = false } = {}) {
  let t = 0;
  const log = createAttemptLog({ game: 'operatorswitch', set, puzzleId: puzzle.id, mode, optimal: 1, now: () => t });
  const s = createSession(puzzle, { mode, maxHints: 5 });
  for (let h = 0; h < hints; h++) {
    t += 500;
    s.useHint();
    log.hint();
  }
  for (const i of picks) {
    t += gapMs;
    s.answer(i);
    log.move(i, 'answer');
    if (!s.playing) break;
  }
  if (s.playing) {
    if (timeout) {
      t = skipAt ?? t + 1000;
      s.timeout();
    } else {
      t = skipAt ?? t + 1000;
      s.skip();
    }
  }
  return { attempt: log.end(s.outcome(), { moves: s.submissions, hintsUsed: s.hintsUsed }), session: s };
}

const START = 'CSTD';
const OPS = ['3142', '4312', '2431'];
const RIGHT = chainResult(START, OPS);
const ORIGINAL = applyOp(START, OPS[2]);
const INVERSE = chainResult(START, OPS.map(invertOp));
const P3 = forward(START, OPS, [RIGHT, ORIGINAL, INVERSE, RIGHT[1] + RIGHT[0] + RIGHT.slice(2)], 0);

// ---------------------------------------------------------------- explanation

test('explanation tracks digits step by step and maps them back to shapes', () => {
  const p = forward('CSTD', ['3142'], ['TCDS', 'SDCT', 'TDCS', 'CTDS'], 0);
  const ex = explainPuzzle(p);
  assert.equal(ex.value, 'TCDS');
  const box = ex.steps.find((s) => s.title === 'Box 1');
  assert.equal(box.numbers, '3142');
  assert.match(box.text, /copies its digits/);
  const back = ex.steps.find((s) => s.title === 'Back to shapes');
  assert.match(back.text, /3 is triangle T, 1 is circle C, 4 is diamond D, 2 is square S/);
  assert.equal(numbersToItems('CSTD', '3142'), 'TCDS');
});

test('explanation for a 3 box chain: rows, slot 1 trace, elimination and named wrong options', () => {
  const ex = explainPuzzle(P3);
  const rows = runChain(identityOp(4), OPS);
  const boxSteps = ex.steps.filter((s) => /^Box \d/.test(s.title));
  assert.deepEqual(boxSteps.map((s) => s.numbers), rows.slice(1));
  assert.match(boxSteps[1].text, /slot 1 takes the \w+ entry/);
  assert.equal(ex.trace.item, RIGHT[0]);
  assert.match(ex.trace.text, /^Slot 1 quick trace: box 3 says slot 1 comes from position \d/);
  assert.equal(ex.elimination.answer, 0);
  const why = Object.fromEntries(ex.others.map((o) => [o.option, o]));
  assert.ok(why[1].kinds.length && /start row|leave out|order/.test(why[1].text), why[1].text);
  assert.ok(why[2].kinds.includes('inverse'));
  assert.match(why[3].text, /slots 1 and 2 are swapped/);
  assert.ok(ex.strategy.some((s) => /Track digits, not shapes/.test(s)));
  assert.ok(ex.strategy.some((s) => /slot 1 first/.test(s)));
  assert.ok(ex.strategy.some((s) => /intermediate result/.test(s)));
});

test('elimination stops as soon as one option is left', () => {
  const e = eliminate(P3);
  assert.equal(e.steps[e.steps.length - 1].left.length, 1);
  assert.ok(e.steps.every((s, i) => i === e.steps.length - 1 || s.left.length > 1));
});

test('slot trace matches the real result for every shipped puzzle and every slot', () => {
  for (const cfg of SET_CONFIGS) {
    for (const p of loadSet(cfg.set).puzzles) {
      if (p.kind === 'hidden') continue;
      const right = correctValue(p);
      for (let s = 1; s <= p.n; s++) assert.equal(slotTrace(p.start, p.chains[0], s).item, right[s - 1]);
    }
  }
});

test('hidden explanation: forward to the gap, undo from the output, read the digits', () => {
  for (const p of loadSet(4).puzzles) {
    const ex = explainPuzzle(p);
    const last = ex.steps[ex.steps.length - 1];
    assert.equal(last.title, 'Read the hidden box');
    assert.equal(last.numbers, p.options[p.answer]);
    assert.match(last.text, new RegExp(`hidden box is ${spaced(p.options[p.answer])}`));
    const len = p.chains[0].length;
    const undo = ex.steps.filter((s) => s.title.startsWith('Undo box')).length;
    assert.equal(undo, len - 1 - p.hidden.at);
  }
});

test('twin explanation works the shorter chain and checks the other', () => {
  const twins = loadSet(5).puzzles.filter((p) => p.kind === 'twin');
  assert.ok(twins.length);
  for (const p of twins) {
    const ex = explainPuzzle(p);
    assert.match(ex.steps[0].text, /shorter|only need one/);
    assert.equal(ex.steps[ex.steps.length - 1].title, 'Check');
    assert.equal(ex.value, correctValue(p));
  }
});

test('hints never give the final answer away', () => {
  for (const cfg of SET_CONFIGS) {
    for (const p of loadSet(cfg.set).puzzles) {
      const hints = hintSteps(p);
      assert.ok(hints.length >= 1);
      const right = correctValue(p);
      if (p.kind === 'hidden') {
        assert.equal(hints.length, 2);
        // The row coming out of the gap equals the answer when the gap is box 1, so it is only
        // ever stated when the row going in is not the plain numbering 1..n.
        const { before } = hiddenRows(p);
        const plainIn = itemsToNumbers(p.start, before) === identityOp(p.n);
        if (plainIn) assert.ok(hints.every((h) => !h.includes(spaced(right))), `${p.id}: gap in box 1 must not show the answer row`);
        assert.ok(hints.every((h) => !/hidden box is \d/.test(h)), `${p.id}: no hint names the hidden box`);
      } else {
        const main = p.kind === 'twin' && p.chains[1].length < p.chains[0].length ? 1 : 0;
        assert.equal(hints.length, p.chains[main].length, 'one slot 1 hint, then rows up to the last box');
        const finalRow = spaced(runChain(identityOp(p.n), p.chains[main]).pop());
        assert.ok(hints.every((h) => !h.includes(`is ${finalRow}.`)), `${p.id}: no hint states the final row`);
      }
    }
  }
});

test('result summaries for practice and exam', () => {
  assert.match(resultSummary({ status: 'correct', submissions: 1, options: 4 }), /first time/);
  assert.match(resultSummary({ status: 'correct', submissions: 2, options: 4 }), /50%/);
  assert.match(resultSummary({ status: 'wrong', options: 4, mode: 'exam' }), /0\.33/);
  assert.match(resultSummary({ status: 'skipped', options: 4, mode: 'exam' }), /0 points/);
});

// ---------------------------------------------------------------- coach, per puzzle

const ids = (res) => res.findings.map((f) => f.id);

test('coach: correct first time gives no fix items', () => {
  const { attempt } = play(P3, [0], { gapMs: 12000 });
  const res = coachPuzzle(attempt, P3, { paceSec: 28 });
  assert.equal(res.result, 'correct');
  assert.ok(ids(res).includes('correct-first'));
  assert.equal(res.findings.filter((f) => f.kind === 'fix').length, 0);
});

test('coach: names "applied to the start row" and "inverse" errors from the wrong pick', () => {
  const { attempt } = play(P3, [1, 2, 0], { gapMs: 12000 });
  const res = coachPuzzle(attempt, P3, { paceSec: 28 });
  const errs = res.errors.map((e) => e.kind);
  assert.equal(errFor(P3, 1), puzzleMistakes(P3).find((m) => m.value === ORIGINAL).kind);
  assert.ok(errs.includes('inverse'));
  assert.ok(ids(res).includes('err-inverse'));
  const wasted = res.findings.find((f) => f.id === 'wasted');
  assert.match(wasted.detail, /2 wrong answers before the right one, so efficiency is 33%/);
});

function errFor(p, i) {
  return errorFor(p, i).kind;
}

test('coach: original-row misreading is detected when it is the primary match', () => {
  // 2 boxes where applying box 2 to the start differs from every other misreading.
  const p = forward('CSTD', ['3142', '4312'], [], 0);
  const orig = applyOp('CSTD', '4312');
  const others = puzzleMistakes(p).filter((m) => m.kind !== 'original').map((m) => m.value);
  assert.ok(!others.includes(orig) || puzzleMistakes(p)[0].kind !== 'original');
  const q = { ...p, options: [chainResult('CSTD', p.chains[0]), orig, 'DTSC', 'TDSC'].filter((v, i, a) => a.indexOf(v) === i) };
  const e = errorFor(q, 1);
  assert.ok(e.kinds.includes('original'));
  assert.match(e.text, /start row/);
});

test('coach: slip and hidden-box errors', () => {
  assert.equal(errFor(P3, 3), 'slip');
  const p = loadSet(4).puzzles.find((x) => x.options.some((o, i) => i !== x.answer && o === invertOp(x.options[x.answer])));
  assert.ok(p, 'a set 4 puzzle offers the inverse of the hidden box');
  const i = p.options.indexOf(invertOp(p.options[p.answer]));
  assert.equal(errFor(p, i), 'hidden-inverse');
});

test('coach: quick re-guess after a wrong pick, and a rushed first answer', () => {
  const { attempt } = play(P3, [3, 0], { gapMs: 1200 });
  const res = coachPuzzle(attempt, P3, { paceSec: 28 });
  assert.ok(ids(res).includes('guess-retry'));
  assert.ok(ids(res).includes('rushed'));
});

test('coach: exam wrong answer is recorded as skipped-with-answer and costs a penalty', () => {
  const { attempt } = play(P3, [2], { mode: 'exam', gapMs: 9000 });
  assert.equal(attempt.outcome, 'skipped');
  assert.equal(attemptResult(attempt), 'wrong');
  const res = coachPuzzle(attempt, P3, { paceSec: 28 });
  assert.equal(res.result, 'wrong');
  const cost = res.findings.find((f) => f.id === 'exam-wrong-cost');
  assert.match(cost.detail, /1\/3 = 0\.33 points/);
  assert.ok(ids(res).includes('err-inverse'));
});

test('coach: skip timing, with what slot 1 alone was worth', () => {
  const late = coachPuzzle(play(P3, [], { mode: 'exam', skipAt: 70000 }).attempt, P3, { paceSec: 28 });
  assert.ok(ids(late).includes('skip-late'));
  assert.match(late.findings.find((f) => f.id === 'skip-late').detail, /Slot 1 alone would have/);
  const early = coachPuzzle(play(P3, [], { mode: 'exam', skipAt: 2000 }).attempt, P3, { paceSec: 28 });
  assert.ok(ids(early).includes('skip-early'));
  const mid = coachPuzzle(play(P3, [], { mode: 'exam', skipAt: 20000 }).attempt, P3, { paceSec: 28 });
  assert.ok(ids(mid).includes('skip-cost'));
  const v = slotOneValue(P3);
  assert.equal(v.left, eliminate(P3).steps[0].left.length);
});

test('coach: time out and hints', () => {
  const t = coachPuzzle(play(P3, [], { mode: 'exam', timeout: true, skipAt: 15000 }).attempt, P3, { paceSec: 28 });
  assert.equal(t.result, 'timeout');
  assert.ok(ids(t).includes('timeout'));
  const h = coachPuzzle(play(P3, [0], { hints: 2, gapMs: 10000 }).attempt, P3, { paceSec: 28 });
  assert.match(h.findings.find((f) => f.id === 'hints').detail, /2 hints/);
});

test('coach: time to answer against your own median', () => {
  const history = [8000, 9000, 10000].map((ms, i) => ({ id: `h${i}`, game: 'operatorswitch', set: 3, puzzleId: 'tp', metrics: { firstMoveMs: ms } }));
  const slow = coachPuzzle(play(P3, [0], { gapMs: 30000, set: 3 }).attempt, P3, { paceSec: 28, history });
  const f = slow.findings.find((x) => x.id === 'slow-answer');
  assert.ok(f);
  assert.equal(f.data.scope, 'puzzle');
  const quick = coachPuzzle(play(P3, [0], { gapMs: 5000, set: 3 }).attempt, P3, { paceSec: 28, history });
  assert.ok(ids(quick).includes('quick'));
});

test('coach: ignores answer events it cannot read', () => {
  const attempt = { id: 'x', outcome: 'solved', mode: 'practice', events: [{ t: 100, type: 'move', p: 99 }, { t: 900, type: 'move', p: 0 }, { t: 900, type: 'solve' }], metrics: { totalMs: 900, firstMoveMs: 100 } };
  const res = coachPuzzle(attempt, P3, { paceSec: 28 });
  assert.ok(ids(res).includes('log'));
});

// ---------------------------------------------------------------- coach, per run

test('run coaching: accuracy, most common error, fast wrong answers, skips, pace and habits', () => {
  const puzzles = loadSet(3).puzzles;
  const attempts = [];
  // Picks: wrong with the "original" misreading where offered, else any wrong one.
  puzzles.forEach((p, i) => {
    let pick = p.answer;
    let gap = 15000;
    if (i % 2 === 0) {
      const named = puzzleMistakes(p);
      const target = named.find((m) => m.kind === 'inverse') ?? named[0];
      const idx = p.options.indexOf(target.value);
      pick = idx >= 0 ? idx : p.options.findIndex((_, k) => k !== p.answer);
      gap = i === 0 ? 3000 : 15000;
    }
    const { attempt } = play(p, i === 9 ? [] : [pick], { mode: 'exam', set: 3, gapMs: gap, skipAt: i === 9 ? 70000 : null });
    attempts.push(attempt);
  });
  const run = summarizeRun({ id: 'r1', game: 'operatorswitch', set: 3, seed: 1, startedAt: 0, endedAt: 360000, budgetMs: 360000, attempts });
  run.score = 3;
  const res = coachRun(run, attempts, new Map(puzzles.map((p) => [p.id, p])), { paceSec: 28 });
  const byId = Object.fromEntries(res.lines.map((l) => [l.id, l]));
  assert.match(byId.accuracy.text, /4 of 9 answers correct/);
  assert.equal(byId.accuracy.kind, 'fix');
  assert.ok(byId['common-error']);
  assert.equal(byId['common-error'].data.of, 5);
  assert.ok(byId.guessing, 'the 3 s wrong answer is flagged');
  assert.match(byId['skip-policy'].text, /too late/);
  assert.ok(byId.pace);
  assert.ok(res.habits.length >= 1 && res.habits.length <= 3);
  assert.equal(res.perPuzzle.length, 10);
});

test('run coaching on an empty run', () => {
  const res = coachRun({ puzzles: [], score: 0 }, [], {});
  assert.equal(res.lines[0].id, 'empty');
});

test('rowResult reads compact run rows', () => {
  assert.equal(rowResult({ outcome: 'solved' }), 'correct');
  assert.equal(rowResult({ outcome: 'skipped', grossMoves: 1 }), 'wrong');
  assert.equal(rowResult({ outcome: 'skipped', grossMoves: 0 }), 'skipped');
  assert.equal(rowResult({ outcome: 'timeout' }), 'timeout');
  assert.deepEqual(topHabits([]), []);
});

// ---------------------------------------------------------------- recorder integration

test('attempts and runs survive the core recorder (sanitize, save, reload)', () => {
  const rec = createRecorder(memoryStorage());
  const { attempt } = play(P3, [3, 0], { gapMs: 5000 });
  assert.equal(attempt.metrics.efficiency, 0.5, 'practice efficiency = 1 / answers');
  assert.equal(attempt.metrics.grossMoves, 2);
  assert.equal(attempt.metrics.wastedMoves, 1, 'a wrong answer counts as a wasted step in analytics');
  assert.equal(attempt.metrics.firstMoveMs, 5000, 'first-move latency is the time to the first answer');
  assert.ok(rec.saveAttempt(attempt));
  const back = rec.attempts({ game: 'operatorswitch' })[0];
  assert.deepEqual(back.events, attempt.events);
  assert.deepEqual(sanitizeAttempt(attempt).metrics, attempt.metrics);
  const wrong = play(P3, [2], { mode: 'exam' }).attempt;
  const run = summarizeRun({ id: 'r2', game: 'operatorswitch', set: 3, seed: 9, startedAt: 0, endedAt: 1000, budgetMs: 360000, attempts: [attempt, wrong] });
  run.score = Math.max(0, 1 - 1 / 3);
  assert.ok(rec.saveRun(run));
  assert.equal(rec.runs({ game: 'operatorswitch' })[0].score, run.score, 'the penalised run score is kept');
});

// ---------------------------------------------------------------- content rules for this game's files

function files(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

const OWN = [
  ...files(join(root, 'js/games/operatorswitch')),
  ...files(join(root, 'data/sets/operatorswitch')),
  join(root, 'css/operatorswitch.css'),
  join(root, 'tools/operatorswitch-gen.mjs'),
  join(root, 'tools/operatorswitch-verify.mjs'),
  join(root, 'docs/operatorswitch.md'),
  ...files(join(root, 'test')).filter((f) => /operatorswitch-/.test(f)),
];

test('this game\'s files exist and contain no Unicode dashes or vendor game names', () => {
  const dashes = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d]);
  const vendor = /\b(Motion|Switch|Digit|Grid|Deductive|Inductive)[ -]Challenge\b|smartPredict/i;
  const offenders = [];
  for (const f of OWN) {
    assert.ok(existsSync(f), `missing ${relative(root, f)}`);
    const text = readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      if ([...line].some((ch) => dashes.has(ch.codePointAt(0)))) offenders.push(`${relative(root, f)}:${i + 1}`);
    });
    // Same scope as test/content.test.mjs (plus the docs page); test files hold the pattern itself.
    if (/\.(js|html|css|json|md)$/.test(f) && vendor.test(text)) offenders.push(`${relative(root, f)}: vendor name`);
  }
  assert.deepEqual(offenders, []);
});

test('play module imports in node and exports the async mount function', async () => {
  const mod = await import('../js/games/operatorswitch/play.js');
  assert.equal(typeof mod.mountOperatorSwitch, 'function');
  assert.equal(mod.mountOperatorSwitch.constructor.name, 'AsyncFunction');
});
