// Returns the directory for docker config, creating it and a config.json if needed, unless DOCKER_CONFIG is already set (lib/docker-config.mjs useScopedDockerConfig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useScopedDockerConfig } from '../docker-config.mjs';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the inherited DOCKER_CONFIG value without creating files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'useScopedDockerConfig-'));
  const inherited = join(dir, 'inherited');
  const prev = process.env.DOCKER_CONFIG;
  const prevCw = process.env.CW_DOCKER_CONFIG;
  try {
    process.env.DOCKER_CONFIG = inherited;
    delete process.env.CW_DOCKER_CONFIG;
    const result = useScopedDockerConfig();
    assert.equal(result, inherited);
    assert.equal(process.env.DOCKER_CONFIG, inherited);
    assert.equal(existsSync(inherited), false);
  } finally {
    if (prev === undefined) delete process.env.DOCKER_CONFIG; else process.env.DOCKER_CONFIG = prev;
    if (prevCw === undefined) delete process.env.CW_DOCKER_CONFIG; else process.env.CW_DOCKER_CONFIG = prevCw;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates the config directory and config.json when DOCKER_CONFIG is unset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'useScopedDockerConfig-'));
  const target = join(dir, 'target');
  const prev = process.env.DOCKER_CONFIG;
  const prevCw = process.env.CW_DOCKER_CONFIG;
  try {
    delete process.env.DOCKER_CONFIG;
    process.env.CW_DOCKER_CONFIG = target;
    const result = useScopedDockerConfig();
    assert.equal(result, target);
    assert.equal(process.env.DOCKER_CONFIG, target);
    assert.equal(existsSync(target), true);
    const cfg = join(target, 'config.json');
    assert.equal(existsSync(cfg), true);
    assert.equal(readFileSync(cfg, 'utf8'), '{}\n');
  } finally {
    if (prev === undefined) delete process.env.DOCKER_CONFIG; else process.env.DOCKER_CONFIG = prev;
    if (prevCw === undefined) delete process.env.CW_DOCKER_CONFIG; else process.env.CW_DOCKER_CONFIG = prevCw;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not overwrite an existing config.json file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'useScopedDockerConfig-'));
  const target = join(dir, 'target');
  const prev = process.env.DOCKER_CONFIG;
  const prevCw = process.env.CW_DOCKER_CONFIG;
  try {
    delete process.env.DOCKER_CONFIG;
    process.env.CW_DOCKER_CONFIG = target;
    mkdirSync(target, { recursive: true });
    const cfg = join(target, 'config.json');
    writeFileSync(cfg, '{"credsStore":"desktop"}\n');
    const result = useScopedDockerConfig();
    assert.equal(result, target);
    assert.equal(readFileSync(cfg, 'utf8'), '{"credsStore":"desktop"}\n');
  } finally {
    if (prev === undefined) delete process.env.DOCKER_CONFIG; else process.env.DOCKER_CONFIG = prev;
    if (prevCw === undefined) delete process.env.CW_DOCKER_CONFIG; else process.env.CW_DOCKER_CONFIG = prevCw;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the default config path when CW_DOCKER_CONFIG is unset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'useScopedDockerConfig-'));
  const prev = process.env.DOCKER_CONFIG;
  const prevCw = process.env.CW_DOCKER_CONFIG;
  const prevHome = process.env.HOME;
  const prevUser = process.env.USERPROFILE;
  try {
    delete process.env.DOCKER_CONFIG;
    delete process.env.CW_DOCKER_CONFIG;
    process.env.HOME = dir;
    delete process.env.USERPROFILE;
    const result = useScopedDockerConfig();
    const expected = join(dir, '.config', 'commitwork', 'docker');
    assert.equal(result, expected);
    assert.equal(process.env.DOCKER_CONFIG, expected);
    assert.equal(existsSync(join(expected, 'config.json')), true);
  } finally {
    if (prev === undefined) delete process.env.DOCKER_CONFIG; else process.env.DOCKER_CONFIG = prev;
    if (prevCw === undefined) delete process.env.CW_DOCKER_CONFIG; else process.env.CW_DOCKER_CONFIG = prevCw;
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevUser === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUser;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the same directory on repeated calls without rewriting config.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'useScopedDockerConfig-'));
  const target = join(dir, 'target');
  const prev = process.env.DOCKER_CONFIG;
  const prevCw = process.env.CW_DOCKER_CONFIG;
  try {
    delete process.env.DOCKER_CONFIG;
    process.env.CW_DOCKER_CONFIG = target;
    const first = useScopedDockerConfig();
    const cfg = join(target, 'config.json');
    const mtimeBefore = readFileSync(cfg, 'utf8');
    const second = useScopedDockerConfig();
    assert.equal(first, target);
    assert.equal(second, target);
    assert.equal(readFileSync(cfg, 'utf8'), mtimeBefore);
  } finally {
    if (prev === undefined) delete process.env.DOCKER_CONFIG; else process.env.DOCKER_CONFIG = prev;
    if (prevCw === undefined) delete process.env.CW_DOCKER_CONFIG; else process.env.CW_DOCKER_CONFIG = prevCw;
    rmSync(dir, { recursive: true, force: true });
  }
});
