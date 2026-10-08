// admin/routes/scanners.mjs — direct-handler tests (no server spawn).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { routes, classifyInstall, toolActions, checkParts, startJob, _setSpawn, validateConfig, hashOf } from '../routes/scanners.mjs';
import { resetProfileCache } from '../../monitor/perf-tuning.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const route = (method, path) => routes.find((r) => r.method === method && r.path === path);
const call = (method, path, { query = {}, body = null, loopback = true, session = null } = {}) => new Promise((res) => {
  route(method, path).handle({
    req: {}, isLoopbackReq: loopback, adminSession: () => session,
    query: new URLSearchParams(query),
    send: (code, payload) => res({ code, payload }),
    readJsonBody: (_r, cb) => cb(body, null),
  });
});

let dir;
const KEYS = ['CW_BASELINE_MANIFEST', 'CW_PERF_PROFILES', 'CW_SCANNER_ACTIONS_DIR', 'CW_INSTALL_CATALOG'];
const saved = {};
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-scanners-'));
  for (const k of KEYS) saved[k] = process.env[k];
  copyFileSync(join(ROOT, 'manifests/security-baseline.json'), join(dir, 'sb.json'));
  copyFileSync(join(ROOT, 'monitor/perf-profiles.json'), join(dir, 'perf.json'));
  process.env.CW_BASELINE_MANIFEST = join(dir, 'sb.json');
  process.env.CW_PERF_PROFILES = join(dir, 'perf.json');
  process.env.CW_SCANNER_ACTIONS_DIR = join(dir, 'actions');
  resetProfileCache();
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  resetProfileCache();
  _setSpawn(null);
  rmSync(dir, { recursive: true, force: true });
});

test('the installing manager is read from the resolved path', () => {
  assert.deepEqual(classifyInstall('/opt/homebrew/Cellar/semgrep/1.139.0/libexec/bin/semgrep'), { manager: 'brew', pkg: 'semgrep', version: '1.139.0' });
  assert.deepEqual(classifyInstall('/Users/x/.local/pipx/venvs/zizmor/bin/zizmor'), { manager: 'pipx', pkg: 'zizmor' });
  assert.deepEqual(classifyInstall('/opt/homebrew/lib/node_modules/@socketsecurity/cli/bin/cli.js'), { manager: 'npm', pkg: '@socketsecurity/cli' });
  assert.equal(classifyInstall('/Users/x/.cargo/bin/cargo-audit', { home: '/Users/x' }).manager, 'cargo');
  assert.equal(classifyInstall('/Users/x/go/bin/govulncheck').manager, 'go');
  assert.equal(classifyInstall('/usr/bin/git').manager, 'system');
  assert.equal(classifyInstall('/Users/x/.local/bin/opengrep').manager, 'manual');
  assert.deepEqual(classifyInstall('/Applications/Docker.app/Contents/Resources/bin/docker'), { manager: 'app', pkg: 'Docker' });
});

test('actions carry exact argv from what is installed, and nothing for a hand install', () => {
  const brew = toolActions({ present: true, manager: 'brew', pkg: 'semgrep' }, { brew: 'semgrep', pipx: 'semgrep' });
  assert.deepEqual(brew.map((a) => [a.verb, a.argv]), [['reinstall', ['brew', 'reinstall', 'semgrep']], ['uninstall', ['brew', 'uninstall', 'semgrep']]]);
  const cargo = toolActions({ present: true, manager: 'cargo' }, { cargo: 'cargo install cargo-audit --locked' });
  assert.deepEqual(cargo[0].argv, ['cargo', 'install', '--force', 'cargo-audit', '--locked']);
  assert.deepEqual(toolActions({ present: true, manager: 'manual' }, { brew: 'x' }), []);
  const absent = toolActions({ present: false }, { brew: 'gitleaks', npm: 'nope' }, { onPath: (b) => b === 'brew' });
  assert.deepEqual(absent.map((a) => a.argv), [['brew', 'install', 'gitleaks']]);
  assert.deepEqual(toolActions({ present: true, manager: 'brew', pkg: 'x; rm -rf /' }, {}), [], 'a package name outside the allowed shape builds no argv');
});

test('a check\'s pinned npx packages and its images are read from its commands', () => {
  const p = checkParts({ local: ['npx --yes retire@5.4.3 --outputformat json', 'docker run ghcr.io/google/osv-scanner:latest scan'] }, ['ghcr.io/google/osv-scanner:latest', 'renovate/renovate:latest']);
  assert.deepEqual(p.npx, ['retire@5.4.3']);
  assert.deepEqual(p.images, ['ghcr.io/google/osv-scanner:latest']);
});

test('the catalogue lists every lane with a description, and the detectors outside the runner', async () => {
  const { code, payload } = await call('GET', '/api/scanners');
  assert.equal(code, 200);
  assert.equal(payload.scanners.length, JSON.parse(readFileSync(join(dir, 'sb.json'), 'utf8')).checks.length);
  assert.ok(payload.scanners.every((s) => s.description && s.inDepthModel), 'every lane has a description and a tuning entry');
  assert.equal(payload.scanners.find((s) => s.id === 'sast').kinds.depth, 'graded');
  assert.ok(payload.outsideRunner.some((o) => o.id === 'comment-schema'), 'the Slop Bucket detector is listed');
  assert.ok(payload.outsideRunner.every((o) => o.moduleExists), `a declared detector names a module that is not there: ${payload.outsideRunner.filter((o) => !o.moduleExists).map((o) => o.module)}`);
});

test('reads need a session off the operator port; actions and config writes need the operator port', async () => {
  assert.equal((await call('GET', '/api/scanners', { loopback: false })).code, 401);
  const session = { user: 'someone', method: 'password' };
  assert.equal((await call('GET', '/api/scanners', { loopback: false, session })).code, 200);
  assert.equal((await call('POST', '/api/scanners/action', { loopback: false, session, body: { id: 'sast', tool: 'semgrep', verb: 'reinstall' } })).code, 403);
  assert.equal((await call('POST', '/api/scanners/config', { loopback: false, session, body: { id: 'sast', text: '{}', baseHash: 'x' } })).code, 403);
  const cfg = await call('GET', '/api/scanners/config', { loopback: false, session, query: { id: 'sast' } });
  assert.equal(cfg.payload.canWrite, false);
});

test('an action is refused for a tool the lane does not use, and for a verb it does not offer', async () => {
  const r = await call('POST', '/api/scanners/action', { body: { id: 'sast', tool: 'bash', verb: 'uninstall' } });
  assert.equal(r.code, 400);
  assert.match(r.payload.error, /not a tool or image/);
});

test('config: the document round-trips, a stale base is a conflict, and a bad edit writes nothing', async () => {
  const g = await call('GET', '/api/scanners/config', { query: { id: 'sast' } });
  assert.equal(g.code, 200);
  const doc = JSON.parse(g.payload.text);
  assert.equal(doc.check.id, 'sast');
  assert.equal(doc.perf.cost, 'very-heavy');
  const before = readFileSync(join(dir, 'sb.json'), 'utf8');

  assert.equal((await call('POST', '/api/scanners/config', { body: { id: 'sast', text: g.payload.text, baseHash: 'stale' } })).code, 409);
  const renamed = JSON.stringify({ ...doc, check: { ...doc.check, id: 'sast2' } });
  assert.match((await call('POST', '/api/scanners/config', { body: { id: 'sast', text: renamed, baseHash: g.payload.baseHash } })).payload.error, /must stay/);
  const deaf = JSON.stringify({ ...doc, check: { ...doc.check, local: ['semgrep scan --config p/default .'] } });
  assert.match((await call('POST', '/api/scanners/config', { body: { id: 'sast', text: deaf, baseHash: g.payload.baseHash } })).payload.error, /never read/);
  const typo = JSON.stringify({ ...doc, perf: { ...doc.perf, minDepht: 2 } });
  assert.match((await call('POST', '/api/scanners/config', { body: { id: 'sast', text: typo, baseHash: g.payload.baseHash } })).payload.error, /unknown key 'minDepht'/);
  assert.equal(readFileSync(join(dir, 'sb.json'), 'utf8'), before, 'a refused edit wrote nothing');
});

test('config: a valid edit writes both files canonically and changes only that entry', async () => {
  const g = await call('GET', '/api/scanners/config', { query: { id: 'secrets' } });
  const doc = JSON.parse(g.payload.text);
  doc.check.description = 'edited in the panel';
  doc.perf.note = 'edited note';
  const w = await call('POST', '/api/scanners/config', { body: { id: 'secrets', text: JSON.stringify(doc), baseHash: g.payload.baseHash } });
  assert.equal(w.code, 200, JSON.stringify(w.payload));
  const sb = readFileSync(join(dir, 'sb.json'), 'utf8');
  const perf = readFileSync(join(dir, 'perf.json'), 'utf8');
  assert.equal(sb, `${JSON.stringify(JSON.parse(sb), null, 2)}\n`);
  assert.equal(JSON.parse(sb).checks.find((c) => c.id === 'secrets').description, 'edited in the panel');
  assert.equal(JSON.parse(perf).scanners.secrets.note, 'edited note');
  assert.equal(w.payload.baseHash, hashOf(`${sb}\u0000${perf}`));
  const original = JSON.parse(readFileSync(join(ROOT, 'manifests/security-baseline.json'), 'utf8'));
  assert.deepEqual(JSON.parse(sb).checks.filter((c) => c.id !== 'secrets'), original.checks.filter((c) => c.id !== 'secrets'));
});

test('validateConfig refuses a perf entry the depth model could not read', () => {
  const sbDoc = JSON.parse(readFileSync(join(ROOT, 'manifests/security-baseline.json'), 'utf8'));
  const perfDoc = JSON.parse(readFileSync(join(ROOT, 'monitor/perf-profiles.json'), 'utf8'));
  const check = sbDoc.checks.find((c) => c.id === 'sast');
  assert.ok(validateConfig('sast', { check, perf: null }, { sbDoc, perfDoc }).some((e) => /tuning entry/.test(e)));
  assert.ok(validateConfig('sast', { check, perf: { cost: 'enormous' } }, { sbDoc, perfDoc }).some((e) => /perf.cost/.test(e)));
  assert.ok(validateConfig('sast', { check, perf: { cost: 'heavy', depthLadder: ['one'] } }, { sbDoc, perfDoc }).some((e) => /two levels/.test(e)));
  assert.deepEqual(validateConfig('sast', { check, perf: perfDoc.scanners.sast }, { sbDoc, perfDoc }), []);
});

function fakeSpawn(codes) {
  const seen = [];
  const f = (cmd, args) => {
    seen.push([cmd, ...args]);
    const child = new EventEmitter();
    const code = codes.length ? codes.shift() : 0;
    setImmediate(() => child.emit('exit', code, null));
    return child;
  };
  f.seen = seen;
  return f;
}
const settle = (id) => new Promise((res) => {
  const tick = async () => {
    const r = await call('GET', '/api/scanners/action', { query: { job: id } });
    if (r.payload.job && r.payload.job.state !== 'running') return res(r.payload);
    setTimeout(tick, 5);
  };
  tick();
});

test('a job runs its argv, then any post-install steps, and records each exit', async () => {
  const sp = fakeSpawn([0, 0]);
  _setSpawn(sp);
  const job = startJob({ scanner: 'sast-codeql', tool: 'codeql', verb: 'reinstall', argv: ['brew', 'reinstall', 'codeql'], postInstall: [['codeql', 'pack', 'download', 'codeql/python-queries']] });
  const done = await settle(job.id);
  assert.equal(done.job.state, 'done');
  assert.deepEqual(sp.seen, [['brew', 'reinstall', 'codeql'], ['codeql', 'pack', 'download', 'codeql/python-queries']]);
  assert.match(done.log, /\$ brew reinstall codeql/);
});

test('a failing step stops the chain and the job says failed', async () => {
  const sp = fakeSpawn([1]);
  _setSpawn(sp);
  const job = startJob({ scanner: 'x', tool: 'y', verb: 'install', argv: ['brew', 'install', 'y'], postInstall: [['y', 'setup']] });
  const done = await settle(job.id);
  assert.equal(done.job.state, 'failed');
  assert.equal(sp.seen.length, 1, 'the post-install step did not run after a failure');
});

test('a job id that is not one is refused before it reaches the filesystem', async () => {
  assert.equal((await call('GET', '/api/scanners/action', { query: { job: '../../etc/passwd' } })).code, 400);
});
