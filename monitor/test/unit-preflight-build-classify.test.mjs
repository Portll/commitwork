// One dependency verdict per ecosystem present in a repository (monitor/preflight-build.mjs classify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../preflight-build.mjs';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VOID = ' could not be read (permissions, or a broken symlink) \u2014 this is a VOID, not a clean repo and not a missing lockfile; building will not fix it';
const GO_WHY = 'go.sum is the checksum database the vulnerability scanners resolve module versions through';
const NODE_WHY = 'without a lockfile the resolved tree does not exist on disk, so osv/npm audit have no versions to match advisories against';
const RUST_WHY = 'Cargo.toml declares semver ranges; without Cargo.lock there is no resolved version set to match against an advisory. Not built here: resolving it runs build scripts from the dependency graph on the host';

const goOk = { eco: 'go', state: 'ok', lockMissing: null, lockSource: 'repo', buildable: true, why: null };
const goBlind = (why) => ({ eco: 'go', state: 'blind', lockMissing: 'go.sum', lockSource: null, buildable: true, why });
const nodeBlind = (why) => ({ eco: 'node', state: 'blind', lockMissing: 'package-lock.json', lockSource: null, buildable: true, why });

const put = (dir, name, text = '') => writeFileSync(join(dir, name), text);
const loop = (dir, name) => symlinkSync(name, join(dir, name));
const inTemp = (body) => {
  const dir = mkdtempSync(join(tmpdir(), 'classify-'));
  try {
    const repo = join(dir, 'repo');
    const side = join(dir, 'side');
    mkdirSync(repo);
    mkdirSync(side);
    body(repo, side);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('a repository with no recognised manifest classifies as an empty list', () => {
  inTemp((repo, side) => {
    assert.deepEqual(classify(repo), []);
    put(repo, 'go.sum');
    put(side, 'go.sum');
    symlinkSync('absent', join(repo, 'go.mod'));
    assert.deepEqual(classify(repo, { lockDir: side }), []);
  });
});

test('a manifest beside its lockfile is ok with the repository as the lock source', () => {
  inTemp((repo) => {
    put(repo, 'go.mod', 'module m');
    put(repo, 'go.sum');
    put(repo, 'pom.xml', '<project/>');
    assert.deepEqual(classify(repo), [
      goOk,
      { eco: 'jvm-maven', state: 'ok', lockMissing: null, lockSource: 'repo', buildable: false, why: null },
    ]);
  });
});

test('a manifest with no lockfile in the repository or the sidecar is blind with the ecosystem reason', () => {
  inTemp((repo, side) => {
    put(repo, 'go.mod', 'module m');
    put(repo, 'Cargo.toml', '[package]');
    const expected = [
      goBlind(GO_WHY),
      { eco: 'rust', state: 'blind', lockMissing: 'Cargo.lock', lockSource: null, buildable: false, why: RUST_WHY },
    ];
    assert.deepEqual(classify(repo), expected);
    assert.deepEqual(classify(repo, { lockDir: side }), expected);
  });
});

test('a lockfile found only in the sidecar is ok and reports the sidecar directory', () => {
  inTemp((repo, side) => {
    put(repo, 'go.mod', 'module m');
    put(side, 'go.sum');
    assert.deepEqual(classify(repo, { lockDir: side }), [{ ...goOk, lockSource: 'sidecar', lockDir: side }]);
    assert.deepEqual(classify(repo), [goBlind(GO_WHY)]);
  });
});

test('an unreadable sidecar lock turns a missing lockfile into a void', () => {
  inTemp((repo, side) => {
    put(repo, 'go.mod', 'module m');
    loop(side, 'go.sum');
    assert.deepEqual(classify(repo, { lockDir: side }), [goBlind(`go.sum${VOID}`)]);
  });
});

test('a lockfile in the repository outranks the same lockfile in the sidecar', () => {
  inTemp((repo, side) => {
    put(repo, 'go.mod', 'module m');
    put(repo, 'go.sum');
    put(side, 'go.sum');
    assert.deepEqual(classify(repo, { lockDir: side }), [goOk]);
  });
});

test('an unreadable repository lock is a void that neither the sidecar nor an empty package.json can clear', () => {
  inTemp((repo, side) => {
    put(repo, 'go.mod', 'module m');
    loop(repo, 'go.sum');
    put(side, 'go.sum');
    assert.deepEqual(classify(repo), [goBlind(`go.sum${VOID}`)]);
    assert.deepEqual(classify(repo, { lockDir: side }), [goBlind(`go.sum${VOID}`)]);
  });
  inTemp((repo) => {
    put(repo, 'package.json', '{}');
    loop(repo, 'package-lock.json');
    assert.deepEqual(classify(repo), [nodeBlind(`package-lock.json${VOID}`)]);
  });
});

test('an unreadable manifest is a void naming the first manifest even when the lock exists', () => {
  inTemp((repo) => {
    loop(repo, 'go.mod');
    put(repo, 'go.sum');
    assert.deepEqual(classify(repo), [goBlind(`go.mod${VOID}`)]);
  });
  inTemp((repo) => {
    put(repo, 'gradle');
    assert.deepEqual(classify(repo), [
      { eco: 'jvm-gradle', state: 'blind', lockMissing: 'gradle.lockfile', lockSource: null, buildable: true, why: `build.gradle${VOID}` },
    ]);
  });
});

test('a package.json declaring no dependencies silences the node ecosystem and no other', () => {
  inTemp((repo) => {
    put(repo, 'package.json', '{"dependencies":{}}');
    assert.deepEqual(classify(repo), []);
    put(repo, 'package-lock.json');
    assert.deepEqual(classify(repo), []);
    put(repo, 'go.mod', 'module m');
    put(repo, 'go.sum');
    assert.deepEqual(classify(repo), [goOk]);
  });
});

test('a package.json that may declare dependencies is judged on its lockfile', () => {
  inTemp((repo) => {
    for (const body of ['{', 'null', '{"workspaces":["a"]}', '{"peerDependencies":{"a":"1.0.0"}}']) {
      put(repo, 'package.json', body);
      assert.deepEqual(classify(repo), [nodeBlind(NODE_WHY)]);
    }
    loop(repo, 'package-lock.json');
    assert.deepEqual(classify(repo), [nodeBlind(`package-lock.json${VOID}`)]);
    put(repo, 'yarn.lock');
    assert.deepEqual(classify(repo), [{ ...goOk, eco: 'node' }]);
  });
});
