// One bounded pull per image per sweep, recorded — never --pull=always per repo, never a hang.
// Docker is faked through CW_DOCKER (read at call time) so every branch runs without a daemon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { warmImages, manifestImages } from '../images.mjs';
import { fakeDocker } from './lib/fake-bin.mjs';

// Every invocation is appended to $FAKE_LOG so the test can assert what was asked.
// The fake is DESCRIBED, not scripted. These bodies were `#!/bin/sh` files made executable with
// chmod — neither of which does anything on Windows, so CW_DOCKER pointed at something the spawn
// could not run and every test below failed for one reason unrelated to what it asserts. bash is an
// optional install on this platform by standing instruction, so "require sh" was not an answer.
// ./lib/fake-bin.mjs emits the same described behaviour as sh or as cmd from a single source.
const withFake = (spec, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-images-'));
  const log = join(dir, 'calls.log');
  const prev = { d: process.env.CW_DOCKER, l: process.env.FAKE_LOG, s: process.env.CW_SETTINGS };
  process.env.FAKE_LOG = log;
  process.env.FAKE_DIR = dir;
  process.env.CW_DOCKER = fakeDocker(dir, spec);
  // The DOWN branch consults the operator's dockerRestartOnDown setting. Point the store at this
  // test's own (absent ⇒ defaults) path so a box whose REAL store says "restart" cannot make this
  // suite start a container runtime — the fixture isolation is load-bearing, not hygiene.
  process.env.CW_SETTINGS = join(dir, 'settings.json');
  try { return fn(() => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [])); }
  finally {
    if (prev.d === undefined) delete process.env.CW_DOCKER; else process.env.CW_DOCKER = prev.d;
    if (prev.l === undefined) delete process.env.FAKE_LOG; else process.env.FAKE_LOG = prev.l;
    if (prev.s === undefined) delete process.env.CW_SETTINGS; else process.env.CW_SETTINGS = prev.s;
  }
};

test('present image, pull ok, digest recorded — one pull per image, none per repo', () => {
  withFake({ digests: '["ghcr.io/x/y@sha256:abc123"]' }, (calls) => {
    const r = warmImages(['ghcr.io/x/y:latest', 'ghcr.io/x/y:latest']);
    assert.equal(r.docker, 'ok');
    const s = r.images['ghcr.io/x/y:latest'];
    assert.equal(s.presentBefore, true); assert.equal(s.pulled, true);
    assert.equal(s.digest, 'ghcr.io/x/y@sha256:abc123'); assert.equal(s.reason, null);
    // `docker pull …`: the shared fake logs `<binary> <args>`, which is what the restart suite's
    // fake always did. The claim is unchanged — exactly one pull for a duplicated image.
    assert.equal(calls().filter((c) => c.startsWith('docker pull ')).length, 1, 'duplicates in the list pull once');
  });
});

test('RepoDigests [] (locally built) → digest null WITH a reason, not a template crash', () => {
  withFake({ digests: '[]' }, () => {
    const s = warmImages(['local/thing:dev']).images['local/thing:dev'];
    assert.equal(s.pulled, true); assert.equal(s.digest, null);
    assert.match(s.reason, /no registry digest/);
  });
});

test('pull fails on an ABSENT image → recorded as not pulled, and says the lane will pull implicitly or skip', () => {
  withFake({ digests: null, pull: { exit: 1, stderr: 'Error: manifest unknown' } }, () => {
    const s = warmImages(['ghcr.io/x/missing:latest']).images['ghcr.io/x/missing:latest'];
    assert.equal(s.presentBefore, false); assert.equal(s.pulled, false); assert.equal(s.digest, null);
    assert.match(s.reason, /pull failed \(exit 1\): Error: manifest unknown/);
  });
});

test('a pull that hangs is killed at the bound and recorded as a timeout — the 8.9 h class', () => {
  withFake({ digests: '["r@sha256:old"]', pull: { sleepSec: 30 } }, () => {
    const t0 = Date.now();
    const s = warmImages(['ghcr.io/x/slow:latest'], { timeoutSec: 1 }).images['ghcr.io/x/slow:latest'];
    assert.ok(Date.now() - t0 < 10_000, 'bounded by the timeout, not by the pull');
    assert.equal(s.pulled, false);
    assert.match(s.reason, /pull exceeded 1s — running on the cached tag/);
    assert.equal(s.digest, 'r@sha256:old', 'the cached image is still named, so the batch knows what ran');
  });
});

test('docker absent → images null with reason; docker down → same, different reason; nothing invented', () => {
  const prev = process.env.CW_DOCKER;
  process.env.CW_DOCKER = '/nonexistent/docker-binary';
  try {
    const r = warmImages(['a:b']);
    assert.equal(r.docker, 'absent'); assert.equal(r.images, null); assert.match(r.reason, /not installed/);
  } finally { if (prev === undefined) delete process.env.CW_DOCKER; else process.env.CW_DOCKER = prev; }
  withFake({ info: 'down' }, () => {
    const r = warmImages(['a:b']);
    assert.equal(r.docker, 'down'); assert.equal(r.images, null); assert.match(r.reason, /docker info failed/);
  });
});

test('manifestImages unions across manifests and reports an unreadable one instead of skipping it', () => {
  const read = (n) => { if (n === 'broken') throw new Error('ENOENT broken.json'); return { images: n === 'a' ? ['x:1', 'y:1'] : ['y:1'] }; };
  const r = manifestImages(read, ['a', 'b', 'a', 'broken']);
  assert.deepEqual(r.images, ['x:1', 'y:1']);
  assert.equal(r.problems.length, 1); assert.match(r.problems[0], /broken/);
});

test('the bundled manifest declares every image its docker lanes run, and no lane pulls per repo', () => {
  const m = JSON.parse(readFileSync(new URL('../../manifests/security-baseline.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(m.images) && m.images.length >= 2);
  for (const c of m.checks) for (const l of c.local || []) {
    assert.ok(!/--pull=always/.test(l), `${c.id} still pulls per repo`);
    for (const tok of l.split(/\s+/)) if (/^ghcr\.io\/[a-z0-9._\-\/]+:[a-z0-9._\-]+$/.test(tok)) assert.ok(m.images.includes(tok), `${c.id} runs ${tok}, not in images[]`);
  }
});
