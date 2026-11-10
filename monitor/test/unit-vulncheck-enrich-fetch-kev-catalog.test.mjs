// Paginated, trimmed VulnCheck KEV entries or a classified failure state (monitor/vulncheck-enrich.mjs fetchKevCatalog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchKevCatalog } from '../vulncheck-enrich.mjs';

const raw = (n, start = 0) => Array.from({ length: n }, (_, i) => ({ cve: [`CVE-2021-${10000 + start + i}`] }));
const trimmed = (n, start = 0) => Array.from({ length: n }, (_, i) => ({
  cve: [`CVE-2021-${10000 + start + i}`],
  dateAdded: null,
  cisaDateAdded: null,
  knownRansomwareCampaignUse: null,
  vulnerabilityName: null,
}));
const pager = (pages) => async (url) => {
  const page = Number(new URL(url).searchParams.get('page'));
  const p = pages[page] || { status: 500, body: {} };
  return {
    status: p.status,
    json: async () => {
      if (p.body === undefined) throw new SyntaxError('bad json');
      return p.body;
    },
  };
};
const assertOk = (result, entries) => {
  assert.deepEqual(Object.keys(result), ['state', 'entries', 'fetchedAt']);
  assert.equal(result.state, 'ok');
  assert.deepEqual(result.entries, entries);
};

test('Returns the no-key state without fetching when the API key is empty', async () => {
  const fetchImpl = async () => { throw new Error('should not fetch'); };
  const result = await fetchKevCatalog({ apiKey: '', fetchImpl });
  assert.deepEqual(result, { state: 'no-key' });
});

test('Trims a short single page into entries keeping only valid CVE ids and object rows', async () => {
  const fetchImpl = pager({
    1: {
      status: 200,
      body: {
        data: [
          { cve: ['CVE-2021-44228', 'bogus', 'cve-2020-0001', 'CVE-2021-123'], date_added: '2021-12-10', cisa_date_added: '2021-12-11', knownRansomwareCampaignUse: 'Known', vulnerabilityName: 'Log4Shell' },
          { cve: 'CVE-2022-0001', date_added: '' },
          null,
          'text',
          7,
        ],
      },
    },
  });
  const result = await fetchKevCatalog({ apiKey: 'k', fetchImpl });
  assertOk(result, [
    { cve: ['CVE-2021-44228', 'cve-2020-0001'], dateAdded: '2021-12-10', cisaDateAdded: '2021-12-11', knownRansomwareCampaignUse: 'Known', vulnerabilityName: 'Log4Shell' },
    { cve: [], dateAdded: null, cisaDateAdded: null, knownRansomwareCampaignUse: null, vulnerabilityName: null },
  ]);
});

test('Reports fetch-failed with the thrown name and message when fetchImpl rejects', async () => {
  const fetchImpl = async () => { throw { name: 'TimeoutError', message: 'timed out' }; };
  const result = await fetchKevCatalog({ apiKey: 'k', fetchImpl });
  assert.deepEqual(result, { state: 'fetch-failed', detail: 'TimeoutError: timed out' });
});

test('Reports auth-failed with the first API error on HTTP 401', async () => {
  const fetchImpl = pager({ 1: { status: 401, body: { errors: ['first', 'second'] } } });
  const result = await fetchKevCatalog({ apiKey: 'k', fetchImpl });
  assert.deepEqual(result, { state: 'auth-failed', detail: 'first' });
});

test('Falls back to the HTTP status as auth-failed detail on 403 with an unparseable body', async () => {
  const fetchImpl = pager({ 1: { status: 403, body: undefined } });
  const result = await fetchKevCatalog({ apiKey: 'k', fetchImpl });
  assert.deepEqual(result, { state: 'auth-failed', detail: 'HTTP 403' });
});

test('Reports fetch-failed for a 200 response whose data is not an array', async () => {
  const fetchImpl = pager({ 1: { status: 200, body: { data: 'not-an-array' } } });
  const result = await fetchKevCatalog({ apiKey: 'k', fetchImpl });
  assert.deepEqual(result, { state: 'fetch-failed', detail: 'HTTP 200, unexpected body shape' });
});

test('Stops after a page of 999 entries even when more pages are reported', async () => {
  const fetchImpl = pager({
    1: { status: 200, body: { data: raw(999), _meta: { total_pages: 5 } } },
    2: { status: 200, body: { data: raw(1, 999), _meta: { total_pages: 5 } } },
  });
  const result = await fetchKevCatalog({ apiKey: 'k', fetchImpl });
  assertOk(result, trimmed(999));
});

test('Fetches the next page after a full page of 1000 when total_pages is 2', async () => {
  const fetchImpl = pager({
    1: { status: 200, body: { data: raw(1000), _meta: { total_pages: 2 } } },
    2: { status: 200, body: { data: raw(3, 1000), _meta: { total_pages: 2 } } },
  });
  const result = await fetchKevCatalog({ apiKey: 'k', fetchImpl });
  assertOk(result, [...trimmed(1000), ...trimmed(3, 1000)]);
});

test('Stops after a full page when the page number equals total_pages', async () => {
  const fetchImpl = pager({
    1: { status: 200, body: { data: raw(1000), _meta: { total_pages: 1 } } },
  });
  const result = await fetchKevCatalog({ apiKey: 'k', fetchImpl });
  assertOk(result, trimmed(1000));
});

test('Fetches exactly maxPages full pages when no total_pages is given', async () => {
  const fetchImpl = pager({
    1: { status: 200, body: { data: raw(1000) } },
    2: { status: 200, body: { data: raw(1000, 1000) } },
  });
  const result = await fetchKevCatalog({ apiKey: 'k', fetchImpl, maxPages: 2 });
  assertOk(result, [...trimmed(1000), ...trimmed(1000, 1000)]);
});
