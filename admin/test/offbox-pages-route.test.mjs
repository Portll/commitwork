// GET /api/offbox/pages — the received off-box pages as JSON.
//   (1) through the REAL server: an unauthenticated request is refused and carries no page data.
//       The route holds no auth of its own; it is safe only because modular dispatch sits behind
//       the login gate, so this is asserted over HTTP and not by reading serve.mjs.
//   (2) through the handler, with CW_OFFBOX_PAGE_STORE pointed at a temp path, all three store
//       states: present, legitimately absent (ENOENT, reported as absent:true and not as a pass),
//       and unreadable (503 naming the store, never an empty list).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes } from '../routes/offbox.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 17951;
const OP_PORT = 17952;
const TMP = mkdtempSync(join(tmpdir(), 'cw-offbox-pages-'));
const STORE = join(TMP, 'pages.jsonl');
const ROUTE = routes.find((r) => r.method === 'GET' && r.path === '/api/offbox/pages');
const SENTINEL = 'sentinel-ref-7f3a';
const rec = (o) => JSON.stringify({ kind: 'offbox-page', receivedAt: '2026-10-01T00:00:00Z', state: 'ok', alarms: 0, ref: null, ...o });

let child = null;
let saved;

const call = () => new Promise((resolveCall) => {
  ROUTE.handle({ send: (code, payload) => resolveCall({ code, payload }) });
});

before(async () => {
  saved = process.env.CW_OFFBOX_PAGE_STORE;
  writeFileSync(STORE, `${rec({ ref: SENTINEL, state: 'STALE-LEDGER', alarms: 2 })}\n`);
  child = spawn(process.execPath, [join(REPO, 'admin', 'serve.mjs')], {
    cwd: REPO,
    env: {
      ...process.env, CW_SELF_SWEEP: '0',
      CW_ADMIN_PORT: String(PORT), CW_ADMIN_LOCAL_PORT: String(OP_PORT),
      CW_AUTH_STORE: join(TMP, 'users.json'),
      CW_OFFBOX_PAGE_STORE: STORE,
      CW_REGISTRY: join(REPO, 'monitor', 'projects.example.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not report listening within 15s')), 15_000);
    let seen = '';
    child.stdout.on('data', (d) => { seen += d; if (seen.includes('commitwork operator')) { clearTimeout(t); res(); } });
    child.on('exit', (c) => rej(new Error(`server exited early (${c})`)));
  });
});
after(() => {
  if (child) child.kill('SIGKILL');
  if (saved === undefined) delete process.env.CW_OFFBOX_PAGE_STORE; else process.env.CW_OFFBOX_PAGE_STORE = saved;
  rmSync(TMP, { recursive: true, force: true });
});

test('over the real server, an unauthenticated GET is refused and leaks no page', async () => {
  const r = await new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/api/offbox/pages', headers: { host: 'localhost' } }, (m) => {
      const c = [];
      m.on('data', (d) => c.push(d));
      m.on('end', () => res({ code: m.statusCode, body: Buffer.concat(c).toString('utf8') }));
    }).on('error', rej);
  });
  assert.ok(r.code === 401 || r.code === 503, `expected a session refusal, got ${r.code}: ${r.body.slice(0, 160)}`);
  assert.ok(!r.body.includes(SENTINEL), 'the refusal body carried a stored page');
  assert.ok(!/"pages"/.test(r.body), 'the refusal body carried the pages structure');
});

test('present store: 200, newest first, with the structure the panel reads', async () => {
  process.env.CW_OFFBOX_PAGE_STORE = join(TMP, 'present.jsonl');
  writeFileSync(process.env.CW_OFFBOX_PAGE_STORE,
    `${rec({ ref: 'first', receivedAt: '2026-10-01T00:00:00Z' })}\n${rec({ ref: 'second', state: 'STALE-LEDGER', alarms: 3 })}\ntorn{not json\n`);
  const r = await call();
  assert.equal(r.code, 200);
  assert.equal(r.payload.ok, true);
  assert.equal(r.payload.absent, false);
  assert.deepEqual(r.payload.pages.map((p) => p.ref), ['second', 'first'], 'newest first');
  assert.equal(r.payload.pages[0].alarms, 3);
  assert.equal(r.payload.torn, 1, 'a torn line is counted, not dropped silently');
  assert.equal(r.payload.records, 3);
});

test('absent store (ENOENT): 200 with absent:true — an absence, not an empty pass', async () => {
  process.env.CW_OFFBOX_PAGE_STORE = join(TMP, 'never-written.jsonl');
  const r = await call();
  assert.equal(r.code, 200);
  assert.equal(r.payload.ok, true);
  assert.equal(r.payload.absent, true);
  assert.deepEqual(r.payload.pages, []);
});

test('unreadable store is NOT an empty one: 503 naming the store', async () => {
  const asDir = join(TMP, 'a-directory.jsonl');
  mkdirSync(asDir);
  process.env.CW_OFFBOX_PAGE_STORE = asDir;
  const r = await call();
  assert.equal(r.code, 503);
  assert.equal(r.payload.ok, false);
  assert.match(r.payload.error, /page store unavailable/);
  assert.equal(r.payload.pages, undefined, 'a failure must not carry a pages list');
  assert.equal(r.payload.absent, undefined);
});

test('permission-denied store fails closed too', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX chmod cannot make a file unreadable to its owner on NTFS');
  if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('running as root: chmod 000 is still readable');
  const f = join(TMP, 'locked.jsonl');
  writeFileSync(f, `${rec({})}\n`);
  chmodSync(f, 0o000);
  process.env.CW_OFFBOX_PAGE_STORE = f;
  try {
    const r = await call();
    assert.equal(r.code, 503);
    assert.equal(r.payload.ok, false);
    assert.equal(r.payload.pages, undefined);
  } finally { chmodSync(f, 0o600); }
});

test('the store path is read at call time, not at module load', async () => {
  process.env.CW_OFFBOX_PAGE_STORE = join(TMP, 'x1.jsonl');
  writeFileSync(process.env.CW_OFFBOX_PAGE_STORE, `${rec({ ref: 'one' })}\n`);
  const a = await call();
  process.env.CW_OFFBOX_PAGE_STORE = join(TMP, 'x2.jsonl');
  writeFileSync(process.env.CW_OFFBOX_PAGE_STORE, `${rec({ ref: 'two' })}\n`);
  const b = await call();
  assert.equal(a.payload.pages[0].ref, 'one');
  assert.equal(b.payload.pages[0].ref, 'two');
});
