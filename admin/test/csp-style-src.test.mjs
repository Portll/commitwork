import { readPanelDocument, inlineStyleSources } from '../lib/panel-document.mjs';
import { createHash } from 'node:crypto';
// The panel's Content-Security-Policy, at the wire: style-src stays SPLIT (style-src-elem 'self',
// style-src-attr 'unsafe-inline'), the enforced header keeps its three directives, and
// Inline menu styles are authorized with hashes of the served bytes.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-csp-'));

let child = null, pubPort = 0, localPort = 0;

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

// headers are the point here, so this returns them — the sibling harness only keeps the body.
const hit = (port, path, headers = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
  });
  req.on('error', reject);
  req.end();
});

const HTML = { accept: 'text/html,application/xhtml+xml' };

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    defaultManifest: 'security-baseline', roots: [], projects: [],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
  }));
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });

  pubPort = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(pubPort), CW_ADMIN_LOCAL_PORT: String(localPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await hit(localPort, '/api/csrf')).status === 200; } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, 'panel did not come up against the fixture registry');
});
after(() => { child?.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

test('an HTML response carries the split style-src — elements locked, attributes declared open', async () => {
  const r = await hit(pubPort, '/', HTML);
  assert.match(String(r.headers['content-type'] || ''), /text\/html/, 'the unauthenticated landing is HTML');
  const csp = r.headers['content-security-policy-report-only'];
  assert.ok(csp, 'an HTML response must carry the report-only policy');
  assert.match(csp, /style-src-elem 'self'/, 'stylesheet ELEMENTS are locked to same-origin');
  assert.match(csp, /style-src-attr 'unsafe-inline'/, 'inline style ATTRIBUTES are still permitted, and say so');
  // Matched with a boundary so style-src-elem/-attr do not count.
  assert.doesNotMatch(csp, /style-src /, 'the combined style-src directive must not come back');
});

test('the rest of the report-only policy is unchanged — this was a split, not a loosening', async () => {
  const csp = (await hit(pubPort, '/', HTML)).headers['content-security-policy-report-only'];
  for (const d of ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "img-src 'self' data:",
    "connect-src 'self'", "object-src 'none'"]) {
    assert.ok(csp.includes(d), `report-only lost ${d}`);
  }
});

test('the ENFORCED header still shuts the clickjack and form-hijack doors', async () => {
  const enforced = (await hit(pubPort, '/', HTML)).headers['content-security-policy'];
  assert.ok(enforced, 'the enforced header must survive alongside the report-only one');
  for (const d of ["frame-ancestors 'self'", "form-action 'self'", "base-uri 'none'"]) {
    assert.ok(enforced.includes(d), `enforced policy lost ${d}`);
  }
  assert.ok(!/style-src/.test(enforced),
    'style-src stays REPORT-ONLY: enforcing it is an operator decision, and a wrong one blanks the panel');
});

test('a non-HTML response is not given the HTML policy — the content-type gate holds', async () => {
  const r = await hit(pubPort, '/api/posture', { accept: 'application/json' });
  assert.ok(!/text\/html/.test(String(r.headers['content-type'] || '')), 'fixture sanity: this is the JSON path');
  assert.equal(r.headers['content-security-policy-report-only'], undefined,
    'the policy is scoped to HTML documents; sending it on JSON is noise that trains the report to be ignored');
});

test('inline menu styles are precisely hashed and the served policy authorizes them', async () => {
  const html = readPanelDocument();
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
  assert.equal(styles.length, 1);
  const expected = "'sha256-" + createHash('sha256').update(styles[0][1]).digest('base64') + "'";
  assert.equal(inlineStyleSources(html), expected);
  const r = await hit(localPort, '/');
  assert.ok(r.headers['content-security-policy-report-only'].includes(expected));
  assert.ok(!r.headers['content-security-policy-report-only'].match(/style-src-elem[^;]*unsafe-inline/));
});
