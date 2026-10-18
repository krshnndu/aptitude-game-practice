// Anonymous run upload and leaderboard client. Endpoint comes from endpoint.json (same origin) so the
// tunnel URL can change without a code change. Failures are silent and retried later.
import { el } from './dom.js';
import { onRunSaved, onAttemptSaved } from './recorder.js';

const K_CID = 'cogprep.cid.v1', K_NICK = 'cogprep.nick.v1', K_Q = 'cogprep.queue.v1', K_CMP = 'cogprep.compare.v1';
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
export const TITLES = [[90, 'Grandmaster'], [75, 'Strategist'], [50, 'Analyst'], [25, 'Apprentice'], [0, 'Rookie']];
export const titleFor = (pct) => TITLES.find(([m]) => pct >= m)[1];
export const cid = () => { let c = ls.get(K_CID); if (!c) { c = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); ls.set(K_CID, c); } return c; };
export const nick = () => ls.get(K_NICK) || '';
export const setNick = (n) => ls.set(K_NICK, n.trim().slice(0, 16));
export const compareOn = () => ls.get(K_CMP) === '1';
export const setCompare = (on) => ls.set(K_CMP, on ? '1' : '0');

let endpoint = null;
async function base() {
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
    try { const r = await fetch(b + '/submit', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' } }); if (!r.ok && r.status >= 500) rest.push(body); } catch { rest.push(body); }
  }
  ls.set(K_Q, JSON.stringify(rest.concat(q.slice(20)).slice(-50)));
}

export function startBoard() {
  startTelemetry();
  onRunSaved((run) => {
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

export function mountBoard(main) {
  const game = el('select', {}, Object.entries(GAME_NAMES).map(([k, v]) => el('option', { value: k }, v)));
  const set = el('select', {}, [1, 2, 3, 4, 5].map((n) => el('option', { value: n }, 'Set ' + n)));
  const week = el('select', {}, el('option', { value: '0' }, 'All time'), el('option', { value: '1' }, 'This week'));
  const out = el('div', { class: 'board-out' });
  const nickIn = el('input', { type: 'text', maxlength: 16, placeholder: 'Nickname (optional)', value: nick() });
  const nickMsg = el('span', { class: 'muted' }, '');
  const cmp = el('input', { type: 'checkbox' }); cmp.checked = compareOn();
  cmp.addEventListener('change', () => setCompare(cmp.checked));
  const save = el('button', { type: 'button', onclick: () => { setNick(nickIn.value); nickMsg.textContent = 'Saved. It applies from your next run.'; } }, 'Save nickname');
  async function load() {
    out.replaceChildren(el('p', { class: 'muted' }, 'Loading...'));
    try {
      const d = await fetchBoard(game.value, set.value, week.value === '1');
      const rows = d.top.map((r) => el('li', {}, `#${r.rank} ${r.name}: ${r.score} points (${r.solved} solved)`));
      out.replaceChildren(
        el('p', {}, `${d.players} player${d.players === 1 ? '' : 's'}${d.median !== null ? `, median score ${d.median}` : ''}.`),
        d.top.length ? el('ol', { class: 'board-list' }, rows) : el('p', { class: 'muted' }, 'No runs yet. Be the first.'),
        d.me ? el('p', {}, `You: rank ${d.me.rank} of ${d.me.of}`, d.players >= d.minForPercentile ? `, ahead of ${d.me.percentile}%. Title: ` : '', d.players >= d.minForPercentile ? el('strong', {}, titleFor(d.me.percentile)) : '') : el('p', { class: 'muted' }, 'Finish a timed run on this set to appear here.'),
      );
    } catch { out.replaceChildren(el('p', { class: 'muted' }, 'Leaderboard is offline right now. Practice still works and runs are retried later.')); }
  }
  for (const s of [game, set, week]) s.addEventListener('change', load);
  main.append(
    el('h1', {}, 'Leaderboard'),
    el('p', {}, 'Every finished timed run uploads its score with a random ID. No IP address is stored. A nickname is optional and shown publicly.'),
    el('div', { class: 'board-controls' }, game, set, week),
    out,
    el('h2', {}, 'Your settings'),
    el('div', {}, nickIn, ' ', save, ' ', nickMsg),
    el('label', {}, cmp, ' Show "you vs others" after each run'),
    el('p', { class: 'muted' }, 'Titles by percentile: ' + TITLES.slice().reverse().map(([m, t]) => `${t} (${m}%+)`).join(', ')),
  );
  load();
  return () => {};
}

// Anonymous telemetry: random ID, session, coarse device and behaviour events. No IP, no keystrokes.
const SID = Math.random().toString(36).slice(2, 12);
const VER = '2026-10-18';
const K_SELF = 'cogprep.self.v1';
const GAMES = ['blockslide', 'latinsquare', 'gridmemory', 'operatorswitch', 'digitequation', 'patternrule'];
let firstHit = true, envSent = false, curPage = 'home', pageT0 = Date.now(), leftPage = false;
const itemIdx = {};
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

let wired = false;
export function startTelemetry() {
  if (wired || typeof window === 'undefined') return; wired = true;
  onAttemptSaved((a) => {
    const rid = a.runId || a.id;
    if (a.mode === 'exam' && !(rid in itemIdx)) ev('run_start', a.game, { game: a.game, set: a.set, mode: 'exam', rid: String(rid).slice(0, 20) });
    const i = itemIdx[rid] = (itemIdx[rid] || 0) + 1;
    ev('item', a.game, { game: a.game, set: a.set, mode: a.mode, rid: String(rid).slice(0, 20), i, ms: Math.round((a.metrics && a.metrics.totalMs) || 0), ok: a.outcome === 'solved', skip: a.outcome === 'skipped', hint: (a.hintsUsed || 0) > 0 });
  });
  onRunSaved((r) => ev('run_end', r.game, { game: r.game, set: r.set, mode: 'exam', rid: String(r.id).slice(0, 20), n: Math.round(r.attempted || 0), ms: Math.round(r.durationMs || 0) }));
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !leftPage) { leftPage = true; ev('leave', curPage, { dur: Math.min(Date.now() - pageT0, 14400000) }); } else if (document.visibilityState === 'visible' && leftPage) { leftPage = false; pageT0 = Date.now(); } });
  document.addEventListener('click', (e) => { const a = e.target && e.target.closest && e.target.closest('a[href^="http"]'); if (a) { try { const u = new URL(a.href); if (u.hostname !== location.hostname) ev('link_click', curPage, { tgt: u.hostname.slice(0, 40) }); } catch { /* ignore */ } } }, true);
  addEventListener('error', (e) => { ev('js_error', curPage, { name: String(e.message || 'error').replace(/[^A-Za-z0-9 ._]/g, '').slice(0, 24), src: String(e.filename || '').split('/').pop().slice(0, 40), line: e.lineno || 0 }); });
  addEventListener('unhandledrejection', () => ev('js_error', curPage, { name: 'unhandledrejection' }));
  addEventListener('load', () => setTimeout(() => {
    try { const n = performance.getEntriesByType('navigation')[0], fcp = performance.getEntriesByName('first-contentful-paint')[0];
      ev('perf', 'home', { ttfb: Math.round(n ? n.responseStart : 0), fcp: Math.round(fcp ? fcp.startTime : 0) }); } catch { /* ignore */ }
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
export function runExtras(game, set, improved) {
  const st = bumpStreak();
  const box = el('div', { class: 'run-extras' });
  if (improved) box.append(el('p', { class: 'callout callout-ok', text: 'Personal best! New top score for this set.' }));
  box.append(el('p', { class: 'muted', text: `Streak: ${st.count} day${st.count === 1 ? '' : 's'} in a row (best ${st.best}). ${st.total} runs finished on this browser.` }));
  const slot = el('div', {}); box.append(slot);
  if (compareOn()) setTimeout(async () => { const n = await compareStrip(game, set); if (n) slot.replaceChildren(n); }, 2500);
  return box;
}
