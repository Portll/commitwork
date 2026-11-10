// Carries undetermined status from OSV rows to matching npm rows (monitor/advisory-reach.mjs inheritUndetermined).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inheritUndetermined } from '../advisory-reach.mjs';

test('returns npmRows unchanged when advisory reach is disabled', () => {
  process.env.CW_ADVISORY_REACH = 'off';
  const npmRows = [{ id: 'npm-1', package: 'lodash', version: '4.17.21' }];
  const result = inheritUndetermined([{ id: 'osv-1', package: 'lodash', undetermined: true, aliases: ['npm-1'] }], npmRows);
  assert.deepEqual(result, [{ id: "npm-1", package: "lodash", version: "4.17.21" }]);
  delete process.env.CW_ADVISORY_REACH;
});

test('returns empty array when disabled and npmRows is null', () => {
  process.env.CW_ADVISORY_REACH = 'off';
  const result = inheritUndetermined([{ id: 'osv-1', package: 'lodash', undetermined: true, aliases: ['npm-1'] }], null);
  assert.deepEqual(result, []);
  delete process.env.CW_ADVISORY_REACH;
});

test('returns npmRows unchanged when no OSV rows are undetermined', () => {
  const npmRows = [{ id: 'npm-1', package: 'lodash', version: '4.17.21' }];
  const result = inheritUndetermined([{ id: 'osv-1', package: 'lodash', severity: 'high' }], npmRows);
  assert.deepEqual(result, [{ id: "npm-1", package: "lodash", version: "4.17.21" }]);
});

test('returns empty array when no undetermined OSV rows and npmRows is null', () => {
  const result = inheritUndetermined([{ id: 'osv-1', package: 'lodash', severity: 'high' }], null);
  assert.deepEqual(result, []);
});

test('returns npmRows unchanged when npmRows is null and undetermined OSV rows exist', () => {
  const result = inheritUndetermined([{ id: 'osv-1', package: 'lodash', undetermined: true, aliases: ['npm-1'] }], null);
  assert.deepEqual(result, []);
});

test('returns npm row unchanged when it is already undetermined', () => {
  const npmRows = [{ id: 'npm-1', package: 'lodash', version: '4.17.21', undetermined: true }];
  const result = inheritUndetermined([{ id: 'osv-1', package: 'lodash', undetermined: true, aliases: ['npm-1'] }], npmRows);
  assert.deepEqual(result, [{ id: "npm-1", package: "lodash", version: "4.17.21", undetermined: true }]);
});

test('returns npm row unchanged when no OSV twin matches', () => {
  const npmRows = [{ id: 'npm-1', package: 'lodash', version: '4.17.21' }];
  const result = inheritUndetermined([{ id: 'osv-1', package: 'other-pkg', undetermined: true, aliases: ['npm-1'] }], npmRows);
  assert.deepEqual(result, [{ id: "npm-1", package: "lodash", version: "4.17.21" }]);
});

test('inherits undetermined status from matching OSV twin', () => {
  const npmRows = [{ id: 'npm-1', package: 'lodash', version: '4.17.21', severity: 'high' }];
  const result = inheritUndetermined([{ id: 'osv-1', package: 'lodash', undetermined: true, aliases: ['npm-1'], unknownReason: 'subject-mismatch', undeterminedCode: 'X', undeterminedReason: 'reason text' }], npmRows);
  assert.deepEqual(result, [{ id: "npm-1", package: "lodash", version: "4.17.21", severity: "unknown", undetermined: true, unknown: true, unknownReason: "subject-mismatch", undeterminedCode: "X", undeterminedReason: "reason text \u2014 carried from osv-1, which names this advisory in its alias group; npm audit reports the version as '4.17.21' and does not record that it came from outside the registry", claimedSeverity: "high" }]);
});

test('returns npm row unchanged when OSV aliases is not an array', () => {
  const npmRows = [{ id: 'npm-1', package: 'lodash', version: '4.17.21' }];
  const result = inheritUndetermined([{ id: 'osv-1', package: 'lodash', undetermined: true, aliases: 'npm-1' }], npmRows);
  assert.deepEqual(result, [{ id: "npm-1", package: "lodash", version: "4.17.21" }]);
});

test('returns npm row unchanged when OSV package is falsy', () => {
  const npmRows = [{ id: 'npm-1', package: 'lodash', version: '4.17.21' }];
  const result = inheritUndetermined([{ id: 'osv-1', package: null, undetermined: true, aliases: ['npm-1'] }], npmRows);
  assert.deepEqual(result, [{ id: "npm-1", package: "lodash", version: "4.17.21" }]);
});
