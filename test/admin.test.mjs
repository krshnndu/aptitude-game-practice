// Admin dashboard: verdict helpers, small-sample rules and the next-actions insights.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sampleSuffix, pct, fraction, bucketLabel, reachVerdict, funnelLeak, funnelVerdict, qualityVerdict,
  retentionVerdict, termlyRows, termlyTotals, termlyVerdict, healthVerdicts, losingGames, topSources, insights,
  SECTIONS, termlyPlacementRows, errorVisitorCount, errorText, errorsWidespread, liveSummary, LEAK_SHARE, LEAK_MIN_N,
} from '../js/core/admin.js';

// Healthy baseline: enough traffic, no errors, a flat funnel (any drop counts as a leak).
function base(over = {}) {
  return {
    days: 30,
    uniqueVisitors: 60,
    funnel: {
      visited: 40, opened_a_game: 40, started_a_game: 40, selected_a_set: 40, run_started: 40,
      run_ended: 40, result_action_taken: 40, viewed_progress_or_board: 40,
    },
    gameStarts: { blockslide: 20, latinsquare: 20 },
    gameFinishes: { blockslide: 10, latinsquare: 9 },
    errors: [],
    uploadFails: 0,
    perf: { n: 50, lcpP50: 1200, lcpP95: 2000 },
    features: {},
    linkClicks: {},
    ...over,
  };
}

test('sample suffix by denominator', () => {
  assert.equal(sampleSuffix(5), ' (tiny sample)');
  assert.equal(sampleSuffix(19), ' (tiny sample)');
  assert.equal(sampleSuffix(20), ' (small sample)');
  assert.equal(sampleSuffix(99), ' (small sample)');
  assert.equal(sampleSuffix(100), '');
});

test('no percentages below n=20', () => {
  assert.equal(pct(3, 19), null);
  assert.equal(pct(5, 20), 25);
  assert.equal(fraction(3, 14), '3 of 14');
  assert.equal(fraction(8, 61), '8 of 61 (13%)');
  assert.ok(!fraction(1, 10).includes('%'));
});

test('buckets under 5 render as <5', () => {
  assert.equal(bucketLabel(0), '0');
  assert.equal(bucketLabel(1), '<5');
  assert.equal(bucketLabel(4), '<5');
  assert.equal(bucketLabel(5), '5');
});

test('reach verdict: trend only when both periods have n >= 20', () => {
  assert.match(reachVerdict(60, null).text, /No prior period/);
  assert.match(reachVerdict(15, 40).text, /^Too small to trend/);
  assert.match(reachVerdict(40, 15).text, /^Too small to trend/);
  assert.equal(reachVerdict(60, 40).tone, 'ok');
  assert.match(reachVerdict(60, 40).text, /^Growing/);
  assert.match(reachVerdict(30, 40).text, /^Shrinking/);
  assert.match(reachVerdict(42, 40).text, /^Flat/);
  assert.match(reachVerdict(200, 150).text, /^Growing, 200 vs 150$/);
});

test('funnel leak picks the largest absolute adjacent drop', () => {
  const f = { visited: 56, opened_a_game: 24, started_a_game: 24, selected_a_set: 12, run_started: 11, run_ended: 8, result_action_taken: 6, viewed_progress_or_board: 10 };
  const leak = funnelLeak(f);
  assert.deepEqual(leak, { from: 'visited', to: 'opened_a_game', lost: 32, upstream: 56 });
  assert.match(funnelVerdict(f).text, /Biggest leak: Visited to Opened a game \(lost 32\) \(small sample\)/);
  // Upstream threshold skips stages with too few people.
  const small = { visited: 9, opened_a_game: 1 };
  assert.equal(funnelLeak(small, 10), null);
  assert.match(funnelVerdict({}).text, /No stage loses a quarter/);
});

test('quality verdict flags timed runs that lose more than they finish', () => {
  assert.match(qualityVerdict({ examStarts: 11, examAbandons: 6 }, { a: 4 }).text, /lose more than they finish \(tiny sample\)/);
  assert.equal(qualityVerdict({ examStarts: 26, examAbandons: 5 }, { a: 14 }).tone, 'ok');
  assert.match(qualityVerdict({}, {}).text, /No timed runs/);
});

test('retention verdict: early signal below 20, sticky and one-and-done above', () => {
  const early = retentionVerdict({ visitors: 12, returnedAfter7d: 3 });
  assert.match(early.text, /^Early signal only; need ~8 more visitors for a rate \(tiny sample\)$/);
  assert.ok(!early.text.includes('%'));
  assert.match(retentionVerdict({ visitors: 40, returnedAfter7d: 6 }).text, /^Sticky/);
  assert.match(retentionVerdict({ visitors: 56, returnedAfter7d: 0 }).text, /^One-and-done \(small sample\)$/);
  assert.match(retentionVerdict({ visitors: 100, returnedAfter7d: 10 }).text, /^Some come back$/);
});

test('termly totals fall back to site counters without a termly block', () => {
  const d = { features: { maker_show: 14, maker_dismiss: 3 }, linkClicks: { 'termly-iimr.vercel.app': 2, 'krishnendu.me': 5 } };
  assert.equal(termlyRows(d), null);
  assert.deepEqual(termlyTotals(d), { perPlacement: false, rows: null, shown: 14, clicks: 2, promptClicks: 2, dismissed: 3 });
  // An empty termly block (no via events yet) keeps the totals fallback.
  assert.equal(termlyTotals({ ...d, termly: {} }).perPlacement, false);
  assert.equal(termlyTotals({ ...d, termly: {} }).shown, 14);
});

test('termly totals sum per placement rows when present', () => {
  const d = { termly: { result_nudge: { shown: 10, clicks: 1, dismissed: 2 }, footer: { shown: 5, clicks: 0, eligible: 30 } } };
  const t = termlyTotals(d);
  assert.equal(t.perPlacement, true);
  assert.equal(t.shown, 15);
  assert.equal(t.clicks, 1);
  assert.equal(t.dismissed, 2);
  assert.equal(t.rows.find((r) => r.placement === 'footer').eligible, 30);
  assert.equal(t.rows.find((r) => r.placement === 'result_nudge').eligible, null);
});

test('termly verdict rules', () => {
  assert.match(termlyVerdict({ shown: 25, clicks: 1, dismissed: 3 }).text, /swatted away/);
  assert.doesNotMatch(termlyVerdict({ shown: 10, clicks: 0, dismissed: 9 }).text, /swatted/);
  assert.match(termlyVerdict({ shown: 10, clicks: 2, dismissed: 0, eligible: 40 }).text, /rarely renders/);
  assert.match(termlyVerdict({ shown: 14, clicks: 2, dismissed: 0 }).text, /^Need ~6 more shows for a rate/);
  assert.match(termlyVerdict({ shown: 30, clicks: 0, dismissed: 0 }).text, /never clicked/);
  assert.match(termlyVerdict({ shown: 40, clicks: 4, dismissed: 1 }).text, /Clicked 4 of 40 \(10%\) shown/);
});

test('health verdicts', () => {
  assert.deepEqual(healthVerdicts(base()), []);
  const v = healthVerdicts(base({ errors: [{ hash: 'A', n: 2 }, { hash: 'B', n: 9 }], perf: { n: 30, lcpP95: 5097 }, uploadFails: 1 }));
  assert.equal(v.length, 3);
  assert.match(v[0].text, /^11 errors, top: B$/);
  assert.match(v[1].text, /Slow on mobile: LCP p95 5\.1s/);
  assert.match(v[2].text, /1 score uploads failed/);
});

test('top sources: top 5 plus other, referrers when sources are mostly direct', () => {
  const many = { sources: Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k, i) => [k, { visitors: 10 - i }])) };
  const s = topSources(many);
  assert.equal(s.length, 6);
  assert.deepEqual(s[5], { label: 'other', value: 4 + 5 });
  const direct = { sources: { direct: { visitors: 50 }, x: { visitors: 2 } }, referrers: { direct: 50, 'google.com': 6 } };
  assert.deepEqual(topSources(direct).map((r) => r.label), ['direct', 'google.com']);
});

test('losing games: starts >= 10 and finish rate under half the site median', () => {
  const d = base({
    gameStarts: { a: 20, b: 20, c: 20, d: 14, e: 8 },
    gameFinishes: { a: 10, b: 8, c: 6, d: 0, e: 0 },
    itemHotspots: [{ item: 'd/s1/#1', n: 6, okRate: 0.5 }, { item: 'd/s1/#2', n: 2, okRate: 0.5 }],
  });
  const lose = losingGames(d);
  assert.deepEqual(lose.map((g) => g.game), ['d']);
  assert.equal(lose[0].hotspot, 'd/s1/#1');
});

test('insights: nothing urgent line', () => {
  const out = insights(base({ features: { maker_show: 4 }, linkClicks: { 'termly-iimr.vercel.app': 2 } }));
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'ok');
  assert.equal(out[0].text, 'Nothing urgent. 40 runs finished, 2 Termly clicks this month.');
  const week = insights(base({ days: 7 }));
  assert.match(week[0].text, /in the last 7 days\.$/);
});

test('insights: broken always first', () => {
  const out = insights(base({ errors: [{ hash: 'x', n: 3 }], perf: { n: 40, lcpP95: 4500 }, funnel: { visited: 50, opened_a_game: 10 } }));
  assert.equal(out[0].kind, 'broken');
  assert.match(out[0].text, /^Fix: 3 errors \/ slow load on mobile \(LCP p95 4\.5s\)$/);
  assert.equal(out[1].kind, 'leak');
  assert.equal(insights(base({ uploadFails: 2 }))[0].text, 'Fix: 2 failed uploads');
  // LCP p95 between 2.5s and 4s is a Health verdict but not an urgent action.
  assert.notEqual(insights(base({ perf: { n: 40, lcpP95: 3000 } }))[0].kind, 'broken');
});

test('insights: low traffic replaces rules 2 to 5', () => {
  const out = insights(base({ uniqueVisitors: 12, funnel: { visited: 50, opened_a_game: 5 }, features: { maker_show: 30 } }));
  assert.deepEqual(out.map((i) => i.kind), ['traffic']);
  assert.equal(out[0].text, 'Not enough traffic to judge anything yet; get visitors first');
  const withBroken = insights(base({ uniqueVisitors: 12, errors: [{ hash: 'x', n: 1 }] }));
  assert.deepEqual(withBroken.map((i) => i.kind), ['broken', 'traffic']);
});

test('insights: leak detection respects upstream n >= 10 and links a section', () => {
  const f = { visited: 56, opened_a_game: 24, started_a_game: 24, selected_a_set: 12, run_started: 11, run_ended: 8, result_action_taken: 6, viewed_progress_or_board: 10 };
  const out = insights(base({ funnel: f }));
  const leak = out.find((i) => i.kind === 'leak');
  assert.equal(leak.text, 'Most people drop at Opened a game (lost 32 of 56); look at Reach');
  assert.equal(leak.section, 'reach');
  // A bigger raw drop from a tiny upstream stage is ignored.
  const tiny = insights(base({ funnel: { visited: 50, opened_a_game: 45, started_a_game: 9, selected_a_set: 0 } }));
  assert.match(tiny.find((i) => i.kind === 'leak').text, /Started a game \(lost 36 of 45\)/);
});

test('insights: locked set special case', () => {
  const f = { visited: 30, opened_a_game: 28, started_a_game: 27, selected_a_set: 10, run_started: 10, run_ended: 9 };
  const withTaps = insights(base({ funnel: f, setFriction: { lockedTaps: { 'latinsquare/s3': 5 } } }));
  assert.match(withTaps.find((i) => i.kind === 'leak').text, /^People tap locked sets; consider unlocking one more/);
  const noTaps = insights(base({ funnel: f }));
  assert.match(noTaps.find((i) => i.kind === 'leak').text, /^Most people drop at Picked a set/);
});

test('insights: game level rule names the hotspot', () => {
  const out = insights(base({
    gameStarts: { a: 20, b: 20, c: 14 }, gameFinishes: { a: 10, b: 8, c: 0 },
    itemHotspots: [{ item: 'c/s1/#3', n: 5, okRate: 0.2 }],
  }));
  const g = out.find((i) => i.kind === 'game');
  assert.equal(g.text, 'c loses players (0 of 14 finished); check hotspot c/s1/#3');
});

test('insights: termly rules need 20 shows', () => {
  const none = insights(base({ features: { maker_show: 25 } }));
  assert.equal(none.find((i) => i.kind === 'termly').text, 'Termly card gets no clicks, try new placement/copy');
  const swat = insights(base({ features: { maker_show: 25, maker_dismiss: 9 }, linkClicks: { 'termly-iimr.vercel.app': 3 } }));
  assert.equal(swat.find((i) => i.kind === 'termly').text, 'Termly card is being dismissed');
  const few = insights(base({ features: { maker_show: 10, maker_dismiss: 9 } }));
  assert.equal(few.find((i) => i.kind === 'termly'), undefined);
});

test('insights: traffic flat only with a prior period of n >= 20', () => {
  const flat = insights(base({ prev: { uniqueVisitors: 58 }, sources: { direct: { visitors: 40 }, 'reddit.com': { visitors: 15 } } }));
  assert.equal(flat.find((i) => i.kind === 'traffic').text, 'Traffic flat; top source is direct, double down or add a new one');
  assert.equal(insights(base({ prev: { uniqueVisitors: 30 } })).find((i) => i.kind === 'traffic'), undefined);
  assert.equal(insights(base({ prev: { uniqueVisitors: 10 } })).find((i) => i.kind === 'traffic'), undefined);
});

test('insights: at most 5, every one links to a known section', () => {
  const out = insights(base({
    errors: [{ hash: 'x', n: 1 }], prev: { uniqueVisitors: 60 }, features: { maker_show: 30 },
    funnel: { visited: 50, opened_a_game: 10 },
    gameStarts: { a: 20, b: 20, c: 14, d: 12, e: 11 }, gameFinishes: { a: 10, b: 10, c: 0, d: 0, e: 10 },
  }));
  assert.equal(out.length, 5);
  const ids = new Set(SECTIONS.map((s) => s.id));
  for (const i of out) assert.ok(ids.has(i.section), i.section);
});

test('sections: next actions plus 6, first three open by default', () => {
  assert.equal(SECTIONS.length, 7);
  assert.deepEqual(SECTIONS.map((s) => s.open), [true, true, true, false, false, false, false]);
});


test('leak rule: needs a 25% loss from an upstream stage of 10 or more', () => {
  assert.equal(LEAK_SHARE, 0.25);
  assert.equal(LEAK_MIN_N, 10);
  const flat = (v) => ({ started_a_game: v, selected_a_set: v, run_started: v, run_ended: v, result_action_taken: v, viewed_progress_or_board: v });
  // 40 to 31 loses 9 (22.5%): not a leak.
  assert.equal(funnelLeak({ visited: 40, opened_a_game: 31, ...flat(31) }), null);
  // 40 to 30 loses exactly 25%: a leak.
  assert.deepEqual(funnelLeak({ visited: 40, opened_a_game: 30, ...flat(30) }), { from: 'visited', to: 'opened_a_game', lost: 10, upstream: 40 });
  // Big share from a tiny stage is ignored.
  assert.equal(funnelLeak({ visited: 9, opened_a_game: 0 }), null);
  // Small steady losses keep "Nothing urgent" reachable.
  const f = { visited: 40, opened_a_game: 36, started_a_game: 33, selected_a_set: 30, run_started: 28, run_ended: 25, result_action_taken: 22, viewed_progress_or_board: 20 };
  const out = insights(base({ funnel: f }));
  assert.deepEqual(out.map((i) => i.kind), ['ok']);
  assert.match(funnelVerdict(f).text, /^No stage loses a quarter/);
});

test('error visitor helpers', () => {
  assert.equal(errorVisitorCount({}), null);
  assert.equal(errorVisitorCount({ errorVisitors: 3 }), 3);
  assert.equal(errorText(135, 1), '135 errors from 1 visitor');
  assert.equal(errorText(1, 2), '1 error from 2 visitors');
  assert.equal(errorText(4, null), '4 errors');
  assert.equal(errorsWidespread({ errors: [{ n: 5 }], errorVisitors: 1 }), false);
  assert.equal(errorsWidespread({ errors: [{ n: 5 }], errorVisitors: 2 }), true);
  assert.equal(errorsWidespread({ errors: [{ n: 5 }] }), true);
  assert.equal(errorsWidespread({ errors: [], errorVisitors: 4 }), false);
});

test('insights: errors from one visitor are a low priority note, not a Fix', () => {
  const one = insights(base({ errors: [{ hash: 'x', n: 135, visitors: 1 }], errorVisitors: 1 }));
  assert.deepEqual(one.map((i) => i.kind), ['ok', 'note']);
  assert.equal(one[1].text, 'One visitor hit 135 errors; check the top error when convenient');
  assert.equal(one[1].section, 'health');
  const many = insights(base({ errors: [{ hash: 'x', n: 135, visitors: 4 }], errorVisitors: 4 }));
  assert.equal(many[0].kind, 'broken');
  assert.equal(many[0].text, 'Fix: 135 errors from 4 visitors');
  // Slow p95 still raises Fix; the lone visitor errors stay a separate note.
  const slow = insights(base({ errors: [{ hash: 'x', n: 7 }], errorVisitors: 1, perf: { n: 40, lcpP95: 4500 } }));
  assert.equal(slow[0].text, 'Fix: slow load on mobile (LCP p95 4.5s)');
  assert.equal(slow.at(-1).kind, 'note');
  // Low traffic keeps the note too.
  const low = insights(base({ uniqueVisitors: 5, errors: [{ hash: 'x', n: 2 }], errorVisitors: 1 }));
  assert.deepEqual(low.map((i) => i.kind), ['traffic', 'note']);
});

test('health verdicts count affected visitors', () => {
  const v = healthVerdicts(base({ errors: [{ hash: 'A', n: 135, visitors: 1 }], errorVisitors: 1 }));
  assert.equal(v[0].text, '135 errors from 1 visitor, top: A');
  assert.equal(v[0].tone, 'mid');
  const w = healthVerdicts(base({ errors: [{ hash: 'A', n: 9, visitors: 3 }], errorVisitors: 3 }));
  assert.equal(w[0].tone, 'warn');
});

test('termly rows read the server "clicked" field and keep prompt clicks apart from passive clicks', () => {
  const d = { termly: { result_nudge: { shown: 30, clicked: 3, dismissed: 4 }, footer: { shown: 0, clicked: 5, dismissed: 0 } } };
  const t = termlyTotals(d);
  assert.equal(t.clicks, 8);
  assert.equal(t.promptClicks, 3);
  const rows = termlyPlacementRows(t.rows);
  assert.deepEqual(rows.map((r) => r.placement), ['result_nudge', 'footer']);
  assert.equal(rows[0].rate, 10);
  assert.equal(rows[0].detail, 'Dismissed 4; click rate 10%');
  assert.equal(rows[1].rate, null);
  assert.equal(rows[1].detail, 'Passive link, dismissed 0');
});

test('termly placement rows: counts only below 20 shows, empty rows dropped', () => {
  const rows = termlyPlacementRows(termlyRows({ termly: { review_done: { shown: 12, clicked: 2, dismissed: 1 }, progress_card: { shown: 0, clicked: 0, dismissed: 0 } } }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rate, null);
  assert.equal(rows[0].detail, 'Dismissed 1; rate after 20 shows');
  assert.deepEqual(termlyPlacementRows(null), []);
});

test('insights: termly no clicks rule ignores passive link clicks', () => {
  const d = base({ termly: { result_nudge: { shown: 25, clicked: 0, dismissed: 1 }, footer: { clicked: 6 } } });
  assert.equal(insights(d).find((i) => i.kind === 'termly').text, 'Termly card gets no clicks, try new placement/copy');
});

test('live summary', () => {
  assert.equal(liveSummary(null), null);
  assert.deepEqual(liveSummary({ visitors: 4, inRun: 1, windowSec: 300 }), { visitors: 4, inRun: 1, mins: 5, label: 'Visitors in the last 5 min', status: '1 mid-run' });
  assert.equal(liveSummary({ visitors: 0, inRun: 0, windowSec: 300 }).status, 'Nobody on the site right now');
  assert.equal(liveSummary({ visitors: 3, inRun: 0 }).status, 'None mid-run');
  // inRun never exceeds visitors.
  assert.equal(liveSummary({ visitors: 2, inRun: 5 }).inRun, 2);
});
