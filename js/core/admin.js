// Admin analytics dashboard. Fetches from /stats on the cogprep-board backend.
// Token is kept in sessionStorage only (never saved permanently or committed).
import { el } from './dom.js';
import { base, cid } from './board.js';

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
      funnelCard,
      perfCard,
      frictionCard,
      audienceCard,
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
