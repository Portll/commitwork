// bin/test/dependency-policy.test.mjs — this repository's own dependency-update declarations agree
// with each other: one cooldown, one renovate version, and a merge job that waits for every check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRepoPolicy } from '../lib/update-policy.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(CW, p), 'utf8');

test('the committed policy is valid and declares zero runtime dependencies, as package.json does', () => {
  const p = parseRepoPolicy(read('.github/dependency-updates.json'));
  assert.equal(p.error, undefined, p.error);
  assert.equal(p.policy.zeroRuntimeDependencies, true);
  assert.deepEqual(Object.keys(JSON.parse(read('package.json')).dependencies || {}), []);
});

test('the cooldown is declared once: dependabot.yml waits as long as the policy for every ecosystem', () => {
  const days = parseRepoPolicy(read('.github/dependency-updates.json')).policy.cooldownDays;
  const yml = read('.github/dependabot.yml');
  const declared = [...yml.matchAll(/^\s+default-days:\s*(\d+)/gm)].map((m) => Number(m[1]));
  const ecosystems = [...yml.matchAll(/^\s+- package-ecosystem:/gm)].length;
  assert.equal(declared.length, ecosystems, 'every ecosystem declares a cooldown');
  for (const d of declared) assert.equal(d, days);
});

test('renovate is one version in all three places it is named', () => {
  const dev = JSON.parse(read('package.json')).devDependencies.renovate.replace(/^[\^~]/, '');
  const manifest = /npx --yes --package renovate@([\d.]+) --/.exec(read('manifests/security-baseline.json'))?.[1];
  const dryrun = /const RENOVATE_PIN = 'renovate@([\d.]+)';/.exec(read('monitor/renovate-dryrun.mjs'))?.[1];
  assert.deepEqual([manifest, dryrun], [dev, dev]);
  assert.equal(JSON.parse(read('package-lock.json')).packages['node_modules/renovate'].version, dev, 'the lockfile resolves the same version');
});

test('the Dependabot merge job waits for every other CI job and trusts the pull request author, not the actor', () => {
  const ci = read('.github/workflows/ci.yml');
  const jobs = [...ci.matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map((m) => m[1]).filter((j) => !['push', 'pull_request', 'workflow_call'].includes(j));
  const block = ci.slice(ci.indexOf('\n  dependabot-merge:'));
  const needs = /needs: \[([^\]]+)\]/.exec(block)[1].split(',').map((s) => s.trim());
  assert.deepEqual([...needs].sort(), jobs.filter((j) => j !== 'dependabot-merge').sort(), 'a job left out of needs would be skipped past');
  const cond = /\n {4}if: (.+)/.exec(block)[1];
  assert.match(cond, /github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'/);
  assert.doesNotMatch(cond, /github\.actor/);
  assert.match(cond, /!failure\(\)/);
  assert.match(block, /if: steps\.policy\.outputs\.allowed == 'true'/);
});
