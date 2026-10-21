// fact: every assertion runs against a REAL throwaway repository, never a mocked git / a mocked version agrees with whatever the mock was told and proves nothing about the commit actually read (expiry: never, prev: wrong)
// fact: the refusal tests assert `git tag -l` is still EMPTY, not just an exit code / an exit code says the tool complained, not that it declined to mint a tag (expiry: never, prev: missing)
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readVersionAt, tagFor, tagPrefix, isSemver, tagExists, versionOrigin, versionKind, plan,
} from '../release-tag.mjs';

const CLI = fileURLToPath(new URL('../release-tag.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** a repo whose history sets package.json's version once per entry in `versions` */
function repoWith(versions, { name = 'package.json' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-tag-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  for (const v of versions) {
    writeFileSync(join(dir, name), `${JSON.stringify({ name: 'commitwork', version: v }, null, 2)}\n`);
    git(dir, 'add', name);
    git(dir, 'commit', '-q', '-m', `set ${v}`);
  }
  return dir;
}

test('the tag is v plus the version package.json carries at that commit', () => {
  const dir = repoWith(['0.2.0']);
  assert.equal(readVersionAt('HEAD', dir), '0.2.0');
  assert.equal(tagFor('0.2.0'), 'v0.2.0');
  assert.equal(plan({ cwd: dir }).tag, 'v0.2.0');
});

test('the version comes from the ref being tagged, never from the working tree', () => {
  const dir = repoWith(['0.1.0', '0.2.0']);
  // an uncommitted edit is the author's tree, not the repository
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ version: '9.9.9' })}\n`);
  assert.equal(plan({ ref: 'HEAD~1', cwd: dir }).tag, 'v0.1.0', 'an older ref carries its own version');
  assert.equal(plan({ ref: 'HEAD', cwd: dir }).tag, 'v0.2.0');
  assert.notEqual(plan({ cwd: dir }).version, '9.9.9', 'a dirty tree must not be able to name a release');
});

test('a commit with no package.json is an exception, never a default version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-tag-bare-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'no manifest');
  assert.throws(() => readVersionAt('HEAD', dir), /exited/);
  assert.throws(() => plan({ cwd: dir }), /exited/, 'a version we cannot read must not become 0.0.0');
});

test('an unparseable or versionless manifest is an exception, never a default version', () => {
  const broken = repoWith(['0.2.0']);
  writeFileSync(join(broken, 'package.json'), '{ not json');
  git(broken, 'commit', '-q', '-am', 'break it');
  assert.throws(() => readVersionAt('HEAD', broken), /is not JSON/);

  const empty = repoWith(['0.2.0']);
  writeFileSync(join(empty, 'package.json'), '{"name":"x"}\n');
  git(empty, 'commit', '-q', '-am', 'drop the version');
  assert.throws(() => readVersionAt('HEAD', empty), /carries no version/);
});

test('a non-semver version is refused, so the retired counted series cannot be re-minted', () => {
  const dir = repoWith(['0.1108']);
  assert.throws(() => plan({ cwd: dir }), /not semver/);
  const r = spawnSync('node', [CLI, '--tag'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CW_REPO_ROOT: dir } });
  assert.equal(r.status, 2, `fail closed: ${r.stderr}`);
  assert.equal(git(dir, 'tag', '-l'), '', 'the refusal must leave the ref store untouched');
});

test('an existing tag is reported, never silently moved', () => {
  const dir = repoWith(['0.2.0']);
  assert.equal(tagExists('v0.2.0', dir), false);
  git(dir, 'tag', '-a', 'v0.2.0', '-m', 'x');
  assert.equal(tagExists('v0.2.0', dir), true);
  assert.equal(plan({ cwd: dir }).exists, true, 'plan must surface the collision so the caller refuses');

  const before = git(dir, 'rev-parse', 'refs/tags/v0.2.0');
  const r = spawnSync('node', [CLI, '--tag'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CW_REPO_ROOT: dir } });
  assert.equal(r.status, 1, `an existing tag is exit 1: ${r.stderr}`);
  assert.equal(git(dir, 'rev-parse', 'refs/tags/v0.2.0'), before, 'the tag must point at the same object afterwards');
});

test('--tag mints exactly the planned tag and nothing else', () => {
  const dir = repoWith(['0.1.0', '0.2.0']);
  const r = spawnSync('node', [CLI, '--tag'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CW_REPO_ROOT: dir } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(dir, 'tag', '-l'), 'v0.2.0');
  assert.equal(git(dir, 'rev-list', '-n1', 'v0.2.0'), git(dir, 'rev-parse', 'HEAD'));
});

test('a patch version is planned but never tagged, because every commit carries one', () => {
  const dir = repoWith(['0.2.0', '0.2.1']);
  const p = plan({ cwd: dir });
  assert.equal(p.kind, 'patch');
  assert.equal(p.origin, 'set-here', 'origin cannot tell a per-commit bump from a release, which is why kind exists');
  const r = spawnSync('node', [CLI, '--tag'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CW_REPO_ROOT: dir } });
  assert.equal(r.status, 2, `a patch version is no taggable version: ${r.stderr}`);
  assert.match(r.stderr, /patch version/);
  assert.equal(git(dir, 'tag', '-l'), '', 'the refusal must leave the ref store untouched');
  assert.equal(plan({ ref: 'HEAD~1', cwd: dir }).kind, 'minor', 'the commit that set 0.2.0 by hand stays taggable');
});

test('the kind is the part of the version that moved', () => {
  assert.equal(versionKind('0.2.0'), 'minor');
  assert.equal(versionKind('1.0.0'), 'major');
  assert.equal(versionKind('1.0.0-rc.1'), 'major');
  assert.equal(versionKind('1.2.0'), 'minor');
  assert.equal(versionKind('0.1.175'), 'patch');
});

test('the plan says whether THIS commit set the version, with undetermined held apart', () => {
  const dir = repoWith(['0.1.0', '0.2.0']);
  assert.equal(plan({ cwd: dir }).origin, 'set-here');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'rides along');
  assert.equal(plan({ cwd: dir }).origin, 'inherited', 'a commit that did not set the version must say so');
  assert.equal(versionOrigin('HEAD~1', '0.2.0', dir), 'set-here');

  const broken = repoWith(['0.1.0']);
  writeFileSync(join(broken, 'package.json'), '{ not json');
  git(broken, 'commit', '-q', '-am', 'break it');
  writeFileSync(join(broken, 'package.json'), `${JSON.stringify({ version: '0.2.0' })}\n`);
  git(broken, 'commit', '-q', '-am', 'set 0.2.0');
  assert.equal(versionOrigin('HEAD', '0.2.0', broken), 'unknown',
    'an unreadable parent is UNDETERMINED, never folded into set-here or inherited');
});

test('the first commit of a history sets its own version', () => {
  const dir = repoWith(['0.1.0']);
  assert.equal(plan({ cwd: dir }).origin, 'set-here', 'a root commit has no parent to inherit from');
});

test('semver shape tells a hand-set version from the retired count', () => {
  assert.equal(isSemver('0.2.0'), true);
  assert.equal(isSemver('1.0.0-rc.1'), true);
  assert.equal(isSemver('0.1108'), false, 'the retired interim series must not be mistaken for semver');
  assert.equal(isSemver('0.1'), false);
});

test('the tag prefix and the manifest path are env-overridable at call time', () => {
  const prevP = process.env.CW_RELEASE_TAG_PREFIX;
  const prevM = process.env.CW_PACKAGE_JSON;
  const dir = repoWith(['0.3.0'], { name: 'nested.json' });
  try {
    process.env.CW_RELEASE_TAG_PREFIX = 'release-';
    assert.equal(tagPrefix(), 'release-');
    assert.equal(tagFor('0.3.0'), 'release-0.3.0');
    process.env.CW_PACKAGE_JSON = 'nested.json';
    assert.equal(plan({ cwd: dir }).tag, 'release-0.3.0', 'both overrides must bite after module load');
  } finally {
    if (prevP === undefined) delete process.env.CW_RELEASE_TAG_PREFIX; else process.env.CW_RELEASE_TAG_PREFIX = prevP;
    if (prevM === undefined) delete process.env.CW_PACKAGE_JSON; else process.env.CW_PACKAGE_JSON = prevM;
  }
});
