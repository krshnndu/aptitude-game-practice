// Fresh puzzle seeds and the local seen-puzzle list (pure, storage injected).
//
// Three ways a puzzle reaches the screen beyond a set's 10 shipped ones:
//   - practice slot k > 10: seeded from this browser's random id, the game, the set and k, so a reload
//     shows the same puzzle and other players get other puzzles;
//   - fresh timed practice (not ranked): seeded from the browser id and a per-set run counter;
//   - the ranked timed test: seeded from the game and set only, so every player gets the same sequence.
// Practice and fresh timed puzzles are written to a capped seen-list in localStorage when shown, and
// generation skips any puzzle key in it. The ranked run never reads or writes the list.

export const SEEN_KEY = 'cogprep.seen.v1';
export const SEEN_CAP = 2000;
// Candidate seeds tried for one practice slot before giving up (then the caller falls back).
export const SLOT_TRIES = 40;

// FNV-1a over the string, then a final avalanche (32-bit).
export function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export const mixSeed = (...parts) => hash32(parts.join('|'));

// The ranked timed test: same seed for every player on a game and set.
export const rankedSeed = (game, set) => mixSeed('ranked', game, set);
// Practice slot k (k > 10), candidate j: the first candidate not seen before is the slot's puzzle.
export const practiceSeed = (cid, game, set, k, j = 0) => mixSeed('practice', cid, game, set, k, j);
// The n-th fresh timed run of this browser on a game and set.
export const freshRunSeed = (cid, game, set, n) => mixSeed('fresh', cid, game, set, n);

// cyrb53: a 53-bit string hash (two 32-bit lanes), so 2000 stored ids stay far from a collision.
export function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// Short stored form of a puzzle key: game plus a hash, so 2000 entries stay small.
export const seenId = (game, key) => `${game}:${hash53(key).toString(36)}`;

// Seen-list: { v: 1, keys: [[id, owner]], runs: { 'game:set': n }, slots: { 'game:set': k } },
// keys oldest first and capped; slots: the highest practice slot played (an attempt) per set.
// owner: the practice slot that showed the puzzle ('p<set>.<k>') or 'f' (fresh timed). A slot may
// show its own puzzle again (a reload), anything else skips it.
// Writes merge with the stored copy first (union of keys, highest counters), so two open tabs do
// not drop each other's entries.
export function createSeenList(storage, { cap = SEEN_CAP } = {}) {
  let data = null;
  const read = () => {
    let raw = null;
    try {
      raw = JSON.parse(storage?.getItem(SEEN_KEY) || 'null');
    } catch {
      raw = null;
    }
    const keys = Array.isArray(raw?.keys) ? raw.keys.filter((e) => Array.isArray(e) && typeof e[0] === 'string') : [];
    const runs = raw?.runs && typeof raw.runs === 'object' ? raw.runs : {};
    const slots = raw?.slots && typeof raw.slots === 'object' ? raw.slots : {};
    return { keys, runs, slots };
  };
  const build = ({ keys, runs, slots }) => {
    const kept = keys.slice(-cap);
    return { v: 1, keys: kept, runs, slots, index: new Map(kept.map(([id, o]) => [id, o ?? ''])) };
  };
  const load = () => {
    data ??= build(read());
    return data;
  };
  const maxInt = (a, b) => Math.max(Number.isInteger(a) ? a : 0, Number.isInteger(b) ? b : 0);
  // Stored entries first (another tab may have added some), then ours not stored yet.
  const refresh = () => {
    const d = load();
    const stored = read();
    const ids = new Set(stored.keys.map((e) => e[0]));
    const keys = [...stored.keys, ...d.keys.filter((e) => !ids.has(e[0]))];
    const runs = { ...stored.runs };
    for (const [k, v] of Object.entries(d.runs)) runs[k] = maxInt(runs[k], v);
    const slots = { ...stored.slots };
    for (const [k, v] of Object.entries(d.slots)) slots[k] = maxInt(slots[k], v);
    data = build({ keys, runs, slots });
    return data;
  };
  const save = () => {
    try {
      refresh();
      storage?.setItem(SEEN_KEY, JSON.stringify({ v: 1, keys: data.keys, runs: data.runs, slots: data.slots }));
    } catch {
      // storage full or blocked: the list still works for this page
    }
  };
  return {
    has(game, key, owner = null) {
      const d = load();
      const id = seenId(game, key);
      if (!d.index.has(id)) return false;
      return owner === null || d.index.get(id) !== owner;
    },
    ownerOf(game, key) {
      return load().index.get(seenId(game, key)) ?? null;
    },
    add(game, key, owner = '') {
      const d = load();
      const id = seenId(game, key);
      if (d.index.has(id)) return false;
      d.keys.push([id, owner]);
      d.index.set(id, owner);
      while (d.keys.length > cap) d.index.delete(d.keys.shift()[0]);
      save();
      return true;
    },
    // Next fresh timed run number for a game and set (0, 1, ...), counted per browser.
    nextRun(game, set) {
      let d = load();
      try {
        d = refresh();
      } catch {
        // keep the in-memory copy
      }
      const k = `${game}:${set}`;
      const n = Number.isInteger(d.runs[k]) ? d.runs[k] : 0;
      d.runs[k] = n + 1;
      save();
      return n;
    },
    noteSlot(game, set, k) {
      const d = load();
      const id = `${game}:${set}`;
      if (Number.isInteger(k) && !(d.slots[id] >= k)) {
        d.slots[id] = k;
        save();
      }
    },
    lastSlot(game, set) {
      const v = load().slots[`${game}:${set}`];
      return Number.isInteger(v) ? v : 0;
    },
    get size() {
      return load().keys.length;
    },
  };
}

export const practiceOwner = (set, k) => `p${set}.${k}`;
export const FRESH_OWNER = 'f';

// Pick the puzzle for practice slot k: candidates j = 0, 1, ... seeded from the browser id; the
// first that generates, is valid and is neither shipped nor seen elsewhere wins.
// make(seed) -> puzzle (may throw or return null); keyOf(puzzle) -> string; shipped: Set of keys.
export function pickPracticePuzzle({ game, set, k, cid, make, keyOf, shipped = new Set(), seen = null, tries = SLOT_TRIES }) {
  const owner = practiceOwner(set, k);
  for (let j = 0; j < tries; j++) {
    let p = null;
    try {
      p = make(practiceSeed(cid, game, set, k, j));
    } catch {
      p = null;
    }
    if (!p) continue;
    const key = keyOf(p);
    if (shipped.has(key) || seen?.has(game, key, owner)) continue;
    return p;
  }
  return null;
}

// Same, for a generator that returns a promise (Block Slide builds in a worker). alive(): false once
// the page that asked is gone, then it stops trying and returns null.
export async function pickPracticePuzzleAsync({ game, set, k, cid, make, keyOf, shipped = new Set(), seen = null, tries = SLOT_TRIES, alive = () => true }) {
  const owner = practiceOwner(set, k);
  for (let j = 0; j < tries && alive(); j++) {
    let p = null;
    try {
      p = await make(practiceSeed(cid, game, set, k, j));
    } catch {
      p = null;
    }
    if (!alive()) return null;
    if (!p) continue;
    const key = keyOf(p);
    if (shipped.has(key) || seen?.has(game, key, owner)) continue;
    return p;
  }
  return null;
}

// localStorage when available (null in tests and private modes that block it).
export function defaultSeenStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let shared = null;
export function seenList() {
  shared ??= createSeenList(defaultSeenStorage());
  return shared;
}
