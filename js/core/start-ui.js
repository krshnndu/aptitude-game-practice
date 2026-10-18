// Shared start screen pieces for every game: the Practice or Timed test choice, set card actions,
// the locked set explanation and the one-time coach marks shown on a game's first practice puzzle.

import { el } from './dom.js';
import { ev } from './board.js';
import { createStore, defaultStorage } from './store.js';
import { gameName } from './games.js';
import { createUxPrefs, gameStatus, recommendedSet, nextPractice, modeFromHref } from './ux.js';
import { pct, UNLOCK_THRESHOLD } from './score.js';

const store = createStore();
export const uxPrefs = () => createUxPrefs(defaultStorage());

// Plain words for the first visit to each mode. Controls stay in each game's Controls panel too.
const TIPS = {
  blockslide: {
    practice: ['Tap a piece, then an arrow (or use the arrow keys) to slide it one cell.', 'Goal: get the yellow ball out through EXIT in as few moves as you can.', 'Stuck? Hint shows the next best move. Skip shows the full solution.'],
  },
  latinsquare: {
    practice: ['Each symbol appears once in every row and every column.', 'Tap a ? cell, then tap the symbol that belongs there.', 'Wrong picks are crossed out with the reason, so you can learn and pick again.'],
  },
  gridmemory: {
    practice: ['Watch the cells light up one by one and remember the order.', 'Between cells, answer the quick side question (Yes or No).', 'At the end, tap the cells in the order they lit.'],
  },
  operatorswitch: {
    practice: ['Each box is a 4 digit code that reorders the shapes: slot 1 takes the item at the position named by the first digit, and so on.', 'Work box by box from left to right.', 'Hint walks you through one step at a time.'],
  },
  digitequation: {
    practice: ['Tap a blank, then a digit tile, until the equation is true. Then press Check.', 'x and / are worked out before + and -.', 'Hint first tells you which blank to start with, then the full step.'],
  },
  patternrule: {
    practice: ['Find the rule the top panels share that the crossed out panels break.', 'Select every candidate that follows the rule, then submit.', 'Rules use one or two features: count, shape, fill, direction, size or position.'],
  },
};

function trackMode(game, href) {
  const mode = modeFromHref(href);
  if (mode) ev('feat', game, { name: 'mode_choice', mode });
}

// Every practice, timed test or study link inside root reports which mode was chosen.
export function trackModes(root, game) {
  root.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[href]');
    if (a && root.contains(a)) trackMode(game, a.getAttribute('href'));
  });
}

// The top of a game page: breadcrumb, title, one line summary, the two mode cards, study and how to play.
// rules: nodes for the How to play panel. practiceText, timedText: what each mode does in this game.
export function gameStart({ game, idOf, lede, rules = [], practiceText, timedText, setName = (s) => `Set ${s}` }) {
  const progress = store.get();
  const status = gameStatus(progress, game);
  const first = status === 'new';
  const set = recommendedSet(progress, game);
  const k = nextPractice(progress, game, set, idOf);
  const practiceHref = `#/${game}/practice/${set}/${k}`;
  const runHref = `#/${game}/run/${set}`;
  const how = el('details', { class: 'how-to-play', id: `how-${game}` },
    el('summary', {}, 'How to play'),
    el('div', { class: 'how-body' }, rules,
      el('h3', { text: 'Practice' }), el('p', { text: practiceText }),
      el('h3', { text: 'Timed test' }), el('p', { text: timedText }),
      el('h3', { text: 'Sets and unlocking' }),
      el('p', { text: `Puzzles come in 5 sets of 10, from easy to hard. Set 1 is always open. Score ${pct(UNLOCK_THRESHOLD)} or more in a set (in its timed test, or as your practice average over all 10 puzzles) to unlock the next one.` })));
  if (first) how.open = true;
  const card = (cls, href, title, sub, body, cta, badge) =>
    el('a', { class: `mode-card ${cls}`, href },
      badge ? el('span', { class: 'badge badge-start', text: badge }) : null,
      el('span', { class: 'mode-title', text: title }),
      el('span', { class: 'mode-sub', text: sub }),
      el('span', { class: 'mode-body', text: body }),
      el('span', { class: 'mode-cta', text: cta }));
  return el('div', { class: 'game-start' },
    el('p', { class: 'crumbs' }, el('a', { href: '#/' }, 'All games'), ` / ${gameName(game)}`),
    el('div', { class: 'page-head' }, el('h1', { text: gameName(game) }), lede ? el('p', { class: 'lede', text: lede }) : null),
    el('section', { class: 'mode-choose', 'aria-label': 'Choose how to play' },
      el('h2', { class: 'section-title', text: first ? 'Start here: Practice' : 'Choose how to play' }),
      el('div', { class: 'mode-cards' },
        card('mode-practice', practiceHref, 'Practice', 'No timer, hints and solutions, learn', 'One puzzle at a time. Take as long as you need, use hints, then see the best solution step by step.', `Practise ${setName(set)}, puzzle ${k}`, first ? 'Start here' : null),
        card('mode-timed', runHref, 'Timed test', '6 min, like the real assessment', 'Puzzles keep coming until the clock ends. No hints. Your score is saved to your progress.', `Start ${setName(set)} timed test`, null)),
      el('div', { class: 'mode-more' },
        el('a', { class: 'btn', href: `#/study/${game}/${set}` }, 'Study mode: read worked solutions'),
        el('button', { type: 'button', class: 'btn', 'aria-controls': how.id, onclick: () => { how.open = true; how.scrollIntoView({ behavior: 'smooth', block: 'start' }); how.querySelector('summary').focus(); } }, 'How to play')),
      el('p', { class: 'muted small', text: `${first ? 'New here? Practice first, then take the timed test. ' : ''}Suggested: ${setName(set)}. Or pick any open set below.` })),
    how);
}

// Heading above the list of sets.
export const setListHead = () => el('h2', { class: 'section-title', text: 'All sets (levels)' });

// Big Practice and Timed test buttons for one open set, then the numbered puzzle picker.
export function setActions({ game, set, idOf, chips, unit = 'puzzle' }) {
  const k = nextPractice(store.get(), game, set, idOf);
  return el('div', { class: 'set-actions' },
    el('div', { class: 'set-buttons' },
      el('a', { class: 'btn btn-primary', href: `#/${game}/practice/${set}/${k}` }, 'Practice'),
      el('a', { class: 'btn btn-primary btn-outline', href: `#/${game}/run/${set}` }, 'Timed test (6 min)'),
      el('a', { class: 'btn btn-quiet', href: `#/study/${game}/${set}` }, 'Study mode')),
    el('p', { class: 'chips-label muted small', id: `pick-${game}-${set}`, text: `Or practise a specific ${unit} (green = solved perfectly, gold = tried):` }),
    el('div', { class: 'chips', role: 'group', 'aria-labelledby': `pick-${game}-${set}` }, chips));
}

// Why a set is locked and how to open it.
export function lockedHint(set, unit = 'puzzle', where = 'above') {
  return el('p', { class: 'locked-hint' },
    el('strong', { text: 'Locked. ' }),
    `To unlock, score ${pct(UNLOCK_THRESHOLD)} or more in Set ${set - 1}: in its timed test, or as your practice average over all 10 ${unit}s. `,
    `Want to look ahead? Tick "Unlock all sets" ${where}.`);
}

// The shared Unlock all toggle with its explanation.
export function unlockToggle(id, onChange) {
  const box = el('input', { type: 'checkbox', id, onchange: (e) => { store.setUnlockAll(e.target.checked); onChange(); } });
  box.checked = store.unlockAll();
  return el('label', { class: 'toggle', for: id, title: 'Opens every set in every game without passing the one before.' }, box, ' Unlock all sets (every game)');
}

// One-time tip panel for a game's practice screen; null once dismissed or skipped.
export function coachMark(game, mode) {
  const key = `${game}:${mode}`;
  const prefs = uxPrefs();
  if (prefs.tipSeen(key)) return null;
  const tips = TIPS[game]?.[mode];
  if (!tips) return null;
  const node = el('aside', { class: 'coach-mark callout', role: 'note', 'aria-label': 'Tips for this screen' },
    el('h2', { class: 'coach-title', text: `Quick tips: ${gameName(game)} practice` }),
    el('ul', {}, tips.map((t) => el('li', { text: t }))),
    el('div', { class: 'after-actions' },
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => { prefs.dismissTip(key); ev('feat', game, { name: 'tip_dismiss', mode }); node.remove(); } }, 'Got it'),
      el('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { prefs.skipAllTips(); ev('feat', game, { name: 'tip_skip_all' }); node.remove(); } }, 'Skip all tips')),
    el('p', { class: 'muted small', text: 'Bring tips back any time from About.' }));
  return node;
}

// One plain progress line for a set card.
export function progressLine(entry, practiceAvg) {
  const touched = (entry.runs || 0) > 0 || Object.keys(entry.practice || {}).length > 0;
  if (!touched) return el('p', { class: 'set-progress', text: 'Not started yet.' });
  const timed = entry.runs ? `Best timed test: ${pct(entry.bestAvg)} (score ${Math.round(entry.bestScore * 100) / 100})` : 'No timed test yet';
  return el('p', { class: 'set-progress', text: `${timed} | Practice average: ${pct(practiceAvg)}. Unlock bar: ${pct(UNLOCK_THRESHOLD)}.` });
}

// Full page shown when a link points at a locked set.
export function lockedPage(root, game, setNo, unit = 'puzzle') {
  root.append(el('section', { class: 'prose' },
    el('p', { class: 'crumbs' }, el('a', { href: '#/' }, 'All games'), ' / ', el('a', { href: `#/${game}` }, gameName(game)), ` / Set ${setNo}`),
    el('h1', { text: `Set ${setNo} is locked` }),
    lockedHint(setNo, unit, 'on the game page'),
    el('div', { class: 'after-actions' },
      el('a', { class: 'btn btn-primary', href: `#/${game}/practice/${setNo - 1}/1` }, `Practise Set ${setNo - 1}`),
      el('a', { class: 'btn', href: `#/${game}/run/${setNo - 1}` }, `Timed test: Set ${setNo - 1}`),
      el('a', { class: 'btn btn-quiet', href: `#/${game}` }, `Back to ${gameName(game)}`))));
}
