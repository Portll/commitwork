// The triage handoff, dispatched into overwatch-layer's runner: a reachable runner wins (via:'overwatch',
// no Terminal opened), the runner receives exactly what commitwork composed, and degradation to
// the Terminal path is declared via overwatchWhy, never silent.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http, { request } from 'node:http';
import { createServer } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const CW = join(HERE, '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-handoff-sub-'));
const ARTIFACT_MARKER = 'ARTIFACT-MARKER-OVERWATCH';
// The runner's operator token (substrate server/runner/token.mjs), a fixture value in a 0600 file.
const RUNNER_TOKEN = 'f'.repeat(64);
const TOKEN_FILE = join(TMP, 'runner-token');
writeFileSync(TOKEN_FILE, RUNNER_TOKEN + '\n', { mode: 0o600 });

const MANIFEST_PROMPT = JSON.parse(readFileSync(join(CW, 'manifests', 'security-baseline.json'), 'utf8'))
  .checks.find((c) => c.id === 'secrets-gitleaks').remediationPrompt;
assert.ok(MANIFEST_PROMPT, 'secrets-gitleaks lost its remediationPrompt — the fixture premise changed');

let localPort, child, fakeRunner, runnerPort;
let runnerMode = 'ok';                 // 'ok' | 'refuse'
const seen = { dispatches: [] };       // what the runner was actually sent

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

const hit = (path, { method = 'GET', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const h = { ...headers };
  if (body != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
  const req = request({ host: '127.0.0.1', port: localPort, path, method, headers: h }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, body: buf, json }); });
  });
  req.on('error', reject);
  if (body != null) req.write(body);
  req.end();
});

let csrf;
const post = async (path, payload) => hit(path, { method: 'POST', body: JSON.stringify(payload), headers: { 'x-cw-csrf': csrf } });

before(async () => {
  const batch = join(TMP, 'reports', 'sweep-20260802000000-fixarea');
  mkdirSync(join(batch, 'alpha'), { recursive: true });
  writeFileSync(join(batch, 'alpha', 'gitleaks.json'),
    JSON.stringify([{ RuleID: 'aws-key', File: 'src/a.js', StartLine: 5, note: ARTIFACT_MARKER }]));
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    // `manifest` is schema-required; `areas` must declare fixarea or project:'fixarea' resolves
    // to null and reportsFor(null) falls back to the REAL reports tree.
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
    projects: [{ name: 'alpha', path: join(TMP, 'alpha'), area: 'fixarea', manifest: 'security-baseline' }],
  }));
  mkdirSync(join(TMP, 'alpha'), { recursive: true });
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });
  writeFileSync(join(TMP, 'reports', 'fixarea', 'rollup.json'), JSON.stringify({
    generated: '2026-08-02T00:00:00.000Z', source: batch,
    totals: { crit: 0, high: 1, med: 0, low: 0 },
    scanners: { secrets: { total: 1, crit: 0, high: 1, med: 0, low: 0 } },
    repos: [{ name: 'alpha', scanners: { secrets: { total: 1 } } }],
  }));

  // the fake overwatch-layer runner
  runnerPort = await freePort();
  fakeRunner = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/agents/dispatch') {
      let buf = '';
      req.setEncoding('utf8');
      req.on('data', (d) => { buf += d; });
      req.on('end', () => {
        const body = JSON.parse(buf || '{}');
        seen.dispatches.push({ body, headers: req.headers });
        res.setHeader('content-type', 'application/json');
        if (runnerMode === 'refuse') {
          res.statusCode = 429;
          res.end(JSON.stringify({ ok: false, error: { code: 'REPO_BUSY', message: 'held by another session' } }));
          return;
        }
        res.statusCode = 202;
        res.end(JSON.stringify({
          ok: true,
          data: { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', claim: { planId: 'runner', taskId: '7' } },
        }));
      });
      return;
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => fakeRunner.listen(runnerPort, '127.0.0.1', r));

  const port = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: {
      ...process.env,
      CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
      CW_SUBSTRATE_DISPATCH: `http://127.0.0.1:${runnerPort}/api/v1/agents/dispatch`,
      CW_SUBSTRATE_TOKEN_FILE: TOKEN_FILE,
      // The watch host is declared, never hardcoded — a fixture value, so the assertion proves the
      // wiring rather than a particular deployment. `.invalid` is reserved by RFC 2606, so it can
      // never resolve to a real host even if a test leaks out of its fixture.
      CW_OVERWATCH_WATCH_HOST: 'watch.example.invalid',
      // No CW_HANDOFF_CMD — this suite exercises the unset seam; fallback binaries neutered so
      // nothing opens on the operator's desktop.
      CW_OPEN: '/usr/bin/true', CW_OSASCRIPT: '/usr/bin/true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { const r = await hit('/api/csrf'); if (r.status === 200) { csrf = r.json.token; up = true; } } catch { /* not yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, 'panel did not come up');
});

after(async () => {
  if (child) child.kill('SIGKILL');
  if (fakeRunner) await new Promise((r) => fakeRunner.close(r));
  rmSync(TMP, { recursive: true, force: true });
});

describe('a reachable runner takes the handoff', () => {
  test('via:overwatch with a session id and a watch url', async () => {
    runnerMode = 'ok';
    seen.dispatches.length = 0;
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'claude' });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.started, true);
    assert.equal(r.json.via, 'overwatch', 'a reachable runner must win over the Terminal path');
    assert.equal(r.json.sessionId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.deepEqual(r.json.claim, { planId: 'runner', taskId: '7' });
    // The watch host is declared through CW_OVERWATCH_WATCH_HOST, not hardcoded — the literal was an
    // operator deployment detail sitting in a repository that ships publicly. Asserted on the
    // FIXTURE host this suite sets, so the test proves the wiring rather than a particular
    // deployment.
    assert.match(r.json.watch, /watch\.example\.invalid/);
    assert.equal(r.json.overwatchWhy, undefined, 'nothing to explain when the runner took it');
  });

  // NOT TESTED HERE, deliberately: the absent-host branch, where no CW_OVERWATCH_WATCH_HOST means
  // no `watch` field rather than a URL built from a guessed default. The server under test is a
  // SPAWNED CHILD with its own env block, so unsetting the variable in this process after the spawn
  // proves nothing — the child already holds its environment, and such a test would pass without
  // exercising the branch at all. Covering it honestly needs a second server on a second port.
  // Recorded rather than faked: a test that cannot fail is worse than an absent one, because it
  // reports coverage it does not have.

  test('the handoff file is still written — the evidence trail does not depend on the engine', async () => {
    runnerMode = 'ok';
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'claude' });
    assert.ok(existsSync(r.json.file));
    const text = readFileSync(r.json.file, 'utf8');
    assert.ok(text.includes(MANIFEST_PROMPT));
  });

  test('what commitwork composed is what crossed the wire', async () => {
    runnerMode = 'ok';
    seen.dispatches.length = 0;
    await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'claude' });
    assert.equal(seen.dispatches.length, 1, 'exactly one dispatch per handoff');
    const { body, headers } = seen.dispatches[0];
    assert.ok(body.prompt.includes(MANIFEST_PROMPT), 'the manifest prompt travels whole');
    assert.ok(body.prompt.includes(join('alpha', 'gitleaks.json')), 'the artifact is named by path');
    assert.ok(body.prompt.includes('"total":1'), 'the live counts travel too');
    assert.equal(body.cwd, join(TMP, 'alpha'), 'the session opens in the target repo, not commitwork');
    assert.equal(body.mode, 'plan', 'a triage handoff reads and proposes; editing is an operator promotion');
    assert.equal(headers['x-substrate-dispatch'], '1', 'the anti-drive-by header must be sent');
    assert.equal(headers.authorization, `Bearer ${RUNNER_TOKEN}`, 'the runner token from the token file must be sent');
  });
});

describe('degradation is declared, never silent', () => {
  test('an unreadable runner token falls back to Terminal, says why, and sends nothing tokenless', async () => {
    runnerMode = 'ok';
    seen.dispatches.length = 0;
    renameSync(TOKEN_FILE, `${TOKEN_FILE}.away`);   // read at call time, so the running panel sees this
    try {
      const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'claude' });
      assert.equal(r.status, 200, r.body);
      assert.equal(r.json.via, 'terminal+vscode');
      assert.match(r.json.overwatchWhy, /runner token unreadable at .*runner-token/);
      assert.equal(seen.dispatches.length, 0, 'no dispatch may go out without the token');
    } finally {
      renameSync(`${TOKEN_FILE}.away`, TOKEN_FILE);
    }
  });

  test('a refusing runner falls back to Terminal and says why', async () => {
    runnerMode = 'refuse';
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'claude' });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.started, true);
    assert.equal(r.json.via, 'terminal+vscode');
    assert.match(r.json.overwatchWhy, /runner refused: HTTP 429/);
  });

  test('an unreachable runner falls back to Terminal and says why', async () => {
    runnerMode = 'ok';
    await new Promise((r) => fakeRunner.close(r));
    fakeRunner = null;
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'claude' });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.via, 'terminal+vscode');
    assert.match(r.json.overwatchWhy, /unreachable|did not answer/);
    assert.ok(existsSync(r.json.file), 'the handoff file survives the degradation');
  });
});
