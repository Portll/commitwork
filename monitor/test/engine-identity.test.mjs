// node --test monitor/test/ — item 4. Pinned: identity is implementation SHAPE, never content —
// model churn (the operator loading a model) must not read as a spoof, and a spoof (another
// program answering on the port) must read as one via both witnesses independently; a shared-port
// host is unidentifiable-by-design and the lens says so rather than asserting what it did not
// measure.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fingerprintResponse, probeEndpoint, assessIdentities, observeEndpoints, endpointsFor, readBaseline, runLens, acceptBaseline,
} from '../engine-identity.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-engid-')); dirs.push(d); return d; };

const env = (kv, fn) => async () => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { await fn(); } finally {
    for (const k of Object.keys(kv)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
};

// A fetch double: route by URL suffix. Shapes below mimic an LM-Studio-ish server and a python
// http.server-ish impostor — different header names, different error bodies.
const resOf = ({ status, headers, body }) => ({
  status,
  headers: { forEach: (fn) => Object.entries(headers).forEach(([k, v]) => fn(v, k)) },
  text: async () => body,
});
const engineFetch = (models) => async (url) => {
  if (String(url).endsWith('/v1/models')) {
    return resOf({ status: 200, headers: { 'content-type': 'application/json', date: 'now', 'x-powered-by': 'Express' }, body: JSON.stringify({ object: 'list', data: models }) });
  }
  return resOf({ status: 404, headers: { 'content-type': 'application/json', date: 'later' }, body: JSON.stringify({ error: 'Unexpected endpoint' }) });
};
const impostorFetch = async (url) => {
  if (String(url).endsWith('/v1/models')) {
    return resOf({ status: 200, headers: { server: 'SimpleHTTP/0.6 Python/3.12', 'content-type': 'text/html' }, body: '<html>directory listing</html>' });
  }
  return resOf({ status: 404, headers: { server: 'SimpleHTTP/0.6 Python/3.12', 'content-type': 'text/html' }, body: '<html>404</html>' });
};

describe('fingerprintResponse', () => {
  test('date and content-length never participate; header NAMES and body FIELD NAMES do', () => {
    const a = fingerprintResponse(200, ['Content-Type', 'Date', 'Content-Length'], '{"object":"list","data":[]}');
    const b = fingerprintResponse(200, ['content-type', 'date'], '{"data":[1,2,3],"object":"x"}');
    assert.equal(a, b, 'same shape, different content and casing — identical fingerprint');
    assert.notEqual(a, fingerprintResponse(200, ['content-type', 'server'], '{"object":"list","data":[]}'), 'a new header NAME changes identity');
    assert.notEqual(a, fingerprintResponse(200, ['content-type', 'date'], '{"error":"x"}'), 'different field names change identity');
    assert.notEqual(a, fingerprintResponse(404, ['content-type', 'date'], '{"object":"list","data":[]}'), 'status changes identity');
  });
});

describe('probeEndpoint', () => {
  test('model churn does not change the fingerprint — content is not identity', async () => {
    const few = await probeEndpoint('http://x', { fetchImpl: engineFetch([{ id: 'a' }]) });
    const many = await probeEndpoint('http://x', { fetchImpl: engineFetch([{ id: 'a' }, { id: 'b' }, { id: 'c' }]) });
    assert.equal(few.fingerprint, many.fingerprint);
    assert.equal(few.modelCount, 1);
    assert.equal(many.modelCount, 3);
  });

  test('an impostor fingerprints differently', async () => {
    const real = await probeEndpoint('http://x', { fetchImpl: engineFetch([]) });
    const fake = await probeEndpoint('http://x', { fetchImpl: impostorFetch });
    assert.notEqual(real.fingerprint, fake.fingerprint);
  });

  test('refused is absent; a network failure is unknown', async () => {
    const refused = async () => { const e = new Error('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; };
    assert.equal((await probeEndpoint('http://x', { fetchImpl: refused })).absent, true);
    const dead = async () => { const e = new Error('fetch failed'); e.cause = { code: 'EHOSTUNREACH' }; throw e; };
    assert.equal((await probeEndpoint('http://x', { fetchImpl: dead })).unknownReason, 'tool-failed');
  });
});

describe('endpointsFor', () => {
  test('manifest hosts plus overwatch; lmstudio expects its app as owner; shared ports are marked', () => {
    const eps = endpointsFor();
    assert.ok(eps.some((e) => e.id === 'overwatch' && e.baseUrl.includes('7980')));
    const lm = eps.find((e) => e.id === 'lmstudio');
    assert.equal(lm.ownerMatch, 'LM Studio');
    assert.equal(lm.portIsShared, false);
    assert.ok(eps.filter((e) => e.portIsShared).length >= 1, 'the 8080 group exists and is marked shared');
  });
});

describe('assessment', () => {
  const O = (over = {}) => ({ id: 'lmstudio', owner: ['LM Studio Helper'], ownerOk: true, fingerprint: 'fp1', modelCount: 2, portIsShared: false, ...over });
  const BASE = { at: 't0', endpoints: { lmstudio: { fingerprint: 'fp1', owner: ['LM Studio Helper'] } } };

  test('ok / owner-changed / fingerprint-changed / unbaselined / no-baseline', () => {
    assert.equal(assessIdentities([O()], BASE).rows[0].state, 'ok');
    const spoof = assessIdentities([O({ ownerOk: false, owner: ['python3 -m http.server 1234'] })], BASE);
    assert.equal(spoof.rows[0].state, 'owner-changed');
    assert.equal(spoof.state, 'findings');
    const fp = assessIdentities([O({ fingerprint: 'fp2' })], BASE);
    assert.equal(fp.rows[0].state, 'fingerprint-changed');
    assert.equal(assessIdentities([O({ id: 'new-engine' })], BASE).rows[0].state, 'unbaselined');
    assert.equal(assessIdentities([O()], null).state, 'no-baseline');
  });

  test('an engine that is off is absent — a service being down is not a spoof', () => {
    const r = assessIdentities([{ id: 'lmstudio', absent: true }], BASE);
    assert.equal(r.rows[0].state, 'absent');
    assert.deepEqual(r.findings, []);
  });
});

describe('the spoof scenario, end to end', () => {
  test('python http.server on 1234: owner mismatch AND foreign fingerprint', async () => {
    const dir = scratch();
    const lst = join(dir, 'listeners.json');
    writeFileSync(lst, JSON.stringify([{ pid: 9, command: 'python3', args: 'python3 -m http.server 1234', addr: '127.0.0.1', port: 1234 }]));
    await env({ CW_BIND_LISTENERS: lst }, async () => {
      const observed = await observeEndpoints({
        fetchImpl: async (url) => {
          if (String(url).includes('1234')) return impostorFetch(url);
          const e = new Error('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e;   // every other engine off
        },
      });
      const lm = observed.find((o) => o.id === 'lmstudio');
      assert.equal(lm.ownerOk, false, 'the socket owner does not name the engine');
      const r = assessIdentities(observed, { at: 't0', endpoints: { lmstudio: { fingerprint: 'the-real-one', owner: ['LM Studio Helper'] } } });
      assert.equal(r.rows.find((x) => x.id === 'lmstudio').state, 'owner-changed');
      assert.equal(r.state, 'findings');
    })();
  });

  test('a shared-port host never gets an owner claim — unidentifiable-by-design', async () => {
    const dir = scratch();
    const lst = join(dir, 'listeners.json');
    writeFileSync(lst, JSON.stringify([{ pid: 9, command: 'llama-server', args: 'llama-server -m x.gguf', addr: '127.0.0.1', port: 8080 }]));
    await env({ CW_BIND_LISTENERS: lst }, async () => {
      const observed = await observeEndpoints({
        fetchImpl: async (url) => (String(url).includes('8080') ? engineFetch([])(url) : (() => { const e = new Error('x'); e.cause = { code: 'ECONNREFUSED' }; throw e; })()),
      });
      const shared = observed.find((o) => o.portIsShared && !o.absent);
      assert.ok(shared, 'one shared-port host answered');
      assert.equal(shared.ownerOk, null, 'no owner assertion on a port four engines share');
    })();
  });
});

describe('baseline discipline', () => {
  test('accept pins answering endpoints; unreadable baseline THROWS; ENOENT is "no baseline yet"', async () => {
    const dir = scratch();
    const base = join(dir, 'engid.json');
    const lst = join(dir, 'listeners.json');
    writeFileSync(lst, JSON.stringify([{ pid: 9, command: 'LM Studio Helper', args: '/Applications/LM Studio.app/Contents/MacOS/LM Studio Helper', addr: '127.0.0.1', port: 1234 }]));
    const onlyLm = async (url) => (String(url).includes('1234') ? engineFetch([{ id: 'm' }])(url) : (() => { const e = new Error('x'); e.cause = { code: 'ECONNREFUSED' }; throw e; })());
    await env({ CW_ENGID_BASELINE: base, CW_BIND_LISTENERS: lst, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      assert.equal((await runLens({ fetchImpl: onlyLm })).state, 'no-baseline');
      const a = await acceptBaseline({ fetchImpl: onlyLm });
      assert.deepEqual(a.pinned, ['lmstudio']);
      assert.equal((await runLens({ fetchImpl: onlyLm })).state, 'ok');
    })();
    writeFileSync(base, '{corrupt');
    await env({ CW_ENGID_BASELINE: base }, async () => { assert.throws(() => readBaseline()); })();
    await env({ CW_ENGID_BASELINE: join(dir, 'absent.json') }, async () => { assert.equal(readBaseline(), null); })();
  });
});
