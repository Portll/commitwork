// The Linux network half of the host sandbox, measured (review 2026-10-07 D1). bwrap and pasta run
// for real against this process's own listeners, and each denial is asserted beside the
// unsandboxed control that must reach the same listener. Skips with the reason where Linux, bwrap
// or pasta is absent, because a not-run confinement check is not a pass. The fail-closed section
// needs bwrap only. The helper's pure parts are in sandbox-net.test.mjs.

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir, homedir, networkInterfaces } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { NOT_RUN } from '../lib/sandbox-net.mjs';
import { hostSandboxArgv, preflightHostSandbox, EGRESS_CLASSES } from '../lib/sandbox.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const has = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: 'ignore', timeout: 20_000 }); return !r.error && r.status === 0; };
const bwrapOk = process.platform === 'linux' && has('bwrap', ['--ro-bind', '/', '/', '--unshare-net', '--die-with-parent', '--', '/bin/true']);
const bwrapSkip = process.platform !== 'linux' ? 'not Linux: the bwrap and pasta confinement is NOT verified here'
  : (bwrapOk ? false : 'bwrap cannot create a namespace on this host: confinement NOT verified here');
const pastaSkip = bwrapSkip || (has('pasta', ['--version']) ? false : 'pasta (package passt) is absent: open-lane confinement NOT verified here');

const T = realpathSync(mkdtempSync(join(tmpdir(), 'cw-sbx-net-')));
after(() => rmSync(T, { recursive: true, force: true }));
const spec = (over = {}) => {
  const repo = join(T, 'repo'); const report = join(T, 'report');
  mkdirSync(repo, { recursive: true }); mkdirSync(report, { recursive: true });
  return {
    egress: 'none', repoPath: repo, reportDir: report, platform: 'linux', cwRoot: realpathSync(CW),
    nodePrefix: dirname(dirname(realpathSync(process.execPath))), tmpDir: realpathSync(tmpdir()), home: homedir(), ...over,
  };
};
// DATA means bytes from the listener arrived; CONNECTED alone is not proof of reaching it, because a
// forwarder may accept and then fail its own connect.
const PROBE = `import net from 'node:net';
const out = {};
await Promise.all(Object.entries(JSON.parse(process.argv[2])).map(async ([k, t]) => { out[k] = await new Promise((r) => {
  const s = net.connect(t); let up = false; let got = '';
  const d = (v) => { s.destroy(); r(v); };
  s.once('connect', () => { up = true; });
  s.on('data', (b) => { got += b; if (got.includes('hi')) d('DATA'); });
  s.once('close', () => d(got ? 'DATA' : up ? 'CONNECTED' : 'CLOSED'));
  s.once('error', (e) => d(e.code));
  setTimeout(() => d(up ? 'CONNECTED' : 'TIMEOUT'), 4000).unref();
}); }));
out.dns = await import('node:dns').then((dns) => Promise.race([dns.promises.lookup('example.com').then(() => 'OK', (e) => e.code), new Promise((r) => setTimeout(() => r('TIMEOUT'), 8000).unref())]));
console.log(JSON.stringify(out));
`;
const go = (argv, env = process.env) => new Promise((r) => {
  const c = spawn(argv[0], argv.slice(1), { env }); let o = ''; let e = '';
  c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { e += d; });
  c.on('close', (status) => r({ status, out: o.trim(), err: e.trim() }));
});
const REACHED = new Set(['DATA', 'CONNECTED']);

describe('Linux host confinement, measured', { skip: pastaSkip }, () => {
  // fact: measured against this process's own listeners and sockets, never a live service / review 2026-10-07 D1 (expiry: never, prev: broken)
  test('no class reaches loopback, the host\'s own addresses, /tmp or /run sockets or abstract sockets; the unsandboxed control reaches each', async () => {
    const listen = (opts) => new Promise((ok, no) => { const s = net.createServer((c) => { c.on('error', () => {}); c.end('hi'); }); s.once('error', no); s.listen(opts, () => ok(s)); });
    const sockDir = mkdtempSync('/tmp/cw-sbx-sock-');
    const v4 = await listen({ host: '127.0.0.1', port: 0 });
    const v6 = await listen({ host: '::1', port: 0 }).catch(() => null);
    const wild = await listen({ port: 0 });
    const tmpSock = await listen({ path: join(sockDir, 'peer.sock') });
    // a socket in /run where this user can make one: the runtime dir a session has, or /run itself
    const xdg = process.env.XDG_RUNTIME_DIR;
    const runDirs = [...(xdg && xdg.startsWith('/run/') ? [xdg] : []), '/run'];
    let runPath = null; let runSock = null;
    for (const d of runDirs) { const p = join(d, `cw-sbx-${process.pid}.sock`); runSock = await listen({ path: p }).catch(() => null); if (runSock) { runPath = p; break; } }
    const abstract = await listen({ path: `\0cw-sbx-${process.pid}` });
    const hostAddrs = Object.values(networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === 'IPv4').map((i) => i.address);
    const targets = {
      v4: { host: '127.0.0.1', port: v4.address().port },
      any: { host: '127.0.0.1', port: wild.address().port },
      ...(v6 ? { v6: { host: '::1', port: v6.address().port } } : {}),
      ...Object.fromEntries(hostAddrs.map((a) => [`host:${a}`, { host: a, port: wild.address().port }])),
      tmpSock: { path: join(sockDir, 'peer.sock') },
      ...(runSock ? { runSock: { path: runPath } } : {}),
      abstract: { path: `\0cw-sbx-${process.pid}` },
    };
    const s = spec();
    const probe = join(s.reportDir, 'probe.mjs');
    writeFileSync(probe, PROBE);
    const cmd = `"${process.execPath}" "${probe}" '${JSON.stringify(targets)}'`;
    try {
      const control = JSON.parse((await go([process.execPath, probe, JSON.stringify(targets)])).out);
      for (const k of Object.keys(targets)) assert.equal(control[k], 'DATA', `unsandboxed ${k} did not reach its listener, so its denial below would prove nothing: ${JSON.stringify(control)}`);
      for (const egress of EGRESS_CLASSES) {
        const r = await go(hostSandboxArgv({ ...s, egress, cmd }).argv);
        let got; try { got = JSON.parse(r.out); } catch { assert.fail(`${egress}: the probe did not run (${r.status}): ${r.err}`); }
        for (const k of Object.keys(targets)) assert.ok(!REACHED.has(got[k]), `${egress}: ${k} was reachable: ${JSON.stringify(got)}`);
        if (egress === 'none') assert.notEqual(got.dns, 'OK', 'a lane with no network resolved a name');
        else if (control.dns === 'OK') assert.equal(got.dns, 'OK', `${egress}: name resolution broke in the namespace: ${JSON.stringify(got)}`);
      }
      // the declared target port reaches the host's listener; the rest stay closed
      const r = await go(hostSandboxArgv({ ...s, egress: 'target', loopbackPorts: [v4.address().port], cmd }).argv);
      const tgt = JSON.parse(r.out);
      assert.equal(tgt.v4, 'DATA', `the declared target port did not reach its listener: ${JSON.stringify(tgt)} ${r.err}`);
      for (const k of Object.keys(targets).filter((x) => x !== 'v4')) assert.ok(!REACHED.has(tgt[k]), `target: undeclared ${k} was reachable: ${JSON.stringify(tgt)}`);
    } finally {
      for (const l of [v4, v6, wild, tmpSock, runSock, abstract]) if (l) l.close();
      rmSync(sockDir, { recursive: true, force: true });
    }
  });

  test('an open lane still reaches an external address when the unsandboxed control does', async () => {
    const s = spec();
    const cjs = join(s.reportDir, 'ext.cjs');
    writeFileSync(cjs, "const s=require('net').connect({host:'1.1.1.1',port:443});const t=setTimeout(()=>{console.log('ERR TIMEOUT');s.destroy()},8000);s.once('connect',()=>{console.log('NET');clearTimeout(t);s.destroy()});s.once('error',e=>{console.log('ERR',e.code);clearTimeout(t);s.destroy()})");
    const control = (await go([process.execPath, cjs])).out;
    const got = (await go(hostSandboxArgv({ ...s, egress: 'registry', cmd: `"${process.execPath}" "${cjs}"` }).argv)).out;
    if (control === 'NET') assert.equal(got, 'NET', `the control reached 1.1.1.1:443 and the lane did not: ${got}`);
    else assert.match(got, /^ERR/, `offline host: ${control} / ${got}`);
    const none = (await go(hostSandboxArgv({ ...s, egress: 'none', cmd: `"${process.execPath}" "${cjs}"` }).argv)).out;
    assert.notEqual(none, 'NET', 'egress none reached the internet');
  });

  test('the preflight passes on every real open profile, and the lane\'s exit status comes through the helper', async () => {
    for (const egress of ['registry', 'target']) assert.deepEqual(preflightHostSandbox(hostSandboxArgv({ ...spec({ egress }), cmd: 'exit 0' })), { ok: true, why: null }, egress);
    assert.equal((await go(hostSandboxArgv({ ...spec({ egress: 'github' }), cmd: 'exit 7' }).argv)).status, 7);
  });
});

// fact: without pasta an open lane is refused and its command never starts / falling back to the host namespace is the defect this closes, and running it with no network would hand osv-scanner its "clean scan of nothing" (expiry: never, prev: missing)
describe('Linux: an open lane without a working pasta is refused, never run on the host network', { skip: bwrapSkip }, () => {
  // under the report dir, which the lane can see, so on a sandbox without the helper the command would run
  const bin = mkdtempSync(join(spec().reportDir, 'bin-'));
  const which = (c) => spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }).stdout.trim();
  if (!bwrapSkip) for (const c of ['bwrap', 'sh']) symlinkSync(which(c), join(bin, c));
  const run = (dir, cmd) => {
    const { argv } = hostSandboxArgv({ ...spec({ egress: 'registry' }), cmd });
    return spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', env: { ...process.env, PATH: dir }, timeout: 60_000 });
  };

  test('pasta absent: exit NOT_RUN with the reason, the marker never written, and the preflight refuses', () => {
    const marker = join(spec().reportDir, 'RAN-absent');
    const r = run(bin, `echo x > "${marker}"`);
    assert.equal(r.status, NOT_RUN, r.stderr);
    assert.match(r.stderr, /pasta is not installed \(package passt\).*never on the host network/);
    assert.ok(!existsSync(marker), 'the command ran without its network namespace');
    const pre = preflightHostSandbox(hostSandboxArgv({ ...spec({ egress: 'target' }), cmd: 'exit 0' }), { spawn: (b, a, o) => spawnSync(b, a, { ...o, env: { ...process.env, PATH: bin } }) });
    assert.equal(pre.ok, false);
    assert.match(pre.why, /exited 125 before running the command: sandbox-net: pasta is not installed/);
  });

  test('pasta that fails: the same refusal, carrying pasta\'s own message', () => {
    const dir = mkdtempSync(join(spec().reportDir, 'bin-fail-'));
    for (const c of ['bwrap', 'sh']) symlinkSync(which(c), join(dir, c));
    writeFileSync(join(dir, 'pasta'), '#!/bin/sh\necho "pasta: simulated failure" >&2\nexit 1\n', { mode: 0o755 });
    const marker = join(spec().reportDir, 'RAN-fail');
    const r = run(dir, `echo x > "${marker}"`);
    assert.equal(r.status, NOT_RUN, r.stderr);
    assert.match(r.stderr, /pasta exited 1 before the namespace was ready: pasta: simulated failure/);
    assert.ok(!existsSync(marker));
  });
});
