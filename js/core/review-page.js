// Review library: the mistake notebook per game (#/review/<game>, ?filter=<tag>) and today's mixed
// queue across games (#/review/today). Replays live in replay-page.js.

import { el } from './dom.js';
import { isGame, gameName } from './games.js';
import { ADAPTERS } from './learn-registry.js';
import { loadContext, unknownGame, gameTabs, fmtShort, pctText } from './learn-ui.js';
import { filterItems } from './notebook.js';
import { noteEditor } from './notebook-ui.js';
import { mixedQueue, dueItems, isMastered, DAILY_CAP, DAY_MS, endOfDay } from './srs.js';
import { mountReplay } from './replay-page.js';

export function mountReview(main, rest, query) {
  const [game, attemptId] = rest;
  if (game === 'today') return mountToday(main);
  if (!isGame(game)) {
    unknownGame(main, 'review');
    return () => {};
  }
  if (attemptId) return mountReplay(main, game, decodeURIComponent(attemptId), query);
  return mountNotebook(main, game, query);
}

function dueText(it, now) {
  if (it.retired) return 'retired';
  if (it.dueAt <= endOfDay(now)) return 'due today';
  const days = Math.ceil((it.dueAt - endOfDay(now)) / DAY_MS);
  return `due in ${days} ${days === 1 ? 'day' : 'days'}`;
}

function resultText(it) {
  if (it.outcome === 'solved') return `Solved at ${pctText(it.efficiency)} efficiency`;
  if (it.outcome === 'skipped') return 'Skipped or wrong';
  return it.outcome;
}

function mountNotebook(main, game, query) {
  const ctx = loadContext();
  const ad = ADAPTERS[game];
  const state = { tag: query.get('filter') || null, days: query.get('days') ? Number(query.get('days')) : null, status: query.get('status') || null };
  const root = el('div', { class: 'learn review' });
  main.append(root);

  function draw() {
    const items = ctx.store.items({ game }).sort((a, b) => a.dueAt - b.dueAt);
    const now = Date.now();
    const shown = filterItems(items, { tag: state.tag, days: state.days, status: state.status, now });
    const tags = [...new Set(items.flatMap((i) => i.tags))].sort();
    const due = dueItems(items, now).length;
    const sel = (id, label, value, options, onchange) => {
      const s = el('select', { id, onchange: (e) => onchange(e.target.value) }, options.map(([v, t]) => el('option', { value: v, text: t })));
      s.value = value;
      return el('label', { class: 'filter', for: id }, `${label} `, s);
    };
    root.replaceChildren(
      el('div', { class: 'page-head' },
        el('p', { class: 'crumbs' }, el('a', { href: '#/analytics' }, 'Progress'), ' / Review'),
        el('h1', { text: `${gameName(game)}: review library` }),
        el('p', { class: 'lede', text: 'Puzzles you failed or solved under 70% efficiency are added here automatically. Retry them blind first, then compare with the optimal solution. Spaced intervals: 1, 3, 7, 14, 30 days.' })),
      gameTabs(game, (g) => `#/review/${g}`, 'Review library by game'),
      el('div', { class: 'toolbar' },
        el('a', { class: 'btn btn-primary', href: '#/review/today' }, `Today's mixed queue`),
        el('a', { class: 'btn', href: `#/report/${game}` }, 'Report'),
        el('span', { class: 'muted' }, `${items.length} in the notebook, ${due} due today.`)),
      el('div', { class: 'toolbar', role: 'group', 'aria-label': 'Filters' },
        sel('f-tag', 'Tag', state.tag ?? '', [['', 'All tags'], ...tags.map((t) => [t, ad.tagLabel(t)])], (v) => { state.tag = v || null; draw(); }),
        sel('f-days', 'Added', state.days === null ? '' : String(state.days), [['', 'Any time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']], (v) => { state.days = v ? Number(v) : null; draw(); }),
        sel('f-status', 'Show', state.status ?? '', [['', 'All'], ['due', 'Due'], ['mastered', 'Mastered']], (v) => { state.status = v || null; draw(); })),
      shown.length
        ? el('ul', { class: 'notebook', role: 'list' }, shown.map((it) => itemCard(it, ctx, now, draw)))
        : el('p', { class: 'callout' }, items.length ? 'No entries match these filters.' : `No entries yet. Failed or inefficient ${gameName(game)} puzzles appear here after you play.`),
    );
  }
  draw();
  return () => {};
}

function itemCard(it, ctx, now, redraw) {
  const ad = ADAPTERS[it.game];
  return el('li', { class: `note-card${isMastered(it) ? ' is-mastered' : ''}` },
    el('div', { class: 'card-head' },
      el('h3', {}, el('a', { href: `#/review/${it.game}/${encodeURIComponent(it.attemptId)}` }, `Set ${it.set}, ${it.puzzleId}`)),
      el('span', { class: `badge ${it.dueAt <= endOfDay(now) ? 'badge-warn' : 'badge-soon'}`, text: dueText(it, now) })),
    el('p', { class: 'muted small' }, `${fmtShort(it.createdAt)}, ${it.mode === 'exam' ? 'timed run' : 'practice'}. ${resultText(it)}. Interval ${it.interval} ${it.interval === 1 ? 'day' : 'days'}, ${it.history.length} reviews${isMastered(it) ? ', mastered' : ''}.`),
    it.tags.length ? el('p', { class: 'small' }, it.tags.map((t) => el('span', { class: 'chip tag-chip is-on' }, ad.tagLabel(t)))) : null,
    noteEditor(it, ctx.store),
    el('div', { class: 'set-actions' },
      el('a', { class: 'btn btn-small btn-primary', href: `#/review/${it.game}/${encodeURIComponent(it.attemptId)}` }, 'Retry first'),
      el('button', {
        type: 'button', class: 'btn btn-small btn-quiet',
        onclick: () => {
          if (confirm('Remove this entry from the notebook?')) {
            ctx.store.removeItem(it.id);
            redraw();
          }
        },
      }, 'Remove')));
}

function mountToday(main) {
  const ctx = loadContext();
  const now = Date.now();
  const all = ctx.store.items();
  const queue = mixedQueue(all, now);
  const totalDue = dueItems(all, now).length;
  const root = el('div', { class: 'learn review' });
  main.append(root);
  root.append(
    el('div', { class: 'page-head' },
      el('p', { class: 'crumbs' }, el('a', { href: '#/analytics' }, 'Progress'), ' / Today\'s review'),
      el('h1', { text: 'Today\'s mixed review queue' }),
      el('p', { class: 'lede', text: `Due puzzles from every game, interleaved (switching games helps you tell the problem types apart). Oldest due first, at most ${DAILY_CAP} a day.` })),
    el('p', { role: 'status' }, totalDue
      ? `${queue.length} shown of ${totalDue} due.`
      : 'Nothing is due today. New entries arrive when you fail or play a puzzle inefficiently.'),
    queue.length
      ? el('ol', { class: 'queue', role: 'list' }, queue.map((it) => el('li', { class: 'queue-item' },
        el('span', { class: 'badge badge-soon', text: gameName(it.game) }), ' ',
        el('a', { href: `#/review/${it.game}/${encodeURIComponent(it.attemptId)}?from=today` }, `Set ${it.set}, ${it.puzzleId}`),
        el('span', { class: 'muted small' }, ` ${resultText(it)}; added ${fmtShort(it.createdAt)}${it.note ? `; note: ${it.note}` : ''}`))))
      : null,
    el('div', { class: 'toolbar' }, ...Object.keys(ADAPTERS).map((g) => el('a', { class: 'btn btn-small', href: `#/review/${g}` }, `${gameName(g)}${ctx.due[g] ? ` (${ctx.due[g]})` : ''}`))),
  );
  return () => {};
}
