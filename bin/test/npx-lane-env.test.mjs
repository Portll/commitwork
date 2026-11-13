// An npx lane (threat model R6) fetches its tool from the registry the operator chose, with npm
// config only commitwork's, and never runs a copy the scanned tree ships. Unit checks on the env,
// a guard that every npx command in a manifest passes the prefix, and a live npm run against a
// hostile tree that skips with the reason where npx is absent. No network is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { laneEnv, npxEnv, fetchesWithNpx, NPX_PREFIX, DEFAULT_NPM_REGISTRY } from '../lib/scanner-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NPX_LANE = { id: 'fetches-it', egress: 'registry', requires: { tools: ['npx'] } };
const HOSTILE = {
  PATH: '/usr/bin', HOME: '/h', TMPDIR: '/t', HTTPS_PROXY: 'http://proxy:3128', npm_config_cache: '/h/.npm',
  GH_TOKEN: 'g', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's', NPM_TOKEN: 'n', CW_SANDBOX: 'off',
  npm_config_registry: 'http://evil.invalid/', npm_config_userconfig: '/h/.npmrc', NPM_CONFIG_GLOBALCONFIG: '/etc/npmrc',
};

test('an npx lane gets the allowlist, the default registry and npm config inside the prefix', () => {
  const env = laneEnv(NPX_LANE, HOSTILE);
  for (const k of ['GH_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'NPM_TOKEN', 'CW_SANDBOX', 'NPM_CONFIG_GLOBALCONFIG']) assert.equal(env[k], undefined, `${k} reached an npx lane`);
  for (const k of ['PATH', 'HOME', 'TMPDIR', 'HTTPS_PROXY', 'npm_config_cache']) assert.equal(env[k], HOSTILE[k], `${k} was dropped`);
  assert.equal(env.npm_config_registry, DEFAULT_NPM_REGISTRY);
  assert.equal(env.CW_NPX_PREFIX, NPX_PREFIX);
  assert.notEqual(env.npm_config_userconfig, env.npm_config_globalconfig, 'npm refuses one file as both');
  for (const k of ['npm_config_userconfig', 'npm_config_globalconfig']) assert.equal(dirname(env[k]), NPX_PREFIX, k);
});

test('the operator chooses the registry through CW_NPM_REGISTRY; the tree cannot', () => {
  assert.equal(laneEnv(NPX_LANE, { ...HOSTILE, CW_NPM_REGISTRY: 'https://mirror.example/npm/' }).npm_config_registry, 'https://mirror.example/npm/');
  assert.equal(npxEnv({ CW_NPM_REGISTRY: '' }).npm_config_registry, DEFAULT_NPM_REGISTRY);
});

test('a lane that does not run npx keeps the denylist env and gets no npx config', () => {
  assert.equal(fetchesWithNpx({ requires: { tools: ['semgrep'] } }), false);
  const env = laneEnv({ id: 'reads-it', requires: { tools: ['semgrep'] } }, HOSTILE);
  // Neither name is on the allowlist, so both surviving shows the denylist branch ran.
  assert.equal(env.NPM_CONFIG_GLOBALCONFIG, HOSTILE.NPM_CONFIG_GLOBALCONFIG);
  assert.equal(env.npm_config_registry, HOSTILE.npm_config_registry);
  assert.equal(env.CW_NPX_PREFIX, undefined);
});

test('the prefix holds only a comment-only .npmrc, and the config files the env names are absent', () => {
  assert.deepEqual(readdirSync(NPX_PREFIX), ['.npmrc']);
  const settings = readFileSync(join(NPX_PREFIX, '.npmrc'), 'utf8').split('\n').filter((l) => l.trim() && !/^\s*[;#]/.test(l));
  assert.deepEqual(settings, [], 'the prefix .npmrc sets nothing');
  const env = npxEnv({});
  assert.equal(existsSync(env.npm_config_userconfig) || existsSync(env.npm_config_globalconfig), false);
});

// A command position: the start, or after ; | & ( or $(.
const AT_COMMAND = String.raw`(?:^|[;|&(]\s*|\$\(\s*)`;
const npxCalls = (cmd) => (cmd.match(new RegExp(`${AT_COMMAND}npx\\s`, 'g')) || []).length;
const prefixedCalls = (cmd) => (cmd.match(new RegExp(`${AT_COMMAND}npx --prefix="\\$CW_NPX_PREFIX" `, 'g')) || []).length;

test('every npx command in a check manifest passes the prefix, and its check requires npx', () => {
  let seen = 0;
  for (const f of readdirSync(join(ROOT, 'manifests')).filter((n) => n.endsWith('.json'))) {
    let m; try { m = JSON.parse(readFileSync(join(ROOT, 'manifests', f), 'utf8')); } catch { continue; }
    for (const c of (m && Array.isArray(m.checks) ? m.checks : [])) {
      const calls = (c.local || []).reduce((n, cmd) => n + npxCalls(String(cmd)), 0);
      if (!calls) continue;
      seen += 1;
      assert.equal((c.local || []).reduce((n, cmd) => n + prefixedCalls(String(cmd)), 0), calls, `${f} ${c.id}: an npx call without --prefix="$CW_NPX_PREFIX"`);
      assert.ok(fetchesWithNpx(c), `${f} ${c.id} runs npx without requiring it, so it would not get the npx env`);
    }
  }
  assert.ok(seen >= 3, `found ${seen} npx checks; this would pass vacuously`);
  assert.equal(npxCalls('a; npx --yes x'), 1);
  assert.equal(prefixedCalls('a; npx --yes x'), 0, 'the counter tells a bare call from a prefixed one');
});

const npxOk = spawnSync('npx', ['--version'], { stdio: 'ignore', timeout: 30_000 }).status === 0;
const freePort = () => new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

test('live: in a tree whose .npmrc and node_modules are hostile, the lane env fetches from the operator registry and never runs the tree\'s copy', { skip: npxOk ? false : 'npx is absent: the npx lane env is NOT verified here' }, async () => {
  const [treePort, operatorPort] = [await freePort(), await freePort()];
  const d = mkdtempSync(join(tmpdir(), 'cw-npx-lane-'));
  try {
    const tree = join(d, 'tree');
    mkdirSync(join(tree, 'node_modules', 'retire', 'bin'), { recursive: true });
    mkdirSync(join(tree, 'node_modules', '.bin'));
    writeFileSync(join(tree, 'package.json'), '{"name":"t","version":"1.0.0"}\n');
    writeFileSync(join(tree, '.npmrc'), `registry=http://127.0.0.1:${treePort}/\n@cyclonedx:registry=http://127.0.0.1:${treePort}/\n`);
    writeFileSync(join(tree, 'node_modules', 'retire', 'package.json'), '{"name":"retire","version":"6.1.0","bin":{"retire":"bin/retire.js"}}\n');
    writeFileSync(join(tree, 'node_modules', 'retire', 'bin', 'retire.js'), '#!/usr/bin/env node\nconsole.log("TREE-COPY-RAN")\n');
    chmodSync(join(tree, 'node_modules', 'retire', 'bin', 'retire.js'), 0o755);
    symlinkSync('../retire/bin/retire.js', join(tree, 'node_modules', '.bin', 'retire'));
    const run = (cmd, env, cache) => {
      const r = spawnSync('sh', ['-c', cmd], { cwd: tree, encoding: 'utf8', timeout: 120_000,
        env: { ...env, npm_config_cache: cache, npm_config_fetch_retries: '0', npm_config_fetch_timeout: '5000' } });
      const logs = existsSync(join(cache, '_logs')) ? readdirSync(join(cache, '_logs')).map((f) => readFileSync(join(cache, '_logs', f), 'utf8')).join('\n') : '';
      return { out: `${r.stdout}${r.stderr}`, logs };
    };
    const base = { PATH: process.env.PATH, HOME: d };
    const control = run('npx --yes retire@6.1.0 --version; npx --yes @cyclonedx/cyclonedx-npm@6.0.1 --version', base, join(d, 'cache-control'));
    assert.match(control.out, /TREE-COPY-RAN/, 'the control: npx in the tree runs the tree\'s copy');
    assert.ok(control.logs.includes(`127.0.0.1:${treePort}`), 'the control: npx in the tree fetches from the tree\'s registry');

    const env = laneEnv(NPX_LANE, { ...base, CW_NPM_REGISTRY: `http://127.0.0.1:${operatorPort}/` });
    const lane = run('npx --prefix="$CW_NPX_PREFIX" --yes retire@6.1.0 --version; npx --prefix="$CW_NPX_PREFIX" --yes @cyclonedx/cyclonedx-npm@6.0.1 --version', env, join(d, 'cache-lane'));
    assert.doesNotMatch(lane.out, /TREE-COPY-RAN/, 'the lane ran the copy the tree ships');
    assert.ok(!lane.logs.includes(`127.0.0.1:${treePort}`), 'the lane fetched from the tree\'s registry');
    assert.ok(lane.logs.includes(`127.0.0.1:${operatorPort}/retire`) && lane.logs.includes(`127.0.0.1:${operatorPort}/@cyclonedx`), `the lane did not ask the operator's registry for both packages:\n${lane.out.slice(-800)}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
