// Block Slide strategy cheat sheet: static, hand-written. Traps carry the coach tag they map to.
// The worked example's steps are checked against explain.js by the tests, so they stay correct.

export const STRATEGY_SHEET = {
  game: 'blockslide',
  title: 'Block Slide strategy',
  heuristics: [
    'Read the exit lane first: list every cell between the ball and the exit and which piece sits in each.',
    'Plan backwards from the exit: the last ball moves need a clear lane, so ask what must move out of it, and what must move before that.',
    'Count the whole plan before the first move and compare it with the fewest-moves target shown on the board.',
    'Move a blocker out of the lane in one step rather than routing the ball around it, unless the detour is shorter.',
    'Never move the ball into a dead end: a ball move that does not shorten an open route is usually wasted.',
  ],
  traps: [
    { tag: 'premature-ball', text: 'Moving the ball before its route is open. It often has to come back.' },
    { tag: 'oscillation', text: 'Sliding a piece and straight back. Decide where each piece must end up before touching it.' },
    { tag: 'off-line-pieces', text: 'Shuffling blocks the solution never needs. Only pieces in or next to the lane matter.' },
    { tag: 'wasted', text: 'Playing by trial and error. Each extra move costs efficiency even when you finish.' },
    { tag: 'skip-late', text: 'Holding on past twice the pace guide in a timed test. Skip and bank time instead.' },
  ],
  example: {
    puzzleId: 'bs1-01',
    set: 1,
    title: 'Set 1, puzzle 1 (3 moves)',
    setup: 'A 4x4 board with 3 blocks. The exit is on the top edge at (1,4); block B sits on the exit cell.',
    steps: [
      'Move ball 1 up: heads toward the exit, now 1 cell away.',
      'Move block B (orange) 1 left: clears the exit cell (1,4). The ball now has an open route of 1 move.',
      'Move ball 1 up: the ball reaches the exit cell (1,4). Solved.',
    ],
    lesson: 'Only one block is in the way, so the plan is 2 ball moves plus 1 block move: 3 in total, which matches the target.',
  },
};
