// Every response carries the baseline security headers, not only the panel's HTML. The off-box
// defence suite failed on commitwork.online from 2026-09-19 because the unauthenticated JSON
// answer at / had no CSP, no framing control, no HSTS and no Referrer-Policy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request, createServer } from 'node:http';

const SERVE = join(dirname(fileURLToPath(import.meta.url)), '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-sechdr-'));
let child, pubPort, localPort, upstream;
const seen = [];

const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const hit = (port, path, accept = 'application/json') => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { accept } }, (res) => {
    res.resume(); res.on('end', () => resolve({ status: res.statusCode, h: res.headers }));
  });
  req.on('error', reject); req.end();
});

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fix', defaultManifest: 'security-baseline',
    roots: [], projects: [], areas: [{ slug: 'fix', name: 'Fixture', out: 'fix', members: [] }],
  }));
  pubPort = await freePort(); localPort = await freePort();
  upstream = createServer((req, res) => { seen.push({ url: req.url, host: req.headers.host }); res.end('ok'); });
  await new Promise((res) => upstream.listen(0, '127.0.0.1', res));
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, CW_ADMIN_PORT: String(pubPort), CW_ADMIN_LOCAL_PORT: String(localPort),
      CW_PROJECTS: join(TMP, 'projects.json'), CW_ADMIN_STATE: TMP, CW_AUTH_STORE: join(TMP, 'users.json'),
      CW_SVC_GATEWAY: `http://127.0.0.1:${upstream.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('panel did not boot')), 15000);
    const scan = (d) => { if (String(d).includes(String(localPort))) { clearTimeout(t); res(); } };
    child.stdout.on('data', scan); child.stderr.on('data', scan);
  });
});
after(() => { try { child.kill(); } catch { /* gone */ } upstream?.close(); rmSync(TMP, { recursive: true, force: true }); });

const baseline = (r, where) => {
  assert.match(r.h['content-security-policy'] || '', /frame-ancestors 'self'/, `${where}: no enforced CSP with frame-ancestors`);
  assert.equal(r.h['referrer-policy'], 'no-referrer', `${where}: no Referrer-Policy`);
  assert.match(r.h['strict-transport-security'] || '', /max-age=\d{7,}/, `${where}: no HSTS`);
};

test('the refusal the defence probe reads at / on the public port carries the baseline', async () => {
  const r = await hit(pubPort, '/');
  assert.ok(r.status >= 400, `expected a refusal from an unbootstrapped public port, got ${r.status}`);
  baseline(r, `public / (${r.status})`);
});

test('JSON, static, HTML and not-found responses all carry it', async () => {
  for (const [path, accept] of [['/api/state', 'application/json'], ['/static/panel.css', 'text/css'], ['/overview/', 'text/html'], ['/definitely-not-a-view/', 'text/html']]) {
    baseline(await hit(localPort, path, accept), path);
  }
});

test('the HTML-only report-only CSP stays HTML-only', async () => {
  assert.ok((await hit(localPort, '/overview/', 'text/html')).h['content-security-policy-report-only']);
  assert.equal((await hit(localPort, '/api/state')).h['content-security-policy-report-only'], undefined);
});

test('the /svc bridge is not given a framing rule: it strips frame guards so its iframe works', async () => {
  const r = await hit(localPort, '/svc/no-such-service/');
  assert.equal(r.h['content-security-policy'], undefined, `the bridge answered ${r.status} with a CSP`);
  assert.equal(r.h['referrer-policy'], 'no-referrer');
});

test('the /svc bridge forwards only the path, to the configured origin', async () => {
  const origin = `127.0.0.1:${upstream.address().port}`;
  seen.length = 0;
  assert.equal((await hit(localPort, '/svc/gateway/a/b?x=1')).status, 200);
  assert.equal((await hit(localPort, '/svc/gateway//evil.example.com/x')).status, 200);
  assert.deepEqual(seen, [{ url: '/a/b?x=1', host: origin }, { url: '/evil.example.com/x', host: origin }]);
});
