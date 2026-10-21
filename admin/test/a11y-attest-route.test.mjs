// admin/routes/a11y.mjs — the WCAG attestation routes over a really-spawned panel: no session, no
// attestation (operator port included); a moved digest is refused 409, never re-bound; attested is
// not passed. CW_AUTH_STORE / CW_REGISTRY / CW_A11Y_ATTESTATIONS point at temp files.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-a11y-route-'));
const ATTEST = join(TMP, 'a11y-attestations.json');

const { buildReport } = await import('../../bin/a11y-scan.mjs');

const PAGE = '<html lang="en"><head><title>panel</title></head><body><h1>h</h1></body></html>';
const SHEET = ':root{--bg:#0f1319;--ink:#cdd3de}\n.a{color:var(--ink)}';
const REPORT = buildReport({
  files: [{ path: 'admin/index.html', html: PAGE }],
  cssFiles: [{ path: 'admin/static/panel.css', css: SHEET }],
  nowIso: '2026-08-01T00:00:00.000Z',
});

let port, localPort, child, csrf, cookie = '';

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

function hit(path, { method = 'GET', headers = {}, body = null, operator = true, auth = false } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host: 'localhost', ...headers };
    if (auth && cookie) h.cookie = cookie;
    if (body != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
    const req = request({ host: '127.0.0.1', port: operator ? localPort : port, path, method, headers: h }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, headers: res.headers, body: buf, json }); });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}
const post = (path, payload, opts = {}) =>
  hit(path, { ...opts, method: 'POST', body: JSON.stringify(payload), headers: { 'x-cw-csrf': csrf, ...(opts.headers || {}) } });

/** Whatever is on disk right now — the ledger, read the way an auditor would. */
const ledger = () => (existsSync(ATTEST) ? JSON.parse(readFileSync(ATTEST, 'utf8')) : null);

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] }],
  }));
  mkdirSync(join(TMP, 'src'), { recursive: true });
  // the sweep batch the route reads its artifact from
  const batch = join(TMP, 'reports', 'sweep-20260803120000-fixarea', 'fixrepo');
  mkdirSync(batch, { recursive: true });
  writeFileSync(join(batch, 'a11y.json'), JSON.stringify(REPORT, null, 2));

  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    port = await freePort();
    localPort = await freePort();
    let err = '';
    child = spawn(process.execPath, [SERVE], {
      env: {
        ...process.env,
        CW_AUTH_STORE: join(TMP, 'users.json'),
        CW_REGISTRY: join(TMP, 'projects.json'),
        CW_A11Y_ATTESTATIONS: ATTEST,
        CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (d) => { err += String(d); });
    for (let i = 0; i < 100 && !csrf; i++) {
      try { const r = await hit('/api/csrf'); if (r.status === 200) { csrf = r.json.token; break; } } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (csrf) break;
    child.kill('SIGKILL');
    lastErr = err;
  }
  assert.ok(csrf, `panel did not come up${lastErr ? ` — last child stderr:\n${lastErr}` : ''}`);
});

after(() => { child?.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

describe('route — no session, no attestation', () => {
  test('an unauthenticated attestation is refused 401 ON THE OPERATOR PORT, and nothing is written', async () => {
    const r = await post('/api/a11y/attest?project=fixarea', { criterion: '2.4.3', verdict: 'meets' });
    assert.equal(r.status, 401);
    assert.match(r.json.error, /identity/);
    assert.equal(ledger(), null, 'a refused attestation must not create a ledger entry, or a ledger');
  });

  test('the withdrawal route is gated identically — an anonymous caller cannot un-say a signature', async () => {
    const r = await post('/api/a11y/attest/clear?project=fixarea', { criterion: '2.4.3' });
    assert.equal(r.status, 401);
  });

  test('a state-changing call with no CSRF token is refused before the route is even reached', async () => {
    const r = await hit('/api/a11y/attest?project=fixarea', { method: 'POST', body: JSON.stringify({ criterion: '2.4.3', verdict: 'meets' }) });
    assert.equal(r.status, 403);
  });
});

describe('route — the board before anyone has attested', () => {
  test('the six undecided criteria are offered, and the audit says so honestly', async () => {
    const r = await hit('/api/a11y?project=fixarea');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.match(r.json.subjectDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(r.json.attestation.canAttest, true);
    assert.equal(r.json.attestation.area, 'fixarea');
    assert.deepEqual(r.json.attestation.attestable, ['1.3.2', '1.4.11', '2.4.11', '2.4.3', '2.5.8', '3.3.7']);
    const row = r.json.criteria.find((c) => c.id === '2.4.3');
    assert.equal(row.state, 'unchecked');
    assert.equal(row.effectiveState, 'unchecked');
    assert.equal(row.attestation, null);
    assert.equal(row.attestable, true);
    // the audit's own claim is still `unverified` — an offered checkbox is not a tick
    assert.equal(r.json.conformance.AA, 'unverified');
  });

  test('a criterion the scanner decided is not offered', async () => {
    const r = await hit('/api/a11y?project=fixarea');
    const row = r.json.criteria.find((c) => c.id === '1.1.1');
    assert.equal(row.attestable, false);
  });
});

describe('route — signing in and attesting', () => {
  before(async () => {
    const boot = await post('/auth/bootstrap', { email: 'op@example.com', password: 'correct horse battery' }, { operator: true });
    assert.equal(boot.status, 200, `bootstrap failed: ${boot.body}`);
    const login = await post('/auth/login', { email: 'op@example.com', password: 'correct horse battery' }, { operator: true });
    assert.equal(login.status, 200, `login failed: ${login.body}`);
    cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    assert.match(cookie, /cw_admin_sid=/);
  });

  test('a signed attestation is filed, stamped with the SESSION\'s identity', async () => {
    const digest = (await hit('/api/a11y?project=fixarea', { auth: true })).json.subjectDigest;
    const r = await post('/api/a11y/attest?project=fixarea',
      { criterion: '2.4.3', verdict: 'meets', subjectDigest: digest, note: 'tabbed the whole page, order matches the visual reading' },
      { auth: true });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.entry.who, 'op@example.com (password)', 'the caller never supplies its own who');
    assert.equal(r.json.entry.whoKind, 'human');
    assert.equal(r.json.entry.subjectDigest, digest);
    assert.ok(r.json.entry.expires, 'nothing stands forever silently');
    assert.match(r.json.note, /not a scanner pass/);

    const doc = ledger();
    assert.equal(doc.entries.length, 1);
    assert.equal(doc.entries[0].criterion, '2.4.3');
    assert.equal(doc.entries[0].area, 'fixarea');
  });

  test('the board now shows attested-pass — a different word, and the scanner\'s own numbers are untouched', async () => {
    const r = await hit('/api/a11y?project=fixarea', { auth: true });
    const row = r.json.criteria.find((c) => c.id === '2.4.3');
    assert.equal(row.state, 'unchecked', 'the artifact still says the scanner could not decide it');
    assert.equal(row.effectiveState, 'attested-pass');
    assert.equal(row.attestation.whoKind, 'human');
    assert.equal(row.attestation.status, 'active');
    assert.equal(row.attestation.counts, true);
    assert.match(row.attestation.note, /tabbed the whole page/);
    // the two tallies, side by side and never merged
    assert.deepEqual(r.json.levels, REPORT.levels);
    assert.deepEqual(r.json.conformance, REPORT.conformance);
    assert.equal(r.json.attestedLevels.A.pass, REPORT.levels.A.pass);
    assert.equal(r.json.attestedLevels.A.attestedPass, 1);
    assert.equal(r.json.attestedLevels.A.unchecked, REPORT.levels.A.unchecked - 1);
  });

  test('an attestation pinned to a digest that has moved is refused 409, never re-bound', async () => {
    const r = await post('/api/a11y/attest?project=fixarea',
      { criterion: '2.5.8', verdict: 'meets', subjectDigest: `sha256:${'0'.repeat(64)}` }, { auth: true });
    assert.equal(r.status, 409);
    assert.equal(r.json.refused, 'stale-subject');
    assert.equal(ledger().entries.length, 1, 'nothing was filed');
  });

  test('a criterion the scanner decides cannot be attested through the route either', async () => {
    const r = await post('/api/a11y/attest?project=fixarea', { criterion: '1.1.1', verdict: 'meets' }, { auth: true });
    assert.equal(r.status, 400);
    assert.equal(r.json.refused, 'not-attestable');
  });

  test('an unresolvable project is refused rather than filed against the fleet', async () => {
    const r = await post('/api/a11y/attest?project=no-such-area', { criterion: '2.5.8', verdict: 'meets' }, { auth: true });
    assert.equal(r.status, 400);
    assert.equal(r.json.refused, 'bad-area');
  });

  test('a malformed payload is refused and the ledger does not move', async () => {
    const before = ledger().entries.length;
    const r = await post('/api/a11y/attest?project=fixarea', { criterion: '2.5.8', verdict: 'looks-ok-to-me' }, { auth: true });
    assert.equal(r.status, 400);
    assert.equal(r.json.refused, 'schema');
    assert.equal(ledger().entries.length, before);
  });

  test('withdrawing APPENDS and returns the criterion to unchecked — which is not a pass', async () => {
    const r = await post('/api/a11y/attest/clear?project=fixarea', { criterion: '2.4.3' }, { auth: true });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.entry.action, 'withdraw');
    const doc = ledger();
    assert.equal(doc.entries.length, 2, 'the original attestation is still on the record');
    assert.equal(doc.entries[0].action, 'attest');

    const board = await hit('/api/a11y?project=fixarea', { auth: true });
    const row = board.json.criteria.find((c) => c.id === '2.4.3');
    assert.equal(row.effectiveState, 'unchecked');
    assert.equal(row.attestation.status, 'withdrawn');
    assert.equal(board.json.attestedLevels.A.attestedPass, 0);
  });

  test('withdrawing something that is not standing is refused rather than filed as a no-op', async () => {
    const before = ledger().entries.length;
    const r = await post('/api/a11y/attest/clear?project=fixarea', { criterion: '2.4.3' }, { auth: true });
    assert.equal(r.status, 404);
    assert.equal(r.json.refused, 'nothing-to-withdraw');
    assert.equal(ledger().entries.length, before);
  });
});

describe('route — a content change invalidates a standing attestation, end to end', () => {
  test('re-running the audit over changed pages leaves the signature but withdraws its force', async () => {
    const digest = (await hit('/api/a11y?project=fixarea', { auth: true })).json.subjectDigest;
    const filed = await post('/api/a11y/attest?project=fixarea',
      { criterion: '2.5.8', verdict: 'meets', subjectDigest: digest }, { auth: true });
    assert.equal(filed.status, 200, filed.body);
    assert.equal((await hit('/api/a11y?project=fixarea', { auth: true })).json.criteria.find((c) => c.id === '2.5.8').effectiveState,
      'attested-pass');

    // the panel is rewritten and the sweep runs again — a NEWER batch, with a different digest
    const next = join(TMP, 'reports', 'sweep-20260804120000-fixarea', 'fixrepo');
    mkdirSync(next, { recursive: true });
    writeFileSync(join(next, 'a11y.json'), JSON.stringify(buildReport({
      files: [{ path: 'admin/index.html', html: PAGE.replace('<h1>h</h1>', '<nav>menu</nav><h1>h</h1>') }],
      cssFiles: [{ path: 'admin/static/panel.css', css: SHEET }],
      nowIso: '2026-08-04T00:00:00.000Z',
    }), null, 2));

    const board = await hit('/api/a11y?project=fixarea', { auth: true });
    const row = board.json.criteria.find((c) => c.id === '2.5.8');
    assert.equal(row.attestation.status, 'stale-subject', 'the ruling was about a page that no longer exists');
    assert.equal(row.effectiveState, 'unchecked', 'and a stale ruling clears nothing');
    assert.equal(row.attestation.counts, false);
    // the signature itself is still readable — nothing is ever deleted
    assert.equal(row.attestation.whoKind, 'human');
    assert.ok(ledger().entries.some((e) => e.criterion === '2.5.8' && e.action === 'attest'));
  });
});
