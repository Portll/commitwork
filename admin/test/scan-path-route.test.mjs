// admin/routes/scan-path.mjs — direct-handler tests (no server spawn). The last test drives the
// real job runner against a stand-in bin/commitwork.mjs that prints the argv it was handed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, symlinkSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initJobs, jobArgv, jobLogPath, scanOutDir, trigger, jobs } from '../lib/jobs.mjs';
import { routes, resolveScanPath, systemRoot } from '../routes/scan-path.mjs';
import { routes as jobRoutes } from '../routes/jobs.mjs';
import { pidAlive } from '../../lib/pid-alive.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'cw-scan-path-')));
const CW = join(TMP, 'cw');
const HOME = join(TMP, 'home');
const REPOS = join(TMP, 'repos');
const OUT = join(TMP, 'scan-out');
const ENV = ['HOME', 'CW_ADMIN_LOCAL_PORT', 'CW_SCAN_PATH_OUT', 'CW_SIDECAR', 'CW_JOB_LOG_DIR'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
after(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});
/** Run fn with env overrides (null deletes), restoring them after. */
const withEnv = (vars, fn) => {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === null) delete process.env[k]; else process.env[k] = v; }
  const done = () => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  let r;
  try { r = fn(); } catch (e) { done(); throw e; }
  return r && typeof r.then === 'function' ? r.finally(done) : (done(), r);
};

process.env.HOME = HOME;
process.env.CW_SCAN_PATH_OUT = OUT;
delete process.env.CW_SIDECAR;
mkdirSync(OUT, { recursive: true });
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
process.env.CW_JOB_LOG_DIR = join(TMP, 'job-logs');
delete process.env.CW_SWEEP_CMD;
mkdirSync(join(CW, 'bin'), { recursive: true });
// With CW_TEST_SCAN_HOLD set, the stand-in mints its owner token as the real CLI does, starts a
// grandchild, records both, and waits to be stopped.
writeFileSync(join(CW, 'bin', 'commitwork.mjs'), `console.log('ARGV ' + JSON.stringify(process.argv.slice(2)));
if (process.env.CW_TEST_SCAN_HOLD) {
  const { selfOwner } = await import(${JSON.stringify(new URL('../../monitor/containers.mjs', import.meta.url).href)});
  const { spawn } = await import('node:child_process');
  const { writeFileSync } = await import('node:fs');
  const kid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(process.env.CW_TEST_SCAN_HOLD, JSON.stringify({ owner: selfOwner(), grandchild: kid.pid }));
  setInterval(() => {}, 1000);
}
`);
mkdirSync(join(HOME, '.ssh', 'keys'), { recursive: true });
mkdirSync(join(REPOS, 'acme'), { recursive: true });
writeFileSync(join(REPOS, 'acme', 'package.json'), '{}\n');
initJobs({
  CW, registry: () => ({ areas: [{ slug: 'client-a' }] }), sessionStorePath: () => join(TMP, 'sessions.json'),
  projectSlug: (s) => s, primaryArea: () => ({ slug: 'client-a' }),
});

const route = (method, path = '/api/scan-path') => routes.find((r) => r.method === method && r.path === path);
const SESSION = { user: 'op@example.com', method: 'password' };
function call(method, { body = null, loopback = true, session = null, trig, path, query = {} } = {}) {
  const calls = [];
  const fake = (kind, project, opts) => { calls.push({ kind, project, opts }); return { started: true }; };
  return new Promise((res) => {
    route(method, path).handle({
      req: {}, isLoopbackReq: loopback, adminSession: () => session, query: new URLSearchParams(query),
      send: (code, payload, type, headers) => res({ code, payload, type, headers, calls }),
      readJsonBody: (_r, cb) => cb(body, null),
      trigger: trig || fake,
    });
  });
}
const until = async (what, pred, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (pred()) return;
  assert.fail(`timed out waiting for ${what}`);
};

test('unauthenticated off the operator port: 401 for both methods, nothing started', async () => {
  for (const m of ['GET', 'POST']) {
    const r = await call(m, { loopback: false, body: { path: join(REPOS, 'acme') } });
    assert.equal(r.code, 401, m);
    assert.equal(r.calls.length, 0);
  }
});

test('signed in on the published port: no control to draw, and the POST is a 403 naming the operator port', async () => {
  process.env.CW_ADMIN_LOCAL_PORT = '9123';
  const g = await call('GET', { loopback: false, session: SESSION });
  assert.equal(g.code, 200);
  assert.equal(g.payload.canAct, false);
  assert.equal(g.payload.job, null);
  const p = await call('POST', { loopback: false, session: SESSION, body: { path: join(REPOS, 'acme') } });
  assert.equal(p.code, 403);
  assert.match(p.payload.error, /operator port, http:\/\/127\.0\.0\.1:9123/);
  assert.equal(p.calls.length, 0, 'the published port started a scan');
});

test('the operator port reports canAct', async () => {
  const g = await call('GET');
  assert.equal(g.code, 200);
  assert.equal(g.payload.canAct, true);
});

test('relative, missing, non-directory and malformed paths are refused with the reason', async () => {
  const cases = [
    [{ path: 'repos/acme' }, /not an absolute path: repos\/acme/],
    [{ path: join(TMP, 'nope') }, /no such path: .*nope/],
    [{ path: join(REPOS, 'acme', 'package.json') }, /not a directory: .*package\.json/],
    [{ path: '' }, /body must be \{"path"/],
    [{ path: ['/tmp'] }, /body must be \{"path"/],
    [null, /body must be \{"path"/],
  ];
  for (const [body, re] of cases) {
    const r = await call('POST', { body });
    assert.equal(r.code, 400, JSON.stringify(body));
    assert.match(r.payload.error, re);
    assert.equal(r.calls.length, 0, `${JSON.stringify(body)} started a scan`);
  }
});

test('a path inside or containing a credential store is refused, and so are / and /etc', async () => {
  const stores = [join(HOME, '.ssh', 'keys'), HOME, TMP];
  for (const path of stores) {
    const r = await call('POST', { body: { path } });
    assert.equal(r.code, 400, path);
    assert.match(r.payload.error, /credential/, path);
    assert.equal(r.calls.length, 0);
  }
  // A home with no stores on disk: the rule is lexical, so an absent store still guards its parent.
  const bare = join(TMP, 'bare-home');
  mkdirSync(bare);
  assert.match(resolveScanPath(bare, { home: bare }).error, /overlaps the credential store .*bare-home\/\.ssh/);
  assert.match((await call('POST', { body: { path: '/' } })).payload.error, /refusing to scan \/: the filesystem root/);
  assert.match((await call('POST', { body: { path: '/etc' } })).payload.error, /refusing to scan \/etc: \/etc is host-equivalent/);
});

// ── ruling 7, 2026-09-29: system directories, on both spellings, temp directories excepted ──────

test('system directories are refused as typed, before anything on disk is read', async () => {
  const cases = [
    ['/private/etc', 'it is inside the system directory /private'],
    ['/private/etc/', 'it is inside the system directory /private'],
    ['/usr/local', 'it is inside the system directory /usr'],
    ['/usr', 'it is the system directory /usr'],
    ['/System/Library/CoreServices', 'it is inside the system directory /System'],
    ['/var/log', 'it is inside the system directory /var'],
    ['/private/var/db', 'it is inside the system directory /private'],
    ['/tmp/../private/etc', 'it is inside the system directory /private'],
    ['/proc/1', '/proc is host-equivalent and no posture may opt into it'],
    ['/boot/efi', 'it is inside the system directory /boot'],
    ['/root', 'it is the system directory /root'],
  ];
  for (const [path, why] of cases) {
    const r = await call('POST', { body: { path } });
    assert.equal(r.code, 400, path);
    assert.equal(r.payload.error, `refusing to scan ${resolve(path)}: ${why}`, path);
    assert.equal(r.calls.length, 0);
  }
});

test('the realpath is checked too: a link to /etc is refused whichever name the kernel gives it', () => {
  const link = join(TMP, 'etc-link');
  symlinkSync('/etc', link);
  const real = realpathSync('/etc');
  assert.match(resolveScanPath(link).error, new RegExp(`^refusing to scan ${real}: `), 'a link out of a temp directory reached a system one');
});

test('temp directories stay scannable under their refused parents; /Volumes and look-alike names are not system paths', () => {
  const inTmp = mkdtempSync('/tmp/cw-scan-path-');
  try {
    assert.deepEqual(resolveScanPath(inTmp), { ok: true, path: realpathSync(inTmp) });
  } finally { rmSync(inTmp, { recursive: true, force: true }); }
  // TMP is a realpath under os.tmpdir(): /private/var/folders/… on macOS. Typed both ways.
  const acme = join(REPOS, 'acme');
  assert.deepEqual(resolveScanPath(acme), { ok: true, path: acme });
  assert.deepEqual(resolveScanPath(join(tmpdir(), basename(TMP), 'repos', 'acme')), { ok: true, path: acme });
  for (const p of ['/tmp', '/private/tmp/x', '/var/tmp/x', '/private/var/tmp', '/var/folders/ab/T/x', '/private/var/folders/ab/T/x',
    '/Volumes/corpus/repos', '/Users/op/Repositories', '/home/op', '/tmpfoo', '/variable', '/libx', '/opt-in']) {
    assert.equal(systemRoot(p), null, p);
  }
  assert.equal(systemRoot('/private/var'), '/private');
  assert.equal(systemRoot('/var/foldersX'), '/var', 'a temp exception matches whole segments');
});

test('a link is followed before the store check, not after', () => {
  const link = join(TMP, 'innocent');
  symlinkSync(join(HOME, '.ssh'), link);
  const r = resolveScanPath(link);
  assert.equal(r.ok, false);
  assert.ok(r.error.startsWith(`refusing to scan ${join(HOME, '.ssh')}:`), r.error);
});

test('the commitwork checkout and anything inside it are refused', async () => {
  for (const path of [REPO, join(REPO, 'admin')]) {
    const r = await call('POST', { body: { path } });
    assert.equal(r.code, 400, path);
    assert.match(r.payload.error, /the commitwork checkout the panel runs from/);
    assert.equal(r.calls.length, 0);
  }
});

// ── ruling 5, 2026-09-29: a directory that contains the checkout is refused too ─────────────────

test('a directory containing the checkout is refused, at any depth and through a link; a sibling is not', async () => {
  const checkout = join(REPOS, 'tools', 'commitwork');
  mkdirSync(checkout, { recursive: true });
  for (const p of [join(REPOS, 'tools'), REPOS]) {
    assert.equal(resolveScanPath(p, { checkout }).error,
      `refusing to scan ${p}: it contains the commitwork checkout ${checkout}, and discovery would scan the checkout's git-excluded keys, fleet configuration and reports with everything else; scan a directory beside it`);
  }
  const link = join(TMP, 'tools-link');
  symlinkSync(join(REPOS, 'tools'), link);
  assert.match(resolveScanPath(link, { checkout }).error, new RegExp(`^refusing to scan ${join(REPOS, 'tools')}: it contains the commitwork checkout`));
  assert.deepEqual(resolveScanPath(join(REPOS, 'acme'), { checkout }), { ok: true, path: join(REPOS, 'acme') });
  // The real one: the directory the checkout sits in.
  const r = await call('POST', { body: { path: dirname(REPO) } });
  assert.equal(r.code, 400);
  // In a checkout exported under the temp dir, that directory also holds this file's fixture HOME,
  // and the credential-store refusal fires first. Any of the three is the refusal this asserts.
  assert.match(r.payload.error, /contains the commitwork checkout|system path|overlaps the credential store/);
  assert.equal(r.calls.length, 0);
});

test('the operator port starts the scan-path job with the realpath, and argv is a brief of it', async () => {
  const link = join(TMP, 'acme-link');
  symlinkSync(join(REPOS, 'acme'), link);
  const r = await call('POST', { body: { path: link } });
  assert.equal(r.code, 202);
  assert.equal(r.payload.path, join(REPOS, 'acme'));
  assert.deepEqual(r.calls, [{ kind: 'scan-path', project: null, opts: { path: join(REPOS, 'acme'), label: `scan: ${join(REPOS, 'acme')}` } }]);
  const out = join(OUT, '2026-09-29T01-02-03');
  assert.deepEqual(jobArgv('scan-path', '', { ...r.calls[0].opts, out }), ['node', join(CW, 'bin/commitwork.mjs'), 'brief', '--root', join(REPOS, 'acme'), '--out', out]);
});

// ── ruling 3, 2026-09-29: scan output is private and never goes to the checkout's reports/ ───────

const STAMP = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d$/;

test('with nowhere private to write, every scan is refused naming CW_SCAN_PATH_OUT, and nothing spawns', async () => {
  const file = join(TMP, 'a-file');
  writeFileSync(file, '');
  mkdirSync(join(CW, 'reports'), { recursive: true });
  const cases = [
    [{ CW_SCAN_PATH_OUT: join(TMP, 'absent') }, /absent is not an existing directory \(ENOENT\)/],
    [{ CW_SCAN_PATH_OUT: file }, /a-file is not a directory/],
    [{ CW_SCAN_PATH_OUT: 'relative/out' }, /CW_SCAN_PATH_OUT is not an absolute path/],
    [{ CW_SCAN_PATH_OUT: join(CW, 'reports') }, /is inside the commitwork checkout/],
    // No override and no sidecar next to the fixture checkout.
    [{ CW_SCAN_PATH_OUT: null }, /commitwork-sidecar is not an existing directory[\s\S]*or create the sidecar at .*commitwork-sidecar \(CW_SIDECAR\)/],
  ];
  for (const [env, re] of cases) {
    await withEnv(env, async () => {
      const r = await call('POST', { body: { path: join(REPOS, 'acme') } });
      assert.equal(r.code, 503, JSON.stringify(env));
      assert.match(r.payload.error, re);
      assert.match(r.payload.error, /^refusing to start a scan: .*never written into the checkout's reports\/; set CW_SCAN_PATH_OUT to an existing private directory/);
      assert.equal(r.calls.length, 0, `${JSON.stringify(env)} started a scan`);
      const before = jobs['scan-path'];
      assert.deepEqual(trigger('scan-path', null, { path: join(REPOS, 'acme'), label: 'x' }).started, false, 'the job engine refuses on its own too');
      assert.equal(jobs['scan-path'], before, 'a refused trigger replaced the job slot');
    });
  }
});

test('by default the output is <sidecar>/reports/scan-path next to the checkout, and CW_SIDECAR moves it', () => {
  const sidecar = join(TMP, 'commitwork-sidecar');
  mkdirSync(sidecar, { recursive: true });
  withEnv({ CW_SCAN_PATH_OUT: null, CW_JOB_LOG_DIR: null }, () => {
    assert.deepEqual(scanOutDir(), { ok: true, base: sidecar, dir: join(sidecar, 'reports', 'scan-path') });
    assert.equal(jobLogPath('scan-path'), join(sidecar, 'reports', 'scan-path', 'scan-path-latest.log'), 'the log names the repositories it read');
    assert.equal(jobLogPath('bola'), join(CW, 'reports', 'bola-latest.log'), 'only scan-path moved');
    const elsewhere = join(TMP, 'elsewhere');
    mkdirSync(elsewhere);
    withEnv({ CW_SIDECAR: elsewhere }, () => assert.equal(scanOutDir().dir, join(elsewhere, 'reports', 'scan-path')));
  });
  rmSync(sidecar, { recursive: true });
});

test('a path containing or inside the output directory is refused', async () => {
  const nested = join(REPOS, 'nested-out');
  mkdirSync(join(nested, 'run'), { recursive: true });
  await withEnv({ CW_SCAN_PATH_OUT: nested }, async () => {
    for (const path of [REPOS, nested, join(nested, 'run')]) {
      const r = await call('POST', { body: { path } });
      assert.equal(r.code, 400, path);
      assert.match(r.payload.error, new RegExp(`refusing to scan ${path}: it overlaps ${nested}, where scan output goes`));
      assert.equal(r.calls.length, 0);
    }
  });
});

test('a job already running is a 409, not a second process', async () => {
  const r = await call('POST', { body: { path: join(REPOS, 'acme') }, trig: () => ({ started: false, reason: 'already running' }) });
  assert.equal(r.code, 409);
  assert.equal(r.payload.started, false);
  assert.match(r.payload.error, /already running/);
});

test('shell metacharacters reach the spawned argv as one element, and nothing is executed', async () => {
  const weird = join(REPOS, `we ird;$(touch PWNED)&&|'"*\`touch PWNED2\`>x`);
  mkdirSync(weird);
  const r = await call('POST', { body: { path: weird }, trig: trigger });
  assert.equal(r.code, 202, JSON.stringify(r.payload));
  await until('the scan-path job to finish', () => jobs['scan-path'] && !jobs['scan-path'].running);
  const job = jobs['scan-path'];
  const emitted = job.lines.find((l) => l.startsWith('ARGV '));
  assert.ok(emitted, `the stand-in never ran:\n${job.lines.join('\n')}`);
  const argv = JSON.parse(emitted.slice(5));
  assert.deepEqual(argv.slice(0, 4), ['brief', '--root', weird, '--out']);
  assert.equal(dirname(argv[4]), OUT, 'the report goes to the private output directory');
  assert.match(basename(argv[4]), STAMP);
  assert.equal(argv.length, 5);
  assert.equal(job.exitCode, 0);
  assert.equal(job.project, null, 'an ad-hoc path is attributed to an area');
  assert.equal(job.label, `scan: ${weird}`);
  const everywhere = [TMP, REPOS, CW, weird].flatMap((d) => readdirSync(d));
  assert.ok(!everywhere.some((n) => /^PWNED|^x$/.test(n)), `a metacharacter was interpreted: ${everywhere.join(', ')}`);
  assert.match(readFileSync(join(TMP, 'job-logs', 'scan-path-latest.log'), 'utf8'), /ARGV \["brief","--root"/);
  const g = await call('GET');
  assert.equal(g.payload.job.label, `scan: ${weird}`);
  assert.equal(g.payload.job.running, false);
  assert.ok(existsSync(weird));
});

// ── ruling 4, 2026-09-29: a scan-path run is stoppable ──────────────────────────────────────────

const stopRoute = jobRoutes.find((r) => r.method === 'POST' && r.path === '/api/sweep/stop');
const stop = (loopback) => new Promise((res) => stopRoute.handle({
  req: { url: '/api/sweep/stop?kind=scan-path' }, isLoopbackReq: loopback, send: (code, payload) => res({ code, payload }) }));
// A killed process nothing reaps stays a zombie that kill(0) still finds; pidAlive reads it dead.
const gone = (pid) => !pidAlive(pid);

test('stopping ends the scan\'s process tree and removes only the containers it started', { skip: process.platform === 'win32' ? 'process groups and ps are POSIX' : false }, async () => {
  const hold = join(TMP, 'hold.json');
  const rows = join(TMP, 'docker-rows.txt');
  const log = join(TMP, 'docker-calls.log');
  const docker = join(TMP, 'docker');
  writeFileSync(docker, '#!/bin/sh\necho "$@" >> "$FAKE_LOG"\ncase "$1" in ps) cat "$FAKE_ROWS";; esac\nexit 0\n', { mode: 0o755 });
  await withEnv({ CW_TEST_SCAN_HOLD: hold, CW_DOCKER: docker, FAKE_ROWS: rows, FAKE_LOG: log }, async () => {
    const r = await call('POST', { body: { path: join(REPOS, 'acme') }, trig: trigger });
    assert.equal(r.code, 202, JSON.stringify(r.payload));
    await until('the stand-in to hold', () => existsSync(hold) && readFileSync(hold, 'utf8').length > 0);
    const { owner, grandchild } = JSON.parse(readFileSync(hold, 'utf8'));
    const [pid, startMs] = owner.split('.').map(Number);
    assert.equal(pid, jobs['scan-path'].proc.pid, 'the label names the process the panel spawned');
    const peer = `${process.pid}.${Date.now() - Math.round(process.uptime() * 1000)}`;
    writeFileSync(rows, [
      ['cw-cli-acme-sast', owner], ['cw-cli-acme-sast-warm', owner],
      ['cw-cli-other-sast', peer],                          // a terminal scan, alive
      ['cw-cli-acme-osv', `${pid}.${startMs - 60_000}`],     // the same pid, another process
      ['cw-cli-old-sast', ''],
    ].map((x) => x.join('\t')).join('\n') + '\n');

    const refused = await stop(false);
    assert.equal(refused.code, 403, 'the published port stopped an operator-port scan');
    assert.equal(jobs['scan-path'].running, true);

    const s = await stop(true);
    assert.equal(s.code, 200, JSON.stringify(s.payload));
    assert.equal(s.payload.stopped, true);
    await until('the scan to exit', () => !jobs['scan-path'].running);
    await until('the grandchild to die with the group', () => gone(grandchild), 6000);
    assert.ok(gone(pid));
    const removed = readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('rm -f')).map((l) => l.slice(6));
    assert.deepEqual(removed, ['cw-cli-acme-sast', 'cw-cli-acme-sast-warm']);
    const job = jobs['scan-path'];
    assert.equal(job.phase, 'stopped');
    assert.ok(job.lines.includes('[serve] removed 2 container(s) the scan started: cw-cli-acme-sast, cw-cli-acme-sast-warm'), job.lines.join('\n'));
  }).finally(() => {
    const j = jobs['scan-path'];
    if (j && j.running) { try { process.kill(-j.proc.pid, 'SIGKILL'); } catch { /* gone */ } }
    try { process.kill(JSON.parse(readFileSync(hold, 'utf8')).grandchild, 'SIGKILL'); } catch { /* gone */ }
  });
});

// ── the whole machine, and the briefs a scan writes ─────────────────────────────────────────────

test('{pc:true} starts the whole-machine brief with no path; the published port is refused it', async () => {
  const r = await call('POST', { body: { pc: true } });
  assert.equal(r.code, 202, JSON.stringify(r.payload));
  assert.equal(r.payload.pc, true);
  assert.equal(r.payload.path, undefined);
  assert.deepEqual(r.calls, [{ kind: 'scan-path', project: null, opts: { pc: true, label: 'scan: every repository on this machine' } }]);
  const remote = await call('POST', { body: { pc: true }, loopback: false, session: SESSION });
  assert.equal(remote.code, 403);
  assert.equal(remote.calls.length, 0);
  const truthy = await call('POST', { body: { pc: 'yes' } });
  assert.equal(truthy.code, 400, 'only pc:true selects the whole machine; anything else is a path request');
  assert.equal(truthy.calls.length, 0);
});

test('the brief routes are operator-only: 401 signed out, 403 on the published port', async () => {
  for (const path of ['/api/scan-path/briefs', '/api/scan-path/brief']) {
    assert.equal((await call('GET', { path, loopback: false })).code, 401, path);
    const remote = await call('GET', { path, loopback: false, session: SESSION, query: { id: 'x' } });
    assert.equal(remote.code, 403, path);
    assert.match(remote.payload.error, /names local paths.*operator port/);
  }
});

test('briefs are listed newest first; an unreadable brief.json is listed with its error, not dropped', async () => {
  const out = join(TMP, 'brief-out');
  await withEnv({ CW_SCAN_PATH_OUT: out }, async () => {
    mkdirSync(out, { recursive: true });
    const empty = await call('GET', { path: '/api/scan-path/briefs' });
    assert.deepEqual([empty.code, empty.payload.briefs], [200, []], 'no run yet is an empty list');
    const brief = (id, at, extra = {}) => {
      mkdirSync(join(out, id), { recursive: true });
      writeFileSync(join(out, id, 'brief.json'), JSON.stringify({ generatedAt: at, target: { mode: 'path', root: '/r', excluded: 9 }, counts: { repos: 1, actions: 2 }, ...extra }));
      writeFileSync(join(out, id, 'brief.html'), '<!doctype html><script>var a=1</script><p>brief</p><SCRIPT>var b=2</SCRIPT >');
      return join(out, id, 'brief.json');
    };
    const { utimesSync } = await import('node:fs');
    utimesSync(brief('2026-10-01T00-00-00', '2026-10-01T00:00:00.000Z'), 1, new Date('2026-10-01'));
    utimesSync(brief('brief-2026-10-02T00-00-00', '2026-10-02T00:00:00.000Z'), 1, new Date('2026-10-02'));
    mkdirSync(join(out, '2026-10-03T00-00-00'));
    writeFileSync(join(out, '2026-10-03T00-00-00', 'brief.json'), '{not json');
    mkdirSync(join(out, 'no-brief-yet'));
    const l = await call('GET', { path: '/api/scan-path/briefs' });
    assert.equal(l.code, 200);
    assert.deepEqual(l.payload.briefs.map((b) => b.id), ['2026-10-03T00-00-00', 'brief-2026-10-02T00-00-00', '2026-10-01T00-00-00']);
    assert.match(l.payload.briefs[0].error, /could not be read/);
    assert.deepEqual(l.payload.briefs[1].target, { mode: 'path', root: '/r' });
    assert.deepEqual(l.payload.briefs[1].counts, { repos: 1, actions: 2 });

    const j = await call('GET', { path: '/api/scan-path/brief', query: { id: 'brief-2026-10-02T00-00-00' } });
    assert.equal(j.code, 200);
    assert.equal(JSON.parse(j.payload).generatedAt, '2026-10-02T00:00:00.000Z');
    const h = await call('GET', { path: '/api/scan-path/brief', query: { id: '2026-10-01T00-00-00', format: 'html' } });
    assert.equal(h.code, 200);
    assert.match(h.type, /^text\/html/);
    const { createHash } = await import('node:crypto');
    const hashes = ['var a=1', 'var b=2'].map((s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`);
    assert.ok(h.headers['content-security-policy'].startsWith(`default-src 'none'; script-src ${hashes.join(' ')};`),
      'every inline script is hashed, whatever the case of its tags');
    for (const id of ['../x', '.hidden', '', 'a/b']) {
      assert.equal((await call('GET', { path: '/api/scan-path/brief', query: { id } })).code, 400, id);
    }
    assert.equal((await call('GET', { path: '/api/scan-path/brief', query: { id: 'no-brief-yet' } })).code, 404);
  });
});
