// GET /api/comments, POST /api/comments/accept and POST /api/comments/sweep, invoked through their
// handlers with the ctx the dispatcher builds (admin/serve.mjs MODULAR_ROUTES loop): no `authed`, no
// `body` — a body arrives only through readJsonBody. The scanned repos and the sweep ledgers are temp
// fixtures reached through CW_COMMENT_ROOT / CW_SLOP_SPINE_ROOT / CW_SLOP_*SWEEP_LOG; HOME is a temp
// dir and CW_NOW pins the ledger clock. What is asserted is the tree and the ledger on disk.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-comments-entry-'));
const NOW = '2026-10-07T00:00:00.000Z';
const KEYS = ['HOME', 'CW_COMMENT_ROOT', 'CW_SLOP_SPINE_ROOT', 'CW_SLOP_SWEEP_LOG', 'CW_SLOP_SPINE_SWEEP_LOG', 'CW_NOW',
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];
const saved = {};
for (const k of KEYS) saved[k] = process.env[k];
// A hook-exported GIT_DIR would make `git -C <fixture> ls-files` list the wrong repository.
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete process.env[k];
process.env.HOME = join(TMP, 'home');
process.env.CW_NOW = NOW;
process.env.CW_SLOP_SPINE_ROOT = join(TMP, 'spine');
process.env.CW_SLOP_SPINE_SWEEP_LOG = join(TMP, 'spine-sweeps.jsonl');

const { routes } = await import('../routes/comments.mjs');
const { MAX_RUN } = await import('../../bin/comment-schema.mjs');

after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const LIST = routes.find((r) => r.method === 'GET' && r.path === '/api/comments');
const ACCEPT = routes.find((r) => r.method === 'POST' && r.path === '/api/comments/accept');
const SWEEP = routes.find((r) => r.method === 'POST' && r.path === '/api/comments/sweep');
const SESSION = { user: 'op@example.test', provider: 'password' };
const KEPT = '// fact: kept / consequence (expiry: never, prev: unknown)';

const LONG = (tag) => Array.from({ length: MAX_RUN + 4 },
  (_, i) => `// ${tag} narrative line ${i}, because the reason matters here`).join('\n');
const SRC = `${LONG('a')}\nconst x = 1;\n`;

let n = 0;
/** A git repo with one over-limit comment block in a.mjs; becomes CW_COMMENT_ROOT unless told otherwise. */
function repo({ at = join(TMP, `repo-${++n}`), files = { 'a.mjs': SRC }, current = true } = {}) {
  mkdirSync(at, { recursive: true });
  execFileSync('git', ['-C', at, 'init', '-q']);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(at, name)), { recursive: true });
    writeFileSync(join(at, name), body);
  }
  execFileSync('git', ['-C', at, 'add', '-A']);
  if (current) {
    process.env.CW_COMMENT_ROOT = at;
    process.env.CW_SLOP_SWEEP_LOG = join(at, '..', `sweeps-${n}.jsonl`);
  }
  return at;
}

/** The dispatcher's ctx, nothing more. A settled promise either way, so a throw is a result too. */
const call = (route, { query = {}, body = {}, bodyErr = null, session = SESSION, loopback = false } = {}) =>
  new Promise((resolve) => {
    Promise.resolve(route.handle({
      req: {}, isLoopbackReq: loopback, adminSession: () => session,
      query: new URLSearchParams(query),
      readJsonBody: (_r, cb) => cb(bodyErr ? null : body, bodyErr),
      send: (code, payload) => resolve({ code, payload }),
    })).catch((e) => resolve({ code: 'threw', payload: String(e && e.message) }));
  });

const firstId = async () => (await call(LIST)).payload.items[0].id;

// ---- the gate

test('no session off the operator port is 401 on all three routes, and nothing is read or written', async () => {
  const d = repo();
  for (const route of [LIST, ACCEPT, SWEEP]) {
    for (const session of [null, { provider: 'password' }]) {
      const r = await call(route, { session, body: { accept: [{ id: 'a.mjs#1', text: KEPT }] } });
      assert.equal(r.code, 401, `${route.method} ${route.path} session=${JSON.stringify(session)}`);
      assert.deepEqual(r.payload, { ok: false, error: 'authentication required' });
    }
  }
  assert.equal(readFileSync(join(d, 'a.mjs'), 'utf8'), SRC, 'a refused accept writes nothing');
  assert.equal(existsSync(process.env.CW_SLOP_SWEEP_LOG), false, 'a refused sweep records nothing');
});

test('the operator port needs no session; a session needs no operator port', async () => {
  repo();
  assert.equal((await call(LIST, { session: null, loopback: true })).code, 200);
  assert.equal((await call(LIST, { session: SESSION, loopback: false })).code, 200);
});

// ---- GET /api/comments

test('list: 200 with the over-limit block from the fixture repo, and the project query is honoured', async () => {
  repo();
  const r = await call(LIST);
  assert.equal(r.code, 200);
  assert.equal(r.payload.project, 'commitwork');
  assert.equal(r.payload.total, 1);
  assert.equal(r.payload.items[0].file, 'a.mjs');
  repo({ at: process.env.CW_SLOP_SPINE_ROOT, files: { 's.mjs': SRC }, current: false });
  const s = await call(LIST, { query: { project: 'spine' } });
  assert.equal(s.payload.project, 'spine');
  assert.deepEqual(s.payload.items.map((i) => i.file), ['s.mjs'], 'the spine root, not the commitwork one');
});

test('list: a root git cannot read is a 500 that says so — never an empty bucket', async () => {
  const notRepo = join(TMP, 'not-a-repo');
  mkdirSync(notRepo, { recursive: true });
  process.env.CW_COMMENT_ROOT = notRepo;
  const r = await call(LIST);
  assert.equal(r.code, 500);
  assert.match(r.payload.error, /^suggestions could not be read: /);
});

// ---- POST /api/comments/accept: body validation

test('accept: an unparseable body is 400 and the tree is untouched', async () => {
  const d = repo();
  const r = await call(ACCEPT, { bodyErr: 'body is not valid JSON' });
  assert.equal(r.code, 400);
  assert.deepEqual(r.payload, { ok: false, error: 'body is not valid JSON' });
  assert.equal(readFileSync(join(d, 'a.mjs'), 'utf8'), SRC);
});

test('accept: accept[] missing, not an array, or empty is 400', async () => {
  const d = repo();
  for (const body of [{}, { accept: 'a.mjs#1' }, { accept: [] }]) {
    const r = await call(ACCEPT, { body });
    assert.equal(r.code, 400, JSON.stringify(body));
    assert.equal(r.payload.error, 'accept[] is required and must name at least one suggestion');
  }
  assert.equal(readFileSync(join(d, 'a.mjs'), 'utf8'), SRC);
});

test('accept: 201 picks are refused before any is applied; 200 is inside the limit', async () => {
  const d = repo();
  const id = await firstId();
  const over = await call(ACCEPT, { body: { accept: Array.from({ length: 201 }, () => ({ id, text: KEPT })) } });
  assert.equal(over.code, 400);
  assert.equal(over.payload.error, 'refusing more than 200 in one request');
  assert.equal(readFileSync(join(d, 'a.mjs'), 'utf8'), SRC, 'not even the first pick lands');
  const at = await call(ACCEPT, { body: { accept: Array.from({ length: 200 }, (_, i) => `a.mjs#${i + 50}`) } });
  assert.equal(at.code, 409, 'exactly 200 passes the limit and is judged pick by pick');
  assert.equal(at.payload.refused, 200);
});

// ---- POST /api/comments/accept: effect

test('accept: the named block is replaced on disk with the edited text, and the reply counts it', async () => {
  const d = repo();
  const id = await firstId();
  const r = await call(ACCEPT, { body: { accept: [{ id, text: KEPT }] } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.applied, 1);
  assert.equal(r.payload.refused, 0);
  assert.ok(r.payload.linesSaved > 0);
  const after = readFileSync(join(d, 'a.mjs'), 'utf8');
  assert.match(after, /fact: kept/);
  assert.doesNotMatch(after, /a narrative line 0/);
  assert.match(after, /const x = 1;/);
});

test('accept: body.project routes the write to that project\'s root', async () => {
  const d = repo();
  const spine = repo({ at: join(TMP, 'spine-accept'), files: { 's.mjs': SRC }, current: false });
  process.env.CW_SLOP_SPINE_ROOT = spine;
  try {
    const id = (await call(LIST, { query: { project: 'spine' } })).payload.items[0].id;
    const r = await call(ACCEPT, { body: { project: 'spine', accept: [{ id, text: KEPT }] } });
    assert.equal(r.code, 200, JSON.stringify(r.payload));
    assert.equal(r.payload.project, 'spine');
    assert.match(readFileSync(join(spine, 's.mjs'), 'utf8'), /fact: kept/);
    assert.equal(readFileSync(join(d, 'a.mjs'), 'utf8'), SRC, 'the commitwork root is not touched');
  } finally { process.env.CW_SLOP_SPINE_ROOT = join(TMP, 'spine'); }
});

test('accept: a target that cannot be read is refused 409 and nothing is written', async () => {
  const d = repo({ files: { 'a.mjs': SRC, 'b.mjs': 'const y = 2;\n' } });
  rmSync(join(d, 'b.mjs'));
  mkdirSync(join(d, 'b.mjs')); // tracked as a file, now a directory: EISDIR, not ENOENT
  const r = await call(ACCEPT, { body: { accept: [{ id: 'b.mjs#1', text: KEPT }] } });
  assert.equal(r.code, 409);
  assert.equal(r.payload.applied, 0);
  assert.equal(r.payload.results[0].error, 'unreadable: EISDIR');
  assert.equal(readFileSync(join(d, 'a.mjs'), 'utf8'), SRC);
});

// ---- POST /api/comments/sweep

test('sweep: 200, one dated ledger line per run at CW_NOW, and the history comes back', async () => {
  repo();
  const r = await call(SWEEP);
  assert.equal(r.code, 200);
  assert.equal(r.payload.summary.at, NOW);
  assert.equal(r.payload.history.length, 1);
  await call(SWEEP);
  const lines = readFileSync(process.env.CW_SLOP_SWEEP_LOG, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2, 'appended, not overwritten');
  assert.equal(JSON.parse(lines[1]).blocks, 1);
});

test('sweep: the project query writes that project\'s ledger', async () => {
  repo();
  repo({ at: process.env.CW_SLOP_SPINE_ROOT, files: { 's.mjs': SRC }, current: false });
  const r = await call(SWEEP, { query: { project: 'spine' } });
  assert.equal(r.code, 200);
  assert.equal(readFileSync(process.env.CW_SLOP_SPINE_SWEEP_LOG, 'utf8').trim().split('\n').length >= 1, true);
  assert.equal(existsSync(process.env.CW_SLOP_SWEEP_LOG), false, 'the commitwork ledger is not written');
});

test('sweep: a ledger that cannot be written or read is a 500 — never a sweep with no history', async () => {
  repo();
  mkdirSync(process.env.CW_SLOP_SWEEP_LOG); // a directory where the ledger file belongs
  const r = await call(SWEEP);
  assert.equal(r.code, 500);
  assert.match(r.payload.error, /^sweep failed: /);
});
