import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { securityDrift } from '../../lib/security-drift.mjs';

describe('securityDrift', () => {
  // Helper to create a subject
  const sub = (id, kind, value, measured = true) => ({ id, kind, value, measured });

  // Valid values per kind
  const depVal = (source) => ({ source });
  const wpVal = (scopes) => ({ scopes });
  const agVal = (tools) => ({ tools });
  const supVal = (reason, expiresAt) => ({ reason, expiresAt });

  // Valid timestamps
  const ts1 = '2024-01-01T00:00:00Z';
  const ts2 = '2024-01-02T00:00:00Z';
  const ts3 = '2024-01-03T00:00:00Z';

  describe('validation', () => {
    test('throws on missing before.subjects', () => {
      assert.throws(() => securityDrift({ before: {}, after: { subjects: [] } }), /before\.subjects must be an array/);
    });
    test('throws on missing after.subjects', () => {
      assert.throws(() => securityDrift({ before: { subjects: [] }, after: {} }), /after\.subjects must be an array/);
    });
    test('throws on non-array subjects', () => {
      assert.throws(() => securityDrift({ before: { subjects: 'x' }, after: { subjects: [] } }), /before\.subjects must be an array/);
    });
    test('throws on subject missing id', () => {
      assert.throws(() => securityDrift({ before: { subjects: [{ kind: 'dependency-origin', value: {}, measured: true }] }, after: { subjects: [] } }), /before subject id must be a non-empty string/);
    });
    test('throws on empty id', () => {
      assert.throws(() => securityDrift({ before: { subjects: [{ id: '', kind: 'dependency-origin', value: {}, measured: true }] }, after: { subjects: [] } }), /before subject id must be a non-empty string/);
    });
    test('throws on unknown kind', () => {
      assert.throws(() => securityDrift({ before: { subjects: [{ id: '1', kind: 'unknown', value: {}, measured: true }] }, after: { subjects: [] } }), /before subject kind must be one of/);
    });
    test('throws on non-boolean measured', () => {
      assert.throws(() => securityDrift({ before: { subjects: [{ id: '1', kind: 'dependency-origin', value: {}, measured: 'yes' }] }, after: { subjects: [] } }), /before subject measured must be a boolean/);
    });
    test('throws on duplicate identity in before', () => {
      const subjects = [
        { id: '1', kind: 'dependency-origin', value: depVal('registry'), measured: true },
        { id: '1', kind: 'dependency-origin', value: depVal('git'), measured: true }
      ];
      assert.throws(() => securityDrift({ before: { subjects }, after: { subjects: [] } }), /Duplicate identity in before/);
    });
    test('throws on duplicate identity in after', () => {
      const subjects = [
        { id: '1', kind: 'dependency-origin', value: depVal('registry'), measured: true },
        { id: '1', kind: 'dependency-origin', value: depVal('git'), measured: true }
      ];
      assert.throws(() => securityDrift({ before: { subjects: [] }, after: { subjects } }), /Duplicate identity in after/);
    });
    test('throws on invalid dependency-origin source', () => {
      assert.throws(() => securityDrift({ before: { subjects: [{ id: '1', kind: 'dependency-origin', value: { source: 'invalid' }, measured: true }] }, after: { subjects: [] } }), /before dependency-origin value\.source must be one of/);
    });
    test('throws on invalid workflow-permissions scopes', () => {
      assert.throws(() => securityDrift({ before: { subjects: [{ id: '1', kind: 'workflow-permissions', value: { scopes: { a: 'invalid' } }, measured: true }] }, after: { subjects: [] } }), /before workflow-permissions scope level must be none, read, or write/);
    });
    test('throws on invalid agent-grant tools', () => {
      assert.throws(() => securityDrift({ before: { subjects: [{ id: '1', kind: 'agent-grant', value: { tools: [''] }, measured: true }] }, after: { subjects: [] } }), /before agent-grant tool must be a non-empty string/);
    });
    test('throws on invalid suppression reason', () => {
      assert.throws(() => securityDrift({ before: { subjects: [{ id: '1', kind: 'suppression', value: { reason: '', expiresAt: null }, measured: true }] }, after: { subjects: [] } }), /before suppression value\.reason must be a non-empty string/);
    });
    test('throws on invalid suppression expiresAt format', () => {
      assert.throws(() => securityDrift({ before: { subjects: [{ id: '1', kind: 'suppression', value: { reason: 'r', expiresAt: '2024/01/01' }, measured: true }] }, after: { subjects: [] } }), /before suppression value\.expiresAt must be a valid ISO-8601 instant with explicit zone/);
    });
    test('throws on invalid suppression expiresAt date (2023-02-30)', () => {
      assert.throws(() => securityDrift({ before: { subjects: [{ id: '1', kind: 'suppression', value: { reason: 'r', expiresAt: '2023-02-30T00:00:00Z' }, measured: true }] }, after: { subjects: [] } }), /before suppression value\.expiresAt must be a valid ISO-8601 instant with explicit zone/);
    });
    test('throws when measured false but value missing (should not throw because value ignored)', () => {
      // measured false -> value ignored, so no validation on value shape
      assert.doesNotThrow(() => securityDrift({
        before: { subjects: [{ id: '1', kind: 'dependency-origin', value: null, measured: false }] },
        after: { subjects: [] }
      }));
    });
  });

  describe('basic transitions', () => {
    test('dependency-origin left-registry', () => {
      const before = { subjects: [sub('d1', 'dependency-origin', depVal('registry'))] };
      const after = { subjects: [sub('d1', 'dependency-origin', depVal('git'))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'dependency-origin',
        id: 'd1',
        change: 'left-registry',
        before: depVal('registry'),
        after: depVal('git'),
        reviewCandidate: true
      }]);
      assert.deepEqual(result.added, []);
      assert.deepEqual(result.removed, []);
      assert.deepEqual(result.unknown, []);
    });
    test('dependency-origin origin-changed (git to archive)', () => {
      const before = { subjects: [sub('d1', 'dependency-origin', depVal('git'))] };
      const after = { subjects: [sub('d1', 'dependency-origin', depVal('archive'))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'dependency-origin',
        id: 'd1',
        change: 'origin-changed',
        before: depVal('git'),
        after: depVal('archive'),
        reviewCandidate: false
      }]);
    });
    test('workflow-permissions widened (none to read)', () => {
      const before = { subjects: [sub('w1', 'workflow-permissions', wpVal({ a: 'none' }))] };
      const after = { subjects: [sub('w1', 'workflow-permissions', wpVal({ a: 'read' }))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'workflow-permissions',
        id: 'w1',
        change: 'widened',
        before: wpVal({ a: 'none' }),
        after: wpVal({ a: 'read' }),
        reviewCandidate: true
      }]);
    });
    test('workflow-permissions widened (new scope write)', () => {
      const before = { subjects: [sub('w1', 'workflow-permissions', wpVal({ a: 'read' }))] };
      const after = { subjects: [sub('w1', 'workflow-permissions', wpVal({ a: 'read', b: 'write' }))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'workflow-permissions',
        id: 'w1',
        change: 'widened',
        before: wpVal({ a: 'read' }),
        after: wpVal({ a: 'read', b: 'write' }),
        reviewCandidate: true
      }]);
    });
    test('workflow-permissions narrowed (read to none)', () => {
      const before = { subjects: [sub('w1', 'workflow-permissions', wpVal({ a: 'read' }))] };
      const after = { subjects: [sub('w1', 'workflow-permissions', wpVal({ a: 'none' }))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'workflow-permissions',
        id: 'w1',
        change: 'narrowed',
        before: wpVal({ a: 'read' }),
        after: wpVal({ a: 'none' }),
        reviewCandidate: false
      }]);
    });
    test('agent-grant broadened (tool added)', () => {
      const before = { subjects: [sub('a1', 'agent-grant', agVal(['tool1']))] };
      const after = { subjects: [sub('a1', 'agent-grant', agVal(['tool1', 'tool2']))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'agent-grant',
        id: 'a1',
        change: 'broadened',
        before: agVal(['tool1']),
        after: agVal(['tool1', 'tool2']),
        reviewCandidate: true
      }]);
    });
    test('agent-grant broadened (star appears)', () => {
      const before = { subjects: [sub('a1', 'agent-grant', agVal(['tool1']))] };
      const after = { subjects: [sub('a1', 'agent-grant', agVal(['*']))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'agent-grant',
        id: 'a1',
        change: 'broadened',
        before: agVal(['tool1']),
        after: agVal(['*']),
        reviewCandidate: true
      }]);
    });
    test('agent-grant narrowed (tool removed)', () => {
      const before = { subjects: [sub('a1', 'agent-grant', agVal(['tool1', 'tool2']))] };
      const after = { subjects: [sub('a1', 'agent-grant', agVal(['tool1']))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'agent-grant',
        id: 'a1',
        change: 'narrowed',
        before: agVal(['tool1', 'tool2']),
        after: agVal(['tool1']),
        reviewCandidate: false
      }]);
    });
    test('suppression expiry-extended', () => {
      const before = { subjects: [sub('s1', 'suppression', supVal('reason', ts1))] };
      const after = { subjects: [sub('s1', 'suppression', supVal('reason', ts2))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'suppression',
        id: 's1',
        change: ['expiry-extended'],
        before: supVal('reason', ts1),
        after: supVal('reason', ts2),
        reviewCandidate: true
      }]);
    });
    test('suppression expiry-removed', () => {
      const before = { subjects: [sub('s1', 'suppression', supVal('reason', ts1))] };
      const after = { subjects: [sub('s1', 'suppression', supVal('reason', null))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'suppression',
        id: 's1',
        change: ['expiry-removed'],
        before: supVal('reason', ts1),
        after: supVal('reason', null),
        reviewCandidate: true
      }]);
    });
    test('suppression expiry-shortened', () => {
      const before = { subjects: [sub('s1', 'suppression', supVal('reason', ts3))] };
      const after = { subjects: [sub('s1', 'suppression', supVal('reason', ts2))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'suppression',
        id: 's1',
        change: ['expiry-shortened'],
        before: supVal('reason', ts3),
        after: supVal('reason', ts2),
        reviewCandidate: false
      }]);
    });
    test('suppression reason-changed', () => {
      const before = { subjects: [sub('s1', 'suppression', supVal('old', ts1))] };
      const after = { subjects: [sub('s1', 'suppression', supVal('new', ts1))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'suppression',
        id: 's1',
        change: ['reason-changed'],
        before: supVal('old', ts1),
        after: supVal('new', ts1),
        reviewCandidate: false
      }]);
    });
    test('suppression multiple changes (reason and expiry-extended)', () => {
      const before = { subjects: [sub('s1', 'suppression', supVal('old', ts1))] };
      const after = { subjects: [sub('s1', 'suppression', supVal('new', ts2))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, [{
        kind: 'suppression',
        id: 's1',
        change: ['reason-changed', 'expiry-extended'],
        before: supVal('old', ts1),
        after: supVal('new', ts2),
        reviewCandidate: true
      }]);
    });
  });

  describe('added and removed', () => {
    test('added subject', () => {
      const before = { subjects: [] };
      const after = { subjects: [sub('a1', 'dependency-origin', depVal('registry'))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.added, [{ kind: 'dependency-origin', id: 'a1', measured: true }]);
      assert.deepEqual(result.removed, []);
      assert.deepEqual(result.transitions, []);
      assert.deepEqual(result.unknown, []);
    });
    test('removed subject', () => {
      const before = { subjects: [sub('r1', 'dependency-origin', depVal('registry'))] };
      const after = { subjects: [] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.removed, [{ kind: 'dependency-origin', id: 'r1', measured: true }]);
      assert.deepEqual(result.added, []);
    });
    test('added subject with measured false', () => {
      const before = { subjects: [] };
      const after = { subjects: [sub('a1', 'dependency-origin', depVal('registry'), false)] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.added, [{ kind: 'dependency-origin', id: 'a1', measured: false }]);
    });
  });

  describe('unknown (unmeasured)', () => {
    test('unmeasured-before', () => {
      const before = { subjects: [sub('u1', 'dependency-origin', depVal('registry'), false)] };
      const after = { subjects: [sub('u1', 'dependency-origin', depVal('git'), true)] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.unknown, [{ kind: 'dependency-origin', id: 'u1', reason: 'unmeasured-before' }]);
      assert.deepEqual(result.transitions, []);
    });
    test('unmeasured-after', () => {
      const before = { subjects: [sub('u1', 'dependency-origin', depVal('registry'), true)] };
      const after = { subjects: [sub('u1', 'dependency-origin', depVal('git'), false)] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.unknown, [{ kind: 'dependency-origin', id: 'u1', reason: 'unmeasured-after' }]);
    });
    test('both unmeasured -> two unknown entries', () => {
      const before = { subjects: [sub('u1', 'dependency-origin', depVal('registry'), false)] };
      const after = { subjects: [sub('u1', 'dependency-origin', depVal('git'), false)] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.unknown, [
        { kind: 'dependency-origin', id: 'u1', reason: 'unmeasured-before' },
        { kind: 'dependency-origin', id: 'u1', reason: 'unmeasured-after' }
      ]);
    });
  });

  describe('sorting', () => {
    test('transitions sorted by kind then id', () => {
      const before = {
        subjects: [
          sub('z', 'workflow-permissions', wpVal({ a: 'none' })),
          sub('a', 'dependency-origin', depVal('registry')),
          sub('b', 'agent-grant', agVal(['t1'])),
          sub('c', 'suppression', supVal('r', ts1))
        ]
      };
      const after = {
        subjects: [
          sub('z', 'workflow-permissions', wpVal({ a: 'read' })),
          sub('a', 'dependency-origin', depVal('git')),
          sub('b', 'agent-grant', agVal(['t1', 't2'])),
          sub('c', 'suppression', supVal('r', ts2))
        ]
      };
      const result = securityDrift({ before, after });
      const kinds = result.transitions.map(t => t.kind);
      assert.deepEqual(kinds, ['agent-grant', 'dependency-origin', 'suppression', 'workflow-permissions']);
      const ids = result.transitions.map(t => t.id);
      assert.deepEqual(ids, ['b', 'a', 'c', 'z']);
    });
    test('added sorted', () => {
      const before = { subjects: [] };
      const after = {
        subjects: [
          sub('z', 'workflow-permissions', wpVal({ a: 'none' })),
          sub('a', 'dependency-origin', depVal('registry'))
        ]
      };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.added.map(x => x.id), ['a', 'z']);
    });
  });

  describe('equal values produce no transition', () => {
    test('dependency-origin same source', () => {
      const before = { subjects: [sub('d1', 'dependency-origin', depVal('registry'))] };
      const after = { subjects: [sub('d1', 'dependency-origin', depVal('registry'))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, []);
    });
    test('workflow-permissions same scopes', () => {
      const before = { subjects: [sub('w1', 'workflow-permissions', wpVal({ a: 'read' }))] };
      const after = { subjects: [sub('w1', 'workflow-permissions', wpVal({ a: 'read' }))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, []);
    });
    test('agent-grant same tools', () => {
      const before = { subjects: [sub('a1', 'agent-grant', agVal(['t1']))] };
      const after = { subjects: [sub('a1', 'agent-grant', agVal(['t1']))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, []);
    });
    test('suppression same reason and expiry', () => {
      const before = { subjects: [sub('s1', 'suppression', supVal('r', ts1))] };
      const after = { subjects: [sub('s1', 'suppression', supVal('r', ts1))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, []);
    });
  });

  describe('deterministic output', () => {
    test('same input yields byte-identical output regardless of subject order', () => {
      const before1 = { subjects: [sub('1', 'dependency-origin', depVal('registry')), sub('2', 'workflow-permissions', wpVal({ a: 'none' }))] };
      const after1 = { subjects: [sub('1', 'dependency-origin', depVal('git')), sub('2', 'workflow-permissions', wpVal({ a: 'read' }))] };
      const before2 = { subjects: [sub('2', 'workflow-permissions', wpVal({ a: 'none' })), sub('1', 'dependency-origin', depVal('registry'))] };
      const after2 = { subjects: [sub('2', 'workflow-permissions', wpVal({ a: 'read' })), sub('1', 'dependency-origin', depVal('git'))] };
      const result1 = securityDrift({ before: before1, after: after1 });
      const result2 = securityDrift({ before: before2, after: after2 });
      assert.deepEqual(result1, result2);
      // Ensure JSON stringify is identical
      assert.strictEqual(JSON.stringify(result1), JSON.stringify(result2));
    });
  });

  describe('edge cases', () => {
    test('a scope added at none grants nothing and is no transition', () => {
      const before = { subjects: [sub('w1', 'workflow-permissions', wpVal({ a: 'read' }))] };
      const after = { subjects: [sub('w1', 'workflow-permissions', wpVal({ a: 'read', b: 'none' }))] };
      assert.deepEqual(securityDrift({ before, after }).transitions, []);
    });
    test('a scope named like an Object.prototype key is an ordinary scope', () => {
      const before = { subjects: [sub('w1', 'workflow-permissions', wpVal({ constructor: 'read' }))] };
      const after = { subjects: [sub('w1', 'workflow-permissions', wpVal({ constructor: 'write' }))] };
      const result = securityDrift({ before, after });
      assert.equal(result.transitions[0].change, 'widened');
      assert.equal(result.transitions[0].reviewCandidate, true);
      const gone = securityDrift({ before: after, after: { subjects: [sub('w1', 'workflow-permissions', wpVal({}))] } });
      assert.equal(gone.transitions[0].change, 'narrowed');
      const granted = securityDrift({ before: { subjects: [sub('w1', 'workflow-permissions', wpVal({}))] }, after: { subjects: [sub('w1', 'workflow-permissions', wpVal({ constructor: 'read' }))] } });
      assert.equal(granted.transitions[0].change, 'widened');
      const inert = securityDrift({ before: { subjects: [sub('w1', 'workflow-permissions', wpVal({}))] }, after: { subjects: [sub('w1', 'workflow-permissions', wpVal({ toString: 'none' }))] } });
      assert.deepEqual(inert.transitions, []);
    });
    test('agent-grant tools in a different order are the same grant', () => {
      const before = { subjects: [sub('a1', 'agent-grant', agVal(['read', 'write']))] };
      const after = { subjects: [sub('a1', 'agent-grant', agVal(['write', 'read', 'read']))] };
      assert.deepEqual(securityDrift({ before, after }).transitions, []);
    });
    test('one expiry instant written in two zones is no transition', () => {
      const before = { subjects: [sub('s1', 'suppression', supVal('r', '2024-01-01T10:00:00+10:00'))] };
      const after = { subjects: [sub('s1', 'suppression', supVal('r', '2024-01-01T00:00:00Z'))] };
      assert.deepEqual(securityDrift({ before, after }).transitions, []);
    });
    test('expiries compare as instants, not as strings', () => {
      const before = { subjects: [sub('s1', 'suppression', supVal('r', '2024-01-02T00:00:00Z'))] };
      const after = { subjects: [sub('s1', 'suppression', supVal('r', '2024-01-02T09:00:00+10:00'))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions[0].change, ['expiry-shortened']);
      assert.equal(result.transitions[0].reviewCandidate, false);
    });
    test('agent-grant star in before, after has subset -> narrowed', () => {
      const before = { subjects: [sub('a1', 'agent-grant', agVal(['*']))] };
      const after = { subjects: [sub('a1', 'agent-grant', agVal(['tool1']))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions[0].change, 'narrowed');
    });
    test('suppression null to null -> no transition', () => {
      const before = { subjects: [sub('s1', 'suppression', supVal('r', null))] };
      const after = { subjects: [sub('s1', 'suppression', supVal('r', null))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, []);
    });
    test('a suppression that gains an expiry is expiry-added and narrows, not a review candidate', () => {
      const before = { subjects: [sub('s1', 'suppression', supVal('r', null))] };
      const after = { subjects: [sub('s1', 'suppression', supVal('r', ts1))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions[0].change, ['expiry-added']);
      assert.equal(result.transitions[0].reviewCandidate, false);
    });
    test('timestamp with fractional seconds and +hh:mm zone', () => {
      const ts = '2024-01-01T12:34:56.789+05:30';
      const before = { subjects: [sub('s1', 'suppression', supVal('r', ts))] };
      const after = { subjects: [sub('s1', 'suppression', supVal('r', ts))] };
      const result = securityDrift({ before, after });
      assert.deepEqual(result.transitions, []);
    });
    test('invalid timestamp (no zone) throws', () => {
      assert.throws(() => securityDrift({
        before: { subjects: [{ id: '1', kind: 'suppression', value: { reason: 'r', expiresAt: '2024-01-01T00:00:00' }, measured: true }] },
        after: { subjects: [] }
      }), /before suppression value\.expiresAt must be a valid ISO-8601 instant with explicit zone/);
    });
    test('invalid timestamp (zone +hhmm without colon) throws', () => {
      assert.throws(() => securityDrift({
        before: { subjects: [{ id: '1', kind: 'suppression', value: { reason: 'r', expiresAt: '2024-01-01T00:00:00+0530' }, measured: true }] },
        after: { subjects: [] }
      }), /before suppression value\.expiresAt must be a valid ISO-8601 instant with explicit zone/);
    });
  });
});
