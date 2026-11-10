import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createStackApi, tokenMatches } from '../api.mjs';

const TOKEN = 'synthetic-token-0123456789abcdef';
const JOB = { id: 1, at: '2026-10-22T09:01:05.000Z', runnerName: 'cw-slot-1-501-1792573200', cpuSec: 30.25 };
const fakeLedger = { check: () => ({ status: 'live', reason: null }), jobs: () => [JOB], decisions: () => [] };
let api;
let base;

before(async () => {
  api = createStackApi({ token: `${TOKEN}\n`, host: '127.0.0.1', port: 0, ledger: fakeLedger, slots: () => [{ id: 'slot-1', state: 'idle' }], probes: {} });
  const { port } = await api.listen();
  base = { host: '127.0.0.1', port };
});
after(() => api.close());

/** A raw request, so methods fetch refuses (TRACE, CONNECT) can be sent too. */
function call(path, { method = 'GET', auth } = {}) {
  return new Promise((resolve, reject) => {
    const headers = auth === undefined ? {} : { authorization: auth };
    const req = request({ ...base, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}
const bearer = (t = TOKEN) => `Bearer ${t}`;

test('no token, a wrong token and a malformed header are 401 with the error envelope', async () => {
  for (const auth of [undefined, bearer('synthetic-token-0123456789abcdeX'), bearer('short'), TOKEN, `Basic ${TOKEN}`]) {
    const r = await call('/v1/health', { auth });
    assert.equal(r.status, 401, String(auth));
    assert.equal(r.headers['www-authenticate'], 'Bearer');
    assert.deepEqual(Object.keys(r.json), ['ok', 'route', 'schemaVersion', 'stamp', 'error', 'partial']);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error.code, 'UNAUTHORIZED');
    assert.ok(r.json.error.remedy);
  }
});

test('the right token gets the success envelope', async () => {
  const r = await call('/v1/runner/jobs?since=2026-10-22T00:00:00Z', { auth: bearer() });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json), ['ok', 'route', 'schemaVersion', 'stamp', 'sources', 'coverage', 'data']);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.route, '/v1/runner/jobs');
  assert.deepEqual(r.json.sources, [{ id: 'ledger', status: 'live', reason: null }]);
  assert.deepEqual(r.json.data, { since: '2026-10-22T00:00:00.000Z', jobs: [JOB] });
  assert.match(r.json.stamp.generator, /^commitwork-runner · /);
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('every method but GET is 405, before auth, with Allow: GET', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
    const r = await call('/v1/health', { method, auth: bearer() });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.allow, 'GET');
    if (method !== 'HEAD') assert.equal(r.json.error.code, 'METHOD_NOT_ALLOWED');
  }
  assert.equal((await call('/v1/health', { method: 'POST' })).status, 405);
});

test('an unknown route is 404, and a bad or unknown parameter is 400, each with a remedy', async () => {
  const cases = [
    ['/v1/nope', 404, 'NOT_FOUND'], ['/api/v1/health', 404, 'NOT_FOUND'], ['/v1/constructor', 404, 'NOT_FOUND'],
    ['/v1/runner/jobs?since=yesterday', 400, 'BAD_PARAM'], ['/v1/runner/jobs?limit=0', 400, 'BAD_PARAM'],
    ['/v1/resources/series?window=-5', 400, 'BAD_PARAM'], ['/v1/runner/slots?all=1', 400, 'UNKNOWN_PARAM'],
  ];
  for (const [path, status, code] of cases) {
    const r = await call(path, { auth: bearer() });
    assert.equal(r.status, status, path);
    assert.equal(r.json.error.code, code, path);
    assert.ok(r.json.error.remedy, path);
  }
});

test('an unconfigured meter and probes are declared, not hidden', async () => {
  const r = await call('/v1/health', { auth: bearer() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.sources.map((s) => [s.id, s.status]), [
    ['dispatcher', 'live'], ['meter', 'unavailable'], ['ledger', 'live'], ['veld', 'unmeasured'], ['spine', 'unmeasured'],
  ]);
  assert.deepEqual([r.json.data.sourcesUp, r.json.data.sourcesDown, r.json.data.sourcesUnmeasured], [2, 1, 2]);
  const now = await call('/v1/resources/now', { auth: bearer() });
  assert.equal(now.json.data.sample, null);
});

test('a short or missing token refuses to build, and the compare needs the Bearer scheme', () => {
  assert.throws(() => createStackApi({}), /bearer token/);
  assert.throws(() => createStackApi({ token: 'short' }), /bearer token/);
  assert.equal(tokenMatches(bearer(), TOKEN), true);
  assert.equal(tokenMatches(TOKEN, TOKEN), false);
  assert.equal(tokenMatches(undefined, TOKEN), false);
});
