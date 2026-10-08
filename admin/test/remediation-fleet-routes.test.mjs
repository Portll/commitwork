// The remediation routes against a really-spawned panel on the synthetic fixture: each project's
// inputs, prompts and plan come from its OWN report directory; a project with nothing names what is
// missing; /api/remediation/fleet lists every area; a handoff is filed under its project and
// launched through a CW_HANDOFF_CMD whose quoted script path holds a space; and the new routes sit
// behind the panel's ordinary gate.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { buildRemediationFixture, ARTIFACT_MARKER, ALPHA_BATCH } from './lib/remediation-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const CW = join(HERE, '..', '..');
const T = mkdtempSync(join(tmpdir(), 'cw-remfleet-routes-'));
const FX = buildRemediationFixture(T);
const KEYS = ['rollup', 'plan', 'batch', 'ledger', 'codeqlFleet'];

// The launch seam's stub lives under a directory whose name holds a space: split(' ') broke this
// command into '"<node>"' and 'dir/record.mjs"', and the unheard spawn error took the panel down.
const STUB_DIR = join(T, 'stub dir');
const STUB = join(STUB_DIR, 'record.mjs');
const STUB_OUT = join(T, 'stub-calls.jsonl');
mkdirSync(STUB_DIR, { recursive: true });
writeFileSync(STUB, [
  "import { appendFileSync } from 'node:fs';",
  'appendFileSync(process.env.CW_TEST_STUB_OUT, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + String.fromCharCode(10));',
].join('\n'));

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const hitOn = (port, path, { method = 'GET', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const h = { ...headers };
  if (body != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
  const req = request({ host: '127.0.0.1', port, path, method, headers: h }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* not json */ } resolve({ status: res.statusCode, body: buf, json }); });
  });
  req.on('error', reject);
  if (body != null) req.write(body);
  req.end();
});
const boot = async (env, port) => {
  const child = spawn(process.execPath, [SERVE], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = ''; child.stderr.on('data', (d) => { err += String(d); });
  for (let i = 0; i < 150; i++) {
    try { const r = await hitOn(port, '/api/csrf'); if (r.status) return child; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill('SIGKILL');
  throw new Error(`panel did not come up${err ? ` — stderr:\n${err.slice(-2000)}` : ''}`);
};

let op, gated, local, pubGated, csrf;
const hit = (path, opts) => hitOn(local, path, opts);
const post = (path, payload, headers = { 'x-cw-csrf': csrf }) => hit(path, { method: 'POST', body: JSON.stringify(payload), headers });
const stubCalls = async (n) => {
  for (let i = 0; i < 100; i++) {
    const got = existsSync(STUB_OUT) ? readFileSync(STUB_OUT, 'utf8').split('\n').filter(Boolean) : [];
    if (got.length >= n) return got.map((l) => JSON.parse(l));
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`the launch stub recorded fewer than ${n} call(s) — CW_HANDOFF_CMD never ran it`);
};

before(async () => {
  // Operator port during bootstrap (no account yet): the data routes answer without a session.
  local = await freePort();
  op = await boot({
    CW_AUTH_STORE: join(T, 'users.json'), CW_REGISTRY: FX.registryPath,
    CW_ADMIN_PORT: String(await freePort()), CW_ADMIN_LOCAL_PORT: String(local),
    CW_HANDOFF_CMD: `"${process.execPath}" "${STUB}"`, CW_TEST_STUB_OUT: STUB_OUT,
    CW_NOW: '2026-09-27T00:00:00.000Z', CW_OPEN: '/usr/bin/true', CW_OSASCRIPT: '/usr/bin/true',
  }, local);
  csrf = (await hit('/api/csrf')).json.token;

  // A second panel past bootstrap: an account exists, so the published port must refuse without a
  // session. Without one the zero-user posture refuses for a different reason and proves nothing.
  const G = join(T, 'gated');
  mkdirSync(G, { recursive: true });
  writeFileSync(join(G, 'users.json'), JSON.stringify({ version: 1, users: [{ email: 'op@example.test', role: 'admin', pwHash: 'x', createdAt: '2026-09-01T00:00:00.000Z' }] }));
  pubGated = await freePort();
  gated = await boot({
    CW_AUTH_STORE: join(G, 'users.json'), CW_REGISTRY: FX.registryPath,
    CW_ADMIN_PORT: String(pubGated), CW_ADMIN_LOCAL_PORT: String(await freePort()),
  }, pubGated);
});
after(() => { op?.kill('SIGKILL'); gated?.kill('SIGKILL'); rmSync(T, { recursive: true, force: true }); });

describe('per-project resolution — each project reads its own report directory', () => {
  test('inputs: Alpha has all five; Beta has its own, different ones', async () => {
    const a = await hit('/api/remediation/inputs?project=Alpha');
    assert.equal(a.status, 200);
    assert.equal(a.json.ok, true);
    assert.deepEqual([a.json.project.slug, a.json.project.out], ['alpha', 'alpha']);
    assert.deepEqual(a.json.inputs.map((x) => x.key), KEYS);
    assert.deepEqual(a.json.inputs.map((x) => x.state), KEYS.map(() => 'ok'));
    const ai = Object.fromEntries(a.json.inputs.map((x) => [x.key, x]));
    assert.equal(ai.plan.summary.packages, 4);
    assert.equal(ai.plan.summary.headline.kev, 1);
    assert.equal(ai.ledger.entries, 2);
    assert.equal(ai.codeqlFleet.findings, 1);
    assert.equal(ai.batch.source, ALPHA_BATCH);
    assert.deepEqual(a.json.outputs.codeqlJobs.byState, { lodged: 1 });

    const b = await hit('/api/remediation/inputs?project=Beta');
    assert.deepEqual([b.json.project.slug, b.json.project.out], ['beta', 'beta']);
    const bi = Object.fromEntries(b.json.inputs.map((x) => [x.key, x]));
    assert.equal(bi.plan.summary.packages, 0, 'Beta\'s plan, not Alpha\'s');
    assert.deepEqual(['batch', 'ledger', 'codeqlFleet'].map((k) => bi[k].state), ['absent', 'absent', 'absent']);
    assert.equal(b.json.outputs.triage.state, 'absent');
  });

  test('prompts and the plan document are each project\'s own', async () => {
    const live = async (p) => (await hit(`/api/remediation/prompts?project=${p}`)).json.prompts.find((x) => x.check === 'secrets-gitleaks').live;
    assert.equal((await live('Alpha')).total, 2);
    assert.equal((await live('Beta')).total, 0);
    const pa = await hit('/reports/REMEDIATION.md?project=Alpha');
    const pb = await hit('/reports/REMEDIATION.md?project=Beta');
    assert.match(pa.body, /3 packages, 7 findings/);
    assert.match(pb.body, /0 packages, 0 findings/);
  });
});

describe('absent inputs are named, never an empty table', () => {
  test('a declared project with nothing on disk names each input and what produces it', async () => {
    const g = await hit('/api/remediation/inputs?project=Gamma');
    assert.equal(g.json.ok, true);
    for (const x of g.json.inputs) {
      assert.equal(x.state, 'absent', x.key);
      assert.ok(x.producedBy && x.producedBy.length > 20, `${x.key} names no producer`);
    }
    assert.match(g.json.inputs[0].producedBy, /full scan/);
  });

  test('no project and an unknown project are their own states', async () => {
    const none = await hit('/api/remediation/inputs?project=');
    assert.equal(none.json.ok, false);
    assert.equal(none.json.project.state, 'unselected');
    assert.match(none.json.error, /no project selected/);
    assert.equal(none.json.inputs, undefined, 'no rows describing a directory nobody asked about');
    const unk = await hit('/api/remediation/inputs?project=nope');
    assert.equal(unk.json.project.state, 'unknown');
  });
});

describe('the fleet page — every area, in a fixed order', () => {
  test('lists every declared area including the empty one, and the undeclared directory', async () => {
    const r = await hit('/api/remediation/fleet');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.deepEqual(r.json.areas.map((a) => a.label), ['Alpha', 'Beta', 'Gamma', 'stray']);
    const gamma = r.json.areas[2];
    assert.deepEqual(gamma.missing, KEYS);
    assert.equal(r.json.areas[0].live.secrets.total, 2);
  });

  test('two reads of the same tree are byte-identical', async () => {
    const one = await hit('/api/remediation/fleet');
    const two = await hit('/api/remediation/fleet');
    assert.equal(one.body, two.body);
  });
});

describe('handoff — filed under the selected project, launched through the quoted seam', () => {
  test('Alpha: the artifact is found through a batch named relative to the reports root', async () => {
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'Alpha', engine: 'claude' });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.started, true);
    assert.equal(r.json.via, 'CW_HANDOFF_CMD');
    assert.equal(dirname(r.json.file), join(FX.reports, 'alpha', 'handoff'));
    const text = readFileSync(r.json.file, 'utf8');
    assert.ok(text.includes(join(ALPHA_BATCH, 'alpha-app', 'gitleaks.json')), 'the artifact path reaches the agent');
    assert.doesNotMatch(text, /NOT FOUND/);
    const [call] = await stubCalls(1);
    assert.deepEqual(call.argv, [r.json.file], 'the quoted script path was ONE argument and the handoff file the next');
    assert.equal(realpathSync(call.cwd), realpathSync(join(FX.repos, 'alpha-app')));
    assert.ok(!readFileSync(r.json.file, 'utf8').includes(ARTIFACT_MARKER), 'the claude handoff names the artifact by path; it does not inline it');
  });

  test('Beta: its own directory, its missing batch stated, its own repository as the working directory', async () => {
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'Beta', engine: 'claude' });
    assert.equal(r.status, 200, r.body);
    assert.equal(dirname(r.json.file), join(FX.reports, 'beta', 'handoff'));
    assert.match(readFileSync(r.json.file, 'utf8'), /Scanner artifact: NOT FOUND/);
    const calls = await stubCalls(2);
    assert.equal(realpathSync(calls[1].cwd), realpathSync(join(FX.repos, 'beta-app')),
      'with no artifact, the session opens in this project\'s repository, not commitwork\'s checkout');
  });

  test('no project is refused, and nothing is written under reports/__unresolved__', async () => {
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', engine: 'claude' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no project selected/);
    assert.equal(existsSync(join(CW, 'reports', '__unresolved__', 'handoff')), false);
  });
});

describe('auth — the new routes sit behind the panel\'s ordinary gate', () => {
  test('the published port refuses every remediation read without a session', async () => {
    for (const p of ['/api/remediation/fleet', '/api/remediation/inputs?project=Alpha', '/api/remediation/prompts?project=Alpha']) {
      const r = await hitOn(pubGated, p);
      assert.equal(r.status, 401, `${p} answered ${r.status} without a session`);
      assert.doesNotMatch(r.body, /"(areas|inputs|prompts)"\s*:/, `${p} returned a data-shaped body to an anonymous caller`);
    }
  });

  test('a POST without the CSRF header is refused before the handler runs', async () => {
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'Alpha', engine: 'claude' }, {});
    assert.equal(r.status, 403);
  });
});
