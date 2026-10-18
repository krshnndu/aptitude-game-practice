// Pattern Rule explanations: computed rule names, dimension scan, per-candidate reasons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainPuzzle, dimensionScan, candidateVerdicts, pickMarks, resultSummary, STRATEGY } from '../js/games/patternrule/explain.js';
import { atom, atomDimLabel, DIM_NAMES } from '../js/games/patternrule/rules.js';
import { gradeSelection } from '../js/games/patternrule/state.js';
import { SET_CONFIGS } from '../js/games/patternrule/gen.js';
import { loadSet } from '../tools/patternrule-verify.mjs';

const ALL = SET_CONFIGS.flatMap((c) => loadSet(c.set).puzzles);
const DASHES = new RegExp(`[${[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d].map((c) => String.fromCharCode(c)).join('')}]`);

test('every shipped puzzle: the scan marks exactly the rule dimensions as part of the rule', () => {
  for (const p of ALL) {
    const scan = dimensionScan(p);
    const ruleDims = new Set(p.rule.map((id) => atom(id).dim));
    for (const row of scan) {
      assert.equal(row.verdict === 'rule', ruleDims.has(row.dim), `${p.id} ${row.dim}: ${row.text}`);
      assert.ok(row.text.length > 20);
    }
  }
});

test('every shipped puzzle: candidate verdicts match the key and name the broken dimension', () => {
  for (const p of ALL) {
    const vs = candidateVerdicts(p);
    vs.forEach((v, i) => {
      assert.equal(v.fits, p.answer.includes(i), `${p.id} ${v.letter}`);
      if (v.fits) {
        assert.ok(v.parts.every((x) => x.holds));
        assert.match(v.summary, new RegExp(`^${v.letter} fits: `));
      } else {
        assert.deepEqual(v.broken, p.violates[i].map(atomDimLabel), `${p.id} ${v.letter}`);
        assert.match(v.summary, /does not fit: .+\. Breaks: .+\.$/);
      }
    });
  }
});

test('explanation text is plain English with no dashes, placeholders or raw ids', () => {
  for (const p of ALL) {
    const ex = explainPuzzle(p);
    const texts = [ex.rule, ...ex.steps, ...ex.scan.map((r) => r.text), ...ex.verdicts.map((v) => v.summary)];
    for (const t of texts) {
      assert.doesNotMatch(t, DASHES, `${p.id}: ${t}`);
      assert.doesNotMatch(t, /undefined|NaN|null|\[object|-all:|-any:|-none:|count-eq/, `${p.id}: ${t}`);
      assert.doesNotMatch(t, / a arrow/, `${p.id}: article in ${t}`);
    }
    assert.equal(ex.steps.length, 3);
    assert.match(ex.steps[1], new RegExp(ex.rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const s of STRATEGY) assert.doesNotMatch(s, DASHES);
});

test('worked example: a two-feature puzzle explains both parts and uses the does-not-fit panels', () => {
  const p = loadSet(3).puzzles.find((q) => q.rule.length === 2);
  const scan = dimensionScan(p);
  const ruleRows = scan.filter((r) => r.verdict === 'rule');
  assert.equal(ruleRows.length, 2);
  for (const r of ruleRows) assert.match(r.text, /does-not-fit panel \d breaks only this part/i);
  const varies = scan.filter((r) => r.verdict === 'varies');
  assert.ok(varies.length >= 1);
  assert.match(explainPuzzle(p).steps[0], new RegExp(DIM_NAMES[varies[0].dim]));
});

test('pick marks and result summaries', () => {
  const p = loadSet(5).puzzles[0];
  const neg = p.candidates.map((_, i) => i).find((i) => !p.answer.includes(i));
  const marks = pickMarks(p, [p.answer[0], neg]);
  assert.equal(marks[p.answer[0]], 'hit');
  assert.equal(marks[neg], 'false');
  assert.equal(marks.filter((m) => m === 'miss').length, p.answer.length - 1);
  const g = gradeSelection(p, [p.answer[0], neg]);
  assert.match(resultSummary({ status: 'answered', ...g }, p), /^Not quite: [A-F] does not fit, and you missed .+\. Scores 0\./);
  assert.match(resultSummary({ status: 'answered', ...gradeSelection(p, p.answer) }, p), /^Correct: .+ are exactly the candidates that fit\. Scores 1\.$/);
  assert.match(resultSummary({ status: 'skipped' }, p), /^Skipped: scores 0\./);
});
