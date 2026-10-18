import { mountAdmin } from './admin.js';
import { ev } from './board.js';
// Site shell: hash router, home page game cards and the about page. Learning routes:
// #/achievements, #/report/<game>[/snapshot/<id>], #/review/<game>[/<attemptId>], #/review/today.
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
import { GAMES } from './games.js';
import { mountAchievements } from './achievements-page.js';
import { mountReport } from './report-page.js';
import { mountReview } from './review-page.js';
import { loadContext, tierChip, refreshNavChip } from './learn-ui.js';

const MOUNTS = { blockslide: mountBlockSlide, latinsquare: mountLatinSquare, gridmemory: mountGridMemory, operatorswitch: mountOperatorSwitch, digitequation: mountDigitEquation, patternrule: mountPatternRule };

export { GAMES };

// Badge chip and the review queue button; never lets a learning-data problem break the home page.
function learningStrip() {
  try {
    const ctx = loadContext();
    const total = Object.values(ctx.due).reduce((a, b) => a + b, 0);
    return { ctx, node: el('section', { class: 'learn-strip', 'aria-label': 'Your learning' },
      tierChip(ctx.skill),
      el('a', { class: `btn${total ? ' btn-primary' : ''}`, href: '#/review/today' }, total ? `Review queue: ${total} due today` : 'Review queue: nothing due'),
      el('a', { class: 'btn', href: '#/achievements' }, 'Achievements'),
      el('a', { class: 'btn', href: '#/analytics' }, 'Progress and reports')) };
  } catch (err) {
    console.error(err);
    return { ctx: null, node: null };
  }
}

function renderHome(main) {
  const strip = learningStrip();
  const due = strip.ctx?.due ?? {};
  main.append(
    el('section', { class: 'hero' },
      el('h1', { text: 'Practice game-based aptitude tests, free' }),
      el('p', { class: 'lede' },
        'Short original puzzles in the style of modern game-based cognitive assessments. ',
        'Every puzzle has a computer-verified optimal solution, replayed step by step with the reasoning behind each move.'),
    ),
    strip.node,
    el('h2', { class: 'section-title', text: 'Games' }),
    el('ul', { class: 'card-grid', role: 'list' },
      GAMES.map((g) =>
        el('li', { class: `game-card${g.ready ? '' : ' is-soon'}` },
          el('div', { class: 'card-head' },
            el('h3', { text: g.name }),
            el('span', { class: `badge ${g.ready ? 'badge-ok' : 'badge-soon'}`, text: g.ready ? 'Ready' : 'Coming soon' }),
          ),
          el('p', { class: 'card-skill', text: g.skill }),
          el('p', { text: g.blurb }),
          g.ready
            ? el('a', { class: 'btn btn-primary', href: `#/${g.id}` }, `Play ${g.name}`)
            : el('span', { class: 'btn btn-disabled', 'aria-disabled': 'true' }, 'Coming soon'),
          due[g.id] ? el('a', { class: 'due-link', href: `#/review/${g.id}` }, `${due[g.id]} due for review`) : null,
        ),
      ),
    ),
    el('section', { class: 'maker' },
      el('h2', { class: 'section-title', text: 'More from the maker' }),
      el('p', {}, 'CogPrep Arcade is built by Krishnendu Biswas, an IIM Ranchi student. Other things he has made:'),
      el('ul', { class: 'maker-links' },
        el('li', {}, el('a', { href: 'https://termly-iimr.vercel.app/welcome?utm_source=cogprep&utm_medium=referral&utm_campaign=maker_links', target: '_blank', rel: 'noopener' }, 'Termly'), ': a free term planner app for IIM Ranchi MBA students. Timetable, attendance, deadlines and friends\' free slots in one screen.'),
        el('li', {}, el('a', { href: 'https://krishnendu.me/?utm_source=cogprep&utm_medium=referral&utm_campaign=maker_links', target: '_blank', rel: 'noopener' }, 'krishnendu.me'), ': projects, research and work, including AI agent systems.'),
        el('li', {}, el('a', { href: 'https://www.linkedin.com/in/krshnndu/', target: '_blank', rel: 'noopener' }, 'LinkedIn'), ' and ', el('a', { href: 'https://github.com/krshnndu', target: '_blank', rel: 'noopener' }, 'GitHub'), ': connect or follow along.'),
      ),
    ),
    el('section', { class: 'tips' },
      el('h2', { class: 'section-title', text: 'How to use this site' }),
      el('ul', {},
        el('li', {}, el('strong', { text: 'Practice mode: ' }), 'one puzzle at a time, no clock, hints available.'),
        el('li', {}, el('strong', { text: 'Timed run: ' }), 'exam mode, like the real format: 6 minutes, puzzles keep coming, no undo or hints, solve or skip and move on.'),
        el('li', {}, el('strong', { text: 'Coach: ' }), 'after each puzzle and each run, findings computed from your own moves: wasted moves, thinking time, where you left the optimal line, skip timing.'),
        el('li', {}, el('strong', { text: 'Analytics: ' }), 'score trend per run, jumps, efficiency per set, personal bests, with a JSON backup of your history.'),
        el('li', {}, el('strong', { text: 'Review and reports: ' }), 'failed or inefficient puzzles go to a mistake notebook and come back on a 1, 3, 7, 14, 30 day schedule. Retry them blind first, then compare with the optimal solution. Each game has a learning report with error trends and a strategy cheat sheet.'),
        el('li', {}, el('strong', { text: 'Progress: ' }), 'stored only in this browser. Reach 70% average efficiency to unlock the next set.'),
      ),
    ),
  );
}

function renderAbout(main) {
  main.append(
    el('section', { class: 'prose' },
      el('h1', { text: 'About and legal' }),
      el('p', {}, 'CogPrep Arcade is a free, independent practice resource for candidates preparing for game-based cognitive aptitude assessments.'),
      el('h2', { text: 'No affiliation' }),
      el('p', {}, 'This site is not affiliated with, endorsed by, sponsored by, or connected to Aon, Capgemini, or any employer, recruiter or assessment provider. Any product or company names mentioned are trademarks of their respective owners and are used only to describe the kind of assessment this site helps you practise for.'),
      el('h2', { text: 'Original work' }),
      el('p', {}, 'All game names, rules wording, puzzles, code and visuals on this site are original. Puzzles are generated by our own open source tools and checked by a solver. No content is copied from any real assessment.'),
      el('h2', { text: 'No guarantee' }),
      el('p', {}, 'Practice scores are for self-study only and do not predict or represent results in any real assessment.'),
      el('h2', { text: 'Privacy' }),
      el('p', {}, 'There are no accounts, cookies or trackers. Your move log and progress are saved in your browser (localStorage). When you finish a timed run, its score summary (game, set, score, puzzles solved, duration) is uploaded with a random ID stored in your browser, plus a nickname if you chose one, to power the leaderboard. Anonymous usage is also recorded to improve the site: pages viewed, time on page, browser and operating system, screen size, language, broad timezone region, device class, referring site, which games and sets you open, per-puzzle results (solved, skipped, hint used, time taken), where runs are abandoned, outbound link clicks, and page load speed or script errors. All of it is tied only to a random ID stored in your browser. No IP address, name, email, location, keystrokes or move log is stored. You can export, import or clear the history on the analytics page, or clear everything with your browser settings.'),
    ),
  );
}

function renderNotFound(main) {
  main.append(el('section', { class: 'prose' }, el('h1', { text: 'Page not found' }), el('p', {}, el('a', { href: '#/' }, 'Back to all games'))));
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
  const navPage = page === 'report' || page === 'review' ? 'analytics' : page || '';
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
    else if (page === 'report' || page === 'review') {
      const dispose = await (page === 'report' ? mountReport : mountReview)(main, rest, query);
      if (token !== routeToken) dispose?.();
      else cleanup = dispose ?? null;
    }
    else if (MOUNTS[page]) {
      const dispose = await MOUNTS[page](main, rest);
      // A newer navigation happened while loading: drop this view.
      if (token !== routeToken) dispose();
      else cleanup = dispose;
    }
    else renderNotFound(main);
  } catch (err) {
    console.error(err);
    main.replaceChildren(el('p', { class: 'notice' }, `Something went wrong: ${err.message}`));
  }
  const titles = { blockslide: 'Block Slide', latinsquare: 'Latin Square', gridmemory: 'Grid Memory', operatorswitch: 'Operator Switch', digitequation: 'Digit Equation', patternrule: 'Pattern Rule', about: 'About', analytics: 'Progress and analytics', board: 'Leaderboard', achievements: 'Achievements', report: 'Learning report', review: 'Review library', admin: 'Site Operations & Analytics' };
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
    btn.textContent = t === 'dark' ? '🌙 Dark' : t === 'light' ? '☀️ Light' : '🌓 Auto';
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
