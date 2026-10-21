// A sweep's preamble removed every cw-* container outside a live sweep slice, and a CLI run's
// containers (cw-cli-*) are in no slice, so starting a sweep killed a running `commitwork scan`'s
// docker lanes. Each CLI process now labels its containers with <pid>.<start ms>, and the reaper
// spares a container whose owner is the same live process. Docker is injected; process liveness is
// real wherever the test can make it real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { reapOrphans, killOwned, ownerState, ownerToken, selfOwner, parseOwner, OWNER_LABEL, procIo } from '../containers.mjs';
import { buildSandbox } from '../../bin/lib/sandbox.mjs';
import { runCheckLocal } from '../../bin/commitwork.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const NO_PS = POSIX ? false : 'Windows has no ps; liveness there is exists-only and reads undetermined';

// A fake daemon: `ps` lists [name, owner] rows in the format the reaper asks for; `rm` is recorded.
function daemon(rows) {
  const calls = [];
  const docker = (args) => {
    calls.push(args);
    if (args[0] === 'ps') {
      assert.ok(args.includes(`{{.Names}}\t{{.Label "${OWNER_LABEL}"}}`), `the reaper did not ask for the owner label: ${args.join(' ')}`);
      return { ok: true, out: rows.map(([n, o]) => `${n}\t${o || ''}`).join('\n') + '\n' };
    }
    return { ok: true, out: '' };
  };
  return { docker, removed: () => calls.filter((c) => c[0] === 'rm').map((c) => c.at(-1)) };
}

// A process io whose answers the test declares, keyed by pid.
const io = (table) => ({
  exists: (pid) => (pid in table ? table[pid].exists : false),
  startedAt: (pid) => (pid in table ? table[pid].start : null),
});

test('outside a live slice: a live owner is spared, a dead or recycled one is reaped, an unreadable one is left and reported', () => {
  const t = 1790676672;
  const d = daemon([
    ['cw-cli-acme-sast', `101.${t * 1000 + 250}`],      // alive: pid exists, ps start matches
    ['cw-cli-acme-deps-osv', `102.${t * 1000}`],        // dead: ESRCH
    ['cw-cli-acme-secrets', `103.${t * 1000}`],         // recycled: pid exists, started an hour later
    ['cw-cli-acme-iac', `104.${t * 1000}`],             // ps could not answer
    ['cw-cli-old-sast', ''],                            // no label: built before owners existed
    ['cw-cli-odd-sast', 'not-a-token'],                 // malformed
    ['cw-sweep-A-r1-sast', `102.${t * 1000}`],          // a live slice wins over a dead owner
  ]);
  const r = reapOrphans(['sweep-A'], { docker: d.docker, proc: io({
    101: { exists: true, start: t }, 103: { exists: true, start: t + 3600 }, 104: { exists: true, start: null },
  }) });
  assert.deepEqual(r.spared, ['cw-cli-acme-sast']);
  assert.deepEqual(r.orphans, ['cw-cli-acme-deps-osv', 'cw-cli-acme-secrets', 'cw-cli-old-sast']);
  assert.deepEqual(r.undetermined, ['cw-cli-acme-iac', 'cw-cli-odd-sast']);
  assert.deepEqual(d.removed(), r.orphans, 'only proven orphans are removed');
  assert.equal(r.seen, 7);
});

test('one second of start tolerance, as single-flight measured; two seconds is a different process', () => {
  const t = 1790676672;
  const at = (start) => ownerState(`7.${t * 1000 + 999}`, io({ 7: { exists: true, start } }));
  assert.equal(at(t), 'alive');
  assert.equal(at(t + 1), 'alive');
  assert.equal(at(t - 1), 'alive');
  assert.equal(at(t + 2), 'dead');
  assert.equal(ownerState(`7.${t * 1000}`, io({ 7: { exists: null, start: t } })), 'undetermined', 'an unexpected kill(0) error is not ESRCH');
});

test('a token is <pid>.<start ms>, and nothing else parses as one', () => {
  assert.deepEqual(parseOwner('4242.1790676672123'), { pid: 4242, startMs: 1790676672123 });
  for (const bad of ['', '0.1', '-1.5', '12', '12.', 'a.1', '12.1 x', '1.2.3', null, undefined]) {
    assert.equal(parseOwner(bad), null, JSON.stringify(bad));
  }
  assert.equal(selfOwner(), selfOwner(), 'minted once per process');
  assert.equal(parseOwner(selfOwner()).pid, process.pid);
});

test('real processes: this one is alive, an exited child is dead, a recycled start is dead, no ps is undetermined', { skip: NO_PS }, async () => {
  assert.equal(ownerState(selfOwner()), 'alive', 'the uptime-derived start must agree with ps within a second');
  const child = spawn(process.execPath, ['-e', '0']);
  await new Promise((r) => child.on('exit', r));
  assert.equal(procIo.exists(child.pid), false);
  assert.equal(ownerState(ownerToken(child.pid, Date.now())), 'dead');
  const self = parseOwner(selfOwner());
  assert.equal(ownerState(`${process.pid}.${self.startMs - 60_000}`), 'dead', 'the same pid with another start is another process');
  const prev = process.env.CW_PS;
  process.env.CW_PS = '/nonexistent/ps';
  try { assert.equal(ownerState(selfOwner()), 'undetermined'); }
  finally { if (prev === undefined) delete process.env.CW_PS; else process.env.CW_PS = prev; }
});

test('the ruling: a sweep started while a CLI run lives spares its containers, and reaps them once it is gone', { skip: NO_PS }, async () => {
  // The CLI mints its token from its own clock, as selfOwner() does; the reaper checks it with ps.
  const cli = spawn(process.execPath, ['-e', 'console.log(Date.now() - Math.round(process.uptime() * 1000)); setInterval(() => {}, 1000)']);
  const gone = new Promise((r) => cli.on('exit', r));
  let d;
  try {
    const start = await new Promise((r) => cli.stdout.once('data', (b) => r(String(b).trim())));
    const token = `${cli.pid}.${start}`;
    d = daemon([['cw-cli-acme-sast', token], ['cw-cli-acme-sast-warm', token]]);
    const during = reapOrphans(['sweep-20260929000000'], { docker: d.docker });
    assert.deepEqual(during.spared, ['cw-cli-acme-sast', 'cw-cli-acme-sast-warm']);
    assert.deepEqual(d.removed(), [], 'the sweep removed a live scan\'s containers');
  } finally { cli.kill('SIGKILL'); await gone; }
  const afterExit = reapOrphans(['sweep-20260929000000'], { docker: d.docker });
  assert.deepEqual(afterExit.orphans, ['cw-cli-acme-sast', 'cw-cli-acme-sast-warm']);
  assert.deepEqual(d.removed(), afterExit.orphans);
});

test('killOwned removes one process\'s containers: not a recycled pid, not another owner, not an unlabelled one', () => {
  const t = 1790676672;
  const d = daemon([
    ['cw-cli-acme-sast', `300.${t * 1000 + 400}`],
    ['cw-cli-acme-sast-warm', `300.${t * 1000 + 900}`],
    ['cw-cli-acme-osv', `300.${(t - 60) * 1000}`],   // same pid, a minute earlier: another process
    ['cw-cli-term-sast', `301.${t * 1000}`],         // a terminal scan's
    ['cw-cli-old-sast', ''],
  ]);
  const r = killOwned({ pid: 300, startSec: t }, { docker: d.docker });
  assert.deepEqual(r.names, ['cw-cli-acme-sast', 'cw-cli-acme-sast-warm']);
  assert.deepEqual(d.removed(), r.names);
  assert.equal(r.unread, false);
  assert.deepEqual(killOwned({ pid: 300, startSec: t }, { docker: () => ({ ok: false, out: '' }) }),
    { names: [], killed: [], failed: [], unread: true }, 'docker unreadable is said, not read as "had none"');
});

test('the sandbox labels a container with its owner, refuses a malformed one, and adds nothing without one', () => {
  const at = (args, flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
  assert.deepEqual(at(buildSandbox({ posture: 'analyse', name: 'cw-cli-r-x', owner: '4242.1790676672123' }).args, '--label'),
    [`${OWNER_LABEL}=4242.1790676672123`]);
  assert.deepEqual(at(buildSandbox({ posture: 'analyse', name: 'cw-cli-r-x' }).args, '--label'), []);
  assert.throws(() => buildSandbox({ posture: 'analyse', name: 'cw-cli-r-x', owner: '4242; rm -rf /' }), /not <pid>\.<start ms>/);
  const cli = spawnSync(process.execPath, [join(REPO, 'bin/sandbox.mjs'), '--posture', 'analyse', '--name', 'cw-cli-r-x', '--json'],
    { encoding: 'utf8', env: { ...process.env, CW_CONTAINER_OWNER: '4242.1790676672123' } });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(at(JSON.parse(cli.stdout), '--label'), [`${OWNER_LABEL}=4242.1790676672123`], 'the shell entry point reads CW_CONTAINER_OWNER');
});

test('every lane the CLI runs carries this process as CW_CONTAINER_OWNER, over one inherited from a parent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-owner-lane-'));
  const saved = { d: process.env.CW_DOCKER, o: process.env.CW_CONTAINER_OWNER, r: process.env.CW_REPORT_DIR };
  process.env.CW_DOCKER = '/nonexistent/docker';
  process.env.CW_CONTAINER_OWNER = '1.1';
  process.env.CW_REPORT_DIR = dir;
  try {
    const r = runCheckLocal({ id: 'owner-probe', local: ['printf %s "$CW_CONTAINER_OWNER" > "$CW_REPORT_DIR/owner"'] }, dir);
    assert.equal(r.status, 'pass', JSON.stringify(r));
    assert.equal(readFileSync(join(dir, 'owner'), 'utf8'), selfOwner());
  } finally {
    for (const [k, v] of [['CW_DOCKER', saved.d], ['CW_CONTAINER_OWNER', saved.o], ['CW_REPORT_DIR', saved.r]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
