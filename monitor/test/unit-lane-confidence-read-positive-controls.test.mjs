// Per-lane positive-control outcomes from a JSON record or canary evidence (monitor/lane-confidence.mjs readPositiveControls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPositiveControls } from '../lane-confidence.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (run) => {
  const dir = mkdtempSync(join(tmpdir(), 'readPositiveControls-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const writeDoc = (dir, value) => {
  const p = join(dir, 'controls.json');
  writeFileSync(p, JSON.stringify(value));
  return p;
};

const shapeMessage = (p) => `${p}: a positive-control record is an object keyed by lane`;
const laneMessage = (p, lane) => `${p}: lane '${lane}' needs an outcome from detected|missed|not-run`;

test('a missing file is reported as unread with no lanes', () => {
  withDir((dir) => {
    const p = join(dir, 'missing.json');
    assert.deepEqual(readPositiveControls({ path: p }), { source: 'positive-controls', path: p, read: false, lanes: {} });
  });
});

test('text that is not JSON rethrows the parse error', () => {
  withDir((dir) => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    assert.throws(() => readPositiveControls({ path: p }), {
      name: 'SyntaxError',
      message: `Unexpected token 'o', "not json" is not valid JSON`,
    });
  });
});

test('a read failure other than a missing file is rethrown', () => {
  withDir((dir) => {
    assert.throws(() => readPositiveControls({ path: dir }), {
      name: 'Error',
      code: 'EISDIR',
      message: 'EISDIR: illegal operation on a directory, read',
    });
  });
});

test('a document that is not a plain object is rejected', () => {
  withDir((dir) => {
    for (const doc of [[], [1, 2], null, 0, 5, '', 'detected', false, true]) {
      const p = writeDoc(dir, doc);
      assert.throws(() => readPositiveControls({ path: p }), { name: 'Error', message: shapeMessage(p) });
    }
  });
});

test('a lanes object is read in sorted order and keys beside it are ignored', () => {
  withDir((dir) => {
    const p = writeDoc(dir, {
      note: 'not a lane',
      lanes: {
        gamma: { outcome: 'not-run', ranAt: null, extra: 1 },
        beta: { outcome: 'missed', ranAt: '2024-01-01' },
        alpha: { outcome: 'detected' },
      },
    });
    const r = readPositiveControls({ path: p });
    assert.deepEqual(r, {
      source: 'positive-controls',
      path: p,
      read: true,
      lanes: {
        alpha: { ranAt: null, outcome: 'detected' },
        beta: { ranAt: '2024-01-01', outcome: 'missed' },
        gamma: { ranAt: null, outcome: 'not-run' },
      },
    });
    assert.deepEqual(Object.keys(r.lanes), ['alpha', 'beta', 'gamma']);
  });
});

test('a document without a lanes key is itself the lane map', () => {
  withDir((dir) => {
    const p = writeDoc(dir, { gamma: { outcome: 'not-run', ranAt: '' }, delta: { outcome: 'detected', ranAt: 0 } });
    assert.deepEqual(readPositiveControls({ path: p }), {
      source: 'positive-controls',
      path: p,
      read: true,
      lanes: { delta: { ranAt: 0, outcome: 'detected' }, gamma: { ranAt: '', outcome: 'not-run' } },
    });
    for (const doc of [{}, { lanes: {} }]) {
      const empty = writeDoc(dir, doc);
      assert.deepEqual(readPositiveControls({ path: empty }), { source: 'positive-controls', path: empty, read: true, lanes: {} });
    }
  });
});

test('a lanes value that is not an object is checked as a lane of the document', () => {
  withDir((dir) => {
    for (const lanes of [[], [{ outcome: 'detected' }], 'detected', 7, true, 0, '', false, null]) {
      const p = writeDoc(dir, { lanes });
      assert.throws(() => readPositiveControls({ path: p }), { name: 'Error', message: laneMessage(p, 'lanes') });
    }
  });
});

test('a lane record without a known outcome is rejected, naming the first such lane in sorted order', () => {
  withDir((dir) => {
    const bad = [null, 0, '', false, 'detected', 1, true, [], ['detected'], {}, { outcome: null }, { outcome: 'bogus' }, { outcome: 'Detected' }, { ranAt: '2024-01-01' }];
    for (const record of bad) {
      const p = writeDoc(dir, { lanes: { alpha: record } });
      assert.throws(() => readPositiveControls({ path: p }), { name: 'Error', message: laneMessage(p, 'alpha') });
    }
    const p = writeDoc(dir, { zeta: { outcome: 'bogus' }, beta: null, alpha: { outcome: 'missed' } });
    assert.throws(() => readPositiveControls({ path: p }), { name: 'Error', message: laneMessage(p, 'beta') });
  });
});

test('CW_POSITIVE_CONTROLS supplies the path when no arguments are given', () => {
  withDir((dir) => {
    const p = writeDoc(dir, { alpha: { outcome: 'missed', ranAt: '2024-02-03' } });
    const saved = process.env.CW_POSITIVE_CONTROLS;
    process.env.CW_POSITIVE_CONTROLS = p;
    try {
      assert.deepEqual(readPositiveControls(), {
        source: 'positive-controls',
        path: p,
        read: true,
        lanes: { alpha: { ranAt: '2024-02-03', outcome: 'missed' } },
      });
    } finally {
      if (saved === undefined) delete process.env.CW_POSITIVE_CONTROLS;
      else process.env.CW_POSITIVE_CONTROLS = saved;
    }
  });
});

test('an empty path uses canary evidence from the given directory, which has no lanes when empty', () => {
  withDir((dir) => {
    const { source, lanes } = readPositiveControls({ path: '', canaryDir: dir });
    assert.deepEqual({ source, lanes }, { source: 'scan-canary', lanes: {} });
  });
});
