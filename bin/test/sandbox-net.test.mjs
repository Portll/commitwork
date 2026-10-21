// bin/lib/sandbox-net.mjs: the pure decisions (argv gate, route parsing, pasta argv, resolv.conf) are
// asserted on both sides, and the CLI is driven against a fake bwrap to prove the refusal paths:
// bad argv and a missing pasta both exit NOT_RUN with the reason on stderr and never run the command.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, defaultRouteIfaces, pastaArgs, resolvConf, DNS_FORWARD, NOT_RUN } from '../lib/sandbox-net.mjs';

const SELF = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'sandbox-net.mjs');
const BW = ['/usr/bin/bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4', '--', 'sh', '-c', 'true'];

describe('parseArgs', () => {
  test('accepts a bwrap argv carrying the three network-ordering flags', () => {
    assert.deepEqual(parseArgs(['--', ...BW]), { loopback: [], bwrap: BW });
    assert.equal(parseArgs(['--', 'bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4']).bwrap[0], 'bwrap');
  });
  test('parses --loopback ports', () => {
    assert.deepEqual(parseArgs(['--loopback', '8080,8443', '--', ...BW]).loopback, [8080, 8443]);
  });
  test('refuses a missing separator with usage', () => {
    assert.throws(() => parseArgs(['--loopback', '80']), /usage/);
  });
  test('refuses out-of-range, non-integer and empty loopback ports', () => {
    for (const bad of ['0', '65536', 'abc', '80,', '1.5', '-1']) {
      assert.throws(() => parseArgs(['--loopback', bad, '--', ...BW]), /ports 1-65535/, bad);
    }
  });
  test('refuses an unknown option and a --loopback with no value', () => {
    assert.throws(() => parseArgs(['--frob', '--', ...BW]), /unknown option "--frob"/);
    assert.throws(() => parseArgs(['--loopback', '--', ...BW]), /unknown option/);
  });
  test('refuses an argv that is not bwrap, or lacks each of --unshare-net/--info-fd 3/--block-fd 4', () => {
    const msg = /--unshare-net --info-fd 3 --block-fd 4/;
    assert.throws(() => parseArgs(['--', 'sh', '-c', 'x']), msg);
    assert.throws(() => parseArgs(['--']), msg);
    assert.throws(() => parseArgs(['--', '/usr/bin/bwrap', '--info-fd', '3', '--block-fd', '4']), msg);
    assert.throws(() => parseArgs(['--', '/usr/bin/bwrap', '--unshare-net', '--block-fd', '4']), msg);
    assert.throws(() => parseArgs(['--', '/usr/bin/bwrap', '--unshare-net', '--info-fd', '3']), msg);
    assert.throws(() => parseArgs(['--', '/usr/bin/bwrap', '--unshare-net', '--info-fd', '9', '--block-fd', '4']), msg);
    assert.throws(() => parseArgs(['--', '/usr/bin/notbwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4']), msg);
  });
});

describe('defaultRouteIfaces', () => {
  const hdr = 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\n';
  test('picks the up default route and skips lo, non-default and down routes', () => {
    const route = hdr
      + 'lo\t00000000\t0100007F\t0003\t0\t0\t0\t00000000\n'
      + 'docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\n'
      + 'eth9\t00000000\t0102A8C0\t0002\t0\t0\t0\t00000000\n'
      + 'eth0\t00000000\t0102A8C0\t0003\t0\t0\t0\t00000000\n';
    assert.equal(defaultRouteIfaces({ route }).v4, 'eth0');
  });
  test('reads the ipv6 default route and ignores a down one', () => {
    const z = '0'.repeat(32);
    const row = (flags) => `${z} 00 ${z} 00 ${'0'.repeat(31)}1 00000000 00000001 00000000 ${flags} ens3\n`;
    assert.equal(defaultRouteIfaces({ route6: row('00000003') }).v6, 'ens3');
    assert.equal(defaultRouteIfaces({ route6: row('00000002') }).v6, null);
  });
  test('absent or empty tables give null, not a guess', () => {
    assert.deepEqual(defaultRouteIfaces(), { v4: null, v6: null });
    assert.deepEqual(defaultRouteIfaces({ route: hdr }), { v4: null, v6: null });
  });
});

describe('pastaArgs', () => {
  const at = (a, f) => a[a.indexOf(f) + 1];
  test('forwards nothing in and nothing to host loopback unless declared', () => {
    const a = pastaArgs({ pid: 42, pidFile: '/t/p' });
    assert.equal(at(a, '--tcp-ports'), 'none');
    assert.equal(at(a, '--udp-ports'), 'none');
    assert.equal(at(a, '--tcp-ns'), 'none');
    assert.equal(at(a, '--udp-ns'), 'none');
    assert.ok(a.includes('--no-map-gw'));
    assert.equal(at(a, '--dns-forward'), DNS_FORWARD);
    assert.deepEqual(a.slice(-3), ['--pid', '/t/p', '42']);
    assert.ok(!a.includes('--outbound-if4') && !a.includes('--outbound-if6'));
  });
  test('declared loopback ports and outbound interfaces appear, and only then', () => {
    const a = pastaArgs({ pid: 7, loopback: [8080, 8443], v4: 'eth0', v6: 'ens3', pidFile: '/t/p' });
    assert.equal(at(a, '--tcp-ns'), '8080,8443');
    assert.equal(at(a, '--udp-ns'), 'none');
    assert.equal(at(a, '--outbound-if4'), 'eth0');
    assert.equal(at(a, '--outbound-if6'), 'ens3');
  });
});

describe('resolvConf', () => {
  test('replaces every host nameserver with the forwarded address, keeping search/domain/options', () => {
    const out = resolvConf('# c\nnameserver 127.0.0.53\nnameserver 8.8.8.8\nsearch corp.example\ndomain d.example\noptions edns0\n');
    assert.equal(out, `nameserver ${DNS_FORWARD}\nsearch corp.example\ndomain d.example\noptions edns0\n`);
    assert.ok(!/127\.0\.0\.53|8\.8\.8\.8/.test(out));
  });
  test('an empty host file still yields the forwarder', () => {
    assert.equal(resolvConf(''), `nameserver ${DNS_FORWARD}\n`);
    assert.equal(resolvConf(), `nameserver ${DNS_FORWARD}\n`);
  });
});

describe('the CLI refuses rather than falling back to the host network', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', timeout: 20000, env: { ...process.env, CW_SELF_SWEEP: '0', ...env } });

  test('bad argv exits NOT_RUN (125) with the reason on stderr', () => {
    assert.equal(NOT_RUN, 125);
    const r = run(['--loopback', '99999', '--', ...BW]);
    assert.equal(r.status, NOT_RUN);
    assert.match(r.stderr, /ports 1-65535/);
    const r2 = run(['--', 'sh', '-c', 'echo SHOULD-NOT-RUN']);
    assert.equal(r2.status, NOT_RUN);
    assert.ok(!r2.stdout.includes('SHOULD-NOT-RUN'));
  });

  test('with pasta absent the command never runs and the refusal names pasta/passt', { skip: process.platform === 'win32' && 'no POSIX sh for the fake bwrap' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-sbnet-'));
    try {
      const marker = join(dir, 'ran');
      const bwrap = join(dir, 'bwrap');
      // announces a child pid on fd 3, then holds at fd 4 like the real --block-fd; runs the "command" only if released
      writeFileSync(bwrap, `#!/bin/sh\necho '{"child-pid": 1}' >&3\nread x <&4 && touch '${marker}'\n`);
      chmodSync(bwrap, 0o755);
      const r = run(['--', bwrap, '--unshare-net', '--info-fd', '3', '--block-fd', '4'], { PATH: join(dir, 'empty') });
      assert.equal(r.status, NOT_RUN, r.stderr);
      assert.match(r.stderr, /pasta is not installed \(package passt\)/);
      assert.match(r.stderr, /never on the host network/);
      assert.ok(!existsSync(marker), 'the command was released without a network namespace');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a missing bwrap binary is a NOT_RUN refusal naming it', () => {
    const r = run(['--', '/nonexistent/dir/bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4']);
    assert.equal(r.status, NOT_RUN);
    assert.match(r.stderr, /\/nonexistent\/dir\/bwrap: ENOENT/);
  });
});
