// bin/test/turn-gate-units.test.mjs — case tests for assessFile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessFile } from '../turn-gate.mjs';

test('assessFile returns unknown outcome for a missing file', () => {
  const r = assessFile('/nonexistent/path/does-not-exist.jsonl', {});
  assert.equal(r.file, '/nonexistent/path/does-not-exist.jsonl');
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.reason, 'transcript is absent');
  assert.deepEqual(r.verdicts, []);
  assert.equal(r.tokens, null);
});

test('assessFile returns unknown outcome for an unreadable path (directory)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-'));
  try {
    const r = assessFile(dir, {});
    assert.equal(r.outcome, 'unknown');
    assert.match(r.reason, /^transcript is unreadable \(/);
    assert.deepEqual(r.verdicts, []);
    assert.equal(r.tokens, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
