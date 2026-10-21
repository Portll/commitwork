import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRenovateLog } from '../renovate-log.mjs';

const line = (o) => JSON.stringify(o);
const packageFiles = (config) => line({ level: 20, msg: 'packageFiles with updates', config });

test('a dependency renovate never looked up is reported, not counted as up to date', () => {
  const out = parseRenovateLog([
    line({ level: 40, msg: 'GitHub token is required for some dependencies', githubDeps: ['actions/checkout'] }),
    packageFiles({
      'github-actions': [{ packageFile: '.github/workflows/ci.yml', deps: [
        { depName: 'actions/checkout', currentValue: 'v4.4.0', skipReason: 'github-token-required' },
        { depName: 'ubuntu', currentValue: 'latest', skipReason: 'invalid-version' },
      ] }],
      npm: [{ packageFile: 'package.json', deps: [
        { depName: 'renovate', currentValue: '^43.271.3', updates: [{ newVersion: '44.140.0', updateType: 'major', branchName: 'renovate/renovate-44.x' }] },
      ] }],
    }),
  ].join('\n'));
  assert.equal(out.updates.length, 1);
  assert.deepEqual(out.notLookedUp, [
    { manager: 'github-actions', packageFile: '.github/workflows/ci.yml', depName: 'actions/checkout', skipReason: 'github-token-required' },
  ]);
});

test('a skip that is a judgement about the version is not a missing lookup', () => {
  const out = parseRenovateLog(packageFiles({
    'github-actions': [{ packageFile: 'ci.yml', deps: [{ depName: 'ubuntu', skipReason: 'invalid-version' }] }],
  }));
  assert.deepEqual(out.notLookedUp, []);
});

test('non-JSON lines and other messages are ignored; repoProblems is carried', () => {
  const out = parseRenovateLog(['npm notice', line({ msg: 'repoProblems', repoProblems: [{ message: 'x' }] }), ''].join('\n'));
  assert.deepEqual(out, { updates: [], repoProblems: [{ message: 'x' }], notLookedUp: [] });
});
