// monitor/test/issue-store-scale.test.mjs — the issue store's declared size ceiling: one document
// holds state AND its append-only history, so every append rewrites everything. A ceiling makes
// growth a decision, not a discovery. Absent store = skip with reason; unreadable = failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import { issuesPath } from '../issue-store.mjs';

// About twice the store's size when last set; raise in a commit that says why. Above it, the
// answer is splitting the events into a separate file, not a higher ceiling.
const CEILING = Object.freeze({
  bytes: 32 * 1024 * 1024,   // 32 MB
  issues: 8000,
  events: 12000,
});

// above the ceiling: (1) split events[] into its own chain-verifiable file (the verdicts *.jsonl
// shape); (2) only then prune, by MOVING events to an archive — a gap in the chain is
// indistinguishable from tampering

function loadStore() {
  const path = issuesPath();
  let raw, size;
  try {
    size = statSync(path).size;
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { absent: true, path };
    throw new Error(`issue store at ${path} is unreadable (${e.code}) — that is a failure, not an absence`);
  }
  return { absent: false, path, size, doc: JSON.parse(raw) };
}

test('the issue store is inside its declared size ceiling', (t) => {
  const s = loadStore();
  if (s.absent) return t.skip(`no issue store at ${s.path} — nothing to measure (absence, not health)`);

  const issues = Object.keys(s.doc.issues || {}).length;
  const events = (s.doc.events || []).length;
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

  const over = [];
  if (s.size > CEILING.bytes) over.push(`bytes ${mb(s.size)} > ${mb(CEILING.bytes)}`);
  if (issues > CEILING.issues) over.push(`issues ${issues} > ${CEILING.issues}`);
  if (events > CEILING.events) over.push(`events ${events} > ${CEILING.events}`);

  assert.deepEqual(over, [],
    `the issue store passed its declared ceiling (${over.join('; ')}).\n`
    + 'This is not a broken test — it is the bound being reached. Read the header of this file: the\n'
    + 'options are splitting events[] into its own append-only file, or raising CEILING deliberately\n'
    + 'in a commit that says why. Do not raise it silently to make the suite green.');
});

test('the ceiling is a declaration, not a derivation — it cannot drift with the data', () => {
  // a derived ceiling passes forever — pin the literals
  assert.equal(CEILING.bytes, 32 * 1024 * 1024);
  assert.equal(CEILING.issues, 8000);
  assert.equal(CEILING.events, 12000);
  assert.ok(Object.isFrozen(CEILING), 'the ceiling must not be mutable at runtime');
});

test('the store carries its state and its own history in ONE document — the growth this bounds', (t) => {
  // events live inside the same document — if the log is ever split out, revisit CEILING
  const s = loadStore();
  if (s.absent) return t.skip(`no issue store at ${s.path} — nothing to measure`);
  assert.ok(Array.isArray(s.doc.events),
    'events[] is no longer embedded in the store document. If the log has been split out, revisit '
    + 'CEILING in this file — the write-amplification it bounds may no longer exist.');
  assert.ok(s.doc.issues && typeof s.doc.issues === 'object', 'issues{} must be present alongside it');
});
