// Maps package name/version pairs to their OSV advisories or a per-pair error (bin/lib/osv-advisories.mjs osvLookup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { osvLookup } from '../lib/osv-advisories.mjs';

process.env.CW_OSV_URL = 'https://osv.test//';

const adv = (id) => ({ id, aliases: [], severity: 'unknown', severitySource: 'unread', summary: '', url: `https://osv.dev/vulnerability/${id}` });
const ok = (j) => ({ ok: true, status: 200, json: async () => j });
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) });

function stub(batch) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/v1/querybatch')) return batch(JSON.parse(init.body));
    return notFound();
  };
  return { calls, fetchImpl };
}

test('an unknown ecosystem gives every pair an error and fetches nothing', async () => {
  const { calls, fetchImpl } = stub(() => ok({ results: [] }));
  const r = await osvLookup({ ecosystem: 'unknown', fetchImpl })([{ name: 'a', version: '1.0.0' }, { name: 'b', version: '2' }, { name: 'a', version: '1.0.0' }]);
  assert.deepEqual(r, new Map([
    ['a@1.0.0', { error: 'no OSV ecosystem for unknown' }],
    ['b@2', { error: 'no OSV ecosystem for unknown' }],
  ]));
  assert.deepEqual(calls, []);
});

test('npm pairs are deduplicated, queried in one batch, and unread advisories fall back to defaults', async () => {
  const { calls, fetchImpl } = stub(() => ok({ results: [{ vulns: [{ id: 'GHSA-1' }, { id: 'A/B' }] }, {}] }));
  const r = await osvLookup({ fetchImpl })([{ name: 'a', version: '1.0.0' }, { name: 'b', version: '2.0.0' }, { name: 'a', version: '1.0.0' }]);
  assert.deepEqual(r, new Map([
    ['a@1.0.0', { advisories: [adv('GHSA-1'), adv('A/B')] }],
    ['b@2.0.0', { advisories: [] }],
  ]));
  assert.deepEqual(calls[0], {
    url: 'https://osv.test/v1/querybatch', method: 'POST',
    body: { queries: [{ package: { name: 'a', ecosystem: 'npm' }, version: '1.0.0' }, { package: { name: 'b', ecosystem: 'npm' }, version: '2.0.0' }] },
  });
  assert.deepEqual(calls.slice(1).map((c) => `${c.method} ${c.url}`).sort(), ['GET https://osv.test/v1/vulns/A%2FB', 'GET https://osv.test/v1/vulns/GHSA-1']);
});

test('a failing querybatch marks each pair with the HTTP status and uses the mapped ecosystem name', async () => {
  const { calls, fetchImpl } = stub(() => ({ ok: false, status: 503, json: async () => ({}) }));
  const r = await osvLookup({ ecosystem: 'cargo', fetchImpl })([{ name: 'serde', version: '1.0.0' }, { name: 'rand', version: '0.8.5' }]);
  assert.deepEqual(r, new Map([
    ['serde@1.0.0', { error: 'OSV querybatch failed: OSV answered 503' }],
    ['rand@0.8.5', { error: 'OSV querybatch failed: OSV answered 503' }],
  ]));
  assert.deepEqual(calls.map((c) => c.body.queries.map((q) => q.package.ecosystem)), [['crates.io', 'crates.io']]);
});

test('a querybatch answer with the wrong number of results marks every pair in the batch', async () => {
  const { fetchImpl } = stub(() => ok({ results: [{}] }));
  const r = await osvLookup({ fetchImpl })([{ name: 'a', version: '1' }, { name: 'b', version: '2' }]);
  assert.deepEqual(r, new Map([
    ['a@1', { error: 'OSV querybatch answered without one result per query' }],
    ['b@2', { error: 'OSV querybatch answered without one result per query' }],
  ]));
});

test('a querybatch answer without a results array marks every pair in the batch', async () => {
  const { fetchImpl } = stub(() => ok({ results: 'nope' }));
  const r = await osvLookup({ fetchImpl })([{ name: 'a', version: '1' }]);
  assert.deepEqual(r, new Map([['a@1', { error: 'OSV querybatch answered without one result per query' }]]));
});

test('paged and misshapen results get their own errors while ids without a value are dropped', async () => {
  const { fetchImpl } = stub(() => ok({ results: [{ next_page_token: 't' }, { vulns: 'x' }, { vulns: [{ id: 'X' }, {}] }] }));
  const r = await osvLookup({ fetchImpl })([{ name: 'a', version: '1' }, { name: 'b', version: '2' }, { name: 'c', version: '3' }]);
  assert.deepEqual(r, new Map([
    ['a@1', { error: 'OSV paged this result, and the further pages were not read' }],
    ['b@2', { error: 'OSV answered this query out of shape' }],
    ['c@3', { advisories: [adv('X')] }],
  ]));
});

test('pairs are sent in batches of 1000 so 1001 pairs make two queries', async () => {
  const sizes = [];
  const { fetchImpl } = stub((body) => { sizes.push(body.queries.length); return ok({ results: body.queries.map(() => ({})) }); });
  const pairs = Array.from({ length: 1001 }, (_, i) => ({ name: `p${i}`, version: '1.0.0' }));
  const r = await osvLookup({ fetchImpl })(pairs);
  assert.deepEqual(sizes, [1000, 1]);
  assert.equal(r.size, 1001);
  assert.deepEqual(r.get('p1000@1.0.0'), { advisories: [] });
});

test('exactly 1000 pairs are sent in a single query', async () => {
  const sizes = [];
  const { fetchImpl } = stub((body) => { sizes.push(body.queries.length); return ok({ results: body.queries.map(() => ({})) }); });
  const pairs = Array.from({ length: 1000 }, (_, i) => ({ name: `p${i}`, version: '1.0.0' }));
  await osvLookup({ fetchImpl })(pairs);
  assert.deepEqual(sizes, [1000]);
});

test('advisory records are fetched at most six at a time', async () => {
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/v1/querybatch')) {
      const q = JSON.parse(init.body).queries;
      return ok({ results: q.map((x) => ({ vulns: [{ id: `V-${x.package.name}` }] })) });
    }
    inFlight++;
    peak = Math.max(peak, inFlight);
    for (let k = 0; k < 50; k++) await null;
    inFlight--;
    return notFound();
  };
  const pairs = Array.from({ length: 10 }, (_, i) => ({ name: `n${i}`, version: '1' }));
  const r = await osvLookup({ fetchImpl })(pairs);
  assert.equal(peak, 6);
  assert.deepEqual(r.get('n9@1'), { advisories: [adv('V-n9')] });
});
