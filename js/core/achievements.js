// Achievements (pure). Every rule reads the play archive and the learning data, and returns
// { id, name, desc, group, unlocked, progress 0..1, hint }. No rule counts total attempts, total time
// or leaderboard rank. Data that older history lacks (coach tags, walkthrough views, review events)
// simply leaves progress at 0.
//
// opts: { now, games, correct(game) -> fn(a), time(game) -> fn(a), par(game) -> fn(a) | null }

import { median, mean, dayKey, dayStreak } from './analytics.js';

const DAY = 24 * 3600 * 1000;
const SESSION_GAP = 30 * 60 * 1000;
const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const pctText = (x) => `${Math.round((x ?? 0) * 100)}%`;
const solved = (a) => a.outcome === 'solved';
const totalMs = (a) => a.metrics?.totalMs ?? 0;
const DEFAULT_GAMES = ['blockslide', 'latinsquare', 'gridmemory', 'operatorswitch', 'digitequation', 'patternrule'];
const NAMES = { blockslide: 'Block Slide', latinsquare: 'Latin Square', gridmemory: 'Grid Memory', operatorswitch: 'Operator Switch', digitequation: 'Digit Equation', patternrule: 'Pattern Rule' };

export const FLUENT = { window: 20, accuracy: 0.85, efficiency: 0.9, days: 3 };

function variance(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
}

// Fluent in one game: last 20 attempts with 85% correct, median efficiency 0.9, over 3+ days.
export function fluent(list, correct = solved) {
  const last = list.slice(-FLUENT.window);
  const n = last.length;
  const acc = n ? last.filter(correct).length / n : 0;
  const eff = n ? median(last.map((a) => a.metrics?.efficiency ?? 0)) : 0;
  const days = new Set(last.map((a) => dayKey(a.startedAt))).size;
  const unlocked = n >= FLUENT.window && acc >= FLUENT.accuracy && eff >= FLUENT.efficiency && days >= FLUENT.days;
  const progress = unlocked ? 1 : mean([clamp01(n / FLUENT.window), clamp01(acc / FLUENT.accuracy), clamp01(eff / FLUENT.efficiency), clamp01(days / FLUENT.days)]) * 0.99;
  const missing = [];
  if (n < FLUENT.window) missing.push(`${n} of ${FLUENT.window} attempts`);
  if (acc < FLUENT.accuracy) missing.push(`accuracy ${pctText(acc)} of 85%`);
  if (eff < FLUENT.efficiency) missing.push(`median efficiency ${pctText(eff)} of 90%`);
  if (days < FLUENT.days) missing.push(`${days} of ${FLUENT.days} days`);
  return { unlocked, progress, n, acc, eff, days, hint: unlocked ? 'Reached.' : `Last ${FLUENT.window} attempts: ${missing.join(', ')}.` };
}

// A recurring error (5+ in a 30-attempt window) that then vanishes for the next 30 attempts.
export function habitBroken(list, tagsOf, { window = 30, min = 5 } = {}) {
  const tagged = list.filter((a) => tagsOf(a) !== undefined);
  const n = tagged.length;
  let best = { progress: 0, tag: null, clean: 0 };
  if (n < window) return { unlocked: false, ...best };
  const all = new Set(tagged.flatMap((a) => tagsOf(a)));
  for (const tag of all) {
    const has = tagged.map((a) => tagsOf(a).includes(tag) ? 1 : 0);
    const pre = [0];
    for (const h of has) pre.push(pre[pre.length - 1] + h);
    let next = n; // next occurrence at or after i, scanning backwards
    const nextAt = new Array(n + 1).fill(n);
    for (let i = n - 1; i >= 0; i--) {
      if (has[i]) next = i;
      nextAt[i] = next;
    }
    for (let i = window; i <= n; i++) {
      if (pre[i] - pre[i - window] < min) continue;
      const clean = Math.min(window, nextAt[i] - i);
      const p = clean / window;
      if (p > best.progress) best = { progress: p, tag, clean };
      if (clean >= window) return { unlocked: true, progress: 1, tag, clean };
    }
  }
  return { unlocked: false, ...best, progress: best.progress * 0.99 };
}

function sessions(list) {
  const out = [];
  let prev = -Infinity;
  for (const a of list) {
    if (a.startedAt - prev > SESSION_GAP) out.push([]);
    out[out.length - 1].push(a);
    prev = a.startedAt;
  }
  return out;
}

// 10 consecutive correct with decreasing median time across 3 sessions.
export function patternSpotter(list, correct = solved, time = totalMs) {
  const sessionOf = new Map();
  sessions(list).forEach((s, k) => s.forEach((a) => sessionOf.set(a, k)));
  let best = 0;
  let streak = [];
  const judge = () => {
    if (!streak.length) return false;
    const groups = new Map();
    for (const a of streak) {
      const k = sessionOf.get(a);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(time(a));
    }
    const meds = [...groups.values()].map(median);
    let run = 1;
    let bestRun = 1;
    for (let i = 1; i < meds.length; i++) {
      run = meds[i] < meds[i - 1] ? run + 1 : 1;
      bestRun = Math.max(bestRun, run);
    }
    const p = 0.5 * clamp01(streak.length / 10) + 0.5 * clamp01(bestRun / 3);
    best = Math.max(best, p);
    return streak.length >= 10 && bestRun >= 3;
  };
  for (const a of list) {
    if (correct(a)) streak.push(a);
    else {
      if (judge()) return { unlocked: true, progress: 1 };
      streak = [];
    }
  }
  if (judge()) return { unlocked: true, progress: 1 };
  return { unlocked: false, progress: best * 0.99 };
}

// Best accuracy over any `size` consecutive attempts (fewer when the list is short).
function bestWindow(list, size, correct) {
  if (!list.length) return { acc: 0, n: 0 };
  if (list.length < size) return { acc: list.filter(correct).length / list.length, n: list.length };
  let ok = list.slice(0, size).filter(correct).length;
  let best = ok;
  for (let i = size; i < list.length; i++) {
    ok += (correct(list[i]) ? 1 : 0) - (correct(list[i - size]) ? 1 : 0);
    best = Math.max(best, ok);
  }
  return { acc: best / size, n: size };
}

// 30 attempts whose solve-time variance is 30% below the previous 30, accuracy holding at 85%.
export function calibrated(list, correct = solved, time = totalMs) {
  const n = list.length;
  if (n < 60) return { unlocked: false, progress: 0.5 * clamp01(n / 60) * 0.99 };
  let best = 0;
  for (let i = 30; i + 30 <= n; i++) {
    const A = list.slice(i - 30, i);
    const B = list.slice(i, i + 30);
    const va = variance(A.filter(correct).map(time));
    const vb = variance(B.filter(correct).map(time));
    const accB = B.filter(correct).length / 30;
    if (va === null || vb === null || va <= 0) continue;
    const drop = 1 - vb / va;
    if (drop >= 0.3 && accB >= 0.85) return { unlocked: true, progress: 1 };
    best = Math.max(best, 0.5 + 0.25 * clamp01(drop / 0.3) + 0.25 * clamp01(accB / 0.85));
  }
  return { unlocked: false, progress: Math.min(0.99, best) };
}

// 10 correct under par inside a stretch whose accuracy stays at 90% or more.
export function fastLane(list, correct = solved, time = totalMs, par = null) {
  if (!par) return { unlocked: false, progress: 0 };
  let best = 0;
  for (let i = 0; i < list.length; i++) {
    let fast = 0;
    let ok = 0;
    for (let j = i; j < list.length; j++) {
      const a = list[j];
      const c = correct(a);
      if (c) ok++;
      const p = par(a);
      if (c && Number.isFinite(p) && time(a) <= p) fast++;
      const acc = ok / (j - i + 1);
      if (acc < 0.9) {
        if (j - i + 1 >= 10) break;
        continue;
      }
      best = Math.max(best, fast);
      if (fast >= 10) return { unlocked: true, progress: 1, best: 10 };
    }
  }
  return { unlocked: false, progress: clamp01(best / 10) * 0.99, best };
}

// 4 distinct days within any 7-day window, each with 10+ attempts.
export function spacer(attempts) {
  const perDay = new Map();
  for (const a of attempts) perDay.set(dayKey(a.startedAt), (perDay.get(dayKey(a.startedAt)) ?? 0) + 1);
  const days = [...perDay.entries()].filter(([, k]) => k >= 10).map(([d]) => new Date(`${d}T12:00:00`).getTime()).sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; i < days.length; i++) {
    while (days[i] - days[j] > 6.5 * DAY) j++;
    best = Math.max(best, i - j + 1);
  }
  return { unlocked: best >= 4, progress: best >= 4 ? 1 : clamp01(best / 4) * 0.99, best };
}

// Returned after 7+ days away, then cleared a review queue.
export function comeback(attempts, events) {
  const ts = attempts.map((a) => a.startedAt).sort((a, b) => a - b);
  const returns = [];
  for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] >= 7 * DAY) returns.push(ts[i]);
  if (!returns.length) return { unlocked: false, progress: 0 };
  const cleared = events.filter((e) => e.type === 'queue_cleared').map((e) => e.t);
  const unlocked = returns.some((r) => cleared.some((t) => t >= r));
  return { unlocked, progress: unlocked ? 1 : 0.5 };
}

// Failed, re-queued, then solved on the next encounter (same puzzle, any game).
export function lessonLearned(attempts, events, items, correctFor) {
  if (events.some((e) => e.type === 'review' && e.solved && items.some((i) => i.id === e.itemId && i.outcome !== 'solved'))) return { unlocked: true, progress: 1 };
  const byPuzzle = new Map();
  for (const a of attempts) {
    const k = `${a.game}:${a.puzzleId}`;
    if (!byPuzzle.has(k)) byPuzzle.set(k, []);
    byPuzzle.get(k).push(a);
  }
  let failedAgain = false;
  for (const list of byPuzzle.values()) {
    for (let i = 1; i < list.length; i++) {
      const c = correctFor(list[i].game);
      if (!c(list[i - 1])) {
        failedAgain = true;
        if (c(list[i])) return { unlocked: true, progress: 1 };
      }
    }
  }
  return { unlocked: false, progress: failedAgain || items.length ? 0.5 : 0 };
}

const DEFS = [];
const def = (id, group, name, desc) => DEFS.push({ id, group, name, desc });
for (const g of DEFAULT_GAMES) def(`fluent-${g}`, 'Mastery', `Fluent: ${NAMES[g]}`, `Last 20 ${NAMES[g]} attempts: 85% correct, median efficiency 0.9 or more, spread over at least 3 days.`);
def('first-light', 'Learning', 'First Light', 'Step through the optimal walkthrough after a failed or inefficient puzzle.');
def('lesson-learned', 'Learning', 'Lesson Learned', 'Fail a puzzle, meet it again, and solve it.');
def('habit-broken', 'Learning', 'Habit Broken', 'A coach error type seen 5 or more times in 30 attempts disappears for the next 30 attempts of that game.');
def('second-look', 'Learning', 'Second Look', 'Complete 10 review replays, solving each before revealing the walkthrough.');
def('pattern-spotter', 'Learning', 'Pattern Spotter', 'Pattern Rule or Latin Square: 10 correct in a row, with median time falling across 3 sessions.');
def('transfer', 'Learning', 'Transfer', 'Reach Fluent in 3 games.');
def('polymath', 'Learning', 'Polymath', 'Reach Fluent in all 6 games.');
def('steady-hand', 'Speed and accuracy', 'Steady Hand', '25 consecutive attempts in one game at 92% accuracy or better.');
def('calibrated', 'Speed and accuracy', 'Calibrated', 'In one game, 30 attempts whose solve-time variance is at least 30% lower than the 30 before, with accuracy at 85% or more.');
def('par-shooter', 'Speed and accuracy', 'Par Shooter', '15 exactly optimal solves (efficiency 1.0) in one game.');
def('fast-lane', 'Speed and accuracy', 'Fast Lane', '10 correct solves under par time in one game while accuracy over that stretch stays at 90% or more.');
def('week-one', 'Consistency', 'Week One', 'Practise 7 days in a row.');
def('fortnight', 'Consistency', 'Fortnight', 'Practise 14 days in a row.');
def('month', 'Consistency', 'Month', 'Practise 28 days in a row.');
def('spacer', 'Consistency', 'Spacer', 'Practise on 4 different days within one week, at least 10 attempts each day. Spacing beats streaks.');
def('comeback', 'Consistency', 'Comeback', 'Come back after 7 or more days away and clear a review queue.');
def('notebook', 'Reflection', 'Notebook', 'Write a note of 20 or more characters on 10 mistake notebook entries.');
def('cleared-queue', 'Reflection', 'Cleared Queue', 'Bring a game\'s spaced review queue to zero.');
export const ACHIEVEMENTS = DEFS;

export function computeAchievements({ attempts = [], learn = {}, now = Date.now(), games = DEFAULT_GAMES, correct = () => solved, time = () => totalMs, par = () => null } = {}) {
  const events = learn.events ?? [];
  const items = learn.items ?? [];
  const tags = learn.tags ?? {};
  const tagsOf = (a) => tags[a.id];
  const real = attempts.filter((a) => !a.sample && a.startedAt <= now).sort((a, b) => a.startedAt - b.startedAt);
  const byGame = Object.fromEntries(games.map((g) => [g, real.filter((a) => a.game === g)]));
  const res = {};
  const set = (id, r, hint) => (res[id] = { unlocked: !!r.unlocked, progress: r.unlocked ? 1 : clamp01(r.progress), hint: r.hint ?? hint });

  const fl = {};
  for (const g of games) {
    fl[g] = fluent(byGame[g], correct(g));
    set(`fluent-${g}`, fl[g]);
  }
  const flList = games.map((g) => fl[g]);
  const flCount = flList.filter((f) => f.unlocked).length;
  const topProgress = (k) => mean(flList.map((f) => f.progress).sort((a, b) => b - a).slice(0, k));

  const viewed = events.some((e) => e.type === 'explain_viewed' && e.afterFail);
  set('first-light', { unlocked: viewed, progress: viewed ? 1 : 0 }, 'After a failed or inefficient puzzle, press Next or Auto-play in the optimal walkthrough.');
  set('lesson-learned', lessonLearned(real, events, items, correct), 'Retry a puzzle from your mistake notebook and solve it.');

  let hb = { unlocked: false, progress: 0, tag: null };
  for (const g of games) {
    const r = habitBroken(byGame[g], tagsOf);
    if (r.unlocked || r.progress > hb.progress) hb = { ...r, game: g };
    if (r.unlocked) break;
  }
  set('habit-broken', hb, hb.tag ? `${NAMES[hb.game]}: "${hb.tag}" clean for ${hb.clean} of 30 attempts.` : 'Needs coach tags: a recurring error (5 in 30 attempts) to break first.');

  const second = events.filter((e) => e.type === 'review' && e.retryFirst && e.solved).length;
  set('second-look', { unlocked: second >= 10, progress: second / 10 }, `${Math.min(second, 10)} of 10 retry-first review solves.`);

  let ps = { unlocked: false, progress: 0 };
  for (const g of ['patternrule', 'latinsquare'].filter((x) => games.includes(x))) {
    const r = patternSpotter(byGame[g], correct(g), time(g));
    if (r.unlocked || r.progress > ps.progress) ps = r;
    if (r.unlocked) break;
  }
  set('pattern-spotter', ps, 'Build a 10-correct streak in Pattern Rule or Latin Square over 3 sessions, getting a little quicker each session.');
  set('transfer', { unlocked: flCount >= 3, progress: topProgress(3) * (flCount >= 3 ? 1 : 0.99) }, `Fluent in ${flCount} of 3 games.`);
  set('polymath', { unlocked: flCount >= 6, progress: topProgress(6) * (flCount >= 6 ? 1 : 0.99) }, `Fluent in ${flCount} of 6 games.`);

  let sh = 0;
  let cal = { unlocked: false, progress: 0 };
  let par1 = 0;
  let fast = { unlocked: false, progress: 0 };
  for (const g of games) {
    const list = byGame[g];
    const w = bestWindow(list, 25, correct(g));
    sh = Math.max(sh, clamp01(w.acc / 0.92) * clamp01(w.n / 25));
    const c = calibrated(list, correct(g), time(g));
    if (c.unlocked || c.progress > cal.progress) cal = c;
    par1 = Math.max(par1, list.filter((a) => correct(g)(a) && (a.metrics?.efficiency ?? 0) >= 1).length);
    const f = fastLane(list, correct(g), time(g), par(g));
    if (f.unlocked || f.progress > fast.progress) fast = f;
  }
  set('steady-hand', { unlocked: sh >= 1, progress: sh * (sh >= 1 ? 1 : 0.99) }, 'Best 25-attempt stretch in one game, toward 92% accuracy.');
  set('calibrated', cal, 'Keep accuracy at 85% while your solve times become more even (needs 60 attempts in one game).');
  set('par-shooter', { unlocked: par1 >= 15, progress: par1 / 15 }, `${Math.min(par1, 15)} of 15 exactly optimal solves in one game.`);
  set('fast-lane', fast, `${fast.best ?? 0} of 10 correct under par in one stretch at 90% accuracy.`);

  const st = dayStreak(real.map((a) => a.startedAt), now);
  for (const [id, k] of [['week-one', 7], ['fortnight', 14], ['month', 28]]) {
    set(id, { unlocked: st.longest >= k, progress: st.longest / k }, `Longest streak ${st.longest} of ${k} days.`);
  }
  const sp = spacer(real);
  set('spacer', sp, `${sp.best} of 4 days with 10+ attempts in one week.`);
  set('comeback', comeback(real, events), 'After a week or more away, come back and clear your review queue.');

  const notes = items.filter((i) => (i.note ?? '').trim().length >= 20).length;
  set('notebook', { unlocked: notes >= 10, progress: notes / 10 }, `${Math.min(notes, 10)} of 10 notebook entries with a note of 20+ characters.`);
  const cleared = events.some((e) => e.type === 'queue_cleared' && games.includes(e.game));
  set('cleared-queue', { unlocked: cleared, progress: cleared ? 1 : events.some((e) => e.type === 'review') ? 0.5 : 0 }, 'Review every due item of one game on the same day.');

  return ACHIEVEMENTS.map((d) => ({ ...d, ...res[d.id] }));
}

// Unlocks are permanent: merge with the saved record. Returns { list, unlocked, newly }.
export function mergeUnlocked(list, saved = {}, now = Date.now()) {
  const unlocked = { ...saved };
  const newly = [];
  const out = list.map((a) => {
    if (a.unlocked && !unlocked[a.id]) {
      unlocked[a.id] = now;
      newly.push(a.id);
    }
    return unlocked[a.id] ? { ...a, unlocked: true, progress: 1, unlockedAt: unlocked[a.id] } : a;
  });
  return { list: out, unlocked, newly };
}

// Cache stamp: recompute only when the inputs changed.
export function achievementStamp(attempts, learn) {
  const last = attempts.reduce((m, a) => (a.startedAt > (m?.startedAt ?? -1) ? a : m), null);
  const notes = (learn.items ?? []).filter((i) => (i.note ?? '').trim().length >= 20).length;
  return `${attempts.length}:${last?.id ?? ''}:${(learn.events ?? []).length}:${(learn.items ?? []).length}:${notes}:${Object.keys(learn.tags ?? {}).length}:${dayKey(Date.now())}`;
}
