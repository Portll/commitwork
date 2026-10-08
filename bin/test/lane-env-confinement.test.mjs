// What a lane's shell actually receives, measured through the runner rather than asserted on the
// helpers: the env a repo-code lane starts from (review 2026-10-07 D4), and the loopback a `target`
// lane may reach under the host sandbox (D1). Each denial is paired with the control that must pass.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = realpathSync(mkdtempSync(join(tmpdir(), 'cw-lane-env-')));
after(() => rmSync(T, { recursive: true, force: true }));
let n = 0;

function runLanes(checks, extraEnv, { sandbox = false } = {}) {
  const repo = join(T, `repo${n++}`); mkdirSync(repo);
  writeFileSync(join(repo, 'README.md'), 'fixture\n');
  const reports = join(T, `reports${n++}`); mkdirSync(reports);
  const manifest = join(T, `m${n++}.json`);
  writeFileSync(manifest, JSON.stringify({ repo: 'fixture', checks }));
  const env = { ...process.env, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1', CW_ASSERT_TREE: '0', CW_SELF_SWEEP: '0',
    CW_PERF_FEEDBACK: join(T, 'perf.jsonl'), FORCE_COLOR: '0', ...extraEnv };
  if (!sandbox) env.CW_SANDBOX = 'off';
  return new Promise((res) => {
    const c = spawn(process.execPath, [join(CW, 'bin', 'commitwork.mjs'), 'run', 'all', '--manifest', manifest, '--repo', repo, '--no-fail-fast'],
      { cwd: T, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (status) => res({ reports, status, out }));
  });
}
const readEnv = (file) => Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

describe('the env a lane starts from', () => {
  const dump = (id, extra = {}) => ({ id, egress: 'none', groups: ['all'], local: [`env > "$CW_REPORT_DIR/${id}.env"`], ...extra });
  const HOSTILE = { GH_TOKEN: 'gh-x', AWS_SECRET_ACCESS_KEY: 'aws-x', NPM_TOKEN: 'npm-x', OPENAI_API_KEY: 'oa-x',
    COMMITWORK_TRUST_REPO_MANIFEST: '1', VELD_API_KEY: 'veld-x' };

  test('a repo-code lane gets no token or switch; an analyser lane keeps its token (the control)', async () => {
    const { reports, out } = await runLanes([dump('builds', { executesRepoCode: true }), dump('reads')], HOSTILE);
    let code; let ana;
    try { code = readEnv(join(reports, 'builds.env')); ana = readEnv(join(reports, 'reads.env')); } catch (e) { assert.fail(`a lane wrote no env (${e.message}):\n${out}`); }
    for (const k of ['GH_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'NPM_TOKEN', 'OPENAI_API_KEY', 'COMMITWORK_TRUST_REPO_MANIFEST', 'CW_SANDBOX', 'VELD_API_KEY']) {
      assert.equal(code[k], undefined, `${k} reached the repo-code lane`);
    }
    assert.ok(code.PATH && code.HOME && code.CW_REPORT_DIR === reports, 'the repo-code lane lost what it needs to run');
    assert.equal(ana.GH_TOKEN, 'gh-x', 'the analyser lane lost its token, so the denial above proves nothing about the runner');
    assert.equal(ana.CW_SANDBOX, undefined);
    assert.equal(ana.VELD_API_KEY, undefined);
  });
});

// ── live: a target lane under the generated profile, through the runner ──────────────────────────
const live = process.platform === 'darwin' && spawnSync('sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true'], { stdio: 'ignore', timeout: 20_000 }).status === 0;
describe('a target lane reaches its own target on loopback and nothing else local', { skip: live ? false : 'sandbox-exec unavailable on this host — confinement NOT verified here' }, () => {
  test('the target port connects; another loopback port and a unix socket do not', async () => {
    const listen = (opts) => new Promise((r) => { const s = net.createServer((c) => c.end()); s.listen(opts, () => r(s)); });
    const target = await listen({ host: '127.0.0.1', port: 0 });
    const other = await listen({ host: '127.0.0.1', port: 0 });
    const sock = join(T, 's.sock');
    const unix = await listen({ path: sock });
    const probe = join(T, 'probe.mjs');
    writeFileSync(probe, `import net from 'node:net';
const out = {};
for (const [k, t] of Object.entries(JSON.parse(process.argv[2]))) out[k] = await new Promise((r) => { const s = net.connect(t); const d = (v) => { s.destroy(); r(v); }; s.once('connect', () => d('CONNECTED')); s.once('error', (e) => d(e.code)); setTimeout(() => d('TIMEOUT'), 5000); });
console.log(JSON.stringify(out));
`);
    const targets = JSON.stringify({ target: { host: '127.0.0.1', port: target.address().port }, other: { host: '127.0.0.1', port: other.address().port }, unix: { path: sock } });
    const lane = { id: 'probe-target', egress: 'target', groups: ['all'], requires: { tools: ['node'] },
      local: [`"${process.execPath}" "${probe}" '${targets}' > "$CW_REPORT_DIR/probe.json"`] };
    try {
      const { reports, out } = await runLanes([lane], { CW_TARGET_URL: `http://127.0.0.1:${target.address().port}` }, { sandbox: true });
      const rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8'));
      const row = rows.find((r) => r.check === 'probe-target');
      assert.equal(row && row.isolation, 'fs-only', `the lane did not run under the host sandbox: ${JSON.stringify(row)}\n${out}`);
      const got = JSON.parse(readFileSync(join(reports, 'probe.json'), 'utf8'));
      assert.equal(got.target, 'CONNECTED', `the declared target was unreachable, so the denials below prove nothing: ${JSON.stringify(got)}`);
      assert.equal(got.other, 'EPERM', `a loopback port the lane never declared was reachable: ${JSON.stringify(got)}`);
      assert.equal(got.unix, 'EPERM', `a unix socket was reachable: ${JSON.stringify(got)}`);
    } finally { target.close(); other.close(); unix.close(); }
  });
});

// ── live on Linux: the same target lane through the runner, bwrap and the pasta helper ──────────
const linuxSkip = (() => {
  if (process.platform !== 'linux') return 'not Linux: the bwrap and pasta confinement is NOT verified here';
  const ok = (c, a) => { const r = spawnSync(c, a, { stdio: 'ignore', timeout: 20_000 }); return !r.error && r.status === 0; };
  if (!ok('bwrap', ['--ro-bind', '/', '/', '--unshare-net', '--die-with-parent', '--', '/bin/true'])) return 'bwrap cannot create a namespace on this host: confinement NOT verified here';
  return false;
})();
const pastaSkip = linuxSkip || (spawnSync('pasta', ['--version'], { stdio: 'ignore' }).status === 0 ? false : 'pasta (package passt) is absent: open-lane confinement NOT verified here');
// DATA is bytes from the listener; a forwarder that accepts and then fails its own connect gives CONNECTED.
const LINUX_PROBE = `import net from 'node:net';
const out = {};
await Promise.all(Object.entries(JSON.parse(process.argv[2])).map(async ([k, t]) => { out[k] = await new Promise((r) => { const s = net.connect(t); let up = false; let got = ''; const d = (v) => { s.destroy(); r(v); }; s.once('connect', () => { up = true; }); s.on('data', (b) => { got += b; d('DATA'); }); s.once('close', () => d(got ? 'DATA' : up ? 'CONNECTED' : 'CLOSED')); s.once('error', (e) => d(e.code)); setTimeout(() => d(up ? 'CONNECTED' : 'TIMEOUT'), 4000).unref(); }); }));
console.log(JSON.stringify(out));
`;

describe('Linux: a target lane reaches its own target on loopback and nothing else local', { skip: pastaSkip }, () => {
  test('the target port delivers the listener\'s bytes; another loopback port and a unix socket do not', async () => {
    const listen = (opts) => new Promise((r) => { const s = net.createServer((c) => { c.on('error', () => {}); c.end('hi'); }); s.listen(opts, () => r(s)); });
    const target = await listen({ host: '127.0.0.1', port: 0 });
    const other = await listen({ host: '127.0.0.1', port: 0 });
    const sock = join(T, 'lx.sock');
    const unix = await listen({ path: sock });
    const probe = join(T, 'lx-probe.mjs');
    writeFileSync(probe, LINUX_PROBE);
    const targets = JSON.stringify({ target: { host: '127.0.0.1', port: target.address().port }, other: { host: '127.0.0.1', port: other.address().port }, unix: { path: sock } });
    // T is under /tmp, which the lane sees as a private tmpfs, so the probe travels in the command.
    const b64 = Buffer.from(LINUX_PROBE).toString('base64');
    const lane = { id: 'probe-target', egress: 'target', groups: ['all'], requires: { tools: ['node'] },
      local: [`echo ${b64} | base64 -d > "$CW_REPORT_DIR/p.mjs" && "${process.execPath}" "$CW_REPORT_DIR/p.mjs" '${targets}' > "$CW_REPORT_DIR/probe.json"`] };
    try {
      const { reports, out } = await runLanes([lane], { CW_TARGET_URL: `http://127.0.0.1:${target.address().port}` }, { sandbox: true });
      const rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8'));
      const row = rows.find((r) => r.check === 'probe-target');
      assert.equal(row && row.isolation, 'fs-only', `the lane did not run under the host sandbox: ${JSON.stringify(row)}\n${out}`);
      let got; try { got = JSON.parse(readFileSync(join(reports, 'probe.json'), 'utf8')); } catch (e) { assert.fail(`the probe wrote nothing (${e.message}):\n${out}`); }
      const control = await new Promise((r) => { const c = spawn(process.execPath, [probe, targets]); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('close', () => r(JSON.parse(o))); });
      assert.deepEqual(control, { target: 'DATA', other: 'DATA', unix: 'DATA' }, 'the unsandboxed control did not reach every listener, so the denials below prove nothing');
      assert.equal(got.target, 'DATA', `the declared target did not reach its listener: ${JSON.stringify(got)}`);
      assert.ok(!['DATA', 'CONNECTED'].includes(got.other), `a loopback port the lane never declared was reachable: ${JSON.stringify(got)}`);
      assert.ok(!['DATA', 'CONNECTED'].includes(got.unix), `a unix socket was reachable: ${JSON.stringify(got)}`);
    } finally { target.close(); other.close(); unix.close(); }
  });
});

// fact: a lane whose network namespace cannot be built is refused by the preflight and reads noscan / falling back to the host namespace is the defect D1 names (expiry: never, prev: missing)
describe('Linux: an open lane is refused, not run on the host network, when pasta fails', { skip: linuxSkip }, () => {
  test('the row is noscan with pasta\'s reason, and the command never ran', async () => {
    const bin = join(T, 'fakepasta'); mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'pasta'), '#!/bin/sh\necho "pasta: simulated failure" >&2\nexit 1\n', { mode: 0o755 });
    const lane = { id: 'probe-refused', egress: 'registry', groups: ['all'], local: ['echo ran > "$CW_REPORT_DIR/ran.txt"'] };
    const { reports, out } = await runLanes([lane], { PATH: `${bin}:${process.env.PATH}` }, { sandbox: true });
    const rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8'));
    const row = rows.find((r) => r.check === 'probe-refused');
    assert.equal(row && row.status, 'noscan', `${JSON.stringify(row)}\n${out}`);
    assert.match(JSON.stringify(row), /pasta exited 1 before the namespace was ready: pasta: simulated failure/);
    assert.throws(() => readFileSync(join(reports, 'ran.txt')), /ENOENT/, 'the command ran');
  });
});
