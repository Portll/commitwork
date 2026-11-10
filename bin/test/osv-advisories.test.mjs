// bin/test/osv-advisories.test.mjs — the OSV lookup against a fake fetch. Nothing leaves the process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { osvLookup } from '../lib/osv-advisories.mjs';

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fake OSV: `batch(queries)` answers querybatch, `vulns[id]` the records; every URL is logged. */
function fakeOsv({ batch, vulns = {} }) {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    if (url.endsWith('/v1/querybatch')) return batch(JSON.parse(init.body).queries);
    const id = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
    return id in vulns ? (vulns[id] instanceof Error ? res(500, {}) : res(200, vulns[id])) : res(404, {});
  };
  return { fetchImpl, urls };
}

const PAIRS = [{ name: 'child-y', version: '1.2.0' }, { name: 'widget-x', version: '1.1.0' }, { name: 'tool-z', version: '2.0.0' }];

test('ids come from querybatch and severities from each record; unrated and unread are both unknown', async () => {
  process.env.CW_OSV_URL = 'http://osv.invalid/';
  const osv = fakeOsv({
    batch: (q) => res(200, { results: q.map((x) => (x.package.name === 'child-y' ? { vulns: [{ id: 'GHSA-aaaa-bbbb-cccc' }, { id: 'GHSA-unra-ted0-0000' }, { id: 'GHSA-gone-gone-gone' }] }
      : x.package.name === 'widget-x' ? { vulns: [{ id: 'GHSA-unre-ad00-0000' }] } : {})) }),
    vulns: {
      'GHSA-aaaa-bbbb-cccc': { id: 'GHSA-aaaa-bbbb-cccc', aliases: ['CVE-2026-0001'], summary: 'flaw', database_specific: { severity: 'HIGH' } },
      'GHSA-unra-ted0-0000': { id: 'GHSA-unra-ted0-0000', summary: 'no rating' },
      'GHSA-gone-gone-gone': { id: 'GHSA-gone-gone-gone', withdrawn: '2026-01-01T00:00:00Z', database_specific: { severity: 'CRITICAL' } },
      'GHSA-unre-ad00-0000': new Error('500'),
    },
  });
  const got = await osvLookup({ ecosystem: 'npm', fetchImpl: osv.fetchImpl })(PAIRS);
  assert.deepEqual(got.get('child-y@1.2.0').advisories.map((a) => [a.id, a.severity, a.severitySource]),
    [['GHSA-aaaa-bbbb-cccc', 'high', 'label'], ['GHSA-unra-ted0-0000', 'unknown', 'unrated']], 'a withdrawn advisory is dropped');
  assert.deepEqual(got.get('child-y@1.2.0').advisories[0].aliases, ['CVE-2026-0001']);
  assert.deepEqual(got.get('widget-x@1.1.0').advisories.map((a) => [a.severity, a.severitySource]), [['unknown', 'unread']]);
  assert.deepEqual(got.get('tool-z@2.0.0').advisories, []);
  assert.ok(osv.urls.every((u) => u.startsWith('http://osv.invalid/v1/')), 'CW_OSV_URL is read at call time');
  delete process.env.CW_OSV_URL;
});

test('a failed or out-of-shape batch is an error on every pair in it, never "no advisories"', async () => {
  process.env.CW_OSV_URL = 'http://osv.invalid';
  for (const batch of [() => res(503, {}), () => res(200, {}), () => res(200, { results: [{}] }), () => { throw new Error('ECONNRESET'); }]) {
    const got = await osvLookup({ fetchImpl: fakeOsv({ batch }).fetchImpl })(PAIRS);
    for (const p of PAIRS) assert.ok(got.get(`${p.name}@${p.version}`).error, `${p.name}: ${JSON.stringify(got.get(`${p.name}@${p.version}`))}`);
  }
  delete process.env.CW_OSV_URL;
});

test('a paged result and an unknown ecosystem are errors on the pairs they cover', async () => {
  process.env.CW_OSV_URL = 'http://osv.invalid';
  const paged = await osvLookup({ fetchImpl: fakeOsv({ batch: (q) => res(200, { results: q.map((x, i) => (i === 0 ? { vulns: [{ id: 'X' }], next_page_token: 't' } : {})) }) }).fetchImpl })(PAIRS);
  assert.match(paged.get('child-y@1.2.0').error, /paged/);
  assert.deepEqual(paged.get('widget-x@1.1.0').advisories, []);
  const odd = await osvLookup({ ecosystem: 'cobol', fetchImpl: () => { throw new Error('must not be called'); } })(PAIRS);
  assert.match(odd.get('child-y@1.2.0').error, /no OSV ecosystem for cobol/);
  delete process.env.CW_OSV_URL;
});
