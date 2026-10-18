// Did vs should panels: the player's steps next to the optimal or correct ones, the first
// divergence highlighted, and a plain-language note. Used by result views, replays and reports.

import { el } from './dom.js';
import { ADAPTERS } from './learn-registry.js';

export function computeDvs(game, attempt, puzzle, opts = {}) {
  try {
    const fn = ADAPTERS[game]?.didVsShould;
    return fn && attempt && puzzle ? fn(attempt, puzzle, opts) : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Side-by-side table from an adapter result. opts: { title, didLabel, shouldLabel }.
export function dvsTable(r, { title = 'Did vs should', didLabel = 'You did', shouldLabel = 'Should be' } = {}) {
  if (!r) return null;
  const div = r.div ?? -1;
  return el('section', { class: 'dvs', 'aria-label': title },
    el('h3', { class: 'dvs-title', text: title }),
    el('p', { class: `callout ${div >= 0 ? 'callout-warn' : 'callout-ok'} dvs-note` },
      el('strong', { text: div >= 0 ? `First divergence at step ${div + 1}. ` : 'No divergence. ' }), r.note ?? ''),
    r.rows.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'dvs-table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Step' }), el('th', { scope: 'col', text: didLabel }), el('th', { scope: 'col', text: shouldLabel }))),
      el('tbody', {}, r.rows.map((row, i) => el('tr', { class: `${row.ok ? 'dvs-ok' : 'dvs-off'}${i === div ? ' dvs-first' : ''}` },
        el('td', {}, String(i + 1), i === div ? el('span', { class: 'badge badge-warn', text: 'first divergence' }) : null),
        el('td', { text: row.did || 'nothing' }),
        el('td', { text: row.should || 'nothing' })))))) : null);
}

// Single puzzle views can afford the deeper check (Block Slide: other optimal lines).
export function dvsPanel(game, attempt, puzzle, opts) {
  return dvsTable(computeDvs(game, attempt, puzzle, { deep: true }), opts);
}

// End of a timed run: one collapsible did vs should per puzzle, mistakes open.
// results: [{ attempt, puzzle }].
export function dvsRunSection(game, results) {
  const blocks = results.map((r, i) => {
    const d = computeDvs(game, r.attempt, r.puzzle);
    if (!d) return null;
    const wrong = d.div >= 0;
    const det = el('details', { class: 'dvs-item' },
      el('summary', {}, `Puzzle ${i + 1}: ${wrong ? `diverged at step ${d.div + 1}` : 'matched'}`),
      dvsTable(d, { title: `Puzzle ${i + 1}: did vs should` }));
    if (wrong) det.open = true;
    return det;
  }).filter(Boolean);
  if (!blocks.length) return null;
  return el('section', { class: 'dvs-run', 'aria-label': 'Did vs should per puzzle' },
    el('h3', { class: 'section-title', text: 'Did vs should, puzzle by puzzle' }), ...blocks);
}
