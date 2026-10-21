// bin/test/memory-upsert.test.mjs — the agent write surface.
//
// Hermetic: VELD_API_KEY is set in the injected env so credential() never shells out to the
// keychain, and fetch is a fake veld that stores what it is sent. The two properties defended
// here are the reasons the CLI exists: the exit code is 0 ONLY for a verified receipt, and neither
// the key nor the body ever reaches stdout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run, parseArgs, writeEnv, WRITE_TIMEOUT_MS } from '../memory-upsert.mjs';

const KEY = 'fixture-key-never-printed';
const BODY = 'handoff body: rotate the aaPanel keys `$(echo should-not-run)`';
const ENV = { VELD_API_URL: 'http://127.0.0.1:3030', VELD_API_KEY: KEY, CW_VELD_PROJECT: 'example-project', VELD_MAX_RETRIES: '0' };

function fakeVeld({ storeAs = (s) => s } = {}) {
  const calls = [];
  let stored = null;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'POST' && String(url).endsWith('/api/upsert')) {
      const b = JSON.parse(init.body);
      stored = { content: storeAs(b.content), tags: b.tags };
      return Response.json({ id: 'mem-1', was_update: false, version: 1 });
    }
    if (init.method === 'GET' && String(url).includes('/api/memory/mem-1')) return Response.json({ experience: stored });
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, calls };
}

function bodyFile(t, content = BODY) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-memup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = join(dir, 'handoff.md');
  writeFileSync(p, content);
  return p;
}

const ARGS = (file) => ['--file', file, '--external-id', 'commitwork/handoff/s1', '--scope', 'example-project', '--tags', 'handoff,session-close'];

test('verified round trip exits 0 and puts external_id on the record', async (t) => {
  const v = fakeVeld();
  const r = await run(ARGS(bodyFile(t)), { env: ENV, fetchImpl: v.fetchImpl });
  assert.equal(r.exitCode, 0);
  assert.equal(r.receipt.state, 'verified');
  const sent = v.calls.find((c) => c.url.endsWith('/api/upsert')).body;
  assert.equal(sent.external_id, 'commitwork/handoff/s1');
  assert.equal(sent.content, BODY);
  assert.ok(sent.tags.includes('handoff') && sent.tags.includes('scope:example-project') && sent.tags.includes('memory-layer-project:example-project'));
});

test('neither the key nor the body reaches stdout, in text or json', async (t) => {
  for (const extra of [[], ['--json']]) {
    const r = await run([...ARGS(bodyFile(t)), ...extra], { env: ENV, fetchImpl: fakeVeld().fetchImpl });
    assert.ok(!r.text.includes(KEY), `key leaked with ${extra}`);
    assert.ok(!r.text.includes('aaPanel'), `body leaked with ${extra}`);
  }
});

test('a divergent store exits 1 — not durable is not success', async (t) => {
  const v = fakeVeld({ storeAs: () => 'something else entirely, unrelated to the source text' });
  const r = await run(ARGS(bodyFile(t)), { env: ENV, fetchImpl: v.fetchImpl });
  assert.equal(r.exitCode, 1);
  assert.notEqual(r.receipt.state, 'verified');
});

test('an unreachable veld exits 1 with a reason, never 0', async (t) => {
  const r = await run(ARGS(bodyFile(t)), { env: ENV, fetchImpl: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:3030'); } });
  assert.equal(r.exitCode, 1);
  assert.match(r.text, /ECONNREFUSED/);
});

test('missing required flags exits 2 without calling veld', async () => {
  const v = fakeVeld();
  const r = await run(['--file', '/nonexistent'], { env: ENV, fetchImpl: v.fetchImpl });
  assert.equal(r.exitCode, 2);
  assert.match(r.text, /--external-id, --scope/);
  assert.equal(v.calls.length, 0);
});

test('an empty body is refused rather than overwriting a real memory', async (t) => {
  const v = fakeVeld();
  await assert.rejects(run(ARGS(bodyFile(t, '  \n')), { env: ENV, fetchImpl: v.fetchImpl }), /empty/);
  assert.equal(v.calls.length, 0);
});

test('--file - reads stdin', async () => {
  const v = fakeVeld();
  const r = await run(['--file', '-', '--external-id', 'commitwork/handoff/s2', '--scope', 'x'], { env: ENV, fetchImpl: v.fetchImpl, stdin: () => BODY });
  assert.equal(r.exitCode, 0);
});

test('writes default to a 30s timeout but an explicit VELD_TIMEOUT_MS wins', () => {
  assert.equal(writeEnv({}).VELD_TIMEOUT_MS, WRITE_TIMEOUT_MS);
  assert.equal(writeEnv({ VELD_TIMEOUT_MS: '1234' }).VELD_TIMEOUT_MS, '1234');
  const env = { VELD_API_KEY: KEY };
  writeEnv(env);
  assert.equal(env.VELD_TIMEOUT_MS, undefined, 'the caller env must not be mutated');
});

test('parseArgs rejects unknown flags and valueless flags', () => {
  assert.throws(() => parseArgs(['--api-key', 'x']), /unknown argument/);
  assert.throws(() => parseArgs(['--scope']), /needs a value/);
  assert.throws(() => parseArgs(['--scope', '--json']), /needs a value/);
});
