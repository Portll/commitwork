// bin/tls-proxy.sh — what may reach docker's argv, and what "up" is allowed to mean.
// Everything runs against a fake docker on PATH: the assertions are about the argv the script
// constructs and the order in which it acts, neither of which needs a container to observe.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('../tls-proxy.sh', import.meta.url));

let dir, log;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-tlsproxy-'));
  log = path.join(dir, 'argv.log');
  // Fake docker: records every invocation, then answers plausibly. `ps` must print an id or the
  // script's liveness loop would treat the container as dead.
  fs.writeFileSync(path.join(dir, 'docker'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
case "$1" in
  ps)   echo deadbeef ;;
  run)  echo deadbeef ;;
  logs) ;;
  rm)   ;;
esac
exit 0
`, { mode: 0o755 });
  // Fake curl: the port probe succeeds immediately, so the happy path doesn't spend 10s waiting.
  fs.writeFileSync(path.join(dir, 'curl'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const sh = (args, env = {}) => {
  fs.writeFileSync(log, '');
  return run('bash', [SCRIPT, ...args], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CW_UPSTREAM: '', CW_TARGET_URL: '', ...env },
  }).then(
    (r) => ({ code: 0, ...r }),
    (e) => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }),
  );
};
const argv = () => fs.readFileSync(log, 'utf8');

describe('tls-proxy — credentials never reach argv', () => {
  test('userinfo is stripped before the upstream is passed to docker', async () => {
    const r = await sh(['up'], { CW_TARGET_URL: 'http://svc-account:s3cr3t-p4ss@internal.example/health' });
    assert.equal(r.code, 0, r.stderr);
    const a = argv();
    assert.ok(!a.includes('s3cr3t-p4ss'), `password reached docker argv:\n${a}`);
    assert.ok(!a.includes('svc-account'), `username reached docker argv:\n${a}`);
    assert.ok(a.includes('--to internal.example:80'), `upstream lost or mangled:\n${a}`);
  });

  test('nor to stdout, which the CI log keeps forever', async () => {
    const r = await sh(['up'], { CW_TARGET_URL: 'http://u:leaked-here@example.test/' });
    assert.ok(!`${r.stdout}${r.stderr}`.includes('leaked-here'), 'credential printed to the operator log');
  });

  test('a URL with no userinfo is untouched — the strip must not eat the host', async () => {
    await sh(['up'], { CW_TARGET_URL: 'http://plain.example:9000/' });
    assert.ok(argv().includes('--to plain.example:9000'));
  });

  test('loopback is still rewritten for the container, and the port survives', async () => {
    await sh(['up'], { CW_TARGET_URL: 'http://127.0.0.1:8080/' });
    assert.ok(argv().includes('--to host.docker.internal:8080'));
  });
});

describe('tls-proxy — refuses to grade its own certificate', () => {
  test('an https target is refused, and no container is started', async () => {
    const r = await sh(['up'], { CW_TARGET_URL: 'https://real.example/' });
    assert.equal(r.code, 3, 'must fail, not warn — a wrong TLS grade reads exactly like a right one');
    assert.ok(/already serves TLS/.test(r.stderr));
    assert.ok(!/ run /.test(argv()), `started a proxy in front of a real TLS edge:\n${argv()}`);
  });

  test('CW_UPSTREAM stays an explicit plaintext override and is not second-guessed', async () => {
    const r = await sh(['up'], { CW_UPSTREAM: 'host.docker.internal:8080' });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(argv().includes('--to host.docker.internal:8080'));
  });
});

describe('tls-proxy — acts only after it has decided to act', () => {
  test('`up` with no upstream tears nothing down', async () => {
    const r = await sh(['up']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /skipped: no upstream/);
    assert.equal(argv().trim(), '', `reported a no-op while destroying a container:\n${argv()}`);
  });

  test('`down` still removes the container', async () => {
    const r = await sh(['down']);
    assert.equal(r.code, 0);
    assert.match(argv(), /^rm -f commitwork-tls-proxy-/m);
  });

  test('an unknown verb is a usage error, not a listening proxy', async () => {
    for (const verb of ['--help', 'sttaus', 'restart']) {
      const r = await sh([verb]);
      assert.equal(r.code, 2, `\`${verb}\` was accepted`);
      assert.equal(argv().trim(), '', `\`${verb}\` reached docker`);
    }
  });
});

describe('tls-proxy — the cert covers a name, and the container belongs to an area', () => {
  test('--from carries a hostname, so the cert is not one shared loopback cert', async () => {
    await sh(['up'], { CW_UPSTREAM: 'x:80' });
    assert.ok(argv().includes('--from https://localhost:8444'), argv());
    assert.ok(!argv().includes('--from :8444'), 'empty host mints an identical cert for every project');
  });

  test('a declared hostname is used for the cert AND for the URL the operator is told to scan', async () => {
    const r = await sh(['up'], { CW_UPSTREAM: 'x:80', CW_TLS_HOSTNAME: 'app.internal' });
    assert.ok(argv().includes('--from https://app.internal:8444'));
    assert.match(r.stdout, /CW_TLS_URL=https:\/\/app\.internal:8444/,
      'the scanner must be sent to the name on the certificate');
  });

  test('the container name is area-scoped, so one area cannot kill another area scan', async () => {
    await sh(['down'], { CW_AREA_SLUG: 'alpha' });
    assert.match(argv(), /commitwork-tls-proxy-alpha/);
    await sh(['down'], { CW_AREA_SLUG: 'beta' });
    assert.match(argv(), /commitwork-tls-proxy-beta/);
  });
});

describe('tls-proxy — "up" means listening', () => {
  test('with no probe available, the report says UNVERIFIED rather than up', async () => {
    // A PATH holding only a fake docker. bash runs by absolute path and the no-probe branch needs
    // builtins alone. Not /bin: on merged-/usr Linux it is /usr/bin, and curl is there.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-nocurl-'));
    fs.writeFileSync(path.join(bare, 'docker'), '#!/bin/bash\ncase "$1" in run) echo deadbeef ;; esac\nexit 0\n', { mode: 0o755 });
    const r = await run('/bin/bash', [SCRIPT, 'up'], {
      env: { PATH: bare, CW_UPSTREAM: 'x:80', CW_TARGET_URL: '' },
    }).catch((e) => e);
    fs.rmSync(bare, { recursive: true, force: true });
    assert.match(r.stdout || '', /UNVERIFIED/, 'unconfirmed must not read the same as confirmed');
    assert.doesNotMatch(r.stdout || '', /verified listening/);
  });

  test('a confirmed probe says so explicitly', async () => {
    const r = await sh(['up'], { CW_UPSTREAM: 'x:80' });
    assert.match(r.stdout, /verified listening/);
  });

  test('the probe resolves the declared name itself, so a proxy is not blamed for host DNS', async () => {
    // a probe trusting host DNS blamed a working proxy for a missing /etc/hosts entry
    const curlLog = path.join(dir, 'curl.log');
    fs.writeFileSync(path.join(dir, 'curl'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(curlLog)}
exit 0
`, { mode: 0o755 });
    fs.writeFileSync(curlLog, '');
    const r = await sh(['up'], { CW_UPSTREAM: 'x:80', CW_TLS_HOSTNAME: 'app.internal' });
    fs.writeFileSync(path.join(dir, 'curl'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    assert.equal(r.code, 0, r.stderr);
    assert.match(fs.readFileSync(curlLog, 'utf8'), /--resolve app\.internal:8444:127\.0\.0\.1/);
  });
});
