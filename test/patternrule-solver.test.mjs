// Pattern Rule solver: version space over the whole catalogue, ambiguity detection, structural checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel as P, ruleText, failingAtoms, ATOMS } from '../js/games/patternrule/rules.js';
import { solvePuzzle, versionSpace, checkPuzzle, rivalRule, MAX_RULE_ATOMS } from '../js/games/patternrule/solver.js';
import { SET_CONFIGS } from '../js/games/patternrule/gen.js';
import { loadSet } from '../tools/patternrule-verify.mjs';

// Rule: every shape is striped. Candidate A has a striped shape but not only striped ones, so
// "at least one shape is striped" (a simpler reading) picks it too, unless a does-not-fit panel
// shows a striped shape next to a solid one.
function handPuzzle({ withCounter = true } = {}) {
  const rule = ['fill-all:striped'];
  const candidates = [
    P('tri.striped.L.U@11', 'drop.solid.S.D@00'),
    P('arrow.striped.S.L@01', 'dome.striped.L.U@21'),
    P('drop.solid.L.R@12'),
  ];
  return {
    id: 'hand',
    rule,
    ruleText: ruleText(rule),
    fits: [
      P('tri.striped.L.U@00'),
      P('drop.striped.S.R@11', 'arrow.striped.L.D@22'),
      P('dome.striped.S.L@02', 'tri.striped.L.R@20', 'arrow.striped.S.U@10'),
    ],
    counters: withCounter ? [P('tri.striped.L.L@00', 'arrow.solid.S.U@22')] : [],
    candidates,
    answer: [1],
    violates: candidates.map((p) => failingAtoms(rule, p)),
  };
}

test('hand-built puzzle: unique once the does-not-fit panel rules out the simpler reading', () => {
  const res = solvePuzzle(handPuzzle(), { full: true });
  assert.equal(res.unique, true);
  assert.deepEqual(res.answer, [1]);
  assert.ok(res.hypotheses.some((h) => h.atoms.length === 1 && h.atoms[0] === 'fill-all:striped'));
  assert.ok(!res.hypotheses.some((h) => h.atoms.includes('fill-any:striped') && h.atoms.length === 1), 'the counter panel kills "has a striped shape"');
  assert.deepEqual(checkPuzzle(handPuzzle()), []);
});

test('hand-built puzzle without the does-not-fit panel is ambiguous, and the rival is the simpler rule', () => {
  const p = handPuzzle({ withCounter: false });
  const res = solvePuzzle(p, { full: true });
  assert.equal(res.unique, false);
  const rival = rivalRule(p);
  assert.ok(rival, 'a rival rule exists');
  assert.equal(rival.atoms.length, 1);
  const problems = checkPuzzle(p);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ambiguous/);
});

test('structural checks catch a wrong key, wrong violated parts, broken drawing data and duplicates', () => {
  const p = handPuzzle();
  assert.match(checkPuzzle({ ...p, answer: [0, 1] }).join('\n'), /answer key disagrees/);
  assert.match(checkPuzzle({ ...p, violates: [[], [], []] }).join('\n'), /violated parts differ/);
  const moved = structuredClone(p);
  moved.candidates[2].shapes[0].x = 10;
  assert.match(checkPuzzle(moved).join('\n'), /drawing data/);
  const dup = structuredClone(p);
  dup.candidates[2] = structuredClone(dup.fits[0]);
  dup.violates[2] = [];
  assert.match(checkPuzzle(dup).join('\n'), /identical/);
  assert.match(checkPuzzle({ ...p, ruleText: 'Something else.' }).join('\n'), /rule text/);
  const twoInOneCell = structuredClone(p);
  twoInOneCell.fits[1].shapes[1] = { ...twoInOneCell.fits[1].shapes[0] };
  assert.match(checkPuzzle(twoInOneCell).join('\n'), /two shapes in one cell/);
});

test('pruned version space equals the full catalogue enumeration on every shipped puzzle', () => {
  for (const cfg of SET_CONFIGS) {
    for (const p of loadSet(cfg.set).puzzles) {
      const full = versionSpace(p, { full: true });
      const pruned = versionSpace(p);
      const norm = (vs) => vs.hypotheses.map((h) => `${[...h.atoms].sort().join('+')}=${h.selection}`).sort();
      assert.deepEqual(norm(pruned), norm(full), p.id);
      const n = ATOMS.length;
      assert.equal(full.checked, n + (n * (n - 1)) / 2 + (n * (n - 1) * (n - 2)) / 6, 'every conjunction of up to 3 atoms is visited');
    }
  }
  assert.equal(MAX_RULE_ATOMS, 3);
});

test('two-feature puzzles need their does-not-fit panels: without them every one is ambiguous', () => {
  for (const setNo of [3, 5]) {
    for (const p of loadSet(setNo).puzzles) {
      const bare = { ...p, counters: [] };
      assert.equal(solvePuzzle(bare).unique, false, `${p.id} without counters`);
      assert.equal(solvePuzzle(p).unique, true, p.id);
    }
  }
});
