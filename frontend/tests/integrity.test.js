import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM: just enough EventTarget surface for the listener module.
class FakeNode {}
const doc = Object.assign(new EventTarget(), { hidden: false });
const win = new EventTarget();
globalThis.Node = FakeNode;
globalThis.document = doc;
globalThis.window = Object.assign(win, { getSelection: () => ({ toString: () => 'x'.repeat(40) }) });

const { attachIntegrityListeners } = await import('../src/services/integrity.js');

const setup = (opts = {}) => {
  const sent = [];
  const api = attachIntegrityListeners({ send: (type, meta) => sent.push([type, meta]), enabled: () => opts.enabled ?? true, scope: opts.scope });
  return { sent, api };
};
const fire = (target, type, extra = {}) => {
  const e = new Event(type);
  for (const [k, v] of Object.entries(extra)) Object.defineProperty(e, k, { value: v }); // shadows the read-only getters
  target.dispatchEvent(e);
};

test('tab hidden then visible reports both, with the away time', () => {
  const { sent, api } = setup();
  doc.hidden = true; fire(doc, 'visibilitychange');
  doc.hidden = false; fire(doc, 'visibilitychange');
  api.dispose();
  assert.deepEqual(sent.map((s) => s[0]), ['tab_hidden', 'tab_visible']);
  assert.ok(sent[1][1].awayMs >= 0);
});

test('paste reports only the LENGTH, never the content', () => {
  const { sent, api } = setup();
  fire(doc, 'paste', { clipboardData: { getData: () => 'secret solution text' }, target: new FakeNode() });
  api.dispose();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], ['paste', { length: 20 }]);
  assert.ok(!JSON.stringify(sent).includes('secret'));
});

test('paste outside the editor scope is ignored', () => {
  const inside = new FakeNode(), outside = new FakeNode();
  const scopeEl = Object.assign(new FakeNode(), { contains: (n) => n === inside });
  const { sent, api } = setup({ scope: () => scopeEl });
  fire(doc, 'paste', { clipboardData: { getData: () => 'abc' }, target: outside });
  fire(doc, 'paste', { clipboardData: { getData: () => 'abc' }, target: inside });
  api.dispose();
  assert.equal(sent.length, 1);
});

test('large non-paste growth is a large_insert; typing and real pastes are not', () => {
  const { sent, api } = setup();
  api.noteChange(100, 101, 'insertText');
  api.noteChange(100, 400, 'insertFromPaste');   // already reported by the paste listener
  api.noteChange(100, 400, 'insertFromDrop');
  api.dispose();
  assert.deepEqual(sent, [['large_insert', { length: 300 }]]);
});

test('nothing is sent when monitoring is disabled, and dispose removes listeners', () => {
  const off = setup({ enabled: false });
  doc.hidden = true; fire(doc, 'visibilitychange'); doc.hidden = false;
  off.api.dispose();
  assert.equal(off.sent.length, 0);

  const on = setup();
  on.api.dispose();
  fire(win, 'blur');
  assert.equal(on.sent.length, 0);
});

test('copy reports the selection length only', () => {
  const { sent, api } = setup();
  fire(doc, 'copy');
  api.dispose();
  assert.deepEqual(sent, [['copy', { length: 40 }]]);
});

test('unmounted editor scope and disabled monitoring never read paste contents', () => {
  const clipboardData = {getData() { throw Error('clipboard must not be read'); }};
  const unmounted = setup({scope: () => null});
  fire(doc, 'paste', {clipboardData, target: new FakeNode()});
  unmounted.api.dispose();
  assert.deepEqual(unmounted.sent, []);
  const disabled = setup({enabled: false});
  fire(doc, 'paste', {clipboardData, target: new FakeNode()});
  disabled.api.dispose();
  assert.deepEqual(disabled.sent, []);
});

test('copy outside the editor is ignored', () => {
  const outside = new FakeNode();
  const {sent, api} = setup({scope: () => ({contains: () => false})});
  fire(doc, 'copy', {target: outside});
  api.dispose();
  assert.deepEqual(sent, []);
});
