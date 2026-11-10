// Derived-tier observables from a repo's newest jvm-resolve output (monitor/observables.mjs collectRepoResolved).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectRepoResolved } from '../observables.mjs';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOTE = 'tier=derived \u2014 resolved by bin/jvm-resolve.sh in a sandbox, never written into the working tree';

const withTmp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'collectRepoResolved-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const resolveDir = (root, batch, repo) => {
  const d = join(root, batch, repo, 'jvm-resolve');
  mkdirSync(d, { recursive: true });
  return d;
};

const collected = (repo, dir, lockfiles, observables, packages, withDigest) => ({
  repo,
  dir,
  lockfiles,
  observables,
  provenance: { packages, withOrigin: 0, withDigest, canOrigin: false, canDigest: false },
  note: NOTE,
});

const absent = (repo, unknownDetail) => ({ repo, observables: [], unknown: true, unknownReason: 'absent', unknownDetail });
const pkg = (repo, file, value) => ({ type: 'package', value, where: `${repo}/jvm-resolve/${file}`, tier: 'derived' });
const digest = (repo, value) => ({ type: 'sha256', value, where: `${repo}/jvm-resolve/verification-metadata.xml`, tier: 'derived' });

test('a missing reports directory is reported as absent and names that directory', () => withTmp((dir) => {
  const missing = join(dir, 'nope');
  assert.deepEqual(collectRepoResolved(missing, 'repoA'), absent('repoA', missing));
}));

test('a reports path that is a file rethrows the ENOTDIR error', () => withTmp((dir) => {
  const file = join(dir, 'reports');
  writeFileSync(file, 'x');
  assert.throws(() => collectRepoResolved(file, 'repoA'), {
    name: 'Error',
    code: 'ENOTDIR',
    message: `ENOTDIR: not a directory, scandir '${file}'`,
  });
}));

test('batches with no jvm-resolve directory for the repo are reported as absent', () => withTmp((dir) => {
  resolveDir(dir, 'batch1', 'otherRepo');
  mkdirSync(join(dir, 'batch2', 'repoB'), { recursive: true });
  assert.deepEqual(collectRepoResolved(dir, 'repoB'), absent('repoB', 'no jvm-resolve output for repoB'));
}));

test('files with other names are ignored even when their contents would parse', () => withTmp((dir) => {
  const d = resolveDir(dir, 'batch1', 'repoC');
  writeFileSync(join(d, 'notes.lockfile'), 'com.acme:lib:1.0=compileClasspath\n');
  writeFileSync(join(d, 'metadata.xml'), '<verification-metadata><component group="g" name="n"/></verification-metadata>');
  assert.deepEqual(collectRepoResolved(dir, 'repoC'), collected('repoC', d, 0, [], 0, 0));
}));

test('a lockfile yields derived packages for three-part coordinates only', () => withTmp((dir) => {
  const d = resolveDir(dir, 'batch1', 'repoD');
  const lines = [
    '# comment',
    '',
    'empty=annotationProcessor',
    'noequals',
    'two:parts=x',
    ':noGroup:1=x',
    'noArtifact::1=x',
    'com.acme:lib:1.0=compileClasspath',
    'org.x:y:2.0=runtimeClasspath',
  ];
  writeFileSync(join(d, 'gradle.lockfile'), `${lines.join('\n')}\n`);
  assert.deepEqual(collectRepoResolved(dir, 'repoD'), collected('repoD', d, 1, [
    pkg('repoD', 'gradle.lockfile', 'com.acme:lib'),
    pkg('repoD', 'gradle.lockfile', 'org.x:y'),
  ], 2, 0));
}));

test('a pins file yields packages and lowercased digests and counts digested components once', () => withTmp((dir) => {
  const d = resolveDir(dir, 'batch1', 'repoE');
  const xml = [
    '<verification-metadata>',
    `<component group="g1" name="n1"><artifact name="a"><sha256 value="${'A'.repeat(64)}"/><sha256 value="${'b'.repeat(64)}"/></artifact></component>`,
    '<component group="g2" name="n2"/>',
    `<component group="g3" name="n3"><sha256 value="${'c'.repeat(64)}"/></component>`,
    '<component group="g4" name="n4"><sha256 value="short"/></component>',
    '<component name="noGroup"/>',
    '</verification-metadata>',
  ].join('\n');
  writeFileSync(join(d, 'verification-metadata.xml'), xml);
  const file = 'verification-metadata.xml';
  assert.deepEqual(collectRepoResolved(dir, 'repoE'), collected('repoE', d, 1, [
    pkg('repoE', file, 'g1:n1'),
    digest('repoE', 'a'.repeat(64)),
    digest('repoE', 'b'.repeat(64)),
    pkg('repoE', file, 'g2:n2'),
    pkg('repoE', file, 'g3:n3'),
    digest('repoE', 'c'.repeat(64)),
    pkg('repoE', file, 'g4:n4'),
  ], 4, 2));
}));

test('a pins file without the root is not counted but an empty root is', () => withTmp((dir) => {
  const noRoot = resolveDir(dir, 'batch1', 'repoJ');
  writeFileSync(join(noRoot, 'verification-metadata.xml'), '<other/>');
  assert.deepEqual(collectRepoResolved(dir, 'repoJ'), collected('repoJ', noRoot, 0, [], 0, 0));

  const emptyRoot = resolveDir(dir, 'batch1', 'repoK');
  writeFileSync(join(emptyRoot, 'verification-metadata.xml'), '<verification-metadata></verification-metadata>');
  assert.deepEqual(collectRepoResolved(dir, 'repoK'), collected('repoK', emptyRoot, 1, [], 0, 0));
}));

test('the newest batch holding jvm-resolve output is the only one read', () => withTmp((dir) => {
  const oldDir = resolveDir(dir, 'batch1', 'repoF');
  const newDir = resolveDir(dir, 'batch2', 'repoF');
  mkdirSync(join(dir, 'batch3', 'repoF'), { recursive: true });
  writeFileSync(join(oldDir, 'gradle.lockfile'), 'old.g:pkg:1=c\n');
  writeFileSync(join(newDir, 'gradle.lockfile'), 'new.g:pkg:2=c\n');
  assert.deepEqual(collectRepoResolved(dir, 'repoF'), collected('repoF', newDir, 1, [
    pkg('repoF', 'gradle.lockfile', 'new.g:pkg'),
  ], 1, 0));
}));

test('nested files are walked in name order and their totals add up', () => withTmp((dir) => {
  const d = resolveDir(dir, 'batch1', 'repoG');
  mkdirSync(join(d, 'a-sub'));
  mkdirSync(join(d, 'z-sub'));
  writeFileSync(join(d, 'a-sub', 'gradle.lockfile'), 'com.a:one:1=c\n');
  writeFileSync(join(d, 'gradle.lockfile'), 'com.b:two:1=c\n');
  writeFileSync(join(d, 'verification-metadata.xml'), `<verification-metadata><component group="g" name="n"><sha256 value="${'d'.repeat(64)}"/></component></verification-metadata>`);
  writeFileSync(join(d, 'z-sub', 'gradle.lockfile'), 'com.z:three:1=c\n');
  assert.deepEqual(collectRepoResolved(dir, 'repoG'), collected('repoG', d, 4, [
    pkg('repoG', 'gradle.lockfile', 'com.a:one'),
    pkg('repoG', 'gradle.lockfile', 'com.b:two'),
    pkg('repoG', 'verification-metadata.xml', 'g:n'),
    digest('repoG', 'd'.repeat(64)),
    pkg('repoG', 'gradle.lockfile', 'com.z:three'),
  ], 4, 1));
}));

test('unreadable paths are skipped and a directory named like a lockfile is walked', () => withTmp((dir) => {
  const d = resolveDir(dir, 'batch1', 'repoH');
  mkdirSync(join(d, 'gradle.lockfile'));
  writeFileSync(join(d, 'gradle.lockfile', 'gradle.lockfile'), 'com.h:inner:1=c\n');
  symlinkSync(join(dir, 'missing-target'), join(d, 'verification-metadata.xml'));
  assert.deepEqual(collectRepoResolved(dir, 'repoH'), collected('repoH', d, 1, [
    pkg('repoH', 'gradle.lockfile', 'com.h:inner'),
  ], 1, 0));

  mkdirSync(join(dir, 'batch1', 'repoI'));
  const file = join(dir, 'batch1', 'repoI', 'jvm-resolve');
  writeFileSync(file, 'x');
  assert.deepEqual(collectRepoResolved(dir, 'repoI'), collected('repoI', file, 0, [], 0, 0));
}));
