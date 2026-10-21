// node --test monitor/test/  — authAt is an attestation: a refusal only attests protection if it
// is about IDENTITY. Verdicts: protected / unprotected / unusable / unverifiable. Truth table plus
// end-to-end against a spawned panel (temp CW_AUTH_STORE, .invalid hostnames).

import { describe, test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTEST, ATTEST_DRIFT, classifyAttestation, attestRows, explainAttestation } from '../../lib/deploy-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '../..');
const DEPLOY = join(CW, 'bin', 'deploy.mjs');
const SERVE = join(CW, 'admin', 'serve.mjs');

// ── 1. the rule, as a truth table ───────────────────────────────────────────────────────────────

describe('classifyAttestation — a refusal is only evidence if it is about identity', () => {
  // captured verbatim from the live panel — a paraphrase is what a matcher would be written against
  const LIVE_401 = '{"ok":false,"error":"no users exist — open the panel on the box itself (http://127.0.0.1:7878) to create the root user"}';
  // the same condition spelled as a 503 — both must land on the same verdict
  const LIVE_503 = '{"ok":false,"error":"panel is unbootstrapped: no operator account exists. Create one from the box itself (http://127.0.0.1:7878), or run `node bin/panel-breakglass.mjs status`."}';

  test('THE REGRESSION: the live empty-store 401 is UNUSABLE, and the rule it replaced said pass', () => {
    const v = classifyAttestation({ status: 401, body: LIVE_401 });
    assert.equal(v.verdict, ATTEST.UNUSABLE);
    assert.match(v.why, /nobody can authenticate/);
    // the superseded rule, inline — the new rule must differ from it on this exact input
    const supersededRule = (s) => s === 401 || s === 403 || (s >= 300 && s < 400);
    assert.equal(supersededRule(401), true, 'the superseded rule passed this response — that is the defect');
    assert.notEqual(v.verdict, ATTEST.PROTECTED, 'and the new rule must not');
  });

  test('the 503 unbootstrapped body is the SAME verdict — the condition, not the status, decides', () => {
    assert.equal(classifyAttestation({ status: 503, body: LIVE_503 }).verdict, ATTEST.UNUSABLE);
  });

  test('the unbootstrapped HTML page is UNUSABLE too — a browser GET is the same question', () => {
    // a JSON-only matcher would go green on the HTML page a human actually sees
    assert.equal(classifyAttestation({ status: 503, body: '<h1>No account yet</h1><p>the first one can only be created from the machine itself</p>' }).verdict, ATTEST.UNUSABLE);
  });

  test('a real identity refusal is PROTECTED — the fix must not simply fail everything', () => {
    // if every refusal became unusable the verdict would carry no information
    for (const [status, body] of [
      [401, '{"ok":false,"error":"authentication required"}'],
      [403, '{"ok":false,"error":"forbidden"}'],
      [302, ''],
      [303, 'Found. Redirecting to /login'],
      [401, '{}'],
    ]) {
      const v = classifyAttestation({ status, body });
      assert.equal(v.verdict, ATTEST.PROTECTED, `HTTP ${status} ${JSON.stringify(body)} must attest`);
    }
  });

  test('2xx is UNPROTECTED — the claim is simply false', () => {
    assert.equal(classifyAttestation({ status: 200, body: '{"generated":"..."}' }).verdict, ATTEST.UNPROTECTED);
    assert.equal(classifyAttestation({ status: 204, body: '' }).verdict, ATTEST.UNPROTECTED);
  });

  test('no answer is UNVERIFIABLE, never a pass — a claim nobody could check is not a claim', () => {
    for (const obs of [{ error: 'timeout' }, { error: 'unreachable' }, { status: null }, {}]) {
      assert.equal(classifyAttestation(obs).verdict, ATTEST.UNVERIFIABLE, JSON.stringify(obs));
    }
  });

  test('a 5xx fault is UNVERIFIABLE, not UNPROTECTED — it says nothing either way', () => {
    // "claim is false" and "origin broken, could not tell" demand different operator actions
    assert.equal(classifyAttestation({ status: 500, body: 'boom' }).verdict, ATTEST.UNVERIFIABLE);
    assert.equal(classifyAttestation({ status: 503, body: 'service unavailable' }).verdict, ATTEST.UNVERIFIABLE);
  });

  test('an odd 4xx is UNPROTECTED — it is neither an identity refusal nor a fault', () => {
    assert.equal(classifyAttestation({ status: 404, body: 'not found' }).verdict, ATTEST.UNPROTECTED);
    assert.equal(classifyAttestation({ status: 405, body: '' }).verdict, ATTEST.UNPROTECTED);
  });

  test('exactly one verdict is silence, and the other three gate', () => {
    assert.equal(ATTEST_DRIFT.has(ATTEST.PROTECTED), false);
    for (const v of [ATTEST.UNPROTECTED, ATTEST.UNUSABLE, ATTEST.UNVERIFIABLE]) {
      assert.equal(ATTEST_DRIFT.has(v), true, `${v} must not pass a gate`);
    }
  });
});

describe("attestRows — 'edge' is unverifiable BY DESIGN, and that is not drift", () => {
  const row = (over) => ({ hostname: 'h.example.invalid', service: 'http://127.0.0.1:1', origin: true, ...over });

  test("authAt:'edge' is never probed from the origin box — a pass would prove nothing", async () => {
    let probed = false;
    const [r] = await attestRows([row({ authAt: 'edge' })], { probe: async () => { probed = true; return { status: 401, body: '' }; } });
    assert.equal(probed, false, 'an edge claim must not be probed on the loopback hop it bypasses');
    assert.equal(r.attest.verdict, ATTEST.UNVERIFIABLE);
    assert.equal(r.attest.byDesign, true, 'byDesign is what keeps this out of the drift list');
    assert.match(r.attest.why, /bypasses it by construction/);
  });

  test('a row with no authAt claim is not probed and gets no verdict', async () => {
    const [r] = await attestRows([row({})], { probe: async () => { throw new Error('must not probe'); } });
    assert.equal(r.attest, undefined, 'no claim, no verdict — and no invented one');
  });

  test('a claim on a DOWN origin is unverifiable and does NOT read as byDesign', async () => {
    const [r] = await attestRows([row({ authAt: 'origin', origin: false })], { probe: async () => { throw new Error('must not probe'); } });
    assert.equal(r.attest.verdict, ATTEST.UNVERIFIABLE);
    assert.equal(r.attest.byDesign, false, 'a failure to reach the origin must gate; only edge is exempt');
    assert.equal(r.authAttested, false);
  });

  test('the verdict overwrites authAttested, so the returned state carries ONE answer', async () => {
    // leaving both meant a caller could read authAttested:true off an unusable row
    const [r] = await attestRows([row({ authAt: 'origin', authAttested: true, authProbe: 401 })],
      { probe: async () => ({ status: 401, body: 'no users exist' }) });
    assert.equal(r.attest.verdict, ATTEST.UNUSABLE);
    assert.equal(r.authAttested, false);
  });

  test('explainAttestation names the fix, not just the fault', async () => {
    const [r] = await attestRows([row({ authAt: 'origin' })], { probe: async () => ({ status: 401, body: 'no operator account exists' }) });
    const s = explainAttestation(r);
    assert.match(s, /must never be satisfied by the failure state it exists to detect/);
    assert.match(s, /bootstrap an operator/, 'the operator must be told what to do next');
  });
});

// ── 2. end to end, against a really-spawned panel, in BOTH postures ──────────────────────────────

describe('deploy --verify against a LIVE panel: zero operators, then one', () => {
  const HOST = 'panel.example.invalid';
  // codeql[js/incomplete-sanitization]: HOST is a fixed literal above, never attacker-controlled,
  // but escaping only `.` (leaving `\` and the rest of the regex metacharacter set untouched) is
  // the wrong idiom to leave lying around as a copy-paste source — escape the full set instead.
  const HOST_RE = HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let TMP, port, localPort, child, regPath, cfgPath;

  const freePort = () => new Promise((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });

  // raw node:http so the Host header is independent of the connection target
  const hit = (path, { method = 'GET', headers = {}, body = null, operator = false } = {}) => new Promise((res, rej) => {
    const h = { host: 'localhost', ...headers };
    if (body != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
    const req = request({ host: '127.0.0.1', port: operator ? localPort : port, path, method, headers: h }, (r) => {
      let buf = '';
      r.setEncoding('utf8');
      r.on('data', (d) => { buf += d; });
      r.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } res({ status: r.statusCode, body: buf, json }); });
    });
    req.on('error', rej);
    if (body != null) req.write(body);
    req.end();
  });

  const runVerify = () => {
    const r = spawnSync(process.execPath, [DEPLOY, '--registry', regPath, '--verify', '--config', cfgPath],
      { cwd: CW, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: r.status ?? -1, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
  };

  before(async () => {
    TMP = mkdtempSync(join(tmpdir(), 'cw-attest-'));
    port = await freePort();
    localPort = await freePort();
    child = spawn(process.execPath, [SERVE], {
      env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (d) => { if (/Error|throw/i.test(String(d))) process.stderr.write(`[panel] ${d}`); });
    regPath = join(TMP, 'reg.json');
    writeFileSync(regPath, JSON.stringify({
      reportsRoot: 'reports',
      areas: [{
        slug: 'panel',
        deploy: { hostnames: [HOST], service: `http://127.0.0.1:${port}`, public: true, requiresAuth: true, authAt: 'origin' },
      }],
    }, null, 2));
    cfgPath = join(TMP, 'config.yml');
    writeFileSync(cfgPath, `ingress:\n  - hostname: ${HOST}\n    service: http://127.0.0.1:${port}\n  - service: http_status:404\n`);
    for (let i = 0; i < 100; i++) {
      try { if ((await hit('/api/csrf')).status === 200) break; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  after(() => { child?.kill('SIGKILL'); if (TMP) rmSync(TMP, { recursive: true, force: true }); });

  test('the store really is empty, so the zero-operator case below is the real posture', () => {
    // asserted, not assumed — an operator in the store would make every unusable assertion vacuous
    const p = join(TMP, 'users.json');
    const users = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).users : [];
    assert.deepEqual(users, [], 'the fixture must start with zero operators');
  });

  test('ZERO OPERATORS: --verify reports UNUSABLE and exits 1 — it does NOT report ok', async () => {
    const probe = await hit('/api/state', { headers: { host: HOST } });
    assert.ok([401, 503].includes(probe.status), `the panel must refuse a remote request; got ${probe.status}`);
    const r = runVerify();
    assert.equal(r.code, 1, `an unusable attestation must gate\nstdout:\n${r.stdout}`);
    assert.match(r.stdout, /UNUSABLE/, 'the verdict must be named');
    assert.match(r.stdout, /no operator account exists/, 'and the evidence must be the origin\'s own words');
    assert.doesNotMatch(r.stdout, /→ PROTECTED/, 'a zero-operator panel must never read as protected');
    // the row itself, not just the footnote: the table is what gets skimmed
    assert.match(r.stdout, new RegExp(`${HOST_RE}.*unusable`));
    assert.match(r.stdout, /must never be satisfied by the failure state it exists to detect/);
  });

  test('and it is reported as an ATTESTATION line even before the drift section', () => {
    const r = runVerify();
    const at = r.stdout.indexOf('ATTESTATIONS');
    const drift = r.stdout.indexOf('DRIFT:');
    assert.ok(at > 0 && drift > at, 'every claim is reported, passing or not, above the drift list');
  });

  test('ONE OPERATOR: the same panel, the same registry, now PROTECTED', async () => {
    // only the store changes, so the verdict flip is attributable to it alone
    const csrf = (await hit('/api/csrf', { operator: true })).json.token;
    const boot = await hit('/auth/bootstrap', {
      method: 'POST', operator: true, headers: { host: 'localhost', 'x-cw-csrf': csrf },
      body: JSON.stringify({ email: 'op@example.invalid', password: 'correct horse battery staple' }),
    });
    assert.equal(boot.status, 200, `bootstrap failed: ${boot.body}`);

    const probe = await hit('/api/state', { headers: { host: HOST } });
    assert.equal(probe.status, 401, 'with an operator present the remote refusal is a 401 about identity');
    assert.doesNotMatch(probe.body, /no users exist|unbootstrapped/, 'and its body no longer announces the empty store');

    const r = runVerify();
    assert.match(r.stdout, /→ PROTECTED/, `the attestation must now hold:\n${r.stdout}`);
    assert.doesNotMatch(r.stdout, /UNUSABLE/);
    assert.match(r.stdout, new RegExp(`${HOST_RE}.*protected`));
    // still exit 1, for the OTHER reason: .invalid never resolves (ROUTED-NO-DNS)
    assert.equal(r.code, 1);
    assert.match(r.stdout, /has no DNS record/);
    assert.doesNotMatch(r.stdout, /asserting protection|failure state it exists to detect/);
  });

  test('--verify wrote nothing to the fixture dir in either posture', () => {
    // It probes an origin and reads a config; a diagnostic that mutates is not a diagnostic.
    assert.equal(existsSync(join(TMP, 'fragment.yml')), false);
    const store = JSON.parse(readFileSync(join(TMP, 'users.json'), 'utf8'));
    assert.equal(store.users.length, 1, 'the probe must not have created or removed an operator');
  });
});
