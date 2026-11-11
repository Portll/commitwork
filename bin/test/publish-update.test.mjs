// release/publish-update.mjs: the spine publisher call it makes for each channel, and its refusals.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { main, parsePublishArgs, publisherArgv, spineDir, REPO } from '../../release/publish-update.mjs';

describe('parsePublishArgs', () => {
  test('stable publishes to GitHub by default, beta does not', () => {
    // Arrange
    const v = { version: '1.2.0' };
    // Act
    const stable = parsePublishArgs(['--channel', 'stable'], v).opts;
    const beta = parsePublishArgs(['--channel', 'beta'], v).opts;
    // Assert
    assert.equal(stable.github, true);
    assert.equal(beta.github, false);
    assert.equal(stable.file, join(REPO, 'dist', 'commitwork-1.2.0.tgz'));
  });

  test('every flag can be set, and --github / --no-github override the default', () => {
    // Arrange
    const argv = ['--channel', 'beta', '--version', '3.0.0', '--file', 'x.tgz', '--notes', 'n.md', '--github', '--dry-run'];
    // Act
    const o = parsePublishArgs(argv, { version: '1.0.0' }).opts;
    const off = parsePublishArgs(['--channel', 'stable', '--no-github'], { version: '1.0.0' }).opts;
    // Assert
    assert.deepEqual(o, { channel: 'beta', version: '3.0.0', file: 'x.tgz', notes: 'n.md', github: true, dryRun: true });
    assert.equal(off.github, false);
  });

  test('refuses a missing or bad channel, a missing value, an unknown flag and no version', () => {
    // Arrange
    const cases = [[[], { version: '1' }], [['--channel', 'x'], { version: '1' }], [['--version'], {}], [['--what'], {}], [['--channel', 'beta'], {}]];
    // Act
    const errors = cases.map(([a, o]) => parsePublishArgs(a, o).error);
    // Assert
    assert.match(errors[0], /stable or beta/);
    assert.match(errors[1], /stable or beta/);
    assert.match(errors[2], /--version needs a value/);
    assert.match(errors[3], /unknown argument/);
    assert.match(errors[4], /no --version/);
  });
});

describe('publisherArgv and main', () => {
  const opts = { channel: 'stable', version: '1.2.0', file: '/d/commitwork-1.2.0.tgz', notes: '/d/n.md', github: true };

  test('calls spine updates/publish.mjs with the product, channel, version, file, notes and --github', () => {
    // Arrange
    const spine = '/src/spine';
    // Act
    const argv = publisherArgv(opts, spine);
    // Assert
    assert.deepEqual(argv.slice(1), ['/src/spine/updates/publish.mjs', '--product', 'commitwork', '--channel', 'stable', '--version', '1.2.0', '--file', '/d/commitwork-1.2.0.tgz', '--notes', '/d/n.md', '--github']);
  });

  test('SPINE_DIR names the spine checkout; the default is ../spine', () => {
    // Arrange
    const env = { SPINE_DIR: '/x/spine' };
    // Act
    const a = spineDir(env), b = spineDir({});
    // Assert
    assert.equal(a, '/x/spine');
    assert.equal(b, resolve(REPO, '..', 'spine'));
  });

  test('runs the publisher and returns its exit code; --dry-run only prints', () => {
    // Arrange
    const runs = [], logs = [];
    const deps = { env: { SPINE_DIR: '/s' }, exists: () => true, run: (c, a) => { runs.push([c, ...a]); return { status: 3 }; }, log: (m) => logs.push(m), version: '1.2.0' };
    // Act
    const code = main(['--channel', 'beta'], deps);
    const dry = main(['--channel', 'beta', '--dry-run'], deps);
    // Assert
    assert.equal(code, 3);
    assert.equal(runs.length, 1);
    assert.equal(runs[0][1], '/s/updates/publish.mjs');
    assert.equal(runs[0].includes('--github'), false);
    assert.equal(dry, 0);
    assert.match(logs[0], /\/s\/updates\/publish\.mjs --product commitwork --channel beta/);
  });

  test('a missing tarball or publisher exits 21, a usage error 2, a signal 1', () => {
    // Arrange
    const logs = [];
    const base = { env: { SPINE_DIR: '/s' }, log: (m) => logs.push(m), version: '1.2.0', run: () => ({ status: null }) };
    // Act
    const noFile = main(['--channel', 'beta'], { ...base, exists: (p) => !p.endsWith('.tgz') });
    const noSpine = main(['--channel', 'beta'], { ...base, exists: (p) => p.endsWith('.tgz') });
    const usage = main([], { ...base, exists: () => true });
    const signal = main(['--channel', 'beta'], { ...base, exists: () => true });
    // Assert
    assert.deepEqual([noFile, noSpine, usage, signal], [21, 21, 2, 1]);
    assert.match(logs[0], /npm pack/);
    assert.match(logs[1], /set SPINE_DIR/);
  });

  test('reads package.json for the version when none is given', () => {
    // Arrange
    const logs = [];
    // Act
    main(['--channel', 'beta', '--dry-run'], { env: {}, log: (m) => logs.push(m) });
    // Assert
    assert.match(logs[0], /--version \d+\.\d+\.\d+/);
  });
});
