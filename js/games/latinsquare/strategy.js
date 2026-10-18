// Latin Square strategy cheat sheet: static, hand-written. Traps carry the coach tag they map to.
// The worked example's steps are checked against explain.js by the tests.

export const STRATEGY_SHEET = {
  game: 'latinsquare',
  title: 'Latin Square strategy',
  heuristics: [
    'Start at the ? cell: list the symbols its row holds, then its column. One symbol left means that is the answer.',
    'Two or more left: find a blank in the same row or column you can fill first; its symbol rules one more out.',
    'Ask the reverse question too: where in this row or column can a missing symbol still go? One open cell means it goes there (a hidden single).',
    'Check both lines before every pick. Most wrong answers are a symbol already sitting in the row or the column.',
    'In a timed test a wrong pick costs points and a skip costs nothing: skip a chain you cannot finish in time.',
  ],
  traps: [
    { tag: 'missed-row', text: 'Picking a symbol that is already in the target\'s row.' },
    { tag: 'missed-col', text: 'Picking a symbol that is already in the target\'s column.' },
    { tag: 'missed-chain', text: 'Ignoring the helper cell whose value rules your pick out.' },
    { tag: 'guess', text: 'Answering faster than the scan can be done. A guess is worse than a skip.' },
    { tag: 'helper-miss', text: 'Never looking at helper cells on a puzzle that needs a chain.' },
  ],
  example: {
    puzzleId: 'ls3-01',
    set: 3,
    title: 'Set 3, puzzle 1 (a two-step chain)',
    setup: 'A 5x5 grid with one target at (4,1). Its row and column leave two candidates, so a helper cell has to be filled first.',
    steps: [
      'Diamond is still missing from column 4. Its other open cells cannot take diamond: (3,4) because row 3 has diamond at (3,5); (5,4) because row 5 has diamond at (5,2). The only place left is (4,4), so (4,4) is diamond.',
      'Row 4 already has square, triangle, diamond (step 1), circle; only plus remains, so (4,1) is plus.',
    ],
    lesson: 'When the target has two candidates, fill the helper that shares its row first; the hidden single in column 4 settles it.',
  },
};
