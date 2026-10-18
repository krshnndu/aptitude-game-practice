// Site shell: hash router, home page game cards and the about page.
// Each route renders into <main>; a route may return a cleanup function (timers, key handlers).

import { el } from './dom.js';
import { mountBlockSlide } from '../games/blockslide/play.js';
import { mountLatinSquare } from '../games/latinsquare/play.js';
import { mountGridMemory } from '../games/gridmemory/play.js';
import { mountOperatorSwitch } from '../games/operatorswitch/play.js';
import { mountDigitEquation } from '../games/digitequation/play.js';
import { mountPatternRule } from '../games/patternrule/play.js';
import { mountAnalytics } from './analytics-page.js';

const MOUNTS = { blockslide: mountBlockSlide, latinsquare: mountLatinSquare, gridmemory: mountGridMemory, operatorswitch: mountOperatorSwitch, digitequation: mountDigitEquation, patternrule: mountPatternRule };

export const GAMES = [
  {
    id: 'blockslide',
    name: 'Block Slide',
    skill: 'Planning and spatial reasoning',
    blurb: 'Slide blocks out of the way and steer the ball to the exit in the fewest moves.',
    ready: true,
  },
  {
    id: 'latinsquare',
    name: 'Latin Square',
    skill: 'Deductive reasoning',
    blurb: 'Work out the hidden symbol from row and column rules: every symbol once per line.',
    ready: true,
  },
  {
    id: 'gridmemory',
    name: 'Grid Memory',
    skill: 'Working memory, dual task',
    blurb: 'Remember positions on a grid while answering quick side questions in between.',
    ready: true,
  },
  {
    id: 'operatorswitch',
    name: 'Operator Switch',
    skill: 'Numerical reasoning',
    blurb: 'Figure out which hidden operations turn the inputs into the outputs.',
    ready: true,
  },
  {
    id: 'digitequation',
    name: 'Digit Equation',
    skill: 'Numerical reasoning',
    blurb: 'Pick the digits that make a short equation true, against the clock.',
    ready: true,
  },
  {
    id: 'patternrule',
    name: 'Pattern Rule',
    skill: 'Inductive reasoning',
    blurb: 'Spot the rule that separates the shapes that fit from those that do not.',
    ready: true,
  },
];

function renderHome(main) {
  main.append(
    el('section', { class: 'hero' },
      el('h1', { text: 'Practice game-based aptitude tests, free' }),
      el('p', { class: 'lede' },
        'Short original puzzles in the style of modern game-based cognitive assessments. ',
        'Every puzzle has a computer-verified optimal solution, replayed step by step with the reasoning behind each move.'),
    ),
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
        ),
      ),
    ),
    el('section', { class: 'maker' },
      el('h2', { class: 'section-title', text: 'More from the maker' }),
      el('p', {}, 'CogPrep Arcade is built by Krishnendu Biswas, an IIM Ranchi student. Other things he has made:'),
      el('ul', { class: 'maker-links' },
        el('li', {}, el('a', { href: 'https://termly-iimr.vercel.app/welcome', target: '_blank', rel: 'noopener' }, 'Termly'), ': a free term planner app for IIM Ranchi MBA students. Timetable, attendance, deadlines and friends\' free slots in one screen.'),
        el('li', {}, el('a', { href: 'https://krishnendu.me', target: '_blank', rel: 'noopener' }, 'krishnendu.me'), ': projects, research and work, including AI agent systems.'),
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
      el('p', {}, 'There are no accounts, cookies, trackers or network calls beyond loading the site. Progress and your play history (the move log behind the coach and the analytics page) are saved only in your browser (localStorage). You can export, import or clear the history on the analytics page, or clear everything with your browser settings.'),
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
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  const [page, ...rest] = parts;
  for (const a of document.querySelectorAll('.site-header nav a')) {
    const target = a.getAttribute('href').replace(/^#\/?/, '');
    a.toggleAttribute('aria-current', target === (page || ''));
  }
  try {
    if (!page) renderHome(main);
    else if (page === 'about') renderAbout(main);
    else if (page === 'analytics') cleanup = mountAnalytics(main);
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
  const titles = { blockslide: 'Block Slide', latinsquare: 'Latin Square', gridmemory: 'Grid Memory', operatorswitch: 'Operator Switch', digitequation: 'Digit Equation', patternrule: 'Pattern Rule', about: 'About', analytics: 'Progress and analytics' };
  document.title = `${titles[page] ?? 'Games'} | CogPrep Arcade`;
  window.scrollTo(0, 0);
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', route);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', route);
  else route();
}
