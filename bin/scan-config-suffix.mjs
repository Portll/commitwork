#!/usr/bin/env node
// Prints ".self" when the scan target (cwd) is commitwork itself, else nothing. The secret lanes use
// it to choose manifests/*.self.* (commitwork's declared-synthetic paths) over the fleet files.
// Identity is the root-commit set, compared with $CW_ROOT's. Any failure, or an empty answer on
// either side, prints nothing: the fleet config scans more, so uncertainty must land there.
import { scannedGit } from './lib/git-env.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';

const roots = (cwd) => {
  const r = scannedGit(cwd, ['rev-list', '--max-parents=0', 'HEAD'], { timeout: 20000 }); // cwd is the scan target
  if (r.error || r.status !== 0) return '';
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).sort().join(',');
};

export function suffixFor(target, cwRoot) {
  const mine = roots(target);
  return mine !== '' && mine === roots(cwRoot) ? '.self' : '';
}

if (isMainModule(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  process.stdout.write(suffixFor(process.cwd(), process.env.CW_ROOT || join(here, '..')));
}
