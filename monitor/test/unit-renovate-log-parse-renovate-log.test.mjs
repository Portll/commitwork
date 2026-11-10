// extracts updates, repoProblems and skipped lookups from Renovate JSON log lines (monitor/renovate-log.mjs parseRenovateLog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRenovateLog } from '../renovate-log.mjs';

test('returns empty arrays when stdout is empty or non\u2011JSON', () => {
  const result = parseRenovateLog('');
  assert.deepEqual(result, { updates: [], repoProblems: [], notLookedUp: [] });

  const mixed = 'not json\n{"msg":"something else"}\n{invalid';
  const result2 = parseRenovateLog(mixed);
  assert.deepEqual(result2, { updates: [], repoProblems: [], notLookedUp: [] });
});

test('captures repoProblems when a line has msg "repoProblems"', () => {
  const log = JSON.stringify({ msg: 'repoProblems', repoProblems: ['p1', 'p2'] });
  const result = parseRenovateLog(log);
  assert.deepEqual(result.repoProblems, ['p1', 'p2']);
  assert.deepEqual(result.updates, []);
  assert.deepEqual(result.notLookedUp, []);
});

test('ignores lines without msg "packageFiles with updates"', () => {
  const log = JSON.stringify({ msg: 'other', config: { npm: [] } });
  const result = parseRenovateLog(log);
  assert.deepEqual(result, { updates: [], repoProblems: [], notLookedUp: [] });
});

test('records a skipped lookup when skipReason is in LOOKUP_NOT_PERFORMED', () => {
  const line = {
    msg: 'packageFiles with updates',
    config: {
      npm: [
        {
          packageFile: 'package.json',
          deps: [
            { depName: 'lodash', skipReason: 'github-token-required', updates: [] }
          ]
        }
      ]
    }
  };
  const result = parseRenovateLog(JSON.stringify(line));
  assert.deepEqual(result.notLookedUp, [
    { manager: 'npm', packageFile: 'package.json', depName: 'lodash', skipReason: 'github-token-required' }
  ]);
  assert.deepEqual(result.updates, []);
});

test('does not record a skipped lookup for other skipReasons', () => {
  const line = {
    msg: 'packageFiles with updates',
    config: {
      npm: [
        {
          packageFile: 'package.json',
          deps: [
            { depName: 'express', skipReason: 'some-other-reason', updates: [] }
          ]
        }
      ]
    }
  };
  const result = parseRenovateLog(JSON.stringify(line));
  assert.deepEqual(result.notLookedUp, []);
});

test('extracts update entries with all fields present', () => {
  const line = {
    msg: 'packageFiles with updates',
    config: {
      npm: [
        {
          packageFile: 'package.json',
          deps: [
            {
              depName: 'react',
              currentVersion: '16.0.0',
              updates: [
                {
                  newVersion: '17.0.0',
                  updateType: 'major',
                  branchName: 'renovate/react-17.0.0'
                }
              ]
            }
          ]
        }
      ]
    }
  };
  const result = parseRenovateLog(JSON.stringify(line));
  assert.deepEqual(result.updates, [
    {
      manager: 'npm',
      packageFile: 'package.json',
      depName: 'react',
      currentValue: '16.0.0',
      newVersion: '17.0.0',
      updateType: 'major',
      branchName: 'renovate/react-17.0.0'
    }
  ]);
});

test('uses fallback fields and null when values are missing', () => {
  const line = {
    msg: 'packageFiles with updates',
    config: {
      pip: [
        {
          packageFile: 'requirements.txt',
          deps: [
            {
              depName: 'flask',
              updates: [
                {
                }
              ]
            }
          ]
        }
      ]
    }
  };
  const result = parseRenovateLog(JSON.stringify(line));
  assert.deepEqual(result.updates, [
    {
      manager: 'pip',
      packageFile: 'requirements.txt',
      depName: 'flask',
      currentValue: null,
      newVersion: null,
      updateType: null,
      branchName: null
    }
  ]);
});

test('handles multiple managers, files and dependencies in one stdout', () => {
  const lines = [
    {
      msg: 'packageFiles with updates',
      config: {
        npm: [
          {
            packageFile: 'package.json',
            deps: [
              {
                depName: 'lodash',
                currentValue: '4.17.20',
                updates: [{ newVersion: '4.17.21', updateType: 'patch' }]
              }
            ]
          },
          {
            packageFile: 'dev.json',
            deps: [
              {
                depName: 'webpack',
                currentVersion: '5.0.0',
                updates: [{ newVersion: '5.1.0', updateType: 'minor', branchName: 'renovate/webpack-5.1.0' }]
              },
              {
                depName: 'eslint',
                skipReason: 'github-token-required',
                updates: []
              }
            ]
          }
        ],
        pip: [
          {
            packageFile: 'requirements.txt',
            deps: [
              {
                depName: 'requests',
                currentVersion: '2.25.0',
                updates: [{ newValue: '2.26.0' }]
              }
            ]
          }
        ]
      }
    },
    JSON.stringify({ msg: 'repoProblems', repoProblems: ['problem1'] })
  ].map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n');

  const result = parseRenovateLog(lines);
  assert.deepEqual(result.repoProblems, ['problem1']);
  assert.deepEqual(result.notLookedUp, [
    { manager: 'npm', packageFile: 'dev.json', depName: 'eslint', skipReason: 'github-token-required' }
  ]);
  assert.deepEqual(result.updates, [{ manager: "npm", packageFile: "package.json", depName: "lodash", currentValue: "4.17.20", newVersion: "4.17.21", updateType: "patch", branchName: null }, { manager: "npm", packageFile: "dev.json", depName: "webpack", currentValue: "5.0.0", newVersion: "5.1.0", updateType: "minor", branchName: "renovate/webpack-5.1.0" }, { manager: "pip", packageFile: "requirements.txt", depName: "requests", currentValue: "2.25.0", newVersion: "2.26.0", updateType: null, branchName: null }]);
});
