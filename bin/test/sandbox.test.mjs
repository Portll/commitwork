// The shared sandbox primitive. Nothing here starts a container: the library is pure and the CLI
// only prints flags, so a test for an isolation guard structurally cannot execute anything — the
// same property bin/test for the preflight build guard insists on.
//
// The non-negotiable assertions iterate Object.keys(POSTURES) rather than naming postures, so a
// posture added later without --cap-drop ALL fails this file on arrival instead of inheriting a
// pass from a list nobody updated.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildSandbox, assertMountAllowed, shellQuote, POSTURES } from '../lib/sandbox.mjs';

const CLI = join(fileURLToPath(new URL('../..', import.meta.url)), 'bin/sandbox.mjs');
const pairOf = (args, flag) => args.reduce((acc, a, i) => (a === flag ? [...acc, args[i + 1]] : acc), []);

// ── HOST uid:gid, ON A PLATFORM THAT HAS NONE ───────────────────────────────────────────────────
//
// The `resolve` and `build-resolve` postures declare hostUser, and buildSandbox resolves the ids
// from the running process — refusing outright when the platform exposes none, because running the
// container as root instead would hand it more privilege than the posture declares. That refusal is
// CORRECT and stays untouched. Windows exposes no getuid/getgid, so on this platform it fired for
// every one of those postures' assertions: 18 tests about --cap-drop, --pids-limit, --memory,
// egress env and mount refusal, none of which concern uid, all dead at the same line.
//
// So the platform truth is asserted FIRST, while it is still true — that is a real Windows contract
// nothing was covering — and only then are the two accessors stubbed for the rest of this file, so
// the spec construction those 18 tests actually check can be exercised. Stubbing after the fact
// cannot weaken the guarantee: `buildSandbox` accepts no user option at all (its own test below
// pins that), so there is no path by which a caller reaches --user, stub or no stub.
const HAS_HOST_IDS = typeof process.getuid === 'function' && typeof process.getgid === 'function';

// Captured before the stub, because afterwards this platform is indistinguishable from POSIX.
const refusalWithoutIds = HAS_HOST_IDS ? null : (() => {
  const hostUserPosture = Object.keys(POSTURES).find((p) => POSTURES[p].hostUser);
  if (!hostUserPosture) return 'NO_HOSTUSER_POSTURE';
  try {
    buildSandbox({
      posture: hostUserPosture,
      name: 'cw-t',
      ...(POSTURES[hostUserPosture].requiresEgressProxy
        ? { egressNetwork: 'cw-t-net', egressProxy: 'http://cw-t-proxy:3128' } : {}),
    });
    return 'DID_NOT_REFUSE';
  } catch (e) { return e.message; }
})();

test('a platform with no host uid:gid is REFUSED, never silently run as root', { skip: HAS_HOST_IDS && 'this platform exposes getuid/getgid' }, () => {
  assert.notEqual(refusalWithoutIds, 'NO_HOSTUSER_POSTURE',
    'no posture declares hostUser any more — drop this test rather than letting it pass vacuously');
  assert.notEqual(refusalWithoutIds, 'DID_NOT_REFUSE',
    'a hostUser posture built a spec on a platform with no uid:gid — the container would run as '
    + 'root with more privilege than the posture declares');
  assert.match(refusalWithoutIds, /requires the host uid:gid/);
  assert.match(refusalWithoutIds, /more privilege than the posture declares/,
    'the refusal must say WHY, or the next reader relaxes it');
});

if (!HAS_HOST_IDS) {
  // Not root (0): a stub of 0 would trip the genuine root warning and assert about a state this
  // machine is not in. 1000 is an ordinary unprivileged id.
  process.getuid = () => 1000;
  process.getgid = () => 1000;
}

/**
 * The minimal VALID spec for a posture, DERIVED from what the posture declares it requires.
 *
 * The loop below deliberately iterates Object.keys(POSTURES) so a posture added later cannot
 * inherit a pass from a list nobody updated — and `build-resolve` promptly failed all four
 * invariants on arrival, because it refuses to emit flags without an egress proxy. That is the
 * loop working, not breaking: the posture's requirement is real and the fix is to satisfy it here,
 * derived from `requiresEgressProxy` rather than from a hardcoded name, so the next posture with a
 * new requirement fails on arrival too.
 */
const minimalSpec = (posture, extra = {}) => ({
  posture,
  name: 'cw-t',
  ...(POSTURES[posture].requiresEgressProxy ? { egressNetwork: 'cw-t-net', egressProxy: 'http://cw-t-proxy:3128' } : {}),
  ...extra,
});

describe('invariants that hold in EVERY declared posture', () => {
  const names = Object.keys(POSTURES);
  assert.ok(names.length >= 2, 'fewer than two postures declared — the comparisons below would be vacuous');

  for (const posture of names) {
    test(`${posture}: drops all capabilities and forbids privilege escalation`, () => {
      const { args } = buildSandbox(minimalSpec(posture));
      assert.deepEqual(pairOf(args, '--cap-drop'), ['ALL']);
      assert.deepEqual(pairOf(args, '--security-opt'), ['no-new-privileges']);
    });

    test(`${posture}: is reapable and self-removing`, () => {
      const { args } = buildSandbox(minimalSpec(posture));
      assert.deepEqual(pairOf(args, '--name'), ['cw-t'], 'no --name: a timeout has nothing to reap by');
      assert.ok(args.includes('--rm'));
    });

    test(`${posture}: bounds pids and memory — a fuzzer fork-bombs and OOMs by design`, () => {
      const { args } = buildSandbox(minimalSpec(posture));
      assert.equal(pairOf(args, '--pids-limit').length, 1);
      assert.equal(pairOf(args, '--memory').length, 1);
      assert.ok(Number(pairOf(args, '--pids-limit')[0]) > 0);
    });

    test(`${posture}: refuses the docker socket regardless of posture`, () => {
      assert.throws(
        () => buildSandbox(minimalSpec(posture, { mounts: [{ host: '/var/run/docker.sock', path: '/x' }] })),
        /host-equivalent/);
    });
  }
});

describe('postures differ where they claim to', () => {
  test('analyse severs egress; boot does not, and says why', () => {
    const a = buildSandbox({ posture: 'analyse', name: 'cw-t' }).args;
    const b = buildSandbox({ posture: 'boot', name: 'cw-t' }).args;
    assert.deepEqual(pairOf(a, '--network'), ['none']);
    assert.deepEqual(pairOf(b, '--network'), [], 'boot must not claim --network none it does not have');
    assert.match(POSTURES.boot.why, /egress|NOT for hostile/);
  });

  test('analyse scratch is noexec; instrument scratch must be exec-able or the tier is impossible', () => {
    const a = pairOf(buildSandbox({ posture: 'analyse', name: 'cw-t' }).args, '--tmpfs')[0];
    const i = pairOf(buildSandbox({ posture: 'instrument', name: 'cw-t' }).args, '--tmpfs')[0];
    assert.match(a, /noexec/);
    assert.doesNotMatch(i, /noexec/, 'a sanitizer must execute the binary it just built');
    assert.match(i, /exec/);
  });

  test('instrument denies egress where boot allows it — that is the whole difference', () => {
    assert.equal(POSTURES.instrument.network, 'none');
    assert.equal(POSTURES.boot.network, 'bridge');
  });

  test('lookup differs from analyse ONLY in egress — everything else stays hardened', () => {
    const strip = (a) => { const o = [...a]; const i = o.indexOf('--network'); if (i > -1) o.splice(i, 2); return o; };
    const a = strip(buildSandbox({ posture: 'analyse', name: 'cw-t' }).args);
    const l = strip(buildSandbox({ posture: 'lookup', name: 'cw-t' }).args);
    const drop = (x) => x.filter((_, i, arr) => !['--pids-limit', '--memory', '--tmpfs'].includes(arr[i - 1])
      && !['--pids-limit', '--memory', '--tmpfs'].includes(x[i]));
    assert.deepEqual(drop(l), drop(a),
      'lookup relaxed something other than egress — it exists to allow an advisory API call, nothing else');
    assert.deepEqual(pairOf(buildSandbox({ posture: 'lookup', name: 'cw-t' }).args, '--network'), [],
      'lookup must NOT sever egress; osv-scanner and GuardDog cannot reach their APIs without it');
  });

  test('lookup mounts source where fetch refuses it — parsing is not executing', () => {
    const m = [{ host: '/repo', path: '/src', source: true }];
    assert.doesNotThrow(() => buildSandbox({ posture: 'lookup', name: 'cw-t', mounts: m }));
    assert.throws(() => buildSandbox({ posture: 'fetch', name: 'cw-t', mounts: m }), /forbids mounting repo source/);
  });

  test('fetch may reach the network, so it refuses to mount repo source', () => {
    assert.equal(POSTURES.fetch.network, 'bridge');
    assert.throws(
      () => buildSandbox({ posture: 'fetch', name: 'cw-t', mounts: [{ host: '/repo', path: '/src', source: true }] }),
      /forbids mounting repo source/);
    // control: the same mount is fine on a posture that severs egress
    assert.doesNotThrow(
      () => buildSandbox({ posture: 'analyse', name: 'cw-t', mounts: [{ host: '/repo', path: '/src', source: true }] }));
  });
});

describe('refusals — fail closed', () => {
  test('an unknown posture throws rather than guessing an isolation level', () => {
    assert.throws(() => buildSandbox({ posture: 'sorta-safe', name: 'cw-t' }), /unknown posture/);
    assert.throws(() => buildSandbox({ name: 'cw-t' }), /unknown posture/);
  });

  test('a missing or malformed container name throws', () => {
    assert.throws(() => buildSandbox({ posture: 'analyse' }), /container name is REQUIRED/);
    assert.throws(() => buildSandbox({ posture: 'analyse', name: 'has space' }), /container name is REQUIRED/);
  });

  test('credential directories and system paths are refused wherever they appear', () => {
    for (const bad of ['/Users/x/.ssh', '/Users/x/.aws/credentials', '/Users/x/Library/Keychains',
      '/etc', '/etc/shadow', '/', '/proc', '/Users/x/.docker/config.json']) {
      assert.throws(() => assertMountAllowed(bad), /refusing to mount/, `${bad} was allowed`);
    }
    // control — an ordinary repo path is allowed, so the assertions above are not vacuous
    assert.ok(assertMountAllowed('/Users/x/Repositories/thing'));
  });

  test('a writable SOURCE mount is refused — a scanner that can rewrite its subject invalidates its evidence', () => {
    assert.throws(
      () => buildSandbox({ posture: 'analyse', name: 'cw-t', mounts: [{ host: '/repo', path: '/src', mode: 'rw', source: true }] }),
      /WRITABLE source mount/);
  });

  test('mounts default to read-only when no mode is given', () => {
    const { args } = buildSandbox({ posture: 'analyse', name: 'cw-t', mounts: [{ host: '/repo', path: '/src' }] });
    assert.deepEqual(pairOf(args, '-v'), ['/repo:/src:ro']);
  });
});

describe('opening egress is possible but never silent', () => {
  test('allowNetwork drops --network none AND returns a warning the caller must print', () => {
    const { args, warnings } = buildSandbox({ posture: 'analyse', name: 'cw-t', allowNetwork: true });
    assert.deepEqual(pairOf(args, '--network'), []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /un-sandboxed|exfiltrate/);
  });

  test('without the flag there is no warning and egress stays severed', () => {
    const { args, warnings } = buildSandbox({ posture: 'analyse', name: 'cw-t' });
    assert.deepEqual(warnings, []);
    assert.deepEqual(pairOf(args, '--network'), ['none']);
  });
});

describe('the CLI is a thin shell, not a second implementation', () => {
  const cli = (args) => {
    try { return { out: execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), code: 0 }; }
    catch (e) { return { out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status }; }
  };

  test('--json output is byte-identical to the library for the same spec', () => {
    const spec = { posture: 'analyse', name: 'cw-t', mounts: [{ host: '/repo', path: '/src', mode: 'ro', source: true }] };
    const { out, code } = cli(['--posture', 'analyse', '--name', 'cw-t', '--mount-source', '/repo:/src:ro', '--json']);
    assert.equal(code, 0, out);
    assert.deepEqual(JSON.parse(out), buildSandbox(spec).args,
      'the CLI derives its own flags — it must call buildSandbox, or the two drift the way sweep.mjs --exclude did');
  });

  test('a refusal exits 2 with the reason, never a weaker fallback', () => {
    const { out, code } = cli(['--posture', 'nope', '--name', 'cw-t']);
    assert.equal(code, 2);
    assert.match(out, /unknown posture/);
  });

  test('shellQuote survives paths with spaces', () => {
    assert.equal(shellQuote(['-v', '/a b/c:/src:ro']), `-v '/a b/c:/src:ro'`);
    assert.equal(shellQuote(['--rm']), '--rm');
  });

  test('--keep-container omits --rm and KEEPS the name — a kept container must stay reapable', () => {
    const { out, code } = cli(['--posture', 'boot', '--name', 'cw-boot', '--keep-container']);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /--rm/);
    assert.match(out, /--name cw-boot/);
  });
});

describe('posture `resolve` — network on, host uid, no source', () => {
  test('it runs as the HOST uid:gid, resolved by the sandbox and never passed in', () => {
    const { args } = buildSandbox({ posture: 'resolve', name: 'cw-r', mounts: [{ host: '/w', path: '/work', mode: 'rw' }] });
    const i = args.indexOf('--user');
    assert.ok(i > -1, 'resolve must pin a user');
    assert.equal(args[i + 1], `${process.getuid()}:${process.getgid()}`,
      'a fixed container uid leaves the lockfile owned by 1000 and unreadable by the operator who mounted the scratch dir');
  });

  test('there is NO caller-supplied --user escape — buildSandbox takes no such option', () => {
    // Passing one is inert: the posture's own hostUser resolution is the only source of --user.
    const { args } = buildSandbox({ posture: 'resolve', name: 'cw-r', user: '0:0' });
    assert.equal(args.filter((a) => a === '--user').length, 1, 'an arbitrary --user would be a hole in the one reviewable place');
    assert.equal(args[args.indexOf('--user') + 1], `${process.getuid()}:${process.getgid()}`);
  });

  test('egress is open, because resolution IS the registry conversation', () => {
    const { args } = buildSandbox({ posture: 'resolve', name: 'cw-r' });
    assert.equal(args.includes('--network'), false, 'no --network none');
  });

  test('and BECAUSE egress is open it refuses a source mount, exactly like `fetch`', () => {
    assert.throws(
      () => buildSandbox({ posture: 'resolve', name: 'cw-r', mounts: [{ host: '/repo', path: '/src', mode: 'ro', source: true }] }),
      /forbids mounting repo source/,
    );
  });

  test('caps are still dropped and privilege escalation still blocked', () => {
    const { args } = buildSandbox({ posture: 'resolve', name: 'cw-r' });
    assert.ok(args.includes('--cap-drop') && args.includes('ALL'));
    assert.ok(args.includes('no-new-privileges'));
  });
});

describe('posture `build-resolve` — the only control is the size of the reachable set', () => {
  const base = { posture: 'build-resolve', name: 'cw-jvm' };

  test('it REFUSES to emit flags without both an egress network and a proxy', () => {
    assert.throws(() => buildSandbox(base), /requires BOTH egressNetwork and egressProxy/);
    assert.throws(() => buildSandbox({ ...base, egressProxy: 'http://p:3128' }), /requires BOTH/);
    assert.throws(() => buildSandbox({ ...base, egressNetwork: 'n' }), /requires BOTH/);
  });

  test('with both, it joins the private network and sets proxy env in EVERY casing', () => {
    const { args } = buildSandbox({ ...base, egressNetwork: 'cw-net', egressProxy: 'http://p:3128' });
    assert.ok(args.includes('--network') && args[args.indexOf('--network') + 1] === 'cw-net');
    for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']) {
      assert.ok(args.includes(`${k}=http://p:3128`), `${k} unset — setting one casing and not the other is a silent bypass`);
    }
  });

  test('NO_PROXY is emptied — an exemption list is the hole the proxy exists to close', () => {
    const { args } = buildSandbox({ ...base, egressNetwork: 'n', egressProxy: 'http://p:3128' });
    assert.ok(args.includes('no_proxy=') && args.includes('NO_PROXY='));
  });

  test('allowNetwork is refused here — egress is already open and bounded by the proxy, not a flag', () => {
    assert.throws(
      () => buildSandbox({ ...base, egressNetwork: 'n', egressProxy: 'http://p:3128', allowNetwork: true }),
      /meaningless/,
    );
  });

  test('it still drops all capabilities — the container runs code nobody has read', () => {
    const { args } = buildSandbox({ ...base, egressNetwork: 'n', egressProxy: 'http://p:3128' });
    assert.ok(args.includes('--cap-drop') && args.includes('ALL'));
    assert.ok(args.includes('no-new-privileges'));
  });

  test('a WRITABLE source mount is refused — the repo must not be resolvable into', () => {
    assert.throws(
      () => buildSandbox({
        ...base, egressNetwork: 'n', egressProxy: 'http://p:3128',
        mounts: [{ host: '/repo', path: '/src', mode: 'rw', source: true }],
      }),
      /WRITABLE source mount/,
    );
  });

  test('an egress proxy on a posture that does not enforce one is refused, not ignored', () => {
    assert.throws(
      () => buildSandbox({ posture: 'analyse', name: 'x', egressProxy: 'http://p:3128', egressNetwork: 'n' }),
      /does not declare requiresEgressProxy/,
    );
  });

  test('it warns, loudly, that it runs unread code', () => {
    const { warnings } = buildSandbox({ ...base, egressNetwork: 'n', egressProxy: 'http://p:3128' });
    assert.ok(warnings.some((w) => /repo-authored build logic/.test(w)));
  });
});
