// cloudflare-purge.test.mjs — fails closed with no credentials, sends the right request shape,
// and surfaces the API's own error detail on failure. Never touches the real Cloudflare API:
// CW_CLOUDFLARE_API_BASE points at a local fake server for every test here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const CLI = resolve(REPO, 'bin', 'cloudflare-purge.mjs');

// Async, not execFileSync: a fake HTTP server the child talks back to runs in THIS process's
// event loop, and a synchronous exec blocks that loop — the child would be waiting on a server
// response the parent can never produce while it's synchronously blocked waiting on the child.
// Measured 2026-08-29: execFileSync deadlocked every test against the fake server, hanging until
// the test runner's timeout killed it.
async function run(env, args = []) {
  try {
    const { stdout } = await execFileP(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.code, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

async function fakeServer(handler) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ }
    handler(req, res, body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

test('no token: refuses before making any request (via lib/secrets.mjs, no keychain entry declared)', async () => {
  const r = await run({
    ...process.env, CW_CLOUDFLARE_API_TOKEN: '', CW_CLOUDFLARE_ZONE_ID: 'z1',
    CW_SECRETS_FILE: '/tmp/cw-purge-test-nonexistent-secrets.json',
  });
  assert.equal(r.code, 2);
  assert.match(r.out, /MISSING SECRET.*CW_CLOUDFLARE_API_TOKEN/s);
});

test('token but no zone id: refuses before making any request', async () => {
  const r = await run({ ...process.env, CW_CLOUDFLARE_API_TOKEN: 't1', CW_CLOUDFLARE_ZONE_ID: '' });
  assert.equal(r.code, 2);
  assert.match(r.out, /CW_CLOUDFLARE_ZONE_ID is not set/);
});

test('no --files: purges everything, with the token as a bearer header', async () => {
  let seen = null;
  const s = await fakeServer((req, res, body) => {
    seen = { authorization: req.headers.authorization, body };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, result: { id: 'purge-1' } }));
  });
  try {
    const r = await run({ ...process.env, CW_CLOUDFLARE_API_TOKEN: 'secret-tok', CW_CLOUDFLARE_ZONE_ID: 'zone-9', CW_CLOUDFLARE_API_BASE: s.base });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /purged entire zone cache/);
    assert.equal(seen.authorization, 'Bearer secret-tok');
    assert.deepEqual(seen.body, { purge_everything: true });
  } finally { await s.close(); }
});

test('--files <urls>: purges exactly those urls, not everything', async () => {
  let seen = null;
  const s = await fakeServer((req, res, body) => {
    seen = body;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  });
  try {
    const r = await run(
      { ...process.env, CW_CLOUDFLARE_API_TOKEN: 't', CW_CLOUDFLARE_ZONE_ID: 'z', CW_CLOUDFLARE_API_BASE: s.base },
      ['--files', 'https://i.commitwork.online/taxonomy/', 'https://i.commitwork.online/guide/'],
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /purged 2 url\(s\)/);
    assert.deepEqual(seen, { files: ['https://i.commitwork.online/taxonomy/', 'https://i.commitwork.online/guide/'] });
  } finally { await s.close(); }
});

test('the API refusing the request surfaces its own error detail, not a bare status', async () => {
  const s = await fakeServer((req, res) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] }));
  });
  try {
    const r = await run({ ...process.env, CW_CLOUDFLARE_API_TOKEN: 'bad', CW_CLOUDFLARE_ZONE_ID: 'z', CW_CLOUDFLARE_API_BASE: s.base });
    assert.equal(r.code, 2);
    assert.match(r.out, /1000: Invalid API Token/);
  } finally { await s.close(); }
});

test('--files with nothing following it is refused, not silently sent as purge_everything', async () => {
  const r = await run({ ...process.env, CW_CLOUDFLARE_API_TOKEN: 't', CW_CLOUDFLARE_ZONE_ID: 'z' }, ['--files']);
  assert.equal(r.code, 2);
  assert.match(r.out, /--files given with no urls/);
});
