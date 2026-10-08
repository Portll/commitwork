// The restart pre-flight boots the successor on scratch ports and stores (admin/lib/panel-preflight.mjs)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bootCheck } from '../lib/panel-preflight.mjs';
import { routes, initPanelProcessRoutes } from '../routes/panel-process.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFLIGHT = join(HERE, '..', 'lib', 'panel-preflight.mjs');
const SERVE = join(HERE, '..', 'serve.mjs');
const TRACER = join(HERE, 'fixtures', 'boot-trace.mjs');
const LIVE_PORTS = [7878, 7879];
const TMP = mkdtempSync(join(tmpdir(), 'cw-preflight-boot-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

let n = 0;
const entry = (body) => {
  const dir = join(TMP, `e${n++}`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'm.mjs'), body);
  return join(dir, 'm.mjs');
};
// bounded: spawnSync blocks the loop, so node:test's own timeout could never fire
const cli = (file, env = {}) => spawnSync(process.execPath, [PREFLIGHT, file], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...env } });
const hold = () => new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => res(s)); });

test('a top-level throw that links cleanly fails pre-flight with the thrown message and its frame', () => {
  const file = entry("import { join } from 'node:path';\nexport const lanes = [join('a'), ...SCANNER_SPECS];\n");
  const r = cli(file);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not boot — threw at top level: ReferenceError: SCANNER_SPECS is not defined \(at file:\S+m\.mjs:2:\d+\)/);
});

test('an entry that never binds times out, and the child is killed rather than left running', () => {
  const pidFile = join(TMP, 'never.pid');
  const file = entry(`import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.CW_TEST_PID_FILE, String(process.pid));\nsetInterval(() => {}, 1000);\n`);
  const r = cli(file, { CW_PANEL_PREFLIGHT_TIMEOUT_MS: '1500', CW_TEST_PID_FILE: pidFile });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not boot — timed out: no ready signal and no exit within 1500ms/);
  assert.throws(() => process.kill(+readFileSync(pidFile, 'utf8'), 0), { code: 'ESRCH' });
});

test('a listen failure is named as one', async () => {
  const busy = await hold();
  try {
    const file = entry("import http from 'node:http';\nconst s = http.createServer();\ns.on('error', (e) => { console.error(`[admin] listener failed: ${e.message}`); process.exit(1); });\ns.listen(+process.env.CW_TEST_BUSY_PORT, '127.0.0.1');\n");
    const r = cli(file, { CW_TEST_BUSY_PORT: String(busy.address().port) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not boot — listen failure: listen EADDRINUSE/);
  } finally { busy.close(); }
});

test('exiting 0 without binding is not a boot', () => {
  const r = cli(entry('export const nothing = 1;\n'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not boot — exited 0 without binding both listeners/);
});

test('the real serve.mjs passes, on ports that are not the live ones', () => {
  const r = cli(SERVE);
  assert.equal(r.status, 0, r.stderr);
  const m = /booted on ports (\d+),(\d+) in \d+ms/.exec(r.stdout);
  assert.ok(m, r.stdout);
  for (const p of [+m[1], +m[2]]) assert.ok(p > 0 && !LIVE_PORTS.includes(p), `bound ${p}`);
});

// The base env is shaped like the LaunchAgent's, with every live store a decoy the test can watch.
test('the booted successor writes only inside its scratch dir, binds no live port and spawns nothing', async () => {
  const live = join(TMP, 'live');
  const stores = {
    CW_AUTH_STORE: 'users.json', CW_SESSION_STORE: 'sessions.json', CW_HEALTH_RUNS_STORE: 'health-runs.json',
    CW_PANEL_CODE_STAMP: 'code-stamp.json', CW_OFFBOX_EVIDENCE: 'offbox.json',
  };
  for (const d of ['home', 'tmp', 'docker']) mkdirSync(join(live, d), { recursive: true });
  for (const f of Object.values(stores)) writeFileSync(join(live, f), '{"live":true}\n');
  const snapshot = () => {
    const out = {};
    const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p] = `${statSync(p).mtimeMs}:${createHash('sha256').update(readFileSync(p)).digest('hex')}`;
    } };
    walk(live);
    return out;
  };
  const before = snapshot();
  const [pub, op] = [await hold(), await hold()];
  const trace = join(TMP, 'trace.jsonl');
  writeFileSync(trace, '');
  const base = { ...process.env,
    ...Object.fromEntries(Object.entries(stores).map(([k, f]) => [k, join(live, f)])),
    HOME: join(live, 'home'), USERPROFILE: join(live, 'home'), TMPDIR: join(live, 'tmp'), TMP: join(live, 'tmp'), TEMP: join(live, 'tmp'),
    DOCKER_CONFIG: join(live, 'docker'), CW_DOCKER_CONFIG: join(live, 'docker'),
    // held here, so a boot that ignored the override fails to bind instead of reaching 7878/7879
    CW_ADMIN_PORT: String(pub.address().port), CW_ADMIN_LOCAL_PORT: String(op.address().port),
    CW_PANEL_SUPERVISED: '1', CW_OAUTH_LIVE_EXCHANGE: '1',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(TRACER).href}`.trim(), CW_BOOT_TRACE: trace };
  let boot;
  try { boot = await bootCheck(SERVE, { base }); } finally { pub.close(); op.close(); }
  assert.equal(boot.ok, true, boot.reason);

  const inScratch = (p) => p === boot.scratch || p.startsWith(boot.scratch + sep);
  for (const k of [...Object.keys(stores).filter((k) => k !== 'CW_OFFBOX_EVIDENCE'), 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'DOCKER_CONFIG', 'CW_DOCKER_CONFIG']) {
    assert.ok(inScratch(boot.env[k]), `${k}=${boot.env[k]} is outside the scratch dir`);
  }
  assert.equal(boot.env.CW_PANEL_SUPERVISED, undefined, 'the child is not the launchd job');

  const rows = readFileSync(trace, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const writes = rows.filter((r) => r.kind === 'write');
  assert.ok(writes.some((w) => w.path === boot.env.CW_PANEL_CODE_STAMP), 'control: the tracer saw the boot write its code stamp');
  assert.deepEqual(writes.filter((w) => !inScratch(w.path)), [], 'writes outside the scratch dir');
  const listens = rows.filter((r) => r.kind === 'listen').map((r) => r.port);
  assert.deepEqual([...listens].sort(), [...boot.ports].sort());
  for (const p of listens) assert.ok(!LIVE_PORTS.includes(p), `bound live port ${p}`);
  assert.deepEqual(rows.filter((r) => r.kind === 'spawn'), [], 'the boot spawned a process (launchctl, a sweep)');
  assert.deepEqual(snapshot(), before, 'a live store changed');
});

test('the restart route refuses with 409 and the boot reason, and restarts on a clean boot', () => {
  const handle = routes.find((r) => r.method === 'POST' && r.path === '/api/panel/restart').handle;
  const call = (successorEntry) => {
    let restarted = 0, answer;
    initPanelProcessRoutes({ BOOT_AT: '', codeHealth: () => ({}), restartPanel: () => { restarted++; }, successorEntry });
    handle({ send: (status, body) => { answer = { status, body }; } });
    return { ...answer, restarted };
  };
  const refused = call(entry("throw new Error('boom at boot');\n"));
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /does not load or boot/);
  assert.match(refused.body.detail, /does not boot — threw at top level: Error: boom at boot/);
  assert.equal(refused.restarted, 0);
  const clean = call(SERVE);
  assert.equal(clean.status, 200, JSON.stringify(clean.body));
  assert.equal(clean.restarted, 1);
});
