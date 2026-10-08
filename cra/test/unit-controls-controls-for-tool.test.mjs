// Maps a tool name to the control IDs of a framework, falling back to RA-5 for NIST 800-53 (cra/controls.mjs controlsForTool).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlsForTool } from '../controls.mjs';

test('returns the framework controls for a tool that has a direct check entry', () => {
  const controls = {
    checks: {
      npmAudit: { nist80053: ['SC-13', 'RA-5'] }
    }
  };
  const result = controlsForTool('npmAudit', controls);
  assert.deepEqual(result, ['SC-13', 'RA-5']);
});

test('returns the framework controls for a tool resolved via toolAliases', () => {
  const controls = {
    toolAliases: {
      'npm audit': 'npmAudit'
    },
    checks: {
      npmAudit: { nist80053: ['SC-13'] }
    }
  };
  const result = controlsForTool('npm audit', controls);
  assert.deepEqual(result, ['SC-13']);
});

test('falls back to RA-5 when the tool is unmapped and framework is nist80053', () => {
  const controls = {
    checks: {}
  };
  const result = controlsForTool('unknownTool', controls);
  assert.deepEqual(result, ['RA-5']);
});

test('returns empty array when the tool is unmapped and framework is not nist80053', () => {
  const controls = {
    checks: {}
  };
  const result = controlsForTool('unknownTool', controls, 'cis');
  assert.deepEqual(result, []);
});

test('falls back to RA-5 when the check has no entries for nist80053', () => {
  const controls = {
    checks: {
      npmAudit: { cis: ['CIS-1'] }
    }
  };
  const result = controlsForTool('npmAudit', controls, 'nist80053');
  assert.deepEqual(result, ['RA-5']);
});

test('returns empty array when the check exists but has no entries for the requested non-nist framework', () => {
  const controls = {
    checks: {
      npmAudit: { nist80053: ['SC-13'] }
    }
  };
  const result = controlsForTool('npmAudit', controls, 'cis');
  assert.deepEqual(result, []);
});

test('prefers toolAliases over direct check name when both exist', () => {
  const controls = {
    toolAliases: {
      myTool: 'otherTool'
    },
    checks: {
      myTool: { nist80053: ['SC-1'] },
      otherTool: { nist80053: ['SC-2'] }
    }
  };
  const result = controlsForTool('myTool', controls);
  assert.deepEqual(result, ['SC-2']);
});

test('returns RA-5 when toolAliases points to a check that has no entries for the framework', () => {
  const controls = {
    toolAliases: {
      myTool: 'otherTool'
    },
    checks: {
      otherTool: { cis: ['CIS-1'] }
    }
  };
  const result = controlsForTool('myTool', controls, 'nist80053');
  assert.deepEqual(result, ['RA-5']);
});
