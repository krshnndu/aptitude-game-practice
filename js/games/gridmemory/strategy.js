// Grid Memory strategy cheat sheet: static, hand-written. Traps carry the coach tag they map to.
// The worked example's steps are checked against explain.js by the tests.

export const STRATEGY_SHEET = {
  game: 'gridmemory',
  title: 'Grid Memory strategy',
  heuristics: [
    'Name each cell as it lights ("top edge, then top-right corner") instead of trying to hold a picture.',
    'Chunk straight runs: three cells in a line are one item to remember, not three.',
    'Answer the side question quickly and return to rehearsing the path; the side task is scored too.',
    'Rehearse the whole path once between items, from the start, so early positions do not fade.',
    'On recall, tap in order and do not hesitate on the first cell: the first and last positions are the easiest to keep.',
  ],
  traps: [
    { tag: 'order-errors', text: 'Right cells in the wrong order: rehearse the sequence, not just the set of cells.' },
    { tag: 'location-errors', text: 'Tapping cells that never lit: name positions by landmark so they are anchored.' },
    { tag: 'early-errors', text: 'Losing the first positions while the side questions run: rehearse from the start.' },
    { tag: 'late-errors', text: 'Losing the last positions: give the final item one extra rehearsal before recall.' },
    { tag: 'side-dropped', text: 'Neglecting the side task. Points for side answers count toward efficiency.' },
    { tag: 'side-guess', text: 'Guessing side answers in under a second. Check the mirror or the sum, then answer.' },
  ],
  example: {
    puzzleId: 'gm1-01',
    set: 1,
    title: 'Set 1, trial 1 (span 2)',
    setup: 'A 3x3 grid. Two cells light in turn, with a symmetry question after each.',
    steps: [
      'Start: bottom edge (3,2).',
      '2 up and 1 right to the top-right corner (1,3).',
    ],
    lesson: 'Encode the path as "bottom edge, then top-right corner": two landmarks are easier to hold than two coordinates.',
  },
};
