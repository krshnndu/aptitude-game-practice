// Shared plumbing for the learning pages: one load of the play archive and the learning data, the
// notebook catch-up sync, cached achievements, and small widgets (tier chip, game tabs, tables).

import { el } from './dom.js';
import { createRecorder } from './recorder.js';
import { GAMES, GAME_IDS, gameName } from './games.js';
import { ADAPTERS, correctFor, timeFor, parFor } from './learn-registry.js';
import { learnStore } from './learn-hooks.js';
import { syncItems } from './notebook.js';
import { skillSummary, FORMULA } from './skill.js';
import { computeAchievements, mergeUnlocked, achievementStamp } from './achievements.js';
import { dueCounts } from './srs.js';

export { GAMES, GAME_IDS, gameName, FORMULA };

export const pctText = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : 'none');
export const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const fmtShort = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const signed = (x) => (x > 0 ? `+${x}` : String(x));

// Catch-up: notebook items for qualifying attempts the hooks did not see (older history, closed tabs).
export function syncNotebook(data, store = learnStore(), now = Date.now()) {
  const ld = store.load();
  const runs = new Map(data.runs.map((r) => [r.id, r]));
  const fresh = syncItems(data.attempts, ld.items, {
    lastSync: ld.lastSync,
    now,
    correctFor,
    refFor: (a) => ADAPTERS[a.game]?.refFor(a, null, { run: runs.get(a.runId) ?? null }),
    tagsOf: (a) => ld.tags[a.id] ?? [],
  });
  if (fresh.length || !ld.lastSync) {
    store.update((d) => {
      const have = new Set(d.items.map((i) => i.id));
      for (const it of fresh) if (!have.has(it.id)) d.items.push(it);
      d.lastSync = now;
    });
  }
  return fresh.length;
}

export function loadContext({ now = Date.now(), sync = true } = {}) {
  const recorder = createRecorder();
  const data = recorder.load();
  const store = learnStore();
  if (sync && !recorder.readOnly) syncNotebook(data, store, now);
  const learn = store.load();
  const attempts = data.attempts.filter((a) => !a.sample);
  const byGame = Object.fromEntries(GAME_IDS.map((g) => [g, attempts.filter((a) => a.game === g)]));
  const skill = skillSummary(GAME_IDS, byGame, {
    now,
    time: Object.fromEntries(GAME_IDS.map((g) => [g, timeFor(g)])),
    correct: Object.fromEntries(GAME_IDS.map((g) => [g, correctFor(g)])),
  });
  const tagsOf = (a) => learn.tags[a.id];
  return { now, recorder, data, attempts, store, learn, byGame, skill, tagsOf, due: dueCounts(learn.items, now) };
}

// Achievements, recomputed only when the inputs changed (stamp), unlocks kept for good.
export function achievementsFor(ctx) {
  const stamp = achievementStamp(ctx.attempts, ctx.learn);
  if (ctx.learn.cache?.stamp === stamp && Array.isArray(ctx.learn.cache.list)) return { list: ctx.learn.cache.list, newly: [] };
  const raw = computeAchievements({ attempts: ctx.attempts, learn: ctx.learn, now: ctx.now, games: GAME_IDS, correct: correctFor, time: timeFor, par: parFor });
  const { list, unlocked, newly } = mergeUnlocked(raw, ctx.learn.unlocked, ctx.now);
  ctx.store.update((d) => {
    d.unlocked = unlocked;
    d.cache = { stamp, list };
  });
  return { list, newly };
}

export function tierChip(skill, { href = '#/achievements', small = false } = {}) {
  const label = `Overall badge: ${skill.tier}, score ${Math.round(skill.overall)} of 100`;
  return el('a', { class: `tier-chip tier-${skill.tier.toLowerCase()}${small ? ' tier-chip-small' : ''}`, href, 'aria-label': label, title: label },
    el('span', { class: 'tier-dot', 'aria-hidden': 'true' }), `${skill.tier} ${Math.round(skill.overall)}`);
}

// Updates the badge chip in the site header (called by the shell after every route).
export function refreshNavChip() {
  const slot = document.getElementById('nav-chip');
  if (!slot) return;
  try {
    const ctx = loadContext({ sync: false });
    slot.replaceChildren(tierChip(ctx.skill, { small: true }));
  } catch (err) {
    console.error(err);
  }
}

export function gameTabs(current, hrefFor, label) {
  return el('nav', { class: 'game-tabs', 'aria-label': label },
    el('ul', { role: 'list' }, GAMES.map((g) => el('li', {}, el('a', { href: hrefFor(g.id), 'aria-current': g.id === current ? 'page' : null }, g.name)))));
}

export function table(caption, cols, rows, { cls = 'results' } = {}) {
  return el('div', { class: 'table-wrap' },
    el('table', { class: cls },
      el('caption', { class: 'sr-only', text: caption }),
      el('thead', {}, el('tr', {}, cols.map((c) => el('th', { scope: 'col', text: c })))),
      el('tbody', {}, rows.map((r) => el('tr', {}, r.map((v) => el('td', {}, v instanceof Node ? v : String(v ?? ''))))))));
}

export function unknownGame(main, what) {
  main.append(el('section', { class: 'prose' },
    el('h1', { text: 'Unknown game' }),
    el('p', {}, `There is no ${what} for that game. Pick one: `, ...GAMES.flatMap((g, i) => [i ? ', ' : '', el('a', { href: `#/${what === 'report' ? 'report' : 'review'}/${g.id}` }, g.name)]), '.')));
}

export function deltaText(delta, n) {
  if (delta === null || delta === undefined) return `no trend yet (n=${n}, needs 5)`;
  if (delta === 0) return 'no change';
  return `${signed(delta)} points`;
}
