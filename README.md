# CogPrep Arcade

Free practice for game-based cognitive aptitude assessments, as a static site for GitHub Pages.
Vanilla JavaScript ES modules, no bundler, no dependencies. Tests use `node:test`.

Independent practice only: not affiliated with Aon, Capgemini or any employer. See [LEGAL.md](LEGAL.md).

## Status (v0.2)

| Game | Skill | Status |
|---|---|---|
| Block Slide | Planning, spatial reasoning | Ready: 5 sets x 10 puzzles, endless timed runs, coach, analytics |
| Latin Square | Deductive reasoning | Coming soon |
| Grid Memory | Working memory, dual task | Coming soon |
| Operator Switch | Numerical reasoning | Coming soon |
| Digit Equation | Numerical reasoning | Coming soon |
| Pattern Rule | Inductive reasoning | Coming soon |

## Block Slide

An n x n board holds a ball and rectangular blocks (1xk or kx1, k = 1..3), plus fixed walls in sets 4 and 5.
One move slides one piece exactly one cell up, down, left or right into empty cells. Blocks never rotate.
Goal: get the ball onto the exit cell on the board edge in the fewest moves.

* **Practice**: one puzzle, no clock, with Undo, Reset and Hint (next best move from your current position).
* **Timed run (exam mode)**: 6:00 on the clock and the puzzles never run out. A run first serves the set's 10 shipped
  puzzles in an order shuffled by the run seed, then fresh puzzles of the same band, generated from seeds derived from the
  run seed in a module Web Worker (`gen.worker.js`) so the board never stalls. If no fresh puzzle is ready yet, the run
  serves a rotated or mirrored copy of a shipped puzzle (same optimum by symmetry, available at once). Skip is final.
  There is no Undo, Reset or Hint, and the screen is cut down to the board, the clock, the move counter and Skip.
  Run score = sum of efficiencies, where efficiency = optimal / your moves (0 when skipped or cut off by time).
* **Pre-run tutorial**: before the clock starts, a rules screen (as in real assessments) and an untimed sample puzzle on the
  exact exam screen.
* **Coach** (`coach.js`): after each puzzle, and for every puzzle of a run, findings computed by replaying your move log
  against the optimal solution, each with a plain-English suggestion. After a timed run, run-level coaching adds time per
  puzzle, skip policy, pace against the 6:00 budget and the top 3 habits to fix (see below).
* **Analytics** (`#/analytics`, "Progress" in the header): charts and tables over your own history (see below).
* **Review**: after a puzzle (or after a run) the optimal line is replayed step by step with Prev, Next and Auto-play.
  Each step carries a reason computed by `explain.js`, for example
  `Move block A (blue) 1 up: clears cell (4,3) on the ball's route.`
* **Progress**: localStorage key `cogprep.progress.v1`. The next set unlocks at 70% average efficiency
  (best timed run, or practice bests across all puzzles of the set). Because runs are endless, a run's average is
  score / max(10, puzzles reached). An "Unlock all sets" toggle is on the Block Slide page.
* **Controls**: tap or click a piece (or Tab to it), then arrow keys or the on-screen arrows. Tapping an empty cell next to the
  selected piece also moves it. Esc clears the selection; in practice Z undoes and H asks for a hint.
* **Accessibility**: every block has a letter and a pattern as well as an Okabe-Ito colour, live region announcements,
  visible focus, light and dark themes via `prefers-color-scheme`, reduced motion support.

| Set | Grid | Blocks | Walls | Optimal moves | Pace guide |
|---|---|---|---|---|---|
| 1 Warm-up | 4x4 | 2-3 | 0 | 3-5 | 20 s |
| 2 Getting moving | 5x5 | 3-4 | 0 | 5-7 | 30 s |
| 3 Planning ahead | 5x5 | 4-5 | 0 | 7-10 | 40 s |
| 4 Walls appear | 6x6 | 5-6 | 1-2 | 9-13 | 50 s |
| 5 Expert | 6x6 | 7-8 | 2-3 | 12-18 | 60 s |

## Play recorder

`js/core/recorder.js` logs every action of every attempt, timestamped in ms since the puzzle appeared:
`select` (piece, or none), `move` (piece, direction), `blocked` (a move the board refused), `undo`, `reset`, `hint`,
and one closing event: `solve`, `skip` or `timeout`. Each attempt stores derived metrics: first-move latency (thinking
time), longest pause between actions, total time, net moves, moves made (undone ones included), optimal, efficiency,
undo, reset and hint counts, and the outcome. A timed run stores a run record (seed, start, end, score, one compact row per
puzzle), so analytics keep working after old attempts are pruned.

* Storage: localStorage key `cogprep.attempts.v1`, `{ v, attempts, runs }`, capped at 1500 attempts and 500 runs (oldest
  out). If the browser quota is hit, old event logs are dropped first (their metrics stay), then old attempts.
* Migrate-safe: versioned, with a chain of upgrade steps (`MIGRATIONS`). Every record is validated; malformed ones are
  dropped without failing the load, and metrics are recomputed from the log. Data written by a newer version is never
  overwritten (the recorder goes read only), and unreadable JSON is kept under `cogprep.attempts.v1.corrupt` before a fresh start.
* Backup: the analytics page exports one JSON file (`kind: "cogprep-backup"`) with the history and the progress store, and
  imports it back. Import merges: records already present (same id) are kept, and progress keeps the better value per field.

## Coach

`js/games/blockslide/coach.js` is pure (no DOM) and node tested. It replays the attempt's event log on the board and reports:

| Finding | How it is computed |
|---|---|
| Wasted moves | moves made (undone and reset ones included) minus optimal, on solved puzzles |
| First-move latency | against your median for this puzzle (3+ attempts), else for this set, else against half the pace guide |
| Premature ball moves | ball moves made while blocks closed every path to the exit, after the position left the optimal line, and not the stored line's move from that position |
| Oscillation | a piece's next move goes straight back, counted beyond the optimal line's own reversals |
| Undo and reset | counts from the log (undo is a fix item in exam mode, a note in practice) |
| Off-line pieces | moves on blocks the stored optimal line never moves |
| Divergence | the first move that left the optimal line, with the better move and its reason from `explain.js` |
| Skip cost | a skip gives up the 1 point the puzzle was worth; late past 2x the pace guide, early under 0.25x with no move |

Fast mode checks divergence against the stored line. Deep mode (practice, and per-puzzle review after a run) runs a bounded
BFS from the player's position, so an equally short alternative order is not called a mistake. Searches are capped at 8 per
attempt and 250,000 states each; when a cap is hit the wording falls back to "the optimal line".

Run-level coaching: average and median time per puzzle against the pace guide; skip policy (skipped too late, skipped too
early, held on past 3x pace) with a skip rule for the set; pace (puzzles reached against 6:00 / pace guide, score per
minute); and the top 3 habits, ranked by the summed severity of the per-puzzle findings.

## Analytics

`js/core/analytics.js` holds the math (pure, node tested). `js/core/charts.js` draws plain SVG (no libraries) with a legend
for two or more series, a crosshair tooltip (pointer or arrow keys) and a data table under every chart.
`js/core/analytics-page.js` renders the page.

* Summary at the top in plain English, for example `Last 5 runs +22% vs first 5 (average score 6.10 vs 5.00).`, plus the
  trend per run, flagged jumps, change in first-move thinking time, streak and totals. A set filter gives like-for-like views.
* Charts: score per timed run with a 5-run trailing moving average, a least squares trend line and "jump" labels; puzzles
  solved per run; average first-move latency per run; skip rate and wasted-move rate per run; efficiency per set.
* Jump rule: a run is a jump when it beats the previous best, or the mean of the previous 5 runs, by more than 1 population
  standard deviation of all earlier runs (needs 3 earlier runs). With a flat history (SD 0) any rise counts, and after a
  step up the lagging mean can flag a few runs in a row.
* Tables: personal bests per set (best run score, most solved in a run, fastest optimal solve, quickest average first move)
  and per-set progress (attempts, practice puzzles played, runs, first 3 against last 3 runs).
* Empty state: a "Show sample data" toggle loads a seeded sample history, marked SAMPLE DATA on the page.

## Learning layer

Design spec: `docs/learning-spec.md`. Everything stays in the browser under the localStorage key `cogprep.learn.v1`
(`js/core/learn-store.js`, versioned with migrations), and it is included in the JSON backup (backup format v2; v1 files still import).

* Routes: `#/achievements`, `#/report/<game>` (`?print=1` for the A4 print view), `#/report/<game>/snapshot/<id>`,
  `#/review/<game>` (`?filter=<coach tag>`), `#/review/<game>/<attemptId>`, `#/review/today`, and `#/<game>/retry` (the
  game's practice view playing a puzzle handed over by the review library).
* Achievements (`js/core/achievements.js`, pure): 24 rules from spec A, each with progress 0 to 1 and a hint, cached with
  an input stamp, unlocks kept for good. Skill (`js/core/skill.js`, pure): Game Skill Score, overall badge, 14-day delta,
  stale marker; trends need n of 5 or more.
* Review library: failed or under-70% attempts become notebook items automatically (`js/core/notebook.js`), scheduled by
  SM-2 lite on 1, 3, 7, 14, 30 days (`js/core/srs.js`), capped at 100 per game and 600 in total. Items store a seed
  reference, never a board: each game's `review.js` adapter rebuilds the puzzle from its id or seed (run variants from
  the run seed or a small permutation; slow expert puzzles and lost-run variants keep a compact encoding of at most 1800
  characters) and checks a checksum so a changed generator is flagged, not silently replayed.
* Hooks in each `play.js` (`js/core/learn-hooks.js`): coach "fix" finding ids saved per attempt as stable tags, the live
  puzzle used for the seed reference, walkthrough views logged, and retries graded on finish.
* Reports (`js/core/report-data.js`, pure; `report-page.js`, `report-sections.js`, `learn-charts.js`): header, skill
  breakdown with sparklines, weekly coach-tag trend, pace against par, weak puzzle features (n of 5 or more), three
  prescriptions, the static strategy cheat sheet (`js/games/<game>/strategy.js`), snapshots (weekly and on demand, 26 per
  game, diff any two), print view and standalone HTML export.
* Did vs should (`js/core/dvs.js`, pure; `js/core/dvs-ui.js`): each game's `review.js` exports `didVsShould(attempt,
  puzzle)` returning side-by-side rows (what you did, what was optimal or correct), the first divergence and a plain
  note. Shown after every practice puzzle, per puzzle at the end of a timed run, in the replay Compare view, and as
  "Did vs should: recent mistakes" on each report. Each attempt keeps compact codes `dvs: { ans, opt, div, lat }` (ASCII
  game codes, divergence step, ms to divergence) in `cogprep.attempts.v1`; the item telemetry event carries the same
  codes cut to 36 characters (the event stays under 512 bytes).
* Telemetry for the learning pages (`ev()` in `board.js`): `ach_view`, `ach_unlock`, `report_view`, `review_open`,
  `review_done`.

## Flexible exit and study mode

Logic in `js/core/partial.js` (pure), widgets in `js/core/endrun-ui.js`, pages in `js/core/study-page.js`.

* End and review: every timed run (in the exam bar) and every practice puzzle has the button, with a confirm dialog.
  A route change (page dispose), `pagehide` and the clock running out also end a run; a hidden tab saves a silent
  checkpoint (`recorder.saveRun(run, { silent: true })`, no upload, no `run_end`) that the final save replaces.
* Runs ended early are saved with `status: 'partial'`, `partial: true` and `exit` (`early`, `nav`, `unload`, `hidden`).
  They count toward progress, reports, streaks, the review library and did vs should, but `board.js` never queues them
  for `/submit` and `runExtras` shows no rank or percentile. `run_end` carries `part: 1` and `exit`.
* Result screen: score so far, items seen, did vs should per attempted item, the pool puzzles never reached listed as
  "not attempted" with the solution on demand, and top 3 takeaways (biggest time sink, repeated mistake pattern, one
  strategy sheet tip) with a link to the review notebook. Shown on every run result.
* Resume slot `cogprep.resume.v1` (one entry, 7 days): the home page card reopens an unfinished practice puzzle, or
  offers review of a run that ended early (timed runs restart fresh). Review pages: `#/review/<game>/run/<runId>` and
  `#/review/<game>/practice/<set>` (this tab's practice session).
* Study mode `#/study/<game>/<set>`: every puzzle in a set with its walkthrough (each `play.js` exports
  `studyWalkthrough`), no timer, nothing scored or saved.
* Telemetry: `feat` events `end_early`, `resume`, `study_open`.

## Layout

```
index.html                     single page, hash routes (#/, #/blockslide, #/blockslide/practice/S/K, #/blockslide/run/S, #/analytics, #/about)
css/base.css                   theme, layout, board and piece styles
js/core/rng.js                 mulberry32 seeded RNG
js/core/timer.js               countdown with injectable clock
js/core/store.js               versioned localStorage progress and unlock rules
js/core/score.js               efficiency and run scoring
js/core/dom.js                 tiny element helper
js/core/recorder.js            attempt log, metrics, versioned history store, migration, backup
js/core/analytics.js           stats, moving average, trend, jump detection, summaries, sample data
js/core/charts.js              plain SVG line and bar charts with tooltips and table views
js/core/analytics-page.js      the #/analytics page and the backup buttons
js/core/shell.js               router, home cards, about page
js/games/blockslide/state.js   pure board model and game session (no DOM, unit tested)
js/games/blockslide/solver.js  BFS solver, replay, hints
js/games/blockslide/gen.js     seeded generator and set configs
js/games/blockslide/explain.js step reasons, result text, strategy checklist
js/games/blockslide/coach.js   per-puzzle and run-level coaching from the move log
js/games/blockslide/stream.js  timed run puzzle stream, board symmetries, fresh puzzles, tutorial puzzle
js/games/blockslide/gen.worker.js  module worker that generates fresh puzzles during a run
js/games/blockslide/play.js    UI: menu, practice, tutorial, timed run (exam mode), coach and replay panels
data/sets/blockslide/setN.json shipped puzzles with stored optimal solutions
tools/gen.mjs                  regenerate sets
tools/verify.mjs               re-verify shipped sets
test/*.test.mjs                node:test suites
```

## Run locally

ES modules and `fetch` need http, not `file://`:

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

## Regenerate puzzle sets

```sh
node tools/gen.mjs                  # all sets, default seeds (set 5 takes a few minutes)
node tools/gen.mjs --set 3          # one set
node tools/gen.mjs --set 3 --seed 7 # one set with another seed
```

The generator draws random layouts with a seeded mulberry32 RNG and keeps a layout only if:
the ball cannot already reach the exit without moving a block (so no clear straight lane),
the BFS optimum lies in the set's band, the optimal line moves enough blocks, and it is not a duplicate.
Before writing, every set is re-checked; the tool exits non-zero and writes nothing for a set if any puzzle
is unsolvable or out of band. Seeds and bands live in `SET_CONFIGS` in `js/games/blockslide/gen.js`.
Same seed, same output: tests assert that sets 1 to 3 regenerate byte for byte.

## Verify and test

```sh
node tools/verify.mjs   # solver re-check of all shipped sets, prints a summary table
node --test test/*.test.mjs   # all unit tests, or: npm test (about 30 s, mostly re-solving sets 4 and 5)
```

Tests cover: solver optimality on hand-built boards and against an independent IDDFS, the explainer replay
(emitted steps reach the solved state in exactly `optimal` steps), every shipped set re-verified, generator
determinism, the headless game session used by the UI, scoring, storage, timer, and repo content rules
(no Unicode dashes, disclaimer in every page footer). Phase 2 adds:

* `recorder.test.mjs`: event timestamps and metrics (first-move latency, longest pause, net and gross moves), end is final,
  save and reload, run summaries, migration of unversioned data, malformed records dropped, newer-version data left
  untouched (read only), corrupt JSON kept aside, size limits, quota pruning, export, merge and replace import, backup
  parsing, progress merge.
* `coach.test.mjs`: optimal play gives no fix items, alternative optimal orders are not mistakes, wasted moves, oscillation,
  premature ball moves (and the right move after waste is not one), off-line pieces, divergence with the better move (deep
  and stored-line modes), undo and reset, latency against puzzle, set and pace baselines, skip and time-out costs, corrupt
  logs, habit ranking, run-level coaching, all shipped puzzles of sets 1 to 3, and a set 5 search budget.
* `analytics.test.mjs`: mean, median, SD, moving average (partial windows, gaps, bad windows), trend line, jump detection
  (too little history, flat history, step ups, gaps, k and window), first against last runs, day streaks across a month
  boundary, run series rates, per-set tables, the summary sentences, sample data, chart ticks.
* `stream.test.mjs`: all 8 symmetries keep the optimum and the stored line, shuffled pool per seed, fresh puzzles after the
  pool with duplicates dropped, instant variants, endless draws, fresh puzzle determinism, the tutorial puzzle.

## Deploy to GitHub Pages

1. Create a GitHub repository and push this directory to it (the default branch, for example `main`).
2. In the repository: Settings, Pages, Build and deployment, Source: "Deploy from a branch", Branch: `main`, folder `/ (root)`.
3. Wait for the Pages build, then open `https://<user>.github.io/<repo>/`.

All paths are relative, so the site works under a project subpath. `.nojekyll` disables Jekyll processing.
Run `node --test test/*.test.mjs` and `node tools/verify.mjs` before each push.
