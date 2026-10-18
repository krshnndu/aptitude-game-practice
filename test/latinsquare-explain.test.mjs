// Latin Square explanations: step order and wording, wrong-pick reasons, result lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, explainPuzzle, wrongPickReason, resultSummary, STRATEGY } from '../js/games/latinsquare/explain.js';
import { TUTORIAL_PUZZLE } from '../js/games/latinsquare/stream.js';
import { SET_CONFIGS } from '../js/games/latinsquare/gen.js';
import { loadSet } from '../tools/latinsquare-verify.mjs';

const CHAIN = { id: 'chain', n: 4, symbols: ['circle', 'square', 'triangle', 'diamond'], rows: ['S.D.', '...S', 'CS..', 'DT..'], targets: [[1, 2]], answers: ['C'] };

test('tutorial: one step that lists row, column and the one symbol left', () => {
  const ex = explainPuzzle(TUTORIAL_PUZZLE);
  assert.equal(ex.steps.length, 1);
  const s = ex.steps[0];
  assert.ok(s.isTarget);
  assert.equal(s.text, 'Row 3 already has triangle, circle; column 2 has square; only diamond remains, so (3,2) is diamond.');
  assert.equal(ex.summary, 'Answer: (3,2) is diamond. Each answer can be read straight from its row and column.');
});

test('chain: the helper step comes first and the target step cites it', () => {
  const ex = explainPuzzle(CHAIN);
  assert.equal(ex.steps.length, 2);
  assert.equal(ex.steps[0].isTarget, false);
  assert.equal(ex.steps[1].isTarget, true);
  assert.match(ex.steps[1].text, /\(step 1\)/);
  assert.match(ex.summary, /1 helper cell has to be filled first/);
  assert.match(ex.steps[1].text, /\(2,3\) is circle\.$/);
});

test('every shipped puzzle: steps end on the targets with the stored answers, step count >= depth', () => {
  for (const cfg of SET_CONFIGS) {
    for (const p of loadSet(cfg.set).puzzles) {
      const ex = explainPuzzle(p);
      assert.equal(ex.steps.length, p.steps, p.id);
      assert.ok(ex.steps.length >= p.depth, p.id);
      const byCell = new Map(ex.steps.map((s) => [s.cell, s]));
      ex.analysis.P.targets.forEach((t, k) => {
        assert.ok(byCell.has(t), `${p.id} target ${k} explained`);
        assert.equal(byCell.get(t).symbol.letter, p.answers[k]);
      });
      for (const s of ex.steps) {
        assert.match(s.text, /^[A-Z].*\.$/, `${p.id}: sentence`);
        assert.ok(!/undefined|NaN|null/.test(s.text), `${p.id}: ${s.text}`);
      }
    }
  }
});

test('wrong pick reasons: row, column, and chain', () => {
  const A = analyse(CHAIN);
  const t = A.P.targets[0];
  // square is in row 2, diamond in column 3; triangle only falls to the chain.
  assert.deepEqual(
    [1, 3, 2].map((v) => wrongPickReason(A, t, v).kind),
    ['row', 'col', 'chain'],
  );
  assert.equal(wrongPickReason(A, t, 1).text, 'Square is already in row 2, at (2,4).');
  assert.match(wrongPickReason(A, t, 2).text, /^Triangle is not in row 2 or column 3 yet/);
});

test('result summaries', () => {
  assert.equal(resultSummary({ outcome: 'solved', picks: 1, targets: 1 }), 'Correct first time: efficiency 100%.');
  assert.equal(resultSummary({ outcome: 'solved', picks: 3, targets: 2 }), 'Solved after 1 wrong pick: efficiency 67% (2 needed / 3 made).');
  assert.match(resultSummary({ outcome: 'skipped', picks: 0, targets: 2 }), /answers are/);
  assert.ok(STRATEGY.length >= 4);
});
