// bin/lib/wp-source.mjs — the WordPress lanes' one door to the network: base overrides read at call
// time, the private cache (hit, TTL, stale on failure, 0600), offline mode, the file:// mirror and
// stated reasons for every failure. The only server is an in-process one on loopback.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { request, baseOf, cacheLabel, cacheDir, mapPool, tally } from '../lib/wp-source.mjs';
import { scratch, cleanup, write } from './wp-fixture.mjs';

let server;
let base;
const hits = {};
let fail500 = new Set();
before(async () => {
  server = createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    if (req.url.startsWith('/hang')) return; // never answers: the timeout case
    if (fail500.has(req.url)) { res.writeHead(500); res.end('down'); return; }
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (req.url === '/plugin-checksums/acme/1.0.json') return send(200, { files: { 'a.php': { md5: 'x', sha256: 'y' } } });
    if (req.url === '/plugin-checksums/none/1.0.json') return send(404, 'Not found');
    if (req.url === '/plugin/acme/') return send(200, { error: 0, data: { name: 'Acme', vulnerability: null }, updated: 1 });
    if (req.url === '/plugin/garbled/') return send(200, '<html>');
    if (req.url.startsWith('/core/checksums/1.0/?version=9.9')) return send(200, { checksums: false });
    return send(404, 'Not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); cleanup(); });

const KEYS = ['CW_WP_API_URL', 'CW_WP_DOWNLOADS_URL', 'CW_WPVULN_URL', 'CW_WP_CACHE', 'CW_WP_OFFLINE', 'CW_WP_TIMEOUT_MS', 'CW_WPVULN_TTL_HOURS', 'CW_NOW'];
async function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try { return await fn(); } finally { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const files = (dir) => readdirSync(dir, { recursive: true }).map(String).filter((p) => statSync(join(dir, p)).isFile());

describe('wp-source: network and cache', () => {
  test('a first answer comes from the network and is cached 0600; the second comes from the cache', async () => {
    const cache = scratch('cw-wp-cache-');
    await withEnv({ CW_WP_DOWNLOADS_URL: base, CW_WP_CACHE: cache }, async () => {
      const a = await request('plugin-checksums', { slug: 'acme', version: '1.0' });
      assert.equal(a.status, 'ok');
      assert.equal(a.via, 'network');
      const b = await request('plugin-checksums', { slug: 'acme', version: '1.0' });
      assert.equal(b.via, 'cache');
      assert.deepEqual(b.body, a.body);
      assert.equal(hits['/plugin-checksums/acme/1.0.json'], 1, 'the cache answered the second request');
    });
    const cached = files(cache);
    assert.equal(cached.length, 1);
    if (process.platform !== 'win32') assert.equal(statSync(join(cache, cached[0])).mode & 0o777, 0o600);
  });

  test('a 404 is not-found, and is cached too; a 500 is an error with its reason and is not cached', async () => {
    const cache = scratch('cw-wp-cache-');
    await withEnv({ CW_WP_DOWNLOADS_URL: base, CW_WPVULN_URL: base, CW_WP_CACHE: cache }, async () => {
      assert.equal((await request('plugin-checksums', { slug: 'none', version: '1.0' })).status, 'not-found');
      assert.equal((await request('plugin-checksums', { slug: 'none', version: '1.0' })).via, 'cache');
      fail500 = new Set(['/plugin/down/']);
      const e = await request('advisories', { type: 'plugin', key: 'down' });
      assert.equal(e.status, 'error');
      assert.match(e.reason, /HTTP 500/);
      const g = await request('advisories', { type: 'plugin', key: 'garbled' });
      assert.match(g.reason, /not JSON/);
    });
    assert.equal(files(cache).length, 1);
    fail500 = new Set();
  });

  test('api.wordpress.org\'s {"checksums":false} is not-found', async () => {
    await withEnv({ CW_WP_API_URL: base, CW_WP_CACHE: 'off' }, async () => {
      assert.equal((await request('core-checksums', { version: '9.9', locale: 'en_US' })).status, 'not-found');
    });
  });

  test('an expired advisory answer is refetched; when the source then fails, the stale copy is used and marked', async () => {
    const cache = scratch('cw-wp-cache-');
    await withEnv({ CW_WPVULN_URL: base, CW_WP_CACHE: cache, CW_NOW: '2026-01-01T00:00:00Z' }, () => request('advisories', { type: 'plugin', key: 'acme' }));
    const before = hits['/plugin/acme/'];
    const fresh = await withEnv({ CW_WPVULN_URL: base, CW_WP_CACHE: cache, CW_NOW: '2026-01-01T23:00:00Z' }, () => request('advisories', { type: 'plugin', key: 'acme' }));
    assert.equal(fresh.via, 'cache');
    fail500 = new Set(['/plugin/acme/']);
    const stale = await withEnv({ CW_WPVULN_URL: base, CW_WP_CACHE: cache, CW_NOW: '2026-01-02T01:00:00Z' }, () => request('advisories', { type: 'plugin', key: 'acme' }));
    fail500 = new Set();
    assert.equal(stale.via, 'stale-cache');
    assert.equal(stale.status, 'ok');
    assert.equal(stale.ageHours, 25);
    assert.match(stale.reason, /HTTP 500/);
    assert.equal(hits['/plugin/acme/'], before + 1, 'refetched once when expired, never while fresh');
  });

  test('offline: the cache answers, and with no cache the answer is an error that says so', async () => {
    const cache = scratch('cw-wp-cache-');
    await withEnv({ CW_WP_DOWNLOADS_URL: base, CW_WP_CACHE: cache }, () => request('plugin-checksums', { slug: 'acme', version: '1.0' }));
    const n = hits['/plugin-checksums/acme/1.0.json'];
    await withEnv({ CW_WP_DOWNLOADS_URL: base, CW_WP_CACHE: cache, CW_WP_OFFLINE: '1' }, async () => {
      assert.equal((await request('plugin-checksums', { slug: 'acme', version: '1.0' })).via, 'cache');
      const miss = await request('plugin-checksums', { slug: 'other', version: '1.0' });
      assert.equal(miss.status, 'error');
      assert.match(miss.reason, /offline \(CW_WP_OFFLINE=1\); no cached copy/);
    });
    assert.equal(hits['/plugin-checksums/acme/1.0.json'], n, 'offline opened no connection');
  });

  test('a source that never answers times out with the reason stated', async () => {
    await withEnv({ CW_WPVULN_URL: `${base}/hang`, CW_WP_CACHE: 'off', CW_WP_TIMEOUT_MS: '200' }, async () => {
      const r = await request('advisories', { type: 'plugin', key: 'x' });
      assert.equal(r.status, 'error');
      assert.match(r.reason, /timed out after 200 ms/);
    });
  });

  test('an unreachable source is an error naming the cause, never an empty answer', async () => {
    await withEnv({ CW_WPVULN_URL: 'http://127.0.0.1:9', CW_WP_CACHE: 'off', CW_WP_TIMEOUT_MS: '2000' }, async () => {
      const r = await request('advisories', { type: 'plugin', key: 'x' });
      assert.equal(r.status, 'error');
      assert.match(r.reason, /network error/);
      assert.equal(r.body, undefined);
    });
  });
});

describe('wp-source: the file:// mirror, labels and helpers', () => {
  test('a file:// base reads the mirror layout; ENOENT is not-found, a torn file an error; nothing is cached', async () => {
    const dir = write(scratch('cw-wp-src-'), { 'plugin/acme.json': JSON.stringify({ error: 0, data: { name: 'A' } }), 'plugin/torn.json': '{' });
    const cache = scratch('cw-wp-cache-');
    await withEnv({ CW_WPVULN_URL: pathToFileURL(dir).href, CW_WP_CACHE: cache, CW_WP_OFFLINE: '1' }, async () => {
      const ok = await request('advisories', { type: 'plugin', key: 'acme' });
      assert.equal(ok.status, 'ok');
      assert.equal(ok.via, 'file');
      assert.equal((await request('advisories', { type: 'plugin', key: 'gone' })).status, 'not-found');
      assert.equal((await request('advisories', { type: 'plugin', key: 'torn' })).status, 'error');
      assert.match(baseOf('advisories').label, /^file \(CW_WPVULN_URL\)$/, 'a local path never reaches a report');
    });
    assert.equal(files(cache).length, 0);
  });

  test('overrides are read at call time, and the labels never carry a path', async () => {
    await withEnv({}, async () => {
      assert.equal(baseOf('plugin-checksums').label, 'https://downloads.wordpress.org');
      assert.equal(cacheLabel(), 'default');
      assert.match(cacheDir(), /\.commitwork[/\\]cache[/\\]wordpress$/);
    });
    await withEnv({ CW_WP_DOWNLOADS_URL: 'https://mirror.example/', CW_WP_CACHE: '/tmp/somewhere' }, async () => {
      assert.equal(baseOf('plugin-checksums').label, 'https://mirror.example (CW_WP_DOWNLOADS_URL)');
      assert.equal(cacheLabel(), 'CW_WP_CACHE');
    });
    await withEnv({ CW_WP_CACHE: 'off' }, async () => { assert.equal(cacheDir(), null); assert.equal(cacheLabel(), 'off'); });
    await withEnv({ CW_WPVULN_URL: 'ftp://x' }, async () => {
      assert.match((await request('advisories', { type: 'plugin', key: 'x' })).reason, /not an http\(s\) or file URL/);
    });
  });

  test('mapPool keeps order under concurrency; tally counts where answers came from', async () => {
    const out = await mapPool([30, 10, 20], 2, (ms, i) => new Promise((r) => setTimeout(() => r(i), ms)));
    assert.deepEqual(out, [0, 1, 2]);
    assert.deepEqual(tally([{ status: 'ok', via: 'network' }, { status: 'ok', via: 'cache' }, { status: 'not-found', via: 'stale-cache' }, { status: 'error', via: 'none' }, { status: 'ok', via: 'file', cacheProblem: 'x' }]),
      { network: 1, cache: 1, staleCache: 1, file: 1, failed: 1, cacheWriteFailures: 1 });
  });

  test('an unwritable cache is reported on the answer, and the answer still arrives', { skip: process.platform === 'win32' ? 'needs POSIX paths' : false }, async () => {
    const blocker = join(scratch('cw-wp-cache-'), 'file');
    writeFileSync(blocker, 'not a directory');
    await withEnv({ CW_WP_DOWNLOADS_URL: base, CW_WP_CACHE: blocker }, async () => {
      const r = await request('plugin-checksums', { slug: 'acme', version: '1.0' });
      assert.equal(r.status, 'ok');
      assert.match(r.cacheProblem, /cache write failed/);
    });
  });
});
