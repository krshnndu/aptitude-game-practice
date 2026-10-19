// Termly governor: 1 prompt per session across placements, 3 per 7 days, stop after a click or two dismissals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor, termlyUrl, termlyFunnel, PLACEMENTS, MAKER_KEY, MAKER_SESSION_KEY, WEEK_MS } from '../js/core/maker.js';
import { memoryStorage } from '../js/core/store.js';

const DAY = 864e5;
const clock = (t = 1e12) => { const c = () => c.t; c.t = t; return c; };

test('governor: one prompt per session across all placements', () => {
  const local = memoryStorage();
  const tab = memoryStorage();
  const g = createGovernor(local, tab, clock());
  assert.equal(g.take('result_nudge'), true);
  assert.equal(tab.getItem(MAKER_SESSION_KEY), 'result_nudge');
  assert.equal(g.take('progress_card'), false);
  assert.equal(g.take('result_nudge'), false);
  assert.equal(createGovernor(local, memoryStorage(), clock()).take('review_done'), true);
});

test('governor: at most 3 per 7 days, rolling', () => {
  const local = memoryStorage();
  const now = clock();
  for (let i = 0; i < 3; i++) {
    assert.equal(createGovernor(local, memoryStorage(), now).take('progress_card'), true);
    now.t += DAY;
  }
  assert.equal(createGovernor(local, memoryStorage(), now).canShow(), false);
  now.t = 1e12 + WEEK_MS;
  const g = createGovernor(local, memoryStorage(), now);
  assert.equal(g.take('progress_card'), true);
  assert.equal(g.state().shows.length, 3);
});

test('governor: never again after one click', () => {
  const local = memoryStorage();
  createGovernor(local, memoryStorage(), clock()).click();
  assert.equal(createGovernor(local, memoryStorage(), clock()).canShow(), false);
});

test('governor: never again after two dismissals', () => {
  const local = memoryStorage();
  const now = clock();
  const g1 = createGovernor(local, memoryStorage(), now);
  assert.equal(g1.take('result_nudge'), true);
  g1.dismiss();
  now.t += 8 * DAY;
  const g2 = createGovernor(local, memoryStorage(), now);
  assert.equal(g2.take('progress_card'), true);
  g2.dismiss();
  now.t += 8 * DAY;
  assert.equal(createGovernor(local, memoryStorage(), now).canShow(), false);
  assert.equal(JSON.parse(local.getItem(MAKER_KEY)).dismissed, 2);
});

test('governor: storage failures hide prompts and never throw', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  for (const [l, s] of [[broken, memoryStorage()], [memoryStorage(), broken], [null, null]]) {
    const g = createGovernor(l, s, clock());
    assert.equal(g.canShow(), false);
    assert.equal(g.take('result_nudge'), false);
    assert.doesNotThrow(() => { g.click(); g.dismiss(); });
  }
  const bad = memoryStorage();
  bad.setItem(MAKER_KEY, '{not json');
  assert.equal(createGovernor(bad, memoryStorage(), clock()).canShow(), false);
});

test('governor: a full session slot from another tab state is respected', () => {
  const tab = memoryStorage();
  tab.setItem(MAKER_SESSION_KEY, 'review_done');
  assert.equal(createGovernor(memoryStorage(), tab, clock()).canShow(), false);
});

test('termlyUrl tags every placement', () => {
  assert.equal(PLACEMENTS.length, 8);
  for (const p of PLACEMENTS) {
    const u = new URL(termlyUrl(p));
    assert.equal(u.origin + u.pathname, 'https://termly-iimr.vercel.app/welcome');
    assert.equal(u.searchParams.get('utm_source'), 'cogprep');
    assert.equal(u.searchParams.get('utm_medium'), 'referral');
    assert.equal(u.searchParams.get('utm_campaign'), p);
  }
});

test('termlyFunnel: null without per placement data, rows when present', () => {
  assert.equal(termlyFunnel({ features: { maker_show: 4 } }), null);
  assert.equal(termlyFunnel(null), null);
  const rows = termlyFunnel({ termly: { progress_card: { shown: 5, clicks: 1 } } });
  assert.equal(rows.length, PLACEMENTS.length);
  assert.deepEqual(rows.find((r) => r.placement === 'progress_card'), { placement: 'progress_card', shown: 5, clicks: 1 });
  assert.deepEqual(rows.find((r) => r.placement === 'footer'), { placement: 'footer', shown: 0, clicks: 0 });
});
