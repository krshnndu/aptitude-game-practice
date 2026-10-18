// Digit Equation UI smoke test: mounts play.js on a tiny in-memory DOM (no dependencies) and drives
// the menu, a practice puzzle (wrong check, two-level hint, keyboard solve, coach and explanation),
// the tutorial and a whole timed test (skips, then the clock runs out), checking what gets saved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- minimal DOM

class Node {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.replaceChildren();
    if (v !== '' && v !== null && v !== undefined) this.append(new Text(String(v)));
  }
  append(...nodes) {
    for (const n of nodes) {
      const node = n instanceof Node ? n : new Text(String(n));
      node.parentNode?.removeChild(node);
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
  }
  replaceChildren(...nodes) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  replaceWith(n) {
    const p = this.parentNode;
    const i = p.childNodes.indexOf(this);
    n.parentNode?.removeChild(n);
    p.childNodes.splice(i, 1, n);
    n.parentNode = p;
    this.parentNode = null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  get isConnected() {
    let x = this;
    while (x.parentNode) x = x.parentNode;
    return x === globalThis.document;
  }
}
class Text extends Node {
  constructor(t) {
    super();
    this.t = t;
  }
  get textContent() {
    return this.t;
  }
  set textContent(v) {
    this.t = String(v);
  }
}
class ClassList {
  constructor(el) {
    this.el = el;
  }
  get set() {
    return new Set((this.el.className || '').split(/\s+/).filter(Boolean));
  }
  write(s) {
    this.el.className = [...s].join(' ');
  }
  add(...c) {
    const s = this.set;
    c.forEach((x) => s.add(x));
    this.write(s);
  }
  remove(...c) {
    const s = this.set;
    c.forEach((x) => s.delete(x));
    this.write(s);
  }
  contains(c) {
    return this.set.has(c);
  }
  toggle(c, on) {
    const want = on === undefined ? !this.contains(c) : !!on;
    if (want) this.add(c);
    else this.remove(c);
    return want;
  }
}
function parseCompound(s) {
  const tag = s.match(/^[a-z0-9]+/i)?.[0]?.toUpperCase() ?? null;
  const classes = [...s.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const attrs = [...s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map((m) => ({ k: m[1], v: m[2] }));
  const nots = [...s.matchAll(/:not\(([^)]*)\)/g)].map((m) => parseCompound(m[1]));
  const id = s.match(/#([\w-]+)/)?.[1] ?? null;
  return { tag, classes, attrs, nots, id };
}
function matches(el, c) {
  if (!(el instanceof Element)) return false;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  if (c.classes.some((x) => !el.classList.contains(x))) return false;
  if (c.attrs.some(({ k, v }) => (v === undefined ? !el.hasAttribute(k) : el.getAttribute(k) !== v))) return false;
  if (c.nots.some((n) => matches(el, n))) return false;
  return true;
}
function selectorMatches(el, sel) {
  const parts = sel.replace(/:not\([^)]*\)/g, (m) => m.replace(/\s/g, '\u0000')).trim().split(/\s+/).map((p) => parseCompound(p.replace(/\u0000/g, ' ')));
  if (!matches(el, parts[parts.length - 1])) return false;
  let k = parts.length - 2;
  for (let x = el.parentNode; x && k >= 0; x = x.parentNode) if (matches(x, parts[k])) k--;
  return k < 0;
}
class Element extends Node {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.listeners = {};
    this.className = '';
    this.classList = new ClassList(this);
    this.dataset = new Proxy({}, {
      get: (_, k) => this.getAttribute(`data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`) ?? undefined,
    });
    const props = {};
    this.style = { setProperty: (k, v) => (props[k] = v) };
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
  }
  setAttribute(k, v) {
    if (k === 'class') this.className = String(v);
    else this.attributes.set(k, String(v));
  }
  getAttribute(k) {
    if (k === 'class') return this.className;
    return this.attributes.has(k) ? this.attributes.get(k) : null;
  }
  hasAttribute(k) {
    return k === 'class' ? !!this.className : this.attributes.has(k);
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }
  toggleAttribute(k, on) {
    if (on) this.attributes.set(k, '');
    else this.attributes.delete(k);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  dispatch(type, extra = {}) {
    const ev = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (let x = this; x; x = x.parentNode) for (const fn of x.listeners?.[type] || []) fn(ev);
    return ev;
  }
  click() {
    if (this.disabled) return;
    this.dispatch('click');
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  scrollIntoView() {}
  get offsetWidth() {
    return 1;
  }
  closest(sel) {
    for (let x = this; x instanceof Element; x = x.parentNode) if (selectorMatches(x, sel)) return x;
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c instanceof Element) {
          if (sel.split(',').some((s) => selectorMatches(c, s))) out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}
class Document extends Element {
  constructor() {
    super('#document');
    this.head = new Element('head');
    this.body = new Element('body');
    this.append(this.head, this.body);
    this.activeElement = this.body;
  }
  createElement(tag) {
    return new Element(tag);
  }
  createTextNode(t) {
    return new Text(t);
  }
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}

globalThis.Node = Node;
globalThis.document = new Document();
globalThis.localStorage = memoryStorage();
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.fetch = async (url) => {
  const text = readFileSync(fileURLToPath(url), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
};

const { mountDigitEquation } = await import('../js/games/digitequation/play.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (k) => globalThis.document.dispatch('keydown', { key: k });

async function mount(args) {
  const main = new Element('main');
  globalThis.document.body.replaceChildren(main);
  const dispose = await mountDigitEquation(main, args);
  const q = (s) => main.querySelector(s);
  const qa = (s) => main.querySelectorAll(s);
  const btn = (label) => qa('button').find((b) => b.textContent.trim() === label);
  return { main, dispose, q, qa, btn };
}

// ---------------------------------------------------------------- tests

test('menu: five set cards, set 1 open, unlock toggle visible and off, css injected once', async () => {
  const { qa, q, dispose } = await mount([]);
  assert.equal(qa('.set-card').length, 5);
  assert.equal(qa('.set-card.is-locked').length, 4);
  assert.ok(q('#de-unlock-all'));
  assert.equal(q('#de-unlock-all').checked, false);
  dispose();
  await mount([]);
  assert.equal(globalThis.document.head.querySelectorAll('link[data-game-css="digitequation"]').length, 1);
});

test('locked set shows a notice until Unlock all is on', async () => {
  let m = await mount(['practice', '2', '3']);
  assert.match(m.main.textContent, /Set 2 is locked/);
  m.dispose();
  m = await mount([]);
  const toggle = m.q('#de-unlock-all');
  toggle.checked = true;
  toggle.dispatch('change');
  assert.equal(m.qa('.set-card.is-locked').length, 0);
  m.dispose();
});

test('practice: wrong check, two-level hint, keyboard solve, coach, explanation, saved attempt', async () => {
  // Set 2 puzzle 3 is 4_ x 8 = 3_6 with tray 2 3x2 5 6: the answer is A = 2, B = 3.
  const { q, qa, btn, dispose } = await mount(['practice', '2', '3']);
  assert.equal(qa('.de-slot').length, 2);
  assert.equal(qa('.de-tile').length, 4);
  q('.de-tile[data-digit="5"]').click();
  q('.de-tile[data-digit="3"]').click();
  btn('Check').click();
  assert.match(q('.play-message').textContent, /Not true: the left side is 360, the right side is 336/);
  btn('Hint').click();
  assert.match(q('.play-message').textContent, /blank A does not fit yet\. Technique: last-digit test/);
  btn('Hint').click();
  assert.match(q('.play-message').textContent, /Hint: Last-digit test/);
  q('.de-slot[data-slot="0"]').click();
  key('2');
  key('Enter');
  await wait(60);
  assert.match(q('.play-message').textContent, /True\. Solved with 3 tiles placed/);
  const titles = qa('.finding-title').map((x) => x.textContent);
  assert.ok(titles.includes('1 wrong check'), titles.join('|'));
  assert.ok(titles.includes('1 extra placement'));
  assert.ok(qa('.de-explain .step-list li').length >= 2);
  assert.match(q('.de-answer').textContent, /42 × 8 = 336/);
  const rec = JSON.parse(globalThis.localStorage.getItem('cogprep.attempts.v1'));
  const a = rec.attempts.at(-1);
  assert.equal(a.game, 'digitequation');
  assert.equal(a.metrics.grossMoves, 3);
  assert.ok(Math.abs(a.metrics.efficiency - 2 / 3) < 1e-9);
  assert.equal(a.metrics.blocked, 1);
  assert.equal(a.hintsUsed, 2);
  const prog = JSON.parse(globalThis.localStorage.getItem('cogprep.progress.v1'));
  assert.ok(Math.abs(prog.games.digitequation[2].practice['de2-03'] - 2 / 3) < 1e-9);
  dispose();
});

test('timed test: tutorial, exam screen without hints, skips, time up, summary and saved run', async () => {
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try {
    const { q, qa, btn, dispose } = await mount(['run', '5']);
    key('7');
    btn('Check').click();
    await wait(20);
    assert.match(q('.flash').textContent, /True with one tile placed/);
    btn('I am ready: start the 6:00 run').click();
    assert.ok(q('.exam-hud .clock'));
    assert.equal(btn('Hint'), undefined, 'no hints in exam mode');
    assert.equal(btn('Reset'), undefined);
    for (let i = 0; i < 4; i++) {
      key('1');
      btn('Skip').click();
    }
    assert.equal(q('.run-progress').textContent, 'Puzzle 5');
    offset = 361_000;
    await wait(400);
    assert.equal(q('.run-summary h2')?.textContent, 'Time is up');
    assert.equal(qa('table.results tbody tr').length, 5);
    const lines = qa('.run-coach .finding-title').map((x) => x.textContent);
    assert.deepEqual(lines, ['Time per puzzle', 'Accuracy', 'Skip policy', 'Pace against the 6:00 budget']);
    qa('table.results tbody tr button')[0].click();
    assert.ok(qa('.review-host .step-list li').length >= 2);
    const rec = JSON.parse(globalThis.localStorage.getItem('cogprep.attempts.v1'));
    const run = rec.runs.at(-1);
    assert.equal(run.game, 'digitequation');
    assert.equal(run.attempted, 5);
    assert.equal(run.skipped, 4);
    assert.equal(run.timedOut, 1);
    assert.equal(globalThis.document.body.classList.contains('exam-active'), false);
    dispose();
  } finally {
    Date.now = realNow;
  }
});
