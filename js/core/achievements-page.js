// Achievements page (#/achievements): the overall badge with its formula, one skill card per game,
// and the achievement grid with progress bars. Streak achievements sit last on purpose.

import { el } from './dom.js';
import { loadContext, achievementsFor, GAMES, FORMULA, pctText, fmtDate, deltaText } from './learn-ui.js';
import { progressBar } from './learn-charts.js';
import { MIN_N } from './skill.js';

const GROUP_ORDER = ['Learning', 'Mastery', 'Speed and accuracy', 'Reflection', 'Consistency'];

export function mountAchievements(main) {
  const ctx = loadContext();
  const { skill } = ctx;
  const { list, newly } = achievementsFor(ctx);
  const root = el('div', { class: 'learn achievements' });
  main.append(root);

  root.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Achievements and skill' }),
      el('p', { class: 'lede', text: 'Computed from your own play history in this browser. Achievements reward learning and spaced practice, never total attempts or time spent.' })),
  );
  if (newly.length) {
    root.append(el('p', { class: 'callout callout-ok', role: 'status' },
      el('strong', { text: 'Unlocked: ' }), list.filter((a) => newly.includes(a.id)).map((a) => a.name).join(', '), '.'));
  }

  const next = skill.next;
  root.append(
    el('section', { class: 'badge-panel', 'aria-labelledby': 'overall-h' },
      el('div', { class: `badge-big tier-${skill.tier.toLowerCase()}` },
        el('span', { class: 'badge-big-tier', text: skill.tier }),
        el('span', { class: 'badge-big-score', text: `${Math.round(skill.overall)} / 100` })),
      el('div', {},
        el('h2', { id: 'overall-h', text: 'Overall badge' }),
        el('p', {}, el('strong', { text: 'Change vs 14 days ago: ' }), deltaText(skill.delta, skill.n), '.'),
        next ? el('p', {}, `Next: ${next.name} at ${next.at}${next.needsAll70 ? ', with every game at 70 or more' : ''}.`) : el('p', { text: 'Top tier reached.' }),
        el('p', { class: 'formula' }, el('strong', { text: 'How it is computed. ' }), FORMULA),
        el('p', { class: 'muted small', text: 'Tiers: Novice under 30, Apprentice under 50, Practitioner under 70, Adept under 85, Master at 85 or more with all six games at 70 or more. Because all six games count equally, skipping a game holds the badge back. That is intended: breadth is part of the skill.' }),
        el('p', { class: 'muted small', text: `Scores never decay silently: a game untouched for 14 days is marked stale instead. Trends need at least ${MIN_N} attempts and show n.` }))),
  );

  root.append(el('h2', { class: 'section-title', text: 'Skill per game' }),
    el('ul', { class: 'skill-grid', role: 'list' }, skill.cards.map((c) => skillCard(c, ctx.due[c.game] ?? 0))));

  const groups = GROUP_ORDER.map((g) => ({ g, items: list.filter((a) => a.group === g) }));
  const unlockedCount = list.filter((a) => a.unlocked).length;
  root.append(el('h2', { class: 'section-title', text: `Achievements (${unlockedCount} of ${list.length})` }));
  for (const { g, items } of groups) {
    root.append(
      el('h3', { class: 'ach-group', text: g }),
      el('ul', { class: 'ach-grid', role: 'list' }, items.map(achCard)),
    );
  }
  return () => {};
}

function skillCard(c, due) {
  const name = GAMES.find((g) => g.id === c.game)?.name ?? c.game;
  return el('li', { class: `skill-card${c.stale ? ' is-stale' : ''}` },
    el('div', { class: 'card-head' },
      el('h3', { text: name }),
      c.stale ? el('span', { class: 'badge badge-soon', text: 'Stale', title: 'Not played for 14 days or more' }) : null),
    el('p', { class: 'skill-score' }, el('strong', { text: c.n ? String(Math.round(c.score)) : 'none' }), c.n ? ` ${c.tier}` : ' not played yet'),
    el('dl', { class: 'metric-strip' },
      el('div', {}, el('dt', { text: 'Accuracy' }), el('dd', { text: pctText(c.accuracy) })),
      el('div', {}, el('dt', { text: 'Median efficiency' }), el('dd', { text: pctText(c.efficiency) })),
      el('div', {}, el('dt', { text: 'Consistency' }), el('dd', { text: pctText(c.consistency) })),
      el('div', {}, el('dt', { text: 'n' }), el('dd', { text: String(c.n) }))),
    el('p', { class: 'muted small' }, `14-day change: ${deltaText(c.delta, Math.min(c.n, c.pastN))}`, c.lastAt ? `. Last played ${fmtDate(c.lastAt)}.` : '.'),
    el('div', { class: 'set-actions' },
      el('a', { class: 'btn btn-small', href: `#/report/${c.game}` }, 'Report'),
      el('a', { class: 'btn btn-small', href: `#/review/${c.game}` }, due ? `Review (${due} due)` : 'Review')));
}

function achCard(a) {
  return el('li', { class: `ach-card${a.unlocked ? ' is-unlocked' : ''}` },
    el('div', { class: 'card-head' },
      el('h4', { text: a.name }),
      el('span', { class: `badge ${a.unlocked ? 'badge-ok' : 'badge-soon'}`, text: a.unlocked ? 'Unlocked' : 'Locked' })),
    el('p', { class: 'ach-desc', text: a.desc }),
    progressBar(a.progress, a.name),
    el('p', { class: 'muted small', text: a.unlocked && a.unlockedAt ? `Unlocked ${fmtDate(a.unlockedAt)}.` : a.hint }));
}
