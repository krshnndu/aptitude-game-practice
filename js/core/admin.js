// Admin analytics dashboard. Fetches from /stats on the cogprep-board backend.
// Token is kept in sessionStorage only (never saved permanently or committed).
import { el } from './dom.js';
import { base, cid } from './board.js';
import { lineChart, barChart } from './charts.js';
import { termlyFunnel } from './maker.js';

const K_ADMIN_TOKEN = 'cogprep.admin_token';
const K_SELF = 'cogprep.self.v1';

export function mountAdmin(main) {
  const root = el('div', { class: 'admin-dashboard' });
  main.replaceChildren(root);

  let token = sessionStorage.getItem(K_ADMIN_TOKEN) || '';
  let days = 30;

  function renderLogin() {
    root.replaceChildren(
      el('section', { class: 'prose card', style: 'max-width: 480px; margin: 40px auto; padding: 24px;' },
        el('h1', { text: 'Site Analytics & Telemetry' }),
        el('p', { class: 'muted', text: 'Enter the admin token to inspect live visitor reach, funnel performance, friction, and error diagnostics.' }),
        el('form', {
          onsubmit: (e) => {
            e.preventDefault();
            const inp = root.querySelector('#admin-tok');
            if (inp && inp.value.trim()) {
              token = inp.value.trim();
              sessionStorage.setItem(K_ADMIN_TOKEN, token);
              loadStats();
            }
          }
        },
          el('div', { style: 'margin-bottom: 16px;' },
            el('label', { for: 'admin-tok', style: 'display: block; font-weight: 600; margin-bottom: 6px;', text: 'Stats Token' }),
            el('input', { id: 'admin-tok', type: 'password', required: true, autocomplete: 'current-password', style: 'width: 100%; padding: 8px 12px; font-size: 1rem; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg);' })
          ),
          el('button', { type: 'submit', class: 'btn btn-primary', style: 'width: 100%;', text: 'View Dashboard' })
        )
      )
    );
  }

  async function loadStats() {
    root.replaceChildren(el('p', { class: 'muted', style: 'text-align: center; margin: 60px auto;', text: 'Loading analytics from backend...' }));
    const b = await base();
    if (!b) {
      root.replaceChildren(el('p', { class: 'callout callout-warn', text: 'Telemetry server is currently unreachable. Make sure the quick tunnel and service are running.' }));
      return;
    }

    try {
      const res = await fetch(`${b}/stats?days=${days}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 403 || res.status === 401) {
        sessionStorage.removeItem(K_ADMIN_TOKEN);
        token = '';
        renderLogin();
        const errNotice = el('p', { class: 'callout callout-warn', style: 'margin-top: 12px;', text: 'Invalid token. Authorization rejected.' });
        root.querySelector('section')?.append(errNotice);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderDashboard(data, b);
    } catch (err) {
      root.replaceChildren(
        el('div', { class: 'card prose', style: 'max-width: 600px; margin: 40px auto; padding: 24px;' },
          el('h2', { text: 'Unable to Load Statistics' }),
          el('p', { class: 'callout callout-warn', text: String(err.message || err) }),
          el('button', { class: 'btn', onclick: renderLogin, text: 'Back to Login' })
        )
      );
    }
  }

  function renderDashboard(d, b) {
    const isExcluded = localStorage.getItem(K_SELF) === '1';

    const selfCard = el('div', { class: 'card', style: 'padding: 16px 20px; margin-bottom: 24px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;' },
      el('div', {},
        el('strong', { text: 'Self-Exclusion Status: ' }),
        el('span', {
          class: `badge ${isExcluded ? 'badge-ok' : 'badge-warn'}`,
          text: isExcluded ? 'This browser is EXCLUDED' : 'This browser is INCLUDED'
        }),
        el('p', { class: 'muted small', style: 'margin: 4px 0 0;', text: 'When excluded, your visits, gameplay and test attempts are tagged and isolated from production metrics.' })
      ),
      el('button', {
        class: `btn ${isExcluded ? 'btn-quiet' : 'btn-warn'}`,
        text: isExcluded ? 'Include this browser' : 'Exclude this browser',
        onclick: async () => {
          const next = !isExcluded;
          try {
            await fetch(`${b}/self`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ cid: cid(), on: next })
            });
            if (next) localStorage.setItem(K_SELF, '1');
            else localStorage.removeItem(K_SELF);
            loadStats();
          } catch {
            alert('Failed to update self-exclusion on server.');
          }
        }
      })
    );

    const rangeBar = el('div', { style: 'display: flex; gap: 8px; align-items: center; margin-bottom: 20px;' },
      el('span', { class: 'muted', style: 'font-weight: 600;', text: 'Time window: ' }),
      ...[7, 30, 90].map(n => el('button', {
        class: `btn ${days === n ? 'btn-primary' : 'btn-quiet'}`,
        text: `${n} days`,
        onclick: () => { days = n; loadStats(); }
      })),
      el('button', {
        class: 'btn btn-quiet',
        style: 'margin-left: auto;',
        text: 'Logout',
        onclick: () => {
          sessionStorage.removeItem(K_ADMIN_TOKEN);
          token = '';
          renderLogin();
        }
      })
    );

    const kpis = el('div', { style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 24px;' },
      kpi('Page Views', d.pageViews ?? 0),
      kpi('Unique Visitors', d.uniqueVisitors ?? 0),
      kpi('Total Sessions', d.sessions ?? 0),
      kpi('New vs Returning', `${d.newVisitors ?? 0} / ${d.returning ?? 0}`),
      kpi('Bounce Rate', `${d.bounceRate ?? 0}%`),
      kpi('Avg Session', d.avgSessionSec != null ? `${d.avgSessionSec}s` : 'N/A'),
      kpi('Active Players', d.players ?? 0)
    );

    const funnel = d.funnel || {};
    const fv = funnel.visited || 1;
    const funnelCard = el('div', { class: 'card', style: 'padding: 20px; margin-bottom: 24px;' },
      el('h3', { style: 'margin-top: 0;', text: 'Conversion & Engagement Funnel' }),
      el('div', { style: 'display: flex; flex-direction: column; gap: 10px; margin-top: 14px;' },
        funnelRow('Visited Site', funnel.visited ?? 0, 100),
        funnelRow('Opened a Game', funnel.opened_a_game ?? 0, Math.round(100 * (funnel.opened_a_game || 0) / fv)),
        funnelRow('Selected a Set', funnel.selected_a_set ?? 0, Math.round(100 * (funnel.selected_a_set || 0) / fv)),
        funnelRow('Started Timed Run', funnel.run_started ?? 0, Math.round(100 * (funnel.run_started || 0) / fv)),
        funnelRow('Finished Timed Run', funnel.run_ended ?? 0, Math.round(100 * (funnel.run_ended || 0) / fv)),
        funnelRow('Post-Run Action Taken', funnel.result_action_taken ?? 0, Math.round(100 * (funnel.result_action_taken || 0) / fv))
      )
    );

    const perf = d.perf || {};
    const perfCard = el('div', { class: 'card', style: 'padding: 20px; margin-bottom: 24px;' },
      el('h3', { style: 'margin-top: 0;', text: 'Web Vitals & Performance' }),
      el('div', { style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 12px;' },
        kpi('Samples', perf.n ?? 0),
        kpi('TTFB Median', perf.ttfbP50 ? `${perf.ttfbP50}ms` : 'N/A'),
        kpi('LCP p50', perf.lcpP50 ? `${perf.lcpP50}ms` : 'N/A'),
        kpi('LCP p95', perf.lcpP95 ? `${perf.lcpP95}ms` : 'N/A'),
        kpi('Long Tasks Median', perf.longTaskMedian ?? 0)
      )
    );

    const ab = d.abandon || {};
    const sf = d.setFriction || {};
    const frictionCard = el('div', { class: 'card', style: 'padding: 20px; margin-bottom: 24px;' },
      el('h3', { style: 'margin-top: 0;', text: 'Dropoff, Friction & Abandonment' }),
      el('div', { style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-top: 14px;' },
        el('div', {},
          el('h4', { style: 'margin: 0 0 8px;', text: 'Timed Run Abandons' }),
          el('p', { text: `Total abandons: ${ab.total ?? 0}` }),
          el('p', { text: `Exam abandons: ${ab.examAbandons ?? 0} / ${ab.examStarts ?? 0} starts` }),
          el('p', { text: `Median items before quit: ${ab.medianItemsSeen ?? 'N/A'}` }),
          el('p', { text: `Exit paths: ${formatDict(ab.byExit || {})}` })
        ),
        el('div', {},
          el('h4', { style: 'margin: 0 0 8px;', text: 'Set Unlocking Friction' }),
          el('p', { text: `Median runs to unlock a set: ${sf.runsToUnlockMedian ?? 'N/A'}` }),
          el('p', { text: `Taps on locked sets: ${formatDict(sf.lockedTaps || {})}` })
        ),
        el('div', {},
          el('h4', { style: 'margin: 0 0 8px;', text: 'Errors & Failures' }),
          el('p', { text: `Score upload failures: ${d.uploadFails ?? 0}` }),
          el('p', { text: `Client script errors: ${(d.errors || []).length} unique issues` })
        )
      )
    );

    const audienceCard = el('div', { class: 'card', style: 'padding: 20px; margin-bottom: 24px;' },
      el('h3', { style: 'margin-top: 0;', text: 'Audience & Environment' }),
      el('div', { style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-top: 14px;' },
        el('div', {},
          el('h4', { style: 'margin: 0 0 8px;', text: 'Devices' }),
          dictList(d.devices || {})
        ),
        el('div', {},
          el('h4', { style: 'margin: 0 0 8px;', text: 'Operating Systems' }),
          dictList(d.os || {})
        ),
        el('div', {},
          el('h4', { style: 'margin: 0 0 8px;', text: 'Browsers' }),
          dictList(d.browsers || {})
        ),
        el('div', {},
          el('h4', { style: 'margin: 0 0 8px;', text: 'Timezone Regions' }),
          dictList(d.timezones || {})
        )
      )
    );

    const srcRows = Object.entries(d.sources || {});
    const sourcesCard = el('div', { class: 'card', style: 'padding: 20px; margin-bottom: 24px;' },
      el('h3', { style: 'margin-top: 0;', text: 'Traffic sources' }),
      el('p', { class: 'muted small', text: 'First-visit source per visitor: utm source/medium/campaign if tagged, else referrer host, else direct. "Started" = began at least one run.' }),
      srcRows.length
        ? el('table', { class: 'results' },
            el('thead', {}, el('tr', {}, el('th', { text: 'Source' }), el('th', { text: 'Visitors' }), el('th', { text: 'Started' }), el('th', { text: 'Rate' }))),
            el('tbody', {}, ...srcRows.map(([k, v]) => el('tr', {},
              el('td', { text: k }), el('td', { text: String(v.visitors) }), el('td', { text: String(v.started_run) }),
              el('td', { text: v.visitors ? Math.round(100 * v.started_run / v.visitors) + '%' : '-' })))))
        : el('p', { class: 'muted small', text: 'No data' })
    );

    // Termly funnel: per placement when /stats has a termly block, else the site wide totals it already has.
    const termlyRows = termlyFunnel(d);
    const feats = d.features || {};
    const termlyCard = el('div', { class: 'card', style: 'padding: 20px; margin-bottom: 24px;' },
      el('h3', { style: 'margin-top: 0;', text: 'Termly funnel' }),
      termlyRows
        ? el('table', { class: 'results' },
            el('thead', {}, el('tr', {}, el('th', { text: 'Placement' }), el('th', { text: 'Shown' }), el('th', { text: 'Clicks' }))),
            el('tbody', {}, ...termlyRows.map((r) => el('tr', {}, el('td', { text: r.placement }), el('td', { text: String(r.shown) }), el('td', { text: String(r.clicks) })))))
        : el('div', {},
            el('p', { class: 'muted small', text: 'Per placement counts need a server update. Totals for now:' }),
            el('ul', { style: 'padding-left: 18px; margin: 0;' },
              el('li', { text: `Prompts shown: ${feats.maker_show ?? 0}` }),
              el('li', { text: `Prompts dismissed: ${feats.maker_dismiss ?? 0}` }),
              el('li', { text: `Clicks to Termly (all placements): ${d.linkClicks?.['termly-iimr.vercel.app'] ?? 0}` }))));

    // ---- charts ----
    const fillDays = () => {
      const out = []; const dd = d.daily || {};
      for (let i = Math.min(days, 90) - 1; i >= 0; i--) {
        const t = new Date(Date.now() - i * 864e5);
        const k = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        out.push({ k, label: k.slice(5), views: dd[k]?.views || 0, unique: dd[k]?.unique || 0 });
      }
      return out;
    };
    const dl = fillDays();
    const hasAny = (d.pageViews || 0) > 0;
    const grid = (...kids) => el('div', { style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 24px;' }, ...kids);
    const wrap = (node) => el('div', { class: 'card', style: 'padding: 16px;' }, node);
    const bars = (obj, n = 8) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, value]) => ({ label: String(label).slice(0, 10), value }));
    const trendCard = hasAny ? wrap(lineChart({
      title: 'Traffic over time', subtitle: 'Daily page views and unique visitors',
      xLabels: dl.map((x) => x.label),
      series: [{ name: 'Views', values: dl.map((x) => x.views), color: 'var(--series-1)', mode: 'both' }, { name: 'Visitors', values: dl.map((x) => x.unique), color: 'var(--series-2)', mode: 'both' }],
    })) : el('div', { class: 'card muted', style: 'padding: 16px;', text: 'No traffic yet in this window.' });
    const hours = Array.from({ length: 24 }, (_, h) => ({ label: String(h), value: d.hourly?.[h] || 0, detail: `${h}:00 UTC` }));
    const wk = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((k) => ({ label: k, value: d.weekday?.[k] || 0 }));
    const timeGrid = hasAny ? grid(
      wrap(barChart({ title: 'Activity by hour', subtitle: 'Server clock hour', bars: hours })),
      wrap(barChart({ title: 'Activity by weekday', subtitle: 'All events', bars: wk }))) : null;
    const gameGrid = hasAny ? grid(
      wrap(barChart({ title: 'Top pages', subtitle: 'Views by page', bars: bars(d.pages, 8) })),
      wrap(barChart({ title: 'Game starts', subtitle: 'By game', bars: bars(d.gameStarts, 6) })),
      wrap(barChart({ title: 'Game finishes', subtitle: 'Completed timed runs', bars: bars(d.gameFinishes, 6) }))) : null;
    const errRows = d.errors || [];
    const errCard = el('div', { class: 'card', style: 'padding: 20px; margin-bottom: 24px;' },
      el('h3', { style: 'margin-top: 0;', text: 'Client errors' }),
      errRows.length
        ? el('table', { class: 'results' }, el('thead', {}, el('tr', {}, el('th', { text: 'Error @ file' }), el('th', { text: 'Device' }), el('th', { text: 'Count' }))),
            el('tbody', {}, ...errRows.map((e) => el('tr', {}, el('td', { text: String(e.hash) }), el('td', { text: String(e.game || '') }), el('td', { text: String(e.n) })))))
        : el('p', { class: 'muted small', text: 'No errors recorded.' }));
    const retention = d.retention || {};
    const retCard = el('div', { class: 'card', style: 'padding: 20px; margin-bottom: 24px;' },
      el('h3', { style: 'margin-top: 0;', text: 'Retention & engagement' }),
      el('div', { style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 12px;' },
        kpi('Returned next day', retention.returnedNextDay ?? 0), kpi('Returned after 7d', retention.returnedAfter7d ?? 0),
        kpi('Pages / session', d.pagesPerSession ?? 0), kpi('Median session', d.medianSessionSec != null ? `${d.medianSessionSec}s` : 'N/A'),
        kpi('Upload fails', d.uploadFails ?? 0)));

    const hotspots = d.itemHotspots || [];
    let hotspotCard = null;
    if (hotspots.length > 0) {
      hotspotCard = el('div', { class: 'card', style: 'padding: 20px; margin-bottom: 24px;' },
        el('h3', { style: 'margin-top: 0;', text: 'Hardest Puzzles (Lowest Solve Rates)' }),
        el('table', { class: 'results', style: 'width: 100%; border-collapse: collapse; margin-top: 12px;' },
          el('thead', {},
            el('tr', {},
              el('th', { text: 'Puzzle' }),
              el('th', { text: 'Attempts' }),
              el('th', { text: 'Solve Rate' }),
              el('th', { text: 'Hint Rate' }),
              el('th', { text: 'Skip Rate' }),
              el('th', { text: 'Median Time' })
            )
          ),
          el('tbody', {},
            ...hotspots.map(h => el('tr', {},
              el('td', { text: h.item }),
              el('td', { text: String(h.n) }),
              el('td', { text: `${Math.round(h.okRate * 100)}%` }),
              el('td', { text: `${Math.round(h.hintRate * 100)}%` }),
              el('td', { text: `${Math.round(h.skipRate * 100)}%` }),
              el('td', { text: `${Math.round(h.medianMs / 1000)}s` })
            ))
          )
        )
      );
    }

    const excl = d.excluded || {};
    const footerStats = el('p', { class: 'muted small', style: 'text-align: center; margin-top: 32px;', text: `Excluded from metrics: ${excl.botHits ?? 0} bot hits, ${excl.selfHits ?? 0} self/internal hits. Site version: ${formatDict(d.builds || {})}.` });

    root.replaceChildren(
      el('h1', { text: 'Site Analytics & Operations' }),
      rangeBar,
      selfCard,
      kpis,
      trendCard,
      timeGrid,
      gameGrid,
      funnelCard,
      perfCard,
      frictionCard,
      audienceCard,
      sourcesCard,
      termlyCard,
      retCard,
      errCard,
      ...(hotspotCard ? [hotspotCard] : []),
      footerStats
    );
  }

  function kpi(label, val) {
    return el('div', { class: 'card', style: 'padding: 14px 16px; text-align: center;' },
      el('div', { class: 'muted small', text: label }),
      el('div', { style: 'font-size: 1.5rem; font-weight: 700; margin-top: 4px; color: var(--fg);', text: String(val) })
    );
  }

  function funnelRow(step, count, pct) {
    return el('div', { style: 'display: flex; align-items: center; gap: 12px;' },
      el('div', { style: 'width: 170px; font-weight: 500;', text: step }),
      el('div', { style: 'flex: 1; height: 16px; background: var(--line); border-radius: 4px; overflow: hidden;' },
        el('div', { style: `width: ${Math.min(100, Math.max(0, pct))}%; height: 100%; background: var(--accent); border-radius: 4px;` })
      ),
      el('div', { style: 'width: 90px; text-align: right; font-size: 0.9rem; color: var(--muted);', text: `${count} (${pct}%)` })
    );
  }

  function formatDict(obj) {
    const entries = Object.entries(obj);
    if (!entries.length) return 'None';
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
  }

  function dictList(obj) {
    const entries = Object.entries(obj);
    if (!entries.length) return el('p', { class: 'muted small', text: 'No data' });
    return el('ul', { style: 'padding-left: 18px; margin: 0;' },
      ...entries.map(([k, v]) => el('li', { text: `${k}: ${v}` }))
    );
  }

  if (token) loadStats();
  else renderLogin();

  return () => {};
}
