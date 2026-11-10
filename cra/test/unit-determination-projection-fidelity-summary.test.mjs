// Tallies projection fidelity and collects lost items (cra/determination-projection.mjs fidelitySummary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fidelitySummary } from '../determination-projection.mjs';

test('returns zeroed tally and empty lost for empty projections', () => {
  const r = fidelitySummary([], 'json');
  assert.deepEqual(r, { exact: 0, narrowed: 0, prose_only: 0, unrepresentable: 0, lost: [] });
});

test('tallies exact fidelity from status, justification, and response cells', () => {
  const projections = [{
    vulnId: 'v1',
    projection: {
      per: {
        json: {
          status: { fidelity: 'exact' },
          justification: { fidelity: 'exact' },
          response: { fidelity: 'exact' },
          lost: []
        }
      }
    }
  }];
  const r = fidelitySummary(projections, 'json');
  assert.deepEqual(r, { exact: 3, narrowed: 0, prose_only: 0, unrepresentable: 0, lost: [] });
});

test('tallies narrowed fidelity from status, justification, and response cells', () => {
  const projections = [{
    vulnId: 'v2',
    projection: {
      per: {
        json: {
          status: { fidelity: 'narrowed' },
          justification: { fidelity: 'narrowed' },
          response: { fidelity: 'narrowed' },
          lost: []
        }
      }
    }
  }];
  const r = fidelitySummary(projections, 'json');
  assert.deepEqual(r, { exact: 0, narrowed: 3, prose_only: 0, unrepresentable: 0, lost: [] });
});

test('tallies prose_only fidelity from status, justification, and response cells', () => {
  const projections = [{
    vulnId: 'v3',
    projection: {
      per: {
        json: {
          status: { fidelity: 'prose_only' },
          justification: { fidelity: 'prose_only' },
          response: { fidelity: 'prose_only' },
          lost: []
        }
      }
    }
  }];
  const r = fidelitySummary(projections, 'json');
  assert.deepEqual(r, { exact: 0, narrowed: 0, prose_only: 3, unrepresentable: 0, lost: [] });
});

test('tallies unrepresentable fidelity from status, justification, and response cells', () => {
  const projections = [{
    vulnId: 'v4',
    projection: {
      per: {
        json: {
          status: { fidelity: 'unrepresentable' },
          justification: { fidelity: 'unrepresentable' },
          response: { fidelity: 'unrepresentable' },
          lost: []
        }
      }
    }
  }];
  const r = fidelitySummary(projections, 'json');
  assert.deepEqual(r, { exact: 0, narrowed: 0, prose_only: 0, unrepresentable: 3, lost: [] });
});

test('collects lost items with vulnId prefix', () => {
  const projections = [{
    vulnId: 'v5',
    projection: {
      per: {
        json: {
          status: { fidelity: 'exact' },
          justification: null,
          response: null,
          lost: [{ field: 'a' }, { field: 'b' }]
        }
      }
    }
  }];
  const r = fidelitySummary(projections, 'json');
  assert.deepEqual(r, { exact: 1, narrowed: 0, prose_only: 0, unrepresentable: 0, lost: [{ vulnId: "v5", field: "a" }, { vulnId: "v5", field: "b" }] });
});

test('aggregates across multiple projections', () => {
  const projections = [
    {
      vulnId: 'v6',
      projection: {
        per: {
          json: {
            status: { fidelity: 'exact' },
            justification: { fidelity: 'narrowed' },
            response: null,
            lost: []
          }
        }
      }
    },
    {
      vulnId: 'v7',
      projection: {
        per: {
          json: {
            status: { fidelity: 'prose_only' },
            justification: null,
            response: { fidelity: 'unrepresentable' },
            lost: [{ field: 'c' }]
          }
        }
      }
    }
  ];
  const r = fidelitySummary(projections, 'json');
  assert.deepEqual(r, { exact: 1, narrowed: 1, prose_only: 1, unrepresentable: 1, lost: [{ vulnId: "v7", field: "c" }] });
});
