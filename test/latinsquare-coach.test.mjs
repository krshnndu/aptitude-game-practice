// Latin Square coach: findings from synthetic attempt logs recorded through the core recorder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttemptLog, summarizeRun, sanitizeAttempt } from '../js/core/recorder.js';
import { coachPuzzle, coachRun, effectiveOutcome, guessFloorMs, topHabits } from '../js/games/latinsquare/coach.js';
import { analyse, explainPuzzle } from '../js/games/latinsquare/explain.js';
import { TUTORIAL_PUZZLE } from '../js/games/latinsquare/stream.js';
import { loadSet } from '../tools/latinsquare-verify.mjs';

const CHAIN = { id: 'chain', n: 4, symbols: ['circle', 'square', 'triangle', 'diamond'], rows: ['S.D.', '...S', 'CS..', 'DT..'], targets: [[1, 2]], answers: ['C'], depth: 2 };
const TUT = { ...TUTORIAL_PUZZLE };
const ANS = analyse(TUT).P.answers[0];

// actions: [ms to wait, 'pick', sym, target] | [ms, 'select', cell] | [ms, 'hint']; end: [ms, outcome]
function record(puzzle, { mode = 'practice', set = 1, actions = [], end = [0, 'solved'], id } = {}) {
  let now = 10_000;
  const log = createAttemptLog({ game: 'latinsquare', set, puzzleId: id ?? puzzle.id, mode, optimal: puzzle.targets.length, now: () => now });
  let picks = 0;
  for (const [wait, type, a, b] of actions) {
    now += wait;
    if (type === 'pick') {
      log.move(a, b ?? 0);
      picks++;
    } else if (type === 'select') log.select(a);
    else if (type === 'hint') log.hint();
  }
  now += end[0];
  return sanitizeAttempt(log.end(end[1], { moves: picks }));
}

const ids = (res) => res.findings.map((f) => f.id);
const fixes = (res) => res.findings.filter((f) => f.kind === 'fix').map((f) => f.id);

test('clean solve: no fix items, row and column check confirmed, good pace', () => {
  const a = record(TUT, { actions: [[5000, 'pick', ANS]] });
  const res = coachPuzzle(a, TUT, { paceSec: 15 });
  assert.deepEqual(fixes(res), []);
  assert.ok(ids(res).includes('row-col-check'));
  assert.ok(ids(res).includes('pace-ok'));
  assert.equal(res.facts.outcome, 'solved');
});

test('wrong picks are classified by what was missed: row, column, chain', () => {
  // square sits in row 2, diamond in column 3; triangle is only ruled out by the helper cell.
  const a = record(CHAIN, { actions: [[6000, 'pick', 1], [6000, 'pick', 3], [6000, 'pick', 2], [6000, 'pick', 0]] });
  const res = coachPuzzle(a, CHAIN, { paceSec: 30 });
  assert.deepEqual(fixes(res).sort(), ['missed-chain', 'missed-col', 'missed-row']);
  const row = res.findings.find((f) => f.id === 'missed-row');
  assert.match(row.detail, /Square is already in row 2, at \(2,4\)\./);
  assert.ok(!ids(res).includes('row-col-check'));
  assert.ok(!ids(res).includes('guess'), 'slow wrong picks are not guesses');
});

test('guessing: a wrong pick faster than a row and column check', () => {
  const floor = guessFloorMs(4, 1);
  const a = record(TUT, { actions: [[400, 'pick', (ANS + 1) % 4], [floor + 500, 'pick', ANS]] });
  const res = coachPuzzle(a, TUT, { paceSec: 15 });
  const g = res.findings.find((f) => f.id === 'guess');
  assert.ok(g);
  assert.match(g.detail, /0\.4 s/);
  assert.equal(res.facts.fast, 1);
});

test('exam: all targets answered with one wrong reads back as wrong, not as a skip', () => {
  const a = record(TUT, { mode: 'exam', actions: [[5000, 'pick', (ANS + 1) % 4]], end: [0, 'skipped'] });
  assert.equal(a.outcome, 'skipped');
  assert.equal(effectiveOutcome(a, analyse(TUT).P), 'wrong');
  const res = coachPuzzle(a, TUT, { paceSec: 15 });
  assert.equal(res.facts.outcome, 'wrong');
  assert.ok(!ids(res).some((x) => x.startsWith('skip')));
  assert.ok(res.facts.points < 0);
});

test('exam: a real skip, early and late', () => {
  const early = record(TUT, { mode: 'exam', end: [1000, 'skipped'] });
  assert.equal(effectiveOutcome(early, analyse(TUT).P), 'skipped');
  assert.ok(fixes(coachPuzzle(early, TUT, { paceSec: 15 })).includes('skip-early'));
  const late = record(TUT, { mode: 'exam', end: [40_000, 'skipped'] });
  assert.ok(fixes(coachPuzzle(late, TUT, { paceSec: 15 })).includes('skip-late'));
  const fine = record(TUT, { mode: 'exam', end: [12_000, 'skipped'] });
  assert.ok(ids(coachPuzzle(fine, TUT, { paceSec: 15 })).includes('skip-ok'));
});

test('helper cells: looking at the chain before answering is noticed', () => {
  const helper = explainPuzzle(CHAIN).steps[0].cell;
  const a = record(CHAIN, { actions: [[3000, 'select', helper], [5000, 'pick', 0]] });
  assert.ok(ids(coachPuzzle(a, CHAIN, { paceSec: 30 })).includes('helper-look'));
  const b = record(CHAIN, { actions: [[3000, 'pick', 2], [5000, 'pick', 0]] });
  const res = coachPuzzle(b, CHAIN, { paceSec: 30 });
  const miss = res.findings.find((f) => f.id === 'helper-miss');
  assert.ok(miss);
  assert.match(miss.detail, /1 helper cell filled first/);
});

test('slow first answer against your own median for the set', () => {
  const history = [3000, 3200, 2800].map((ms, i) => record(TUT, { id: `h${i}`, actions: [[ms, 'pick', ANS]] }));
  const a = record(TUT, { actions: [[20_000, 'pick', ANS]] });
  const res = coachPuzzle(a, TUT, { paceSec: 15, history });
  const slow = res.findings.find((f) => f.id === 'slow-start');
  assert.ok(slow);
  assert.match(slow.detail, /your median of 3\.0 s/);
});

test('hints and time-outs are reported', () => {
  const a = record(TUT, { actions: [[2000, 'hint'], [3000, 'pick', ANS]] });
  const h = coachPuzzle(a, TUT, { paceSec: 15 }).findings.find((f) => f.id === 'hints');
  assert.equal(h.kind, 'info');
  const t = record(TUT, { mode: 'exam', end: [4000, 'timeout'] });
  assert.ok(ids(coachPuzzle(t, TUT, { paceSec: 15 })).includes('timeout'));
});

test('run coaching: accuracy, guessing, skip policy, pace and top habits', () => {
  const puzzles = loadSet(1).puzzles.slice(0, 5);
  const P = puzzles.map((p) => analyse(p).P);
  const attempts = [
    record(puzzles[0], { mode: 'exam', id: puzzles[0].id, actions: [[6000, 'pick', P[0].answers[0]]] }),
    record(puzzles[1], { mode: 'exam', id: puzzles[1].id, actions: [[7000, 'pick', P[1].answers[0]]] }),
    record(puzzles[2], { mode: 'exam', id: puzzles[2].id, actions: [[500, 'pick', (P[2].answers[0] + 1) % 4]], end: [0, 'skipped'] }),
    record(puzzles[3], { mode: 'exam', id: puzzles[3].id, actions: [[600, 'pick', (P[3].answers[0] + 2) % 4]], end: [0, 'skipped'] }),
    record(puzzles[4], { mode: 'exam', id: puzzles[4].id, end: [45_000, 'skipped'] }),
  ];
  const run = summarizeRun({ game: 'latinsquare', set: 1, seed: 1, startedAt: 0, endedAt: 360_000, budgetMs: 360_000, attempts });
  const res = coachRun(run, attempts, new Map(puzzles.map((p) => [p.id, p])), { paceSec: 15 });
  assert.deepEqual(res.totals, { reached: 5, solved: 2, wrong: 2, skipped: 1, timedOut: 0, answered: 4, points: 2 - 2 / 3 });
  const line = (id) => res.lines.find((l) => l.id === id);
  assert.match(line('accuracy').text, /^2 of 4 answered puzzles right \(50%\)/);
  assert.equal(line('guess').kind, 'fix');
  assert.equal(line('skip-policy').kind, 'fix');
  assert.equal(line('pace').kind, 'fix', '5 puzzles is far below the 24 a 15 s pace allows');
  assert.equal(res.habits[0].id, 'guess');
  assert.ok(res.habits.length <= 3);
});

test('run coaching with nothing finished, and habit ranking ties', () => {
  const res = coachRun({ puzzles: [] }, [], {});
  assert.equal(res.lines[0].id, 'empty');
  const h = topHabits([[{ id: 'missed-row', kind: 'fix', severity: 1 }], [{ id: 'missed-col', kind: 'fix', severity: 1 }, { id: 'missed-row', kind: 'fix', severity: 1 }]]);
  assert.deepEqual(h.map((x) => [x.id, x.count]), [['missed-row', 2], ['missed-col', 1]]);
});
