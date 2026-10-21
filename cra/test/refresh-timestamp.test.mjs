// node --test cra/test/refresh-timestamp.test.mjs — refresh.mjs's timestamp step, end to end.
//
// The TSA is an http server on 127.0.0.1 in this process, signing with ./lib/tsa-pki.mjs's throwaway
// PKI; no test reaches the network. refresh.mjs runs as an async child so the server can answer it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from '../../lib/json-schema.mjs';
import { parseRequest, EXIT as TSA_EXIT } from '../timestamp.mjs';
import { EVIDENCE_INDEX, REFRESH_STATUS } from '../evidence-status.mjs';
import { makePki } from './lib/tsa-pki.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIX = join(HERE, 'fixtures');
const NOW = '2026-07-20T00:00:00.000Z';
const { CA, makeResponse } = makePki();
const sha256 = (b) => createHash('sha256').update(b).digest();

let T, server, tsaUrl, caPem;
const tsa = { mode: 'ok', requests: 0 };

before(async () => {
  T = mkdtempSync(join(tmpdir(), 'cw-refresh-tsa-'));
  caPem = join(T, 'ca.pem');
  writeFileSync(caPem, CA.toString());
  server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      tsa.requests++;
      if (tsa.mode === 'error') { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('internal error'); return; }
      const q = parseRequest(Buffer.concat(chunks));
      const imprint = tsa.mode === 'other-digest' ? sha256(Buffer.from('a different record')) : Buffer.from(q.imprint, 'hex');
      res.writeHead(200, { 'content-type': 'application/timestamp-reply' });
      res.end(makeResponse({ imprint, nonce: q.nonce }));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  tsaUrl = `http://127.0.0.1:${server.address().port}/tsr`;
  const kg = spawnSync(process.execPath, [join(REPO, 'cra', 'attest.mjs'), 'keygen'], { env: envFor('keygen'), encoding: 'utf8', timeout: 60_000 });
  assert.equal(kg.status, 0, kg.stdout + kg.stderr);
});
after(async () => {
  await new Promise((ok) => server.close(ok));
  rmSync(T, { recursive: true, force: true });
});

function envFor(name, extra = {}) {
  const d = join(T, name);
  return {
    ...process.env, CW_CRA_ROOT: T,
    CW_ROLLUP: join(FIX, 'rollup.json'), CW_LEDGER: join(FIX, 'ledger.json'),
    CW_ANNOTATIONS: join(FIX, 'annotations.json'), CW_PRODUCTS: join(FIX, 'products.json'),
    CW_KEV: join(FIX, 'kev.json'), CW_EPSS: join(FIX, 'epss.json'),
    CW_CONTROLS: join(REPO, 'cra', 'controls.json'), CW_HISTORY: join(FIX, 'history.json'),
    CW_CASES: join(d, 'cases.json'), CW_CRA_OUT: join(d, 'out'),
    CW_ATTEST_KEYDIR: join(T, 'keys'), CW_ATTEST_LOG: join(d, 'out', 'attestations.jsonl'),
    CW_CRA_NOW: NOW, CW_ESCALATE: '0', CRA_WEBHOOK_URL: 'https://hooks.example/cra',
    CW_CRA_EVIDENCE_STALE_HOURS: '', CW_TSA_URL: '', CW_TSA_CA: '', CW_TSA_TIMEOUT_MS: '20000',
    ...extra,
  };
}

function runNode(script, args, env) {
  return new Promise((ok) => {
    const c = spawn(process.execPath, [join(REPO, 'cra', script), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
    let stdout = '', stderr = '';
    c.stdout.on('data', (b) => { stdout += b; });
    c.stderr.on('data', (b) => { stderr += b; });
    c.on('close', (status, signal) => ok({ status, signal, stdout, stderr }));
  });
}

async function refresh(name, mode, extra = {}) {
  const env = envFor(name, extra);
  mkdirSync(join(T, name), { recursive: true });
  tsa.mode = mode;
  const before = tsa.requests;
  const r = await runNode('refresh.mjs', ['--no-xlsx'], env);
  const out = env.CW_CRA_OUT;
  const idx = JSON.parse(readFileSync(join(out, EVIDENCE_INDEX), 'utf8'));
  const run = JSON.parse(readFileSync(join(out, REFRESH_STATUS), 'utf8'));
  assert.deepEqual(validateAgainstSchema(idx, { path: join(REPO, 'schema', 'cra-evidence-index.schema.json') }).errors, []);
  assert.deepEqual(validateAgainstSchema(run, { path: join(REPO, 'schema', 'cra-refresh-status.schema.json') }).errors, []);
  const step = run.steps.find((s) => s.step === 'timestamp');
  assert.ok(step, `no timestamp step recorded\n${r.stdout}${r.stderr}`);
  assert.deepEqual(idx.steps.find((s) => s.step === 'timestamp'), step, 'the index and the run record disagree about the step');
  return { r, env, out, idx, run, step, requests: tsa.requests - before };
}

const status = async (env) => {
  const s = await runNode('evidence-status.mjs', ['--json'], env);
  return { ...JSON.parse(s.stdout), exitCode: s.status };
};
const tokens = (out) => ['rollup', 'ledger', 'annotations', 'products'].map((r) => join(out, 'signatures', `${r}.sig.tsr`));

test('without CW_TSA_URL the step is skipped, never ok, no TSA is asked, and the pack reads absent', async () => {
  const x = await refresh('unset', 'ok');
  assert.equal(x.r.status, 0, x.r.stdout + x.r.stderr);
  assert.deepEqual(x.step, { step: 'timestamp', exit: TSA_EXIT.ABSENT, outcome: 'skipped', reason: 'no CW_TSA_URL' });
  assert.equal(x.requests, 0);
  assert.equal(x.run.ok, true);
  assert.deepEqual(x.idx.timestamp, { state: 'absent', reason: 'no CW_TSA_URL', revocation: 'not checked', records: [] });
  assert.ok(tokens(x.out).every((p) => !existsSync(p)));
  const s = await status(x.env);
  assert.equal(s.state, 'current');
  assert.equal(s.timestamp.state, 'absent');
  assert.equal(s.timestamp.reason, 'no CW_TSA_URL');
});

test('a TSA that answers: each signature record is stamped, verified, catalogued, and anchored with CW_TSA_CA', async () => {
  const x = await refresh('anchored', 'ok', { CW_TSA_URL: tsaUrl, CW_TSA_CA: caPem });
  assert.equal(x.r.status, 0, x.r.stdout + x.r.stderr);
  assert.deepEqual(x.step, { step: 'timestamp', exit: 0, outcome: 'ok' });
  assert.equal(x.idx.timestamp.state, 'anchored');
  assert.equal(x.idx.timestamp.reason, null);
  const names = x.idx.timestamp.records.map((r) => r.record);
  assert.ok(['rollup', 'ledger', 'annotations', 'products'].every((r) => names.includes(join('signatures', `${r}.sig`))), names.join(', '));
  assert.equal(x.requests, names.length, 'one request per signature record');
  assert.ok(x.idx.timestamp.records.every((r) => r.state === 'anchored' && r.genTime === '2026-10-08T01:02:03.250Z'));
  for (const p of tokens(x.out)) assert.ok(x.idx.artifacts.some((a) => join(x.out, a.path) === p), `token not catalogued: ${p}`);

  const s = await status(x.env);
  assert.equal(s.state, 'current');
  assert.equal(s.timestamp.state, 'anchored');
  assert.equal(s.timestamp.revocation, 'not checked');
  assert.equal((await status({ ...x.env, CW_TSA_CA: '' })).timestamp.state, 'unanchored', 'the reader re-verifies with its own CW_TSA_CA');

  const rollupSig = join(x.out, 'signatures', 'rollup.sig');
  writeFileSync(rollupSig, readFileSync(rollupSig, 'utf8').replace('"ed25519"', '"ed25519" '));
  const tampered = await status(x.env);
  assert.equal(tampered.timestamp.state, 'invalid', 'a record changed after it was stamped');
  assert.match(tampered.timestamp.reason, /different record bytes/);
});

test('without CW_TSA_CA the tokens are unanchored: a signal, not ok and not a failure', async () => {
  const x = await refresh('unanchored', 'ok', { CW_TSA_URL: tsaUrl });
  assert.equal(x.step.outcome, 'signal');
  assert.equal(x.step.exit, TSA_EXIT.UNANCHORED);
  assert.equal(x.r.status, TSA_EXIT.UNANCHORED, x.r.stdout + x.r.stderr);
  assert.equal(x.run.ok, true);
  assert.equal(x.idx.timestamp.state, 'unanchored');
  assert.equal((await status(x.env)).timestamp.state, 'unanchored');
});

test('a TSA that answers 500 fails the step and the refresh; nothing reads ok', async () => {
  const x = await refresh('error', 'error', { CW_TSA_URL: tsaUrl, CW_TSA_CA: caPem });
  assert.ok(x.requests > 0);
  assert.equal(x.step.outcome, 'failed');
  assert.equal(x.step.exit, TSA_EXIT.REQUEST_FAILED);
  assert.match(x.step.reason, /TSA answered HTTP 500/);
  assert.equal(x.r.status, TSA_EXIT.REQUEST_FAILED, x.r.stdout + x.r.stderr);
  assert.equal(x.run.ok, false);
  assert.match(x.run.reason, /timestamp \(exit 23: .*HTTP 500/);
  assert.equal(x.idx.timestamp.state, 'absent');
  assert.ok(x.idx.timestamp.records.length > 0 && x.idx.timestamp.records.every((r) => r.state === 'absent' && /HTTP 500/.test(r.reason)));
  assert.ok(tokens(x.out).every((p) => !existsSync(p)), 'a failed request writes no token');
  const s = await status(x.env);
  assert.equal(s.state, 'failed');
  assert.equal(s.timestamp.state, 'absent');
  assert.match(s.timestamp.reason, /HTTP 500/);
});

test('a TSA that returns a token for a different digest fails the step and reads invalid', async () => {
  const x = await refresh('other-digest', 'other-digest', { CW_TSA_URL: tsaUrl, CW_TSA_CA: caPem });
  assert.equal(x.step.outcome, 'failed');
  assert.equal(x.step.exit, TSA_EXIT.INVALID);
  assert.match(x.step.reason, /messageImprint does not equal/);
  assert.equal(x.r.status, TSA_EXIT.INVALID, x.r.stdout + x.r.stderr);
  assert.equal(x.run.ok, false);
  assert.equal(x.idx.timestamp.state, 'invalid');
  assert.ok(x.idx.timestamp.records.every((r) => r.state === 'invalid'));
  assert.ok(tokens(x.out).every((p) => !existsSync(p)), 'a token for other bytes is never written');
  const s = await status(x.env);
  assert.equal(s.state, 'failed');
  assert.equal(s.timestamp.state, 'invalid');
  assert.match(s.timestamp.reason, /messageImprint does not equal/);
});
