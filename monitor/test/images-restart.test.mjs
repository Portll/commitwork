// The restart-on-down control: a sweep may attempt to bring a DOWN daemon back, but only when the
// operator's dockerRestartOnDown setting says so, and the attempt is RECORDED whichever way it
// goes. Every binary (docker, colima, open, osascript) and the settings store are faked through
// call-time env overrides, so no test here can start a real runtime — the load-bearing cases are
// the refusal (default = do-not-restart), the second-witness re-probe (colima exiting 0 proves
// nothing; docker info is the witness), and ABSENT never consulting the setting at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { warmImages } from '../images.mjs';
import { fakeDocker, fakeSimple } from './lib/fake-bin.mjs';
import { setSettings, resetSettingsWarnings } from '../settings.mjs';

const ENV = ['CW_DOCKER', 'CW_COLIMA', 'CW_OPEN', 'CW_OSASCRIPT', 'CW_SETTINGS',
  'CW_DOCKER_RESTART_ON_DOWN', 'CW_DOCKER_RESTART_TIMEOUT_SEC', 'CW_DOCKER_RESTART_POLL_MS', 'FAKE_LOG', 'FAKE_DIR'];

// The fakes are DESCRIBED, not scripted — see ./lib/fake-bin.mjs. They were `#!/bin/sh` files made
// executable with chmod, and neither half of that does anything on Windows, so every binary this
// suite wires through env pointed at something the spawn could not execute. bash is an optional
// install on this platform by standing instruction, so requiring sh was not an answer; the same
// description is emitted as sh or as cmd from ONE source, which is what stops the two dialects
// drifting into asserting different things. FAKE_DIR still carries shared state between fakes.

/**
 * A world where docker is DOWN until something touches $FAKE_DIR/up. Fakes are wired through env,
 * the settings store points at this world's own path (absent ⇒ every setting is its default), and
 * everything is restored afterwards.
 */
function world(fn, { colima = { touchUp: true, exit: 0 } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-restart-'));
  const log = join(dir, 'calls.log');
  const saved = {};
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.FAKE_LOG = log;
  process.env.FAKE_DIR = dir;
  // info answers 0 only once $FAKE_DIR/up exists — that marker is how the re-probe can be a real
  // second witness rather than trusting `colima start`'s exit code.
  process.env.CW_DOCKER = fakeDocker(dir, { info: 'marker', digests: '["r@sha256:abc"]' });
  process.env.CW_COLIMA = fakeSimple(dir, 'colima', colima);
  process.env.CW_OSASCRIPT = fakeSimple(dir, 'osascript', { exit: 0 });
  process.env.CW_SETTINGS = join(dir, 'settings.json');
  resetSettingsWarnings();
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  try { return fn({ dir, calls }); }
  finally {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('DOWN under the default mode: nothing is started, and the refusal is recorded, not silent', () => {
  world(({ calls }) => {
    const r = warmImages(['a:b']);
    assert.equal(r.docker, 'down');
    assert.equal(r.images, null);
    assert.equal(r.restart.mode, 'do-not-restart');
    assert.equal(r.restart.attempted, false);
    assert.equal(r.restart.ok, null, 'an attempt that never happened has no verdict — null, not false');
    assert.match(r.restart.reason, /do not restart/);
    assert.ok(!calls().some((c) => c.startsWith('colima')), 'the runtime was never touched');
  });
});

test('mode=restart via env: colima starts the daemon, the re-probe confirms it, and the pull proceeds', () => {
  world(({ calls }) => {
    process.env.CW_DOCKER_RESTART_ON_DOWN = 'restart';
    const r = warmImages(['a:b']);
    assert.equal(r.docker, 'ok', 'a recovered daemon serves the sweep, not a degraded slice');
    assert.equal(r.restart.attempted, true);
    assert.equal(r.restart.method, 'colima');
    assert.equal(r.restart.ok, true);
    assert.equal(r.restart.modeSource, 'env');
    assert.equal(r.restart.notified, null, 'no popup was asked for, so none is claimed either way');
    assert.equal(r.images['a:b'].pulled, true, 'the pull loop ran against the restarted daemon');
    assert.ok(calls().some((c) => c.startsWith('colima start')));
  });
});

test('colima failing is recorded as a FAILED attempt with its exit named, and the slice stays down', () => {
  world(({ calls }) => {
    process.env.CW_DOCKER_RESTART_ON_DOWN = 'restart';
    const r = warmImages(['a:b']);
    assert.equal(r.docker, 'down');
    assert.equal(r.restart.ok, false);
    assert.match(r.restart.reason, /colima start failed \(exit 7\)/);
    assert.ok(calls().some((c) => c.startsWith('colima start')));
  }, { colima: { stderr: 'vm broke', exit: 7 } });
});

test('colima exiting 0 proves nothing — docker info is the witness, and its NO wins', () => {
  world(() => {
    process.env.CW_DOCKER_RESTART_ON_DOWN = 'restart';
    const r = warmImages(['a:b']);
    assert.equal(r.docker, 'down');
    assert.equal(r.restart.ok, false);
    assert.match(r.restart.reason, /exited 0 but docker info still fails/);
  }, { colima: { exit: 0 } });   // claims success, starts nothing
});

test('ABSENT never consults the setting: absence is a deployment choice, not an outage', () => {
  world(({ calls }) => {
    process.env.CW_DOCKER_RESTART_ON_DOWN = 'restart';
    process.env.CW_DOCKER = '/nonexistent/docker-binary';
    const r = warmImages(['a:b']);
    assert.equal(r.docker, 'absent');
    assert.equal('restart' in r, false, 'no restart record — there was nothing to restart');
    assert.ok(!calls().some((c) => c.startsWith('colima')));
  });
});

test('restart-popup notifies on FAILURE too, and records that the notification landed', () => {
  world(({ calls }) => {
    process.env.CW_DOCKER_RESTART_ON_DOWN = 'restart-popup';
    const r = warmImages(['a:b']);
    assert.equal(r.docker, 'down');
    if (process.platform === 'win32') {
      // The AppleScript argument carries double quotes, and a double quote cannot be passed to a
      // batch shim — the spawn guard REFUSES rather than escaping, which is the whole point of it.
      // That is also what a real Windows box sees, by a different route: osascript does not exist
      // there at all. So what is pinned HERE is that the failure is RECORDED with a reason, which
      // is the actual contract; the popup itself is a macOS affordance.
      assert.equal(r.restart.notified, false, 'a notification that could not be sent is not "sent"');
      assert.match(r.restart.notifyReason, /notification not sent|not found/,
        'and it says WHY — never a bare "exit null"');
    } else {
      assert.equal(r.restart.notified, true);
      const osa = calls().find((c) => c.startsWith('osascript'));
      assert.ok(osa && /FAILED/.test(osa), 'the popup names the outcome, not just the attempt');
    }
  }, { colima: { exit: 1 } });
});

test('the mode can come from the STORE — written through the real writer, read at call time', () => {
  world(({ calls }) => {
    const w = setSettings({ dockerRestartOnDown: 'restart' }, { who: 'test@images-restart' });
    assert.equal(w.ok, true, (w.errors || []).join('; '));
    const r = warmImages(['a:b']);
    assert.equal(r.docker, 'ok');
    assert.equal(r.restart.modeSource, 'store');
    assert.ok(calls().some((c) => c.startsWith('colima start')));
  });
});

// The Docker-app fallback only exists on macOS, so only macOS can execute it.
const darwinTest = process.platform === 'darwin' ? test : test.skip;
darwinTest('no colima on macOS: the Docker app is opened and the daemon is POLLED until it answers', () => {
  world(({ dir, calls }) => {
    process.env.CW_DOCKER_RESTART_ON_DOWN = 'restart';
    process.env.CW_COLIMA = '/nonexistent/colima-binary';
    process.env.CW_DOCKER_RESTART_POLL_MS = '25';
    process.env.CW_DOCKER_RESTART_TIMEOUT_SEC = '10';
    // `open -a Docker` returns before the daemon is up; the fake starts it "in the background" by
    // touching the up file, and only the poll loop can observe that.
    process.env.CW_OPEN = fakeSimple(dir, 'open', { touchUp: true, exit: 0 });
    const r = warmImages(['a:b']);
    assert.equal(r.docker, 'ok');
    assert.equal(r.restart.method, 'docker-app');
    assert.equal(r.restart.ok, true);
    assert.ok(calls().some((c) => c.startsWith('open -a Docker')));
  });
});
