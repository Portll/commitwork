// routes/issue-detail.mjs — the per-issue lodging surface, against a really-spawned panel with a
// real login: the source-bearing prompt half is operator-port only, lodging is a claim that never
// closes, /api/issue leaks no paths. Fixture store built through monitor/issue-store.mjs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';

import { emptyIssuesDoc, mintIssue, saveIssues, withIssuesLock, loadIssues, FIX_TYPES } from '../../monitor/issue-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-issdetail-'));
const ISSUES = join(TMP, 'issues.json');

const PUBLIC_HOST = 'commitwork.example.net';
// The two things that must never cross the published port: the file path and the anchored source.
const PATH_MARKER = 'src/deep/holder.js';
const SOURCE_MARKER = 'const takenFromTheRequest = eval(userInput)';

let port, localPort, child, csrf, cookie, issueId;

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

// Raw node:http, not fetch — the Host header is load-bearing and undici drops it silently.
function hit(path, { method = 'GET', host = 'localhost', headers = {}, body = null, operator = false } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host, ...(cookie ? { cookie } : {}), ...headers };
    if (body != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
    const req = request({ host: '127.0.0.1', port: operator ? localPort : port, path, method, headers: h }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch { /* html or empty */ }
        resolve({ status: res.statusCode, headers: res.headers, body: buf, json });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}
const post = (path, payload, opts = {}) =>
  hit(path, { ...opts, method: 'POST', body: JSON.stringify(payload), headers: { 'x-cw-csrf': csrf, ...(opts.headers || {}) } });

const BOOT_ATTEMPTS = 3;

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    defaultManifest: 'security-baseline', roots: [],
    // resolves the issue's repo to TMP so the composition reads the real fixture file
    projects: [{ name: 'commitwork', path: TMP, manifest: 'security-baseline', area: 'fixarea' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
  }));
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });
  // a real file at the anchor, so the prompt has genuine source to carry (and to leak, if it can)
  mkdirSync(join(TMP, 'src', 'deep'), { recursive: true });
  writeFileSync(join(TMP, PATH_MARKER), `one\n${SOURCE_MARKER}\nthree\n`);

  const at = '2026-08-01T00:00:00.000Z';
  const doc = emptyIssuesDoc();
  doc.organisation = 'FIXTURE';
  const { id } = mintIssue(doc, {
    area: 'fixarea', repo: 'commitwork', kind: 'code', severity: 'high',
    title: 'js/code-injection [sastCodeql] (commitwork)',
    body: `user input reaches eval at ${PATH_MARKER}:2`,
    remediation: null,
    source: { kind: 'scanner-row', key: `sc:commitwork|sastCodeql|js/code-injection|${PATH_MARKER}|2`, tool: 'sastCodeql', rule: 'js/code-injection' },
    anchor: { file: PATH_MARKER, line: 2, hash: null },
  }, at);
  issueId = id;
  doc.lastIngest.fixarea = { sliceId: 'sweep-20260801000000', generated: at };
  // saveIssues refuses to write without the store's lock; a fixture build is not exempt from it.
  withIssuesLock(() => saveIssues(doc, { path: ISSUES }), { path: ISSUES });

  let lastErr = '';
  for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt++) {
    port = await freePort();
    localPort = await freePort();
    let err = '';
    child = spawn(process.execPath, [SERVE], {
      env: {
        ...process.env,
        CW_AUTH_STORE: join(TMP, 'users.json'),
        CW_REGISTRY: join(TMP, 'projects.json'),
        CW_ISSUES: ISSUES,
        CW_LEARNING: join(TMP, 'learning.json'),
          CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (d) => { err += String(d); });
    csrf = null;
    for (let i = 0; i < 100; i++) {
      try { const r = await hit('/api/csrf'); if (r.status === 200) { csrf = r.json.token; break; } } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (csrf) break;
    child.kill('SIGKILL');
    lastErr = err;
  }
  assert.ok(csrf, `panel did not come up in ${BOOT_ATTEMPTS} attempts${lastErr ? ` — last stderr:\n${lastErr}` : ''}`);

  // bootstrap + log in: these routes require a REAL session, loopback included
  const boot = await post('/auth/bootstrap', { email: 'op@example.com', password: 'correct horse battery' }, { host: 'localhost', operator: true });
  assert.equal(boot.status, 200, `bootstrap should succeed over loopback: ${boot.body}`);
  const login = await post('/auth/login', { email: 'op@example.com', password: 'correct horse battery' }, { host: 'localhost', operator: true });
  assert.equal(login.status, 200, `login should succeed: ${login.body}`);
  cookie = String(login.headers['set-cookie'] || '').split(';')[0];
  assert.match(cookie, /cw_admin_sid=/);
});

after(() => { child?.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

// ── session required, loopback included ──────────────────────────────────────
test('an unauthenticated operator-port call is refused — the dispatcher runs above the login gate', async () => {
  const saved = cookie; cookie = null;
  try {
    for (const path of ['/api/issue?id=' + issueId, '/api/issue/prompt?id=' + issueId, '/api/issue/llm/targets']) {
      const r = await hit(path, { operator: true });
      assert.equal(r.status, 401, `${path} must require a session even on the operator port`);
    }
  } finally { cookie = saved; }
});

// ── the lodging surface is tunnel-safe ───────────────────────────────────────
test('GET /api/issue answers from BOTH ports and never carries source, path or source key', async () => {
  for (const operator of [true, false]) {
    const r = await hit(`/api/issue?id=${issueId}`, { operator, host: operator ? 'localhost' : PUBLIC_HOST });
    assert.equal(r.status, 200, `detail must answer on the ${operator ? 'operator' : 'published'} port`);
    assert.equal(r.json.id, issueId);
    assert.equal(r.json.rule, 'js/code-injection');
    assert.equal(r.json.tool, 'sastCodeql');
    assert.ok(!r.body.includes(PATH_MARKER), 'the anchor/source-key file path must not cross this route');
    assert.ok(!r.body.includes(SOURCE_MARKER), 'source must not cross this route');
    assert.ok(!r.body.includes('user input reaches eval'), 'the scanner message must not cross this route');
  }
});

test('promptAvailable states which half this caller may render — true local, false tunnelled', async () => {
  const local = await hit(`/api/issue?id=${issueId}`, { operator: true });
  assert.equal(local.json.promptAvailable, true);
  const remote = await hit(`/api/issue?id=${issueId}`, { host: PUBLIC_HOST });
  assert.equal(remote.json.promptAvailable, false, 'the tunnelled client must know the buttons are unavailable, not guess');
});

test('the vocabularies travel with the payload so the client cannot invent its own copy', async () => {
  const r = await hit(`/api/issue?id=${issueId}`, { operator: true });
  assert.deepEqual(r.json.vocab.fixTypes, [...FIX_TYPES]);
  assert.deepEqual(r.json.vocab.dispositions, ['false-positive', 'remediated', 'not-applicable']);
  assert.ok(r.json.vocab.rescanLevels.includes('none'), '"none" must be sayable out loud');
  assert.equal(r.json.vocab.notes.min, 8);
  assert.equal(r.json.vocab.notes.max, 2000);
});

test('an unknown id is 404, not an empty-looking 200', async () => {
  const r = await hit('/api/issue?id=ISS-NOSUCH', { operator: true });
  assert.equal(r.status, 404);
});

// ── the prompt half is operator-port only ────────────────────────────────────
test('GET /api/issue/prompt serves the composed prompt on the operator port', async () => {
  const r = await hit(`/api/issue/prompt?id=${issueId}`, { operator: true });
  assert.equal(r.status, 200);
  assert.match(r.json.prompt, /^You are triaging one static-analysis finding/);
  assert.ok(r.json.prompt.includes('Rule: js/code-injection'));
  assert.ok(r.json.prompt.includes(`Location: ${PATH_MARKER}:2`), 'the prompt DOES carry the located anchor — that is why it is gated');
  // Proves the prompt really carries source — else the no-leak tests pass vacuously.
  assert.ok(r.json.prompt.includes(SOURCE_MARKER), 'the prompt DOES carry the anchored source');
  assert.ok(r.json.prompt.includes(`2 >> ${SOURCE_MARKER}`), 'the flagged line is marked');
});

test('every source-bearing route is 403 through the published port, with a reason naming the fix', async () => {
  const calls = [
    ['GET', `/api/issue/prompt?id=${issueId}`, null],
    ['GET', '/api/issue/llm/targets', null],
    ['POST', '/api/issue/llm', { id: issueId, engine: 'lmstudio', model: 'x' }],
    ['POST', '/api/issue/claude', { id: issueId }],
  ];
  for (const [method, path, payload] of calls) {
    const r = payload
      ? await post(path, payload, { host: PUBLIC_HOST })
      : await hit(path, { host: PUBLIC_HOST });
    assert.equal(r.status, 403, `${method} ${path} must be refused through the tunnel`);
    assert.equal(r.json.localOnly, true, 'the refusal is machine-readable, so the UI can explain it');
    assert.match(r.json.error, /operator port/, 'the reason names the fix, not just the refusal');
    assert.ok(!r.body.includes(SOURCE_MARKER), 'not one byte of source may ride out on a refusal');
    assert.ok(!r.body.includes(PATH_MARKER), 'not one path may ride out on a refusal');
  }
});

// ── lodging is a claim, never a close ────────────────────────────────────────
test('POST /api/issue/fix records the lodging, attributes it, and leaves the issue OPEN', async () => {
  const r = await post('/api/issue/fix', {
    id: issueId, fixType: 'code-change', notes: 'replaced eval with JSON.parse and pinned the input shape',
  }, { host: PUBLIC_HOST });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.fix.fixType, 'code-change');
  assert.equal(r.json.fix.notes, 'replaced eval with JSON.parse and pinned the input shape');
  assert.match(r.json.fix.who, /op@example\.com/, 'the lodging is attributed to the logged-in identity');
  assert.equal(r.json.state, 'open', 'a lodging must never close an issue');
  assert.equal(r.json.stillOpen, true, 'stated on every success, so ok:true cannot read as "done"');
  assert.match(r.json.note, /claim/i);
  assert.deepEqual(r.json.learning, {
    ok: true, state: 'rebuilt', generatedAt: r.json.fix.at, patterns: 1,
  });
  assert.ok(existsSync(join(TMP, 'learning.json')), 'the event-triggered learning view was written');

  // and it is durable, through the library rather than by re-reading our own response
  const doc = loadIssues({ path: ISSUES });
  assert.equal(doc.issues[issueId].fix.fixType, 'code-change');
  assert.equal(doc.issues[issueId].state, 'open');
  assert.equal(doc.issues[issueId].closedAs, null);
  assert.deepEqual(doc.issues[issueId].evidence, [], 'a lodging is not evidence');
});

test('POST /api/issue/fix refuses a bad vocabulary or an empty annotation, and changes nothing', async () => {
  const before = JSON.stringify(loadIssues({ path: ISSUES }).issues[issueId].fix);
  for (const body of [
    { id: issueId, fixType: 'fixed', notes: 'a long enough annotation here' },
    { id: issueId, fixType: 'code-change', notes: 'short' },
    { id: issueId, fixType: 'code-change' },
  ]) {
    const r = await post('/api/issue/fix', body, { host: PUBLIC_HOST });
    assert.equal(r.status, 400, `${JSON.stringify(body)} must be refused`);
    assert.ok(r.json.error, 'the refusal names itself');
  }
  assert.equal(JSON.stringify(loadIssues({ path: ISSUES }).issues[issueId].fix), before, 'not one refusal left a partial write');
});

test('POST /api/issue/fix on an unknown id is 404', async () => {
  const r = await post('/api/issue/fix', { id: 'ISS-NOSUCH', fixType: 'wont-fix', notes: 'this should not land' }, { host: PUBLIC_HOST });
  assert.equal(r.status, 404);
});

test('there is no route here that can close an issue', async () => {
  // the closing verbs live in bin/issue.mjs and the evidence-gated auto-close, deliberately
  for (const path of ['/api/issue/close', '/api/issue/state']) {
    const r = await post(path, { id: issueId, as: 'fixed' }, { operator: true });
    assert.notEqual(r.status, 200, `${path} must not exist`);
  }
  assert.equal(loadIssues({ path: ISSUES }).issues[issueId].state, 'open');
});

// ── fail closed ──────────────────────────────────────────────────────────────
test('a corrupt store is 503 with the reason — never an empty-looking answer', async () => {
  writeFileSync(ISSUES, 'not json {{{');
  const r = await hit(`/api/issue?id=${issueId}`, { operator: true });
  assert.equal(r.status, 503, 'a broken store must surface, not read as "no such issue"');
  assert.match(r.json.error, /issue store unavailable/);
});
