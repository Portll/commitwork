// The journey route reads records, not flags: a user in the auth store, a real registry with
// projects, binaries on PATH or found off it, credential refs, a rollup on disk, a plist in the
// agents dir, a daily config. Acknowledgements are the only thing it writes, and only for the
// optional steps. Everything here runs on fixtures under one temp dir with every path env-overridden.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes, gatherScanners } from '../routes/journey.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-journey-'));
const KEYS = ['CW_REGISTRY', 'CW_AUTH_STORE', 'CW_SETTINGS', 'CW_SETTINGS_STORE', 'CW_AGENT_DIR', 'CW_DAILY_CONFIG', 'CW_SECRETS_FILE', 'CW_BASELINE_MANIFEST', 'CW_INSTALL_CATALOG', 'CW_JOURNEY_INSTALL_DIRS', 'CW_REPORT_DIR', 'CW_FEATURE_JOURNEY', 'CW_FEATURE_PALETTE', 'CW_EXPERIMENTAL'];
const saved = {};

before(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });
  mkdirSync(join(TMP, 'src'), { recursive: true });
  mkdirSync(join(TMP, 'agents'), { recursive: true });
  mkdirSync(join(TMP, 'bin'), { recursive: true });
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea', defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] }, { slug: 'paused', label: 'paused', out: 'paused', paused: { since: '2026-09-01', reason: 'fixture' } }],
  }));
  writeFileSync(join(TMP, 'reports', 'fixarea', 'rollup.json'), JSON.stringify({ generated: 'T', scanners: {}, scannerFindings: {} }));
  writeFileSync(join(TMP, 'users.json'), JSON.stringify({ version: 1, settings: {}, users: [{ email: 'op@example.test' }] }));
  writeFileSync(join(TMP, 'agents', 'com.portll.commitwork-monitor-fixarea.plist'), '<?xml version="1.0"?><plist><dict><key>Label</key><string>x</string><key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict></dict></plist>');
  writeFileSync(join(TMP, 'baseline.json'), JSON.stringify({ checks: [
    { id: 'sast', requires: { tools: ['node'] } },
    { id: 'secrets', requires: { tools: ['zz-missing-tool'], secrets: ['FIX_TOKEN'] } },
    { id: 'lint', requires: { tools: ['offpath-tool'] } },
    { id: 'socketish', requires: { tools: ['socket-like'] } },
  ] }));
  writeFileSync(join(TMP, 'catalog.json'), JSON.stringify({ tools: { 'socket-like': { requiresAccount: { vendor: 'Vendor', needs: ['an account'] } } } }));
  writeFileSync(join(TMP, 'bin', 'offpath-tool'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(TMP, 'bin', 'offpath-tool'), 0o755);
  process.env.CW_REGISTRY = join(TMP, 'projects.json');
  process.env.CW_AUTH_STORE = join(TMP, 'users.json');
  process.env.CW_SETTINGS = join(TMP, 'settings.json');
  process.env.CW_AGENT_DIR = join(TMP, 'agents');
  process.env.CW_DAILY_CONFIG = join(TMP, 'daily.json');
  process.env.CW_SECRETS_FILE = join(TMP, 'secrets.json');
  process.env.CW_BASELINE_MANIFEST = join(TMP, 'baseline.json');
  process.env.CW_INSTALL_CATALOG = join(TMP, 'catalog.json');
  process.env.CW_JOURNEY_INSTALL_DIRS = join(TMP, 'bin');
  process.env.CW_REPORT_DIR = join(TMP, 'out');
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const GET = routes.find((r) => r.method === 'GET' && r.path === '/api/journey');
const POST = routes.find((r) => r.method === 'POST' && r.path === '/api/journey');
const SESSION = { user: 'op@example.test', provider: 'password' };
const call = (route, { body, session = SESSION, loopback = false } = {}) => new Promise((resolve) => {
  route.handle({
    req: {}, isLoopbackReq: loopback, adminSession: () => session,
    readJsonBody: (_r, cb) => cb(body, null),
    send: (code, payload) => resolve({ code, payload }),
  });
});
const step = (p, id) => p.steps.find((s) => s.id === id);

test('the flag off is a 404 naming it; no session off-loopback is a 401; loopback alone is enough to read', async () => {
  process.env.CW_FEATURE_JOURNEY = 'off';
  try {
    const r = await call(GET, { session: null, loopback: true });
    assert.equal(r.code, 404);
    assert.equal(r.payload.flag, 'journey');
  } finally { delete process.env.CW_FEATURE_JOURNEY; }
  assert.equal((await call(GET, { session: null })).code, 401);
  assert.equal((await call(POST, { session: null, body: {} })).code, 401);
  assert.equal((await call(GET, { session: null, loopback: true })).code, 200);
});

test('scanner gathering tells present, missing, installed-not-on-PATH and account-gated apart', () => {
  const g = gatherScanners();
  const by = Object.fromEntries(g.tools.map((t) => [t.name, t]));
  assert.equal(by.node.state, 'present');
  assert.equal(by['zz-missing-tool'].state, 'missing');
  assert.deepEqual(by['zz-missing-tool'].blocks, ['secrets']);
  assert.equal(by['offpath-tool'].state, 'installed-not-on-path');
  assert.equal(by['offpath-tool'].at, join(TMP, 'bin', 'offpath-tool'));
  assert.equal(by['socket-like'].requiresAccount.vendor, 'Vendor');
  assert.equal(g.catalogUnreadable, null);
});

test('GET derives every step from its record', async () => {
  const r = await call(GET);
  assert.equal(r.code, 200);
  const p = r.payload;
  assert.equal(p.operator, false);
  assert.equal(step(p, 'account').state, 'done');
  assert.equal(step(p, 'project').state, 'done');
  assert.equal(step(p, 'project').counts.areas, 2);
  assert.equal(step(p, 'scanners').state, 'todo');
  assert.deepEqual(step(p, 'scanners').counts, { present: 1, missing: 1, installedNotOnPath: 1, accountGated: 1 });
  assert.equal(step(p, 'scanners').offPort, true, 'installing is operator-only; off the port the control is shown, not offered');
  assert.equal(step(p, 'credentials').state, 'todo');
  assert.deepEqual(step(p, 'credentials').accountGated.map((x) => x.tool), ['socket-like']);
  assert.equal(step(p, 'firstrun').state, 'done');
  assert.equal(step(p, 'firstrun').reportDirSet, true);
  assert.equal(step(p, 'schedule').state, 'done', 'the paused area does not count');
  assert.deepEqual(step(p, 'schedule').counts, { scheduled: 1 });
  assert.equal(step(p, 'notifications').state, 'todo');
  assert.equal(step(p, 'palette').state, 'todo');
  assert.equal(p.storeState, 'absent');
  assert.deepEqual(p.progress, { done: 4, total: 9, unreadable: [] });
  assert.equal(p.complete, false);
});

test('POST acknowledges an optional step, refuses a measured one, and is idempotent', async () => {
  let r = await call(POST, { body: { acknowledge: 'notifications' } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.written, true);
  assert.equal(step(r.payload, 'notifications').state, 'skipped');
  assert.ok(existsSync(join(TMP, 'settings.json')));
  const stored = JSON.parse(readFileSync(join(TMP, 'settings.json'), 'utf8')).settings.setupJourney;
  assert.deepEqual(stored.value, { dismissed: false, acknowledged: ['notifications'] });
  assert.match(String(stored.by), /op@example\.test/, 'the write is stamped with who acknowledged');
  r = await call(POST, { body: { acknowledge: 'notifications' } });
  assert.equal(r.payload.unchanged, true);
  r = await call(POST, { body: { acknowledge: 'project' } });
  assert.equal(r.code, 400);
  assert.match(r.payload.error, /done when its record says so/);
  r = await call(POST, { body: { acknowledge: 'nope' } });
  assert.equal(r.code, 400);
  r = await call(POST, { body: { finished: true } });
  assert.equal(r.code, 400);
  r = await call(POST, { body: { dismissed: 'yes' } });
  assert.equal(r.code, 400);
  r = await call(POST, { body: { dismissed: true, acknowledge: 'scanners' } });
  assert.equal(r.payload.dismissed, true);
  assert.equal(step(r.payload, 'scanners').state, 'skipped');
  assert.equal(r.payload.progress.done, 6);
  r = await call(POST, { body: { unacknowledge: 'scanners', dismissed: false } });
  assert.equal(step(r.payload, 'scanners').state, 'todo');
  assert.equal(r.payload.dismissed, false);
});

test('an env shadow on the setting is reported as the source and a write under it is refused', async () => {
  process.env.CW_SETUP_JOURNEY = JSON.stringify({ acknowledged: ['palette'] });
  try {
    const r = await call(GET);
    assert.equal(r.payload.storeSource, 'env');
    assert.equal(step(r.payload, 'palette').state, 'done');
    const w = await call(POST, { body: { acknowledge: 'credentials' } });
    assert.equal(w.code, 409, JSON.stringify(w.payload));
  } finally { delete process.env.CW_SETUP_JOURNEY; }
});

test('an unreadable settings store is unreadable on read and refuses the write', async () => {
  writeFileSync(join(TMP, 'settings.json'), '{ not json');
  try {
    const r = await call(GET);
    assert.equal(r.payload.storeState, 'unreadable');
    assert.equal(step(r.payload, 'notifications').state, 'todo', 'nothing acknowledged is readable, so nothing is assumed');
    const w = await call(POST, { body: { acknowledge: 'notifications' } });
    assert.equal(w.code, 503);
    assert.equal(readFileSync(join(TMP, 'settings.json'), 'utf8'), '{ not json', 'the broken bytes survive');
  } finally { rmSync(join(TMP, 'settings.json')); }
});

test('an example registry is a todo naming init, and a missing agent plist is an unscheduled area', async () => {
  const realReg = process.env.CW_REGISTRY;
  const realAgents = process.env.CW_AGENT_DIR;
  process.env.CW_AGENT_DIR = join(TMP, 'no-agents');
  try {
    const r = await call(GET);
    assert.equal(step(r.payload, 'schedule').state, 'todo');
    assert.deepEqual(step(r.payload, 'schedule').counts, { absent: 1 });
  } finally { process.env.CW_AGENT_DIR = realAgents; }
  delete process.env.CW_REGISTRY;
  try {
    const r = await call(GET);
    assert.equal(step(r.payload, 'project').state, 'todo');
    assert.match(step(r.payload, 'project').detail, /EXAMPLE registry/);
  } finally { process.env.CW_REGISTRY = realReg; }
});
