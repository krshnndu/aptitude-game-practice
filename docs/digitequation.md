# Digit Equation

Numerical reasoning. A short equation has 1 to 3 blank digit slots (A, B, C in reading order) and a tray of
digit tiles. Place tiles so the equation is true.

## Rules (as shown to the player)

* x and / are worked out before + and -, left to right within each group.
* Every division must come out exact (no remainder); dividing by 0 is not allowed.
* A number with two or more digits cannot start with 0 (a lone 0 is fine).
* Each tile can be used as many times as its count shows ("2 left").
* The tray may hold decoys: tiles no answer uses.
* Any fill that makes the equation true is accepted. Shipped and generated puzzles all have exactly one answer.

Score per solved puzzle = blanks / tiles placed (1 at most; every swap costs), 0 when skipped or cut off.
A wrong Check does not cost a point by itself, but fixing it needs another placement.

| Set | Name | Blanks | Operators | Decoys | Pace guide |
|---|---|---|---|---|---|
| 1 | Warm-up | 1 | + - | 2-3 | 15 s |
| 2 | Times tables | 2 | x | 2-3 | 25 s |
| 3 | Order of operations | 2 | + - x, mixed, precedence always matters | 3-4 | 35 s |
| 4 | Bigger numbers | 3 | + - x, up to 3-digit numbers | 3-4 | 45 s |
| 5 | Division and decoys | 3 | + - x /, always a / | 4-6 | 55 s |

Modes: Practice (untimed, two-level hints: first the blank and the technique, then the full step), Timed run
(6:00, endless: the 10 shipped puzzles shuffled by the run seed, then fresh puzzles generated in the browser
from seeds derived from the run seed, pure and a few ms each; no hints; skip is final). Unlock: 70% average
efficiency on the previous set (core `store.isUnlocked`), plus the visible "Unlock all sets" toggle (default off).

## Files

| Path | Role |
|---|---|
| `js/games/digitequation/state.js` | pure model: parse, precedence evaluation, exact division, leading zero, game session |
| `js/games/digitequation/solver.js` | brute force over tray fills, solution count and uniqueness, hint target |
| `js/games/digitequation/gen.js` | seeded generator, `SET_CONFIGS`, `generateSet`, `generateFresh` |
| `js/games/digitequation/explain.js` | deduction engine with computed reasons, check text, tips, difficulty |
| `js/games/digitequation/coach.js` | per-puzzle and run-level coaching from the event log |
| `js/games/digitequation/stream.js` | timed run stream and the tutorial puzzle |
| `js/games/digitequation/play.js` | UI, exports `mountDigitEquation(main, args)` |
| `css/digitequation.css` | game styles, injected once by the mount function |
| `data/sets/digitequation/set1..5.json` | shipped puzzles |
| `tools/digitequation-gen.mjs`, `tools/digitequation-verify.mjs` | regenerate, verify |

Explanation steps (all computed): order of operations, leading zero, exact division rule, last-digit test
(units digits only, no division), estimate (range of each side for each tile over every fill of the other
blanks), undo the operations (inverse operations once one number is left), try each tile (with the reason each
wrong tile fails), and a final check (casting out nines, or multiplying back when there is a division).

Coach findings: clean solve, extra placements and swaps, wrong checks with the sides each gave, order of
operations slips (a wrong fill that is true read left to right), trial and error (many swaps or 3+ wrong
checks, or 2+ wrong checks with under 2 s between actions), decoys tried, first-tile latency against your
own median (else the pace guide), slow solve, hints, early, late or plain skip, time-out. Run level: time per
puzzle, accuracy, skip policy, pace against 6:00, top 3 habits.

## Regenerate, verify, test

```sh
node tools/digitequation-gen.mjs                  # all sets (well under 1 s)
node tools/digitequation-gen.mjs --set 3 --seed 9 # one set, another seed
node tools/digitequation-gen.mjs --dry --explain  # print puzzles and explanations, write nothing
node tools/digitequation-verify.mjs               # independent brute-force re-check, summary table
node --test test/digitequation-*.test.mjs
```

The verifier does not use the game's evaluator: it builds each filled equation as text, parses it with its
own recursive-descent parser and tries all 10^k digit vectors. It fails on wrong stored solution counts or
unique flags, and warns (does not fail) on puzzles with more than one answer.

## Wanted shell and core changes (for the integrator)

1. `js/core/shell.js`: import `{ mountDigitEquation } from '../games/digitequation/play.js'`, set `ready: true`
   on the `digitequation` entry of `GAMES`, add a route branch like Block Slide's:
   `else if (page === 'digitequation') { const dispose = await mountDigitEquation(main, rest); if (token !== routeToken) dispose(); else cleanup = dispose; }`
   and `digitequation: 'Digit Equation'` in the `titles` map. Routes used: `#/digitequation`,
   `#/digitequation/practice/S/K`, `#/digitequation/run/S`.
2. `index.html`: optional nav link `<a href="#/digitequation">Digit Equation</a>`.
3. Analytics page (`js/core/analytics-page.js`, `analytics.js`): attempts and runs are saved with
   `game: 'digitequation'`, but the page does not filter by game today, so Digit Equation runs would mix into
   the Block Slide charts and the per-set tables, and "Best saved run" reads `games.blockslide` only. A game
   filter (like the set filter) is wanted. Metrics map cleanly: `moves` / `grossMoves` = tiles placed,
   `optimal` = blanks, `firstMoveMs` = first tile, `blocked` = wrong checks, `undos` = cleared blanks.
4. `js/core/store.js`: `unlockAll` is one flag for every game, so the toggle on this page is labelled
   "applies to every game". A per-game flag would need a store change.
5. The recorder's event types are reused (no new types): `move { p: blank, d: digit }`, `undo` = clear the
   selected blank (a `select` is logged first), `reset`, `blocked` = wrong check, `hint`.
6. `README.md`: status row and a short section can be copied from this file.
