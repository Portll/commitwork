// bin/test/digest-deliver.test.mjs — delivery of a written digest to Slack and a generic webhook.
// Never touches the network: destinations are a node:http server on 127.0.0.1 or an injected fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDigest, writeDigest } from '../digest.mjs';
import {
  deliverDigest, slackPayload, readDigest, redactUrl, urlProblem, exitFor, renderText, ledgerPath, Refused, timeoutFrom,
} from '../digest-deliver.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'digest-deliver.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'cw-digest-deliver-'));
const savedReports = process.env.CW_REPORTS_ROOT;
test.after(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (savedReports === undefined) delete process.env.CW_REPORTS_ROOT; else process.env.CW_REPORTS_ROOT = savedReports;
});
let seq = 0;
const NOW = '2026-03-02T12:00:00.000Z';
const SECRET = 'T000FIXTURE/B000FIXTURE/fixturetokenfixturetoken';

const rehash = (doc) => {
  doc.digestId = '';
  doc.digestId = createHash('sha256').update(JSON.stringify(doc)).digest('hex');
  return doc;
};

// One measured section beside two that measured nothing: both shapes must reach the channel.
function fixture() {
  const root = join(tmp, `case-${seq++}`);
  mkdirSync(root, { recursive: true });
  const reportsRoot = join(root, 'reports');
  process.env.CW_REPORTS_ROOT = reportsRoot;
  const doc = buildDigest({ root, env: { CW_NOW: NOW }, issuesPath: join(root, 'absent-issues.json'), verdictDir: join(root, 'absent-verdicts'), reportsRoot: join(root, 'absent-reports') });
  const s = doc.sections.ratchetBreaches;
  Object.assign(s, { status: 'measured', notMeasured: [], headline: 'Ratchet breaches: 0 floor(s) breached <!channel>' });
  rehash(doc);
  const { json } = writeDigest(doc, { reportsRoot });
  return { root, reportsRoot, json, doc, env: { CW_NOW: NOW } };
}

async function server(handler) {
  const hits = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, hits.length);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { hits, base, close: () => new Promise((r) => srv.close(r)) };
}
const reply = (code, body = 'ok', headers = {}) => (req, res) => { res.writeHead(code, headers); res.end(body); };

const walk = (v, f) => { f(v); if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, f); };

test('the Slack message states every section, not-measured ones as such, and carries nothing a reader can press', () => {
  const { doc } = fixture();
  const p = slackPayload(doc);
  const sections = p.blocks.filter((b) => b.type === 'section').map((b) => b.text.text);
  assert.equal(sections.length, Object.keys(doc.sections).length, 'no section omitted');
  assert.match(sections[0], /Severity crossings\* — NOT MEASURED/);
  assert.match(sections[0], /not measured: issue store absent/);
  assert.match(sections[1], /Ratchet breaches\* — measured/);
  assert.match(sections[2], /Failed work\* — NOT MEASURED/);
  assert.match(sections[1], /&lt;!channel&gt;/, 'mention and link syntax is escaped');
  assert.ok(!sections[1].includes('<!channel>'));
  walk(p, (v) => {
    if (v && typeof v === 'object') {
      assert.ok(!['actions', 'button', 'input', 'overflow', 'static_select'].includes(v.type), `interactive element ${v.type}`);
      assert.ok(!('accessory' in v) && !('action_id' in v) && !('url' in v));
    }
  });
  assert.match(p.text, /Severity crossings: not measured/);
  assert.match(JSON.stringify(p), new RegExp(doc.digestId));
});

test('URLs are reduced to scheme and host, and only https (or loopback http) is accepted', () => {
  assert.equal(redactUrl(`https://hooks.example.invalid/services/${SECRET}?x=1`), 'https://hooks.example.invalid/…');
  assert.equal(urlProblem('https://hooks.example.invalid/x'), null);
  assert.equal(urlProblem('http://127.0.0.1:9/x'), null);
  assert.match(urlProblem('http://hooks.example.invalid/x'), /https required/);
  assert.match(urlProblem('https://user:pw@hooks.example.invalid/x'), /credentials/);
  assert.equal(urlProblem('nope'), 'not a URL');
  assert.equal(timeoutFrom({}), 10000);
  assert.equal(timeoutFrom({ CW_DIGEST_TIMEOUT_MS: '5' }), 1000);
  assert.equal(timeoutFrom({ CW_DIGEST_TIMEOUT_MS: '999999' }), 60000);
  assert.throws(() => timeoutFrom({ CW_DIGEST_TIMEOUT_MS: '10s' }), RangeError);
});

test('delivers to both destinations, the webhook gets the digest bytes unchanged, and a re-run posts nothing', async () => {
  const f = fixture();
  const srv = await server(reply(200));
  try {
    const env = { ...f.env, CW_DIGEST_SLACK_URL: `${srv.base}/slack/${SECRET}`, CW_DIGEST_WEBHOOK_URL: `${srv.base}/hook/${SECRET}` };
    const r = await deliverDigest({ root: f.root, env });
    assert.equal(r.outcome, 'delivered');
    assert.equal(exitFor(r), 0);
    assert.deepEqual(r.results.map((x) => [x.kind, x.state, x.status]), [['slack', 'delivered', 200], ['webhook', 'delivered', 200]]);
    assert.equal(srv.hits.length, 2);
    const slack = srv.hits.find((h) => h.url.startsWith('/slack/'));
    const hook = srv.hits.find((h) => h.url.startsWith('/hook/'));
    assert.ok(Array.isArray(JSON.parse(slack.body).blocks));
    assert.equal(hook.body, readFileSync(f.json, 'utf8'), 'generic webhook body is the digest file, byte for byte');
    assert.equal(hook.headers['x-commitwork-digest-id'], f.doc.digestId);
    assert.equal(hook.method, 'POST');

    const ledgerText = readFileSync(ledgerPath(f.root), 'utf8');
    const text = renderText(r);
    for (const s of [ledgerText, text, JSON.stringify(r)]) assert.ok(!s.includes(SECRET) && !s.includes('/slack/'), 'no URL path or token in output or ledger');
    const ledger = JSON.parse(ledgerText);
    assert.equal(Object.keys(ledger.deliveries).length, 2);
    for (const [k, v] of Object.entries(ledger.deliveries)) {
      assert.ok(k.startsWith(`${f.doc.digestId}|`));
      assert.equal(v.at, NOW, 'CW_NOW stamps the ledger');
    }

    const again = await deliverDigest({ root: f.root, env });
    assert.equal(again.outcome, 'delivered');
    assert.deepEqual(again.results.map((x) => x.state), ['already-delivered', 'already-delivered']);
    assert.equal(srv.hits.length, 2, 'nothing re-posted');
    assert.equal(readFileSync(ledgerPath(f.root), 'utf8'), ledgerText, 'ledger unchanged by a no-op re-run');
  } finally { await srv.close(); }
});

test('a non-2xx is recorded as failed with status and reason, never delivered, and the next run retries', async () => {
  const f = fixture();
  const srv = await server((req, res, n) => (n === 1 ? reply(500, 'invalid_token')(req, res) : reply(200)(req, res)));
  try {
    const env = { ...f.env, CW_DIGEST_SLACK_URL: `${srv.base}/slack/${SECRET}` };
    const r = await deliverDigest({ root: f.root, env });
    assert.equal(r.outcome, 'failed');
    assert.equal(exitFor(r), 20);
    assert.equal(r.results[0].state, 'failed');
    assert.equal(r.results[0].status, 500);
    assert.match(r.results[0].reason, /^HTTP 500/);
    assert.ok(!r.results[0].reason.includes('invalid_token'), 'the response body is not read');
    assert.match(renderText(r), /NOT DELIVERED: HTTP 500/);
    const rec = Object.values(JSON.parse(readFileSync(ledgerPath(f.root), 'utf8')).deliveries)[0];
    assert.deepEqual([rec.state, rec.status, rec.attempts], ['failed', 500, 1]);

    const r2 = await deliverDigest({ root: f.root, env });
    assert.equal(r2.outcome, 'delivered');
    const rec2 = Object.values(JSON.parse(readFileSync(ledgerPath(f.root), 'utf8')).deliveries)[0];
    assert.deepEqual([rec2.state, rec2.attempts], ['delivered', 2]);
  } finally { await srv.close(); }
});

test('a redirect is not followed and counts as a failure', async () => {
  const f = fixture();
  const srv = await server(reply(307, '', { location: '/elsewhere' }));
  try {
    const r = await deliverDigest({ root: f.root, env: { ...f.env, CW_DIGEST_WEBHOOK_URL: `${srv.base}/hook/${SECRET}` } });
    assert.equal(r.results[0].state, 'failed');
    assert.equal(r.results[0].status, 307);
    assert.equal(srv.hits.length, 1);
  } finally { await srv.close(); }
});

test('timeouts and network errors are failures whose reason carries no URL path', async () => {
  const f = fixture();
  const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason)));
  const r = await deliverDigest({ root: f.root, env: { ...f.env, CW_DIGEST_SLACK_URL: `https://hooks.example.invalid/services/${SECRET}` }, fetchImpl: hang, timeoutMs: 30 });
  assert.equal(r.results[0].state, 'failed');
  assert.equal(r.results[0].reason, 'timeout after 30ms');

  const boom = async (url) => { throw new TypeError('fetch failed', { cause: new Error(`getaddrinfo ENOTFOUND for ${url}`) }); };
  const r2 = await deliverDigest({ root: f.root, env: { ...f.env, CW_DIGEST_SLACK_URL: `https://hooks.example.invalid/services/${SECRET}` }, fetchImpl: boom });
  assert.equal(r2.results[0].state, 'failed');
  assert.match(r2.results[0].reason, /^network: /);
  assert.ok(!r2.results[0].reason.includes(SECRET));
});

test('an insecure destination is refused without a request', async () => {
  const f = fixture();
  const never = async () => { throw new Error('fetch must not be called'); };
  const r = await deliverDigest({ root: f.root, env: { ...f.env, CW_DIGEST_WEBHOOK_URL: 'http://hooks.example.invalid/hook' }, fetchImpl: never });
  assert.equal(r.results[0].state, 'failed');
  assert.match(r.results[0].reason, /^refused: scheme http: refused/);
});

test('an edited digest, an unparseable ledger and no destination all refuse to report delivery', async () => {
  const f = fixture();
  const never = async () => { throw new Error('fetch must not be called'); };
  const env = { ...f.env, CW_DIGEST_SLACK_URL: `https://hooks.example.invalid/services/${SECRET}` };

  const edited = JSON.parse(readFileSync(f.json, 'utf8'));
  edited.sections.failedWork.headline = 'Failed work: 0 failure(s)';
  const editedPath = join(f.root, 'edited.json');
  writeFileSync(editedPath, JSON.stringify(edited));
  assert.throws(() => readDigest(editedPath), (e) => e instanceof Refused && /does not verify/.test(e.message));
  await assert.rejects(deliverDigest({ root: f.root, file: editedPath, env, fetchImpl: never }), Refused);

  mkdirSync(dirname(ledgerPath(f.root)), { recursive: true });
  writeFileSync(ledgerPath(f.root), '{ torn');
  await assert.rejects(deliverDigest({ root: f.root, env, fetchImpl: never }), /not JSON; refusing rather than re-posting/);

  const none = await deliverDigest({ root: f.root, env: f.env, fetchImpl: never });
  assert.equal(none.outcome, 'not-configured');
  assert.equal(exitFor(none), 21);
});

test('dry run shows the payload and redacted destination, posts nothing and writes no ledger', async () => {
  const f = fixture();
  const never = async () => { throw new Error('fetch must not be called'); };
  const r = await deliverDigest({ root: f.root, env: { ...f.env, CW_DIGEST_SLACK_URL: `https://hooks.example.invalid/services/${SECRET}` }, fetchImpl: never, dryRun: true });
  assert.equal(r.outcome, 'dry-run');
  assert.equal(r.results[0].state, 'would-send');
  assert.equal(r.results[0].target, 'https://hooks.example.invalid/…');
  assert.ok(Array.isArray(r.results[0].payload.blocks));
  assert.throws(() => readFileSync(ledgerPath(f.root)), { code: 'ENOENT' });
});

const run = (args, env) => new Promise((res) => {
  const c = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
  let out = ''; let err = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { err += d; });
  c.on('close', (status) => res({ status, out, err }));
});

test('CLI: env read at call time, newest digest by default, exit 0 then idempotent, 21 unconfigured, 23 usage', async () => {
  const f = fixture();
  const srv = await server(reply(200));
  try {
    const env = { CW_REPORTS_ROOT: f.reportsRoot, CW_NOW: NOW, CW_DIGEST_SLACK_URL: `${srv.base}/slack/${SECRET}`, CW_DIGEST_WEBHOOK_URL: '' };
    const a = await run([], env);
    assert.equal(a.status, 0, a.err);
    assert.match(a.out, /slack\s+http:\/\/127\.0\.0\.1:\d+\/…\s+delivered \(HTTP 200\)/);
    assert.ok(!a.out.includes(SECRET) && !a.err.includes(SECRET));
    const b = await run(['--json'], env);
    assert.equal(b.status, 0, b.err);
    assert.equal(JSON.parse(b.out).results[0].state, 'already-delivered');
    assert.equal(srv.hits.length, 1);
    assert.equal((await run([], { ...env, CW_DIGEST_SLACK_URL: '' })).status, 21);
    assert.equal((await run(['--bogus'], env)).status, 23);
    assert.equal((await run([], { ...env, CW_DIGEST_TIMEOUT_MS: 'soon' })).status, 23);
    assert.equal((await run(['--file', join(f.root, 'missing.json')], env)).status, 22);
  } finally { await srv.close(); }
});
