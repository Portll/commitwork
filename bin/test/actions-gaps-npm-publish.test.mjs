// bin/test/actions-gaps-npm-publish.test.mjs — npm-publish-unstaged.
//
// A workflow that runs `npm publish` puts the version live the moment CI reaches the step. `npm stage publish`
// queues it until a maintainer approves with 2FA. The rule is posture, so it is low.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, scanWorkflow, unstagedNpmPublish, RULE_SEV, RULE_CWE } from '../actions-gaps.mjs';

const scan = (yaml) => scanWorkflow('.github/workflows/release.yml', parseYaml(yaml)).findings.filter((f) => f.rule === 'npm-publish-unstaged');
const wf = (steps) => `name: release\non: push\npermissions:\n  contents: read\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
const step = (name, run) => `      - name: ${name}\n        run: |\n${run.split('\n').map((l) => `          ${l}`).join('\n')}\n`;

test('a direct npm publish is found, low, CWE-308, naming the step', () => {
  const f = scan(wf(step('Publish', 'npm ci\nnpm publish --provenance --access public')));
  assert.equal(f.length, 1);
  assert.deepEqual({ job: f[0].job, step: f[0].step, sev: f[0].sev, cwe: f[0].cwe }, { job: 'publish', step: 'Publish', sev: 'low', cwe: 'CWE-308' });
  assert.match(f[0].detail, /^npm publish puts the version live with no approval step/);
  assert.equal(RULE_SEV['npm-publish-unstaged'], 'low');
  assert.equal(RULE_CWE['npm-publish-unstaged'], 'CWE-308');
});

test('a staged publish is clean, and so is a dry run', () => {
  assert.equal(scan(wf(step('Stage', 'npm stage publish --provenance'))).length, 0);
  assert.equal(scan(wf(step('Check', 'npm publish --dry-run'))).length, 0);
});

test('Yarn Berry\'s yarn npm publish is found; pnpm publish is out of scope', () => {
  assert.equal(unstagedNpmPublish('yarn npm publish --tolerate-republish'), 'yarn npm publish');
  assert.equal(unstagedNpmPublish('pnpm publish --no-git-checks'), null);
  assert.equal(unstagedNpmPublish('cd pkg && npm publish'), 'npm publish');
  assert.equal(unstagedNpmPublish('npm publish'), 'npm publish');
});

test('comments and look-alike words do not fire', () => {
  assert.equal(unstagedNpmPublish('# npm publish runs in the release job'), null);
  assert.equal(unstagedNpmPublish('echo npm publishing is manual'), null);
  assert.equal(unstagedNpmPublish('npm publisher-check'), null);
});

test('one finding per job, later publishing steps counted, and the detail carries no script body', () => {
  const f = scan(wf(step('first', 'NPM_TOKEN=hunter2 npm publish ./pkg-a') + step('second', 'npm publish ./pkg-b')));
  assert.equal(f.length, 1);
  assert.equal(f[0].step, 'first');
  assert.match(f[0].detail, /1 more step\(s\) in this job publish the same way/);
  assert.doesNotMatch(f[0].detail, /hunter2|pkg-a|pkg-b/);
});
