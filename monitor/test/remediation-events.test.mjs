import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appendRemediationEvent, closeIssue, emptyIssuesDoc, learningPatternForIssue,
  lodgeFix, mintIssue, reopenIssue, verifyChain,
} from '../issue-store.mjs';
import { rebuildLearning } from '../learning.mjs';
import { validateAgainstSchema } from '../registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(HERE, '..', '..', 'schema', 'issue.schema.json');
const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const T2 = '2026-01-03T00:00:00.000Z';

function fixture() {
  const doc = Object.assign(emptyIssuesDoc(), { organisation: 'TEST' });
  const { id } = mintIssue(doc, {
    area: 'admin', repo: 'commitwork', kind: 'code', severity: 'high',
    title: 'reflected XSS', class: 'S',
    source: { kind: 'scanner-row', key: 'sc:commitwork|sastCodeql|js/reflected-xss|admin/routes/report.mjs', tool: 'sastCodeql', rule: 'js/reflected-xss' },
    anchor: { file: 'admin/routes/report.mjs', line: 20, hash: 'abc123' },
  }, T0);
  return { doc, id };
}

test('a lodged fix is a structured learning event on the issue hash chain', () => {
  const { doc, id } = fixture();
  lodgeFix(doc, id, { fixType: 'code-change', notes: 'escape the value before rendering the attribute', who: 'alice', at: T1 });
  const event = doc.events.at(-1);
  assert.equal(event.type, 'fix-authored');
  assert.deepEqual({ rule: event.data.rule, pathPrefix: event.data.pathPrefix, package: event.data.package }, {
    rule: 'js/reflected-xss', pathPrefix: 'admin/routes/', package: null,
  });
  assert.deepEqual(event.data.evidence, { note: 'escape the value before rendering the attribute', who: 'alice' });
  assert.deepEqual(verifyChain(doc), []);
  assert.deepEqual(validateAgainstSchema(doc, { path: SCHEMA }).errors, []);
});

test('verification disputes and reinvestigation share the closed event vocabulary', () => {
  const { doc, id } = fixture();
  appendRemediationEvent(doc, 'fix-disputed', id, {
    at: T1, evidence: { note: 'the independent verifier still reaches the sink', who: 'verifier-b' },
  });
  appendRemediationEvent(doc, 'fp-reinvestigated', id, {
    at: T2, outcome: 'contradicted', evidence: { note: 'the refreshed rule reproduces the finding', who: 'alice' },
  });
  const learning = rebuildLearning({ issuesDoc: doc, now: T2 });
  const pattern = learning.patterns['js/reflected-xss|admin/routes/|'];
  assert.equal(pattern.confidenceAlpha, 1);
  assert.equal(pattern.confidenceBeta, 3);
  assert.throws(() => appendRemediationEvent(doc, 'fp-reinvestigated', id, {
    at: T2, outcome: 'maybe', evidence: { note: 'ambiguous', who: 'alice' },
  }), /confirmed or contradicted/);
});

test('a verified closure that reopens records the contradiction separately', () => {
  const { doc, id } = fixture();
  closeIssue(doc, id, { as: 'fixed', evidence: 'scanner verified the changed anchor', at: T1 });
  reopenIssue(doc, id, { at: T2, reason: 'the same scanner rule reappeared' });
  assert.deepEqual(doc.events.slice(-2).map((event) => event.type), ['issue-reopened', 'reopened-contradiction']);
  assert.equal(doc.issues[id].state, 'open');
  assert.deepEqual(verifyChain(doc), []);
});

test('learning keys are deterministic for dependency findings', () => {
  const iss = {
    kind: 'vuln', repo: 'api', anchor: null,
    source: { kind: 'finding', key: 'f:api|osv|CVE-2026-1234|lodash|file:///src/services/api/package-lock.json', tool: 'osv', rule: null },
  };
  assert.deepEqual(learningPatternForIssue(iss), {
    rule: 'osv/CVE-2026-1234', pathPrefix: 'services/api/', package: 'lodash',
  });
});
