// Does the sandbox DO what its flags say? bin/test/sandbox.test.mjs asserts the flag list; this
// asserts the isolation those flags are supposed to produce, by running four throwaway containers.
//
// The distinction is the point. `docker run` accepting `--tmpfs /work:rw,exec,...` proves only that
// the option parsed — not that the mount is executable, which is the entire justification for the
// `instrument` posture existing separately from `analyse`. Every assertion below is paired with a
// control that must come out the other way, so a result of "blocked" cannot be produced by a
// container that simply failed to start.
//
// Skips, loudly, when docker is absent — a not-run isolation check must never read as a pass.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildSandbox } from '../lib/sandbox.mjs';

const IMAGE = 'alpine:latest';
const hasDocker = spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore', timeout: 10_000 }).status === 0;
const skip = hasDocker ? false : `docker or ${IMAGE} unavailable — isolation NOT verified on this host`;

const inSandbox = (posture, script, name) => {
  const { args } = buildSandbox({ posture, name });
  try {
    return execFileSync('docker', ['run', ...args, IMAGE, 'sh', '-c', script],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
  } catch (e) {
    return `ERR:${(e.stdout || '').trim()}${(e.stderr || '').trim()}`;
  }
};

describe('sandbox isolation, measured', { skip }, () => {
  test('instrument scratch EXECUTES — without this the sanitizer tier is impossible', () => {
    const out = inSandbox('instrument',
      'printf "#!/bin/sh\\necho RAN\\n" > /work/t.sh && chmod +x /work/t.sh && /work/t.sh', 'cw-eff-i');
    assert.equal(out, 'RAN', 'instrument scratch is not executable; the posture cannot run what it builds');
  });

  test('analyse scratch REFUSES to execute — the control that proves noexec is real', () => {
    const out = inSandbox('analyse',
      'printf "#!/bin/sh\\necho RAN\\n" > /tmp/t.sh && chmod +x /tmp/t.sh && /tmp/t.sh', 'cw-eff-a');
    assert.match(out, /Permission denied/,
      'analyse scratch executed a script; noexec is not in force and the two postures are not actually different');
  });

  // EGRESS PAIR. `analyse` must be BLOCKED and `boot` must REACH; the second is what proves the
  // first is isolation rather than a container that failed to start.
  //
  // The pair has a third possible cause that neither assertion can see: the HOST has no egress. On
  // 2026-09-01 the boot control went red once and did not reproduce in three re-runs, almost
  // certainly for that reason. Left alone, a control that reddens for a reason unrelated to what it
  // controls for gets dismissed as flake — and the next time it reddens for a REAL reason it is
  // dismissed too. The control decays into noise, which is worse than not having it.
  //
  // So host egress is probed FIRST, outside any sandbox. Retrying until green would be the wrong
  // repair: that converts a genuine isolation failure into a pass. Instead, when the host itself
  // cannot reach the target, the pair SKIPS with the reason stated and the BLOCKED assertion is
  // explicitly downgraded to unverified rather than silently trusted — explicit uncertainty, which is
  // the rule this file exists to enforce.
  const hostReaches = (() => {
    if (!hasDocker) return false;
    try {
      const out = execFileSync('docker', ['run', '--rm', IMAGE, 'sh', '-c',
        'wget -T8 -q -O- http://1.1.1.1 >/dev/null 2>&1 && echo REACHED || echo BLOCKED'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
      return out === 'REACHED';
    } catch { return false; }
  })();
  const noEgress = hostReaches ? false
    : 'this host cannot reach 1.1.1.1 from an unrestricted container — the egress pair is UNVERIFIED, '
      + 'not passing. Neither BLOCKED nor REACHED can be attributed to the sandbox from here.';

  test('analyse severs egress', { skip: noEgress }, () => {
    assert.equal(inSandbox('analyse',
      'wget -T3 -q -O- http://1.1.1.1 >/dev/null 2>&1 && echo REACHED || echo BLOCKED', 'cw-eff-n'), 'BLOCKED');
  });

  test('boot reaches the network — the control that proves BLOCKED above is isolation, not a dead container', { skip: noEgress }, () => {
    assert.equal(inSandbox('boot',
      'wget -T8 -q -O- http://1.1.1.1 >/dev/null 2>&1 && echo REACHED || echo BLOCKED', 'cw-eff-b'), 'REACHED',
    'boot could not reach the network either — the egress assertions above prove nothing about isolation');
  });

  test('every posture runs as a non-root uid where it declares one', () => {
    for (const posture of ['analyse', 'fetch', 'instrument']) {
      assert.equal(inSandbox(posture, 'id -u', `cw-eff-u-${posture}`), '1000',
        `${posture} did not run as uid 1000`);
    }
  });
});
