// Anonymous run upload and leaderboard client. Endpoint comes from endpoint.json (same origin) so the
// tunnel URL can change without a code change. Failures are silent and retried later.
import { el } from './dom.js';
import { onRunSaved, onAttemptSaved } from './recorder.js';
import { dvsTelemetry } from './dvs.js';
import { isPartial } from './partial.js';

const K_CID = 'cogprep.cid.v1', K_NICK = 'cogprep.nick.v1', K_Q = 'cogprep.queue.v1', K_CMP = 'cogprep.compare.v1';
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
export const TITLES = [[90, 'Grandmaster'], [75, 'Strategist'], [50, 'Analyst'], [25, 'Apprentice'], [0, 'Rookie']];
export const titleFor = (pct) => TITLES.find(([m]) => pct >= m)[1];
export const cid = () => { let c = ls.get(K_CID); if (!c) { c = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); ls.set(K_CID, c); } return c; };
export const nick = () => ls.get(K_NICK) || '';
export const setNick = (n) => { const v = n.trim().slice(0, 16); ls.set(K_NICK, v); if (v) ev('feat', 'board', { name: 'set_nick' }); };
export const compareOn = () => ls.get(K_CMP) === '1';
export const setCompare = (on) => { ls.set(K_CMP, on ? '1' : '0'); ev('feat', 'board', { name: on ? 'cmp_on' : 'cmp_off' }); };

let endpoint = null;
export async function base() {
  if (endpoint) return endpoint;
  try { const r = await fetch('endpoint.json', { cache: 'no-store' }); endpoint = (await r.json()).url || null; } catch { endpoint = null; }
  return endpoint;
}
const queue = () => { try { return JSON.parse(ls.get(K_Q) || '[]'); } catch { return []; } };

async function flush() {
  const b = await base(); if (!b) return;
  let q = queue(); if (!q.length) return;
  const rest = [];
  for (const body of q.slice(0, 20)) {
    try { const r = await fetch(b + '/submit', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' } }); if (!r.ok) { ev('upload_fail', 'board', { status: r.status }); if (r.status >= 500) rest.push(body); } } catch { ev('upload_fail', 'board', { status: 0 }); rest.push(body); }
  }
  ls.set(K_Q, JSON.stringify(rest.concat(q.slice(20)).slice(-50)));
}

export function startBoard() {
  startTelemetry();
  onRunSaved((run) => {
    // Ended-early runs stay local: never on the leaderboard, never ranked.
    if (isPartial(run)) return;
    const q = queue();
    q.push({ cid: cid(), nick: nick() || undefined, game: run.game, set: run.set, score: run.score, attempted: run.attempted, solved: run.solved, durationMs: run.durationMs });
    ls.set(K_Q, JSON.stringify(q.slice(-50)));
    flush();
  });
  flush();
}

async function get(path) { const b = await base(); if (!b) throw new Error('offline'); const r = await fetch(b + path); if (!r.ok) throw new Error('bad'); return r.json(); }
export const fetchBoard = (game, set, week) => get(`/board?game=${game}&set=${set}&week=${week ? 1 : 0}&cid=${encodeURIComponent(cid())}`);

// "You vs others" strip used under a game result. Only fetches when the visitor opted in.
export async function compareStrip(game, set) {
  if (!compareOn()) return null;
  try {
    const d = await fetchBoard(game, set, false);
    if (!d.me) return el('p', { class: 'muted' }, 'Your run is uploading. Check back in a moment.');
    if (d.players < d.minForPercentile) return el('p', { class: 'muted' }, `Only ${d.players} players on this set so far. Percentiles unlock at ${d.minForPercentile}.`);
    return el('p', {}, `Rank ${d.me.rank} of ${d.me.of} on this set. Ahead of ${d.me.percentile}% of players. Title: `, el('strong', {}, titleFor(d.me.percentile)));
  } catch { return null; }
}

const GAME_NAMES = { blockslide: 'Block Slide', latinsquare: 'Latin Square', gridmemory: 'Grid Memory', operatorswitch: 'Operator Switch', digitequation: 'Digit Equation', patternrule: 'Pattern Rule' };

const fmtTime = (ms) => { const t = Math.round((ms || 0) / 1000), m = Math.floor(t / 60), x = t % 60; return `${m}:${String(x).padStart(2, '0')}`; };
const fmtDate = (t) => { try { return new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch { return ''; } };
const MEDAL = { 1: '\u{1F947}', 2: '\u{1F948}', 3: '\u{1F949}' };

export function mountBoard(main) {
  let curGame = sessionStorage.getItem('cogprep.lb.game') || 'blockslide';
  if (!GAME_NAMES[curGame]) curGame = 'blockslide';
  let weekly = false;
  const tabs = el('div', { class: 'lb-tabs', role: 'tablist' });
  const wk = el('div', { class: 'lb-tabs lb-week' });
  const out = el('div', { class: 'lb-grid' });
  const nickIn = el('input', { type: 'text', maxlength: 16, placeholder: 'Nickname (optional)', value: nick() });
  const nickMsg = el('span', { class: 'muted' }, '');
  const cmp = el('input', { type: 'checkbox', id: 'lb-cmp' }); cmp.checked = compareOn();
  cmp.addEventListener('change', () => setCompare(cmp.checked));
  const save = el('button', { type: 'button', class: 'btn', onclick: () => { setNick(nickIn.value); nickMsg.textContent = 'Saved. It applies from your next run.'; } }, 'Save nickname');

  function drawTabs() {
    tabs.replaceChildren(...Object.entries(GAME_NAMES).map(([k, v]) => el('button', { type: 'button', role: 'tab', class: 'lb-tab' + (k === curGame ? ' is-on' : ''), 'aria-selected': k === curGame ? 'true' : 'false', onclick: () => { curGame = k; sessionStorage.setItem('cogprep.lb.game', k); drawTabs(); load(); } }, v)));
    wk.replaceChildren(...[[false, 'All time'], [true, 'This week']].map(([w, l]) => el('button', { type: 'button', class: 'lb-tab' + (weekly === w ? ' is-on' : ''), onclick: () => { weekly = w; drawTabs(); load(); } }, l)));
  }
  function card(s, minPct) {
    const head = el('div', { class: 'lb-head' }, el('h2', {}, 'Set ' + s.set), el('span', { class: 'muted' }, s.players ? `${s.players} player${s.players === 1 ? '' : 's'}${s.median !== null ? `, median ${s.median}` : ''}` : 'No runs yet'));
    if (!s.top.length) return el('section', { class: 'lb-card' }, head, el('p', { class: 'muted lb-empty' }, 'No runs yet. ', el('a', { href: `#/${curGame}/run/${s.set}` }, 'Be the first: take the timed test.')));
    const mine = s.top.find((r) => r.me);
    const rows = s.top.map((r) => {
      const acc = r.attempted ? Math.round(100 * r.solved / r.attempted) : 0;
      return el('tr', { class: (r.me ? 'is-me ' : '') + (r.rank <= 3 ? 'is-top' : '') },
        el('td', { class: 'lb-rank' }, MEDAL[r.rank] || String(r.rank)),
        el('td', { class: 'lb-name' }, r.name, r.me ? el('span', { class: 'lb-you' }, 'You') : ''),
        el('td', { class: 'lb-num lb-score' }, String(r.score)),
        el('td', { class: 'lb-num' }, `${r.solved}/${r.attempted}`),
        el('td', { class: 'lb-num lb-hide' }, acc + '%'),
        el('td', { class: 'lb-num lb-hide' }, fmtTime(r.durationMs)),
        el('td', { class: 'lb-num lb-hide' }, fmtDate(r.t)));
    });
    const tbl = el('table', { class: 'lb-table' },
      el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Player'), el('th', { class: 'lb-num' }, 'Score'), el('th', { class: 'lb-num' }, 'Solved'), el('th', { class: 'lb-num lb-hide' }, 'Acc.'), el('th', { class: 'lb-num lb-hide' }, 'Time'), el('th', { class: 'lb-num lb-hide' }, 'Date'))),
      el('tbody', {}, rows));
    const foot = mine && s.players >= minPct ? el('p', { class: 'lb-foot' }, `Your rank: ${mine.rank} of ${s.players}. Title: `, el('strong', {}, titleFor(Math.round(100 * (s.players - mine.rank) / s.players)))) : '';
    return el('section', { class: 'lb-card' }, head, el('div', { class: 'lb-scroll' }, tbl), foot);
  }
  async function load() {
    out.replaceChildren(el('p', { class: 'muted' }, 'Loading...'));
    try {
      const d = await get(`/boardall?game=${curGame}&week=${weekly ? 1 : 0}&cid=${encodeURIComponent(cid())}`);
      out.replaceChildren(...d.sets.map((s) => card(s, d.minForPercentile)));
    } catch { out.replaceChildren(el('p', { class: 'muted' }, 'Leaderboard is offline right now. Practice still works and runs are retried later.')); }
  }
  main.append(
    el('h1', {}, 'Leaderboard'),
    el('p', { class: 'muted' }, 'Best timed run per player on every set. All five sets are shown below. Your row is highlighted.'),
    el('div', { class: 'lb-controls' }, tabs, wk),
    out,
    el('details', { class: 'lb-settings' }, el('summary', {}, 'Your settings and privacy'),
      el('p', {}, 'Every finished timed run uploads its score with a random ID. No IP address is stored. A nickname is optional and shown publicly.'),
      el('div', {}, nickIn, ' ', save, ' ', nickMsg),
      el('label', {}, cmp, ' Show "you vs others" after each run'),
      el('p', { class: 'muted' }, 'Titles by percentile: ' + TITLES.slice().reverse().map(([m, t]) => `${t} (${m}%+)`).join(', '))),
  );
  drawTabs(); load();
  return () => {};
}

// Anonymous telemetry: random ID, session, coarse device and behaviour events. No IP, no keystrokes.
const SID = Math.random().toString(36).slice(2, 12);
const VER = '2026-10-18';
const K_SELF = 'cogprep.self.v1';
const GAMES = ['blockslide', 'latinsquare', 'gridmemory', 'operatorswitch', 'digitequation', 'patternrule'];
let firstHit = true, envSent = false, curPage = 'home', pageT0 = Date.now(), leftPage = false;
const itemIdx = {};
let activeRun = null, lastEnd = 0, perfSent = false, lcp = 0, ltN = 0;
function abandon(exit) { if (!activeRun) return; const r = activeRun; activeRun = null; ev('run_abandon', r.game, { game: r.game, set: r.set, mode: 'exam', rid: r.rid, exit, elapsed: Math.min(Date.now() - r.t0, 3600000), items_seen: r.items }); }
function envInfo() {
  const ua = navigator.userAgent || '', w = innerWidth, touch = (navigator.maxTouchPoints || 0) > 0;
  const mob = /Mobi|Android|iPhone|iPod/i.test(ua), tab = /iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && touch);
  const dev = tab ? 'tablet' : mob ? 'mobile' : (touch && Math.min(screen.width, screen.height) < 600 ? 'mobile' : 'desktop');
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  let tz = ''; try { tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').split('/')[0]; } catch { /* ignore */ }
  return { dev, br, os, touch, sw: screen.width, sh: screen.height, lang: (navigator.language || '').slice(0, 12), tz, inp: touch ? 'touch' : 'mouse' };
}
const ENV = (() => { try { return envInfo(); } catch { return { dev: 'desktop' }; } })();
export async function ev(name, page, extra = {}) {
  try {
    const b = await base(); if (!b) return;
    const body = { cid: cid(), sid: SID, page: page || curPage || 'home', ev: name, dev: ENV.dev, v: VER, ...extra };
    if (ls.get(K_SELF) === '1') body.self = true;
    fetch(b + '/hit', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }).catch(() => {});
  } catch { /* never break the site */ }
}
const retDays = () => { const k = 'cogprep.first.v1'; let f = Number(ls.get(k)); if (!f) { f = Date.now(); ls.set(k, String(f)); return 0; } return Math.min(3650, Math.floor((Date.now() - f) / 864e5)); };
export function track(page) {
  page = page || 'home';
  if (!firstHit && !leftPage && curPage) ev('leave', curPage, { dur: Math.min(Date.now() - pageT0, 14400000) });
  leftPage = false; curPage = page; pageT0 = Date.now();
  const first = firstHit; firstHit = false;
  let ref = '', utm = {};
  if (first) {
    if (document.referrer) { try { const h = new URL(document.referrer).hostname; if (h !== location.hostname) ref = h; } catch { /* ignore */ } }
    try { const q = new URLSearchParams(location.search); utm = { us: q.get('utm_source') || '', um: q.get('utm_medium') || '', uc: q.get('utm_campaign') || '' }; } catch { /* ignore */ }
  }
  ev('view', page, { first, ref, ret: retDays(), ...(first ? utm : {}), ...(envSent ? {} : { br: ENV.br, os: ENV.os, sw: ENV.sw, sh: ENV.sh, lang: ENV.lang, tz: ENV.tz, touch: ENV.touch, inp: ENV.inp }) });
  envSent = true;
  if (GAMES.includes(page)) ev('game_start', page, { game: page });
}

// Item event fields: outcome, time and the compact did vs should codes (no free text).
export function itemExtra(a, rid, i) {
  return { game: a.game, set: a.set, mode: a.mode, rid: String(rid).slice(0, 20), i, ms: Math.round((a.metrics && a.metrics.totalMs) || 0), ok: a.outcome === 'solved', skip: a.outcome === 'skipped', hint: (a.hintsUsed || 0) > 0, ...dvsTelemetry(a.dvs) };
}

let wired = false;
export function startTelemetry() {
  if (wired || typeof window === 'undefined') return; wired = true;
  onAttemptSaved((a) => {
    const rid = a.runId || a.id;
    if (a.mode === 'exam' && !(rid in itemIdx)) { activeRun = { rid: String(rid).slice(0, 20), game: a.game, set: a.set, t0: Date.now(), items: 0 }; }
    if (activeRun && String(rid).slice(0, 20) === activeRun.rid) activeRun.items += 1;
    if (a.mode === 'exam' && !(rid in itemIdx)) ev('run_start', a.game, { game: a.game, set: a.set, mode: 'exam', rid: String(rid).slice(0, 20) });
    const i = itemIdx[rid] = (itemIdx[rid] || 0) + 1;
    ev('item', a.game, itemExtra(a, rid, i));
  });
  onRunSaved((r) => { activeRun = null; lastEnd = Date.now(); ev('run_end', r.game, { game: r.game, set: r.set, mode: 'exam', rid: String(r.id).slice(0, 20), n: Math.round(r.attempted || 0), ms: Math.round(r.durationMs || 0), ...(isPartial(r) ? { part: 1, exit: r.exit || 'early' } : {}) }); });
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !leftPage) { leftPage = true; ev('leave', curPage, { dur: Math.min(Date.now() - pageT0, 14400000) }); } else if (document.visibilityState === 'visible' && leftPage) { leftPage = false; pageT0 = Date.now(); } });
  document.addEventListener('click', (e) => { const a = e.target && e.target.closest && e.target.closest('a[href^="http"]'); if (a) { try { const u = new URL(a.href); if (u.hostname !== location.hostname) ev('link_click', curPage, { tgt: u.hostname.slice(0, 40) }); } catch { /* ignore */ } } }, true);
  const errSeen = new Set(); const errOk = (k) => { if (errSeen.has(k) || errSeen.size >= 8) return false; errSeen.add(k); return true; };
  addEventListener('error', (e) => { if (!errOk(String(e.message) + (e.lineno || 0))) return; ev('js_error', curPage, { name: String(e.message || 'error').replace(/[^A-Za-z0-9 ._]/g, '').slice(0, 24), src: String(e.filename || '').split('/').pop().slice(0, 40), line: e.lineno || 0 }); });
  addEventListener('unhandledrejection', () => { if (errOk('rej')) ev('js_error', curPage, { name: 'unhandledrejection' }); });
  addEventListener('orientationchange', () => {
    try {
      const o = (screen.orientation && screen.orientation.type) || (innerWidth > innerHeight ? 'landscape' : 'portrait');
      ev('env', curPage, { orient: o });
    } catch { /* ignore */ }
  });
  addEventListener('resize', () => { if (activeRun) ev('feat', activeRun.game, { name: 'midrun_resize' }); });
  addEventListener('hashchange', () => abandon('nav'));
  addEventListener('pagehide', () => abandon('unload'));
  addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    abandon('hidden');
    if (!perfSent && (lcp || ltN)) { perfSent = true; ev('perf', curPage, { lcp: Math.round(lcp), lt_n: ltN }); }
  });
  try { new PerformanceObserver((l) => { const e = l.getEntries(); if (e.length) lcp = e[e.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* ignore */ }
  try { new PerformanceObserver((l) => { ltN += l.getEntries().length; }).observe({ type: 'longtask', buffered: true }); } catch { /* ignore */ }
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null; if (!t) return;
    const card = t.closest('.set-card');
    if (card) {
      const m = (card.textContent || '').match(/Set\s*(\d)/); const a = t.closest('a[href]');
      const hm = a && a.getAttribute('href').match(/#\/(\w+)\/(?:run|practice)\/(\d)/);
      const game = hm ? hm[1] : curPage, set = hm ? Number(hm[2]) : (m ? Number(m[1]) : 0);
      if (GAMES.includes(game) && (card.classList.contains('is-locked') || a)) ev('set_select', game, { game, set, locked: card.classList.contains('is-locked') });
    }
    if (lastEnd && Date.now() - lastEnd < 120000) {
      const b = t.closest('a.btn, button.btn, a[href], button');
      if (b) { lastEnd = 0; ev('result_action', curPage, { act: (b.textContent || 'x').trim().toLowerCase().replace(/[^a-z]+/g, '_').slice(0, 14) }); }
    }
  }, true);
  try {
    const hp = document.createElement('input'); hp.type = 'text'; hp.name = 'website'; hp.tabIndex = -1; hp.autocomplete = 'off'; hp.setAttribute('aria-hidden', 'true');
    hp.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0';
    hp.addEventListener('input', () => ev('honeypot', curPage)); document.body.appendChild(hp);
  } catch { /* ignore */ }
  addEventListener('load', () => setTimeout(() => {
    try { const n = performance.getEntriesByType('navigation')[0], fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const heap = (performance.memory && performance.memory.usedJSHeapSize) ? Math.round(performance.memory.usedJSHeapSize / 1048576) : undefined;
      ev('perf', 'home', { ttfb: Math.round(n ? n.responseStart : 0), fcp: Math.round(fcp ? fcp.startTime : 0), ...(heap ? { heap_mb: heap } : {}) }); } catch { /* ignore */ }
  }, 1500));
}

// Streaks: consecutive calendar days with at least one finished run. Stored locally only.
const K_STREAK = 'cogprep.streak';
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function bumpStreak() {
  let st; try { st = JSON.parse(ls.get(K_STREAK) || 'null'); } catch { st = null; }
  st = st || { last: '', count: 0, best: 0, total: 0 };
  const today = dayKey(), yest = dayKey(new Date(Date.now() - 864e5));
  if (st.last !== today) { st.count = st.last === yest ? st.count + 1 : 1; st.last = today; }
  st.total += 1; st.best = Math.max(st.best, st.count);
  ls.set(K_STREAK, JSON.stringify(st));
  return st;
}

// Result-screen extras: personal-best badge, streak line, and the opt-in compare strip.
// partial: an ended-early run, which is not uploaded, so it gets no rank or percentile.
export function runExtras(game, set, improved, { partial = false } = {}) {
  const st = bumpStreak();
  try {
    const raw = ls.get('cogprep.progress.v1');
    if (raw) {
      const data = JSON.parse(raw);
      const e = data?.games?.[game]?.[set];
      if (e && e.bestAvg >= 0.7 && set < 5) {
        const ukKey = 'cogprep.unlocked.v1';
        let unlocked = {};
        try { unlocked = JSON.parse(ls.get(ukKey) || '{}'); } catch {}
        const tag = `${game}_s${set + 1}`;
        if (!unlocked[tag]) {
          unlocked[tag] = 1;
          ls.set(ukKey, JSON.stringify(unlocked));
          ev('set_unlock', game, { game, set: set + 1, runs: e.runs || 1 });
        }
      }
    }
  } catch { /* ignore */ }
  const box = el('div', { class: 'run-extras' });
  if (improved) box.append(el('p', { class: 'callout callout-ok', text: 'Personal best! New top score for this set.' }));
  box.append(el('p', { class: 'muted', text: `Streak: ${st.count} day${st.count === 1 ? '' : 's'} in a row (best ${st.best}). ${st.total} runs finished on this browser.` }));
  const slot = el('div', {}); box.append(slot);
  if (partial) slot.append(el('p', { class: 'muted small', text: 'Runs ended early count toward your progress, streak and review, but are not uploaded to the leaderboard or ranked.' }));
  else if (compareOn()) setTimeout(async () => { const n = await compareStrip(game, set); if (n) slot.replaceChildren(n); }, 2500);
  return box;
}
