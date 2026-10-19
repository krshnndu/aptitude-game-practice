# Legal

## No affiliation

CogPrep Arcade is an independent, free practice resource. It is not affiliated with, endorsed by, sponsored by, or connected to Aon, Capgemini, or any employer, recruiter or assessment provider. Company names are used only to describe the kind of assessment this site helps people practise for, and remain trademarks of their owners.

## Original work

All game names (Block Slide, Latin Square, Grid Memory, Operator Switch, Digit Equation, Pattern Rule), rules wording, puzzles, code and visuals in this repository are original. Puzzles are produced by the generator in `tools/gen.mjs` and checked by solvers in each game module. No content, artwork, layouts or puzzles are copied from any real assessment.

## No guarantee

Practice scores are for self-study only. They do not predict, represent or replace results in any real assessment. The software is provided as is, without warranty of any kind.

## Privacy

The site has no user accounts, third-party trackers, or marketing cookies. Progress and local move history behind the coach and analytics views are stored strictly inside the visitor's browser (`localStorage`).

To improve site usability and game balance, anonymous operational telemetry is collected via an internal, privacy-respecting endpoint:
- **Leaderboard submissions:** Each timed run that runs the full clock transmits game, set, score, puzzles solved, duration, and an anonymous client ID (`cid`), along with an optional nickname. Runs ended early (End and review, leaving the page or closing the tab) are never submitted and never ranked.
- **Anonymous site usage:** Aggregated page views, session durations, browser family, operating system, coarse screen size, coarse timezone region, input modality (touch vs mouse), referrer domain, game selections, per-item solve/hint/skip outcomes with compact did vs should codes (answer and correct answer as short game codes, first divergence step, time to divergence; no free text), learning page use (achievement views and unlocks, report views, review library opens and completed retries), run abandonment points, whether a run ended early and how (a `part` flag with the exit kind: button, navigation or page close), use of the End and review button, the Resume or review card and study mode, onboarding choices (welcome guide dismissed, Practice, Timed test or Study mode chosen from a game page, tips dismissed, skipped or turned back on), outbound link clicks, web vitals (TTFB, LCP), and client script errors.
- **Strict non-collection:** IP addresses are never written to disk or database logs. No personal names, email addresses, precise geographic coordinates, keystrokes, or raw pointer trajectories are recorded.
- **Local learning data:** The learning layer keeps everything on the device under `localStorage` keys `cogprep.progress.v1`, `cogprep.attempts.v1`, `cogprep.learn.v1`, `cogprep.resume.v1` and `cogprep.ux.v1`: attempt history, run records (including a `partial` status and exit kind for runs ended early), the last unfinished run or practice puzzle for the Resume or review card (game, set, puzzle number or run ID, counts and score so far; expires after 7 days) (including per-puzzle answer, correct answer, first divergence step and latency codes used for the "Did vs Should" comparison), review notebook entries, user-written notes, achievements progress and report snapshots, plus which one-time guides were dismissed (the welcome guide and each game's practice tips, with the time dismissed). A practice session start time is kept in `sessionStorage` (`cogprep.session.v1`) for the practice review page. None of this is uploaded.
- **Seen-puzzle list:** A local list of puzzles already shown in practice and fresh timed practice (`cogprep.seen.v1`, short hashed puzzle keys, capped at 2000) keeps freshly generated puzzles from repeating. It is never uploaded.
- **Data control:** Visitors can clear their local play history and progress anytime via the Progress page or browser cache settings.
