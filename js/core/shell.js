import { mountAdmin } from './admin.js';
import { ev } from './board.js';
// Site shell: hash router, home page game cards and the about page. Learning routes:
// #/achievements, #/report/<game>[/snapshot/<id>], #/review/<game>[/<attemptId>], #/review/today,
// #/review/<game>/run/<runId>, #/review/<game>/practice/<set> and study mode #/study/<game>/<set>.
// A query after the hash (#/review/blockslide?filter=wasted) or before it (?print=1) reaches the page.
// Each route renders into <main>; a route may return a cleanup function (timers, key handlers).

import { el } from './dom.js';
import { mountBlockSlide } from '../games/blockslide/play.js';
import { mountLatinSquare } from '../games/latinsquare/play.js';
import { mountGridMemory } from '../games/gridmemory/play.js';
import { mountOperatorSwitch } from '../games/operatorswitch/play.js';
import { mountDigitEquation } from '../games/digitequation/play.js';
import { mountPatternRule } from '../games/patternrule/play.js';
import { mountAnalytics } from './analytics-page.js';
import { startBoard, mountBoard, track } from './board.js';
import { GAMES, gameName } from './games.js';
import { mountAchievements } from './achievements-page.js';
import { mountReport } from './report-page.js';
import { mountReview } from './review-page.js';
import { loadContext, refreshNavChip } from './learn-ui.js';
import { mountStudy } from './study-page.js';
import { resume } from './endrun-ui.js';
import { resumeActions } from './partial.js';
import { createStore } from './store.js';
import { gameStatus, STATUS_LABEL } from './ux.js';
import { uxPrefs, coachMark } from './start-ui.js';

const MOUNTS = { blockslide: mountBlockSlide, latinsquare: mountLatinSquare, gridmemory: mountGridMemory, operatorswitch: mountOperatorSwitch, digitequation: mountDigitEquation, patternrule: mountPatternRule };

export { GAMES };

const TERMLY_HOME_URL = 'https://termly-iimr.vercel.app/welcome?utm_source=cogprep&utm_medium=referral&utm_campaign=maker_links';

function safeNode(fn) {
  try {
    return fn();
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Where a returning player picks up: the unfinished run or puzzle if there is one, else the last game played.
function continueTarget(ctx) {
  const entry = resume().last();
  const act = resumeActions(entry);
  if (act && GAMES.some((g) => g.id === entry.game)) {
    const name = gameName(entry.game);
    return act.resumeHref
      ? { game: entry.game, kind: entry.kind, href: act.resumeHref, text: `${name}, set ${entry.set}, puzzle ${entry.k}` }
      : { game: entry.game, kind: `${entry.kind}_review`, href: act.reviewHref, text: `Review ${name} timed test, set ${entry.set}` };
  }
  const last = (ctx?.attempts ?? []).reduce((m, a) => (!m || (a.startedAt ?? 0) > (m.startedAt ?? 0) ? a : m), null);
  if (!last || !GAMES.some((g) => g.id === last.game)) return null;
  return { game: last.game, kind: 'last', href: `#/${last.game}`, text: `${gameName(last.game)}, set ${last.set ?? 1}` };
}

function renderHome(main) {
  const ctx = safeNode(loadContext);
  const due = ctx?.due ?? {};
  const dueTotal = Object.values(due).reduce((a, b) => a + b, 0);
  const progress = safeNode(() => createStore().get());
  const statusOf = (id) => safeNode(() => gameStatus(progress, id, { attempts: ctx?.byGame?.[id]?.length ?? 0 })) ?? 'new';
  const cont = safeNode(() => continueTarget(ctx));
  const first = GAMES.find((g) => g.ready);
  const played = (ctx?.attempts?.length ?? 0) > 0;
  const cta = cont
    ? el('a', { class: 'btn btn-primary btn-hero', href: cont.kind === 'last' || cont.kind.endsWith('_review') ? `#/${cont.game}` : cont.href, onclick: () => ev('feat', 'home', { name: 'hero_continue', game: cont.game }) }, `Continue ${gameName(cont.game)}`)
    : el('a', { class: 'btn btn-primary btn-hero', href: `#/${first.id}/practice/1/1`, onclick: () => ev('feat', 'home', { name: 'hero_start', game: first.id }) }, 'Start practicing');
  main.append(...[
    el('section', { class: 'hero' },
      el('h1', { text: 'Game-based aptitude practice. Free.' }),
      el('p', { class: 'hero-sub', text: 'Capgemini and Aon style games. No account. Start in 10 seconds.' }),
      cta,
      played ? null : el('p', { class: 'muted small hero-hint', text: 'Pick a game, play 3 minutes, see your score.' })),
    cont || dueTotal ? el('p', { class: 'resume-row' },
      el('strong', { text: 'Resume: ' }),
      cont ? el('a', { href: cont.href, onclick: () => ev('feat', cont.game, { name: 'resume', kind: cont.kind }) }, cont.text) : null,
      dueTotal ? el('a', { class: 'due-chip', href: '#/review/today' }, `${dueTotal} due for review`) : null) : null,
    el('h2', { class: 'sr-only', text: 'Games' }),
    el('ul', { class: 'card-grid', role: 'list' },
      GAMES.map((g) => {
        const st = statusOf(g.id);
        const inner = [
          el('span', { class: 'card-name', text: g.name }),
          el('span', { class: 'badge badge-skill', text: g.tag }),
          !g.ready ? el('span', { class: 'badge badge-soon', text: 'Soon' })
            : st !== 'new' ? el('span', { class: `status-dot is-${st}`, title: STATUS_LABEL[st] }, el('span', { class: 'sr-only', text: STATUS_LABEL[st] })) : null,
          g.ready && due[g.id] ? el('span', { class: 'due-chip', text: `${due[g.id]} due` }) : null,
        ];
        return el('li', {}, g.ready
          ? el('a', { class: 'game-card', href: `#/${g.id}`, 'aria-label': `Open ${g.name}` }, inner)
          : el('div', { class: 'game-card is-soon' }, inner));
      }),
    ),
    el('p', { class: 'muted small maker-line' }, 'Also by the maker: ', el('a', { href: TERMLY_HOME_URL, target: '_blank', rel: 'noopener' }, 'Termly'), ', a term planner'),
  ].filter(Boolean));
}

function renderAbout(main) {
  const tipsBtn = el('button', { type: 'button', class: 'btn', onclick: () => {
    uxPrefs().resetTips();
    ev('feat', 'about', { name: 'tips_reset' });
    tipsBtn.textContent = 'Tips will show again';
    tipsBtn.disabled = true;
  } }, 'Show tips again');
  main.append(
    el('section', { class: 'prose' },
      el('h1', { text: 'About and legal' }),
      el('p', {}, 'CogPrep Arcade is a free, independent practice resource for candidates preparing for game-based cognitive aptitude assessments.'),
      el('p', { id: 'disclaimer' }, el('strong', { text: 'Independent practice.' }), ' This site is not affiliated with, endorsed by, or connected to Aon, Capgemini or any employer or assessment provider. All game names, puzzles, code and visuals are original. Scores here do not predict results in any real assessment.'),
      el('h2', { text: 'How it works' }),
      el('ul', {},
        el('li', {}, el('strong', { text: 'Practice: ' }), 'one puzzle at a time, no clock, hints on.'),
        el('li', {}, el('strong', { text: 'Timed test: ' }), '6 minutes like the real thing, no hints, scored.'),
        el('li', {}, el('strong', { text: 'Study: ' }), 'browse every puzzle in a set with its solution.'),
        el('li', {}, el('strong', { text: 'Coach: ' }), 'feedback from your own moves after each puzzle and run.'),
        el('li', {}, el('strong', { text: 'Progress: ' }), 'score trends, personal bests and a backup of your history.'),
        el('li', {}, el('strong', { text: 'Review: ' }), 'missed puzzles come back on a 1, 3, 7, 14, 30 day schedule.'),
        el('li', {}, el('strong', { text: 'Sets: ' }), '5 levels of 10 puzzles per game. Score 70% to unlock the next.'),
      ),
      el('h2', { text: 'Tips' }),
      el('p', {}, 'Hid a game tip too soon? Bring them all back.'),
      el('p', {}, tipsBtn),
      el('h2', { text: 'Made by' }),
      el('p', {}, 'Krishnendu Biswas, an IIM Ranchi student. ',
        el('a', { href: 'https://krishnendu.me/?utm_source=cogprep&utm_medium=referral&utm_campaign=maker_links', target: '_blank', rel: 'noopener' }, 'krishnendu.me'), ', ',
        el('a', { href: 'https://www.linkedin.com/in/krshnndu/', target: '_blank', rel: 'noopener' }, 'LinkedIn'), ', ',
        el('a', { href: 'https://github.com/krshnndu', target: '_blank', rel: 'noopener' }, 'GitHub'), '.'),
      el('h2', { text: 'No affiliation' }),
      el('p', {}, 'This site is not affiliated with, endorsed by, sponsored by, or connected to Aon, Capgemini, or any employer, recruiter or assessment provider. Any product or company names mentioned are trademarks of their respective owners and are used only to describe the kind of assessment this site helps you practise for.'),
      el('h2', { text: 'Original work' }),
      el('p', {}, 'All game names, rules wording, puzzles, code and visuals on this site are original. Puzzles are generated by our own open source tools and checked by a solver. No content is copied from any real assessment.'),
      el('h2', { text: 'No guarantee' }),
      el('p', {}, 'Practice scores are for self-study only and do not predict or represent results in any real assessment.'),
      el('h2', { text: 'Privacy' }),
      el('p', {}, 'There are no accounts, cookies or trackers. Your move log and progress are saved in your browser (localStorage). When a timed test reaches the end of its clock, its score summary (game, set, score, puzzles solved, duration) is uploaded with a random ID stored in your browser, plus a nickname if you chose one, to power the leaderboard. Runs you end early, or leave by changing page or closing the tab, are saved only in your browser and never uploaded or ranked. Anonymous usage is also recorded to improve the site: pages viewed, time on page, browser and operating system, screen size, language, broad timezone region, device class, referring site, which games and sets you open, per-puzzle results (solved, skipped, hint used, time taken, and short did vs should codes: your answer and the correct answer as game codes, the step where you first diverged and the time to it), learning page use (achievements viewed or unlocked, reports viewed, review library opened and retries completed), where runs are abandoned, whether a run ended early and how (button, navigation or page close), use of the End and review button, the resume row and study mode, onboarding choices (home start button, Practice, Timed test or Study mode chosen, tips dismissed or turned back on, the result screen Termly note shown or hidden), outbound link clicks, and page load speed or script errors. All of it is tied only to a random ID stored in your browser. No IP address, name, email, location, keystrokes, move log or note text is stored. The learning layer (review notebook, your notes, achievements, report snapshots, the did vs should record kept with each attempt, runs ended early, the last unfinished run or puzzle behind the resume row, and which tips you dismissed) stays in your browser and is never uploaded. You can export, import or clear the history on the analytics page, or clear everything with your browser settings.'),
    ),
  );
}

function renderNotFound(main) {
  main.append(el('section', { class: 'prose' }, el('h1', { text: 'Page not found' }), el('p', {}, 'That link does not match a page here.'), el('p', {}, el('a', { class: 'btn btn-primary', href: '#/' }, 'Back to all games'))));
}

let cleanup = null;
let routeToken = 0;

async function route() {
  const token = ++routeToken;
  if (cleanup) {
    try {
      cleanup();
    } catch (err) {
      console.error(err);
    }
    cleanup = null;
  }
  const main = document.getElementById('main');
  main.replaceChildren();
  const raw = location.hash.replace(/^#\/?/, '') || '';
  const qi = raw.indexOf('?');
  const query = new URLSearchParams(location.search);
  if (qi >= 0) for (const [k, v] of new URLSearchParams(raw.slice(qi + 1))) query.set(k, v);
  const parts = (qi >= 0 ? raw.slice(0, qi) : raw).split('/').filter(Boolean);
  const [page, ...rest] = parts;
  // Reports and the review library live under Progress in the nav.
  const navPage = page === 'report' || page === 'review' ? 'analytics' : page === 'study' || MOUNTS[page] ? '' : page || '';
  for (const a of document.querySelectorAll('.site-header nav > a')) {
    const target = a.getAttribute('href').replace(/^#\/?/, '');
    a.toggleAttribute('aria-current', target === navPage);
  }
  try {
    if (!page) renderHome(main);
    else if (page === 'about') renderAbout(main);
    else if (page === 'analytics') cleanup = mountAnalytics(main);
    else if (page === 'board') cleanup = mountBoard(main);
    else if (page === 'admin') cleanup = mountAdmin(main);
    else if (page === 'achievements') cleanup = mountAchievements(main);
    else if (page === 'report' || page === 'review' || page === 'study') {
      const dispose = await (page === 'report' ? mountReport : page === 'study' ? mountStudy : mountReview)(main, rest, query);
      if (token !== routeToken) dispose?.();
      else cleanup = dispose ?? null;
    }
    else if (MOUNTS[page]) {
      const dispose = await MOUNTS[page](main, rest);
      // A newer navigation happened while loading: drop this view.
      if (token !== routeToken) dispose();
      else {
        cleanup = dispose;
        // The timed test has its own Before you start screen, so tips go on practice only.
        const tip = rest[0] === 'practice' && !main.querySelector('.locked-hint') ? safeNode(() => coachMark(page, 'practice')) : null;
        if (tip) main.prepend(tip);
      }
    }
    else renderNotFound(main);
  } catch (err) {
    console.error(err);
    main.replaceChildren(el('p', { class: 'notice' }, `Something went wrong: ${err.message}. `, el('a', { href: '#/' }, 'Back to all games')));
  }
  const titles = { blockslide: 'Block Slide', latinsquare: 'Latin Square', gridmemory: 'Grid Memory', operatorswitch: 'Operator Switch', digitequation: 'Digit Equation', patternrule: 'Pattern Rule', about: 'About', analytics: 'Progress and analytics', board: 'Leaderboard', achievements: 'Achievements', report: 'Learning report', review: 'Review library', study: 'Study mode', admin: 'Site Operations & Analytics' };
  track(page);
  refreshNavChip();
  document.title = `${titles[page] ?? 'Games'} | CogPrep Arcade`;
  window.scrollTo(0, 0);
}


function initTheme() {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const K_THEME = 'cogprep.theme.v1';
  const getTheme = () => {
    try { return localStorage.getItem(K_THEME) || 'system'; } catch { return 'system'; }
  };
  const updateLabel = (t) => {
    const name = t === 'dark' ? 'Dark' : t === 'light' ? 'Light' : 'Auto';
    btn.textContent = `Theme: ${name}`;
    btn.setAttribute('aria-label', `Color theme: ${name}. Click to change.`);
    btn.title = 'Switch between Auto (follows your device), Dark and Light';
  };
  updateLabel(getTheme());
  btn.addEventListener('click', () => {
    const cur = getTheme();
    const next = cur === 'system' ? 'dark' : cur === 'dark' ? 'light' : 'system';
    try {
      if (next === 'system') {
        localStorage.removeItem(K_THEME);
        document.documentElement.removeAttribute('data-theme');
      } else {
        localStorage.setItem(K_THEME, next);
        document.documentElement.setAttribute('data-theme', next);
      }
    } catch {}
    updateLabel(next);
    ev('toggle_theme', 'shell', { theme: next });
  });
}

if (typeof window !== 'undefined') {
  initTheme();
  window.addEventListener('hashchange', route);
  startBoard();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', route);
  else route();
}
