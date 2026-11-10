// Reads a stack API route with a bearer token and returns the JSON envelope (lib/stack-client.mjs readStack).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStack } from '../stack-client.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('rejects routes that do not start with /v1/', async () => {
  const r = await readStack('/v2/items', { token: 'tok' });
  assert.deepEqual(r, { ok: false, route: "/v2/items", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "bad-route", message: "not a stack API route: /v2/items", detail: null, remedy: "a route under /v1/" }, partial: null });
});

test('accepts routes that start with /v1/ and reach the token check', async () => {
  const r = await readStack('/v1/items', { token: '' });
  assert.deepEqual(r, { ok: false, route: "/v1/items", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "token-missing", message: "the token supplied is empty", detail: null, remedy: "run node bin/stack.mjs up in the spine checkout" }, partial: null });
});

test('rejects a non-http CW_STACK_API_URL', async () => {
  const r = await readStack('/v1/items', { url: 'ftp://127.0.0.1:17990', token: 'tok' });
  assert.deepEqual(r, { ok: false, route: "/v1/items", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "bad-url", message: "CW_STACK_API_URL is not an http URL: ftp://127.0.0.1:17990", detail: null, remedy: "unset CW_STACK_API_URL for http://127.0.0.1:17990" }, partial: null });
});

test('rejects an invalid CW_STACK_API_URL that fails URL parsing', async () => {
  const r = await readStack('/v1/items', { url: 'not a url', token: 'tok' });
  assert.deepEqual(r, { ok: false, route: "/v1/items", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "bad-url", message: "CW_STACK_API_URL is not an http URL: not a url", detail: null, remedy: "unset CW_STACK_API_URL for http://127.0.0.1:17990" }, partial: null });
});

test('reports an empty token file as token-missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'readStack-'));
  try {
    const file = join(dir, 'api-token');
    writeFileSync(file, '');
    const r = await readStack('/v1/items', { token: undefined, url: 'http://127.0.0.1:17990' });
    assert.deepEqual(r, { ok: false, route: "/v1/items", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "token-missing", message: "no stack API token at ~/.config/portll-stack/api-token", detail: null, remedy: "run node bin/stack.mjs up in the spine checkout, which writes ~/.config/portll-stack/api-token, or set CW_STACK_API_TOKEN_FILE" }, partial: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a missing token file as token-missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'readStack-'));
  try {
    const r = await readStack('/v1/items', { token: undefined, url: 'http://127.0.0.1:17990' });
    assert.deepEqual(r, { ok: false, route: "/v1/items", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "token-missing", message: "no stack API token at ~/.config/portll-stack/api-token", detail: null, remedy: "run node bin/stack.mjs up in the spine checkout, which writes ~/.config/portll-stack/api-token, or set CW_STACK_API_TOKEN_FILE" }, partial: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the envelope when the API answers 200 with a valid envelope', async () => {
  const fakeFetch = async () => ({ status: 200, text: async () => JSON.stringify({ ok: true, data: { id: 1 } }) });
  const r = await readStack('/v1/items', { token: 'tok', fetch: fakeFetch });
  assert.deepEqual(r, { ok: true, data: { id: 1 } });
});

test('reports a 401 as token-rejected', async () => {
  const fakeFetch = async () => ({ status: 401, text: async () => JSON.stringify({ ok: false, error: { message: 'bad token' } }) });
  const r = await readStack('/v1/items', { token: 'tok', fetch: fakeFetch });
  assert.deepEqual(r, { ok: false, route: "/v1/items", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "token-rejected", message: "the stack API rejected the token from the caller", detail: "bad token", remedy: "the token and the running stack disagree: run node bin/stack.mjs up in the spine checkout again, or point CW_STACK_API_TOKEN_FILE at the file it wrote" }, partial: null });
});

test('reports a non-envelope body as bad-response', async () => {
  const fakeFetch = async () => ({ status: 200, text: async () => 'not json' });
  const r = await readStack('/v1/items', { token: 'tok', fetch: fakeFetch });
  assert.deepEqual(r, { ok: false, route: "/v1/items", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "bad-response", message: "the stack API answered HTTP 200 without its envelope", detail: "http://127.0.0.1:17990", remedy: "check that CW_STACK_API_URL names the stack API" }, partial: null });
});

test('reports a connection refusal as stack-down', async () => {
  const fakeFetch = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  const r = await readStack('/v1/items', { token: 'tok', fetch: fakeFetch });
  assert.deepEqual(r, { ok: false, route: "/v1/items", schemaVersion: 1, stamp: { verifiedAt: null, verifiedAtUnix: null, generator: "commitwork \u00b7 lib/stack-client.mjs" }, error: { code: "UNMEASURED", cause: "stack-down", message: "the stack API at http://127.0.0.1:17990 refused the connection", detail: "ECONNREFUSED", remedy: "run node bin/stack.mjs up in the spine checkout" }, partial: null });
});
