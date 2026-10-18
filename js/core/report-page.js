// Per-game report (#/report/<game>, #/report/<game>/snapshot/<id>, ?print=1): spec C items 1 to 8.
// Puzzle features for "weak patterns" and coach tags for older attempts come from rebuilding the
// puzzles from their ids (cheap ones only), then the tags are saved so this happens once.

import { el } from './dom.js';
import { isGame, gameName } from './games.js';
import { ADAPTERS, SHEETS, correctFor, loadSetData } from './learn-registry.js';
import { loadContext, unknownGame, gameTabs, table, fmtDate, pctText } from './learn-ui.js';
import { buildReport, fmtVal } from './report-data.js';
import { makeSnapshot, weeklyDue, diffSnapshots } from './snapshots.js';
import { headerSection, dimsSection, tagsSection, paceSection, weakSection, practiceSection, strategySection } from './report-sections.js';
import { downloadReport } from './report-export.js';

const BACKFILL_MAX = 120;
const GENERATED_MAX = 40;
const puzzleCache = new Map();

// Rebuild puzzles for recent attempts; fill in missing coach tags. Returns featuresOf.
async function prepare(game, attempts, ctx) {
  const ad = ADAPTERS[game];
  const recent = attempts.slice(-200);
  const sets = [...new Set(recent.map((a) => a.set))];
  const setData = {};
  await Promise.all(sets.map(async (s) => {
    try {
      setData[s] = await loadSetData(game, s);
    } catch {
      setData[s] = null;
    }
  }));
  let generated = 0;
  const puzzleOf = (a) => {
    if (puzzleCache.has(a.puzzleId)) return puzzleCache.get(a.puzzleId);
    const ref = ad.refFor(a);
    if (ad.slowRebuild(ref)) return null;
    if (!ad.needsSet(ref) && ++generated > GENERATED_MAX) return null;
    let p = null;
    try {
      p = ad.regenerate(ref, ad.needsSet(ref) ? setData[a.set] : null);
    } catch {
      p = null;
    }
    puzzleCache.set(a.puzzleId, p);
    return p;
  };
  const featureMap = new Map();
  const newTags = {};
  let filled = 0;
  for (const a of recent.slice().reverse()) {
    const p = puzzleOf(a);
    if (!p) continue;
    try {
      featureMap.set(a.id, ad.features(p));
    } catch {
      // a feature reader failing on one puzzle must not break the report
    }
    if (ctx.learn.tags[a.id] === undefined && a.events?.length && filled < BACKFILL_MAX) {
      try {
        newTags[a.id] = ad.tagsFor(a, p);
        filled++;
      } catch {
        // leave this attempt untagged
      }
    }
  }
  if (filled) {
    ctx.store.update((d) => {
      for (const [id, t] of Object.entries(newTags)) d.tags[id] = t;
    });
    Object.assign(ctx.learn.tags, newTags);
  }
  return (a) => featureMap.get(a.id) ?? null;
}

export async function mountReport(main, rest, query) {
  const [game, sub, snapId] = rest;
  if (!isGame(game)) {
    unknownGame(main, 'report');
    return () => {};
  }
  const print = query.get('print') === '1';
  const root = el('div', { class: `learn report${print ? ' report-print' : ''}` });
  main.append(root);
  const status = el('p', { class: 'muted', role: 'status', text: 'Building your report...' });
  root.append(status);

  const ctx = loadContext();
  const attempts = ctx.byGame[game];
  const ad = ADAPTERS[game];
  const featuresOf = await prepare(game, attempts, ctx);
  const report = buildReport({ game, attempts, tagsOf: ctx.tagsOf, adapter: ad, correct: correctFor(game), featuresOf, now: ctx.now });

  // Weekly snapshot, automatically, when the last one is a week old.
  let snaps = ctx.store.snapshots(game);
  if (weeklyDue(snaps, report, ctx.now)) {
    ctx.store.addSnapshot(makeSnapshot(report, { kind: 'weekly', now: ctx.now }));
    snaps = ctx.store.snapshots(game);
  }

  const name = gameName(game);
  root.replaceChildren();
  if (sub === 'snapshot') {
    renderSnapshot(root, game, snaps.find((s) => s.id === snapId), report);
    return () => {};
  }

  const topTags = report.weeks.top;
  const tagLabel = ad.tagLabel;
  root.append(
    el('div', { class: 'page-head' },
      el('p', { class: 'crumbs no-print' }, el('a', { href: '#/analytics' }, 'Progress'), ' / Report'),
      el('h1', { text: `${name}: learning report` }),
      el('p', { class: 'lede', text: `Generated ${fmtDate(ctx.now)} from the play history in this browser.` })),
    print ? null : gameTabs(game, (g) => `#/report/${g}`, 'Reports by game'),
    print ? null : el('div', { class: 'toolbar no-print' },
      el('a', { class: 'btn', href: `#/report/${game}?print=1` }, 'Printable report'),
      el('button', { type: 'button', class: 'btn', onclick: () => downloadReport(root, { title: `${name} learning report`, data: report, filename: `cogprep-${game}-report-${new Date(ctx.now).toISOString().slice(0, 10)}.html` }) }, 'Export report (HTML)'),
      el('a', { class: 'btn', href: `#/review/${game}` }, `Review library${ctx.due[game] ? ` (${ctx.due[game]} due)` : ''}`)),
    headerSection(report, name),
    dimsSection(report),
    tagsSection(report, tagLabel),
    paceSection(report),
    weakSection(report),
    practiceSection(report),
    print ? null : snapshotsSection(game, snaps, report, ctx),
    strategySection(SHEETS[game], topTags),
  );
  if (print) {
    document.body.classList.add('print-mode');
    for (const d of root.querySelectorAll('details')) d.open = true;
    root.prepend(el('p', { class: 'no-print callout' }, 'Print view. Use your browser\'s print dialog (A4) or save as PDF. ', el('a', { href: `#/report/${game}` }, 'Back to the report')));
    const t = setTimeout(() => window.print(), 400);
    return () => {
      clearTimeout(t);
      document.body.classList.remove('print-mode');
    };
  }
  return () => {};
}

function snapshotsSection(game, snaps, report, ctx) {
  const host = el('section', { class: 'snapshots no-print', 'aria-labelledby': 'snap-h' });
  const diffHost = el('div', { role: 'region', 'aria-live': 'polite', 'aria-label': 'Snapshot comparison' });
  const draw = () => {
    const list = ctx.store.snapshots(game).slice().sort((a, b) => b.at - a.at);
    const opt = (s) => el('option', { value: s.id, text: `${fmtDate(s.at)} (${s.kind}, ${Math.round(s.gss)})` });
    const selA = el('select', { id: 'snap-a' }, list.map(opt));
    const selB = el('select', { id: 'snap-b' }, el('option', { value: 'now', text: 'Current report' }), list.map(opt));
    if (list[1]) selA.value = list[1].id;
    host.replaceChildren(...[
      el('h2', { id: 'snap-h', class: 'section-title', text: `Snapshots (${list.length} of 26 kept)` }),
      el('p', { class: 'muted small', text: 'A snapshot keeps the report summary (scores, dimensions, top tags), never raw attempts. One is saved automatically each week.' }),
      el('div', { class: 'toolbar' },
        el('button', { type: 'button', class: 'btn', onclick: () => { ctx.store.addSnapshot(makeSnapshot(report, { kind: 'manual' })); draw(); } }, 'Save a snapshot now')),
      list.length
        ? table('Saved snapshots', ['Date', 'Kind', 'Score', 'Tier', 'n', ''], list.map((s) => [
          fmtDate(s.at), s.kind, String(Math.round(s.gss)), s.tier, String(s.n),
          el('span', {},
            el('a', { href: `#/report/${game}/snapshot/${s.id}` }, 'View'), ' ',
            el('button', { type: 'button', class: 'btn btn-small btn-quiet', 'aria-label': `Delete snapshot of ${fmtDate(s.at)}`, onclick: () => { ctx.store.removeSnapshot(game, s.id); draw(); } }, 'Delete')),
        ]))
        : el('p', { class: 'muted', text: 'No snapshots yet.' }),
      list.length
        ? el('div', { class: 'toolbar' },
          el('label', { for: 'snap-a' }, 'Compare ', selA), el('label', { for: 'snap-b' }, ' with ', selB),
          el('button', {
            type: 'button', class: 'btn',
            onclick: () => {
              const a = list.find((s) => s.id === selA.value);
              const b = selB.value === 'now' ? makeSnapshot(report, { kind: 'manual', id: 'now' }) : list.find((s) => s.id === selB.value);
              if (a && b) diffHost.replaceChildren(diffTable(...(a.at <= b.at ? [a, b] : [b, a]), ADAPTERS[game].tagLabel));
            },
          }, 'Compare'))
        : null,
      diffHost,
    ].filter(Boolean));
  };
  draw();
  return host;
}

const fmtCell = (fmt, v) => (v === null || v === undefined ? 'none' : fmt === 'pct' ? pctText(v) : fmt === 'sec' ? `${(v / 1000).toFixed(1)} s` : fmt === 'int' ? String(v) : String(Math.round(v * 10) / 10));

export function diffTable(a, b, tagLabel = (t) => t) {
  const d = diffSnapshots(a, b);
  return el('div', {},
    d.tierChange ? el('p', {}, el('strong', { text: 'Tier: ' }), `${d.tierChange.from} to ${d.tierChange.to}`) : null,
    table(`Snapshot ${fmtDate(a.at)} against ${b.id === 'now' ? 'now' : fmtDate(b.at)}`, ['Measure', b.id === 'now' ? fmtDate(a.at) : fmtDate(a.at), b.id === 'now' ? 'Now' : fmtDate(b.at), 'Change'],
      d.rows.map((r) => [
        r.label.startsWith('Tag: ') ? `Tag: ${tagLabel(r.label.slice(5).replace(/ \(last 4 weeks\)$/, ''))} (last 4 weeks)` : r.label,
        fmtCell(r.fmt, r.a), fmtCell(r.fmt, r.b),
        r.delta === null ? '' : el('span', { class: r.improved === null ? '' : r.improved ? 'delta-good' : 'delta-bad' },
          `${r.delta > 0 ? '+' : ''}${fmtCell(r.fmt === 'int' ? 'int' : r.fmt, r.delta)}${r.improved === null ? '' : r.improved ? ' (better)' : ' (worse)'}`),
      ])));
}

function renderSnapshot(root, game, snap, report) {
  root.append(el('p', { class: 'crumbs' }, el('a', { href: `#/report/${game}` }, `${gameName(game)} report`), ' / Snapshot'));
  if (!snap) {
    root.append(el('p', { class: 'notice', text: 'That snapshot no longer exists (only the last 26 are kept).' }));
    return;
  }
  root.append(
    el('h1', { text: `${gameName(game)} snapshot, ${fmtDate(snap.at)}` }),
    el('p', { class: 'lede', text: `${snap.kind === 'weekly' ? 'Weekly' : 'Saved by you'}. Score ${Math.round(snap.gss)} (${snap.tier}) over ${snap.n} attempts.` }),
    table('Snapshot dimensions', ['Dimension', 'Value'], Object.values(snap.dims ?? {}).map((d) => [d.label, fmtVal(d, d.value)])),
    snap.weak?.length ? el('p', {}, el('strong', { text: 'Weakest features then: ' }), snap.weak.map((w) => `${w.label} ${pctText(w.accuracy)} (n=${w.n})`).join('; ')) : null,
    el('h2', { class: 'section-title', text: 'Then against now' }),
    diffTable(snap, makeSnapshot(report, { kind: 'manual', id: 'now' }), ADAPTERS[game].tagLabel),
  );
}
