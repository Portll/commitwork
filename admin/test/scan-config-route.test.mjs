// admin/routes/scan-config.mjs — direct-handler tests (no server spawn). The consent surface:
// session-gated, conflict-refusing, and honest about the difference between a binary that was
// refused and one that is merely not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes, scanConfigState, resolveOnPath, storeHash } from '../routes/scan-config.mjs';
import { readScanConfig } from '../../bin/lib/scan-config.mjs';

const route = (method, p) => routes.find((r) => r.method === method && r.path === p);
function invoke(r, { session = null, body = undefined } = {}) {
  let out;
  r.handle({
    req: {}, adminSession: () => session,
    send: (code, b) => { out = { code, body: b }; },
    readJsonBody: (req, cb) => cb(body, null),
  });
  return out;
}
const SESSION = { user: { email: 'op@example.test' } };

const TMP = mkdtempSync(join(tmpdir(), 'cw-scancfg-route-'));
const STORE = join(TMP, 'scan-config.json');
const MANIFEST = join(TMP, 'baseline.json');
const CATALOG = join(TMP, 'catalog.json');
const BIN = join(TMP, 'bin');
mkdirSync(BIN);
writeFileSync(join(BIN, 'present-tool'), '#!/bin/sh\n');
chmodSync(join(BIN, 'present-tool'), 0o755);

writeFileSync(MANIFEST, JSON.stringify({
  groups: { all: ['alpha', 'beta'], fast: ['alpha'] },
  checks: [
    { id: 'alpha', description: 'lane one', egress: 'none', groups: ['all', 'fast'], requires: { tools: ['present-tool'] } },
    { id: 'beta', description: 'lane two', egress: 'none', groups: ['all'], requires: { tools: ['absent-tool', 'present-tool'] } },
  ],
}));
writeFileSync(CATALOG, JSON.stringify({ tools: { 'present-tool': { why: 'a reason', brew: 'present-tool', url: 'https://x' } } }));

process.env.CW_BASELINE_MANIFEST = MANIFEST;
process.env.CW_INSTALL_CATALOG = CATALOG;
process.env.CW_SCAN_CONFIG = STORE;
process.env.CW_VERDICT_DIR = join(TMP, 'verdicts');
process.env.PATH = `${BIN}:${process.env.PATH}`;

test.after(() => rmSync(TMP, { recursive: true, force: true }));

test('both routes refuse without a session (401)', () => {
  assert.equal(invoke(route('GET', '/api/scan-config'), { session: null }).code, 401);
  assert.equal(invoke(route('POST', '/api/scan-config'), { session: null, body: {} }).code, 401);
});

test('an unconfigured box reports the gate OFF and every lane runnable', () => {
  rmSync(STORE, { force: true });
  const out = invoke(route('GET', '/api/scan-config'), { session: SESSION });
  assert.equal(out.code, 200);
  assert.equal(out.body.gated, false);
  assert.equal(out.body.configured, false);
  assert.equal(out.body.hash, 'absent');
  assert.equal(out.body.counts.runnable, 2);
  assert.equal(out.body.counts.held, 0);
  assert.equal(out.body.history.absent, true, 'an unwritten journal is absent, not an empty history');
});

test('presence is resolved by reading PATH, never by running the tool', () => {
  assert.equal(resolveOnPath('present-tool'), join(BIN, 'present-tool'));
  assert.equal(resolveOnPath('absent-tool'), null);
  const tools = Object.fromEntries(scanConfigState().tools.map((t) => [t.tool, t]));
  assert.equal(tools['present-tool'].present, true);
  assert.equal(tools['absent-tool'].present, false);
  assert.equal(tools['absent-tool'].install.length, 0, 'no catalogue entry is not "cannot be installed"');
  assert.deepEqual(tools['present-tool'].install, [{ via: 'brew', cmd: 'present-tool' }], 'the url is a link, not an install command');
  assert.deepEqual(tools['present-tool'].lanes, ['alpha', 'beta']);
});

test('a write requires the hash the page was shown, and a stale one is refused without writing', () => {
  rmSync(STORE, { force: true });
  assert.equal(invoke(route('POST', '/api/scan-config'), { session: SESSION, body: { tools: { 'present-tool': true } } }).code, 400,
    'a write with no base version cannot detect a conflict');
  const stale = invoke(route('POST', '/api/scan-config'), { session: SESSION, body: { baseHash: 'not-the-current-one', tools: { 'present-tool': true } } });
  assert.equal(stale.code, 409);
  assert.equal(readScanConfig().absent, true, 'the refused write left nothing behind');
});

test('approving a binary releases every lane that declares it, and stamps who did it', () => {
  rmSync(STORE, { force: true });
  const ok = invoke(route('POST', '/api/scan-config'), { session: SESSION, body: { baseHash: 'absent', tools: { 'present-tool': true }, reason: 'approved on /config' } });
  assert.equal(ok.code, 200);
  assert.deepEqual(ok.body.toolsChanged, [{ tool: 'present-tool', from: false, to: true }]);
  assert.equal(ok.body.gated, true, 'the store now exists, so the gate applies');

  const tools = Object.fromEntries(ok.body.tools.map((t) => [t.tool, t]));
  assert.equal(tools['present-tool'].approved, true);
  assert.equal(tools['present-tool'].actor, 'op@example.test');
  assert.equal(tools['present-tool'].at !== null, true);

  const lanes = Object.fromEntries(ok.body.lanes.map((l) => [l.id, l]));
  assert.equal(lanes.alpha.held, null, 'its only tool is approved');
  assert.equal(lanes.beta.held, 'unapproved-tool');
  assert.deepEqual(lanes.beta.heldTools, ['absent-tool'], 'the approved tool is not re-asked');
});

test('approved-but-absent is reported as BOTH — refusing and not installing are different facts', () => {
  const cur = storeHash();
  const out = invoke(route('POST', '/api/scan-config'), { session: SESSION, body: { baseHash: cur, tools: { 'absent-tool': true } } });
  assert.equal(out.code, 200);
  const t = out.body.tools.find((x) => x.tool === 'absent-tool');
  assert.equal(t.approved, true);
  assert.equal(t.present, false);
  assert.equal(out.body.counts.absentTools, 1);
  assert.equal(out.body.counts.held, 0, 'consent is given; installation is a separate problem');
});

test('disabling a lane is a separate act from withdrawing a binary', () => {
  const out = invoke(route('POST', '/api/scan-config'), { session: SESSION, body: { baseHash: storeHash(), checks: { alpha: false } } });
  assert.equal(out.code, 200);
  const lanes = Object.fromEntries(out.body.lanes.map((l) => [l.id, l]));
  assert.equal(lanes.alpha.enabled, false);
  assert.equal(lanes.alpha.held, 'disabled');
  assert.equal(out.body.counts.enabled, 1);
});

test('a non-boolean is refused rather than coerced into consent', () => {
  assert.equal(invoke(route('POST', '/api/scan-config'), { session: SESSION, body: { baseHash: storeHash(), tools: { 'present-tool': 'yes' } } }).code, 400);
  assert.equal(invoke(route('POST', '/api/scan-config'), { session: SESSION, body: { baseHash: storeHash(), checks: { alpha: 1 } } }).code, 400);
});

test('the history carries each change with its actor, newest first', () => {
  const out = invoke(route('GET', '/api/scan-config'), { session: SESSION });
  const h = out.body.history;
  assert.equal(h.absent, false);
  assert.ok(h.records.length >= 3);
  assert.equal(h.records[0].checksChanged[0].id, 'alpha', 'newest first');
  assert.ok(h.records.every((r) => r.actor === 'op@example.test'));
  assert.equal(h.records.at(-1).toolsChanged[0].tool, 'present-tool');
});

test('an unreadable configuration is a 500, never a page inviting re-approval of a store that is still there', () => {
  writeFileSync(STORE, '{ truncated');
  const out = invoke(route('GET', '/api/scan-config'), { session: SESSION });
  assert.equal(out.code, 500);
  assert.match(out.body.error, /could not be read/);
});
