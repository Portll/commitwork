// Builds the commit message for an npm update (bin/lib/npm-update.mjs commitMessage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitMessage } from '../lib/npm-update.mjs';

test('single direct package at root with no transitive or lockfile changes', () => {
  const r = commitMessage({
    id: 'id1',
    pkgPath: '.',
    sel: { direct: [{ name: 'left-pad', type: 'prod' }] },
    changes: [{ step: 'direct', path: 'node_modules/left-pad', name: 'left-pad', from: '1.0.0', to: '1.1.0', exposure: 'prod' }],
    after: { advisories: { error: null, counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, prod: { critical: 0, high: 0 } } },
    notes: []
  });
  assert.equal(r, "chore(deps): update 1 npm package\n\n- left-pad 1.0.0 \u2192 1.1.0 (prod, prod)\n\nAdvisories after: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0 (shipped: critical 0 \u00b7 high 0)\n\nCommitwork-Deps-Proposal: id1\nCommitwork-Deps-Path: .");
});

test('two direct packages where one is transitive and one is in lockfile', () => {
  const r = commitMessage({
    id: 'id2',
    pkgPath: 'packages/app',
    sel: { direct: [{ name: 'left-pad', type: 'prod' }, { name: 'lodash', type: 'dev' }] },
    changes: [
      { step: 'direct', path: 'node_modules/left-pad', name: 'left-pad', from: '1.0.0', to: '1.1.0', exposure: 'prod' },
      { step: 'direct', path: 'node_modules/lodash', name: 'lodash', from: '4.17.0', to: '4.17.21', exposure: 'dev' },
      { step: 'lockfile', path: 'node_modules/semver', name: 'semver', from: '7.0.0', to: '7.1.0', exposure: 'prod' }
    ],
    after: { advisories: { error: null, counts: { critical: 1, high: 2, moderate: 3, low: 4, info: 5 }, prod: { critical: 1, high: 2 } } },
    notes: []
  });
  assert.equal(r, "chore(deps): update 3 npm packages in packages/app\n\n- left-pad 1.0.0 \u2192 1.1.0 (prod, prod)\n- lodash 4.17.0 \u2192 4.17.21 (dev, dev)\n- 1 transitive package refreshed within declared ranges (lockfile)\n\nAdvisories after: critical 1 \u00b7 high 2 \u00b7 moderate 3 \u00b7 low 4 (shipped: critical 1 \u00b7 high 2)\n\nCommitwork-Deps-Proposal: id2\nCommitwork-Deps-Path: packages/app");
});

test('advisories step with two packages and notes present', () => {
  const r = commitMessage({
    id: 'id3',
    pkgPath: '.',
    sel: { direct: [] },
    changes: [
      { step: 'advisories', path: 'node_modules/pkg-a', name: 'pkg-a', from: '1.0.0', to: '1.0.1', exposure: 'prod' },
      { step: 'advisories', path: 'node_modules/pkg-b', name: 'pkg-b', from: null, to: '2.0.0', exposure: 'dev' }
    ],
    after: { advisories: { error: null, counts: { critical: 0, high: 0, moderate: 1, low: 0, info: 0 }, prod: { critical: 0, high: 0 } } },
    notes: ['note one', 'note two']
  });
  assert.equal(r, "chore(deps): update 2 npm packages\n\n- 2 packages changed by npm audit fix (advisories): pkg-a 1.0.0 \u2192 1.0.1, pkg-b \u2205 \u2192 2.0.0\n- note one\n- note two\n\nAdvisories after: critical 0 \u00b7 high 0 \u00b7 moderate 1 \u00b7 low 0 (shipped: critical 0 \u00b7 high 0)\n\nCommitwork-Deps-Proposal: id3\nCommitwork-Deps-Path: .");
});

test('advisories step with three packages and audit error present', () => {
  const r = commitMessage({
    id: 'id4',
    pkgPath: 'packages/lib',
    sel: { direct: [] },
    changes: [
      { step: 'advisories', path: 'node_modules/a', name: 'a', from: '1.0.0', to: '1.0.1', exposure: 'prod' },
      { step: 'advisories', path: 'node_modules/b', name: 'b', from: '2.0.0', to: '2.0.1', exposure: 'prod' },
      { step: 'advisories', path: 'node_modules/c', name: 'c', from: '3.0.0', to: '3.0.1', exposure: 'dev' }
    ],
    after: { advisories: { error: 'audit failed', counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, prod: { critical: 0, high: 0 } } },
    notes: []
  });
  assert.equal(r, "chore(deps): update 3 npm packages in packages/lib\n\n- 3 packages changed by npm audit fix (advisories): a 1.0.0 \u2192 1.0.1, b 2.0.0 \u2192 2.0.1, c 3.0.0 \u2192 3.0.1\n\nCommitwork-Deps-Proposal: id4\nCommitwork-Deps-Path: packages/lib");
});

test('single transitive direct package with no lockfile or advisories', () => {
  const r = commitMessage({
    id: 'id5',
    pkgPath: '.',
    sel: { direct: [{ name: 'left-pad', type: 'prod' }] },
    changes: [
      { step: 'direct', path: 'node_modules/left-pad', name: 'left-pad', from: '1.0.0', to: '1.1.0', exposure: 'prod' },
      { step: 'direct', path: 'node_modules/other', name: 'other', from: '2.0.0', to: '2.1.0', exposure: 'prod' }
    ],
    after: { advisories: { error: null, counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, prod: { critical: 0, high: 0 } } },
    notes: []
  });
  assert.equal(r, "chore(deps): update 2 npm packages\n\n- left-pad 1.0.0 \u2192 1.1.0 (prod, prod)\n- 1 transitive package moved with them\n\nAdvisories after: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0 (shipped: critical 0 \u00b7 high 0)\n\nCommitwork-Deps-Proposal: id5\nCommitwork-Deps-Path: .");
});

test('lockfile step with two packages and no direct changes', () => {
  const r = commitMessage({
    id: 'id6',
    pkgPath: '.',
    sel: { direct: [] },
    changes: [
      { step: 'lockfile', path: 'node_modules/semver', name: 'semver', from: '7.0.0', to: '7.1.0', exposure: 'prod' },
      { step: 'lockfile', path: 'node_modules/ajv', name: 'ajv', from: '8.0.0', to: '8.1.0', exposure: 'dev' }
    ],
    after: { advisories: { error: null, counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, prod: { critical: 0, high: 0 } } },
    notes: []
  });
  assert.equal(r, "chore(deps): update 2 npm packages\n\n- 2 transitive packages refreshed within declared ranges (lockfile)\n\nAdvisories after: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0 (shipped: critical 0 \u00b7 high 0)\n\nCommitwork-Deps-Proposal: id6\nCommitwork-Deps-Path: .");
});

test('single lockfile package with advisories error and notes', () => {
  const r = commitMessage({
    id: 'id7',
    pkgPath: 'packages/app',
    sel: { direct: [] },
    changes: [
      { step: 'lockfile', path: 'node_modules/semver', name: 'semver', from: '7.0.0', to: '7.1.0', exposure: 'prod' }
    ],
    after: { advisories: { error: 'network error', counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, prod: { critical: 0, high: 0 } } },
    notes: ['custom note']
  });
  assert.equal(r, "chore(deps): update 1 npm package in packages/app\n\n- 1 transitive package refreshed within declared ranges (lockfile)\n- custom note\n\nCommitwork-Deps-Proposal: id7\nCommitwork-Deps-Path: packages/app");
});

test('three direct packages all matching sel.direct with no other steps', () => {
  const r = commitMessage({
    id: 'id8',
    pkgPath: '.',
    sel: { direct: [{ name: 'a', type: 'prod' }, { name: 'b', type: 'dev' }, { name: 'c', type: 'prod' }] },
    changes: [
      { step: 'direct', path: 'node_modules/a', name: 'a', from: '1.0.0', to: '1.1.0', exposure: 'prod' },
      { step: 'direct', path: 'node_modules/b', name: 'b', from: '2.0.0', to: '2.1.0', exposure: 'dev' },
      { step: 'direct', path: 'node_modules/c', name: 'c', from: '3.0.0', to: '3.1.0', exposure: 'prod' }
    ],
    after: { advisories: { error: null, counts: { critical: 2, high: 3, moderate: 4, low: 5, info: 6 }, prod: { critical: 2, high: 3 } } },
    notes: []
  });
  assert.equal(r, "chore(deps): update 3 npm packages\n\n- a 1.0.0 \u2192 1.1.0 (prod, prod)\n- b 2.0.0 \u2192 2.1.0 (dev, dev)\n- c 3.0.0 \u2192 3.1.0 (prod, prod)\n\nAdvisories after: critical 2 \u00b7 high 3 \u00b7 moderate 4 \u00b7 low 5 (shipped: critical 2 \u00b7 high 3)\n\nCommitwork-Deps-Proposal: id8\nCommitwork-Deps-Path: .");
});
