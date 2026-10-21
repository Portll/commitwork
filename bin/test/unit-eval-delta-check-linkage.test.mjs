// Classifies residual findings as linked, unlinked, missing, or accepted based on backlog file contents (bin/eval-delta.mjs checkLinkage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinkage } from '../eval-delta.mjs';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns linkage-unknown when backlog file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkLinkage-'));
  try {
    const backlogPath = join(dir, 'missing.md');
    const result = checkLinkage(
      [{ ref: 'R1', nonActionable: false }, { ref: null, nonActionable: true }],
      backlogPath
    );
    assert.deepEqual(result, {
      state: 'linkage-unknown',
      reason: `backlog at ${backlogPath} is absent \u2014 reporting UNKNOWN, never "all filed"`,
      linked: [],
      unlinked: [{ ref: 'R1', nonActionable: false }],
      missingRefs: [],
      accepted: [{ ref: null, nonActionable: true }]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns linkage-unknown when backlog file is unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkLinkage-'));
  try {
    const backlogPath = join(dir, 'backlog.md');
    writeFileSync(backlogPath, 'content');
    chmodSync(backlogPath, 0o000);
    const result = checkLinkage(
      [{ ref: 'R1', nonActionable: false }],
      backlogPath
    );
    assert.equal(result.state, 'linkage-unknown');
    assert.ok(result.reason.includes('unreadable'));
    assert.deepEqual(result.linked, []);
    assert.deepEqual(result.unlinked, [{ ref: 'R1', nonActionable: false }]);
    assert.deepEqual(result.missingRefs, []);
    assert.deepEqual(result.accepted, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies residual with nonActionable as accepted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkLinkage-'));
  try {
    const backlogPath = join(dir, 'backlog.md');
    writeFileSync(backlogPath, '| R1 | something |\n');
    const result = checkLinkage(
      [{ ref: 'R1', nonActionable: true }],
      backlogPath
    );
    assert.deepEqual(result, {
      state: 'checked',
      linked: [],
      unlinked: [],
      missingRefs: [],
      accepted: [{ ref: 'R1', nonActionable: true }]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies residual without ref as unlinked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkLinkage-'));
  try {
    const backlogPath = join(dir, 'backlog.md');
    writeFileSync(backlogPath, '| R1 | something |\n');
    const result = checkLinkage(
      [{ ref: null, nonActionable: false }],
      backlogPath
    );
    assert.deepEqual(result, {
      state: 'checked',
      linked: [],
      unlinked: [{ ref: null, nonActionable: false }],
      missingRefs: [],
      accepted: []
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies residual with ref found in backlog as linked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkLinkage-'));
  try {
    const backlogPath = join(dir, 'backlog.md');
    writeFileSync(backlogPath, '| R1 | something |\n| R2 | other |\n');
    const result = checkLinkage(
      [{ ref: 'R1', nonActionable: false }],
      backlogPath
    );
    assert.deepEqual(result, {
      state: 'checked',
      linked: [{ ref: 'R1', nonActionable: false }],
      unlinked: [],
      missingRefs: [],
      accepted: []
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies residual with ref not in backlog as missingRefs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkLinkage-'));
  try {
    const backlogPath = join(dir, 'backlog.md');
    writeFileSync(backlogPath, '| R1 | something |\n');
    const result = checkLinkage(
      [{ ref: 'R99', nonActionable: false }],
      backlogPath
    );
    assert.deepEqual(result, {
      state: 'checked',
      linked: [],
      unlinked: [],
      missingRefs: [{ ref: 'R99', nonActionable: false }],
      accepted: []
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple residuals with mixed classifications', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkLinkage-'));
  try {
    const backlogPath = join(dir, 'backlog.md');
    writeFileSync(backlogPath, '| R1 | something |\n| R2 | other |\n');
    const result = checkLinkage(
      [
        { ref: 'R1', nonActionable: false },
        { ref: 'R2', nonActionable: true },
        { ref: null, nonActionable: false },
        { ref: 'R3', nonActionable: false }
      ],
      backlogPath
    );
    assert.deepEqual(result, {
      state: 'checked',
      linked: [{ ref: 'R1', nonActionable: false }],
      unlinked: [{ ref: null, nonActionable: false }],
      missingRefs: [{ ref: 'R3', nonActionable: false }],
      accepted: [{ ref: 'R2', nonActionable: true }]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles empty residuals array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkLinkage-'));
  try {
    const backlogPath = join(dir, 'backlog.md');
    writeFileSync(backlogPath, '| R1 | something |\n');
    const result = checkLinkage([], backlogPath);
    assert.deepEqual(result, {
      state: 'checked',
      linked: [],
      unlinked: [],
      missingRefs: [],
      accepted: []
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
