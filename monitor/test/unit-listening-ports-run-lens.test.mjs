// Diff of listening ports against the stored baseline (monitor/listening-ports.mjs runLens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLens } from '../listening-ports.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASELINE_AT = '2024-01-01T00:00:00Z';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const quiet = () => ({ listeners: [], method: 'ss' });
const emptyDiff = {
  method: 'ss', ports: 0, added: [], changed: [], removed: [],
  unchanged: 0, unverified: [], unbaselined: [], unknowns: [],
};

const body = ({ at, ...rest }) => {
  assert.match(at, ISO);
  return rest;
};

const withBaseline = (content, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'runLens-'));
  const path = join(dir, 'baseline.json');
  try {
    process.env.CW_PORTS_BASELINE = path;
    if (content !== undefined) writeFileSync(path, JSON.stringify(content));
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_PORTS_BASELINE;
  }
};

test('An enumeration error with a code reports that code as the unknown detail', () => {
  withBaseline({ at: BASELINE_AT, items: [] }, () => {
    const exec = () => { throw Object.assign(new Error('boom'), { code: 'ENOENT' }); };
    assert.deepEqual(body(runLens({ platform: 'linux', exec })), {
      unknown: true, unknownReason: 'tool-failed', unknownDetail: 'enumerate: ENOENT', state: 'unknown',
    });
  });
});

test('An enumeration error without a code reports its message as the unknown detail', () => {
  withBaseline({ at: BASELINE_AT, items: [] }, () => {
    const exec = () => { throw new Error('permission denied'); };
    assert.deepEqual(body(runLens({ platform: 'linux', exec })), {
      unknown: true, unknownReason: 'tool-failed', unknownDetail: 'enumerate: permission denied', state: 'unknown',
    });
  });
});

test('A missing baseline file gives the no-baseline state with a null baselineAt', () => {
  withBaseline(undefined, () => {
    assert.deepEqual(body(runLens({ platform: 'linux', exec: quiet })), {
      ...emptyDiff, baselineAt: null, state: 'no-baseline',
    });
  });
});

test('An empty baseline with no observed ports is ok and carries the baseline timestamp', () => {
  withBaseline({ at: BASELINE_AT, items: [] }, () => {
    assert.deepEqual(body(runLens({ platform: 'linux', exec: quiet })), {
      ...emptyDiff, baselineAt: BASELINE_AT, state: 'ok',
    });
  });
});

test('A baseline port that is no longer observed is listed as removed with its full item', () => {
  const item = { id: 'port:80', kind: 'listener', port: 80, ifaces: ['ipv4'], commands: ['nginx'], sha256: 'abc' };
  withBaseline({ at: BASELINE_AT, items: [item] }, () => {
    assert.deepEqual(body(runLens({ platform: 'linux', exec: quiet })), {
      ...emptyDiff, baselineAt: BASELINE_AT, removed: [item], state: 'findings',
    });
  });
});

test('A baseline object without an items array throws', () => {
  withBaseline({ at: BASELINE_AT }, () => {
    assert.throws(() => runLens({ platform: 'linux', exec: quiet }), {
      name: 'Error', message: 'baseline has no items[]',
    });
  });
});

test('A baseline file holding null throws', () => {
  withBaseline(null, () => {
    assert.throws(() => runLens({ platform: 'linux', exec: quiet }), {
      name: 'Error', message: 'baseline has no items[]',
    });
  });
});

test('A baseline read failure other than a missing file is rethrown', () => {
  withBaseline(undefined, (path) => {
    mkdirSync(path);
    assert.throws(() => runLens({ platform: 'linux', exec: quiet }), { name: 'Error', code: 'EISDIR' });
  });
});
