import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tally, summarise, STORED_PREVIEW, STORED_FULL, ACCEPTED_UNVERIFIED, VERIFIED } from '../../lib/memory-layer-client.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '../export-overwatch.mjs'), 'utf8');

/**
 * A preview is the one degraded state that does NOT look degraded: the write landed, the transport
 * was clean, and only the stored form is wrong. Nothing here asserts a marker — each check names a
 * consumer and shows the preview survives to it.
 */

test('the exporter imports the preview constant it branches on', () => {
  // Guarding against the version of this that passes `node --check` and throws ReferenceError on
  // the first previewed write — the branch is rare, so a missing import would sit undetected.
  const importLine = SRC.split('\n').find((l) => l.includes('memory-layer-client.mjs') && l.startsWith('import'));
  assert.ok(importLine, 'the client import must be findable');
  assert.match(importLine, /STORED_PREVIEW/, 'the constant the store() branch tests must be imported');
});

test('a previewed write is reported apart from an ordinary accepted-unverified', () => {
  const branch = SRC.slice(SRC.indexOf('async function store'), SRC.indexOf('// Health gate'));
  assert.match(branch, /STORED_PREVIEW/);
  assert.match(branch, /PREVIEW ONLY/, 'the operator-facing line must name it, not just count it');
  assert.match(branch, /not a durable copy/);
  // The generic line must still exist for the other degraded states.
  assert.match(branch, /r\.state !== VERIFIED/);
});

test('the run summary carries previews — the exporter reports via summarise/tally', () => {
  assert.match(SRC, /summarise\(receipts\)/);
  assert.match(SRC, /tally\(receipts\)/);

  const receipts = [
    { state: VERIFIED, storedForm: STORED_FULL },
    { state: ACCEPTED_UNVERIFIED, storedForm: STORED_PREVIEW, storedCoverage: 0.016 },
  ];
  const line = summarise(receipts);
  assert.match(line, /PREVIEW ONLY/, 'the exporter prints this line verbatim; it must name the state');
  assert.equal(tally(receipts).failed, 0, 'a preview is not a failure...');
  assert.equal(tally(receipts).storedPreview, 1, '...and is still counted on its own axis');
});

test('the persisted receipts file carries the preview count for a later reader', () => {
  // receipts.json outlives the console output, so the count has to be IN the payload, not only
  // in a log line somebody had to be watching for.
  assert.match(SRC, /tally:\s*tally\(receipts\)/);
  const t = tally([{ state: ACCEPTED_UNVERIFIED, storedForm: STORED_PREVIEW }]);
  assert.ok('storedPreview' in t && 'storedUnknown' in t, 'both stored-form counts are in the persisted tally');
});

test('a clean run says nothing about previews', () => {
  const line = summarise([{ state: VERIFIED, storedForm: STORED_FULL }]);
  assert.doesNotMatch(line, /PREVIEW/, 'no crying wolf on healthy runs');
});
