// The failure taxonomy ships publicly (operator ruling D22), so it cites no session name, ref or
// transcript. A harness name is reassigned on every restart and its `[ref]` with it, and a
// transcript id is private provenance. An actor citation reads `reporter #n`: stable across
// restarts, distinct per reporter, and resolved to a transcript only by the private sidecar map.
//
// The audit counts over the file, not over what an annotator noticed: the first annotation pass of
// the older form reported "0 unresolvable" over the citations it found and missed 16 of 153.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = process.env.CW_TAXONOMY_JSON || resolve(HERE, '..', '..', 'monitor', 'failure-taxonomy.json');

const PRIVATE = [
  ['session name', /\b(?:commitwork|overwatch-layer|clientD|client-d|substrate|cobolwork|memory-layer|portll-site)-[0-9a-z]{2}\b|\bcw[0-9a-f]{2}\b/g],
  ['harness ref', /\[[0-9a-f]{6,8}\]/g],
  ['transcript', /\bsession [0-9a-f]{8}\b|\(session unresolved[^)]*\)/g],
];

export function auditCitations(text) {
  const leaks = [];
  for (const [kind, re] of PRIVATE) for (const m of text.matchAll(re)) leaks.push(`${kind}: ${m[0]}`);
  const reporters = new Set([...text.matchAll(/\breporter #(\d+)\b/g)].map((m) => Number(m[1])));
  return { leaks, reporters };
}

test('the registry cites reporters by pseudonym and carries no session name, ref or transcript', () => {
  const a = auditCitations(readFileSync(REGISTRY, 'utf8'));
  assert.deepEqual(a.leaks, [], `${a.leaks.length} private citation(s): ${[...new Set(a.leaks)].slice(0, 10).join(' | ')}`);
  assert.ok(a.reporters.size > 20, `expected a populated registry, found ${a.reporters.size} reporters`);
});

test('the audit sees each private form and reads pseudonyms as reporters', () => {
  const a = auditCitations('by commitwork-zz, by cw66, from [a0b1c2], (session 0a0b0c0d), (session unresolved: foreign roster), '
    + 'measured by reporter #3 and reporter #12, then reporter #3 again');
  assert.deepEqual(a.leaks, ['session name: commitwork-zz', 'session name: cw66', 'harness ref: [a0b1c2]',
    'transcript: session 0a0b0c0d', 'transcript: (session unresolved: foreign roster)']);
  assert.deepEqual(auditCitations('the form was `(session <transcript-8>)`').leaks, [], 'a template is not an id');
  assert.deepEqual([...a.reporters].sort((x, y) => x - y), [3, 12]);
  assert.deepEqual(auditCitations('commitwork-web and commitwork-sidecar are repositories').leaks, []);
});
