# Latin Square

Deductive reasoning game. A square grid (4x4 to 6x6) holds symbols so that each symbol appears exactly once in every
row and every column. Some cells are blank; one or two cells are marked `?`. Pick the symbol that must go in each `?` cell.

Symbols: circle (C), square (S), triangle (T), diamond (D), plus (P), heart (H). Each has its own outline and letter as
well as an Okabe-Ito colour, so colour is never the only cue. A puzzle uses n of the six.

## Modes

* **Practice** (`#/latinsquare/practice/S/K`): no clock. A wrong pick is crossed out with a computed reason
  (`Square is already in row 2, at (2,4).`) and you pick again. Hint reveals the next solving step. Efficiency =
  ? cells / picks made (1 when right first time). After the puzzle: coach findings and the worked solution, replayed one
  cell at a time on a small grid with the row and column each step reads lit up.
* **Timed run** (`#/latinsquare/run/S`): 6:00, puzzles never run out (the set's 10 shuffled by the run seed, then fresh
  puzzles generated on the main thread in a few ms each; rows/columns/symbols reshuffled variants if generation ever
  fails). Answers are final and not marked during the run. No hints. Skip is final. Pre-run rules screen plus an untimed
  sample on the exact exam screen.
* **Run score**: right +1, wrong `-1/(n-1)` (blind guessing averages 0), skip 0, floored at 0 for the run. With two `?`
  cells both must be right. Unlock average = score / max(10, puzzles reached), as in Block Slide.
* **Unlock**: next set opens at 70% (best timed-run average, or practice bests across all 10 puzzles of the set). The
  "Unlock all sets" toggle sits in the toolbar of the Latin Square page and defaults off.
* **Controls**: tap a symbol, or press its number (1..n) or letter. Tap or click any cell to light up its row and column.
  The grid is one Tab stop (roving tabindex): arrow keys move, Enter selects. Esc clears a hint highlight.

## Sets

| Set | Grid | Chain depth | Blanks | ? cells | Pace guide |
|---|---|---|---|---|---|
| 1 Warm-up | 4x4 | 1, plain row plus column check | 5-8 | 1 | 15 s |
| 2 Five by five | 5x5 | 1, plain row plus column check | 8-12 | 1 | 20 s |
| 3 First chains | 5x5 | 2 | 10-14 | 1 | 30 s |
| 4 Six by six | 6x6 | 2 | 14-18 | 1 or 2 (alternating) | 40 s |
| 5 Long chains | 6x6 | 3 | 18-22 | 2 | 55 s |

Within a set, puzzles are ordered by the number of solving steps, then blanks.

## How puzzles are made and checked

* `js/games/latinsquare/gen.js`: random full Latin square by randomised backtracking (any square shape, not only shuffled
  cyclic ones), random blanks, then `solver.deduce()`.
* `js/games/latinsquare/solver.js`: row and column elimination in parallel rounds with two rules, naked single (row plus
  column leave one symbol) and hidden single (a missing symbol has one open cell left in its row or column). The round in
  which a cell is placed is its chain depth, which is the minimum over all orders of applying these two rules. More
  advanced techniques (pairs and the like) are not used; they could shortcut a few chains, which only makes a puzzle
  easier than its label. Each placement keeps a justification that cites givens wherever possible; `chainFor()` gives
  exactly the helper cells a target needs.
* `js/games/latinsquare/explain.js`: the steps in solving order with plain-English text, e.g.
  `Row 3 already has triangle, circle; column 2 has square; only diamond remains, so (3,2) is diamond.`
  Wrong picks are explained as already in the row, already in the column, or ruled out by a helper cell.
* `tools/latinsquare-verify.mjs` is independent of the deduction engine: it uses its own exhaustive backtracking search
  to prove each `?` cell has exactly one possible symbol in any completion (and that it is the stored answer), recounts
  the chain depth with a second plain implementation of the two rules, checks naked-only sets, replays every explanation
  step against the givens, and rejects duplicate layouts (up to renaming symbols).

## Regenerate, verify, test

```sh
node tools/latinsquare-gen.mjs                  # all sets, default seeds (well under a second)
node tools/latinsquare-gen.mjs --set 3          # one set
node tools/latinsquare-gen.mjs --set 3 --seed 7 # one set, another seed
node tools/latinsquare-verify.mjs               # re-verify shipped sets, prints a summary table
node --test test/latinsquare-*.test.mjs         # this game's tests only
```

Same seed, same output: a test asserts all five sets regenerate byte for byte.

## Coach

`coach.js` is pure and node tested. It reads the recorder event log: `select` (p = cell looked at), `move`
(p = symbol index, d = `?` cell number), `hint`, then `solve`, `skip` or `timeout`.

| Finding | How it is computed |
|---|---|
| Missed row / missed column | wrong pick of a symbol already given in that row / column of the `?` cell |
| Missed chain | wrong pick only ruled out after a helper cell is filled (the helper is named) |
| Guessing | wrong pick faster than `1000 + 400 x n x depth` ms after the start or the previous pick |
| Row and column checked | no pick was a symbol visible in its row or column |
| Looked at the chain | a helper cell was selected before the first answer (depth 2+) |
| Slow first answer | first pick over 2x your median for this puzzle (3+ attempts) or set, else over 2x the pace guide |
| Hints, skip early / late, long puzzle, time-out | from the log against the set's pace guide |

Run coaching: time per puzzle, accuracy with wrong picks by kind, guessing cost in points, skip policy, pace against
6:00 and points per minute, and the top 3 habits ranked by summed severity.

## Wanted shell and core changes (for the integrator)

1. **Route**: in `js/core/shell.js` import `mountLatinSquare` from `../games/latinsquare/play.js`, route
   `page === 'latinsquare'` exactly like `blockslide` (await the mount, dispose if a newer navigation happened), add
   `latinsquare: 'Latin Square'` to `titles`, and set `ready: true` on the Latin Square card in `GAMES`.
   Optional: a header nav link `#/latinsquare` in `index.html`.
2. **Stylesheet**: `mountLatinSquare` injects `<link rel="stylesheet" href=".../css/latinsquare.css" data-game-css="latinsquare">`
   once. If you link it from `index.html` instead, give that link `data-game-css="latinsquare"` so it is not added twice.
3. **Recorder outcome**: `js/core/recorder.js` has no `wrong` outcome. A timed-run puzzle answered wrongly is saved as
   outcome `skipped` (no credit), and `coach.effectiveOutcome()` tells it apart from a real skip by reading the log.
   Suggested change: add `wrong` to `OUTCOMES` / `END_EVENT` (closing event `wrong`), so analytics skip rates stay
   accurate for this game. `createAttemptLog().move(p, d)` also cannot carry extra fields; the coach recomputes
   right/wrong from the puzzle, so nothing else is needed.
4. **Run score**: Latin Square runs set `run.score` to exam points (see above) after `summarizeRun`, plus
   `run.wrong` and `run.scoring = 'exam-points'`. Per-puzzle rows keep efficiency 1 (right) or 0.
5. **Analytics page**: it mixes all games today (no game filter), so Latin Square runs and Block Slide runs share one
   score chart. A game filter next to the set filter would fix that; the empty-state link points only to Block Slide.
6. **Unlock-all and Clear progress**: `store.unlockAll` is one flag for all games, so the Latin Square toggle also
   unlocks Block Slide sets (and the other way round). A per-game flag would need a store change. There is no
   "Clear my progress" button here because `store.reset()` wipes every game's progress.
7. **README / LEGAL**: add a Latin Square section and flip its status in the table.
8. **Content test**: `test/content.test.mjs` lists required files for Block Slide only; Latin Square files could be added.
