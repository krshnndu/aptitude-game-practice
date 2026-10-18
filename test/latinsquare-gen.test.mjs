// Latin Square generator: valid random squares, determinism, config ladder, and the verifier
// rejecting broken puzzles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRng } from '../js/core/rng.js';
import { isLatinSquare } from '../js/games/latinsquare/state.js';
import { SET_CONFIGS, configFor, randomLatinSquare, generateSet, makePuzzle, patternKey, blanksFor } from '../js/games/latinsquare/gen.js';
import { checkPuzzle, checkSet, setPath } from '../tools/latinsquare-verify.mjs';

test('randomLatinSquare gives valid squares of every size, and differs between seeds', () => {
  for (let n = 2; n <= 6; n++) {
    const a = randomLatinSquare(createRng(n), n);
    assert.ok(isLatinSquare(n, a), `n ${n}`);
  }
  const keys = new Set();
  for (let s = 0; s < 20; s++) keys.add(randomLatinSquare(createRng(s), 6).join(''));
  assert.ok(keys.size > 15);
});

test('every set regenerates byte for byte from its seed', () => {
  for (const cfg of SET_CONFIGS) {
    const fresh = JSON.stringify(generateSet(cfg), null, 1) + '\n';
    assert.equal(fresh, readFileSync(setPath(cfg.set), 'utf8'), `set ${cfg.set}`);
  }
});

test('config ladder: size, depth and blanks never fall from one set to the next', () => {
  for (let i = 1; i < SET_CONFIGS.length; i++) {
    const a = SET_CONFIGS[i - 1];
    const b = SET_CONFIGS[i];
    assert.ok(b.n >= a.n && b.depth >= a.depth && b.blanks[0] >= a.blanks[0]);
    assert.ok(b.n > a.n || b.depth > a.depth || b.blanks[0] > a.blanks[0], `set ${b.set} is harder than set ${a.set}`);
  }
  assert.deepEqual(SET_CONFIGS.map((c) => [c.n, c.depth]), [[4, 1], [5, 1], [5, 2], [6, 2], [6, 3]]);
});

test('blanksFor spreads the band from low to high', () => {
  const cfg = configFor(5);
  assert.equal(blanksFor(cfg, 0, 10), cfg.blanks[0]);
  assert.equal(blanksFor(cfg, 9, 10), cfg.blanks[1]);
});

test('generated puzzles pass the independent verifier for every set config', () => {
  for (const cfg of SET_CONFIGS) {
    const rng = createRng(cfg.seed + 7);
    let made = 0;
    for (let i = 0; i < 3000 && made < 5; i++) {
      const p = makePuzzle(rng, cfg, rng.int(cfg.blanks[0], cfg.blanks[1]), rng.int(cfg.targets[0], cfg.targets[1]));
      if (!p) continue;
      assert.doesNotThrow(() => checkPuzzle(p, cfg), `set ${cfg.set}`);
      made++;
    }
    assert.equal(made, 5, `set ${cfg.set} makes puzzles`);
  }
});

test('patternKey ignores symbol names', () => {
  const a = { n: 2, rows: ['C.', '.C'], targets: [[0, 1]] };
  const b = { n: 2, rows: ['S.', '.S'], targets: [[0, 1]] };
  assert.equal(patternKey(a), patternKey(b));
});

// Broken copies of a shipped puzzle must be rejected.
function shipped(setNo, k = 0) {
  return structuredClone(JSON.parse(readFileSync(setPath(setNo), 'utf8')).puzzles[k]);
}

test('verifier: wrong stored answer is caught', () => {
  const p = shipped(1);
  const other = p.symbols.map((id) => ({ circle: 'C', square: 'S', triangle: 'T', diamond: 'D', plus: 'P', heart: 'H' })[id]).find((l) => l !== p.answers[0]);
  p.answers = [other];
  assert.throws(() => checkPuzzle(p, configFor(1)), /must be/);
});

test('verifier: a target that is no longer unique is caught', () => {
  const p = shipped(1);
  // Keep only the first row: the target (not in it) is then wide open.
  p.rows = p.rows.map((row, r) => (r === 0 ? row : '.'.repeat(p.n)));
  p.targets = [[p.n - 1, 0]];
  p.blanks = p.rows.join('').split('').filter((ch) => ch === '.').length;
  assert.throws(() => checkPuzzle(p, { ...configFor(1), blanks: [0, 16] }), /possible symbols/);
});

test('verifier: wrong stored depth, clashing givens and set-level duplicates are caught', () => {
  const p = shipped(3);
  p.targetDepths = [1];
  p.depth = 1;
  assert.throws(() => checkPuzzle(p, configFor(3)), /depth/);

  const q = shipped(1);
  const r0 = [...q.rows[0]];
  const filled = r0.findIndex((ch) => ch !== '.');
  const at = r0.findIndex((ch, i) => ch === '.' && i !== filled && !(q.targets[0][0] === 0 && q.targets[0][1] === i));
  if (filled >= 0 && at >= 0) {
    r0[at] = r0[filled];
    q.rows[0] = r0.join('');
    q.blanks -= 1;
    assert.throws(() => checkPuzzle(q, { ...configFor(1), blanks: [0, 16] }), /repeats/);
  }

  const data = JSON.parse(readFileSync(setPath(2), 'utf8'));
  data.puzzles[1] = { ...data.puzzles[0], id: data.puzzles[1].id };
  assert.ok(checkSet(data, configFor(2)).some((m) => /duplicate layout/.test(m)));
});
