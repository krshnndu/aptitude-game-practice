// Operator Switch UI smoke test without a browser: a minimal DOM shim (elements, attributes,
// classes, events, a small selector engine) is enough to mount play.js and drive the practice and
// timed run flows. Layout and CSS are not checked here.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- tiny DOM

class Node {
  constructor() {
    this.parentNode = null;
    this.childNodes = [];
    this.listeners = {};
  }
  append(...kids) {
    for (const k of kids) {
      const n = typeof k === 'string' ? new Text(k) : k;
      if (n.parentNode) n.parentNode.childNodes.splice(n.parentNode.childNodes.indexOf(n), 1);
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  replaceChildren(...kids) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...kids);
  }
  replaceWith(n) {
    const p = this.parentNode;
    const i = p.childNodes.indexOf(this);
    if (n.parentNode) n.parentNode.childNodes.splice(n.parentNode.childNodes.indexOf(n), 1);
    p.childNodes[i] = n;
    n.parentNode = p;
    this.parentNode = null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.replaceChildren(new Text(String(v)));
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  dispatchEvent(ev) {
    ev.target ??= this;
    for (let n = this; n; n = n.parentNode) {
      for (const fn of n.listeners[ev.type] ?? []) fn(ev);
      if (n === doc.documentElement) {
        for (const fn of doc.listeners[ev.type] ?? []) fn(ev);
        break;
      }
    }
    return true;
  }
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
}

class Text extends Node {
  constructor(t) {
    super();
    this.data = t;
  }
  get textContent() {
    return this.data;
  }
  set textContent(v) {
    this.data = String(v);
  }
}

class ClassList {
  constructor(elm) {
    this.elm = elm;
  }
  get list() {
    return (this.elm.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  }
  contains(c) {
    return this.list.includes(c);
  }
  add(...cs) {
    this.elm.setAttribute('class', [...new Set([...this.list, ...cs])].join(' '));
  }
  remove(...cs) {
    this.elm.setAttribute('class', this.list.filter((c) => !cs.includes(c)).join(' '));
  }
  toggle(c, on = !this.contains(c)) {
    if (on) this.add(c);
    else this.remove(c);
    return on;
  }
}

class Element extends Node {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.attrs = new Map();
    this.classList = new ClassList(this);
    this.style = { setProperty() {} };
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    const self = this;
    this.dataset = new Proxy({}, {
      get: (_, k) => self.getAttribute(`data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`) ?? undefined,
      set: (_, k, v) => {
        self.setAttribute(`data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, v);
        return true;
      },
    });
  }
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k) {
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }
  removeAttribute(k) {
    this.attrs.delete(k);
  }
  toggleAttribute(k, on = !this.attrs.has(k)) {
    if (on) this.attrs.set(k, '');
    else this.attrs.delete(k);
    return on;
  }
  get className() {
    return this.getAttribute('class') ?? '';
  }
  set className(v) {
    this.setAttribute('class', v);
  }
  get id() {
    return this.getAttribute('id') ?? '';
  }
  focus() {
    doc.activeElement = this;
  }
  scrollIntoView() {}
  click() {
    if (this.disabled) return;
    if (this.tagName === 'INPUT' && this.getAttribute('type') === 'checkbox') {
      this.checked = !this.checked;
      this.dispatchEvent({ type: 'click', target: this });
      this.dispatchEvent({ type: 'change', target: this });
      return;
    }
    this.dispatchEvent({ type: 'click', target: this });
  }
  *descendants() {
    for (const c of this.childNodes) {
      if (c instanceof Element) {
        yield c;
        yield* c.descendants();
      }
    }
  }
  querySelectorAll(sel) {
    const groups = sel.split(',').map((s) => s.trim().split(/\s+(?![^[]*\])/).map(parseCompound));
    return [...this.descendants()].filter((e) => groups.some((parts) => matchChain(e, parts, this)));
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

function parseCompound(s) {
  const out = { tag: null, classes: [], attrs: [] };
  const re = /^([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) out.tag = m[1].toUpperCase();
    else if (m[2]) out.classes.push(m[2]);
    else if (m[3]) out.attrs.push(['id', m[3]]);
    else out.attrs.push([m[4], m[5]]);
  }
  return out;
}

function matchOne(e, c) {
  if (c.tag && e.tagName !== c.tag) return false;
  if (!c.classes.every((k) => e.classList.contains(k))) return false;
  return c.attrs.every(([k, v]) => (v === undefined ? e.getAttribute(k) !== null : e.getAttribute(k) === v));
}

function matchChain(e, parts, scope) {
  if (!matchOne(e, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let p = e.parentNode; p && i >= 0 && p !== scope.parentNode; p = p.parentNode) {
    if (p instanceof Element && matchOne(p, parts[i])) i--;
  }
  return i < 0;
}

const doc = new Node();
doc.createElement = (t) => new Element(t);
doc.createElementNS = (_, t) => new Element(t);
doc.createTextNode = (t) => new Text(t);
doc.documentElement = new Element('html');
doc.head = new Element('head');
doc.body = new Element('body');
doc.documentElement.append(doc.head, doc.body);
doc.activeElement = doc.body;
doc.querySelector = (s) => doc.documentElement.querySelector(s);
doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);

const storage = new Map();
let offset = 0;
const realNow = Date.now;

before(() => {
  globalThis.Node = Node;
  globalThis.document = doc;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  globalThis.fetch = async (url) => {
    const text = readFileSync(fileURLToPath(url), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  };
  Date.now = () => realNow() + offset;
});

// ---------------------------------------------------------------- helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (k) => doc.dispatchEvent({ type: 'keydown', key: k, preventDefault() {} });
const $ = (s) => doc.querySelector(s);
const $$ = (s) => doc.querySelectorAll(s);
const setFile = (k) => JSON.parse(readFileSync(new URL(`../data/sets/operatorswitch/set${k}.json`, import.meta.url), 'utf8'));

async function mount(args) {
  const { mountOperatorSwitch } = await import('../js/games/operatorswitch/play.js');
  const main = new Element('main');
  doc.body.replaceChildren(main);
  const dispose = await mountOperatorSwitch(main, args);
  return { main, dispose };
}

// ---------------------------------------------------------------- tests

test('menu: five sets, stylesheet injected once, unlock all off by default and visible', async () => {
  const { dispose } = await mount([]);
  assert.equal($$('.set-card').length, 5);
  assert.equal($$('.set-card.is-locked').length, 4);
  assert.equal($('#os-unlock-all').checked, false);
  assert.match($('.os-unlock').textContent, /Unlock all sets/);
  dispose();
  await mount([]);
  assert.equal($$('link[data-game-css="operatorswitch"]').length, 1, 'stylesheet link added only once');
  assert.match($$('link[data-game-css="operatorswitch"]')[0].href, /css\/operatorswitch\.css$/);
});

test('practice: wrong pick crossed out, hint, correct answer, coach and explanation, progress saved', async () => {
  const p = setFile(1).puzzles[0];
  const wrong = p.answer === 0 ? 1 : 0;
  const { dispose } = await mount(['practice', '1', '1']);
  assert.equal($$('.os-option').length, p.options.length);
  $(`[data-option="${wrong}"]`).click();
  const crossed = $(`[data-option="${wrong}"]`);
  assert.ok(crossed.classList.contains('is-crossed'));
  assert.ok(crossed.disabled);
  assert.match(crossed.textContent, /Wrong/, 'text mark, not colour only');
  key('h');
  assert.equal($$('.os-hints li').length, 1);
  key(String(p.answer + 1));
  assert.ok($('.coach .findings'), 'coach shown');
  assert.ok($('.os-explain .os-steps'), 'explanation shown');
  assert.match($('.os-explain .result-line').textContent, /50%/);
  assert.match($('.coach').textContent, /wasted answer/);
  const prog = JSON.parse(storage.get('cogprep.progress.v1'));
  assert.equal(prog.games.operatorswitch[1].practice[p.id], 0.5);
  const hist = JSON.parse(storage.get('cogprep.attempts.v1'));
  const a = hist.attempts.find((x) => x.puzzleId === p.id);
  assert.deepEqual(a.events.filter((e) => e.type !== 'solve').map((e) => e.type), ['move', 'hint', 'move']);
  dispose();
});

test('practice: skip reveals the answer; locked sets show a notice until unlock all', async () => {
  let m = await mount(['practice', '4', '2']);
  assert.match(m.main.textContent, /Set 4 is locked/);
  m.dispose();
  m = await mount([]);
  $('#os-unlock-all').click();
  assert.equal($$('.set-card.is-locked').length, 0);
  m.dispose();
  m = await mount(['practice', '4', '9']);
  assert.ok($('.os-op.is-hidden'), 'hidden box drawn');
  $('.controls .btn-warn').click();
  assert.ok($('.os-option.is-correct'));
  assert.match($('.os-explain').textContent, /Read the hidden box/);
  m.dispose();
  m = await mount(['practice', '5', '10']);
  assert.equal($$('.os-chain').length, 2, 'two chains on a twin puzzle');
  assert.equal($$('.os-slot').length, 2 * 5, 'five items per start row');
  m.dispose();
});

test('timed run: tutorial, exam screen without hints, answers by key, skip, time up, summary and review', async () => {
  const { dispose } = await mount(['run', '2']);
  assert.ok($('.run-intro'), 'tutorial screen first');
  $('.run-intro [data-option="1"]').click();
  assert.match($('.run-intro .flash').textContent, /^Wrong/);
  const startBtn = [...$$('.run-intro .btn-primary')].pop();
  startBtn.click();
  assert.ok(doc.body.classList.contains('exam-active'));
  assert.equal($('.os-hints'), null, 'no hints in exam mode');
  assert.doesNotMatch($('.os-play').textContent, /Hint/);
  for (let i = 0; i < 6; i++) {
    if (i === 2) $('.exam-hud .btn-warn').click();
    else key(String((i % 4) + 1));
    await sleep(520);
  }
  assert.equal($('.run-progress').textContent, 'Puzzle 7');
  offset += 6 * 60 * 1000;
  await sleep(400);
  assert.equal($('.run-summary h2')?.textContent, 'Time is up');
  assert.equal($$('.results tbody tr').length, 7);
  assert.ok(!doc.body.classList.contains('exam-active'));
  $('.results tbody tr .btn-small').click();
  assert.ok($('.review-host .os-play.is-review'));
  assert.ok($('.review-host .os-explain'));
  const hist = JSON.parse(storage.get('cogprep.attempts.v1'));
  const run = hist.runs.find((r) => r.game === 'operatorswitch');
  assert.ok(run);
  assert.equal(run.attempted, 7);
  assert.ok(run.score >= 0, 'run score is floored at 0');
  dispose();
  offset = 0;
});
