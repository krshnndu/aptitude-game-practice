// Learning layer persistence: review items (mistake notebook + spaced queue), report snapshots,
// learning events (explain viewed, review done, queue cleared), coach tags per attempt, and the
// achievement unlock record. One versioned localStorage key, separate from the play archive.
//
// Review item: { id, attemptId, game, set, puzzleId, source, createdAt, outcome, efficiency,
//   ref: { pid, set, src, seed?, v?, perm?, blob?, gv, check? }, tags[], note, dueAt, interval, ease,
//   history[], path? }
// Snapshot: { id, game, at, kind: 'weekly'|'manual', ...summary numbers }
// Event: { t, type: 'explain_viewed'|'review'|'queue_cleared', game, ... }

import { defaultStorage } from './store.js';
import { CAPS, enforceItemCaps } from './srs.js';

export const LEARN_KEY = 'cogprep.learn.v1';
export const LEARN_VERSION = 1;
export const TAG_CAP = 1500;
const EVENT_TYPES = new Set(['explain_viewed', 'review', 'queue_cleared']);

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isStr = (x) => typeof x === 'string';

export function emptyLearn() {
  return { v: LEARN_VERSION, items: [], snapshots: {}, events: [], tags: {}, unlocked: {}, lastSync: 0, cache: null };
}

export function sanitizeItem(it) {
  if (!it || typeof it !== 'object' || !isStr(it.id) || !isStr(it.game) || !isStr(it.puzzleId)) return null;
  if (!isNum(it.createdAt) || !isNum(it.dueAt)) return null;
  const ref = it.ref && typeof it.ref === 'object' ? it.ref : { pid: it.puzzleId, set: it.set };
  return {
    id: it.id,
    attemptId: isStr(it.attemptId) ? it.attemptId : it.id,
    game: it.game,
    set: isNum(it.set) ? it.set : 1,
    puzzleId: it.puzzleId,
    source: isStr(it.source) ? it.source : 'pool',
    mode: it.mode === 'exam' ? 'exam' : 'practice',
    createdAt: it.createdAt,
    outcome: isStr(it.outcome) ? it.outcome : 'skipped',
    efficiency: isNum(it.efficiency) ? it.efficiency : 0,
    metrics: it.metrics && typeof it.metrics === 'object' ? Object.fromEntries(Object.entries(it.metrics).filter(([, v]) => isNum(v))) : {},
    ref,
    tags: Array.isArray(it.tags) ? it.tags.filter(isStr).slice(0, 12) : [],
    note: isStr(it.note) ? it.note.slice(0, CAPS.note) : '',
    dueAt: it.dueAt,
    interval: isNum(it.interval) ? it.interval : 1,
    ease: isNum(it.ease) ? it.ease : 2.5,
    history: Array.isArray(it.history) ? it.history.filter((h) => h && isNum(h.t) && isStr(h.result)).slice(-20) : [],
    ...(Array.isArray(it.path) ? { path: it.path.slice(0, 200) } : {}),
    ...(it.retired ? { retired: true } : {}),
  };
}

export function sanitizeSnapshot(s) {
  if (!s || typeof s !== 'object' || !isStr(s.id) || !isStr(s.game) || !isNum(s.at)) return null;
  return { ...s, kind: s.kind === 'manual' ? 'manual' : 'weekly' };
}

function sanitizeEvent(e) {
  return e && isNum(e.t) && EVENT_TYPES.has(e.type) ? e : null;
}

// Upgrade steps: LEARN_MIGRATIONS[v] turns version v into v + 1. Version 0 = no learn data at all.
export const LEARN_MIGRATIONS = {
  0: (d) => ({ ...emptyLearn(), ...d, v: 1 }),
};

// Returns { ok, data } or { ok: false, reason, newer? }.
export function migrateLearn(raw) {
  if (raw === null || raw === undefined) return { ok: true, data: emptyLearn() };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not a learning data object' };
  let d = raw;
  let v = d.v === undefined ? 0 : d.v;
  if (!Number.isInteger(v) || v < 0) return { ok: false, reason: 'invalid learning data version' };
  if (v > LEARN_VERSION) return { ok: false, reason: `learning data version ${v} is newer than this site`, newer: true };
  while (v < LEARN_VERSION) {
    d = LEARN_MIGRATIONS[v](d);
    v++;
  }
  const snapshots = {};
  for (const [g, list] of Object.entries(d.snapshots && typeof d.snapshots === 'object' ? d.snapshots : {})) {
    if (Array.isArray(list)) snapshots[g] = list.map(sanitizeSnapshot).filter(Boolean).slice(-CAPS.snapshotsPerGame);
  }
  const tags = {};
  for (const [id, list] of Object.entries(d.tags && typeof d.tags === 'object' ? d.tags : {})) {
    if (Array.isArray(list)) tags[id] = list.filter(isStr).slice(0, 12);
  }
  const unlocked = {};
  for (const [id, t] of Object.entries(d.unlocked && typeof d.unlocked === 'object' ? d.unlocked : {})) if (isNum(t)) unlocked[id] = t;
  return {
    ok: true,
    data: {
      v: LEARN_VERSION,
      items: enforceItemCaps((Array.isArray(d.items) ? d.items : []).map(sanitizeItem).filter(Boolean)),
      snapshots,
      events: (Array.isArray(d.events) ? d.events : []).map(sanitizeEvent).filter(Boolean).slice(-CAPS.events),
      tags,
      unlocked,
      lastSync: isNum(d.lastSync) ? d.lastSync : 0,
      cache: d.cache && typeof d.cache === 'object' ? d.cache : null,
    },
  };
}

// Keep the tag map inside TAG_CAP, dropping the ids that sort first (ids start with a base36 time).
function capTags(tags) {
  const ids = Object.keys(tags);
  if (ids.length <= TAG_CAP) return tags;
  ids.sort();
  for (const id of ids.slice(0, ids.length - TAG_CAP)) delete tags[id];
  return tags;
}

// Merge two learn data sets (backup import). Existing records win on id clashes; notes are kept
// when only the incoming side has one.
export function mergeLearn(base, inc) {
  const out = { ...base, items: base.items.slice(), snapshots: { ...base.snapshots }, events: base.events.slice(), tags: { ...base.tags }, unlocked: { ...base.unlocked } };
  const have = new Map(out.items.map((i) => [i.id, i]));
  let added = 0;
  for (const it of inc.items) {
    const cur = have.get(it.id);
    if (!cur) {
      out.items.push(it);
      added++;
    } else if (!cur.note && it.note) cur.note = it.note;
  }
  out.items = enforceItemCaps(out.items);
  for (const [g, list] of Object.entries(inc.snapshots)) {
    const mine = out.snapshots[g] ?? [];
    const ids = new Set(mine.map((s) => s.id));
    out.snapshots[g] = [...mine, ...list.filter((s) => !ids.has(s.id))].sort((a, b) => a.at - b.at).slice(-CAPS.snapshotsPerGame);
  }
  const evKey = (e) => `${e.t}:${e.type}:${e.game ?? ''}`;
  const evs = new Set(out.events.map(evKey));
  out.events = [...out.events, ...inc.events.filter((e) => !evs.has(evKey(e)))].sort((a, b) => a.t - b.t).slice(-CAPS.events);
  for (const [id, list] of Object.entries(inc.tags)) if (!out.tags[id]) out.tags[id] = list;
  capTags(out.tags);
  for (const [id, t] of Object.entries(inc.unlocked)) if (!(out.unlocked[id] <= t)) out.unlocked[id] = t;
  out.cache = null;
  return { data: out, added };
}

export function createLearnStore(storage = defaultStorage()) {
  let problem = null;
  let readOnly = false;

  function load() {
    let raw = null;
    try {
      raw = storage.getItem(LEARN_KEY);
    } catch {
      return emptyLearn();
    }
    if (!raw) return emptyLearn();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      problem = 'Saved review data could not be read; starting fresh.';
      return emptyLearn();
    }
    const res = migrateLearn(parsed);
    if (!res.ok) {
      readOnly = !!res.newer;
      problem = res.reason;
      return emptyLearn();
    }
    return res.data;
  }

  function save(data) {
    if (readOnly) return false;
    data.items = enforceItemCaps(data.items);
    capTags(data.tags);
    for (let tries = 0; tries < 5; tries++) {
      try {
        storage.setItem(LEARN_KEY, JSON.stringify(data));
        return true;
      } catch {
        // Quota: shed the cache, then old events and tags, then blobs on the oldest items.
        if (data.cache) data.cache = null;
        else if (data.events.length > 50) data.events = data.events.slice(-50);
        else if (Object.keys(data.tags).length > 300) {
          const ids = Object.keys(data.tags).sort();
          for (const id of ids.slice(0, ids.length - 300)) delete data.tags[id];
        } else {
          const withBlob = data.items.filter((i) => i.ref?.blob).sort((a, b) => a.createdAt - b.createdAt);
          if (!withBlob.length) return false;
          for (const it of withBlob.slice(0, Math.ceil(withBlob.length / 2))) delete it.ref.blob;
        }
      }
    }
    return false;
  }

  function update(fn) {
    const data = load();
    const res = fn(data);
    save(data);
    return res;
  }

  return {
    get problem() {
      return problem;
    },
    load,
    save,
    update,
    items(filter = {}) {
      return load().items.filter((i) => Object.entries(filter).every(([k, v]) => i[k] === v));
    },
    item(id) {
      return load().items.find((i) => i.id === id) ?? null;
    },
    upsertItem(item) {
      const clean = sanitizeItem(item);
      if (!clean) return false;
      return update((d) => {
        const i = d.items.findIndex((x) => x.id === clean.id);
        if (i >= 0) d.items[i] = clean;
        else d.items.push(clean);
        return true;
      });
    },
    removeItem(id) {
      return update((d) => {
        d.items = d.items.filter((i) => i.id !== id);
      });
    },
    setNote(id, note) {
      return update((d) => {
        const it = d.items.find((i) => i.id === id);
        if (it) it.note = String(note ?? '').slice(0, CAPS.note);
        return !!it;
      });
    },
    addEvent(ev) {
      const e = sanitizeEvent(ev);
      if (!e) return false;
      return update((d) => {
        d.events.push(e);
        if (d.events.length > CAPS.events) d.events.splice(0, d.events.length - CAPS.events);
      });
    },
    setTags(attemptId, tags) {
      return update((d) => {
        d.tags[attemptId] = [...new Set(tags.filter(isStr))].slice(0, 12);
      });
    },
    addSnapshot(snap) {
      const s = sanitizeSnapshot(snap);
      if (!s) return false;
      return update((d) => {
        const list = (d.snapshots[s.game] ??= []);
        list.push(s);
        if (list.length > CAPS.snapshotsPerGame) list.splice(0, list.length - CAPS.snapshotsPerGame);
      });
    },
    removeSnapshot(game, id) {
      return update((d) => {
        d.snapshots[game] = (d.snapshots[game] ?? []).filter((s) => s.id !== id);
      });
    },
    snapshots(game) {
      return load().snapshots[game] ?? [];
    },
    exportData() {
      const d = load();
      return { v: LEARN_VERSION, items: d.items, snapshots: d.snapshots, events: d.events, tags: d.tags, unlocked: d.unlocked };
    },
    importData(raw) {
      const res = migrateLearn(raw);
      if (!res.ok) throw new Error(res.reason);
      const { data, added } = mergeLearn(load(), res.data);
      save(data);
      return { added };
    },
    clear() {
      if (!readOnly) storage.removeItem(LEARN_KEY);
    },
  };
}
