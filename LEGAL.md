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
- **Leaderboard submissions:** Each completed timed run transmits game, set, score, puzzles solved, duration, and an anonymous client ID (`cid`), along with an optional nickname.
- **Anonymous site usage:** Aggregated page views, session durations, browser family, operating system, coarse screen size, coarse timezone region, input modality (touch vs mouse), referrer domain, game selections, per-item solve/hint/skip outcomes with compact did vs should codes (answer and correct answer as short game codes, first divergence step, time to divergence; no free text), learning page use (achievement views and unlocks, report views, review library opens and completed retries), run abandonment points, outbound link clicks, web vitals (TTFB, LCP), and client script errors.
- **Strict non-collection:** IP addresses are never written to disk or database logs. No personal names, email addresses, precise geographic coordinates, keystrokes, or raw pointer trajectories are recorded.
- **Local learning data:** The learning layer keeps everything on the device under `localStorage` keys `cogprep.progress.v1`, `cogprep.attempts.v1` and `cogprep.learn.v1`: attempt history (including per-puzzle answer, correct answer, first divergence step and latency codes used for the "Did vs Should" comparison), review notebook entries, user-written notes, achievements progress and report snapshots. None of this is uploaded.
- **Data control:** Visitors can clear their local play history and progress anytime via the Progress page or browser cache settings.
