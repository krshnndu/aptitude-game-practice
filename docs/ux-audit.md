# UX audit (2026-10-18)

Walked every route at 390px and 1280px in headless Chrome (light and dark, first visit and returning user):
home, the six game start screens, practice, timed test, locked set, Progress, Achievements, report, review
library, today's review, study, Leaderboard, About, Admin, not found.

## Friction found

| # | Where | Problem | Fix |
|---|---|---|---|
| 1 | Game start | Practice was only reachable through unlabeled number chips 1 to 10 inside each set card; nothing said "practice here" | Two large cards at the top: Practice (no timer, hints and solutions, learn) and Timed test (6 min, like the real assessment), each opening the recommended set and puzzle; "Start here" badge for first timers |
| 2 | Game start | Rules, mode text and scoring were a wall of text above the sets; no "how to play" | Short one line summary, a How to play panel (open on first visit) with rules, modes, sets and unlocking |
| 3 | Set cards | Only one button ("Start timed run (6:00)"); chips had no label | Practice, Timed test (6 min) and Study mode buttons per set, then "Or practise a specific puzzle" with a colour key |
| 4 | Locked sets | Text faded with opacity; "average efficiency" jargon | Full contrast, dashed card, plain "Locked. To unlock, score 70%..." and a locked page with Practise / Timed test buttons for the previous set |
| 5 | Home | No first visit guidance, no status per game, every button said "Play X" | Dismissible welcome strip (3 steps), status chip (New, In progress, Mastered), continue card, suggested next step |
| 6 | Home, Today's review | Literal text "null" rendered when a card was absent | Null children filtered; review empty state now says what to do next |
| 7 | Everywhere | Jargon: "timed run", "exam mode", "set" unexplained, "n", "no trend yet (n=0, needs 5)", puzzle IDs like (bs1-01) | "Timed test" everywhere, sets explained as levels, plain column names and trend text, study items say "show the worked solution" |
| 8 | Header | Active page barely visible; Games not marked on game pages; theme button showed an icon only (tofu box where emoji fonts are missing) | Accent underline for the current page, Games active on game and study pages, "Theme: Auto" text with aria label and tooltip |
| 9 | Game start | No way back to the game list except the header | Breadcrumb "All games / Game" on every game page and locked page |
| 10 | Leaderboard | Unlabelled, unstyled native selects and input under 44px; vague empty and offline text | Labelled controls (Game, Set, Period, Nickname), 44px, clearer empty and offline states |
| 11 | Touch targets | Chips 40px, small buttons 36px, tier chips 30 to 36px, summaries, filter selects 40px, nav links | All 44px minimum |
| 12 | Analytics table | Column clipped at 390px | Scrolls inside its wrapper; shorter plain headers |
| 13 | First practice | No guidance on controls before the first move | One-time tips per game on the first practice puzzle (Got it, Skip all tips); "Show tips again" in About |

Checked and fine: keyboard focus ring (3px, visible in both themes), skip link, no horizontal page overflow,
no Unicode dashes in rendered text. Contrast of text tokens against their backgrounds: lowest 5.3:1 (light
green on white), all others 6.2:1 or more, dark theme 7.5:1 or more.

## Not changed

Admin page (operator only). Header wraps to three rows at 390px; acceptable, every item stays reachable.
