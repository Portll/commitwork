// The checklist renders what the route measured and nothing more: an unreadable step says so, an
// error is a banner rather than a complete list, optional steps carry acknowledge and undo
// controls while measured ones carry none, the rail item shows progress and hides on completion or
// dismissal, operator-only steps off the port show the wording, and the palette step completes
// only on the palette's own navigation event.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'static', 'panel-journey.js'), 'utf8');

const STEPS = [
  { id: 'account', title: 'Create the operator account', optional: false, operatorOnly: true, state: 'done', detail: '1 account', cli: null },
  { id: 'personalise', title: 'Make it yours', optional: true, operatorOnly: false, state: 'todo', detail: '', cli: null },
  { id: 'palette', title: 'Learn the command palette', optional: true, operatorOnly: false, state: 'todo', detail: '', cli: null },
  { id: 'project', title: 'Add your first project', optional: false, operatorOnly: false, state: 'todo', detail: 'the panel is reading the EXAMPLE registry', cli: 'node bin/commitwork.mjs init --root ~/Repositories' },
  { id: 'scanners', title: 'Scanner readiness', optional: false, operatorOnly: true, state: 'todo', offPort: true, detail: '', counts: { present: 3, missing: 1, installedNotOnPath: 1, accountGated: 1 }, missing: [{ name: 'gitleaks', blocks: ['secrets'] }], installedNotOnPath: [{ name: 'ruff', at: '/opt/tools/bin/ruff', blocks: ['lint'] }], cli: 'node bin/commitwork.mjs setup' },
  { id: 'credentials', title: 'Credentials', optional: true, operatorOnly: true, state: 'skipped', detail: 'skipped', missing: [], accountGated: [{ tool: 'socket', vendor: 'Socket', needs: ['an account'], state: 'missing' }], cli: null },
  { id: 'firstrun', title: 'First run', optional: false, operatorOnly: false, state: 'todo', detail: 'no area has a rollup yet', reportDirSet: false, cli: 'run fast' },
  { id: 'schedule', title: 'Schedule the sweeps', optional: false, operatorOnly: true, state: 'unreadable', detail: 'the launch agents could not be read', cli: null },
  { id: 'notifications', title: 'Daily report and digest', optional: true, operatorOnly: false, state: 'todo', detail: 'no daily.json', cli: null },
];
const PAYLOAD = { ok: true, operator: false, storeSource: 'default', steps: STEPS, progress: { done: 2, total: 9, unreadable: ['schedule'] }, dismissed: false, storeState: 'absent', storeError: null, complete: false };

function realm({ payload = PAYLOAD, status = 200, featureOn = true } = {}) {
  const view = { id: 'view-journey', _html: '', set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; } };
  const rail = { id: 'rail-journey', hidden: false, textContent: 'Get set up' };
  const calls = { fetch: [], post: [], nav: [] };
  const document = {
    listeners: {},
    getElementById: (i) => (i === 'view-journey' ? view : i === 'rail-journey' ? rail : null),
    addEventListener(t, f) { (document.listeners[t] ||= []).push(f); },
    dispatchEvent(ev) { (document.listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
  };
  const sandbox = {
    document, console, JSON, Object, Array, String, Number, Promise, Error,
    curProj: 'alpha',
    fetch: async (url) => { calls.fetch.push(String(url)); return { ok: status === 200, status, json: async () => (status === 200 ? payload : { ok: false, error: 'settings store is not JSON' }) }; },
    cwPost: async (url, opts) => { const body = JSON.parse(opts.body); calls.post.push([url, body]); if (url === '/api/journey') { const next = JSON.parse(JSON.stringify(payload)); if (body.acknowledge) next.steps.find((s) => s.id === body.acknowledge).state = body.acknowledge === 'palette' || body.acknowledge === 'personalise' ? 'done' : 'skipped'; if (body.dismissed !== undefined) next.dismissed = body.dismissed; next.written = true; return { ok: true, status: 200, json: async () => next }; } return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
    navigateWorkspace: (v, o) => calls.nav.push([v, o]),
    featureOn: () => featureOn,
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  new vm.Script(SRC, { filename: 'panel-journey.js' }).runInContext(ctx);
  const tick = () => new Promise((r) => setImmediate(r));
  const click = (target) => document.dispatchEvent({ type: 'click', target });
  return { ctx, sandbox, calls, view, rail, tick, click, api: sandbox.cwJourney, document };
}

test('loads on cw:features when the flag is on, renders every step with its state, and the rail shows progress', async () => {
  const r = realm();
  r.document.dispatchEvent({ type: 'cw:features' });
  await r.tick(); await r.tick();
  assert.deepEqual(r.calls.fetch, ['/api/journey']);
  const h = r.view.innerHTML;
  assert.match(h, /Get set up <span class="tnum mut">2\/9<\/span>/);
  assert.match(h, /1 step could not be measured: schedule/);
  assert.match(h, /state-unreadable[^>]*data-step="schedule"/);
  assert.match(h, /pill unk">unreadable</);
  assert.match(h, /EXAMPLE registry/);
  assert.match(h, /init --root/);
  assert.match(h, /3 on PATH · 1 missing · 1 installed but not on PATH · 1 need an account/);
  assert.match(h, /gitleaks<\/code> missing · lanes that will report <i>not scanned<\/i>: <code>secrets/);
  assert.match(h, /\/opt\/tools\/bin\/ruff/);
  assert.match(h, /CW_REPORT_DIR is unset/);
  assert.match(h, /operator port<\/span>/, 'an operator-only todo off the port is marked');
  assert.match(h, /available only on the operator port/);
  assert.equal(r.rail.hidden, false);
  assert.equal(r.rail.textContent, 'Get set up 2/9');
});

test('with the flag off nothing is fetched and the rail item hides', async () => {
  const r = realm({ featureOn: false });
  r.document.dispatchEvent({ type: 'cw:features' });
  await r.tick();
  assert.deepEqual(r.calls.fetch, []);
  assert.equal(r.rail.hidden, true);
});

test('controls: optional todo steps get Mark done or Skip, skipped ones get Undo, measured ones get nothing', async () => {
  const r = realm();
  await r.api.loadJourney();
  const h = r.view.innerHTML;
  assert.match(h, /journey-ack" data-step="personalise"[^>]*>Mark done/);
  assert.match(h, /journey-ack" data-step="notifications"[^>]*>Skip for now/);
  assert.match(h, /journey-unack" data-step="credentials"[^>]*>Undo/);
  assert.doesNotMatch(h, /journey-ack" data-step="project"/);
  assert.doesNotMatch(h, /journey-ack" data-step="scanners"/, 'scanners is not optional; its skip is the route\'s acknowledgement only');
});

test('acknowledge, undo and dismiss post and re-render from the reply; the rail hides when dismissed', async () => {
  const r = realm();
  await r.api.loadJourney();
  r.click({ classList: { contains: (c) => c === 'journey-ack' }, dataset: { step: 'notifications' } });
  await r.tick(); await r.tick();
  assert.deepEqual(r.calls.post[0], ['/api/journey', { acknowledge: 'notifications' }]);
  assert.match(r.view.innerHTML, /data-step="notifications"[^]*?pill plan">skipped/);
  r.click({ id: 'journey-dismiss' });
  await r.tick(); await r.tick();
  assert.deepEqual(r.calls.post[1], ['/api/journey', { dismissed: true }]);
  assert.equal(r.rail.hidden, true);
  assert.match(r.view.innerHTML, /Show in the rail again/);
});

test('the palette step completes on the palette\'s own event, once, and only while to do', async () => {
  const r = realm();
  await r.api.loadJourney();
  r.document.dispatchEvent({ type: 'cw:palette-navigated', detail: { view: 'issues' } });
  await r.tick(); await r.tick();
  assert.deepEqual(r.calls.post, [['/api/journey', { acknowledge: 'palette' }]]);
  r.document.dispatchEvent({ type: 'cw:palette-navigated', detail: { view: 'feed' } });
  await r.tick();
  assert.equal(r.calls.post.length, 1, 'a done step is not acknowledged again');
});

test('a go-link navigates through the router; Run checks posts the project to the sweep route', async () => {
  const r = realm();
  await r.api.loadJourney();
  r.click({ classList: { contains: (c) => c === 'journey-go' }, dataset: { view: 'projects' } });
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls.nav)), [['projects', { keepFocus: false }]]);
  r.click({ id: 'journey-run', disabled: false });
  await r.tick(); await r.tick();
  assert.deepEqual(r.calls.post[0], ['/api/sweep', { project: 'alpha' }]);
  assert.equal(r.calls.fetch.length, 2, 'the journey re-reads after the sweep starts');
});

test('a failed read is a banner that says unavailable, not a complete checklist; the rail stays visible', async () => {
  const r = realm({ status: 500 });
  await r.api.loadJourney();
  assert.match(r.view.innerHTML, /pill high">error<\/span> settings store is not JSON · the checklist is unavailable, not complete/);
  assert.equal(r.rail.hidden, false);
});

test('an unreadable store is a banner above the list and leaves measured steps rendered', async () => {
  const r = realm({ payload: { ...PAYLOAD, storeState: 'unreadable', storeError: 'settings store is not JSON' } });
  await r.api.loadJourney();
  assert.match(r.view.innerHTML, /store unreadable<\/span> settings store is not JSON/);
  assert.match(r.view.innerHTML, /data-step="account"/);
});
