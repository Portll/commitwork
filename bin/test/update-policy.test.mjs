// bin/test/update-policy.test.mjs — the operator layer narrowed by a repository policy, and the
// Dependabot merge decision that reads the same file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRepoPolicy, resolvePolicy, operatorPolicy } from '../lib/update-policy.mjs';
import { judge } from '../dependency-policy-check.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const op = { prod: ['patch', 'minor', 'advisories'], dev: ['patch', 'minor', 'major', 'lockfile'], automerge: ['patch', 'minor', 'lockfile'], cooldown: 3 };

test('a repository policy narrows and never widens; cooldowns take the longer', () => {
  const repo = parseRepoPolicy(JSON.stringify({ version: 1, update: { prod: ['patch', 'major'], dev: ['patch'] }, automerge: { dev: ['patch', 'major'] }, cooldownDays: { major: 30, patch: 1 } })).policy;
  const p = resolvePolicy(op, repo);
  assert.deepEqual(p.update, { prod: ['patch'], dev: ['patch'] }, 'major is not added to prod; dev loses what the repo omits');
  assert.deepEqual(p.automerge, { prod: ['patch'], dev: ['patch'] }, 'automerge never exceeds update; the repo cannot add major, and an omitted automerge.prod narrows nothing');
  assert.deepEqual(p.cooldown, { patch: 3, minor: 3, major: 30 });
  assert.equal(p.narrowed.length, 2);
  assert.deepEqual(resolvePolicy(op, null).update, { prod: op.prod, dev: op.dev }, 'no repository policy leaves the operator\'s choice');
  assert.deepEqual(resolvePolicy(op, { version: 1, zeroRuntimeDependencies: true }).update.prod, [], 'zeroRuntimeDependencies empties prod');
});

test('an invalid policy is refused, including a mistyped field that would narrow nothing', () => {
  for (const [doc, re] of [['{', /not JSON/], ['[]', /JSON object/], ['{"version":2}', /version 2/], ['{"version":1,"automerg":{}}', /unknown field\(s\) automerg/],
    ['{"version":1,"update":{"prod":["huge"]}}', /unknown update kind/], ['{"version":1,"update":{"qa":[]}}', /not prod, dev or actions/],
    ['{"version":1,"cooldownDays":-1}', /0–365/], ['{"version":1,"automerge":{"actions":["lockfile"]}}', /actions must list only/]]) {
    assert.match(parseRepoPolicy(doc).error || '', re, doc);
  }
});

test('flags override the settings field by field', () => {
  const settings = { depsProdUpdateTypes: ['patch'], depsDevUpdateTypes: ['patch'], depsAutoMergeTypes: [], depsCooldownDays: 7 };
  assert.deepEqual(operatorPolicy({ settings, flags: { dev: ['major'], cooldown: 0 } }), { prod: ['patch'], dev: ['major'], automerge: [], cooldown: 0 });
});

const repoPolicy = JSON.parse(readFileSync(join(CW, '.github', 'dependency-updates.json'), 'utf8'));
const u = (name, dependencyType, updateType, packageEcosystem = 'npm_and_yarn') => ({ dependencyName: name, dependencyType, updateType: `version-update:semver-${updateType}`, packageEcosystem });

test('a Dependabot pull request merges only when the policy permits every dependency in it', () => {
  const ok = judge(repoPolicy, [u('actions/checkout', 'direct:production', 'minor', 'github_actions'), u('renovate', 'direct:development', 'minor')]);
  assert.ok(ok.every((v) => v.allowed), JSON.stringify(ok));
  const mixed = judge(repoPolicy, [u('actions/checkout', 'direct:production', 'patch', 'github_actions'), u('renovate', 'direct:development', 'major')]);
  assert.deepEqual(mixed.map((v) => v.allowed), [true, false]);
  assert.equal(judge(repoPolicy, [u('left-pad', 'direct:production', 'patch')])[0].allowed, false, 'zero runtime dependencies: a production update never merges itself');
  assert.equal(judge(repoPolicy, [u('braces', 'indirect', 'patch')])[0].allowed, true, 'an indirect update is a dev lockfile change in a zero-runtime repo');
  assert.equal(judge({ ...repoPolicy, zeroRuntimeDependencies: false }, [u('braces', 'indirect', 'patch')])[0].allowed, false, 'otherwise it needs prod as well');
  assert.equal(judge(repoPolicy, [u('x', 'direct:development', 'major')], { ghsa: 'GHSA-xxxx' })[0].allowed, true, 'a security update qualifies through advisories');
  assert.equal(judge(repoPolicy, [u('x', 'direct:development', 'patch', 'pip')])[0].allowed, false);
});

test('the check fails closed on an unreadable policy or update list, and writes its verdict for the workflow', () => {
  const run = (env, args = []) => spawnSync(process.execPath, [join(CW, 'bin', 'dependency-policy-check.mjs'), ...args], { cwd: CW, encoding: 'utf8', env: { ...process.env, ...env } });
  const one = JSON.stringify([u('renovate', 'direct:development', 'patch')]);
  assert.equal(run({ DEP_UPDATES_JSON: one }).status, 0);
  assert.equal(run({ DEP_UPDATES_JSON: JSON.stringify([u('renovate', 'direct:development', 'major')]) }).status, 20);
  assert.equal(run({ DEP_UPDATES_JSON: 'not json' }).status, 23);
  assert.equal(run({ DEP_UPDATES_JSON: '[]' }).status, 23);
  const d = mkdtempSync(join(tmpdir(), 'cw-policy-'));
  writeFileSync(join(d, 'p.json'), '{"version":1,"oops":true}');
  assert.equal(run({ DEP_UPDATES_JSON: one }, ['--policy', join(d, 'p.json')]).status, 23);
  const out = join(d, 'gh-output');
  writeFileSync(out, '');
  assert.equal(run({ DEP_UPDATES_JSON: JSON.stringify([u('renovate', 'direct:development', 'major')]), GITHUB_OUTPUT: out }, ['--github-output']).status, 0);
  assert.equal(readFileSync(out, 'utf8'), 'allowed=false\n');
});
