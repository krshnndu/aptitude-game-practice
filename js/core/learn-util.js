// Small pure helpers shared by the learning layer and the per-game review adapters.

// FNV-1a 32-bit hash of a string, as 8 hex digits. Used for puzzle checksums (stale seed detection).
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Stable JSON (sorted keys) so checksums do not depend on key order.
export function stableJson(x) {
  if (Array.isArray(x)) return `[${x.map(stableJson).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stableJson(x[k])}`).join(',')}}`;
  return JSON.stringify(x ?? null);
}

export const checksumOf = (fields) => hash32(stableJson(fields));

// Seed from a generated puzzle id such as 'bs2-g9iy' or 'gm1-g9iy-5' (base36 after '-g').
export function seedFromId(id) {
  const m = /-g([0-9a-z]+)(?:-\d+)?$/.exec(id ?? '');
  return m ? parseInt(m[1], 36) : null;
}

// Base pool id and tag of a variant id such as 'ls2-07~v3'.
export function splitVariant(id) {
  const i = (id ?? '').indexOf('~');
  return i < 0 ? { base: id, tag: null } : { base: id.slice(0, i), tag: id.slice(i + 1) };
}

// The ids of the coach findings that are things to fix (kind 'fix'). Stable strings from coach.js.
export function fixIds(findings) {
  return [...new Set((findings ?? []).filter((f) => f && f.kind === 'fix' && typeof f.id === 'string').map((f) => f.id))];
}

// A compact JSON blob for a puzzle that cannot be regenerated cheaply. Null when over the cap.
export const BLOB_CAP = 1800;
export function makeBlob(obj, cap = BLOB_CAP) {
  const s = JSON.stringify(obj);
  return s.length <= cap ? s : null;
}

export function readBlob(s) {
  try {
    return typeof s === 'string' ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export const fmtSec = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : 'none');

// Share of attempts carrying any of the given tags (null when there are no attempts).
export function tagRate(attempts, tagsOf, ids) {
  if (!attempts.length) return null;
  const want = new Set(ids);
  return attempts.filter((a) => (tagsOf(a) ?? []).some((t) => want.has(t))).length / attempts.length;
}
