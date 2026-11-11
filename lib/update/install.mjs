// lib/update/install.mjs — how the running commitwork was installed, and the bin/install.sh call
// that replaces it with a verified tarball the same way.
//
// bin/install.sh records no prefix. What reproduces an install is read off disk instead:
//   dest     the running tree, when it carries .commitwork-install (the installer's marker)
//   prefix   P when dest is P/lib/commitwork and P/bin/commitwork is this installer's launcher
//            pointing at dest; otherwise --no-link, which leaves whatever launcher exists alone
//            (the dest path does not change, so a launcher pointing at it still works)
// A tree without the marker is a git checkout or a copy: it is reported, never installed over.

import { spawn } from 'node:child_process';
import { copyFileSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const INSTALL_MARKER = '.commitwork-install';
export const LAUNCHER_MARK = '# commitwork launcher written by bin/install.sh';

const readOrNull = (readFile, p) => {
  try { return String(readFile(p, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; }
};

/** { installable, dest, args, reason } for the tree at `root`. */
export function installTarget(root, { readFile = readFileSync, realpath = realpathSync } = {}) {
  const dest = realpath(root);
  if (readOrNull(readFile, join(dest, INSTALL_MARKER)) === null) {
    return { installable: false, dest, args: [], reason: `${dest} was not installed by bin/install.sh (no ${INSTALL_MARKER}); it is a checkout or a copy, so update it with git, or install with bin/install.sh` };
  }
  if (basename(dest) === 'commitwork' && basename(dirname(dest)) === 'lib') {
    const prefix = dirname(dirname(dest));
    const launcher = readOrNull(readFile, join(prefix, 'bin', 'commitwork'));
    if (launcher && launcher.split('\n').includes(LAUNCHER_MARK) && launcher.includes(join(dest, 'bin', 'commitwork.mjs'))) {
      return { installable: true, dest, args: ['--prefix', prefix, '--dest', dest], reason: null };
    }
  }
  return { installable: true, dest, args: ['--dest', dest, '--no-link'], reason: null };
}

/** The installer argv: the copy of bin/install.sh made outside the tree it replaces. */
export const installerArgv = (script, tgz, sha256, args) => ['sh', script, '--from', tgz, '--sha256', sha256, ...args];

/**
 * Copy bin/install.sh out of the tree (it moves that tree), run it, resolve with its exit code.
 * `spawnFn` is the test seam.
 */
export function runInstaller({ root, tgz, sha256, args, workDir, spawnFn = spawn, stdio = 'inherit', copy = copyFileSync, onOutput = null }) {
  const script = join(workDir, 'install.sh');
  copy(join(root, 'bin', 'install.sh'), script);
  const argv = installerArgv(script, tgz, sha256, args);
  return new Promise((done) => {
    const child = spawnFn(argv[0], argv.slice(1), { stdio, env: process.env });
    if (onOutput) {
      child.stdout?.on('data', (d) => onOutput(String(d)));
      child.stderr?.on('data', (d) => onOutput(String(d)));
    }
    child.on('error', (e) => done({ code: null, error: e.message, argv }));
    child.on('close', (code) => done({ code, error: null, argv }));
  });
}
