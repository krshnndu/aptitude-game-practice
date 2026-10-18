// Explanations: path in words, chunks, divergence, side question reasons and tips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  landmark, stepText, pathChunks, describePath, divergenceText, sideReason, explainTrial, resultSummary, questionText,
} from '../js/games/gridmemory/explain.js';
import { analyzeRecall, mirrorMismatches } from '../js/games/gridmemory/state.js';
import { SET_CONFIGS } from '../js/games/gridmemory/gen.js';
import { loadSet } from '../tools/gridmemory-verify.mjs';
import { HAND, ASYM1, playTrial } from './gridmemory-helpers.mjs';

test('landmarks and steps', () => {
  assert.equal(landmark(3, 0), 'top-left corner');
  assert.equal(landmark(3, 4), 'centre');
  assert.equal(landmark(4, 5), 'inner cell');
  assert.equal(landmark(4, 4), 'left edge');
  assert.equal(landmark(5, 24), 'bottom-right corner');
  assert.equal(stepText(3, 0, 2), '2 right');
  assert.equal(stepText(3, 2, 8), '2 down');
  assert.equal(stepText(3, 8, 4), '1 diagonally up-left');
  assert.equal(stepText(4, 0, 6), '1 down and 2 right');
});

test('chunks: straight runs with equal steps become one line', () => {
  // 4x4: (1,1) (1,2) (1,3) then down to (3,3).
  const chunks = pathChunks(4, [0, 1, 2, 10]);
  assert.deepEqual(chunks, [{ from: 0, to: 2, kind: 'line' }, { from: 2, to: 3, kind: 'jump' }]);
  const d = describePath(4, [0, 1, 2, 10]);
  assert.match(d.summary.join(' '), /cells 1 to 3 form one straight line \(1 right each step\)/);
  assert.equal(d.steps[0].text, 'Start: top-left corner (1,1).');
  assert.equal(d.steps[3].text, '2 down to the inner cell (3,3).');
  assert.match(describePath(3, [0, 2, 8, 6]).summary.join(' '), /4 of the 4 cells are corners/);
});

test('divergence names the first error and its kind', () => {
  const seq = HAND.sequence;
  assert.equal(divergenceText(3, analyzeRecall(seq, seq)), 'You recalled every position in order.');
  assert.match(divergenceText(3, analyzeRecall(seq, [0, 8, 2, 4])), /position 2: you chose \(3,3\), which is cell 3 of the sequence.*Positions 2 and 3 were swapped/);
  assert.match(divergenceText(3, analyzeRecall(seq, [0, 2, 1, 4])), /position 3: you chose \(1,2\), which was never lit; the cell was \(3,3\)/);
  assert.match(divergenceText(3, analyzeRecall(seq, [0])), /stopped after 1 of 4/);
});

test('side reasons point at a real mirror difference and the right parity', () => {
  assert.match(sideReason(HAND.distractors[0]), /^Symmetric: each of the 5 rows/);
  const r = sideReason({ kind: 'sym', rows: ASYM1, answer: 'no' });
  assert.match(r, /^Not symmetric: in row 3 the first cell from the left is filled but its mirror cell on the right is empty \(the only difference\)/);
  assert.match(sideReason(HAND.distractors[1]), /7 \+ 8 = 15, which is odd\. Shortcut: odd plus even is odd/);
  assert.match(sideReason(HAND.distractors[3]), /= 18, which is even\. Shortcut: a product is even when either number is even/);
  assert.match(sideReason({ kind: 'parity', a: 9, op: '-', b: 3 }), /= 6, which is even.*odd minus odd is even/);
  assert.equal(questionText(HAND.distractors[0]), 'Is this shape symmetric left to right?');
});

test('every shipped side question gets a reason that matches its answer', () => {
  for (const cfg of SET_CONFIGS) {
    for (const p of loadSet(cfg.set).puzzles) {
      for (const d of p.distractors) {
        const r = sideReason(d);
        if (d.kind === 'sym') {
          assert.ok(r.startsWith(d.answer === 'yes' ? 'Symmetric' : 'Not symmetric'), `${p.id}: ${r}`);
          if (d.answer === 'no') {
            const row = Number(/row (\d+)/.exec(r)[1]) - 1;
            assert.ok(mirrorMismatches([d.rows[row]]) > 0, 'named row really differs');
          }
        } else assert.match(r, new RegExp(`which is ${d.answer}`));
      }
    }
  }
});

test('explainTrial bundles path, positions, side rows, tips and summary', () => {
  const t = playTrial(HAND, { side: ['yes', 'even', 'no', 'miss'], recall: [0, 8, 2, 4] });
  const ex = explainTrial(HAND, t.result(), t.answers);
  assert.equal(ex.positions.length, 4);
  assert.equal(ex.positions[1].text, 'right cell, wrong position');
  assert.equal(ex.side[1].ok, false);
  assert.equal(ex.side[3].given, 'miss');
  assert.ok(ex.tips.some((x) => /lost their order/.test(x)));
  assert.ok(ex.tips.some((x) => /timed out/.test(x)));
  assert.match(ex.summary, /Recall 2 of 4 positions \(50%\), side questions 2 of 4 \(50%\)/);
  assert.match(resultSummary(playTrial(HAND, { skipAt: { phase: 'show', step: 1 } }).result()), /^Skipped/);
});
