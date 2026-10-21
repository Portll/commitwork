// node --test monitor/test/ — every event type the issue store can append must be one its schema
// accepts. saveIssues and loadIssues both validate, so an undeclared type is not cosmetic: the
// mutation that emits it cannot be saved, and a store that already holds it cannot be loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  emptyIssuesDoc, mintIssue, closeIssue, regradeClosure, classifyDefect,
  saveIssues, loadIssues, withIssuesLock, REMEDIATION_EVENT_TYPES,
} from '../issue-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(HERE, '..', '..', 'schema', 'issue.schema.json');
const STORE_SRC = resolve(HERE, '..', 'issue-store.mjs');
const AT = '2026-08-27T00:00:00.000Z';

const schemaEventTypes = () => {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'));
  return new Set(schema.properties.events.items.properties.type.enum);
};

const closedDoc = () => {
  const doc = Object.assign(emptyIssuesDoc(), { organisation: 'FIXTURE' });
  const { id } = mintIssue(doc, {
    area: 'fixture-area', title: 'a defect', severity: 'high', class: 'F',
    source: { kind: 'manual', key: null, tool: null, rule: null },
  }, AT);
  closeIssue(doc, id, { as: 'fixed', evidence: 'fixture evidence', at: AT, force: true });
  return { doc, id };
};

const saveAndReload = (doc) => {
  const p = join(mkdtempSync(join(tmpdir(), 'cw-issue-events-')), 'issues.json');
  withIssuesLock(() => saveIssues(doc, { path: p, schemaPath: SCHEMA }), { path: p });
  return loadIssues({ path: p, schemaPath: SCHEMA });
};

test('a regraded closure survives save and reload', () => {
  const { doc, id } = closedDoc();
  regradeClosure(doc, id, { to: 'refuted', why: 'line drift', evidence: 'fixture evidence', at: AT });
  const back = saveAndReload(doc);
  assert.equal(back.events.at(-1).type, 'issue-regraded');
  assert.equal(back.issues[id].closedAs, 'refuted');
});

test('a classified defect survives save and reload', () => {
  const { doc, id } = closedDoc();
  classifyDefect(doc, id, { owner: 'upstream', basis: 'adjudication', evidence: 'fixture evidence', at: AT });
  const back = saveAndReload(doc);
  assert.equal(back.events.at(-1).type, 'issue-classified');
  assert.equal(back.issues[id].defectOwner, 'upstream');
});

// The literal event type is the argument after an issue id / mutator closure:
//   appendIssueEvent(doc, 'issue-x', ...)   and   }, 'issue-x', { ... }, at)
const emittedTypes = (src) => {
  const out = new Set();
  for (const m of src.matchAll(/appendIssueEvent\(\s*\w+\s*,\s*'([a-z-]+)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/\}\s*,\s*'([a-z][a-z-]*)'\s*,/g)) out.add(m[1]);
  return out;
};

test('every event type issue-store.mjs emits is in the schema enum', () => {
  const emitted = emittedTypes(readFileSync(STORE_SRC, 'utf8'));
  // Floor: an extractor that silently matches nothing would pass the subset check vacuously.
  for (const known of ['issue-opened', 'issue-claimed', 'issue-closed', 'issue-reopened',
    'issue-regraded', 'issue-classified', 'issue-gc', 'issue-key-migrated', 'fix-authored']) {
    assert.ok(emitted.has(known), `extractor did not find '${known}' in issue-store.mjs`);
  }
  for (const t of REMEDIATION_EVENT_TYPES) emitted.add(t);
  const allowed = schemaEventTypes();
  const missing = [...emitted].filter((t) => !allowed.has(t)).sort();
  assert.deepEqual(missing, [], `emitted but not in schema/issue.schema.json event type enum: ${missing.join(', ')}`);
});
