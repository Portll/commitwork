import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, findLockfiles } from '../dep-provenance.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'cw-dp-'));
const put = (d, rel, s) => {
  const p = join(d, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, s);
  return d;
};

const YARN = `closure-net@git+https://github.com/google/closure-net.git#6f48f578:
  version "0.0.0"
  resolved "git+https://github.com/google/closure-net.git#6f48f578"

rimraf@^2.5.4:
  version "2.7.1"
  resolved "https://registry.npmjs.org/rimraf/-/rimraf-2.7.1.tgz#35797f1"
`;

describe('bin/dep-provenance — capture, and fail closed', () => {
  test('reads both lockfile formats, at any depth', () => {
    const d = dir();
    put(d, 'yarn.lock', YARN);
    put(d, 'packages/app/package-lock.json', JSON.stringify({ packages: { '': { name: 'r' }, 'node_modules/x': { resolved: 'git+https://github.com/a/b.git#s' } } }));
    const r = collect(d);
    assert.equal(r.ran, true);
    assert.equal(r.lockfiles.length, 2);
    assert.equal(r.packages['closure-net'].resolution, 'git');
    assert.equal(r.packages.rimraf.resolution, 'registry');
    assert.equal(r.packages.x.resolution, 'git');
    assert.equal(r.counts.git, 2);
  });

  test('NO lockfile is ran:false with a reason — never an empty inventory', () => {
    // An empty inventory would assert "this repo resolves nothing from git", which is the false
    // clean: it is indistinguishable from a repo we simply failed to read.
    const r = collect(dir());
    assert.equal(r.ran, false);
    assert.equal(r.reason, 'no-subject');
    assert.deepEqual(r.packages, {});
  });

  test('an UNREADABLE lockfile is named, and does not silently contribute zero', () => {
    const d = dir();
    put(d, 'package-lock.json', '{ this is not json');
    put(d, 'sub/yarn.lock', YARN);
    const r = collect(d);
    assert.equal(r.ran, true, 'the readable half still counts');
    assert.equal(r.unreadable.length, 1);
    assert.match(r.unreadable[0].lockfile, /package-lock\.json/);
    assert.ok(r.unreadable[0].error, 'a failure with no reason is not a report');
  });

  test('EVERY lockfile unreadable is ran:false, not a clean empty result', () => {
    const d = dir();
    put(d, 'package-lock.json', '{ nope');
    const r = collect(d);
    assert.equal(r.ran, false);
    assert.equal(r.reason, 'unparseable');
  });

  test('node_modules and build output are not walked', () => {
    const d = dir();
    put(d, 'yarn.lock', YARN);
    put(d, 'node_modules/dep/package-lock.json', '{}');
    put(d, 'dist/package-lock.json', '{}');
    assert.equal(findLockfiles(d).length, 1);
  });

  test('a package resolved differently in two lockfiles records the conflict', () => {
    const d = dir();
    put(d, 'yarn.lock', YARN);
    put(d, 'sub/package-lock.json', JSON.stringify({ packages: { 'node_modules/rimraf': { resolved: 'git+https://github.com/x/rimraf.git#s' } } }));
    const r = collect(d);
    assert.equal(r.packages.rimraf.conflict, true, 'an overwrite would hide one of the two answers');
  });

  test('the output states that it is inventory, not findings', () => {
    const d = dir();
    put(d, 'yarn.lock', YARN);
    assert.match(collect(d).note, /INVENTORY, not findings/);
  });
});
