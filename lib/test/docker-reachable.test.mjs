import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dockerReachable, resolveDocker } from '../docker-reachable.mjs';

const fakeDocker = (script) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-fake-docker-'));
  writeFileSync(join(dir, 'docker'), `#!/bin/sh\n${script}\n`);
  chmodSync(join(dir, 'docker'), 0o755);
  return dir;
};
const scene = (script) => {
  const bin = fakeDocker(script);
  return { bin, env: { PATH: bin, CW_DOCKER_PROBE_CACHE: join(mkdtempSync(join(tmpdir(), 'cw-dr-')), 'cache.json') } };
};

test('a second call within the TTL is answered from the cache, not a second probe', () => {
  const { env } = scene('exit 0');
  let probes = 0;
  const probe = () => { probes++; return false; };
  assert.equal(dockerReachable({ env, now: 1_000, probe }), false);
  assert.equal(dockerReachable({ env, now: 30_000, probe }), false);
  assert.equal(probes, 1);
  assert.equal(dockerReachable({ env, now: 70_000, probe }), false, 'past the TTL');
  assert.equal(probes, 2);
});

test('a different docker binary is never answered from another binary\'s result', () => {
  const a = scene('exit 0');
  const b = { ...a.env, PATH: fakeDocker('exit 1') };
  assert.equal(dockerReachable({ env: a.env, now: 1_000, probe: () => true }), true);
  let probed = false;
  assert.equal(dockerReachable({ env: b, now: 2_000, probe: () => { probed = true; return false; } }), false);
  assert.equal(probed, true);
});

test('a malformed cache or a record from the future means probe again', () => {
  const { env } = scene('exit 0');
  writeFileSync(env.CW_DOCKER_PROBE_CACHE, '{ not json');
  let probes = 0;
  assert.equal(dockerReachable({ env, now: 1_000, probe: () => { probes++; return true; } }), true);
  assert.equal(dockerReachable({ env, now: 500, probe: () => { probes++; return true; } }), true);
  assert.equal(probes, 2);
});

test('no docker on PATH is unreachable without probing', () => {
  const env = { PATH: mkdtempSync(join(tmpdir(), 'cw-nodocker-')), CW_DOCKER_PROBE_CACHE: join(tmpdir(), `cw-dr-none-${process.pid}.json`) };
  assert.equal(resolveDocker(env), null);
  assert.equal(dockerReachable({ env, probe: () => { throw new Error('must not probe'); } }), false);
});

test('against a daemon that never answers, the first process pays the bound and the next pays nothing', () => {
  const { bin, env } = scene('sleep 30');
  const lib = fileURLToPath(new URL('../docker-reachable.mjs', import.meta.url));
  const run = () => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(lib)}).then((m) => process.stdout.write(String(m.dockerReachable())))`],
      { encoding: 'utf8', env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` }, timeout: 40_000 });
    return { out: r.stdout, ms: Date.now() - t0 };
  };
  const first = run();
  const second = run();
  assert.equal(first.out, 'false');
  assert.ok(first.ms >= 9_000, `first probe returned in ${first.ms}ms, so it did not wait for the bound`);
  assert.equal(second.out, 'false');
  assert.ok(second.ms < 5_000, `second process took ${second.ms}ms; the cached answer was not used`);
});
