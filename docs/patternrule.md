# Pattern Rule (inductive reasoning)

Each puzzle shows 3 panels that **fit** a hidden rule (tick, solid outline) and 1 or 2 panels that
**do not fit** (cross, dashed outline). Below them are 4 to 6 candidate panels. Select every
candidate that fits; at least one fits and at least one does not. A panel is a 3 x 3 grid holding
1 to 4 shapes. Each shape has a type (triangle, half-disc, arrow, drop), a fill (solid, outlined,
striped), a size (small, large), a direction it points (up, right, down, left) and a cell.
Shapes are drawn in the text colour only, so colour never carries meaning.

A rule is one feature or two features together, from these dimensions: number of shapes, shape
type, fill, direction, size, position (row, column, centre), mirror symmetry, and with two shapes,
how they relate (same or different type, fill, size, direction; opposite directions; same row or
column; neighbouring cells; one points at the other; facing; the large one higher or further left).

| Set | Name | Rule | Panels | Candidates (fitting) | Pace |
|---|---|---|---|---|---|
| 1 | Warm-up | one feature; size and direction fixed unless they are the rule | 3 fit, 1 not | 4 (1) | 25 s |
| 2 | Noise on purpose | one feature, plus a styled distractor dimension | 3 fit, 2 not | 5 (1-2) | 30 s |
| 3 | Two features at once | two features (conjunction) | 3 fit, 2 not | 5 (1-2) | 40 s |
| 4 | Relations | one relation between two shapes | 3 fit, 2 not | 5 (1-2) | 45 s |
| 5 | Expert | a feature plus a relation | 3 fit, 2 not | 6 (2-3) | 60 s |

Set 2 distractor: one dimension outside the rule is styled so that most fitting panels share a
look (for example all solid), the non-fitting candidates copy that look and the fitting
candidates avoid it. Matching by overall look then picks the wrong panels.

**Why "does not fit" panels:** from fitting examples alone, "striped and pointing up" cannot be
told apart from "striped" (both are consistent). The does-not-fit panels break exactly one part
of the rule each, which rules out the simpler readings. The test suite checks that every set 3
and set 5 puzzle becomes ambiguous when they are removed.

## Modes

* **Practice** (`#/patternrule/practice/S/K`): no clock. Hints in order: which dimensions the rule
  uses, how many candidates fit, then one non-fitting candidate ruled out with its reason (a
  wrong pick first; one is always left for you). After Check answer every candidate is marked
  (correct pick, wrong pick, missed, correctly left out: symbol, text and border style), followed by
  the explanation and the coach.
* **Timed run** (`#/patternrule/run/S`): 6:00, exam style. No hints, no feedback until the end, Skip
  is final. Pre-run rules screen with an untimed sample on the exam screen. Order: the set's 10
  puzzles shuffled by the run seed, then fresh puzzles generated from seeds derived from the run
  seed (about 10 ms each, built on the main thread), then reshuffled repeats if generation fails.
* **Scoring:** an exactly right selection scores 1, anything else 0 (skips and time-outs 0).
  Efficiency is that score. Unlock rule as in Block Slide: 70% average (best run score /
  max(10, puzzles reached), or practice bests across all 10 puzzles). The **Unlock all sets**
  toggle is on the Pattern Rule page, off by default (it is the shared core flag, so it applies to
  every game).
* **Keys:** A to F toggle candidates, Enter checks or submits (when focus is not on a button), H hint
  in practice. Every candidate is a toggle button with `aria-pressed` and a full text description;
  "Describe the panels in words" lists every panel as text.

## Explanation (`explain.js`, computed)

* The rule in plain English, from the atoms' wording.
* A dimension scan: for each dimension, either it is not shared by the fitting panels (cross it
  off, with the values per panel), or shared but not the rule (a does-not-fit panel has it too, or
  every panel in the puzzle has it), or part of the rule (and which does-not-fit panel breaks only
  that part).
* Every candidate: each part of the rule with its reason, e.g. `D does not fit: the solid arrow
  (top left) is not striped. Breaks: fill.`
* Strategy: isolate one dimension at a time.

## Coach (`coach.js`, computed from your own log)

Per puzzle: correct, wrong picks and the **dimension each wrong pick breaks** (the one you
overlooked, with a tip for that dimension), misses and the **surface feature** that probably put
you off (a feature most fitting panels share that the rule does not use), picks taken back, slow
or rushed answers against the pace guide, first-pick time against your own median (after 3
attempts), hints, skip timing (late, early, or skipped while already right) and time-outs.
Per run: time per puzzle, wrong picks against misses (over- or under-selecting), the most
overlooked dimension, skip policy, pace against 6:00, and the top 3 habits.

## Generation and validation

* `rules.js`: the catalogue, 74 atoms (yes/no tests on one panel), each with wording and a
  `why(panel)` reason. Counts (exact, at least, at most, odd, even), every / at least one / no
  shape with a type, fill, direction or size, rows, columns, centre, mirror symmetry both ways, and
  relations.
* `solver.js`: a hypothesis is a conjunction of up to 3 atoms. It is consistent when it holds on
  every fitting panel, fails on every does-not-fit panel, and selects at least one but not every
  candidate. A puzzle is valid only when **every** consistent hypothesis in the whole catalogue
  (74 + 2701 + 64824 = 67599 conjunctions) selects exactly the keyed candidates. A distractor that
  fits a simpler rule, or a fitting candidate that a simpler rule would reject, makes it invalid.
  It also checks panel structure, drawing data against the attributes, the key, the stored
  violated parts and duplicates.
* `gen.js`: builds fitting panels by small "force" steps, picks does-not-fit panels from a pool
  of near misses to rule out as many rival hypotheses as possible, builds candidates (non-fitting
  ones are near misses breaking exactly one part of the rule) and keeps the puzzle only if the
  solver agrees. Each set is sorted easiest first by a difficulty score (shapes to inspect,
  number of fitting candidates, rule kind).
* JSON: `data/sets/patternrule/setN.json`, each shape `{ t, f, s, d, r, c, x, y, rot, k }`
  (attributes plus SVG drawing data: centre, rotation, scale in a 300 x 300 view box).

```sh
node tools/patternrule-gen.mjs                  # all sets, default seeds (well under a second)
node tools/patternrule-gen.mjs --set 3 --seed 7 # one set, another seed
node tools/patternrule-verify.mjs               # whole-catalogue re-check of the shipped sets
node --test test/patternrule-*.test.mjs         # this game's tests only
```

Tests assert that every set regenerates byte for byte from its default seed.

## Wanted shell and core changes (for the integrator)

1. **Route** in `js/core/shell.js`: import `mountPatternRule` from `../games/patternrule/play.js`
   and mount it for `page === 'patternrule'` exactly like Block Slide (await, keep the returned
   cleanup, drop it if the route changed meanwhile); add `patternrule: 'Pattern Rule'` to the
   titles map; set `ready: true` on the Pattern Rule card; optionally add a nav link.
2. **Recorder outcome for wrong answers:** `js/core/recorder.js` only knows `solved`, `skipped` and
   `timeout`. Pattern Rule stores a wrong answer as outcome `skipped` (it scores 0 like a skip) and
   marks it in the closing event: `{ type: 'skip', result: 'wrong', picks: [...] }` (extra event
   fields survive `sanitizeAttempt`). Suggested: add an outcome `wrong` (end event `wrong`) so the
   analytics skip rate does not count wrong answers as skips.
3. **Analytics per game:** the Progress page mixes all games' attempts and runs, and reads
   `store.get().games.blockslide` for per-set progress. Suggested: a game filter, and a
   game-aware label for "wasted moves" (for Pattern Rule: picks taken back, recorded as
   `grossMoves - optimal` on correct answers).
4. **Unlock all** is one global flag in `store.js`; a per-game flag would stop the Pattern Rule
   toggle from also unlocking Block Slide.
5. `test/content.test.mjs` "required layout files" could list the Pattern Rule files.
