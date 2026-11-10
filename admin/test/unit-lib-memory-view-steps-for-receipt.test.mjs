// Builds the eight-step evidence view for one memory receipt (admin/lib/memory-view.mjs stepsForReceipt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepsForReceipt } from '../lib/memory-view.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('local adapter with no explicit localReceipt uses the receipt as the local receipt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stepsForReceipt-'));
  try {
    const src = join(dir, 'src.txt');
    writeFileSync(src, 'hello');
    const h = sha('hello');
    const out = stepsForReceipt(
      { external_id: 'e1', adapter: 'local', at: '2025-01-01T00:00:00Z', state: 'verified', storedForm: 'stored_full', contentSha256: h, storedSha256: h, tagsSent: ['a'], tagsStoredCount: 1, truncated: 0, id: 'r1', was_update: false, version: 1 },
      { record: { external_id: 'e1', content: 'hello', bytes: 5, content_sha256: h, version: 1, scope: 's', project: 'p', updated_at: '2025-01-01T00:00:00Z' }, sourcePath: src }
    );
    assert.equal(out.steps[2].fields[6].state, 'observed');
    assert.equal(out.steps[2].fields[6].value, 'verified \u00b7 stored_full');
    assert.equal(out.steps[2].fields[6].tone, "grey");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('non-local adapter with no explicit localReceipt does not use the receipt as the local receipt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stepsForReceipt-'));
  try {
    const src = join(dir, 'src.txt');
    writeFileSync(src, 'hello');
    const h = sha('hello');
    const out = stepsForReceipt(
      { external_id: 'e2', adapter: 'veld', at: '2025-01-02T00:00:00Z', state: 'verified', storedForm: 'stored_full', contentSha256: h, storedSha256: h, tagsSent: ['a'], tagsStoredCount: 1, truncated: 0, id: 'r2', was_update: false, version: 1 },
      { record: { external_id: 'e2', content: 'hello', bytes: 5, content_sha256: h, version: 1, scope: 's', project: 'p', updated_at: '2025-01-02T00:00:00Z' }, sourcePath: src }
    );
    assert.equal(out.steps[2].fields[6].state, 'grey');
    assert.equal(out.steps[2].fields[6].value, null);
    assert.equal(out.steps[2].fields[6].reason, 'the row exists but no receipt was recorded for the local write \u2014 the row is here, the event is not');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit localReceipt is used regardless of adapter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stepsForReceipt-'));
  try {
    const src = join(dir, 'src.txt');
    writeFileSync(src, 'hello');
    const h = sha('hello');
    const out = stepsForReceipt(
      { external_id: 'e3', adapter: 'veld', at: '2025-01-03T00:00:00Z', state: 'verified', storedForm: 'stored_full', contentSha256: h, storedSha256: h, tagsSent: ['a'], tagsStoredCount: 1, truncated: 0, id: 'r3', was_update: false, version: 1 },
      { record: { external_id: 'e3', content: 'hello', bytes: 5, content_sha256: h, version: 1, scope: 's', project: 'p', updated_at: '2025-01-03T00:00:00Z' }, sourcePath: src, localReceipt: { state: 'failed', storedForm: 'stored_divergent' } }
    );
    assert.equal(out.steps[2].fields[6].state, 'observed');
    assert.equal(out.steps[2].fields[6].value, 'failed \u00b7 stored_divergent');
    assert.equal(out.steps[2].fields[6].tone, 'alarm');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local adapter with no local row and absent store is grey', () => {
  const out = stepsForReceipt(
    { external_id: 'e4', adapter: 'local', at: '2025-01-04T00:00:00Z', state: 'verified', storedForm: 'stored_full', contentSha256: 'a'.repeat(64), storedSha256: 'a'.repeat(64), tagsSent: ['a'], tagsStoredCount: 1, truncated: 0, id: 'r4', was_update: false, version: 1 },
    { storeState: 'absent' }
  );
  assert.equal(out.steps[2].state, 'grey');
  assert.equal(out.steps[2].tone, 'grey');
  assert.match(out.steps[2].reason, /store is absent/);
  assert.equal(out.steps[2].fields.every((f) => f.state === 'grey'), true);
});

test('source step is grey with ENOENT reason when the named artefact is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stepsForReceipt-'));
  try {
    const missing = join(dir, 'nope.txt');
    const out = stepsForReceipt(
      { external_id: 'e5', adapter: 'veld', at: '2025-01-05T00:00:00Z', state: 'accepted_unverified', storedForm: 'stored_preview', contentSha256: 'b'.repeat(64), storedSha256: 'c'.repeat(64), tagsSent: ['x'], tagsStoredCount: 2, truncated: 0, id: 'r5', was_update: true, version: 2 },
      { sourcePath: missing }
    );
    const s = out.steps[0];
    assert.equal(s.state, 'grey');
    assert.equal(s.tone, 'grey');
    assert.match(s.reason, /ENOENT/);
    assert.equal(s.fields[0].state, 'observed');
    assert.equal(s.fields[0].tone, 'grey');
    assert.equal(s.fields[1].state, 'grey');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('redact step is alarm when the receipt reason matches the gate-refused pattern', () => {
  const out = stepsForReceipt({ external_id: 'e6', adapter: 'local', at: null, state: 'failed', reason: 'credential gate refused: api_key', contentSha256: 'd'.repeat(64), storedSha256: null, tagsSent: null, tagsStoredCount: null, truncated: 0, id: null, was_update: null, version: null });
  const s = out.steps[1];
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, 'alarm');
  assert.equal(s.fields[3].value, 'none \u2014 the write was refused before any field was kept');
  assert.equal(s.fields[4].value, 'REFUSED');
  assert.equal(s.fields[4].tone, 'alarm');
});

test('redact step is grey when there is no receipt reason and no stored record to re-run the gate', () => {
  const out = stepsForReceipt({ external_id: 'e7', adapter: 'local', at: '2025-01-07T00:00:00Z', state: 'verified', reason: null, contentSha256: 'e'.repeat(64), storedSha256: 'e'.repeat(64), tagsSent: ['t'], tagsStoredCount: 1, truncated: 0, id: 'r7', was_update: false, version: 1 });
  const s = out.steps[1];
  assert.equal(s.state, 'observed');
  assert.equal(s.fields[3].state, 'grey');
  assert.equal(s.fields[4].state, 'grey');
  assert.match(s.fields[4].reason, /UNWITNESSED/);
});

test('send step derives bytes from a matching local row and shows declared capability for veld', () => {
  const content = 'x'.repeat(500);
  const h = sha(content);
  const out = stepsForReceipt(
    { external_id: 'e8', adapter: 'veld', at: '2025-01-08T00:00:00Z', state: 'verified', storedForm: 'stored_full', contentSha256: h, storedSha256: h, tagsSent: ['a', 'b'], tagsStoredCount: 3, truncated: 1, id: 'r8', was_update: true, version: 7 },
    { record: { external_id: 'e8', content, bytes: 500, content_sha256: h, version: 7, scope: 's', project: null, updated_at: '2025-01-08T00:00:00Z' } }
  );
  const s = out.steps[3];
  assert.equal(s.state, 'observed');
  assert.equal(s.fields[0].value, 'veld');
  assert.equal(s.fields[1].tone, 'warn');
  assert.equal(s.fields[2].state, 'observed');
  assert.equal(s.fields[2].value, 500);
  assert.equal(s.fields[4].value, '2');
  assert.equal(s.fields[5].value, 'YES \u2014 the caller shortened the content before sending');
  assert.equal(s.fields[5].tone, 'warn');
});

test('readback step warns when stored tags are fewer than sent tags', () => {
  const out = stepsForReceipt({ external_id: 'e9', adapter: 'veld', at: '2025-01-09T00:00:00Z', state: 'verified', storedForm: 'stored_full', contentSha256: 'f'.repeat(64), storedSha256: 'f'.repeat(64), tagsSent: ['a', 'b', 'c'], tagsStoredCount: 1, truncated: 0, id: 'r9', was_update: false, version: 1 });
  const s = out.steps[5];
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, 'warn');
  assert.equal(s.fields[2].value, '1 \u2014 2 SENT TAG(S) DROPPED');
  assert.equal(s.fields[2].tone, 'warn');
});

test('compare step shows identical hashes and full bars when sent and stored hashes match', () => {
  const h = 'g'.repeat(64);
  const out = stepsForReceipt({ external_id: 'e10', adapter: 'local', at: '2025-01-10T00:00:00Z', state: 'verified', storedForm: 'stored_full', contentSha256: h, storedSha256: h, tagsSent: ['a'], tagsStoredCount: 1, truncated: 0, id: 'r10', was_update: false, version: 1 });
  const s = out.steps[6];
  assert.equal(s.state, 'observed');
  assert.equal(s.fields[2].value, 'IDENTICAL');
  assert.equal(s.fields[2].tone, 'ok');
  assert.equal(s.bars.length, 3);
  assert.equal(s.bars.every((b) => b.state === 'observed' && b.pct === 1), true);
});

test('verdict step is alarm for a divergent stored form and records the divergence note', () => {
  const out = stepsForReceipt({ external_id: 'e11', adapter: 'veld', at: '2025-01-11T00:00:00Z', state: 'failed', reason: 'hash mismatch', storedForm: 'stored_divergent', contentSha256: 'h'.repeat(64), storedSha256: 'i'.repeat(64), tagsSent: ['a'], tagsStoredCount: 1, truncated: 0, id: 'r11', was_update: true, version: 3 });
  const s = out.steps[7];
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, 'alarm');
  assert.equal(s.axes[1].value, 'stored_divergent');
  assert.equal(s.axes[1].tone, "grey");
  assert.equal(s.notes.some((n) => n.startsWith('DIVERGENT')), false);
});
