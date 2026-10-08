// bin/smoke.mjs end to end: it runs `commitwork list` and boots admin/serve.mjs from this checkout on
// free ports with an absent auth store, then asserts the operator port serves HTML and the published
// port refuses an unbootstrapped panel with 503. Everything the booted panel could read or write
// outside the checkout's code is pointed into tmp first — HOME, the secrets table (so no keychain
// lookup happens at boot), the registry (the public example), every private record and every
// ambient output the suite already scopes (bin/test-run.mjs). The refusal case breaks the first
// witness with a preload that makes only the `commitwork list` child exit, so no panel is spawned.
// The teardown cases hang the panel child with a preload that records its pid and never lets
// admin/serve.mjs load, then assert the smoke killed it and removed its cw-smoke-* scratch on the
// timeout path and on a signal, as well as on success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scopedOutputEnv } from '../test-run.mjs';
import { pidAlive } from '../../lib/pid-alive.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SMOKE = join(CW, 'bin', 'smoke.mjs');

const PRIVATE_RECORDS = ['CW_ISSUES', 'CW_REFUTATIONS', 'CW_ANNOTATIONS', 'CW_GATE_EXEMPTIONS', 'CW_STUB_ALLOWLIST',
  'CW_IMAGE_ACCEPTANCE', 'CW_CONFIG_CORRECTNESS_LEDGER', 'CW_OWNER_MAP', 'CW_PROGRAM_WORKLIST', 'CW_PRODUCTS',
  'CW_CRED_SCOPE', 'CW_REDACTION_MAP', 'CW_COMMIT_MAP', 'CW_EXTERNAL_REDACTIONS', 'CW_INTEGRATIONS_STORE', 'CW_SECRETS_FILE'];
const PRIVATE_DIRS = ['CW_SECURITY_ANNOTATIONS_DIR', 'CW_BOLA_MANIFEST_DIR', 'CW_AUDIT_DIR'];

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-smoke-entry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const d of ['home', 'tmp', 'reports', 'private', 'sidecar']) mkdirSync(join(dir, d));
  const env = { ...process.env, ...scopedOutputEnv(join(dir, 'reports'), {}),
    HOME: join(dir, 'home'), TMPDIR: join(dir, 'tmp'), CW_REPORT_DIR: join(dir, 'reports'), CW_SIDECAR: join(dir, 'sidecar'),
    CW_REGISTRY: join(CW, 'monitor', 'projects.example.json'), CW_DOCSITE_ROOT: join(CW, 'docsite'),
    CW_SKIP_SETUP: '1', DOCKER_CONFIG: join(dir, 'docker-config') };
  for (const k of PRIVATE_RECORDS) env[k] = join(dir, 'private', `${k.toLowerCase()}.json`);
  for (const k of PRIVATE_DIRS) env[k] = join(dir, 'private', k.toLowerCase());
  for (const k of ['CW_DOCSITE_PRIVATE', 'CW_PANEL_SUPERVISED', 'CW_OAUTH_LIVE_EXCHANGE', 'NODE_OPTIONS',
    'GOOGLE_OAUTH_CLIENT_SECRET', 'GITHUB_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_ID']) delete env[k];
  return { dir, env };
}

const smoke = (env) => {
  const r = spawnSync(process.execPath, [SMOKE], { encoding: 'utf8', env, cwd: CW, timeout: 150_000 });
  return { code: r.status, out: r.stdout, err: r.stderr, signal: r.signal };
};

// The smoke's scratch is made under os.tmpdir(), which the sandbox points at its own tmp.
const scratchLeft = (s) => readdirSync(join(s.dir, 'tmp')).filter((n) => n.startsWith('cw-smoke-'));

// A killed process nothing reaps stays a zombie that kill(0) still finds; pidAlive reads it dead.
const alive = (pid) => pidAlive(pid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (pred()) return true;
  return pred();
}

// The panel child records its pid and then never loads admin/serve.mjs, so it never answers.
function hangPanel(t, s) {
  // outside the sandbox: its rm runs first, and the kill below must still find the pid
  const pidDir = mkdtempSync(join(tmpdir(), 'cw-smoke-entry-pid-'));
  const pidFile = join(pidDir, 'panel.pid');
  const preload = join(s.dir, 'hang-panel.mjs');
  writeFileSync(preload, "import { writeFileSync } from 'node:fs';\n"
    + "if (/[\\\\/]admin[\\\\/]serve\\.mjs$/.test(process.argv[1] || '')) { writeFileSync(process.env.SMOKE_PANEL_PID, String(process.pid)); setInterval(() => {}, 1 << 30); await new Promise(() => {}); }\n");
  // null until the whole pid is on disk: a read inside the write would give 0, which kill() reads as the group
  const pid = () => { const n = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : 0; return n > 0 ? n : null; };
  // an orphan left by a failing run must not outlive the test
  t.after(() => { const p = pid(); if (p && alive(p)) process.kill(p, 'SIGKILL'); rmSync(pidDir, { recursive: true, force: true }); });
  return { env: { ...s.env, SMOKE_PANEL_PID: pidFile, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` }, pid };
}

test('the panel boots: the operator port serves HTML and the published port refuses with 503', (t) => {
  const s = sandbox(t);
  const r = smoke(s.env);
  assert.equal(r.signal, null, `smoke was killed (${r.signal}) — a hang is not a result`);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^✔ commitwork list --manifest security-baseline → \d+ line\(s\)\n/);
  assert.match(r.out, /✔ operator panel serves \d+ bytes of HTML on :\d+\n/);
  assert.match(r.out, /✔ published port refuses an unbootstrapped panel on :\d+ \(503\)\n/);
  assert.match(r.out, /\nsmoke: OK\n$/);
  assert.deepEqual(scratchLeft(s), [], 'the cw-smoke-* scratch is removed on success');
});

test('a panel that never answers fails the smoke, which kills the panel it spawned and removes its scratch', async (t) => {
  const s = sandbox(t);
  const h = hangPanel(t, s);
  const r = smoke({ ...h.env, CW_SMOKE_TIMEOUT_MS: '2000' });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /✖ panel did not answer on 127\.0\.0\.1:\d+ within 2000ms\n/);
  const pid = h.pid();
  assert.ok(pid, 'fixture: the panel child was spawned and recorded its pid');
  assert.ok(await until(() => !alive(pid), 5000), `the panel child ${pid} outlived the smoke — orphaned on its port`);
  assert.deepEqual(scratchLeft(s), [], 'the cw-smoke-* scratch is removed on failure');
});

test('a smoke stopped by SIGTERM still kills its panel and removes its scratch', async (t) => {
  const s = sandbox(t);
  const h = hangPanel(t, s);
  const child = spawn(process.execPath, [SMOKE], { env: { ...h.env, CW_SMOKE_TIMEOUT_MS: '120000' }, cwd: CW, stdio: 'ignore' });
  const exited = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal })));
  t.after(() => child.kill('SIGKILL'));
  assert.ok(await until(() => h.pid() !== null, 90_000), 'fixture: the panel child never started');
  child.kill('SIGTERM');
  const r = await exited;
  assert.deepEqual(r, { code: 143, signal: null }, 'the signal reached the handler and exited 128+15');
  const pid = h.pid();
  assert.ok(await until(() => !alive(pid), 5000), `the panel child ${pid} outlived the smoke — orphaned on its port`);
  assert.deepEqual(scratchLeft(s), [], 'the cw-smoke-* scratch is removed on a signal');
});

test('when the CLI witness fails, the smoke fails (exit 1) naming it and never boots the panel', (t) => {
  const s = sandbox(t);
  // Exits only the `commitwork list` child; the smoke process itself runs normally.
  const preload = join(s.dir, 'break-cli.mjs');
  writeFileSync(preload, "if (/[\\\\/]bin[\\\\/]commitwork\\.mjs$/.test(process.argv[1] || '')) { process.stderr.write('cli broken by fixture\\n'); process.exit(3); }\n");
  const r = smoke({ ...s.env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /✖ `commitwork list --manifest security-baseline` did not run\n/);
  assert.match(r.err, /cli broken by fixture/);
  assert.doesNotMatch(r.out + r.err, /operator|published port|smoke: OK/, 'the panel stage was reached');
});
