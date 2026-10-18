# Grid Memory

Working memory with a dual task. Cells of an n x n grid light up one at a time (a round orange marker with the
step number). After every highlight a side question appears and must be answered inside a time window:

* **Mirror symmetry**: is this shape symmetric left to right? Yes or No (keys Y, N).
* **Even or odd**: is the result of a short sum (+, -, x) even or odd? (keys E, O).

Left and right arrows (or 1 and 2) pick the first and second answer for both kinds. At the end the player taps the
lit cells in the order they lit (square blue markers with the entry number). Arrow keys move between cells, Enter or
Space enters one. The trial submits itself when every cell is entered; Submit sends a shorter answer early.

## Scoring

* Each sequence position recalled in the right place: 7 points. Each side question right: 3 points.
  Trial efficiency = points / (10 x length). Partial credit by position; a time-out on a side question counts as wrong.
* Skipped or clock-cut trials score 0.
* A trial **passes** when every position is right and at most 1 side question is wrong.
* Unlock: 70% average in a set unlocks the next (best timed run, or practice bests over all 10 trials), using the
  shared `store.js` rules. The "Unlock all sets" toggle on the Grid Memory page is visible and off by default.

## Modes

* **Practice**: one trial, no run clock. Undo (Backspace or Z) and Hint (H: enters the next cell for you, that
  position scores 0) at recall, "Skip and show answer", and an optional "Relaxed" checkbox that removes the side
  question window (kept for the browser session; relaxed attempts are saved with `source: 'relaxed'`).
  Afterwards: the coach, then the explanation.
* **Timed run (exam mode)**: 6:00, adaptive staircase on length. The first trial has the set's shortest length; a pass
  makes the next trial 1 longer, a miss or a skip 1 shorter (minimum 2, maximum `runMax`). Trials come from the set's
  shipped puzzles at that length (shuffled by the run seed), then from fresh trials generated on the spot from seeds
  derived from the run seed, so runs never run out. No undo, no hint, Skip is final. A rules screen and an untimed
  sample trial on the exact exam screen come first. The run record stores `maxSpan` (longest passed length) and
  `trail` (length and pass per trial). Run average = score / max(10, trials reached), as in Block Slide.

## Explanation after each trial (`explain.js`)

* The correct sequence as a numbered path (circles, solid line) with the player's taps on top (squares, dashed line,
  a cross and heavy outline on wrong ones), with layer toggles and a text alternative.
* Where the player diverged: first wrong position and its kind (wrong order, with swaps named, or a cell that never lit).
* A per-position table and the path in words: landmark per cell (corner, edge, centre) and each step ("2 right",
  "1 diagonally up-left"); straight runs are grouped into chunks.
* Side questions: correct answer, your answer and time, and the reason (the first mirror pair that differs, or the sum
  and the parity shortcut).
* Memory tips picked from what happened: chunk the path, rehearse while judging, anchor to landmarks.

## Coach (`coach.js`)

Per trial, from the replayed event log: order errors against location errors, errors at the start (primacy) or end
(recency) for length 4+, positions left empty, side time-outs, fast wrong answers (under 0.6 s), dropping the side task
while memory holds, careful slow side answers with weak recall, first tap latency and time per cell (against your own
median in the set after 3 attempts), the longest pause and whether that position broke, repeat taps and undo, hints,
skip cost (what the entered answer was worth) and time-outs.
Run level: span reached and the staircase trail, recall against side accuracy trade-off, the error rate by serial
position (start, middle, end), order against location totals, time per finished trial and side answer speed, skips,
and the top 3 habits.

## Sets

| Set | Grid | Lengths | Side questions | Cell shown | Side window | Asymmetric pairs |
|---|---|---|---|---|---|---|
| 1 Warm-up | 3x3 | 2-3 | symmetry | 1.0 s | 8 s | 3-4 |
| 2 Quick sums | 4x4 | 3-4 | even/odd (+, 1-9) | 0.9 s | 6 s | n/a |
| 3 Switching tasks | 4x4 | 4-5 | both, mixed | 0.85 s | 5 s | 2 |
| 4 Bigger grid | 5x5 | 4-6 | both (+, -, x) | 0.8 s | 4 s | 1-2 |
| 5 Expert | 5x5 | 5-7 | both (two-digit) | 0.7 s | 3 s | 1 |

Within a set the 10 trials climb in length. Fewer differing mirror pairs make an asymmetric shape harder to spot.

## Files

```
js/games/gridmemory/state.js     rules, scoring, trial session, log replay (pure, node tested)
js/games/gridmemory/gen.js       set configs, seeded generator, fresh trials, ids that rebuild trials
js/games/gridmemory/validate.js  independent validator (own symmetry, connectivity and arithmetic code)
js/games/gridmemory/explain.js   path in words, divergence, side reasons, tips
js/games/gridmemory/coach.js     per-trial and run-level coaching
js/games/gridmemory/stream.js    staircase, run trial source, sample trial
js/games/gridmemory/record.js    recorder-compatible attempt records
js/games/gridmemory/play.js      UI, exports mountGridMemory(main, args) and injects css/gridmemory.css once
data/sets/gridmemory/setN.json   shipped trials
tools/gridmemory-gen.mjs         regenerate sets
tools/gridmemory-verify.mjs      re-verify shipped sets
test/gridmemory-*.test.mjs       node:test suites (plus gridmemory-helpers.mjs)
```

Routes handled by `mountGridMemory(main, args)`: `#/gridmemory`, `#/gridmemory/practice/S/K`, `#/gridmemory/run/S`.

## Regenerate, verify, test

```sh
node tools/gridmemory-gen.mjs                  # all sets, default seeds (instant)
node tools/gridmemory-gen.mjs --set 3          # one set
node tools/gridmemory-gen.mjs --set 3 --seed 7 # one set, another seed
node tools/gridmemory-verify.mjs               # independent re-check, prints a summary table
node --test test/gridmemory-*.test.mjs         # this game's suites
```

The generator writes nothing for a set that fails the validator. Tests assert all five sets regenerate byte for byte.

Validator checks per trial: grid size, length in band, timing, distinct in-grid cells (so exactly one ordered response
is right), one side question per highlight, each answer recomputed independently (symmetric shapes have 0 differing
mirror pairs, asymmetric ones a count inside the set band, every shape one 4-connected piece, sums non-negative with the
stored parity), no shape twice in a trial, and from set 3 no sequence on one straight line. Per set: 10 trials, lengths
never dropping and spanning the band, unique ids and sequences, every question kind present, yes/no and even/odd
answers between 30% and 70%.

## Wanted shell and core changes (for the integrator)

1. **shell.js**: `import { mountGridMemory } from '../games/gridmemory/play.js';`, set `ready: true` on the
   `gridmemory` entry in `GAMES`, add a route branch identical to Block Slide's
   (`else if (page === 'gridmemory') { const dispose = await mountGridMemory(main, rest); if (token !== routeToken) dispose(); else cleanup = dispose; }`)
   and `gridmemory: 'Grid Memory'` in `titles`.
2. **index.html** (optional): a `<a href="#/gridmemory">Grid Memory</a>` nav link.
3. **recorder.js**: it only accepts Block Slide event types and scores attempts as `optimal / moves`. Grid Memory logs
   in that vocabulary (see the header of `state.js`) and stores points earned as `optimal` and points possible as
   `moves`, so `metrics.efficiency` is exact. Nicer: let a game pass its own `efficiency` (or `score`) and keep a small
   `detail` object through `sanitizeAttempt`, then `recorderFields()` in `state.js` is the one place to change.
4. **analytics.js / analytics-page.js**: the page mixes all games. It needs a game filter; "wasted-move rate" and
   "fewest moves" are Block Slide ideas (for Grid Memory `grossMoves` is recall taps and `optimal` is points). A span
   chart from `run.maxSpan` would be the natural Grid Memory series. The sample data and empty-state link are Block
   Slide only.
5. **store.js**: `unlockAll` is one flag for the whole site, so the toggle here also unlocks Block Slide sets, and
   `reset()` clears every game (so this page has no "Clear my progress" button). Wanted: per-game `resetGame(game)` and,
   if preferred, a per-game unlock flag.
6. **README.md**: mark Grid Memory ready and link this file. `test/content.test.mjs` could list the Grid Memory files.
7. **package.json** (optional): `"gen:gridmemory"` and `"verify:gridmemory"` scripts.
