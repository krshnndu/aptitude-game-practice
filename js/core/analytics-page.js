// Progress and analytics page (#/analytics): summary, charts, personal bests, per-set progress and
// the JSON backup. Math lives in analytics.js; drawing in charts.js.

import { el } from './dom.js';
import { createRecorder, makeBackup, parseBackup } from './recorder.js';
import { createStore } from './store.js';
import { lineChart, barChart } from './charts.js';
import {
  runSeries, movingAverage, linearTrend, detectJumps, efficiencyBySet, personalBests, setProgress,
  summaryLines, dayStreak, sampleData,
} from './analytics.js';
import { pct } from './score.js';
import { learnStore } from './learn-hooks.js';
import { loadContext, tierChip, deltaText, table as nodeTable, gameName } from './learn-ui.js';

const SETS = [1, 2, 3, 4, 5];
const fmtSec = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '');
const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtPct = (x) => (Number.isFinite(x) ? pct(x) : '');

export function mountAnalytics(main) {
  const recorder = createRecorder();
  const store = createStore();
  const root = el('div', { class: 'analytics' });
  main.append(root);
  const state = { sample: false, set: 'all' };

  function draw() {
    root.replaceChildren();
    const real = recorder.load();
    const empty = !real.runs.length && !real.attempts.length;
    const data = state.sample ? sampleData() : real;

    root.append(
      el('div', { class: 'page-head' },
        el('h1', { text: 'Progress and analytics' }),
        el('p', { class: 'lede', text: 'Every attempt is recorded in this browser only. Charts and coaching are computed from your own play log.' }),
      ),
    );
    if (recorder.problem) root.append(el('p', { class: 'callout callout-warn', text: recorder.problem }));
    if (!state.sample) root.append(learningSection());

    if (empty || state.sample) {
      const toggle = el('input', {
        type: 'checkbox',
        id: 'sample-toggle',
        onchange: (e) => {
          state.sample = e.target.checked;
          draw();
        },
      });
      toggle.checked = state.sample;
      root.append(
        el('div', { class: `callout${state.sample ? ' callout-sample' : ''}` },
          empty && !state.sample
            ? el('p', {}, el('strong', { text: 'No play recorded yet. ' }), 'Finish a practice puzzle or a timed run and your charts appear here. ', el('a', { href: '#/blockslide' }, 'Play Block Slide'))
            : null,
          state.sample ? el('p', {}, el('span', { class: 'badge badge-sample', text: 'SAMPLE DATA' }), ' Everything below is generated sample data, not your results.') : null,
          el('label', { class: 'toggle', for: 'sample-toggle' }, toggle, ' Show sample data'),
        ),
      );
      if (!state.sample) {
        root.append(backupSection(recorder, store, draw));
        return;
      }
    }

    const setsWithRuns = SETS.filter((k) => data.runs.some((r) => r.set === k));
    const filterSet = state.set === 'all' ? null : Number(state.set);
    const runs = data.runs.filter((r) => filterSet === null || r.set === filterSet);
    const attempts = data.attempts.filter((a) => filterSet === null || a.set === filterSet);

    const select = el('select', {
      id: 'set-filter',
      onchange: (e) => {
        state.set = e.target.value;
        draw();
      },
    }, el('option', { value: 'all', text: 'All sets' }), SETS.map((k) => el('option', { value: String(k), text: `Set ${k}${setsWithRuns.includes(k) ? '' : ' (no runs)'}` })));
    select.value = state.set;
    root.append(el('div', { class: 'toolbar' }, el('label', { class: 'filter', for: 'set-filter' }, 'Show ', select)));

    const lines = summaryLines({ runs: data.runs, attempts: data.attempts, filterSet });
    root.append(
      el('section', { class: 'summary callout', 'aria-label': 'Summary' },
        el('h2', { text: state.sample ? 'Summary (sample data)' : 'Summary' }),
        lines.length ? el('ul', {}, lines.map((t) => el('li', { text: t }))) : el('p', { text: 'Play a timed run to see your trend.' }),
      ),
    );

    const series = runSeries(runs);
    const streak = dayStreak([...data.attempts.map((a) => a.startedAt), ...data.runs.map((r) => r.endedAt)]);
    const best = series.reduce((b, r) => (!b || r.score > b.score ? r : b), null);
    root.append(
      el('div', { class: 'score-tiles' },
        tile('Timed runs', String(series.length)),
        tile('Puzzle attempts', String(attempts.length)),
        tile('Current streak', `${streak.current} ${streak.current === 1 ? 'day' : 'days'}`),
        tile('Best run score', best ? best.score.toFixed(2) : 'none'),
      ),
    );

    const charts = el('div', { class: 'viz-board' });
    if (series.length) {
      const scores = series.map((r) => r.score);
      const ma = movingAverage(scores, 5);
      const trend = linearTrend(scores);
      const jumps = detectJumps(scores).filter((j) => j.jump);
      const labels = series.map((r) => String(r.n));
      const xDetail = (i) => `(${fmtDate(series[i].at)}, set ${series[i].set})`;
      charts.append(
        lineChart({
          title: 'Score per timed run',
          subtitle: `Dots are runs; ${jumps.length ? `"jump" marks a run more than 1 standard deviation above your previous best or recent average` : 'a "jump" label appears when a run beats your recent level by more than 1 standard deviation'}.`,
          xLabels: labels,
          xDetail,
          series: [
            { name: 'Score', values: scores, color: 'var(--series-1)', mode: 'both' },
            { name: '5-run moving average', values: ma, color: 'var(--series-2)', mode: 'line' },
            { name: 'Trend line', values: scores.map((_, i) => trend.at(i)), color: 'var(--series-3)', mode: 'line' },
          ],
          yFormat: (v) => v.toFixed(v >= 10 || Number.isInteger(v) ? 0 : 1),
          markers: jumps.map((j) => ({ index: j.index, label: 'jump', detail: `Jump: ${j.reasons.includes('best') ? 'beat the previous best' : 'beat the recent average'} by more than 1 SD (${j.sd.toFixed(2)})` })),
          tableColumns: ['Run', 'Date', 'Set', 'Score', 'Moving avg', 'Trend', 'Jump'],
          tableRows: series.map((r, i) => [r.n, fmtDate(r.at), r.set, r.score.toFixed(2), ma[i]?.toFixed(2) ?? '', trend.at(i).toFixed(2), jumps.some((j) => j.index === i) ? 'jump' : '']),
        }),
        barChart({
          title: 'Puzzles solved per run',
          subtitle: 'Solved puzzles in each 6:00 run.',
          bars: series.map((r) => ({ label: String(r.n), value: r.solved, detail: `${r.attempted} reached, set ${r.set}` })),
          yFormat: (v) => String(Math.round(v)),
          tableColumns: ['Run', 'Solved', 'Reached'],
          tableRows: series.map((r) => [r.n, r.solved, r.attempted]),
        }),
        lineChart({
          title: 'Average first-move latency per run',
          subtitle: 'Thinking time before the first move, averaged over the puzzles in a run. Lower is quicker planning.',
          xLabels: labels,
          xDetail,
          series: [{ name: 'First move', values: series.map((r) => r.avgFirstMoveMs), color: 'var(--series-1)', mode: 'both' }],
          yMin: 0,
          yFormat: (v) => `${(v / 1000).toFixed(v < 10000 ? 1 : 0)} s`,
        }),
        lineChart({
          title: 'Skip rate and wasted-move rate per run',
          subtitle: 'Skip rate: skipped / puzzles reached. Wasted-move rate: moves beyond the optimum / all moves on solved puzzles.',
          xLabels: labels,
          xDetail,
          series: [
            { name: 'Skip rate', values: series.map((r) => r.skipRate), color: 'var(--series-1)', mode: 'both' },
            { name: 'Wasted-move rate', values: series.map((r) => r.wastedRate), color: 'var(--series-2)', mode: 'both' },
          ],
          yMin: 0,
          yFormat: (v) => pct(v),
        }),
      );
    } else {
      charts.append(el('p', { class: 'muted', text: 'No timed runs yet for this filter. Run charts appear after your first 6:00 run.' }));
    }
    const effSets = efficiencyBySet(data.attempts, filterSet === null ? SETS : [filterSet]);
    charts.append(
      barChart({
        title: 'Efficiency per set',
        subtitle: 'Average efficiency (optimal / your moves, 0 for skips) over all attempts, practice and timed.',
        bars: effSets.map((e) => ({ label: `Set ${e.set}`, value: e.efficiency, detail: `${e.attempts} attempts` })),
        yMax: 1,
        yFormat: (v) => pct(v),
        tableColumns: ['Set', 'Attempts', 'Solved', 'Efficiency', 'Efficiency when solved'],
        tableRows: effSets.map((e) => [e.set, e.attempts, e.solved, fmtPct(e.efficiency), fmtPct(e.solvedEfficiency)]),
      }),
    );
    root.append(el('h2', { class: 'section-title', text: 'Charts' }), charts);

    const pbs = personalBests(data.runs, data.attempts, filterSet === null ? SETS : [filterSet]);
    root.append(
      el('h2', { class: 'section-title', text: 'Personal bests' }),
      table('Personal bests per set',
        ['Set', 'Runs', 'Best run score', 'Date', 'Most solved in a run', 'Fastest optimal solve', 'Quickest avg first move'],
        pbs.map((b) => [b.set, b.runs, b.bestScore?.toFixed(2) ?? '', b.bestScoreAt ? fmtDate(b.bestScoreAt) : '', b.mostSolved ?? '', fmtSec(b.fastestPerfectMs), fmtSec(b.quickestAvgFirstMoveMs)])),
    );

    const prog = setProgress(data.runs, data.attempts, filterSet === null ? SETS : [filterSet]);
    const saved = store.get().games?.blockslide ?? {};
    root.append(
      el('h2', { class: 'section-title', text: 'Per-set progress' }),
      table('Progress per set',
        ['Set', 'Attempts', 'Practice puzzles played', 'Timed runs', 'Last run score', 'First 3 vs last 3 runs', 'Best saved run'],
        prog.map((p) => [
          p.set, p.attempts, p.practicePuzzles, p.runs, p.lastScore?.toFixed(2) ?? '',
          p.change ? `${p.change.first.toFixed(2)} to ${p.change.last.toFixed(2)}` : '',
          state.sample ? '' : saved[p.set]?.bestScore ? saved[p.set].bestScore.toFixed(2) : '',
        ])),
    );

    if (!state.sample) root.append(backupSection(recorder, store, draw));
  }

  draw();
  return () => {};
}

function tile(label, value) {
  return el('div', { class: 'tile' }, el('span', { class: 'tile-label', text: label }), el('strong', { text: value }));
}

function table(caption, cols, rows) {
  return el('div', { class: 'table-wrap' },
    el('table', { class: 'results' },
      el('caption', { class: 'sr-only', text: caption }),
      el('thead', {}, el('tr', {}, cols.map((c) => el('th', { scope: 'col', text: c })))),
      el('tbody', {}, rows.map((r) => el('tr', {}, r.map((v) => el('td', { text: String(v ?? '') }))))),
    ),
  );
}

function backupSection(recorder, store, redraw) {
  const status = el('p', { class: 'muted', role: 'status' });
  const file = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'sr-only',
    id: 'backup-file',
    tabindex: '-1',
    'aria-hidden': 'true',
    onchange: async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const { recorder: arch, progress, learn } = parseBackup(await f.text());
        const res = recorder.importData(arch);
        if (progress) store.mergeData(progress);
        const lres = learn ? learnStore().importData(learn) : null;
        redraw();
        document.getElementById('backup-status')?.replaceChildren(
          `Imported ${res.added} records${res.skipped ? `, ${res.skipped} already present` : ''}${res.dropped ? `, ${res.dropped} unreadable and ignored` : ''}${progress ? ', progress merged' : ''}${lres ? `, ${lres.added} review entries added` : ''}.`);
      } catch (err) {
        status.textContent = `Import failed: ${err.message}.`;
      }
      e.target.value = '';
    },
  });
  status.id = 'backup-status';
  return el('section', { class: 'backup' },
    el('h2', { class: 'section-title', text: 'Backup' }),
    el('p', { class: 'muted', text: 'Your history lives only in this browser. Export a JSON backup to keep it or move it to another device; it includes the review notebook, notes and report snapshots. Import merges a backup into what is here (nothing is overwritten).' }),
    el('div', { class: 'after-actions' },
      el('button', {
        type: 'button',
        class: 'btn',
        onclick: () => {
          const backup = makeBackup({ recorder: recorder.exportData(), progress: store.get(), learn: learnStore().exportData() });
          const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
          const a = el('a', { href: URL.createObjectURL(blob), download: `cogprep-backup-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a);
          a.click();
          setTimeout(() => {
            URL.revokeObjectURL(a.href);
            a.remove();
          }, 0);
          status.textContent = 'Backup downloaded.';
        },
      }, 'Export JSON backup'),
      el('button', { type: 'button', class: 'btn', onclick: () => file.click() }, 'Import JSON backup'),
      file,
      el('button', {
        type: 'button',
        class: 'btn btn-quiet',
        onclick: () => {
          if (confirm('Delete the recorded play history in this browser? Export a backup first if you want to keep it.')) {
            recorder.clear();
            redraw();
          }
        },
      }, 'Clear play history'),
    ),
    status,
  );
}

// Per-game learning overview: skill score, reports and the review library.
function learningSection() {
  let ctx;
  try {
    ctx = loadContext();
  } catch (err) {
    console.error(err);
    return null;
  }
  const totalDue = Object.values(ctx.due).reduce((a, b) => a + b, 0);
  return el('section', { class: 'learn-overview', 'aria-labelledby': 'learn-h' },
    el('h2', { id: 'learn-h', class: 'section-title', text: 'Learning: reports and review' }),
    el('div', { class: 'toolbar' },
      tierChip(ctx.skill),
      el('a', { class: `btn${totalDue ? ' btn-primary' : ''}`, href: '#/review/today' }, `Today's review queue (${totalDue} due)`),
      el('a', { class: 'btn', href: '#/achievements' }, 'Achievements')),
    nodeTable('Learning per game', ['Game', 'Skill score', 'n', '14-day change', 'Report', 'Review'],
      ctx.skill.cards.map((c) => [
        `${gameName(c.game)}${c.stale ? ' (stale)' : ''}`,
        c.n ? `${Math.round(c.score)} ${c.tier}` : 'not played',
        String(c.n),
        deltaText(c.delta, Math.min(c.n, c.pastN)),
        el('a', { href: `#/report/${c.game}` }, 'Open report'),
        el('a', { href: `#/review/${c.game}` }, ctx.due[c.game] ? `${ctx.due[c.game]} due` : 'Notebook'),
      ])));
}

