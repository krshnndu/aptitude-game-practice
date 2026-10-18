# Operator Switch

Rule application and working memory. Four shapes (five in set 5) sit in numbered slots. A box is a
digit code such as `3 1 4 2`: output slot i takes the item that was at input position digit i, so
`3142` on `[A, B, C, D]` gives `[C, A, D, B]`. Boxes apply left to right, each to the row coming out
of the box before it.

Items carry four cues, never colour alone: shape, letter, pattern and an Okabe-Ito colour.
Circle C (blue, dots), square S (orange, diagonals), triangle T (green, horizontal lines),
diamond D (pink, grid), hexagon H (sky blue, vertical lines).

## Puzzle kinds and sets

| Set | Name | Kind | Items | Boxes | Options | Pace |
|---|---|---|---|---|---|---|
| 1 | One box | result of one box (never self-inverse, so the inverse trap is a real option) | 4 | 1 | 4 | 12 s |
| 2 | Two boxes | result of a chain | 4 | 2 | 4 to 5 | 20 s |
| 3 | Three boxes | result of a chain | 4 | 3 | 5 | 28 s |
| 4 | Hidden box | which box fills the gap so the chain gives the shown output | 4 | 2 to 3 | 5 | 40 s |
| 5 | Five items, four boxes | result of a chain; 3 of 10 show two chains with the same result | 5 | 4 (second chain 3) | 6 | 50 s |

Every box moves at least n - 1 items, neighbouring boxes never cancel, and the chain always changes
the start. Each set is a ladder sorted by a computed difficulty score (items moved, gap position,
wrong options that agree with the answer in slot 1). Set 4 cycles the gap through last, middle and
first box.

Wrong options are built first from named misreadings (state.js `MISTAKES`): box applied to the
start row instead of the intermediate row, digits read backwards (inverse permutation), boxes in
reverse order, a box left out; for hidden boxes the inverse box, other boxes ignored, boxes before
or after the gap ignored, later boxes applied instead of undone. Then one-swap slips (from set 2 on,
slips that keep slot 1 come first, so slot 1 alone does not always settle it), then random draws.

## Modes and scoring

* **Practice**: no clock, hints, a wrong pick is crossed out and you may try again.
  Efficiency = 1 / answers given (the core `efficiency(1, answers)`), so the 70% unlock rule needs
  mostly first-time answers. Hints step through the index rows but never give the final answer
  (for a gap in box 1 the hint stops short, because the row out of box 1 is the box itself).
  As in Block Slide, hinted solves still count and the coach flags them.
* **Timed run**: 6:00, shipped 10 in a seeded shuffle, then fresh puzzles generated in the page
  from seeds derived from the run seed (pure generator, under 1 ms each, no worker). One answer per
  puzzle, no hints, skip is final. Points: correct +1, skip 0, wrong -1/(options - 1), so blind
  guessing averages zero. Run score = max(0, sum of points). A brief "Correct" or "Wrong" flash shows
  for 0.45 s before the next puzzle.
* **Unlock**: same as Block Slide, `store.isUnlocked` at 70%: best run average (score / max(10,
  puzzles reached)) or practice bests across the set. The Unlock all switch is the core one, off
  by default, shown in a bordered box on the menu.
* **Explanation** (explain.js, computed): number the start positions, carry the number row through
  every box with a per-slot reason, map numbers back to shapes, a slot 1 backward trace, slot by
  slot elimination, why each wrong option is wrong (named misreading, slip, or differing slots),
  and the strategy list (track digits not shapes, apply each box to the intermediate row, eliminate
  by slot 1 first). Hidden: forward to the gap, undo from the output, read off the digits. Two
  chains: work the shorter one, check with the other.
* **Coach** (coach.js): time to first answer against your median (puzzle, else set, else pace
  guide), each wrong answer named by recomputing what each misreading would produce, wasted answers
  and quick re-guesses (under 3 s after a wrong pick), rushed wrong answers, penalty cost in a run,
  skip late, early or neutral with what slot 1 alone would have been worth. Run level: time per
  puzzle, accuracy, most common error type, fast wrong answers (guessing), skip policy, pace and the
  top 3 habits.

## Files

```
js/games/operatorswitch/state.js    pure model, misreadings, session, points
js/games/operatorswitch/solver.js   independent validator (own code path, brute force over options and all n! boxes)
js/games/operatorswitch/gen.js      set configs and seeded generator (also used in the page)
js/games/operatorswitch/explain.js  step reasons, elimination, hints, strategy
js/games/operatorswitch/coach.js    per-puzzle and run coaching
js/games/operatorswitch/stream.js   timed run stream and tutorial puzzle
js/games/operatorswitch/play.js     UI, exports async mountOperatorSwitch(main, args)
css/operatorswitch.css              injected once by the mount function
data/sets/operatorswitch/set1..5.json
tools/operatorswitch-gen.mjs, tools/operatorswitch-verify.mjs
test/operatorswitch-*.test.mjs
```

Routes handled by the mount function (args after the game id): `[]` menu,
`['practice', set, k]`, `['run', set]`.

## Regenerate, verify, test

```sh
node tools/operatorswitch-gen.mjs                  # all sets, default seeds (about 30 ms)
node tools/operatorswitch-gen.mjs --set 4 --seed 9 # one set, another seed
node tools/operatorswitch-verify.mjs               # independent re-check, prints a summary table
node --test test/operatorswitch-*.test.mjs         # this game's tests (about 4 s)
```

The generator re-checks every set with the verify tool before writing and exits non-zero on any
problem. Same seed, same output: a test asserts all five sets regenerate byte for byte.

## Wanted shell and core changes (for the integrator)

1. **shell.js**: `import { mountOperatorSwitch } from '../games/operatorswitch/play.js';`, route
   `page === 'operatorswitch'` exactly like `blockslide` (await, token check, cleanup), add
   `operatorswitch: 'Operator Switch'` to `titles`, set `ready: true` on the GAMES entry. Suggested
   card text: skill "Rule application, working memory", blurb "Track how numbered boxes rearrange
   the shapes, or find the missing box." Optionally a nav link in index.html.
2. **recorder.js, wrong answers**: the core knows only solved, skipped and timeout. A wrong final
   answer in a timed run is stored as outcome `skipped` with its `move` event before the `skip`
   event, so analytics count it as a skip. Suggested: add outcome `wrong` (closing event `wrong`) and
   let `computeMetrics` treat it as not solved. coach.js `attemptResult` and `rowResult` already
   tell the two apart from the log, and would accept `wrong` with a one-line change.
3. **recorder event mapping used now**: every answer is `move` with `p` = option index and
   `d: 'answer'`; `hint` for hints. So `firstMoveMs` = time to first answer, `grossMoves` = answers
   given, `wastedMoves` = wrong answers before the right one. The run record's `score` is
   overwritten with the penalised points before `saveRun` (sanitizeRun keeps it).
4. **store.js**: `unlockAll` is global, so the switch on this page also unlocks Block Slide (the
   label says so). Suggested: per-game unlock-all, and `resetGame(game)`; the menu shows a "Clear my
   progress" button only when `store.resetGame` exists, so it appears automatically once added.
5. **analytics page**: no game filter yet, so attempts and runs from all games mix; the empty state
   links only Block Slide, and the per-set table reads `games.blockslide`. Suggested: a game select.
   Also note that Operator Switch run scores are points (can include penalties), not efficiencies.
6. **content.test.mjs**: optionally add this game's files to the required-files list.
7. **README.md**: status row for Operator Switch (skill "Rule application, working memory").
