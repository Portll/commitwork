import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStackApi } from '../../runner/api.mjs';
import { readStack, stackApiUrl, stackTokenPath, UNMEASURED, UP_REMEDY } from '../stack-client.mjs';

const TOKEN = 'synthetic-token-0123456789abcdef';
const DIR = mkdtempSync(join(tmpdir(), 'cw-stack-client-'));
const TOKEN_FILE = join(DIR, 'api-token');
writeFileSync(TOKEN_FILE, `${TOKEN}\n`);
const SLOTS = [{ id: 'slot-1', state: 'idle', since: '2026-10-22T09:00:00.000Z', job: null }];

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
const api = createStackApi({ token: TOKEN, host: '127.0.0.1', port: 0, slots: () => SLOTS, probes: {} });
const API = `http://127.0.0.1:${(await api.listen()).port}`;
after(() => api.close());

async function withEnv(vars, fn) {
  const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(keep)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

function assertUnmeasured(env, cause) {
  assert.equal(env.ok, false);
  assert.equal(env.error.code, UNMEASURED);
  assert.equal(env.error.cause, cause);
  assert.ok(env.error.message, 'a reason');
  assert.ok(env.error.remedy, 'a remedy');
  assert.equal('data' in env, false, 'no data, so no zeros');
}

test('a refused connection is UNMEASURED with the stack-up remedy', async () => {
  const srv = createServer();
  const url = await listen(srv);
  await new Promise((r) => srv.close(r));
  const env = await readStack('/v1/runner/slots', { url, token: TOKEN });
  assertUnmeasured(env, 'stack-down');
  assert.equal(env.route, '/v1/runner/slots');
  assert.equal(env.error.detail, 'ECONNREFUSED');
  assert.equal(env.error.remedy, UP_REMEDY);
  assert.match(env.error.message, /refused the connection/);
});

test('no answer, and a body that stalls after the headers, are each UNMEASURED at the timeout', async () => {
  const srv = createServer((req, res) => { if (req.url.startsWith('/v1/runner')) { res.writeHead(200); res.write('{"ok":'); } });
  const url = await listen(srv);
  try {
    for (const route of ['/v1/health', '/v1/runner/jobs']) {
      const env = await readStack(route, { url, token: TOKEN, timeoutMs: 60 });
      assertUnmeasured(env, 'timeout');
      assert.match(env.error.message, /did not answer in 60 ms/);
      assert.equal(env.error.remedy, UP_REMEDY);
    }
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

test('a missing or empty token file is UNMEASURED, and nothing is sent', async () => {
  const calls = [];
  const spy = async (...args) => { calls.push(args); throw new Error('must not be called'); };
  const empty = join(DIR, 'empty-token');
  writeFileSync(empty, '\n');
  for (const file of [join(DIR, 'absent'), empty]) {
    await withEnv({ CW_STACK_API_TOKEN_FILE: file }, async () => {
      const env = await readStack('/v1/health', { url: API, fetch: spy });
      assertUnmeasured(env, 'token-missing');
      assert.ok(env.error.remedy.startsWith(UP_REMEDY));
    });
  }
  assert.equal(calls.length, 0);
});

test('an unreadable token file is reported as unreadable, not as missing', async () => {
  await withEnv({ CW_STACK_API_TOKEN_FILE: DIR }, async () => {
    const env = await readStack('/v1/health', { url: API });
    assertUnmeasured(env, 'token-unreadable');
    assert.match(env.error.message, /EISDIR/);
  });
});

test('a 401 from the stack API is a token problem, not a stopped stack', async () => {
  const wrong = join(DIR, 'wrong-token');
  writeFileSync(wrong, 'synthetic-token-WRONG-456789abcdef\n');
  await withEnv({ CW_STACK_API_TOKEN_FILE: wrong }, async () => {
    const env = await readStack('/v1/health', { url: API });
    assertUnmeasured(env, 'token-rejected');
    assert.match(env.error.message, /rejected the token from .*wrong-token/);
    assert.equal(env.error.detail, 'a valid bearer token is required');
    assert.match(env.error.remedy, /CW_STACK_API_TOKEN_FILE/);
  });
});

test('ok passes through as the API sent it; URL and token file are read at call time', async () => {
  await withEnv({ CW_STACK_API_URL: API, CW_STACK_API_TOKEN_FILE: TOKEN_FILE }, async () => {
    const env = await readStack('/v1/runner/slots');
    assert.deepEqual(Object.keys(env), ['ok', 'route', 'schemaVersion', 'stamp', 'sources', 'coverage', 'data']);
    assert.equal(env.ok, true);
    assert.deepEqual(env.data, { slots: SLOTS });
    assert.deepEqual(env.sources, [{ id: 'slots', status: 'live', reason: null }]);
  });
  const refused = await readStack('/v1/runner/jobs?limit=0', { url: API, token: TOKEN });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'BAD_PARAM', "the API's own refusal passes through");
});

test('a body without the envelope, a bad URL and a route outside /v1/ are UNMEASURED, never a throw', async () => {
  const srv = createServer((req, res) => { res.end(req.url === '/v1/health' ? 'hello' : '{"rows":[]}'); });
  const url = await listen(srv);
  try {
    assertUnmeasured(await readStack('/v1/health', { url, token: TOKEN }), 'bad-response');
    assertUnmeasured(await readStack('/v1/runner/jobs', { url, token: TOKEN }), 'bad-response');
  } finally {
    srv.close();
  }
  assertUnmeasured(await readStack('/v1/health', { url: 'not a url', token: TOKEN }), 'bad-url');
  assertUnmeasured(await readStack('/v1/health', { url: 'file:///etc', token: TOKEN }), 'bad-url');
  assertUnmeasured(await readStack('/health', { url: API, token: TOKEN }), 'bad-route');
  assertUnmeasured(await readStack(undefined, { url: API, token: TOKEN }), 'bad-route');
});

test('defaults: the loopback API and the token spine writes into its state directory', async () => {
  await withEnv({ CW_STACK_API_URL: undefined, CW_STACK_API_TOKEN_FILE: undefined, CW_STACK_STATE: undefined }, () => {
    assert.equal(stackApiUrl(), 'http://127.0.0.1:17990');
    assert.equal(stackTokenPath(), join(homedir(), '.config', 'portll-stack', 'api-token'));
  });
  await withEnv({ CW_STACK_API_TOKEN_FILE: undefined, CW_STACK_STATE: DIR }, () => {
    assert.equal(stackTokenPath(), join(DIR, 'api-token'));
  });
});
