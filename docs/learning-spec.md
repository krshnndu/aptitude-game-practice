**CogPrep Arcade: Learning Layer Spec**

**A. Achievements (22, all from recorder data; each shows progress bar toward unlock, not just locked/unlocked)**
Mastery (per game, 6 x 1 = 6 total, same rule): *Fluent*: last 20 attempts of game: ≥85% correct AND median efficiency ≥0.9 (optimal-moves/your-moves, or time-vs-par) AND spans ≥3 distinct days. Days requirement blocks cramming.
Learning (growth, not level):
- *First Light*: first attempt where you read explain.js walkthrough after a failure (log event `explain_viewed`).
- *Lesson Learned*: a puzzle failed, re-queued, then solved correctly on next encounter (any game).
- *Habit Broken*: an error-type (from coach.js tags, e.g. "wrong operator order", "row-dup") with ≥5 occurrences in a trailing 30-attempt window drops to 0 in the following 30 attempts, same game.
- *Second Look*: 10 review-library replays completed where you solved before revealing the walkthrough.
- *Pattern Spotter*: in patternrule/latinsquare, 10 consecutive correct with decreasing median time across 3 sessions.
- *Transfer*: reach Fluent in 3 games.
- *Polymath*: Fluent in all 6.
Speed-accuracy (dissociated, so accuracy is never traded for speed):
- *Steady Hand*: 25-attempt run, ≥92% accuracy, any game.
- *Calibrated*: 30 attempts where time variance drops ≥30% while accuracy holds ≥85% (consistency, not raw speed).
- *Par Shooter*: 15 attempts at efficiency 1.0 (exactly optimal) in one game.
- *Fast Lane*: 10 correct under par time in one game, accuracy over those ≥90%.
Consistency:
- *Week One*: streak 7. *Fortnight*: 14. *Month*: 28 (streak.js; no further streak tiers, avoid grind).
- *Spacer*: practised 4 distinct days in a 7-day window, each session ≥10 attempts (spacing beats streak).
- *Comeback*: returned after ≥7 days away and completed a review queue.
Reflection:
- *Notebook*: 10 entries in mistake notebook with user-written note (≥20 chars).
- *Cleared Queue*: spaced-repetition queue reached 0 for a game.
Anti-patterns to exclude: total attempts, total time, leaderboard rank.

**B. Overall level/badge**
Game Skill Score (0-100) per game = 0.5 x accuracy(last 30) + 0.3 x median efficiency(last 30) + 0.2 x consistency (1 - coefficient of variation of time, clamped). Overall = mean of 6 GSS, each game weighted equal (incentivises breadth). Badge tiers: Novice <30, Apprentice <50, Practitioner <70, Adept <85, Master ≥85 and all six ≥70. Show the formula on the page; show delta vs 14 days ago. Never decay score silently; show "stale" marker if game untouched 14 days.

**C. Per-game report (#/report/<game>)**
1. Header: GSS, tier, trend arrow (7d/30d), attempts, distinct days.
2. Skill breakdown table: dimensions from game metrics (e.g. blockslide: planning depth, backtracks; digitequation: operator choice, carry errors; gridmemory: span, position vs content errors). Each row: current value, 30-day sparkline, target.
3. Error-type trend: stacked bar per week of coach tags; highlight top-2 recurring tags; "resolved" tags struck through.
4. Pace: time distribution histogram, par line, accuracy-by-time-bucket (reveals rushing).
5. Weak patterns: puzzle sub-features with worst accuracy (e.g. latinsquare size 5 with 2 givens; patternrule rotation+count rules). Min 5 samples before showing.
6. Practice next: 3 prescriptions, each tied to a metric ("rotation rules 40%: do 10 in review queue"), deep-links to #/review/<game>?filter=tag.
7. Strategy cheat sheet: static per-game markdown (heuristics, common traps, worked example). Keep in `games/<game>/strategy.md`, rendered inline, not generated.
8. Snapshots: report state saved as summary object (not raw attempts) weekly and on demand; list past snapshots, diff two.

**D. Review library (#/review/<game>)**
Storage: never store puzzle grids. Store `{seed, set, variant, gameVersion}`; regenerate deterministically. Add `generatorVersion` so stale seeds are flagged, not broken. Keep user path (events already in attempt) only for failed/low-efficiency attempts; for clean solves store outcome only.
Review item = `{attemptId, seed, set, tags[], note, dueAt, interval, ease, history[]}`.
Mistake notebook: auto-created on fail or efficiency <0.7; user adds note; tag suggestions from coach. Filter by tag, date, game.
Replay: three-pane: original board, your move list (step through), optimal walkthrough from explain.js. Mode 1 "Retry first": re-solve blind, then compare (default; retrieval before re-study). Mode 2 "Watch": step optimal. Show divergence point: first move where you left the optimal path.
Spaced re-queue: SM-2 lite. Intervals 1, 3, 7, 14, 30 days. Correct and efficient → next interval; correct but inefficient → repeat interval; fail → reset to 1. Cap 20 due items/day shown; oldest due first. Queue button on home with due count per game. Interleave games in a daily mixed queue (interleaving aids discrimination).

**E. Export**
Printable report: `?print=1` route variant, CSS print stylesheet, SVG charts inline, cheat sheet appended, A4. "Export report" → standalone HTML (data inlined). Keep existing JSON backup; add review items and snapshots to it. PDF via browser print only; no libraries.

**F. Caps and routes**
Review items 600 total (100/game), evict mastered (3 consecutive correct at ≥14d interval) then oldest. Snapshots 26/game (~6 months weekly). Notebook notes 200 chars. Achievements progress recomputed lazily on page open, cached with attempt count stamp. Routes: `#/achievements`, `#/report/<game>`, `#/report/<game>/snapshot/<id>`, `#/review/<game>`, `#/review/<game>/<attemptId>`, `#/review/today` (mixed queue). Guard unknown game id.

**G. Pitfalls**
- Streak tiers and attempt counts turn learning into grind; keep them minimal and bury on page.
- Composite scores hiding a speed/accuracy trade; always show both axes.
- Small-sample stats: suppress any trend under n=5 and label n everywhere.
- Storing puzzle boards blows localStorage; seeds only, version them.
- Replay revealing solution first kills retrieval benefit; retry-first must be default.
- Achievement checks scanning 1500 attempts on every event; compute on page load or after session end.
- Error tags must be stable strings across coach.js versions, or trends break.
- Generator changes silently alter old seeds; test regeneration against stored checksum of the solution.
- Overall badge punishing breadth avoiders is intended; say so in UI or it feels unfair.