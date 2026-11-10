// The advisories a lockfile update introduces, resolves or leaves unmeasured, as a verdict object (bin/lib/introduced-run.mjs introducedVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { introducedVerdict } from '../lib/introduced-run.mjs';
import { createHash } from 'node:crypto';

function lock(version) {
  const integrity = 'sha512-' + createHash('sha512').update(`probe-pkg@${version}`).digest('base64');
  return {
    text: JSON.stringify({
      name: 'app', version: '1.0.0', lockfileVersion: 3, requires: true,
      packages: {
        '': { name: 'app', version: '1.0.0', dependencies: { 'probe-pkg': version } },
        'node_modules/probe-pkg': { version, resolved: `https://registry.npmjs.org/probe-pkg/-/probe-pkg-${version}.tgz`, integrity },
      },
    }),
  };
}

const recorder = (seen) => async (pairs) => {
  for (const p of pairs) seen.push(`${p.name}@${p.version}`);
  return new Map();
};
const none = async () => new Map();

async function withFakeFetch(fn) {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  try { return await fn(); } finally { globalThis.fetch = saved; }
}

test('Empty lockfile text on both sides gives an unmeasured verdict with default scope and sources', async () => {
  const r = await introducedVerdict({ before: { text: '' }, after: { text: '' }, lookupBefore: none, lookupAfter: none, nowMs: 1700000000000 });
  assert.deepEqual(r, {
    schema: 'commitwork.introduced-advisories',
    version: 1,
    check: { kind: 'security', id: 'dependency-audit' },
    generatedAt: '2023-11-14T22:13:20.000Z',
    ecosystem: 'npm',
    subject: null,
    source: { graph: 'package-lock.json', advisories: 'osv' },
    scope: { includeDev: true, blocking: ['critical', 'high', 'unknown'] },
    state: 'unmeasured',
    reasons: [
      'the before graph could not be resolved: package-lock.json (before) is not JSON (Unexpected end of JSON input)',
      'the after graph could not be resolved: package-lock.json (after) is not JSON (Unexpected end of JSON input)',
    ],
    counts: { introduced: 0, blocking: 0, resolved: 0, persisting: 0, unmeasured: 0, looked: 0 },
    introduced: [],
    resolved: [],
    unmeasured: [],
  });
});

test('An explicit includeDev of false is carried into the verdict scope', async () => {
  const r = await introducedVerdict({ before: { text: '' }, after: { text: '' }, includeDev: false, lookupBefore: none, lookupAfter: none });
  assert.equal(r.scope.includeDev, false);
});

test('Subject and advisory source name are passed through to the verdict', async () => {
  const r = await introducedVerdict({ before: { text: '' }, after: { text: '' }, subject: 'my-subject', source: 'custom-source', lookupBefore: none, lookupAfter: none });
  assert.equal(r.subject, 'my-subject');
  assert.deepEqual(r.source, { graph: 'package-lock.json', advisories: 'custom-source' });
});

test('A lockfile name without a graph reader leaves the verdict unmeasured', async () => {
  const r = await introducedVerdict({ before: { text: '' }, after: { text: '' }, lockfile: 'foo.lock', lookupBefore: none, lookupAfter: none });
  assert.equal(r.state, 'unmeasured');
  assert.deepEqual(r.source, { graph: 'foo.lock', advisories: 'osv' });
});

test('A read error on the after side is reported as an unresolved after graph', async () => {
  const r = await introducedVerdict({ before: { absent: true }, after: { error: 'disk read failed' }, lookupBefore: none, lookupAfter: none });
  assert.equal(r.state, 'unmeasured');
  assert.equal(r.reasons.includes('the after graph could not be resolved: disk read failed'), true);
});

test('The before lookup receives the packages of the before lockfile', async () => {
  const seenBefore = [];
  await introducedVerdict({ before: lock('1.0.0'), after: lock('2.0.0'), lookupBefore: recorder(seenBefore), lookupAfter: none });
  assert.equal(seenBefore.includes('probe-pkg@1.0.0'), true);
});

test('The after lookup receives the packages of the after lockfile', async () => {
  const seenAfter = [];
  await introducedVerdict({ before: lock('1.0.0'), after: lock('2.0.0'), lookupBefore: none, lookupAfter: recorder(seenAfter) });
  assert.equal(seenAfter.includes('probe-pkg@2.0.0'), true);
});

test('With only a before lookup the after side falls back to the OSV lookup instead of failing', async () => {
  const seenBefore = [];
  const r = await withFakeFetch(() => introducedVerdict({ before: lock('1.0.0'), after: lock('2.0.0'), lookupBefore: recorder(seenBefore) }));
  assert.equal(JSON.stringify(r).includes('is not a function'), false);
  assert.equal(seenBefore.includes('probe-pkg@1.0.0'), true);
});

test('With only an after lookup the before side falls back to the OSV lookup instead of failing', async () => {
  const seenAfter = [];
  const r = await withFakeFetch(() => introducedVerdict({ before: lock('1.0.0'), after: lock('2.0.0'), lookupAfter: recorder(seenAfter) }));
  assert.equal(JSON.stringify(r).includes('is not a function'), false);
  assert.equal(seenAfter.includes('probe-pkg@2.0.0'), true);
});
