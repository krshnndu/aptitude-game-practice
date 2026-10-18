// Section renderers for the per-game report (#/report/<game>), shared by the page, the print view
// and the standalone HTML export. Input is the object from report-data.js buildReport().

import { el } from './dom.js';
import { sparkline, stackedWeeks, paceHistogram } from './learn-charts.js';
import { fmtVal, WEAK_MIN } from './report-data.js';
import { table, pctText, fmtDate, deltaText } from './learn-ui.js';

const ARROW_UP = String.fromCharCode(0x2191);
const ARROW_DOWN = String.fromCharCode(0x2193);

function trendCell(t, days) {
  if (t.delta === null) return el('span', { class: 'trend trend-none' }, `${days}d: no trend yet (n=${Math.min(t.n, t.pastN)} at one end, needs 5)`);
  const dir = t.delta > 0 ? 'up' : t.delta < 0 ? 'down' : 'flat';
  return el('span', { class: `trend trend-${dir}` },
    el('span', { 'aria-hidden': 'true' }, dir === 'up' ? `${ARROW_UP} ` : dir === 'down' ? `${ARROW_DOWN} ` : ''),
    `${days}d: ${deltaText(t.delta, t.n)}`);
}

export function headerSection(r, name) {
  const h = r.header;
  return el('section', { class: 'report-header', 'aria-label': 'Summary' },
    el('div', { class: `badge-big tier-${h.tier.toLowerCase()}` },
      el('span', { class: 'badge-big-tier', text: h.n ? h.tier : 'No data' }),
      el('span', { class: 'badge-big-score', text: `${Math.round(h.gss)} / 100` })),
    el('div', {},
      el('p', { class: 'trend-row' }, trendCell(h.trend7, 7), ' ', trendCell(h.trend30, 30)),
      el('dl', { class: 'metric-strip' },
        el('div', {}, el('dt', { text: 'Accuracy' }), el('dd', { text: pctText(h.accuracy) })),
        el('div', {}, el('dt', { text: 'Median efficiency' }), el('dd', { text: pctText(h.efficiency) })),
        el('div', {}, el('dt', { text: 'Consistency' }), el('dd', { text: pctText(h.consistency) })),
        el('div', {}, el('dt', { text: 'Attempts' }), el('dd', { text: String(h.total) })),
        el('div', {}, el('dt', { text: 'Distinct days' }), el('dd', { text: String(h.days) }))),
      el('p', { class: 'muted small' },
        `${name} Game Skill Score over your last ${h.n} attempts (n=${h.n}). Accuracy and efficiency are shown separately so speed never hides a drop in accuracy.`,
        h.stale ? ' Stale: not played for 14 days or more, the score is kept as it was.' : '',
        h.lastAt ? ` Last played ${fmtDate(h.lastAt)}.` : '')));
}

export function dimsSection(r) {
  return el('section', { 'aria-labelledby': 'dims-h' },
    el('h2', { id: 'dims-h', class: 'section-title', text: 'Skill breakdown' }),
    el('p', { class: 'muted small', text: 'Current value over your last 30 attempts; the sparkline is a 7-day rolling value over the last 30 days.' }),
    table('Skill breakdown', ['Dimension', 'Current', '30-day trend', 'Target', 'Status'], r.dims.map((d) => {
      const ok = d.value === null ? null : d.better === 'high' ? d.value >= d.target : d.value <= d.target;
      return [
        d.label,
        `${fmtVal(d, d.value)} (n=${d.n})`,
        sparkline(d.spark, { label: d.label, fmt: (v) => fmtVal(d, v) }),
        `${d.better === 'high' ? 'at least' : 'at most'} ${fmtVal(d, d.target)}`,
        ok === null ? el('span', { class: 'badge badge-soon', text: 'No data' }) : el('span', { class: `badge ${ok ? 'badge-ok' : 'badge-warn'}`, text: ok ? 'On target' : 'Work on it' }),
      ];
    })));
}

export function tagsSection(r, tagLabel) {
  const w = r.weeks;
  const body = [];
  if (!r.tagCoverage) {
    body.push(el('p', { class: 'muted', text: 'No coach tags recorded yet. Tags are saved when the coach reviews a puzzle (practice, or a timed run summary), and filled in for older attempts when their puzzle can be rebuilt.' }));
  } else {
    body.push(stackedWeeks({
      rows: w.rows, top: w.tags.slice(0, 3), labelOf: tagLabel,
      title: 'Coach error tags per week',
      subtitle: `Last ${w.rows.length} weeks. The three most frequent tags are coloured, the rest are grouped as Other.`,
      resolved: w.resolved,
    }));
    body.push(el('ul', { class: 'tag-notes' },
      w.top.length ? el('li', {}, el('strong', { text: 'Recurring: ' }), ...w.top.flatMap((t, i) => [i ? ', ' : '', el('mark', { text: `${tagLabel(t)} (${w.totals[t]})` })])) : el('li', { text: 'No tag recurs across 2 or more weeks.' }),
      w.resolved.length ? el('li', {}, el('strong', { text: 'Resolved (gone for the last 2 weeks): ' }), ...w.resolved.flatMap((t, i) => [i ? ', ' : '', el('s', { text: tagLabel(t) })])) : null,
    ));
  }
  return el('section', { 'aria-labelledby': 'tags-h' },
    el('h2', { id: 'tags-h', class: 'section-title', text: 'Error types over time' }),
    el('p', { class: 'muted small', text: `Coach tags recorded for ${r.tagCoverage} of ${r.header.total} attempts.` }),
    ...body);
}

export function paceSection(r) {
  const p = r.pace;
  if (p.n < 5) {
    return el('section', { 'aria-labelledby': 'pace-h' },
      el('h2', { id: 'pace-h', class: 'section-title', text: 'Pace' }),
      el('p', { class: 'muted', text: `Not enough attempts for a pace chart yet (n=${p.n}, needs 5).` }));
  }
  const fast = p.rows[0];
  const overall = p.rows.reduce((s, x) => s + x.ok, 0) / Math.max(1, p.n);
  const rushing = fast.accuracy !== null && fast.accuracy < overall - 0.15;
  return el('section', { 'aria-labelledby': 'pace-h' },
    el('h2', { id: 'pace-h', class: 'section-title', text: 'Pace' }),
    paceHistogram({ rows: p.rows, parAfter: 1, title: 'Time per attempt against par', subtitle: `Your last ${p.n} attempts by time relative to the par for their set, with accuracy per bucket (shown from n=5).` }),
    el('p', {}, `Median time is ${p.medianRatio === null ? 'unknown' : `${p.medianRatio.toFixed(2)}x par`}.`,
      rushing ? el('strong', { text: ` Rushing: attempts under half par are ${pctText(fast.accuracy)} correct against ${pctText(overall)} overall.` }) : ''));
}

export function weakSection(r) {
  const w = r.weak;
  return el('section', { 'aria-labelledby': 'weak-h' },
    el('h2', { id: 'weak-h', class: 'section-title', text: 'Weak patterns' }),
    w.shown.length
      ? table('Weak patterns', ['Puzzle feature', 'Accuracy', 'Efficiency', 'n'], w.shown.map((x) => [x.label, pctText(x.accuracy), pctText(x.efficiency), String(x.n)]))
      : el('p', { class: 'muted', text: `No puzzle feature has ${WEAK_MIN} or more attempts yet.` }),
    w.hidden ? el('p', { class: 'muted small', text: `${w.hidden} more features have fewer than ${WEAK_MIN} attempts and are not shown.` }) : null);
}

export function practiceSection(r) {
  return el('section', { 'aria-labelledby': 'next-h' },
    el('h2', { id: 'next-h', class: 'section-title', text: 'Practice next' }),
    el('ol', { class: 'prescriptions' }, r.prescriptions.map((p) => el('li', {},
      el('p', {}, el('strong', { text: p.metric })),
      el('p', {}, p.text, ' ', el('a', { href: p.href, class: 'no-print' }, 'Go'))))));
}

export function strategySection(sheet, topTags = []) {
  return el('section', { class: 'cheat-sheet', 'aria-labelledby': 'cheat-h' },
    el('h2', { id: 'cheat-h', class: 'section-title', text: sheet.title }),
    el('h3', { text: 'Heuristics' }),
    el('ul', {}, sheet.heuristics.map((h) => el('li', { text: h }))),
    el('h3', { text: 'Common traps' }),
    el('ul', {}, sheet.traps.map((t) => el('li', { class: topTags.includes(t.tag) ? 'trap-hot' : null },
      t.text, topTags.includes(t.tag) ? el('span', { class: 'badge badge-warn', text: 'In your recent attempts' }) : null))),
    el('h3', { text: `Worked example: ${sheet.example.title}` }),
    el('p', { text: sheet.example.setup }),
    el('ol', {}, sheet.example.steps.map((s) => el('li', { text: s }))),
    el('p', {}, el('strong', { text: 'Why it works: ' }), sheet.example.lesson));
}
