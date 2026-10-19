// Browser glue for fresh puzzles, shared by every game page: practice slots past the shipped 10,
// the seeds of the ranked and fresh timed runs, and the seen-list writes. Pure logic is in fresh.js.

import { cid } from './board.js';
import { seenList, rankedSeed, freshRunSeed, practiceSeed, practiceOwner, pickPracticePuzzle, pickPracticePuzzleAsync, FRESH_OWNER } from './fresh.js';

export { FRESH_OWNER };

// Route arg for fresh timed practice: #/<game>/run/<set>/fresh
export const FRESH_ARG = 'fresh';
export const isFreshArg = (arg) => arg === FRESH_ARG;
export const runHref = (game, set, fresh = false) => `#/${game}/run/${set}${fresh ? `/${FRESH_ARG}` : ''}`;

// Seed and rank for a timed test. Ranked: one fixed seed per game and set. Fresh: this browser's
// id and its run counter for the set, so every fresh run starts on new seeds.
export function runSetup(game, set, fresh) {
  if (!fresh) return { seed: rankedSeed(game, set), rank: 1 };
  let n = 0;
  try {
    n = seenList().nextRun(game, set);
  } catch {
    n = Date.now() % 100000;
  }
  return { seed: freshRunSeed(cid(), game, set, n), rank: 0 };
}

// Skip test for fresh timed streams: anything this browser already saw in practice or fresh runs.
export const seenFilter = (game) => (key) => {
  try {
    return seenList().has(game, key);
  } catch {
    return false;
  }
};

// Where "Practice" starts once all shipped puzzles of a set were played: the next fresh slot.
export function nextFreshSlot(game, set, perSet) {
  try {
    return Math.max(perSet, seenList().lastSlot(game, set)) + 1;
  } catch {
    return perSet + 1;
  }
}

export function markSeen(game, key, owner = FRESH_OWNER) {
  try {
    seenList().add(game, key, owner);
  } catch {
    // never break play over the seen-list
  }
}

// The puzzle for practice slot k of a set. k <= shipped count: the shipped puzzle. Past that: a
// fresh puzzle seeded from this browser's id, skipping shipped and seen ones; when none can be built,
// a variant of a shipped puzzle (kit.variant) or the shipped puzzle itself. Marks it seen.
// kit: { keyOf(p), make(setNo, seed, k), variant?(base, seed, k) }
export function practicePuzzle({ game, set, k, puzzles, kit }) {
  if (k <= puzzles.length) {
    const p = puzzles[k - 1];
    markSeen(game, kit.keyOf(p), practiceOwner(set, k));
    return { puzzle: p, source: 'pool' };
  }
  const shipped = new Set(puzzles.map(kit.keyOf));
  const id = cid();
  const fresh = pickPracticePuzzle({ game, set, k, cid: id, make: (seed) => kit.make(set, seed, k), keyOf: kit.keyOf, shipped, seen: seenList() });
  return finishSlot({ game, set, k, puzzles, kit, fresh, id });
}

// Same with a generator that returns a promise (Block Slide builds in a worker).
export async function practicePuzzleAsync({ game, set, k, puzzles, kit, makeAsync }) {
  if (k <= puzzles.length) return practicePuzzle({ game, set, k, puzzles, kit });
  const shipped = new Set(puzzles.map(kit.keyOf));
  const id = cid();
  const fresh = await pickPracticePuzzleAsync({ game, set, k, cid: id, make: (seed) => makeAsync(set, seed, k), keyOf: kit.keyOf, shipped, seen: seenList() });
  return finishSlot({ game, set, k, puzzles, kit, fresh, id });
}

function finishSlot({ game, set, k, puzzles, kit, fresh, id }) {
  let puzzle = fresh;
  let source = 'generated';
  if (!puzzle) {
    const base = puzzles[(k - 1) % puzzles.length];
    puzzle = kit.variant ? kit.variant(base, practiceSeed(id, game, set, k, 'v'), k) : base;
    source = kit.variant ? 'variant' : 'pool';
  }
  markSeen(game, kit.keyOf(puzzle), practiceOwner(set, k));
  try {
    seenList().noteSlot(game, set, k);
  } catch {
    // ignore
  }
  return { puzzle, source };
}
