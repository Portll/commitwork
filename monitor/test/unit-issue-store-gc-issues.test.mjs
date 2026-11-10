// gcIssues returns expired claim and waiver ids and appends a gc event (monitor/issue-store.mjs gcIssues).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gcIssues } from '../issue-store.mjs';

test('returns empty arrays and no event when no issues exist', () => {
  const doc = { issues: {}, events: [] };
  const r = gcIssues(doc, { at: '2025-01-01T00:00:00.000Z' });
  assert.deepEqual(r, { expiredClaims: [], expiredWaivers: [] });
});

test('returns empty arrays and no event when claim is not expired', () => {
  const doc = {
    issues: {
      'ISS-000001': {
        id: 'ISS-000001',
        state: 'claimed',
        claim: { expiresAt: '2025-01-02T00:00:00.000Z' },
        waiver: null,
        updatedAt: '2024-12-31T00:00:00.000Z'
      }
    },
    events: []
  };
  const r = gcIssues(doc, { at: '2025-01-01T00:00:00.000Z' });
  assert.deepEqual(r, { expiredClaims: [], expiredWaivers: [] });
});

test('returns expired claim id and appends gc event when claim expires', () => {
  const doc = {
    issues: {
      'ISS-000001': {
        id: 'ISS-000001',
        state: 'claimed',
        claim: { expiresAt: '2025-01-01T00:00:00.000Z' },
        waiver: null,
        updatedAt: '2024-12-31T00:00:00.000Z'
      }
    },
    events: []
  };
  const r = gcIssues(doc, { at: '2025-01-01T00:00:00.000Z' });
  assert.deepEqual(r, { expiredClaims: ["ISS-000001"], expiredWaivers: [] });
});

test('returns empty arrays and no event when waiver is not expired', () => {
  const doc = {
    issues: {
      'ISS-000002': {
        id: 'ISS-000002',
        state: 'open',
        claim: null,
        waiver: { expiresAt: '2025-01-02T00:00:00.000Z' },
        updatedAt: '2024-12-31T00:00:00.000Z'
      }
    },
    events: []
  };
  const r = gcIssues(doc, { at: '2025-01-01T00:00:00.000Z' });
  assert.deepEqual(r, { expiredClaims: [], expiredWaivers: [] });
});

test('returns expired waiver id and appends gc event when waiver expires', () => {
  const doc = {
    issues: {
      'ISS-000002': {
        id: 'ISS-000002',
        state: 'open',
        claim: null,
        waiver: { expiresAt: '2025-01-01T00:00:00.000Z' },
        updatedAt: '2024-12-31T00:00:00.000Z'
      }
    },
    events: []
  };
  const r = gcIssues(doc, { at: '2025-01-01T00:00:00.000Z' });
  assert.deepEqual(r, { expiredClaims: [], expiredWaivers: ["ISS-000002"] });
});

test('returns both expired claim and waiver ids and appends gc event', () => {
  const doc = {
    issues: {
      'ISS-000003': {
        id: 'ISS-000003',
        state: 'claimed',
        claim: { expiresAt: '2025-01-01T00:00:00.000Z' },
        waiver: { expiresAt: '2025-01-01T00:00:00.000Z' },
        updatedAt: '2024-12-31T00:00:00.000Z'
      }
    },
    events: []
  };
  const r = gcIssues(doc, { at: '2025-01-01T00:00:00.000Z' });
  assert.deepEqual(r, { expiredClaims: ["ISS-000003"], expiredWaivers: ["ISS-000003"] });
});

test('returns empty arrays and no event when issue is open with expired claim', () => {
  const doc = {
    issues: {
      'ISS-000004': {
        id: 'ISS-000004',
        state: 'open',
        claim: { expiresAt: '2025-01-01T00:00:00.000Z' },
        waiver: null,
        updatedAt: '2024-12-31T00:00:00.000Z'
      }
    },
    events: []
  };
  const r = gcIssues(doc, { at: '2025-01-01T00:00:00.000Z' });
  assert.deepEqual(r, { expiredClaims: [], expiredWaivers: [] });
});

test('returns empty arrays and no event when issue is closed with expired claim', () => {
  const doc = {
    issues: {
      'ISS-000005': {
        id: 'ISS-000005',
        state: 'closed',
        claim: { expiresAt: '2025-01-01T00:00:00.000Z' },
        waiver: null,
        updatedAt: '2024-12-31T00:00:00.000Z'
      }
    },
    events: []
  };
  const r = gcIssues(doc, { at: '2025-01-01T00:00:00.000Z' });
  assert.deepEqual(r, { expiredClaims: [], expiredWaivers: [] });
});
