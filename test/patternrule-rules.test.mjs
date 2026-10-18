// Pattern Rule catalogue: every atom family on hand-built panels, mirror symmetry, relations,
// reasons and rule wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATOMS, ATOM_INDEX, holds, ruleText, makePanel, failingAtoms, atom, mirrorShape, panelKey, describePanel, drawData } from '../js/games/patternrule/rules.js';

const P = makePanel;

test('catalogue: unique ids, every atom has a dimension, wording and a working why()', () => {
  assert.equal(ATOM_INDEX.size, ATOMS.length);
  const panels = [P('tri.solid.L.U@00'), P('drop.striped.S.R@11', 'arrow.outline.L.L@12'), P('dome.solid.L.U@00', 'dome.solid.L.U@02', 'tri.outline.S.D@21', 'arrow.striped.S.U@11')];
  for (const a of ATOMS) {
    assert.ok(a.dim && a.clause && typeof a.test === 'function', a.id);
    for (const p of panels) {
      const why = a.why(p);
      assert.equal(typeof why, 'string', a.id);
      assert.ok(why.length > 5, `${a.id}: ${why}`);
      assert.doesNotMatch(why, /undefined|NaN|\[object/, a.id);
    }
  }
});

test('counts, all, any and none atoms', () => {
  const p = P('tri.striped.L.U@00', 'tri.striped.S.R@11', 'drop.solid.L.U@22');
  assert.ok(holds('count-eq:3', p));
  assert.ok(holds('count-odd', p) && !holds('count-even', p));
  assert.ok(holds('count-min:3', p) && !holds('count-max:2', p));
  assert.ok(!holds('type-all:tri', p) && holds('type-any:tri', p) && !holds('type-none:tri', p));
  assert.ok(holds('type-none:arrow', p));
  assert.ok(!holds('fill-all:striped', p) && holds('fill-any:solid', p));
  assert.ok(holds('size-any:S', p) && !holds('size-all:L', p));
  assert.ok(!holds('dir-all:U', p) && holds('dir-any:R', p));
  assert.match(atom('fill-all:striped').why(p), /solid drop \(bottom right\) is not striped/);
  assert.match(atom('count-eq:2').why(p), /3 shapes, not 2/);
});

test('positions: rows, columns, centre', () => {
  const top = P('tri.solid.L.U@00', 'drop.solid.L.U@02');
  assert.ok(holds('row-all:0', top) && !holds('row-all:1', top));
  assert.ok(holds('same-row', top) && !holds('same-col', top) && holds('aligned', top));
  assert.ok(holds('centre-empty', top) && !holds('centre-filled', top));
  const col = P('tri.solid.L.U@01', 'drop.solid.L.U@11');
  assert.ok(holds('col-all:1', col) && holds('centre-filled', col) && holds('same-col', col));
  assert.match(atom('row-all:0').why(col), /centre\) is not in the top row/);
});

test('mirror symmetry includes attributes and mirrored directions', () => {
  const v = P('tri.solid.L.R@00', 'tri.solid.L.L@02', 'arrow.striped.S.U@11');
  assert.ok(holds('sym-v', v), 'R mirrors to L across the middle column, U stays U on the fold');
  assert.ok(!holds('sym-h', v));
  const notV = P('tri.solid.L.R@00', 'tri.solid.L.R@02');
  assert.ok(!holds('sym-v', notV), 'both pointing right is not a mirror image');
  assert.match(atom('sym-v').why(notV), /do not mirror each other/);
  const onLine = P('arrow.solid.L.R@11');
  assert.ok(!holds('sym-v', onLine), 'a shape on the fold pointing sideways does not mirror onto itself');
  assert.match(atom('sym-v').why(onLine), /fold line/);
  const h = P('drop.outline.S.U@00', 'drop.outline.S.D@20');
  assert.ok(holds('sym-h', h) && !holds('sym-v', h));
  const lone = P('dome.solid.L.U@01');
  assert.match(atom('sym-h').why(lone), /no mirror twin: the bottom centre cell is empty/);
  const s = { t: 'tri', f: 'solid', s: 'L', d: 'R', r: 0, c: 0 };
  assert.deepEqual(mirrorShape(mirrorShape(s, 'v'), 'v'), s);
});

test('relations between two shapes', () => {
  const facing = P('tri.solid.L.R@10', 'drop.striped.S.L@12');
  assert.ok(holds('facing', facing) && holds('points-at', facing) && holds('opp-dir', facing) && holds('aligned', facing));
  assert.ok(!holds('touch', facing), 'two cells apart');
  assert.ok(holds('large-left', facing) && !holds('large-above', facing));
  assert.ok(holds('diff-type', facing) && holds('diff-fill', facing) && holds('diff-size', facing));
  const one = P('tri.solid.L.R@10', 'drop.striped.S.U@12');
  assert.ok(holds('points-at', one) && !holds('facing', one));
  assert.match(atom('facing').why(one), /but not back/);
  const touch = P('arrow.outline.L.U@00', 'arrow.outline.L.U@10');
  assert.ok(holds('touch', touch) && holds('same-type', touch) && holds('same-dir', touch) && holds('same-size', touch));
  assert.ok(holds('points-at', P('arrow.outline.L.U@20', 'arrow.outline.L.U@00')), 'a shape points at another further up the column');
  assert.ok(holds('points-at', touch), 'the lower arrow points up at the upper one');
  assert.ok(!holds('points-at', P('arrow.outline.L.D@00', 'arrow.outline.L.L@11')), 'not in one line');
  const diag = P('tri.solid.S.U@00', 'tri.solid.L.U@11');
  assert.ok(!holds('aligned', diag) && !holds('touch', diag));
  assert.match(atom('touch').why(diag), /only touch at a corner/);
  assert.ok(!holds('large-above', diag), 'the large shape is lower');
  const three = P('tri.solid.S.U@00', 'tri.solid.L.U@11', 'tri.solid.L.U@22');
  assert.ok(!holds('opp-dir', three) && !holds('touch', three), 'pair relations need exactly two shapes');
  assert.match(atom('touch').why(three), /about a pair of shapes/);
  assert.ok(holds('same-type', three) && !holds('diff-size', three));
});

test('failingAtoms and rule wording', () => {
  const rule = ['fill-all:striped', 'opp-dir'];
  const p = P('tri.striped.L.R@10', 'drop.solid.S.R@12');
  assert.deepEqual(failingAtoms(rule, p), ['fill-all:striped', 'opp-dir']);
  assert.equal(ruleText(['fill-all:striped']), 'Every shape is striped.');
  assert.equal(ruleText(rule), 'Every shape is striped, and the two shapes point in opposite directions.');
});

test('panel keys, drawing data and descriptions', () => {
  const a = P('tri.solid.L.U@00', 'drop.striped.S.R@11');
  const b = P('drop.striped.S.R@11', 'tri.solid.L.U@00');
  assert.equal(panelKey(a), panelKey(b));
  assert.deepEqual(drawData(a.shapes[1]), { x: 150, y: 150, rot: 90, k: 0.58 });
  assert.equal(describePanel(a), '2 shapes: large solid triangle pointing up (top left); small striped drop pointing right (centre).');
  assert.throws(() => P('hex.solid.L.U@00'), /bad shape key/);
});
