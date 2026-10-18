// Shared test fixtures: hand-built boards with known optimal move counts.

export function board(n, { ball, exit, blocks = [], walls = [] }) {
  return { id: 'hand', n, ball, exit, blocks, walls };
}

export const HAND_BUILT = [
  {
    name: 'ball already on exit',
    puzzle: board(4, { ball: { r: 0, c: 3 }, exit: { r: 0, c: 3, side: 'top' } }),
    optimal: 0,
  },
  {
    name: 'clear straight lane',
    puzzle: board(4, { ball: { r: 0, c: 0 }, exit: { r: 0, c: 3, side: 'right' } }),
    optimal: 3,
  },
  {
    name: 'single blocker in lane: move it aside once, then 3 ball moves',
    puzzle: board(4, {
      ball: { r: 3, c: 0 },
      exit: { r: 3, c: 3, side: 'right' },
      blocks: [{ r: 3, c: 2, len: 1, dir: 'h' }],
    }),
    optimal: 4,
  },
  {
    name: 'chain: vertical block B must move before blocker A can leave the lane',
    puzzle: board(4, {
      ball: { r: 3, c: 0 },
      exit: { r: 3, c: 3, side: 'right' },
      walls: [[2, 0]],
      blocks: [
        { r: 3, c: 1, len: 1, dir: 'h' },
        { r: 1, c: 1, len: 2, dir: 'v' },
      ],
    }),
    optimal: 5,
  },
  {
    name: 'detour around a wall column',
    puzzle: board(4, {
      ball: { r: 0, c: 0 },
      exit: { r: 0, c: 3, side: 'top' },
      walls: [[0, 1], [1, 1], [2, 1]],
    }),
    optimal: 9,
  },
  {
    name: 'length 3 block covering the exit row must step up as one piece',
    puzzle: board(4, {
      ball: { r: 3, c: 0 },
      exit: { r: 3, c: 3, side: 'right' },
      walls: [[2, 0]],
      blocks: [{ r: 3, c: 1, len: 3, dir: 'h' }],
    }),
    optimal: 4,
  },
];

export const UNSOLVABLE = board(3, {
  ball: { r: 1, c: 0 },
  exit: { r: 1, c: 2, side: 'right' },
  blocks: [{ r: 0, c: 1, len: 3, dir: 'v' }],
});
