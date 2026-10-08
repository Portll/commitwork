// The lockfiles must still name packages the registry can serve. CI runs no `npm ci`, so nothing
// else would notice: a redaction batch on 2026-09-06 camelCased two @aws-sdk names in
// package-lock.json, keys and resolved URLs alike, and every `npm ci` 404'd for a month.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCKFILES = () => (process.env.CW_PACKAGE_LOCKS
  ? process.env.CW_PACKAGE_LOCKS.split(',')
  : ['package-lock.json', 'fixtures/scan-canary/clean/package-lock.json', 'fixtures/scan-canary/dirty/package-lock.json']
    .map((p) => join(REPO, p)));

// npm refuses new names with capitals. A registry package that predates the rule would need an entry
// here with its reason; none is in these lockfiles.
const LEGACY_NAMES = new Set();
const NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const validName = (n) => NAME.test(n) || LEGACY_NAMES.has(n);
const DEP_MAPS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

export function lockfileNameProblems(lock) {
  const problems = [];
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    if (key === '' || entry.link) continue;
    const name = key.split(/(?:^|\/)node_modules\//).pop();
    if (!validName(name)) problems.push(`${key}: "${name}" is not a valid npm package name`);
    if (typeof entry.resolved === 'string' && entry.resolved.startsWith('https://registry.npmjs.org/')) {
      // An alias (`x-cjs: npm:x@…`) installs under its own key and records the real package in `name`.
      const real = entry.name || name;
      if (real !== name && !validName(real)) problems.push(`${key}: alias of "${real}", not a valid npm package name`);
      const want = `https://registry.npmjs.org/${real}/-/${real.split('/').pop()}-${entry.version}.tgz`;
      if (entry.resolved !== want) problems.push(`${key}: resolved ${entry.resolved} is not ${want}`);
    }
    for (const map of DEP_MAPS) {
      for (const dep of Object.keys(entry[map] || {})) {
        if (!validName(dep)) problems.push(`${key}: ${map} names "${dep}", not a valid npm package name`);
      }
    }
  }
  return problems;
}

test('the check fails on the camelCased names the redaction batch wrote', () => {
  const lock = { packages: {
    '': { name: 'x' },
    'node_modules/@aws-sdk/clientCognito-identity': {
      version: '3.1075.0',
      resolved: 'https://registry.npmjs.org/@aws-sdk/clientCognito-identity/-/clientCognito-identity-3.1075.0.tgz',
    },
    'node_modules/@aws-sdk/credential-provider-cognito-identity': {
      version: '3.1075.0',
      resolved: 'https://registry.npmjs.org/@aws-sdk/credential-provider-cognito-identity/-/credential-provider-cognito-identity-3.1075.0.tgz',
      dependencies: { '@aws-sdk/clientCognito-identity': '3.1075.0' },
    },
    'node_modules/left-pad': { version: '1.3.0', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.2.0.tgz' },
  } };
  const got = lockfileNameProblems(lock);
  assert.equal(got.length, 3, got.join('\n'));
  assert.match(got[0], /clientCognito-identity" is not a valid npm package name/);
  assert.match(got[1], /dependencies names "@aws-sdk\/clientCognito-identity"/);
  assert.match(got[2], /left-pad-1\.2\.0\.tgz is not/);
});

test('every package the tracked lockfiles name is one the registry can serve', () => {
  const paths = LOCKFILES().filter((p) => existsSync(p));
  assert.ok(paths.length > 0, `none of ${LOCKFILES().join(', ')} exists, so nothing was checked`);
  for (const p of paths) {
    const lock = JSON.parse(readFileSync(p, 'utf8'));
    assert.ok(Object.keys(lock.packages || {}).length > 1, `${p} has no packages section to check`);
    assert.deepEqual(lockfileNameProblems(lock), [], p);
  }
});
