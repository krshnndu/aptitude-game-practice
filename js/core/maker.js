// Termly (the maker's free term planner) touchpoints and the one frequency governor behind them.
// Passive text links (landing line, About card, footer, leaderboard and achievements foot) are
// always shown and never counted. Prompt cards with a close button go through the governor: at most
// 1 shown per tab session across every placement, at most 3 in any 7 days, and never again after one
// click or two dismissals. Never shown during a puzzle or timed run; callers place them on result,
// progress and review pages only. Any storage failure means no prompt.

import { el } from './dom.js';
import { ev } from './board.js';

export const MAKER_KEY = 'cogprep.maker.v1';
export const MAKER_SESSION_KEY = 'cogprep.maker.session.v1';
export const WEEK_MS = 7 * 864e5;
export const PER_WEEK = 3;
export const MAX_DISMISS = 2;
export const PLACEMENTS = ['landing_line', 'result_nudge', 'progress_card', 'review_done', 'achievement', 'board_foot', 'about_card', 'footer'];
const TERMLY_URL = 'https://termly-iimr.vercel.app/welcome';

export const termlyUrl = (placement) => `${TERMLY_URL}?utm_source=cogprep&utm_medium=referral&utm_campaign=${encodeURIComponent(placement)}`;

// local, session: Storage-like. now: clock in ms. State { shows: [ts], dismissed: n, clicked: bool }.
export function createGovernor(local, session, now = () => Date.now()) {
  const load = () => {
    const d = JSON.parse(local.getItem(MAKER_KEY) || 'null');
    return {
      shows: Array.isArray(d?.shows) ? d.shows.filter(Number.isFinite) : [],
      dismissed: Number(d?.dismissed) || 0,
      clicked: !!d?.clicked,
    };
  };
  const save = (d) => local.setItem(MAKER_KEY, JSON.stringify(d));
  const recent = (d) => d.shows.filter((t) => now() - t < WEEK_MS);
  const canShow = () => {
    try {
      if (session.getItem(MAKER_SESSION_KEY)) return false;
      const d = load();
      return !d.clicked && d.dismissed < MAX_DISMISS && recent(d).length < PER_WEEK;
    } catch {
      return false;
    }
  };
  const update = (fn) => {
    try { const d = load(); fn(d); save(d); } catch { /* not persisted */ }
  };
  return {
    canShow,
    // Claims the session slot and records the show. Returns false when the prompt must stay hidden.
    take(placement) {
      if (!canShow()) return false;
      try {
        session.setItem(MAKER_SESSION_KEY, String(placement));
        const d = load();
        d.shows = [...recent(d), now()];
        save(d);
        return true;
      } catch {
        return false;
      }
    },
    click: () => update((d) => { d.clicked = true; }),
    dismiss: () => update((d) => { d.dismissed += 1; }),
    state: () => { try { return load(); } catch { return null; } },
  };
}

let gov = null;
function governor() {
  if (!gov) {
    try { gov = createGovernor(localStorage, sessionStorage); } catch { gov = createGovernor(null, null); }
  }
  return gov;
}

// Any click on a Termly link (data-via, including the static footer) counts as "clicked once", so
// prompt cards stop for good. link_click itself is sent by the outbound listener in board.js.
let watching = false;
export function watchTermlyClicks(doc = globalThis.document) {
  if (watching || !doc) return;
  watching = true;
  doc.addEventListener('click', (e) => { if (e.target?.closest?.('a[data-via]')) governor().click(); }, true);
}

export const termlyLink = (placement, text = 'Termly') =>
  el('a', { href: termlyUrl(placement), target: '_blank', rel: 'noopener', 'data-via': placement }, text);

// Passive line, never counted: "<before><Termly link><after>".
export const termlyLine = (placement, before, text, after = '', cls = 'muted small maker-line') =>
  el('p', { class: cls }, before, termlyLink(placement, text), after);

// Governed prompt: one quiet line with a close button, or null when the governor says no.
export function makerPrompt(placement, page, text, { cls = 'maker-nudge', onDismiss } = {}) {
  if (!governor().take(placement)) return null;
  ev('feat', page, { name: 'maker_show', via: placement });
  const node = el('p', { class: cls },
    termlyLink(placement, text),
    el('button', { type: 'button', class: 'maker-nudge-close', 'aria-label': 'Hide this', onclick: () => {
      governor().dismiss();
      ev('feat', page, { name: 'maker_dismiss', via: placement });
      node.remove();
      onDismiss?.();
    } }, '×'));
  return node;
}

// Admin card rows from /stats. Needs stats.termly = { <placement>: { shown, clicks } } from the server;
// returns null when it is missing (the server does not keep per placement data yet).
export function termlyFunnel(stats) {
  const t = stats?.termly;
  if (!t || typeof t !== 'object') return null;
  return PLACEMENTS.map((p) => ({ placement: p, shown: Number(t[p]?.shown) || 0, clicks: Number(t[p]?.clicks) || 0 }));
}
