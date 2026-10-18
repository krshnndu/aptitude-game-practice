// Anonymous run upload and leaderboard client. Endpoint comes from endpoint.json (same origin) so the
// tunnel URL can change without a code change. Failures are silent and retried later.
import { el } from './dom.js';
import { onRunSaved } from './recorder.js';

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

// Page-view tracking: random ID, page name, session, coarse device and referrer host only.
const SID = Math.random().toString(36).slice(2, 12);
let firstHit = true;
export async function track(page) {
  try {
    const b = await base(); if (!b) return;
    const w = innerWidth, first = firstHit; firstHit = false;
    let ref = ''; if (first && document.referrer) { try { const h = new URL(document.referrer).hostname; if (h !== location.hostname) ref = h; } catch { /* ignore */ } }
    fetch(b + '/hit', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ cid: cid(), sid: SID, page: page || 'home', first, ref, dev: w < 600 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop' }) }).catch(() => {});
  } catch { /* never break the site */ }
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
