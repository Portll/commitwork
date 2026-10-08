// The scoped docker config, whose whole job is a side effect on process.env that nothing else
// observes. A wiring mistake here is silent: the scan still runs, still reports, and only differs
// by raising a macOS prompt on a machine nobody is watching.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { dockerConfigDir, useScopedDockerConfig } from '../docker-config.mjs';

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('CW_DOCKER_CONFIG is read at CALL time, not at module load', () => {
  // A `const` captured at import would make this pass for the first caller and silently ignore
  // every later override — the shape that lets a test set an override and prove nothing.
  const a = mkdtempSync(join(tmpdir(), 'cw-dc-a-'));
  const b = mkdtempSync(join(tmpdir(), 'cw-dc-b-'));
  withEnv({ CW_DOCKER_CONFIG: a }, () => assert.equal(dockerConfigDir(), a));
  withEnv({ CW_DOCKER_CONFIG: b }, () => assert.equal(dockerConfigDir(), b));
});

test('the default is not the operator\'s own ~/.docker', () => {
  // ~/.docker is where credsStore: desktop lives. Defaulting to it would satisfy every other
  // assertion in this file while restoring exactly the behaviour the module exists to avoid.
  withEnv({ CW_DOCKER_CONFIG: undefined }, () => {
    assert.notEqual(dockerConfigDir(), join(homedir(), '.docker'));
  });
});

test('an inherited DOCKER_CONFIG wins and is returned unchanged', () => {
  // A caller that exported one has chosen a registry identity. Overriding it would turn an
  // authenticated scan into an anonymous one, which reports FEWER findings — a quieter result
  // that reads as a cleaner one.
  const theirs = mkdtempSync(join(tmpdir(), 'cw-dc-theirs-'));
  withEnv({ DOCKER_CONFIG: theirs, CW_DOCKER_CONFIG: mkdtempSync(join(tmpdir(), 'cw-dc-ours-')) }, () => {
    assert.equal(useScopedDockerConfig(), theirs);
    assert.equal(process.env.DOCKER_CONFIG, theirs);
  });
});

test('it creates a config with NO credsStore, and exports it for children', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'cw-dc-new-')), 'nested');
  withEnv({ DOCKER_CONFIG: undefined, CW_DOCKER_CONFIG: dir }, () => {
    assert.equal(useScopedDockerConfig(), dir);
    assert.equal(process.env.DOCKER_CONFIG, dir, 'children inherit env, so the export IS the mechanism');
    const cfg = join(dir, 'config.json');
    assert.ok(existsSync(cfg), 'no config written');
    const parsed = JSON.parse(readFileSync(cfg, 'utf8'));
    // Assert the absence that matters, not merely that the file parses: a config carrying
    // credsStore would satisfy "exists and is valid JSON" and still exec the helper.
    assert.equal(parsed.credsStore, undefined, `credsStore must be absent, got ${parsed.credsStore}`);
    assert.equal(statSync(dir).mode & 0o077, 0, 'the directory is group/other readable');
  });
});

test('it does not overwrite a config that is already there', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-dc-keep-'));
  withEnv({ DOCKER_CONFIG: undefined, CW_DOCKER_CONFIG: dir }, () => {
    useScopedDockerConfig();
    const first = readFileSync(join(dir, 'config.json'), 'utf8');
    delete process.env.DOCKER_CONFIG;
    useScopedDockerConfig();
    assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), first);
  });
});
