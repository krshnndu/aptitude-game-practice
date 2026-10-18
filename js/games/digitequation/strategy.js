// Digit Equation strategy cheat sheet: static, hand-written. Traps carry the coach tag they map to.
// The worked example's steps are checked against explain.js by the tests.

export const STRATEGY_SHEET = {
  game: 'digitequation',
  title: 'Digit Equation strategy',
  heuristics: [
    'Bracket the multiplications and divisions first: they are worked out before + and -.',
    'Use the last digit: the last digit of a +, - or x result depends only on the last digits involved.',
    'Estimate the size: a two digit by one digit product near the target narrows the tens digit fast.',
    'Undo the operations to isolate one blank once the others are fixed.',
    'Check the tray: a digit you need may be missing, and some tiles are decoys that never fit.',
  ],
  traps: [
    { tag: 'precedence', text: 'Working left to right through a mixed equation instead of doing x and / first.' },
    { tag: 'wrong-checks', text: 'Pressing Check on a fill you have not verified. Each wrong check is a slip.' },
    { tag: 'guessing', text: 'Trying tiles one after another instead of reasoning about the last digit or the size.' },
    { tag: 'decoy', text: 'Placing a decoy tile. If a digit cannot satisfy the last-digit test, leave it.' },
    { tag: 'wasted', text: 'Swapping tiles back and forth. Settle a blank before placing.' },
  ],
  example: {
    puzzleId: 'de3-01',
    set: 3,
    title: 'Set 3, puzzle 1 (order of operations)',
    setup: 'An equation of the form [A]6 - 8 x [B] = 70 with two blanks and a tray of digit tiles.',
    steps: [
      'Order of operations: × and ÷ are worked out before + and -, so read the left side as [A]6 - (8 × [B]).',
      'Last-digit test: the last digit of a +, - or × result depends only on the last digits, so 6 - 8 × [B] must end in 0. Only B = 2 fits (6 - 8 × 2 = -10, which leaves last digit 0 after borrowing); that rules out 3, 4 and 8.',
      'Undo the operations. Work out 8 × 2 = 16: [A]6 - 16 = 70, so [A]6 = 70 + 16 = 86. [A]6 = 86, so A = 8.',
    ],
    lesson: 'Fix the blank with the strongest constraint (the last digit) first; the other then follows by undoing the subtraction.',
  },
};
