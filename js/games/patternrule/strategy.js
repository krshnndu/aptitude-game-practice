// Pattern Rule strategy cheat sheet: static, hand-written. Traps carry the coach tag they map to.
// The worked example's steps are checked against explain.js by the tests.

export const STRATEGY_SHEET = {
  game: 'patternrule',
  title: 'Pattern Rule strategy',
  heuristics: [
    'Scan one dimension at a time: count, type, fill, direction, size, position, symmetry, then relations between shapes.',
    'Cross off any dimension that varies among the fitting panels: the rule cannot depend on it.',
    'Of what the fitting panels share, keep only what every does-not-fit panel breaks.',
    'Test each candidate on the surviving rule only; ignore features that merely look similar.',
    'Some puzzles have more than one fitting candidate: check them all before submitting.',
  ],
  traps: [
    { tag: 'false-pick', text: 'Picking a candidate that breaks the rule. Test it against the rule, not the look of the examples.' },
    { tag: 'miss', text: 'Stopping at the first fitting candidate when more than one fits.' },
    { tag: 'overlooked-count', text: 'Overlooking the number of shapes, the most common rule dimension.' },
    { tag: 'surface-type', text: 'Matching on shape type when the rule is about something else.' },
    { tag: 'rushed', text: 'Answering before scanning all dimensions.' },
  ],
  example: {
    puzzleId: 'pr1-01',
    set: 1,
    title: 'Set 1, puzzle 1 (a count rule)',
    setup: 'Three fitting panels, one does-not-fit panel and four candidates A to D.',
    steps: [
      'Cross off what the fitting panels do not all share: symmetry.',
      'What is left and broken by the does-not-fit panels: number of shapes. Rule: The panel has exactly 1 shape.',
      'Test each candidate on number of shapes only: A breaks number of shapes, B breaks number of shapes, C breaks number of shapes and D fits.',
    ],
    lesson: 'Eliminating dimensions first leaves one rule to test, so each candidate takes a single glance.',
  },
};
