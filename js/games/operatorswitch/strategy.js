// Operator Switch strategy cheat sheet: static, hand-written. Traps carry the coach tag they map to.
// The worked example's steps are checked against explain.js by the tests.

export const STRATEGY_SHEET = {
  game: 'operatorswitch',
  title: 'Operator Switch strategy',
  heuristics: [
    'Number the start items 1, 2, 3, 4 once, then work with digits only; turn them back into shapes at the end.',
    'Apply the boxes left to right, each to the row the previous box produced, never to the start row.',
    'A box says which entry of the current row goes into each slot: "3 2 4 1" puts the 3rd entry first.',
    'For a hidden box, compare the row just before the gap with the row just after it; undo later boxes rather than repeating them.',
    'Eliminate by slot: work out slot 1 of the answer, cross off options that disagree, then slot 2 only if needed.',
  ],
  traps: [
    { tag: 'err-original', text: 'Applying every box to the start row instead of to the running result.' },
    { tag: 'err-reversed', text: 'Applying the boxes right to left.' },
    { tag: 'err-inverse', text: 'Reading a box backwards (where each item goes, instead of which entry each slot takes).' },
    { tag: 'err-dropped', text: 'Leaving a box out when there are three or more.' },
    { tag: 'err-hidden-undo-forward', text: 'For a hidden box, applying later boxes again instead of undoing them.' },
    { tag: 'rushed', text: 'Answering before the chain is traced. A wrong exam answer costs points.' },
  ],
  example: {
    puzzleId: 'os2-01',
    set: 2,
    title: 'Set 2, puzzle 1 (two boxes)',
    setup: 'Start row hexagon, triangle, square, diamond. Two boxes, four answer options.',
    steps: [
      'Number the start positions: hexagon H = 1, triangle T = 2, square S = 3, diamond D = 4. Start row: 1 2 3 4.',
      'Box 1 (2 1 4 3) on the numbered start 1 2 3 4: the first box just copies its digits. Row now: 2 1 4 3.',
      'Box 2 (3 2 4 1) on 2 1 4 3: slot 1 takes the 3rd entry (4), slot 2 takes the 2nd entry (1), slot 3 takes the 4th entry (3), slot 4 takes the 1st entry (2). Row now: 4 1 3 2.',
      'Turn the numbers back into shapes: 4 is diamond D, 1 is hexagon H, 3 is square S, 2 is triangle T. Result: D H S T.',
    ],
    lesson: 'With digits, box 2 is a simple lookup into the row box 1 produced; shapes only come back at the very end.',
  },
};
