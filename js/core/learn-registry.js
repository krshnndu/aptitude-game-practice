// Per-game learning adapters and strategy sheets, keyed by game id (pure imports, no DOM).

import * as blockslide from '../games/blockslide/review.js';
import * as latinsquare from '../games/latinsquare/review.js';
import * as gridmemory from '../games/gridmemory/review.js';
import * as operatorswitch from '../games/operatorswitch/review.js';
import * as digitequation from '../games/digitequation/review.js';
import * as patternrule from '../games/patternrule/review.js';
import { STRATEGY_SHEET as bsSheet } from '../games/blockslide/strategy.js';
import { STRATEGY_SHEET as lsSheet } from '../games/latinsquare/strategy.js';
import { STRATEGY_SHEET as gmSheet } from '../games/gridmemory/strategy.js';
import { STRATEGY_SHEET as osSheet } from '../games/operatorswitch/strategy.js';
import { STRATEGY_SHEET as deSheet } from '../games/digitequation/strategy.js';
import { STRATEGY_SHEET as prSheet } from '../games/patternrule/strategy.js';

export const ADAPTERS = { blockslide, latinsquare, gridmemory, operatorswitch, digitequation, patternrule };
export const SHEETS = { blockslide: bsSheet, latinsquare: lsSheet, gridmemory: gmSheet, operatorswitch: osSheet, digitequation: deSheet, patternrule: prSheet };

const solved = (a) => a.outcome === 'solved';
// Correctness, time and par per game (Grid Memory counts only perfect trials as correct).
export const correctFor = (game) => ADAPTERS[game]?.correct ?? solved;
export const timeFor = (game) => ADAPTERS[game]?.timeOf ?? ((a) => a.metrics?.totalMs ?? 0);
export const parFor = (game) => ADAPTERS[game]?.parMs ?? (() => null);

// Set files for regeneration, fetched once per page load (browser only).
const setCache = new Map();
export function loadSetData(game, set) {
  const key = `${game}:${set}`;
  if (!setCache.has(key)) {
    const file = ADAPTERS[game]?.setFile?.(set) ?? `set${set}.json`;
    const url = new URL(`../../data/sets/${game}/${file}`, import.meta.url);
    setCache.set(key, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`set ${set} (${r.status})`);
      return r.json();
    }).catch((err) => {
      setCache.delete(key);
      throw err;
    }));
  }
  return setCache.get(key);
}

// Rebuild the puzzle behind a review reference. Returns { puzzle, stale, reason }.
export async function rebuild(game, ref, { allowSlow = false } = {}) {
  const ad = ADAPTERS[game];
  if (!ad || !ref) return { puzzle: null, reason: 'unknown game' };
  if (ad.slowRebuild(ref) && !allowSlow) return { puzzle: null, reason: 'slow' };
  let setData = null;
  if (ad.needsSet(ref)) setData = await loadSetData(game, ref.set);
  let puzzle = null;
  try {
    puzzle = ad.regenerate(ref, setData);
  } catch (err) {
    return { puzzle: null, reason: err.message };
  }
  if (!puzzle) return { puzzle: null, reason: 'not found' };
  const stale = (ref.gv !== undefined && ref.gv !== ad.GENERATOR_VERSION) || (ref.check && ad.checksum(puzzle) !== ref.check);
  return { puzzle, stale: !!stale };
}
