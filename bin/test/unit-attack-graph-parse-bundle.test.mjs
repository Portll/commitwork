// Maps a STIX bundle to techniques, tactics, and dropped counts (bin/attack-graph.mjs parseBundle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBundle } from '../attack-graph.mjs';

test('returns empty structures for null or undefined input', () => {
  assert.deepEqual(parseBundle(null), { techniques: {}, tactics: {}, dropped: { deprecated: 0, revoked: 0, noId: 0 } });
  assert.deepEqual(parseBundle(undefined), { techniques: {}, tactics: {}, dropped: { deprecated: 0, revoked: 0, noId: 0 } });
});

test('returns empty structures for object without objects array', () => {
  assert.deepEqual(parseBundle({}), { techniques: {}, tactics: {}, dropped: { deprecated: 0, revoked: 0, noId: 0 } });
  assert.deepEqual(parseBundle({ objects: null }), { techniques: {}, tactics: {}, dropped: { deprecated: 0, revoked: 0, noId: 0 } });
});

test('parses tactics with shortname and extracts attack id', () => {
  const bundle = { objects: [
    { type: 'x-mitre-tactic', x_mitre_shortname: 'Execution', name: 'Execution', external_references: [{ source_name: 'mitre-attack', external_id: 'TA0002' }] },
    { type: 'x-mitre-tactic', x_mitre_shortname: 'Persistence', name: 'Persistence', external_references: [{ source_name: 'mitre-attack', external_id: 'TA0003' }] }
  ]};
  const result = parseBundle(bundle);
  assert.deepEqual(result.tactics, {
    Execution: { name: 'Execution', id: 'TA0002' },
    Persistence: { name: 'Persistence', id: 'TA0003' }
  });
  assert.deepEqual(result.techniques, {});
  assert.deepEqual(result.dropped, { deprecated: 0, revoked: 0, noId: 0 });
});

test('skips tactics without shortname', () => {
  const bundle = { objects: [
    { type: 'x-mitre-tactic', name: 'No Shortname', external_references: [{ source_name: 'mitre-attack', external_id: 'TA0001' }] },
    { type: 'x-mitre-tactic', x_mitre_shortname: '', name: 'Empty Shortname' }
  ]};
  const result = parseBundle(bundle);
  assert.deepEqual(result.tactics, {});
});

test('counts deprecated attack patterns as dropped', () => {
  const bundle = { objects: [
    { type: 'attack-pattern', x_mitre_deprecated: true, name: 'Old Tech', external_references: [{ source_name: 'mitre-attack', external_id: 'T1000' }] },
    { type: 'attack-pattern', x_mitre_deprecated: true, name: 'Older Tech', external_references: [{ source_name: 'mitre-attack', external_id: 'T1001' }] }
  ]};
  const result = parseBundle(bundle);
  assert.deepEqual(result.dropped, { deprecated: 2, revoked: 0, noId: 0 });
  assert.deepEqual(result.techniques, {});
});

test('counts revoked attack patterns as dropped', () => {
  const bundle = { objects: [
    { type: 'attack-pattern', revoked: true, name: 'Revoked Tech', external_references: [{ source_name: 'mitre-attack', external_id: 'T1002' }] }
  ]};
  const result = parseBundle(bundle);
  assert.deepEqual(result.dropped, { deprecated: 0, revoked: 1, noId: 0 });
  assert.deepEqual(result.techniques, {});
});

test('counts attack patterns without attack id as dropped', () => {
  const bundle = { objects: [
    { type: 'attack-pattern', name: 'No Ref', external_references: [{ source_name: 'other', external_id: 'X1' }] },
    { type: 'attack-pattern', name: 'Empty Refs', external_references: [] },
    { type: 'attack-pattern', name: 'No Refs Key' }
  ]};
  const result = parseBundle(bundle);
  assert.deepEqual(result.dropped, { deprecated: 0, revoked: 0, noId: 3 });
  assert.deepEqual(result.techniques, {});
});

test('parses technique with tactics from kill chain phases', () => {
  const bundle = { objects: [
    { type: 'attack-pattern', name: 'PowerShell', external_references: [{ source_name: 'mitre-attack', external_id: 'T1059.001' }],
      kill_chain_phases: [
        { kill_chain_name: 'mitre-attack', phase_name: 'Execution' },
        { kill_chain_name: 'mitre-attack', phase_name: 'Defense Evasion' },
        { kill_chain_name: 'other-chain', phase_name: 'Ignored' },
        { kill_chain_name: 'mitre-attack', phase_name: 'Execution' }
      ]
    }
  ]};
  const result = parseBundle(bundle);
  assert.deepEqual(result.techniques, {
    'T1059.001': { name: 'PowerShell', tactics: ['Defense Evasion', 'Execution'], parent: 'T1059' }
  });
});

test('parses technique without sub-technique dot has no parent', () => {
  const bundle = { objects: [
    { type: 'attack-pattern', name: 'Process Injection', external_references: [{ source_name: 'mitre-attack', external_id: 'T1055' }],
      kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'Defense Evasion' }]
    }
  ]};
  const result = parseBundle(bundle);
  assert.deepEqual(result.techniques, {
    'T1055': { name: 'Process Injection', tactics: ['Defense Evasion'] }
  });
});

test('ignores non-attack-pattern and non-tactic object types', () => {
  const bundle = { objects: [
    { type: 'identity', name: 'Some Identity' },
    { type: 'malware', name: 'Some Malware' },
    { type: 'attack-pattern', name: 'Valid', external_references: [{ source_name: 'mitre-attack', external_id: 'T1000' }] }
  ]};
  const result = parseBundle(bundle);
  assert.deepEqual(result.techniques, { 'T1000': { name: 'Valid' } });
  assert.deepEqual(result.tactics, {});
  assert.deepEqual(result.dropped, { deprecated: 0, revoked: 0, noId: 0 });
});
