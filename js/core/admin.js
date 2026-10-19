// Admin analytics dashboard (#/admin). Fetches /stats from the cogprep-board backend.
// Token is kept in sessionStorage only (never saved permanently or committed).
// Layout follows the admin design spec: a "Next actions" block, then six MECE accordion
// sections (Reach, Engagement funnel, Game quality, Retention, Termly conversion, Health).
// Verdict helpers and insights() are pure and exported for tests.
import { el } from './dom.js';
import { base, cid } from './board.js';
import { barChart } from './charts.js';

const K_ADMIN_TOKEN = 'cogprep.admin_token';
const K_SELF = 'cogprep.self.v1';
const K_OPEN = 'cogprep.admin.open.v1';

// Below this denominator no percentages, deltas or rates are shown.
export const MIN_N = 20;
// Hourly and weekday views only earn space past this many visitors per 30 days.
const TIME_OF_DAY_MIN = 300;

export const FUNNEL_STAGES = [
  ['visited', 'Visited'],
  ['opened_a_game', 'Opened a game'],
  ['started_a_game', 'Started a game'],
  ['selected_a_set', 'Picked a set'],
  ['run_started', 'Started a run'],
  ['run_ended', 'Finished a run'],
  ['result_action_taken', 'Used result screen'],
  ['viewed_progress_or_board', 'Saw progress or board'],
];
const STAGE_LABEL = Object.fromEntries(FUNNEL_STAGES);
// Where to look when people drop before reaching a stage.
const STAGE_SECTION = {
  opened_a_game: 'reach', started_a_game: 'quality', selected_a_set: 'quality', run_started: 'quality',
  run_ended: 'quality', result_action_taken: 'retention', viewed_progress_or_board: 'retention',
};

export const SECTIONS = [
  { id: 'next', title: 'Next actions', open: true },
  { id: 'reach', title: 'Reach', open: true },
  { id: 'funnel', title: 'Engagement funnel', open: true },
  { id: 'quality', title: 'Game quality', open: false },
  { id: 'retention', title: 'Retention', open: false },
  { id: 'termly', title: 'Termly conversion', open: false },
  { id: 'health', title: 'Health', open: false },
];
const SECTION_TITLE = Object.fromEntries(SECTIONS.map((s) => [s.id, s.title]));

const GAME_NAMES = {
  blockslide: 'Block Slide', latinsquare: 'Latin Square', gridmemory: 'Grid Memory',
  operatorswitch: 'Operator Switch', digitequation: 'Digit Equation', patternrule: 'Pattern Rule',
};
export const gameName = (g) => GAME_NAMES[g] || String(g);

// ------------------------------------------------------------------ pure helpers

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sumValues = (obj) => Object.values(obj || {}).reduce((a, v) => a + num(v), 0);

export function sampleSuffix(n) {
  if (n < MIN_N) return ' (tiny sample)';
  if (n < 100) return ' (small sample)';
  return '';
}

// Rounded percentage, or null when the denominator is too small to quote one.
export function pct(x, n) {
  if (!(n >= MIN_N)) return null;
  return Math.round((100 * x) / n);
}

// "x of n", with "(p%)" only once n reaches MIN_N.
export function fraction(x, n) {
  const p = pct(x, n);
  return p === null ? `${x} of ${n}` : `${x} of ${n} (${p}%)`;
}

// Bar label: buckets under 5 render as "<5" so tiny counts are not over-read.
export function bucketLabel(v) {
  const n = num(v);
  if (n > 0 && n < 5) return '<5';
  return String(n);
}

export function median(values) {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const verdict = (text, tone = 'neutral') => ({ text, tone });

// Reach: compare unique visitors with the prior period when /stats provides one.
export function prevUniqueVisitors(d) {
  const p = d?.prev?.uniqueVisitors ?? d?.prevUniqueVisitors;
  return p === undefined || p === null ? null : num(p);
}

export function reachVerdict(cur, prev) {
  if (prev === null || prev === undefined) return verdict('No prior period to compare yet' + sampleSuffix(cur));
  if (cur < MIN_N || prev < MIN_N) return verdict('Too small to trend' + sampleSuffix(Math.min(cur, prev)));
  const delta = prev ? (cur - prev) / prev : 0;
  const tail = `, ${cur} vs ${prev}` + sampleSuffix(Math.min(cur, prev));
  if (delta >= 0.2) return verdict('Growing' + tail, 'ok');
  if (delta <= -0.2) return verdict('Shrinking' + tail, 'warn');
  return verdict('Flat' + tail, 'mid');
}

// Largest absolute drop between adjacent funnel stages whose upstream count is at least minUpstream.
export function funnelLeak(funnel, minUpstream = 0) {
  const f = funnel || {};
  let best = null;
  for (let i = 1; i < FUNNEL_STAGES.length; i++) {
    const from = FUNNEL_STAGES[i - 1][0];
    const to = FUNNEL_STAGES[i][0];
    const up = num(f[from]);
    const lost = up - num(f[to]);
    if (up < minUpstream || lost <= 0) continue;
    if (!best || lost > best.lost) best = { from, to, lost, upstream: up };
  }
  return best;
}

export function funnelVerdict(funnel) {
  const n = num(funnel?.visited);
  const leak = funnelLeak(funnel);
  if (!leak) return verdict('No drop between stages yet' + sampleSuffix(n));
  return verdict(`Biggest leak: ${STAGE_LABEL[leak.from]} to ${STAGE_LABEL[leak.to]} (lost ${leak.lost})` + sampleSuffix(n), 'warn');
}

export function qualityVerdict(abandon, gameFinishes) {
  const ab = abandon || {};
  const starts = num(ab.examStarts);
  const quits = num(ab.examAbandons);
  const finishes = sumValues(gameFinishes);
  if (!starts) return verdict('No timed runs yet');
  if (quits > finishes) return verdict('Timed runs lose more than they finish' + sampleSuffix(starts), 'warn');
  return verdict(`Timed runs finish more than they quit (${finishes} vs ${quits})` + sampleSuffix(starts), 'ok');
}

export function retentionVerdict(ret) {
  const n = num(ret?.visitors);
  const back = num(ret?.returnedAfter7d);
  if (n < MIN_N) return verdict(`Early signal only; need ~${MIN_N - n} more visitors for a rate` + sampleSuffix(n));
  const r = back / n;
  if (r >= 0.15) return verdict('Sticky' + sampleSuffix(n), 'ok');
  if (r < 0.05) return verdict('One-and-done' + sampleSuffix(n), 'warn');
  return verdict('Some come back' + sampleSuffix(n), 'mid');
}

// Per placement Termly rows when /stats has a termly block, else null.
export function termlyRows(d) {
  const t = d?.termly;
  if (!t || typeof t !== 'object') return null;
  return Object.entries(t)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([placement, v]) => ({
      placement,
      eligible: v.eligible === undefined || v.eligible === null ? null : num(v.eligible),
      shown: num(v.shown),
      clicks: num(v.clicks),
      dismissed: num(v.dismissed ?? v.dismiss),
    }));
}

export function termlyTotals(d) {
  const rows = termlyRows(d);
  if (rows) {
    const add = (k) => rows.reduce((a, r) => a + r[k], 0);
    return { perPlacement: true, rows, shown: add('shown'), clicks: add('clicks'), dismissed: add('dismissed') };
  }
  const f = d?.features || {};
  const clicks = Object.entries(d?.linkClicks || {})
    .filter(([host]) => /termly/i.test(host))
    .reduce((a, [, v]) => a + num(v), 0);
  return { perPlacement: false, rows: null, shown: num(f.maker_show), clicks, dismissed: num(f.maker_dismiss) };
}

// Verdict for one placement row or for the site totals.
export function termlyVerdict({ shown = 0, clicks = 0, dismissed = 0, eligible = null }) {
  if (shown >= MIN_N && dismissed > 0 && dismissed >= 3 * clicks) return verdict('Card is being swatted away' + sampleSuffix(shown), 'warn');
  if (eligible !== null && eligible >= MIN_N && shown / eligible < 0.5) return verdict('Placement rarely renders, check trigger' + sampleSuffix(eligible), 'warn');
  if (shown < MIN_N) return verdict(`Need ~${MIN_N - shown} more shows for a rate` + sampleSuffix(shown));
  if (clicks === 0) return verdict('Shown but never clicked' + sampleSuffix(shown), 'warn');
  return verdict(`Clicked ${fraction(clicks, shown)} shown` + sampleSuffix(shown), 'ok');
}

export function errorCount(d) {
  return (d?.errors || []).reduce((a, e) => a + num(e?.n), 0);
}

const secs = (ms) => `${(num(ms) / 1000).toFixed(1)}s`;

// Health verdict lines; an empty list means healthy.
export function healthVerdicts(d) {
  const out = [];
  const errs = errorCount(d);
  const perf = d?.perf || {};
  if (errs > 0) {
    const top = [...(d.errors || [])].sort((a, b) => num(b.n) - num(a.n))[0];
    out.push(verdict(`${errs} errors, top: ${String(top?.hash || 'unknown')}`, 'warn'));
  }
  if (num(perf.lcpP95) > 2500) out.push(verdict(`Slow on mobile: LCP p95 ${secs(perf.lcpP95)}` + sampleSuffix(num(perf.n)), 'warn'));
  if (num(d?.uploadFails) > 0) out.push(verdict(`${num(d.uploadFails)} score uploads failed`, 'warn'));
  return out;
}

// Games with enough starts whose finish rate is below half the site median.
export function losingGames(d) {
  const starts = d?.gameStarts || {};
  const fin = d?.gameFinishes || {};
  const rates = Object.entries(starts).filter(([, s]) => num(s) > 0).map(([g, s]) => [g, num(fin[g]) / num(s)]);
  const med = median(rates.map(([, r]) => r));
  if (med === null) return [];
  return rates
    .filter(([g, r]) => num(starts[g]) >= 10 && r < med / 2)
    .sort((a, b) => num(starts[b[0]]) - num(starts[a[0]]))
    .map(([g]) => ({ game: g, starts: num(starts[g]), finishes: num(fin[g]), hotspot: worstHotspot(d, g) }));
}

function hotspotScore(h) {
  return num(h.n) * (1 - num(h.okRate));
}

function worstHotspot(d, game) {
  const hs = (d?.itemHotspots || []).filter((h) => String(h.item).startsWith(game + '/'));
  hs.sort((a, b) => hotspotScore(b) - hotspotScore(a));
  return hs[0]?.item || null;
}

function lockedTapTotal(d) {
  return sumValues(d?.setFriction?.lockedTaps);
}

function periodLabel(days) {
  return num(days) === 30 ? 'this month' : `in the last ${num(days) || 30} days`;
}

// Top-of-page actions, max 5, ordered by priority (spec section 7).
export function insights(d) {
  const out = [];
  const errs = errorCount(d);
  const perf = d?.perf || {};
  const slow = num(perf.lcpP95) > 4000;
  const upFails = num(d?.uploadFails);
  if (errs > 0 || upFails > 0 || slow) {
    const parts = [];
    if (errs > 0) parts.push(`${errs} errors`);
    if (upFails > 0) parts.push(`${upFails} failed uploads`);
    if (slow) parts.push(`slow load on mobile (LCP p95 ${secs(perf.lcpP95)})`);
    out.push({ kind: 'broken', section: 'health', text: `Fix: ${parts.join(' / ')}` });
  }

  const uv = num(d?.uniqueVisitors);
  if (uv < MIN_N) {
    out.push({ kind: 'traffic', section: 'reach', text: 'Not enough traffic to judge anything yet; get visitors first' });
    return out;
  }

  const leak = funnelLeak(d?.funnel, 10);
  if (leak) {
    if (leak.to === 'selected_a_set' && lockedTapTotal(d) > 0) {
      out.push({ kind: 'leak', section: 'quality', text: `People tap locked sets; consider unlocking one more (lost ${leak.lost} of ${leak.upstream} before picking a set)` });
    } else {
      const sec = STAGE_SECTION[leak.to] || 'funnel';
      out.push({ kind: 'leak', section: sec, text: `Most people drop at ${STAGE_LABEL[leak.to]} (lost ${leak.lost} of ${leak.upstream}); look at ${SECTION_TITLE[sec]}` });
    }
  }

  for (const g of losingGames(d)) {
    const where = g.hotspot ? `check hotspot ${g.hotspot}` : 'check its first items';
    out.push({ kind: 'game', section: 'quality', text: `${gameName(g.game)} loses players (${g.finishes} of ${g.starts} finished); ${where}` });
  }

  const tt = termlyTotals(d);
  if (tt.shown >= MIN_N && tt.clicks === 0) {
    out.push({ kind: 'termly', section: 'termly', text: 'Termly card gets no clicks, try new placement/copy' });
  } else if (tt.shown >= MIN_N && tt.dismissed > 0 && tt.dismissed >= 3 * tt.clicks) {
    out.push({ kind: 'termly', section: 'termly', text: 'Termly card is being dismissed' });
  }

  const prev = prevUniqueVisitors(d);
  if (prev !== null && prev >= MIN_N && uv < prev * 1.2) {
    const src = topSources(d, 1)[0]?.label || 'direct';
    out.push({ kind: 'traffic', section: 'reach', text: `Traffic flat; top source is ${src}, double down or add a new one` });
  }

  if (!out.length) {
    const runs = num(d?.funnel?.run_ended ?? sumValues(d?.gameFinishes));
    out.push({ kind: 'ok', section: null, text: `Nothing urgent. ${runs} runs finished, ${tt.clicks} Termly clicks ${periodLabel(d?.days)}.` });
  }
  return out.slice(0, 5);
}

// Top sources by visitors with an "other" bucket; falls back to referrers when sources are mostly direct.
export function topSources(d, n = 5) {
  const src = Object.entries(d?.sources || {}).map(([k, v]) => [k, num(v?.visitors ?? v)]);
  const total = src.reduce((a, [, v]) => a + v, 0);
  const direct = src.filter(([k]) => k === 'direct').reduce((a, [, v]) => a + v, 0);
  const refs = Object.entries(d?.referrers || {}).map(([k, v]) => [k, num(v)]);
  const useRefs = (!total || direct / total >= 0.8) && refs.some(([k]) => k !== 'direct');
  const list = (useRefs ? refs : src).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const head = list.slice(0, n).map(([label, value]) => ({ label, value }));
  const rest = list.slice(n).reduce((a, [, v]) => a + v, 0);
  if (rest > 0) head.push({ label: 'other', value: rest });
  return head;
}

// ------------------------------------------------------------------ rendering helpers

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const c of kids) if (c) node.append(c);
  return node;
}

function verdictLine(v) {
  return el('p', { class: `adm-verdict tone-${v.tone}` }, el('span', { class: 'adm-dot', 'aria-hidden': 'true' }), v.text);
}

function tile(value, label, v) {
  return el('div', { class: 'adm-tile' },
    el('div', { class: 'adm-tile-num', text: String(value) }),
    el('div', { class: 'adm-tile-label', text: label }),
    v ? verdictLine(v) : null);
}

function tiles(...kids) {
  return el('div', { class: 'adm-tiles' }, ...kids);
}

function pill(text) {
  return el('span', { class: 'adm-pill', text });
}

function pills(...kids) {
  return el('div', { class: 'adm-pills' }, ...kids.flat());
}

function sub(text) {
  return el('h3', { class: 'adm-sub', text });
}

function note(text) {
  return el('p', { class: 'adm-note', text });
}

// Horizontal bars as plain divs. rows: [{ label, value, extra?, track? }].
function hbars(rows, { label = 'Bar chart', tall = false } = {}) {
  const max = Math.max(1, ...rows.map((r) => num(r.track ?? r.value)));
  return el('div', { class: `adm-bars${tall ? ' adm-bars-tall' : ''}`, role: 'list', 'aria-label': label },
    ...rows.map((r) => {
      const w = Math.max(0, Math.min(100, (100 * num(r.value)) / (r.track ? num(r.track) || 1 : max)));
      return el('div', { class: 'adm-bar-row', role: 'listitem', 'aria-label': `${r.label}: ${num(r.value)}${r.extra ? ', ' + r.extra : ''}` },
        el('span', { class: 'adm-bar-label', text: r.label }),
        el('span', { class: `adm-bar-track${r.track ? ' is-bg' : ''}` }, el('span', { class: `adm-bar-fill${num(r.value) ? '' : ' is-zero'}`, style: { width: `${w}%` } })),
        el('span', { class: 'adm-bar-val' }, bucketLabel(r.value), r.extra ? el('span', { class: 'adm-bar-extra', text: r.extra }) : null));
    }));
}

// Grouped bars: two values per row (for example starts and finishes per game).
function groupedBars(rows, names, label) {
  const max = Math.max(1, ...rows.flatMap((r) => [num(r.a), num(r.b)]));
  const bar = (v, cls, name) => el('span', { class: 'adm-gbar' },
    el('span', { class: 'adm-bar-track' }, el('span', { class: `adm-bar-fill ${cls}${num(v) ? '' : ' is-zero'}`, style: { width: `${(100 * num(v)) / max}%` } })),
    el('span', { class: 'adm-bar-val', text: `${bucketLabel(v)} ${name}` }));
  return el('div', { class: 'adm-bars adm-bars-tall', role: 'list', 'aria-label': label },
    ...rows.map((r) => el('div', { class: 'adm-grow', role: 'listitem', 'aria-label': `${r.label}: ${num(r.a)} ${names[0]}, ${num(r.b)} ${names[1]}` },
      el('span', { class: 'adm-bar-label', text: r.label }),
      el('span', { class: 'adm-gpair' }, bar(r.a, 'is-a', names[0]), bar(r.b, 'is-b', names[1])))));
}

// Table with at most 3 columns; extra detail goes on a second line in the first cell (card-row pattern).
function table(caption, head, rows, limit = 5) {
  const body = el('tbody', {});
  const draw = (all) => body.replaceChildren(...(all ? rows : rows.slice(0, limit)).map((r) => el('tr', {},
    el('td', {}, el('span', { class: 'adm-cell-main', text: r[0] }), r.detail ? el('span', { class: 'adm-cell-sub', text: r.detail }) : null),
    ...r.slice(1).map((c) => el('td', { class: 'adm-num', text: String(c) })))));
  draw(false);
  const t = el('table', { class: 'adm-table' },
    el('caption', { class: 'sr-only adm-sr', text: caption }),
    el('thead', {}, el('tr', {}, ...head.map((h, i) => el('th', { scope: 'col', class: i ? 'adm-num' : null, text: h })))),
    body);
  if (rows.length <= limit) return t;
  let all = false;
  const btn = el('button', {
    type: 'button', class: 'btn btn-quiet btn-small adm-more', 'aria-expanded': 'false',
    text: `Show all ${rows.length}`,
    onclick: () => {
      all = !all; draw(all);
      btn.textContent = all ? `Show top ${limit}` : `Show all ${rows.length}`;
      btn.setAttribute('aria-expanded', String(all));
    },
  });
  return el('div', {}, t, btn);
}

function localKey(t) {
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// Daily unique visitors as bars plus a trailing 7-day average line.
function dailyChart(daily, days) {
  const pts = [];
  for (let i = Math.min(num(days) || 30, 90) - 1; i >= 0; i--) {
    const k = localKey(new Date(Date.now() - i * 864e5));
    pts.push({ k, v: num(daily?.[k]?.unique) });
  }
  const W = pts.length * 10;
  const H = 100;
  const max = Math.max(1, ...pts.map((p) => p.v));
  const y = (v) => H - (v / max) * (H - 4);
  const bars = pts.map((p, i) => svg('rect', { x: i * 10 + 1, y: y(p.v), width: 8, height: H - y(p.v), class: 'adm-svg-bar' }));
  const line = [];
  pts.forEach((_, i) => {
    if (i < 6) return;
    const avg = pts.slice(i - 6, i + 1).reduce((a, p) => a + p.v, 0) / 7;
    line.push(`${i * 10 + 5},${y(avg).toFixed(1)}`);
  });
  const peak = pts.reduce((a, p) => (p.v > a.v ? p : a), pts[0]);
  const total = pts.filter((p) => p.v > 0).length;
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'adm-daily', role: 'img',
    'aria-label': `Daily unique visitors over ${pts.length} days; ${total} days with visits; peak ${peak.v} on ${peak.k}` },
  svg('line', { x1: 0, y1: H, x2: W, y2: H, class: 'adm-svg-axis' }),
  ...bars,
  line.length > 1 ? svg('polyline', { points: line.join(' '), class: 'adm-svg-line' }) : null);
  return el('figure', { class: 'adm-figure' },
    chart,
    el('div', { class: 'adm-axis' }, el('span', { text: pts[0].k.slice(5) }), el('span', { text: `peak ${peak.v} on ${peak.k.slice(5)}` }), el('span', { text: pts[pts.length - 1].k.slice(5) })),
    el('figcaption', { class: 'adm-note', text: 'Bars: daily unique visitors. Line: rolling 7-day average.' }));
}

function stackedBar(a, b, labels) {
  const total = a + b || 1;
  return el('div', { class: 'adm-stack', role: 'img', 'aria-label': `${labels[0]} ${a}, ${labels[1]} ${b}` },
    el('div', { class: 'adm-stack-bar' },
      el('span', { class: 'adm-stack-a', style: { width: `${(100 * a) / total}%` } }),
      el('span', { class: 'adm-stack-b', style: { width: `${(100 * b) / total}%` } })),
    el('div', { class: 'adm-stack-legend' },
      el('span', {}, el('span', { class: 'adm-key adm-stack-a', 'aria-hidden': 'true' }), `${labels[0]} ${a}`),
      el('span', {}, el('span', { class: 'adm-key adm-stack-b', 'aria-hidden': 'true' }), `${labels[1]} ${b}`)));
}

function dictLine(label, obj) {
  const e = Object.entries(obj || {}).filter(([, v]) => num(v) > 0).sort((x, y) => num(y[1]) - num(x[1]));
  if (!e.length) return null;
  return el('p', { class: 'adm-line' }, el('strong', { text: `${label}: ` }), e.slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', '));
}

// ------------------------------------------------------------------ sections

function reachSection(d, days) {
  const uv = num(d.uniqueVisitors);
  const prev = prevUniqueVisitors(d);
  const devs = d.devices || {};
  const devN = sumValues(devs);
  const mobile = num(devs.mobile);
  const devText = devN >= MIN_N ? `${pct(mobile, devN)}% mobile (n=${devN})` : `${mobile} of ${devN} mobile`;
  const srcs = topSources(d);
  const utmKeys = Object.keys(d.utm || {});
  const audience = [dictLine('Browsers', d.browsers), dictLine('OS', d.os), dictLine('Languages', d.languages)].filter(Boolean);
  const perMonth = (uv * 30) / (num(days) || 30);
  return [
    tiles(
      tile(uv, `Unique visitors, ${days}d`, reachVerdict(uv, prev)),
      tile(d.medianSessionSec != null ? `${num(d.medianSessionSec)}s` : 'n/a', `Median session (n=${num(d.sessions)})`)),
    sub('Daily visitors'),
    dailyChart(d.daily, days),
    sub('Top sources'),
    srcs.length ? hbars(srcs, { label: 'Visitors by source' }) : note('No source data yet.'),
    utmKeys.length ? dictLine('UTM', Object.fromEntries(Object.entries(d.utm).map(([k, v]) => [k, num(v?.visitors ?? v)]))) : null,
    sub('New vs returning'),
    stackedBar(num(d.newVisitors), num(d.returning), ['New', 'Returning']),
    pills(pill(devText)),
    audience.length ? el('details', { class: 'adm-inner' }, el('summary', { text: 'Audience details' }), ...audience) : null,
    perMonth > TIME_OF_DAY_MIN && (d.hourly || d.weekday)
      ? el('details', { class: 'adm-inner' }, el('summary', { text: 'Time of day and weekday' }),
        barChart({ title: 'Activity by hour', subtitle: 'Server clock hour', bars: Array.from({ length: 24 }, (_, h) => ({ label: String(h), value: num(d.hourly?.[h]) })) }),
        barChart({ title: 'Activity by weekday', subtitle: 'All events', bars: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((k) => ({ label: k, value: num(d.weekday?.[k]) })) }))
      : null,
  ];
}

function funnelSection(d) {
  const f = d.funnel || {};
  const n = num(f.visited);
  const rows = FUNNEL_STAGES.map(([k, label], i) => {
    const v = num(f[k]);
    const prevV = i ? num(f[FUNNEL_STAGES[i - 1][0]]) : null;
    const lost = prevV !== null ? prevV - v : 0;
    return { label, value: v, track: n || 1, extra: lost > 0 ? `lost ${lost}` : null };
  });
  return [
    tiles(tile(fraction(num(f.run_ended), n), 'finished a run', funnelVerdict(f))),
    sub('Visit to finished run'),
    hbars(rows, { label: 'Engagement funnel', tall: true }),
    pills(pill(`Mode picks: ${num(d.features?.mode_choice)}`)),
    note('Practice vs timed split of mode picks is not instrumented yet.'),
  ];
}

function qualitySection(d) {
  const ab = d.abandon || {};
  const starts = d.gameStarts || {};
  const fin = d.gameFinishes || {};
  const games = Object.keys({ ...starts, ...fin }).sort((a, b) => num(starts[b]) - num(starts[a]));
  const hs = [...(d.itemHotspots || [])].sort((a, b) => hotspotScore(b) - hotspotScore(a));
  const hsRows = hs.map((h) => {
    const [g, ...rest] = String(h.item).split('/');
    const r = [rest.join('/') || String(h.item), num(h.n), Math.round(num(h.n) * num(h.skipRate))];
    r.detail = gameName(g);
    return r;
  });
  const exits = Object.entries(ab.byExit || {}).sort((a, b) => num(b[1]) - num(a[1])).map(([label, value]) => ({ label, value: num(value) }));
  const locked = lockedTapTotal(d);
  const lockedSets = Object.keys(d.setFriction?.lockedTaps || {}).length;
  const practice = num(ab.practiceStarts);
  return [
    tiles(
      tile(`${num(ab.examAbandons)} of ${num(ab.examStarts)}`, 'Timed: quit mid-run', qualityVerdict(ab, fin)),
      tile(practice ? `${num(ab.practiceAbandons)} of ${practice}` : '0', practice ? 'Practice: quit mid-run' : 'Practice runs tracked')),
    sub('Starts vs finishes by game'),
    games.length ? groupedBars(games.map((g) => ({ label: gameName(g), a: starts[g], b: fin[g] })), ['started', 'finished'], 'Starts and finishes by game') : note('No game starts yet.'),
    sub('Where they quit'),
    exits.length ? hbars(exits, { label: 'Abandons by exit' }) : note('No abandons recorded.'),
    sub('Item hotspots'),
    hsRows.length ? table('Items with the most misses', ['Item', 'Seen', 'Skipped'], hsRows) : note('No hotspot data yet.'),
    pills(
      pill(`Locked set taps: ${locked}${lockedSets ? ` on ${lockedSets} sets` : ''}`),
      d.setFriction?.runsToUnlockMedian != null ? pill(`Runs to unlock, median: ${num(d.setFriction.runsToUnlockMedian)}`) : null,
      ab.medianItemsSeen != null ? pill(`Items seen before quit, median: ${num(ab.medianItemsSeen)} (n=${num(ab.total)})`) : null),
  ];
}

function retentionSection(d) {
  const r = d.retention || {};
  const n = num(r.visitors);
  const post = Object.entries(d.postRun || {}).sort((a, b) => num(b[1]) - num(a[1]));
  const top = post.slice(0, 5).map(([k, v]) => pill(`${k.replace(/_/g, ' ')}: ${v}`));
  const rest = post.slice(5).reduce((a, [, v]) => a + num(v), 0);
  return [
    tiles(
      tile(fraction(num(r.returnedAfter7d), n), 'came back within 7d', retentionVerdict(r)),
      tile(num(d.players), 'Players (finished 1+ run)')),
    sub('Came back'),
    hbars([
      { label: 'Next day', value: num(r.returnedNextDay), track: n || 1 },
      { label: 'After 7 days', value: num(r.returnedAfter7d), track: n || 1 },
    ], { label: `Returning visitors out of ${n}` }),
    note(`Faint track is all ${n} visitors.`),
    post.length ? sub('After a run, they chose') : null,
    post.length ? pills(...top, rest ? pill(`other: ${rest}`) : null) : null,
  ];
}

function termlyMini(row) {
  const rows = [];
  if (row.eligible !== null) rows.push({ label: 'Eligible', value: row.eligible });
  rows.push({ label: 'Shown', value: row.shown }, { label: 'Clicked', value: row.clicks });
  return el('div', { class: 'adm-termly-row' },
    el('h4', { class: 'adm-sub', text: row.placement.replace(/_/g, ' ') }),
    el('p', { class: 'adm-line', text: `Clicked ${row.clicks} of ${row.shown} shown; dismissed ${row.dismissed}` }),
    verdictLine(termlyVerdict(row)),
    hbars(rows, { label: `Termly funnel for ${row.placement}` }));
}

function termlySection(d) {
  const t = termlyTotals(d);
  const out = [
    tiles(tile(`${t.clicks} clicks`, `from ${t.shown} shows`, termlyVerdict(t)), tile(t.dismissed, 'Dismissed')),
  ];
  if (t.perPlacement) {
    const active = t.rows.filter((r) => r.shown || r.clicks || r.dismissed || r.eligible);
    out.push(sub('By placement'));
    out.push(active.length ? el('div', {}, ...active.map(termlyMini)) : note('No placement has been shown yet.'));
  } else {
    out.push(sub('Site totals'));
    out.push(hbars([{ label: 'Shown', value: t.shown }, { label: 'Clicked', value: t.clicks }], { label: 'Termly site totals' }));
    out.push(note('Per placement counts need a server update.'));
  }
  return out;
}

function healthSection(d) {
  const perf = d.perf || {};
  const errs = errorCount(d);
  const lines = healthVerdicts(d);
  const errRows = [...(d.errors || [])].sort((a, b) => num(b.n) - num(a.n)).map((e) => {
    const r = [String(e.hash), num(e.n)];
    r.detail = e.game ? String(e.game) : '';
    return r;
  });
  const builds = Object.entries(d.builds || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, v]) => [k, num(v)]);
  const ex = d.excluded || {};
  return [
    tiles(
      tile(errs, 'Client errors', errs ? verdict(`${errs} errors`, 'warn') : verdict('No errors', 'ok')),
      tile(perf.lcpP50 ? secs(perf.lcpP50) : 'n/a', `LCP p50 (n=${num(perf.n)})`,
        num(perf.lcpP95) > 2500 ? verdict(`p95 ${secs(perf.lcpP95)}, slow`, 'warn') : verdict(perf.lcpP95 ? `p95 ${secs(perf.lcpP95)}` : 'No samples'))),
    ...lines.map(verdictLine),
    !lines.length ? verdictLine(verdict('Nothing broken or slow', 'ok')) : null,
    sub('Errors by type'),
    errRows.length ? table('Client errors by type', ['Type', 'Count'], errRows) : note('No errors recorded.'),
    sub('Builds'),
    builds.length ? table('Hits by build', ['Build', 'Hits'], builds) : note('No build data.'),
    note(`Excluded ${num(ex.botHits)} bot hits, ${num(ex.selfHits)} own hits.`),
  ];
}

// ------------------------------------------------------------------ page

function loadOpenState() {
  try { return JSON.parse(localStorage.getItem(K_OPEN) || '{}') || {}; } catch { return {}; }
}

export function mountAdmin(main) {
  const root = el('div', { class: 'adm' });
  main.replaceChildren(root);

  let token = sessionStorage.getItem(K_ADMIN_TOKEN) || '';
  let days = 30;

  function renderLogin(message) {
    root.replaceChildren(
      el('section', { class: 'adm-card adm-login' },
        el('h1', { text: 'Site analytics' }),
        el('p', { class: 'muted', text: 'Enter the admin token to see reach, funnel, game quality, retention, Termly conversion and health.' }),
        el('form', {
          onsubmit: (e) => {
            e.preventDefault();
            const inp = root.querySelector('#admin-tok');
            if (inp && inp.value.trim()) {
              token = inp.value.trim();
              sessionStorage.setItem(K_ADMIN_TOKEN, token);
              loadStats();
            }
          },
        },
        el('label', { for: 'admin-tok', class: 'adm-label', text: 'Stats token' }),
        el('input', { id: 'admin-tok', class: 'adm-input', type: 'password', required: true, autocomplete: 'current-password' }),
        el('button', { type: 'submit', class: 'btn btn-primary adm-wide', text: 'View dashboard' })),
        message ? el('p', { class: 'callout adm-callout-warn', role: 'alert', text: message }) : null));
  }

  function renderMessage(title, msg) {
    root.replaceChildren(
      el('section', { class: 'adm-card adm-login' },
        el('h2', { text: title }),
        el('p', { class: 'callout adm-callout-warn', role: 'alert', text: msg }),
        el('button', { type: 'button', class: 'btn', onclick: () => renderLogin(), text: 'Back to login' })));
  }

  async function loadStats() {
    root.replaceChildren(el('p', { class: 'muted adm-loading', role: 'status', text: 'Loading analytics...' }));
    const b = await base();
    if (!b) {
      renderMessage('Server unreachable', 'Telemetry server is unreachable. Make sure the quick tunnel and service are running.');
      return;
    }
    try {
      const res = await fetch(`${b}/stats?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403 || res.status === 401) {
        sessionStorage.removeItem(K_ADMIN_TOKEN);
        token = '';
        renderLogin('Invalid token. Authorization rejected.');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      renderDashboard(await res.json(), b);
    } catch (err) {
      renderMessage('Unable to load statistics', String(err?.message || err));
    }
  }

  function header(b) {
    const isExcluded = localStorage.getItem(K_SELF) === '1';
    const status = el('span', { class: 'adm-self-status', role: 'status' });
    return el('div', { class: 'adm-head' },
      el('div', { class: 'adm-bar' },
        el('div', { class: 'adm-seg', role: 'group', 'aria-label': 'Period' },
          ...[7, 30, 90].map((n) => el('button', {
            type: 'button', class: `adm-seg-btn${days === n ? ' is-on' : ''}`, 'aria-pressed': String(days === n),
            'aria-label': `Last ${n} days`, text: `${n}d`,
            onclick: () => { if (days !== n) { days = n; loadStats(); } },
          }))),
        el('button', {
          type: 'button', class: 'btn btn-quiet btn-small adm-logout', text: 'Log out',
          onclick: () => { sessionStorage.removeItem(K_ADMIN_TOKEN); token = ''; renderLogin(); },
        })),
      el('div', { class: 'adm-self' },
        el('span', { class: `badge ${isExcluded ? 'badge-ok' : 'badge-warn'}`, text: isExcluded ? 'This browser excluded' : 'This browser counted' }),
        el('button', {
          type: 'button', class: 'btn btn-quiet btn-small', text: isExcluded ? 'Include this browser' : 'Exclude this browser',
          onclick: async () => {
            const next = !isExcluded;
            try {
              const res = await fetch(`${b}/self`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ cid: cid(), on: next }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              if (next) localStorage.setItem(K_SELF, '1');
              else localStorage.removeItem(K_SELF);
              loadStats();
            } catch {
              status.textContent = 'Could not update self-exclusion on the server.';
            }
          },
        }),
        status));
  }

  function nextActions(d, go) {
    const list = insights(d);
    const KIND = { broken: 'Fix', leak: 'Leak', game: 'Game', termly: 'Termly', traffic: 'Traffic', ok: 'OK' };
    return [
      el('ol', { class: 'adm-actions' }, ...list.map((it) => el('li', { class: `adm-action kind-${it.kind}` },
        el('span', { class: 'badge adm-kind', text: KIND[it.kind] || it.kind }),
        el('span', { class: 'adm-action-text', text: it.text }),
        it.section ? el('button', {
          type: 'button', class: 'btn btn-quiet btn-small adm-go', text: 'Open',
          'aria-label': `Open ${SECTION_TITLE[it.section]} section`, onclick: () => go(it.section),
        }) : null))),
    ];
  }

  function renderDashboard(d, b) {
    const open = loadOpenState();
    const nodes = {};
    const go = (id) => {
      const n = nodes[id];
      if (!n) return;
      n.open = true;
      n.scrollIntoView({ behavior: 'smooth', block: 'start' });
      n.querySelector('summary')?.focus();
    };
    const builders = {
      next: () => nextActions(d, go),
      reach: () => reachSection(d, days),
      funnel: () => funnelSection(d),
      quality: () => qualitySection(d),
      retention: () => retentionSection(d),
      termly: () => termlySection(d),
      health: () => healthSection(d),
    };
    const sections = SECTIONS.map((s, i) => {
      const det = el('details', { class: 'adm-sec', id: `adm-${s.id}`, open: (open[s.id] ?? s.open) || null },
        el('summary', { class: 'adm-sec-head' },
          el('h2', { class: 'adm-sec-title', text: i ? `${i}. ${s.title}` : s.title })),
        el('div', { class: 'adm-sec-body' }, ...builders[s.id]()));
      det.addEventListener('toggle', () => {
        const st = loadOpenState();
        st[s.id] = det.open;
        try { localStorage.setItem(K_OPEN, JSON.stringify(st)); } catch { /* storage full or blocked */ }
      });
      nodes[s.id] = det;
      return det;
    });
    const ex = d.excluded || {};
    root.replaceChildren(
      header(b),
      el('h1', { class: 'adm-title', text: 'Site analytics' }),
      el('p', { class: 'adm-note', text: `Last ${days} days. Counts exclude ${num(ex.botHits)} bot hits and ${num(ex.selfHits)} own hits.` }),
      ...sections);
  }

  if (token) loadStats();
  else renderLogin();

  return () => {};
}
