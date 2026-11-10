// Collects undetermined CVE and scanner findings into triage rows (admin/lib/adjudication-triage.mjs collectUndetermined).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectUndetermined } from '../lib/adjudication-triage.mjs';

test('returns empty rows and skipped for null rollup', () => {
  const { rows, skipped } = collectUndetermined(null);
  assert.deepEqual(rows, []);
  assert.deepEqual(skipped, { metricLanes: {}, unkeyed: {} });
});

test('returns empty rows and skipped for non-object rollup', () => {
  const { rows, skipped } = collectUndetermined('string');
  assert.deepEqual(rows, []);
  assert.deepEqual(skipped, { metricLanes: {}, unkeyed: {} });
});

test('returns empty rows for empty repos array', () => {
  const { rows, skipped } = collectUndetermined({ repos: [] });
  assert.deepEqual(rows, []);
  assert.deepEqual(skipped, { metricLanes: {}, unkeyed: {} });
});

test('collects undetermined CVE finding with all fields', () => {
  const rollup = {
    repos: [{
      name: 'myrepo',
      findings: [{
        undetermined: true,
        id: 'CVE-2024-1234',
        package: 'lodash',
        claimedSeverity: 'high',
        undeterminedCode: 'needs-review',
        undeterminedReason: 'cannot verify',
        state: 'open',
        bornSlice: '2024-01',
        kev: true
      }]
    }]
  };
  const { rows } = collectUndetermined(rollup);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, 'cve');
  assert.equal(rows[0].repo, 'myrepo');
  assert.equal(rows[0].source, 'cve');
  assert.equal(rows[0].id, 'CVE-2024-1234');
  assert.equal(rows[0].package, 'lodash');
  assert.equal(rows[0].claimedSeverity, 'high');
  assert.equal(rows[0].code, 'needs-review');
  assert.equal(rows[0].reason, 'cannot verify');
  assert.equal(rows[0].state, 'open');
  assert.equal(rows[0].bornSlice, '2024-01');
  assert.equal(rows[0].kev, true);
});

test('skips CVE finding without undetermined flag', () => {
  const rollup = {
    repos: [{
      name: 'myrepo',
      findings: [{
        undetermined: false,
        id: 'CVE-2024-1234',
        package: 'lodash'
      }]
    }]
  };
  const { rows } = collectUndetermined(rollup);
  assert.equal(rows.length, 0);
});

test('skips CVE finding without id', () => {
  const rollup = {
    repos: [{
      name: 'myrepo',
      findings: [{
        undetermined: true,
        package: 'lodash'
      }]
    }]
  };
  const { rows } = collectUndetermined(rollup);
  assert.equal(rows.length, 0);
});

test('skips CVE finding when repo name is missing', () => {
  const rollup = {
    repos: [{
      findings: [{
        undetermined: true,
        id: 'CVE-2024-1234',
        package: 'lodash'
      }]
    }]
  };
  const { rows } = collectUndetermined(rollup);
  assert.equal(rows.length, 0);
});

test('truncates long strings to specified caps', () => {
  const longId = 'x'.repeat(100);
  const longReason = 'y'.repeat(500);
  const rollup = {
    repos: [{
      name: 'z'.repeat(200),
      findings: [{
        undetermined: true,
        id: longId,
        package: 'p'.repeat(300),
        claimedSeverity: 's'.repeat(50),
        undeterminedCode: 'c'.repeat(100),
        undeterminedReason: longReason,
        state: 't'.repeat(50),
        bornSlice: 'b'.repeat(100),
        kev: false
      }]
    }]
  };
  const { rows } = collectUndetermined(rollup);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].repo.length, 120);
  assert.equal(rows[0].id.length, 80);
  assert.equal(rows[0].package.length, 120);
  assert.equal(rows[0].claimedSeverity.length, 16);
  assert.equal(rows[0].code.length, 40);
  assert.equal(rows[0].reason.length, 300);
  assert.equal(rows[0].state.length, 24);
  assert.equal(rows[0].bornSlice.length, 40);
});

test('collects sevless scanner findings for non-metric lanes', () => {
  const rollup = {
    scannerFindings: {
      secrets: [
        { repo: 'repo1', state: 'open', bornSlice: '2024-01' },
        { repo: 'repo2', state: 'closed', bornSlice: '2024-02' }
      ]
    }
  };
  const { rows, skipped } = collectUndetermined(rollup);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].category, 'secrets');
  assert.equal(rows[0].repo, 'repo1');
  assert.equal(rows[0].source, 'scanner');
  assert.equal(rows[0].claimedSeverity, null);
  assert.equal(rows[0].code, 'ungraded');
  assert.equal(rows[0].reason, 'no verifier could be asked, so the lane assigned no severity \u2014 a person decides whether this is live');
  assert.equal(rows[0].kev, false);
  assert.equal(rows[1].repo, 'repo2');
  assert.deepEqual(skipped, { metricLanes: {}, unkeyed: {} });
});

test('skips sevless scanner findings for metric lanes', () => {
  const rollup = {
    scannerFindings: {
      stubs: [
        { repo: 'repo1', state: 'open' },
        { repo: 'repo2', state: 'closed' }
      ]
    }
  };
  const { rows, skipped } = collectUndetermined(rollup);
  assert.equal(rows.length, 0);
  assert.deepEqual(skipped.metricLanes, { stubs: 2 });
  assert.deepEqual(skipped.unkeyed, {});
});

test('skips scanner findings with severity', () => {
  const rollup = {
    scannerFindings: {
      secrets: [
        { repo: 'repo1', sev: 'high', state: 'open' }
      ]
    }
  };
  const { rows, skipped } = collectUndetermined(rollup);
  assert.equal(rows.length, 0);
  assert.deepEqual(skipped, { metricLanes: {}, unkeyed: {} });
});

test('skips scanner findings without repo', () => {
  const rollup = {
    scannerFindings: {
      secrets: [
        { state: 'open' }
      ]
    }
  };
  const { rows, skipped } = collectUndetermined(rollup);
  assert.equal(rows.length, 0);
  assert.deepEqual(skipped.metricLanes, {});
  assert.equal(skipped.unkeyed.secrets, 1);
});

test('handles non-array scannerFindings values', () => {
  const rollup = {
    scannerFindings: {
      secrets: 'not-an-array'
    }
  };
  const { rows, skipped } = collectUndetermined(rollup);
  assert.equal(rows.length, 0);
  assert.deepEqual(skipped, { metricLanes: {}, unkeyed: {} });
});
