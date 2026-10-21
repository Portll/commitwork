// The Inbox client says which of four things it shows: no project, an error, never swept, or items
// split into Priority and Other with what was not measured always listed. U, H, J/K and Enter act on
// the selected row, never while typing, and a refused write is shown rather than assumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'panel-inbox.js'), 'utf8');
const ITEMS = [
  { id: 'new-critical|acme|depsGo|s2', kind: 'new-critical', priority: true, title: '1 new critical place(s) in depsGo', at: 'T', read: false, snoozedUntil: null, detail: { lane: 'depsGo', places: [{ repo: 'acme/w', id: 'GHSA-1', sev: 'crit' }], beyondCap: 3 } },
  { id: 'sweep-failed|acme|slice:s9', kind: 'sweep-failed', priority: true, title: 'Sweep did not finish', at: 'T', read: true, readAt: 'R', snoozedUntil: null, detail: {} },
  { id: 'lane-undetermined|acme|sastGo|no log', kind: 'lane-undetermined', priority: false, title: 'sastGo: coverage is undetermined', at: 'T', read: false, snoozedUntil: null, detail: { reason: 'no log' } },
  { id: 'ingest-behind|acme|slice:s2', kind: 'ingest-behind', priority: false, title: 'Work items are behind', at: 'T', read: false, snoozedUntil: '2026-10-15T00:00:00.000Z', detail: {} },
];
const OK = { ok: true, project: 'acme', state: 'swept', generated: 'T', prevSliceId: 's1', items: ITEMS, notMeasured: [{ signal: 'sla-due-soon', reason: 'not configured yet' }], counts: { priority: 2, other: 1, unread: 2, snoozed: 1 } };

function realm({ reply = OK, project = 'acme', fail = {} } = {}) {
  const container = { id: 'view-inbox', hidden: false, style: { display: '' }, classList: { contains: () => false }, _html: '', set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; } };
  const calls = { fetch: [], post: [], tabN: [] };
  const listeners = {};
  const document = {
    getElementById: (i) => (i === 'view-inbox' ? container : null),
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    dispatchEvent(ev) { (listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
  };
  const sandbox = {
    document, console, Date, Math, JSON, Object, Array, Set, Map, Promise, Number, String, encodeURIComponent, Error, curProj: project,
    fetch: async (url) => { calls.fetch.push(String(url)); if (fail.get) return { ok: false, status: 500, json: async () => ({ ok: false, error: 'rollup at r.json is not JSON' }) }; return { ok: true, status: 200, json: async () => reply }; },
    cwPost: async (url, opts) => { calls.post.push([url, JSON.parse(opts.body)]); if (fail.post) return { ok: false, status: 503, json: async () => ({ ok: false, error: 'refusing to write: inbox state unreadable' }) }; return { ok: true, status: 200, json: async () => ({ ok: true, applied: 1 }) }; },
    setTabN: (...a) => calls.tabN.push(a),
  };
  sandbox.globalThis = sandbox;
  vm.runInContext(SRC, vm.createContext(sandbox), { filename: 'panel-inbox.js' });
  const key = (k, over = {}) => { const ev = { type: 'keydown', key: k, target: null, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...over }; document.dispatchEvent(ev); return ev; };
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
  return { api: sandbox.cwInbox, container, calls, key, flush, click: (target) => document.dispatchEvent({ type: 'click', target }) };
}

test('no project, an error and never swept each say which they are', async () => {
  const none = realm({ project: '' });
  await none.api.loadInbox();
  assert.match(none.container.innerHTML, /choose a project/);
  assert.equal(none.calls.fetch.length, 0);
  const bad = realm({ fail: { get: true } });
  await bad.api.loadInbox();
  assert.match(bad.container.innerHTML, /pill high">error<\/span> rollup at r\.json is not JSON/);
  assert.match(bad.container.innerHTML, /never an empty inbox/);
  const never = realm({ reply: { ok: true, project: 'acme', state: 'never-swept', items: [], notMeasured: [] } });
  await never.api.loadInbox();
  assert.match(never.container.innerHTML, /never swept/);
});

test('Priority shows priority items not snoozed; Other the rest; not-measured is listed on both; the badge counts both tabs', async () => {
  const r = realm();
  await r.api.loadInbox();
  const h = r.container.innerHTML;
  assert.match(h, /Priority \(2\)/); assert.match(h, /Other \(1\)/);
  assert.match(h, /1 new critical place/); assert.match(h, /Sweep did not finish/);
  assert.doesNotMatch(h, /coverage is undetermined/);
  assert.match(h, /sla-due-soon<\/code> — not configured yet/);
  assert.match(h, /3 more past the delta's display cap/);
  assert.deepEqual(r.calls.tabN.at(-1), ['inbox', 3]);
  r.click({ dataset: { tab: 'other' } });
  const o = r.container.innerHTML;
  assert.match(o, /coverage is undetermined/);
  assert.doesNotMatch(o, /Work items are behind/, 'snoozed is hidden');
  assert.match(o, /sla-due-soon/);
});

test('J/K move, U toggles read, H snoozes seven days, Enter marks read; nothing fires while typing', async () => {
  const r = realm();
  await r.api.loadInbox();
  r.key('u'); await r.flush();
  assert.deepEqual(r.calls.post.at(-1), ['/api/inbox/mark', { ids: ['new-critical|acme|depsGo|s2'], action: 'read' }]);
  r.key('j');
  assert.equal(r.api.state.active, 1);
  r.key('u'); await r.flush();
  assert.deepEqual(r.calls.post.at(-1)[1], { ids: ['sweep-failed|acme|slice:s9'], action: 'unread' }, 'a read row toggles back');
  r.key('k');
  r.key('h'); await r.flush();
  assert.deepEqual(r.calls.post.at(-1)[1], { ids: ['new-critical|acme|depsGo|s2'], action: 'snooze', days: 7 });
  const n = r.calls.post.length;
  r.key('u', { target: { tagName: 'INPUT' } });
  r.key('h', { metaKey: true });
  await r.flush();
  assert.equal(r.calls.post.length, n);
  r.key('Enter'); await r.flush();
  assert.equal(r.calls.post.at(-1)[1].action, 'read');
});

test('a refused write is shown as refused and the list is not re-read as if it had worked', async () => {
  const r = realm({ fail: { post: true } });
  await r.api.loadInbox();
  const fetches = r.calls.fetch.length;
  r.key('u'); await r.flush();
  assert.match(r.container.innerHTML, /pill high">refused<\/span> refusing to write/);
  assert.equal(r.calls.fetch.length, fetches);
});
