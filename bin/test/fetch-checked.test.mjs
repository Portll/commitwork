// The floor under a misread fetch. Every case asserts a REFUSAL, because the defect this exists
// for is a failed request returning something parseable — so a test that only proved the happy
// path would pass while the floor was absent.
//
// Served from a local http server: no network, no fixtures on disk, and the 404 body is a real
// 404 body rather than a string a test author imagined.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchChecked, FetchRefused } from '../lib/fetch-checked.mjs';

let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok') { res.writeHead(200); res.end('x'.repeat(500)); return; }
    // The exact shape that fooled a caller on 2026-09-06: a 404 whose body is valid JSON.
    if (req.url === '/notfound') { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{\n  "message": "Build not found"\n}'); return; }
    if (req.url === '/empty') { res.writeHead(200); res.end(''); return; }
    if (req.url === '/tiny') { res.writeHead(200); res.end('{}'); return; }
    if (req.url === '/slow') { setTimeout(() => { res.writeHead(200); res.end('late'); }, 400); return; }
    res.writeHead(500); res.end('boom');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

describe('fetch-checked — a failed fetch must not be returnable as data', () => {
  test('a real 200 with a real body is returned, with its byte count', async () => {
    const r = await fetchChecked(`${base}/ok`);
    assert.equal(r.status, 200);
    assert.equal(r.bytes, 500);
    assert.equal(r.body.length, 500);
  });

  test('a 404 THROWS rather than returning its body — the 2026-09-06 defect', async () => {
    // The caller that hit this parsed the 404 body for error counts, found none, and published
    // "0 errors on the base build". The body must never reach a caller as a value.
    await assert.rejects(
      () => fetchChecked(`${base}/notfound`),
      (e) => e instanceof FetchRefused && e.kind === 'status' && e.status === 404,
    );
  });

  test('the refusal names what would have been parsed, so the misread is visible', async () => {
    const e = await fetchChecked(`${base}/notfound`).catch((x) => x);
    assert.match(e.message, /HTTP 404/);
    assert.match(e.message, /Build not found/, 'the body that nearly became data must appear in the refusal');
  });

  test('an empty 200 body is a refusal — a zero found in nothing is not a measured zero', async () => {
    await assert.rejects(
      () => fetchChecked(`${base}/empty`),
      (e) => e instanceof FetchRefused && e.kind === 'empty',
    );
  });

  test('a body under minBytes is a refusal — this is what catches a valid-JSON error page', async () => {
    await assert.rejects(
      () => fetchChecked(`${base}/tiny`, { minBytes: 100 }),
      (e) => e instanceof FetchRefused && e.kind === 'short' && e.bytes === 2,
    );
  });

  test('the same tiny body is ACCEPTED when the caller declares no minimum — the floor is opt-in above 1', async () => {
    const r = await fetchChecked(`${base}/tiny`);
    assert.equal(r.bytes, 2, 'minBytes defaults to 1, so only empty is refused by default');
  });

  test('a timeout is a refusal, not an empty answer', async () => {
    await assert.rejects(
      () => fetchChecked(`${base}/slow`, { timeoutMs: 50 }),
      (e) => e instanceof FetchRefused && e.kind === 'timeout',
    );
  });

  test('an unreachable host is a refusal naming the address — the veld-port defect', async () => {
    // Reported as "the service is down" when the address was simply wrong. The refusal must
    // carry the URL so the next reader checks WHERE it looked before concluding WHAT it found.
    const e = await fetchChecked('http://127.0.0.1:9/never', { timeoutMs: 2000 }).catch((x) => x);
    assert.ok(e instanceof FetchRefused);
    assert.ok(['network', 'timeout'].includes(e.kind));
    assert.match(e.message, /127\.0\.0\.1:9/, 'the refusal must name the address it actually tried');
  });

  test('a 5xx is refused on the same footing as a 404', async () => {
    await assert.rejects(
      () => fetchChecked(`${base}/other`),
      (e) => e instanceof FetchRefused && e.kind === 'status' && e.status === 500,
    );
  });
});
