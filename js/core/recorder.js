// Play recorder: a timestamped action log per puzzle attempt, run summaries, and a versioned,
// migrate-safe localStorage archive with JSON export and import.
//
// Attempt record:
//   { id, game, set, puzzleId, mode: 'practice'|'exam', runId, source, startedAt, optimal,
//     outcome: 'solved'|'skipped'|'timeout', moves, hintsUsed, events, metrics, dvs?, rank? }
// rank (timed tests only): 1 for the ranked run (same puzzles for everyone, uploaded), 0 for fresh
// timed practice (this browser's own puzzles, never uploaded).
// dvs: compact did vs should codes { ans, opt, div, lat }, see dvs.js.
// events: [{ t, type, p?, d? }], t in ms since the attempt started. Types:
//   select (p, or null to clear), move (p, d), blocked (p, d: a move the board refused),
//   undo, reset, hint, and one closing event: solve | skip | timeout.
// metrics: see computeMetrics().
//
// Run record (a timed test): { id, game, set, seed, startedAt, endedAt, budgetMs, durationMs,
//   score, attempted, solved, skipped, timedOut, puzzles: [compact per-puzzle rows],
//   status?: 'complete'|'partial', partial?, exit?, rank? } (ended-early runs, see partial.js)
// Runs carry their own per-puzzle rows, so analytics keep working after old attempts are pruned.

import { efficiency } from './score.js';
import { memoryStorage, defaultStorage } from './store.js';
import { sanitizeDvs } from './dvs.js';

export const RECORDER_KEY = 'cogprep.attempts.v1';
export const RECORDER_VERSION = 1;
export const LIMITS = { attempts: 1500, runs: 500 };
export const BACKUP_KIND = 'cogprep-backup';

const ACTION_TYPES = new Set(['select', 'move', 'blocked', 'undo', 'reset', 'hint', 'solve', 'skip', 'timeout']);
const END_EVENT = { solved: 'solve', skipped: 'skip', timeout: 'timeout' };
const OUTCOMES = new Set(Object.keys(END_EVENT));

let seq = 0;
export function newId(prefix, now = Date.now()) {
  seq = (seq + 1) % 1296;
  const rand = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
  return `${prefix}${now.toString(36)}${seq.toString(36).padStart(2, '0')}${rand}`;
}

// Pure: derived numbers for one attempt.
export function computeMetrics(events, { optimal = 0, moves = null, outcome = null } = {}) {
  let grossMoves = 0;
  let firstMoveMs = null;
  const counts = { select: 0, blocked: 0, undo: 0, reset: 0, hint: 0 };
  let longestPauseMs = 0;
  let prevT = 0;
  for (const ev of events) {
    const gap = ev.t - prevT;
    if (gap > longestPauseMs) longestPauseMs = gap;
    prevT = ev.t;
    if (ev.type === 'move') {
      grossMoves++;
      if (firstMoveMs === null) firstMoveMs = ev.t;
    } else if (ev.type in counts) counts[ev.type]++;
  }
  const totalMs = events.length ? events[events.length - 1].t : 0;
  // Net moves: what is on the board at the end. Recomputed from the log when not given.
  let net = moves;
  if (net === null) {
    net = 0;
    for (const ev of events) {
      if (ev.type === 'move') net++;
      else if (ev.type === 'undo') net = Math.max(0, net - 1);
      else if (ev.type === 'reset') net = 0;
    }
  }
  const solved = outcome === 'solved';
  return {
    totalMs,
    firstMoveMs,
    longestPauseMs,
    moves: net,
    grossMoves,
    optimal,
    wastedMoves: solved ? Math.max(0, grossMoves - optimal) : null,
    undos: counts.undo,
    resets: counts.reset,
    hints: counts.hint,
    selects: counts.select,
    blocked: counts.blocked,
    solved,
    skipped: outcome === 'skipped',
    timedOut: outcome === 'timeout',
    efficiency: efficiency(optimal, net, solved),
  };
}

// In-memory log for one attempt; end() returns the finished record (not yet saved).
export function createAttemptLog({ game, set, puzzleId, mode, runId = null, source = 'pool', optimal, rank = null, now = () => Date.now() }) {
  const startedAt = now();
  const events = [];
  let done = null;
  const at = () => Math.max(0, Math.round(now() - startedAt));
  const push = (type, extra = {}) => {
    if (done) return false;
    events.push({ t: at(), type, ...extra });
    return true;
  };
  return {
    startedAt,
    get events() {
      return events.slice();
    },
    get ended() {
      return done !== null;
    },
    elapsed: at,
    select: (p) => push('select', { p: Number.isInteger(p) ? p : null }),
    move: (p, d) => push('move', { p, d }),
    blocked: (p, d) => push('blocked', { p, d }),
    undo: () => push('undo'),
    reset: () => push('reset'),
    hint: () => push('hint'),
    end(outcome, { moves, hintsUsed = 0 } = {}) {
      if (done) return done;
      if (!OUTCOMES.has(outcome)) throw new Error(`unknown outcome ${outcome}`);
      push(END_EVENT[outcome]);
      const evs = events.slice();
      done = {
        id: newId('a', startedAt),
        game,
        set,
        puzzleId,
        mode,
        runId,
        source,
        startedAt,
        optimal,
        outcome,
        moves: moves ?? null,
        hintsUsed,
        events: evs,
        metrics: computeMetrics(evs, { optimal, moves: moves ?? null, outcome }),
      };
      done.moves = done.metrics.moves;
      if (rank === 0 || rank === 1) done.rank = rank;
      return done;
    },
  };
}

// Pure: compact per-puzzle row stored inside a run.
export function puzzleRow(a) {
  const m = a.metrics;
  return {
    attemptId: a.id,
    puzzleId: a.puzzleId,
    source: a.source,
    optimal: a.optimal,
    moves: m.moves,
    grossMoves: m.grossMoves,
    outcome: a.outcome,
    totalMs: m.totalMs,
    firstMoveMs: m.firstMoveMs,
    longestPauseMs: m.longestPauseMs,
    efficiency: m.efficiency,
  };
}

// Pure: run record from its finished attempts.
export function summarizeRun({ id, game, set, seed, startedAt, endedAt, budgetMs, attempts, rank = null }) {
  const puzzles = attempts.map(puzzleRow);
  const score = puzzles.reduce((s, r) => s + r.efficiency, 0);
  return {
    ...(rank === 0 || rank === 1 ? { rank } : {}),
    id: id ?? newId('r', startedAt),
    game,
    set,
    seed,
    startedAt,
    endedAt,
    budgetMs,
    durationMs: Math.max(0, endedAt - startedAt),
    score,
    attempted: puzzles.length,
    solved: puzzles.filter((r) => r.outcome === 'solved').length,
    skipped: puzzles.filter((r) => r.outcome === 'skipped').length,
    timedOut: puzzles.filter((r) => r.outcome === 'timeout').length,
    puzzles,
  };
}

// ---------------------------------------------------------------- validation and migration

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

function cleanEvents(events) {
  if (!Array.isArray(events)) return null;
  const out = [];
  for (const ev of events) {
    if (!ev || !ACTION_TYPES.has(ev.type) || !isNum(ev.t)) return null;
    out.push(ev);
  }
  return out;
}

// Returns a cleaned attempt or null when the record is unusable.
export function sanitizeAttempt(a) {
  if (!a || typeof a !== 'object') return null;
  if (typeof a.id !== 'string' || typeof a.puzzleId !== 'string' || !OUTCOMES.has(a.outcome)) return null;
  if (!isNum(a.set) || !isNum(a.optimal) || !isNum(a.startedAt)) return null;
  const events = cleanEvents(a.events);
  if (!events) return null;
  const out = {
    id: a.id,
    game: typeof a.game === 'string' ? a.game : 'blockslide',
    set: a.set,
    puzzleId: a.puzzleId,
    mode: a.mode === 'exam' ? 'exam' : 'practice',
    runId: typeof a.runId === 'string' ? a.runId : null,
    source: typeof a.source === 'string' ? a.source : 'pool',
    startedAt: a.startedAt,
    optimal: a.optimal,
    outcome: a.outcome,
    moves: isNum(a.moves) ? a.moves : null,
    hintsUsed: isNum(a.hintsUsed) ? a.hintsUsed : 0,
    events,
  };
  // Metrics are derived data: recompute them, unless the events were pruned to save space.
  out.metrics = events.length || !a.metrics
    ? computeMetrics(events, { optimal: out.optimal, moves: out.moves, outcome: out.outcome })
    : { ...a.metrics };
  if (a.eventsPruned) out.eventsPruned = true;
  if (a.rank === 0 || a.rank === 1) out.rank = a.rank;
  const dvs = sanitizeDvs(a.dvs);
  if (dvs) out.dvs = dvs;
  out.moves = out.metrics.moves;
  return out;
}

export function sanitizeRun(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string') return null;
  if (!isNum(r.set) || !isNum(r.score) || !isNum(r.startedAt) || !isNum(r.endedAt) || !Array.isArray(r.puzzles)) return null;
  const puzzles = r.puzzles.filter((p) => p && typeof p.puzzleId === 'string' && OUTCOMES.has(p.outcome) && isNum(p.optimal));
  const out = {
    ...r,
    game: typeof r.game === 'string' ? r.game : 'blockslide',
    puzzles,
    attempted: puzzles.length,
    solved: puzzles.filter((p) => p.outcome === 'solved').length,
    skipped: puzzles.filter((p) => p.outcome === 'skipped').length,
    timedOut: puzzles.filter((p) => p.outcome === 'timeout').length,
  };
  // Ended-early runs keep a clean flag set; anything else is a complete run.
  delete out.partial;
  delete out.exit;
  delete out.status;
  if (r.status === 'partial' || r.partial === true) {
    out.status = 'partial';
    out.partial = true;
    if (typeof r.exit === 'string' && /^[a-z]{1,10}$/.test(r.exit)) out.exit = r.exit;
  } else if (r.status === 'complete') out.status = 'complete';
  return out;
}

// Upgrade steps: MIGRATIONS[v] turns version v data into version v + 1.
// Version 0 is the unversioned shape { attempts, runs } (no "v" field).
export const MIGRATIONS = {
  0: (d) => ({ v: 1, attempts: d.attempts ?? [], runs: d.runs ?? [] }),
};

export function emptyArchive() {
  return { v: RECORDER_VERSION, attempts: [], runs: [] };
}

// Returns { ok: true, data, dropped } or { ok: false, reason }.
// Data from a newer version is refused (never downgraded or overwritten).
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not an archive object' };
  let d = raw;
  let v = d.v === undefined && Array.isArray(d.attempts) ? 0 : d.v;
  if (!Number.isInteger(v) || v < 0) return { ok: false, reason: 'missing or invalid version' };
  if (v > RECORDER_VERSION) return { ok: false, reason: `archive version ${v} is newer than this site (${RECORDER_VERSION})`, newer: true };
  while (v < RECORDER_VERSION) {
    d = MIGRATIONS[v](d);
    v++;
  }
  const rawAttempts = Array.isArray(d.attempts) ? d.attempts : [];
  const rawRuns = Array.isArray(d.runs) ? d.runs : [];
  const attempts = rawAttempts.map(sanitizeAttempt).filter(Boolean);
  const runs = rawRuns.map(sanitizeRun).filter(Boolean);
  return {
    ok: true,
    data: { v: RECORDER_VERSION, attempts, runs },
    dropped: rawAttempts.length - attempts.length + rawRuns.length - runs.length,
  };
}

// Keep the archive inside LIMITS: oldest first out.
export function enforceLimits(data, limits = LIMITS) {
  data.attempts.sort((a, b) => a.startedAt - b.startedAt);
  data.runs.sort((a, b) => a.startedAt - b.startedAt);
  if (data.attempts.length > limits.attempts) data.attempts.splice(0, data.attempts.length - limits.attempts);
  if (data.runs.length > limits.runs) data.runs.splice(0, data.runs.length - limits.runs);
  return data;
}

// Drop the event logs (keep metrics) of the oldest half of the attempts that still have them.
export function pruneEvents(data) {
  const withEvents = data.attempts.filter((a) => a.events.length);
  const cut = Math.max(1, Math.floor(withEvents.length / 2));
  let changed = 0;
  for (const a of withEvents.slice(0, cut)) {
    a.events = [];
    a.eventsPruned = true;
    changed++;
  }
  return changed;
}

// ---------------------------------------------------------------- the store

const runListeners = [];
export function onRunSaved(fn) { runListeners.push(fn); }
const attemptListeners = [];
export function onAttemptSaved(fn) { attemptListeners.push(fn); }

export function createRecorder(storage = defaultStorage(), { limits = LIMITS } = {}) {
  let readOnly = false;
  let problem = null;

  function load() {
    let raw;
    try {
      raw = storage.getItem(RECORDER_KEY);
    } catch {
      return emptyArchive();
    }
    if (!raw) return emptyArchive();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Keep the unreadable text aside instead of silently losing it.
      try {
        storage.setItem(`${RECORDER_KEY}.corrupt`, raw);
      } catch {
        // ignore
      }
      problem = 'The saved play history could not be read; a copy was kept and a fresh history started.';
      storage.removeItem(RECORDER_KEY);
      return emptyArchive();
    }
    const res = migrate(parsed);
    if (!res.ok) {
      if (res.newer) {
        readOnly = true;
        problem = `${res.reason}. History is read only here so it is not overwritten.`;
      } else problem = `Saved play history ignored: ${res.reason}.`;
      return emptyArchive();
    }
    return res.data;
  }

  function save(data) {
    if (readOnly) return false;
    enforceLimits(data, limits);
    for (let tries = 0; tries < 6; tries++) {
      try {
        storage.setItem(RECORDER_KEY, JSON.stringify(data));
        return true;
      } catch {
        // Quota: shed old event logs first, then old attempts.
        if (!pruneEvents(data)) {
          if (!data.attempts.length) return false;
          data.attempts.splice(0, Math.ceil(data.attempts.length / 4));
        }
      }
    }
    return false;
  }

  function upsert(list, rec) {
    const i = list.findIndex((x) => x.id === rec.id);
    if (i >= 0) list[i] = rec;
    else list.push(rec);
  }

  return {
    get readOnly() {
      load();
      return readOnly;
    },
    get problem() {
      return problem;
    },
    load,
    saveAttempt(rec) {
      const clean = sanitizeAttempt(rec);
      if (!clean) return false;
      const data = load();
      upsert(data.attempts, clean);
      const ok = save(data);
      if (ok) for (const fn of attemptListeners) { try { fn(clean); } catch { /* never break play */ } }
      return ok;
    },
    // silent: a checkpoint (tab hidden mid-run) that must not upload or end the run in telemetry.
    saveRun(run, { silent = false } = {}) {
      const clean = sanitizeRun(run);
      if (!clean) return false;
      const data = load();
      upsert(data.runs, clean);
      const ok = save(data);
      if (ok && !silent) for (const fn of runListeners) { try { fn(clean); } catch { /* never break play */ } }
      return ok;
    },
    attempts(filter = {}) {
      return load().attempts.filter((a) => Object.entries(filter).every(([k, v]) => a[k] === v));
    },
    runs(filter = {}) {
      return load().runs.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
    },
    exportData() {
      const data = load();
      return { v: RECORDER_VERSION, attempts: data.attempts, runs: data.runs };
    },
    // Merge (default) keeps existing records on id clashes; replace swaps the archive.
    importData(archive, { mode = 'merge' } = {}) {
      if (readOnly) throw new Error('history is read only in this version');
      const res = migrate(archive);
      if (!res.ok) throw new Error(res.reason);
      const data = mode === 'replace' ? emptyArchive() : load();
      const have = { attempts: new Set(data.attempts.map((a) => a.id)), runs: new Set(data.runs.map((r) => r.id)) };
      let added = 0;
      let skipped = 0;
      for (const kind of ['attempts', 'runs']) {
        for (const rec of res.data[kind]) {
          if (have[kind].has(rec.id)) {
            skipped++;
            continue;
          }
          have[kind].add(rec.id);
          data[kind].push(rec);
          added++;
        }
      }
      const ok = save(data);
      return { ok, added, skipped, dropped: res.dropped };
    },
    clear() {
      if (readOnly) return;
      storage.removeItem(RECORDER_KEY);
    },
  };
}

// ---------------------------------------------------------------- backup file

// Backup file versions: 1 = { recorder, progress }; 2 adds learn (review items, snapshots, learning
// events). BACKUP_MIGRATIONS[v] turns a version v backup into v + 1.
export const BACKUP_VERSION = 2;
export const BACKUP_MIGRATIONS = {
  1: (b) => ({ ...b, v: 2, learn: null }),
};

export function makeBackup({ recorder, progress = null, learn = null, now = Date.now() }) {
  return { kind: BACKUP_KIND, v: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), recorder, progress, learn };
}

// Accepts a full backup (any known version) or a bare recorder archive. Throws with a readable message.
export function parseBackup(text) {
  let obj;
  try {
    obj = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new Error('the file is not valid JSON');
  }
  if (!obj || typeof obj !== 'object') throw new Error('the file does not contain a backup');
  if (obj.kind === BACKUP_KIND) {
    let v = Number.isInteger(obj.v) ? obj.v : 1;
    if (v > BACKUP_VERSION) throw new Error(`the backup is version ${v}, newer than this site (${BACKUP_VERSION})`);
    while (v < BACKUP_VERSION) obj = BACKUP_MIGRATIONS[v++](obj);
    if (!obj.recorder || typeof obj.recorder !== 'object') throw new Error('the backup has no play history');
    return {
      recorder: obj.recorder,
      progress: obj.progress && typeof obj.progress === 'object' ? obj.progress : null,
      learn: obj.learn && typeof obj.learn === 'object' ? obj.learn : null,
    };
  }
  if (Array.isArray(obj.attempts) || Array.isArray(obj.runs)) return { recorder: obj, progress: null, learn: null };
  throw new Error('the file is not a CogPrep backup');
}

export { memoryStorage };
