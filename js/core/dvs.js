// Did vs should (pure): what the player did next to the optimal or correct answer, the first
// divergence, and the compact codes kept with each attempt and sent with item telemetry.
//
// A game adapter's didVsShould(attempt, puzzle) returns
//   { rows: [{ did, should, ok }], div, note, ans, opt, lat }
// rows: aligned side by side (strings, '' when one side has nothing at that step);
// div: index of the first row with ok === false, or -1; note: plain-language explanation;
// ans / opt: compact answer codes (see cleanCode); lat: ms from the puzzle start to the divergent
// action, or to the end of the attempt when there was no divergence.
//
// Stored per attempt (recorder attempt.dvs) and sent with the item event: { ans, opt, div, lat }.
// Codes are short ASCII tokens built from game state only, never free text.

export const CODE_MAX = 40;
export const TELEMETRY_CODE_MAX = 36;
export const LAT_MAX = 3600000;
const CODE_RE = /[^A-Za-z0-9.,:+*/=_<>^]/g;

export function cleanCode(s, max = CODE_MAX) {
  return String(s ?? '').replace(CODE_RE, '').slice(0, max);
}

const intIn = (x, lo, hi, dflt) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : dflt);

// Index of the first row that is not ok, or -1.
export function firstDivergence(rows) {
  return Array.isArray(rows) ? rows.findIndex((r) => r && r.ok === false) : -1;
}

// Two step lists side by side. eq(did, should) decides ok; a step present on one side only is not ok.
export function alignRows(did, should, eq = (a, b) => a === b, text = (x) => (x === null || x === undefined ? '' : String(x))) {
  const n = Math.max(did.length, should.length);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const has = i < did.length, want = i < should.length;
    rows.push({ did: has ? text(did[i]) : '', should: want ? text(should[i]) : '', ok: has && want ? !!eq(did[i], should[i]) : false });
  }
  return rows;
}

// The compact record kept with an attempt.
export function dvsCodes(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    ans: cleanCode(r.ans),
    opt: cleanCode(r.opt),
    div: intIn(r.div, -1, 999, -1),
    lat: intIn(r.lat, 0, LAT_MAX, 0),
  };
}

// Recorder side: accept only the four compact fields.
export function sanitizeDvs(x) {
  if (!x || typeof x !== 'object') return null;
  return dvsCodes(x);
}

// Item telemetry extras: shorter codes so the event stays well under 512 bytes.
export function dvsTelemetry(dvs) {
  const d = sanitizeDvs(dvs);
  if (!d) return {};
  return { ans: d.ans.slice(0, TELEMETRY_CODE_MAX), opt: d.opt.slice(0, TELEMETRY_CODE_MAX), div: d.div, lat: d.lat };
}

// Attempts with a recorded divergence, newest first (the report's recent mistakes list).
export function recentMistakes(attempts, { game = null, limit = 10 } = {}) {
  return (attempts ?? [])
    .filter((a) => a && a.dvs && a.dvs.div >= 0 && !a.sample && (game === null || a.game === game))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

// Generic plain-language line from stored codes, for history views without the puzzle.
export function codesNote(dvs, fmt = (c) => c) {
  const d = sanitizeDvs(dvs);
  if (!d) return '';
  const secs = (d.lat / 1000).toFixed(1);
  if (d.div < 0) return `Matched the answer (${fmt(d.opt)}) in ${secs} s.`;
  return `You gave ${fmt(d.ans) || 'nothing'}; the answer was ${fmt(d.opt)}. First went wrong at step ${d.div + 1}, ${secs} s in.`;
}
