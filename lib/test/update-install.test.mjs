// lib/update/install.mjs: reading how the running tree was installed, and the bin/install.sh call
// that reproduces it, with the installer copied out of the tree it replaces.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installTarget, installerArgv, runInstaller, LAUNCHER_MARK } from '../update/install.mjs';

let dir;
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'cw-update-install-'))); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const tree = (dest, { marker = true } = {}) => {
  mkdirSync(join(dest, 'bin'), { recursive: true });
  writeFileSync(join(dest, 'bin', 'install.sh'), '#!/bin/sh\n');
  if (marker) writeFileSync(join(dest, '.commitwork-install'), 'commitwork 1.0.0\nsource tarball sha256:x\n');
};
const launcher = (prefix, dest) => {
  mkdirSync(join(prefix, 'bin'), { recursive: true });
  writeFileSync(join(prefix, 'bin', 'commitwork'), `#!/bin/sh\n${LAUNCHER_MARK}\nexec node '${dest}/bin/commitwork.mjs' "$@"\n`);
};

describe('installTarget', () => {
  test('a tree without the install marker is not installable', () => {
    // Arrange
    tree(join(dir, 'checkout'), { marker: false });
    // Act
    const t = installTarget(join(dir, 'checkout'));
    // Assert
    assert.equal(t.installable, false);
    assert.match(t.reason, /not installed by bin\/install\.sh/);
  });

  test('the default layout with its launcher reproduces --prefix and --dest', () => {
    // Arrange
    const dest = join(dir, 'p', 'lib', 'commitwork');
    tree(dest); launcher(join(dir, 'p'), dest);
    // Act
    const t = installTarget(dest);
    // Assert
    assert.deepEqual(t.args, ['--prefix', join(dir, 'p'), '--dest', dest]);
  });

  test('a launcher that is not the installer\'s, or points elsewhere, is left alone with --no-link', () => {
    // Arrange
    const dest = join(dir, 'p', 'lib', 'commitwork');
    tree(dest); launcher(join(dir, 'p'), '/somewhere/else');
    const bare = join(dir, 'q', 'lib', 'commitwork');
    tree(bare);
    // Act
    const a = installTarget(dest), b = installTarget(bare);
    // Assert
    assert.deepEqual(a.args, ['--dest', dest, '--no-link']);
    assert.deepEqual(b.args, ['--dest', bare, '--no-link']);
  });

  test('a custom dest is reproduced with --no-link', () => {
    // Arrange
    const dest = join(dir, 'opt', 'cw');
    tree(dest);
    // Act
    const t = installTarget(dest);
    // Assert
    assert.deepEqual(t, { installable: true, dest, args: ['--dest', dest, '--no-link'], reason: null });
  });

  test('a read failure other than absence is thrown, never read as a checkout', () => {
    // Arrange
    const readFile = () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
    // Act / Assert
    assert.throws(() => installTarget(dir, { readFile }), /denied/);
  });
});

describe('runInstaller', () => {
  const fakeSpawn = (code, { error = null } = {}) => {
    const calls = [];
    const fn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      setImmediate(() => {
        child.stdout.emit('data', 'out'); child.stderr.emit('data', 'err');
        if (error) child.emit('error', new Error(error)); else child.emit('close', code);
      });
      return child;
    };
    fn.calls = calls;
    return fn;
  };

  test('copies install.sh out of the tree and runs it with --from, --sha256 and the install args', async () => {
    // Arrange
    const root = join(dir, 'tree'); tree(root);
    const work = join(dir, 'work'); mkdirSync(work);
    const spawnFn = fakeSpawn(0);
    const output = [];
    // Act
    const r = await runInstaller({ root, tgz: '/t/c.tgz', sha256: 'ab', args: ['--dest', '/d', '--no-link'], workDir: work, spawnFn, stdio: 'pipe', onOutput: (s) => output.push(s) });
    // Assert
    assert.equal(r.code, 0);
    assert.ok(existsSync(join(work, 'install.sh')));
    assert.equal(spawnFn.calls[0].cmd, 'sh');
    assert.deepEqual(spawnFn.calls[0].args, [join(work, 'install.sh'), '--from', '/t/c.tgz', '--sha256', 'ab', '--dest', '/d', '--no-link']);
    assert.deepEqual(output, ['out', 'err']);
  });

  test('an installer that cannot start reports the error', async () => {
    // Arrange
    const root = join(dir, 'tree'); tree(root);
    // Act
    const r = await runInstaller({ root, tgz: 't', sha256: 's', args: [], workDir: dir, spawnFn: fakeSpawn(null, { error: 'spawn sh ENOENT' }) });
    // Assert
    assert.deepEqual([r.code, r.error], [null, 'spawn sh ENOENT']);
  });

  test('installerArgv puts the installer flags before the reproduced ones', () => {
    // Arrange
    const args = ['--prefix', '/p'];
    // Act
    const argv = installerArgv('/w/install.sh', '/w/x.tgz', 'ff', args);
    // Assert
    assert.deepEqual(argv, ['sh', '/w/install.sh', '--from', '/w/x.tgz', '--sha256', 'ff', '--prefix', '/p']);
  });
});

describe('end to end with the real installer', () => {
  test('bin/install.sh refuses a tarball whose sha256 is not the one given', async () => {
    // Arrange
    const repo = join(import.meta.dirname, '..', '..');
    const tgz = join(dir, 'commitwork-9.9.9.tgz');
    writeFileSync(tgz, 'not the signed bytes');
    // Act
    const r = await runInstaller({ root: repo, tgz, sha256: 'a'.repeat(64), args: ['--dest', join(dir, 'dest'), '--no-link'], workDir: dir, stdio: 'ignore' });
    // Assert
    assert.equal(r.code, 21);
    assert.equal(existsSync(join(dir, 'dest')), false);
  });
});
