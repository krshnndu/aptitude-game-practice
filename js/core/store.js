// Progress persistence in localStorage under a versioned key.
// Falls back to an in-memory store when localStorage is unavailable (private mode, node tests).

import { UNLOCK_THRESHOLD, averageEfficiency } from './score.js';

export const STORE_KEY = 'cogprep.progress.v1';
const VERSION = 1;

export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

export function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__cogprep_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {
    // ignore and fall back
  }
  return memoryStorage();
}

function emptyData() {
  return { v: VERSION, unlockAll: false, games: {} };
}

export function createStore(storage = defaultStorage()) {
  function load() {
    try {
      const raw = storage.getItem(STORE_KEY);
      if (!raw) return emptyData();
      const data = JSON.parse(raw);
      if (!data || data.v !== VERSION || typeof data.games !== 'object') return emptyData();
      return data;
    } catch {
      return emptyData();
    }
  }

  function save(data) {
    try {
      storage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      // storage full or blocked: progress just is not persisted
    }
  }

  function setEntry(data, game, setNo) {
    data.games[game] ??= {};
    data.games[game][setNo] ??= { bestScore: 0, bestAvg: 0, runs: 0, practice: {} };
    return data.games[game][setNo];
  }

  return {
    get() {
      return load();
    },
    getSet(game, setNo) {
      const data = load();
      return data.games[game]?.[setNo] ?? { bestScore: 0, bestAvg: 0, runs: 0, practice: {} };
    },
    recordRun(game, setNo, score, setSize) {
      const data = load();
      const e = setEntry(data, game, setNo);
      e.runs += 1;
      const avg = averageEfficiency(score, setSize);
      const improved = score > e.bestScore;
      if (improved) e.bestScore = score;
      if (avg > e.bestAvg) e.bestAvg = avg;
      save(data);
      return { improved, best: e.bestScore };
    },
    recordPractice(game, setNo, puzzleId, eff) {
      const data = load();
      const e = setEntry(data, game, setNo);
      if (!(e.practice[puzzleId] >= eff)) e.practice[puzzleId] = eff;
      save(data);
    },
    practiceAverage(game, setNo, setSize) {
      const e = this.getSet(game, setNo);
      const sum = Object.values(e.practice).reduce((a, b) => a + b, 0);
      return averageEfficiency(sum, setSize);
    },
    setUnlockAll(on) {
      const data = load();
      data.unlockAll = !!on;
      save(data);
    },
    unlockAll() {
      return load().unlockAll;
    },
    // Set 1 is always open. Set k opens when set k-1 reaches the threshold
    // in a timed test, or across practice bests for all its puzzles.
    isUnlocked(game, setNo, setSize) {
      if (setNo <= 1 || this.unlockAll()) return true;
      const prev = this.getSet(game, setNo - 1);
      return prev.bestAvg >= UNLOCK_THRESHOLD || this.practiceAverage(game, setNo - 1, setSize) >= UNLOCK_THRESHOLD;
    },
    // Backup import: keep the better of the saved and imported value for every field.
    mergeData(incoming) {
      if (!incoming || incoming.v !== VERSION || typeof incoming.games !== 'object' || !incoming.games) {
        throw new Error('progress in the backup has an unknown format');
      }
      const data = load();
      data.unlockAll = data.unlockAll || !!incoming.unlockAll;
      for (const [game, sets] of Object.entries(incoming.games)) {
        if (!sets || typeof sets !== 'object') continue;
        for (const [setNo, inc] of Object.entries(sets)) {
          if (!inc || typeof inc !== 'object') continue;
          const e = setEntry(data, game, setNo);
          const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
          e.bestScore = Math.max(e.bestScore, num(inc.bestScore));
          e.bestAvg = Math.max(e.bestAvg, num(inc.bestAvg));
          e.runs = Math.max(e.runs, num(inc.runs));
          for (const [pid, eff] of Object.entries(inc.practice || {})) {
            if (!(e.practice[pid] >= num(eff))) e.practice[pid] = num(eff);
          }
        }
      }
      save(data);
      return data;
    },
    reset() {
      storage.removeItem(STORE_KEY);
    },
  };
}
