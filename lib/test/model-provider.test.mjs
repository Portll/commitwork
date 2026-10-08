// lib/model-provider.mjs against servers on 127.0.0.1 that answer in each wire's shape. No real
// network, no real key: the fake key is assembled here at run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  resolveModelProvider, chatComplete, describeProvider, PROVIDER_ORDER,
  ANTHROPIC_BASE_URL, ANTHROPIC_DEFAULT_MODEL, ANTHROPIC_VERSION,
} from '../model-provider.mjs';

const fakeKey = () => ['fake', 'model', 'key', process.pid, Date.now()].join('-');
const LOCAL = { baseUrl: 'http://127.0.0.1:1234', engine: 'lmstudio' };

function serve(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      handler(req, res, seen);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, seen, base: `http://127.0.0.1:${server.address().port}`,
    close: () => { server.closeAllConnections(); server.close(); },
  })));
}
const json = (res, status, obj) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };

test('local is the default and first in the order; an API provider needs naming', () => {
  assert.equal(PROVIDER_ORDER[0], 'local');
  const r = resolveModelProvider({ local: LOCAL, env: {} });
  assert.equal(r.ok, true);
  assert.equal(r.provider.id, 'local');
  assert.equal(r.provider.engine, 'lmstudio');
  assert.equal(r.provider.baseUrl, 'http://127.0.0.1:1234/v1');
  assert.equal(r.provider.reach, 'local');
  assert.equal(r.provider.model, null);
  assert.equal(resolveModelProvider({ local: LOCAL, env: { CW_MODEL_PROVIDER: 'local', CW_MODEL_NAME: 'm' } }).provider.model, 'm');
});

test('a key in the environment does not select an API provider', () => {
  const r = resolveModelProvider({ local: LOCAL, env: { ANTHROPIC_API_KEY: fakeKey(), CW_MODEL_API_KEY: fakeKey() } });
  assert.equal(r.provider.id, 'local');
});

test('ambiguous or unknown configuration is refused rather than guessed', () => {
  assert.match(resolveModelProvider({ local: LOCAL, env: { CW_MODEL_PROVIDER: 'gemini' } }).error, /not a provider/);
  assert.match(resolveModelProvider({ local: LOCAL, env: { CW_MODEL_BASE_URL: 'https://api.example.com/v1' } }).error, /CW_MODEL_PROVIDER/);
  assert.match(resolveModelProvider({ env: {} }).error, /no local model server/);
  assert.match(resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'openai', CW_MODEL_NAME: 'm' } }).error, /CW_MODEL_BASE_URL/);
  assert.match(resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'openai', CW_MODEL_BASE_URL: 'https://api.example.com/v1' } }).error, /CW_MODEL_NAME/);
  assert.match(resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'openai', CW_MODEL_BASE_URL: 'ftp://x', CW_MODEL_NAME: 'm' } }).error, /http/);
  assert.match(resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'openai', CW_MODEL_BASE_URL: 'https://u:p@api.example.com', CW_MODEL_NAME: 'm' } }).error, /credentials/);
});

test('a misconfigured API provider fails; it never falls back to the local server', () => {
  const r = resolveModelProvider({ local: LOCAL, env: { CW_MODEL_PROVIDER: 'anthropic' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /ANTHROPIC_API_KEY/);
  assert.equal(r.provider, undefined);
});

test('anthropic defaults: Anthropic host, claude-sonnet-5-5, overridable model', () => {
  const r = resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: fakeKey() } });
  assert.equal(r.ok, true);
  assert.equal(r.provider.baseUrl, ANTHROPIC_BASE_URL);
  assert.equal(r.provider.model, ANTHROPIC_DEFAULT_MODEL);
  assert.equal(r.provider.reach, 'hosted');
  const pinned = resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: fakeKey(), CW_MODEL_NAME: 'claude-other' } });
  assert.equal(pinned.provider.model, 'claude-other');
  assert.equal(JSON.stringify(r).includes('fake-model-key'), false, 'the provider object holds no key');
});

test('ANTHROPIC_API_KEY is never sent to an overridden base URL', () => {
  const r = resolveModelProvider({ env: { CW_MODEL_PROVIDER: 'anthropic', CW_MODEL_BASE_URL: 'https://proxy.example.com', ANTHROPIC_API_KEY: fakeKey() } });
  assert.equal(r.ok, false);
  assert.match(r.error, /CW_MODEL_API_KEY/);
});

test('a key is never sent in clear text off this machine', () => {
  const env = { CW_MODEL_PROVIDER: 'openai-compatible', CW_MODEL_BASE_URL: 'http://api.example.com/v1', CW_MODEL_NAME: 'm', CW_MODEL_API_KEY: fakeKey() };
  assert.match(resolveModelProvider({ env }).error, /clear text/);
  assert.equal(resolveModelProvider({ env: { ...env, CW_MODEL_BASE_URL: 'https://api.example.com/v1' } }).ok, true);
  assert.equal(resolveModelProvider({ env: { ...env, CW_MODEL_BASE_URL: 'http://127.0.0.1:9/v1' } }).ok, true);
  assert.equal(resolveModelProvider({ env: { ...env, CW_MODEL_API_KEY: undefined } }).ok, true, 'no key, nothing to protect');
});

test('local: OpenAI chat-completions at <server>/v1, no key sent, answer attributed', async () => {
  const s = await serve((req, res) => json(res, 200, { model: 'qwen-local', choices: [{ finish_reason: 'stop', message: { content: 'VERDICT: real', reasoning_content: 'mulled' } }] }));
  try {
    const { provider } = resolveModelProvider({ local: { baseUrl: s.base, engine: 'lmstudio' }, env: {} });
    const r = await chatComplete(provider, { model: 'qwen-asked', system: 'sys', messages: [{ role: 'user', content: 'q' }], env: { CW_MODEL_API_KEY: fakeKey() } });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.text, 'VERDICT: real');
    assert.equal(r.thinking, 'mulled');
    assert.equal(r.truncated, false);
    assert.deepEqual(r.answeredBy, { provider: 'local', engine: 'lmstudio', model: 'qwen-local', host: new URL(s.base).host });
    assert.equal(s.seen[0].url, '/v1/chat/completions');
    assert.equal(s.seen[0].headers.authorization, undefined);
    assert.deepEqual(s.seen[0].body.messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'q' }]);
    assert.equal(s.seen[0].body.model, 'qwen-asked');
  } finally { s.close(); }
});

test('openai-compatible: Bearer key to <base>/chat/completions, finish_reason length is truncation', async () => {
  const key = fakeKey();
  const s = await serve((req, res) => json(res, 200, { choices: [{ finish_reason: 'length', message: { content: [{ type: 'text', text: 'part' }] } }] }));
  try {
    const env = { CW_MODEL_PROVIDER: 'openai', CW_MODEL_BASE_URL: `${s.base}/v1/`, CW_MODEL_NAME: 'gpt-x', CW_MODEL_API_KEY: key };
    const { provider } = resolveModelProvider({ local: LOCAL, env });
    assert.equal(provider.id, 'openai-compatible');
    const r = await chatComplete(provider, { messages: [{ role: 'user', content: 'q' }], env });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.text, 'part');
    assert.equal(r.truncated, true);
    assert.equal(r.answeredBy.engine, 'openai-compatible');
    assert.equal(r.answeredBy.model, 'gpt-x', 'no model in the reply: the requested one stands');
    assert.equal(s.seen[0].url, '/v1/chat/completions');
    assert.equal(s.seen[0].headers.authorization, `Bearer ${key}`);
  } finally { s.close(); }
});

test('anthropic: Messages API shape, headers, system at top level, thinking kept apart', async () => {
  const key = fakeKey();
  const s = await serve((req, res) => json(res, 200, {
    type: 'message', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: 'considered' }, { type: 'text', text: 'VERDICT: ' }, { type: 'text', text: 'false-positive' }],
  }));
  try {
    const env = { CW_MODEL_PROVIDER: 'anthropic', CW_MODEL_BASE_URL: s.base, CW_MODEL_API_KEY: key };
    const { provider } = resolveModelProvider({ env });
    const r = await chatComplete(provider, { system: 'sys', maxTokens: 64, messages: [{ role: 'user', content: 'q' }], env });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.text, 'VERDICT: false-positive');
    assert.equal(r.thinking, 'considered');
    assert.deepEqual(r.answeredBy, { provider: 'anthropic', engine: 'anthropic', model: 'claude-sonnet-5-5', host: new URL(s.base).host });
    const call = s.seen[0];
    assert.equal(call.method, 'POST');
    assert.equal(call.url, '/v1/messages');
    assert.equal(call.headers['x-api-key'], key);
    assert.equal(call.headers['anthropic-version'], ANTHROPIC_VERSION);
    assert.equal(call.headers.authorization, undefined);
    assert.equal(call.body.system, 'sys');
    assert.equal(call.body.max_tokens, 64);
    assert.equal(call.body.model, ANTHROPIC_DEFAULT_MODEL);
    assert.deepEqual(call.body.messages, [{ role: 'user', content: 'q' }]);
  } finally { s.close(); }
});

test('anthropic: max_tokens stop is truncation', async () => {
  const s = await serve((req, res) => json(res, 200, { model: 'm', stop_reason: 'max_tokens', content: [{ type: 'text', text: 'cut' }] }));
  try {
    const env = { CW_MODEL_PROVIDER: 'anthropic', CW_MODEL_BASE_URL: s.base, CW_MODEL_API_KEY: fakeKey() };
    const r = await chatComplete(resolveModelProvider({ env }).provider, { messages: [{ role: 'user', content: 'q' }], env });
    assert.equal(r.truncated, true);
  } finally { s.close(); }
});

test('fails closed with the status on HTTP errors, and the key never appears in the error', async () => {
  const key = fakeKey();
  const s = await serve((req, res) => {
    if (req.url.endsWith('/messages')) return json(res, 529, { type: 'error', error: { type: 'overloaded_error', message: `overloaded for ${key}` } });
    res.statusCode = 502; res.end('<html>bad gateway</html>');
  });
  try {
    const env = { CW_MODEL_PROVIDER: 'anthropic', CW_MODEL_BASE_URL: s.base, CW_MODEL_API_KEY: key };
    const a = await chatComplete(resolveModelProvider({ env }).provider, { messages: [{ role: 'user', content: 'q' }], env });
    assert.equal(a.ok, false);
    assert.equal(a.status, 529);
    assert.match(a.error, /HTTP 529: overloaded for \[redacted\]/);
    assert.equal(JSON.stringify(a).includes(key), false);
    const { provider } = resolveModelProvider({ local: { baseUrl: s.base }, env: {} });
    const b = await chatComplete(provider, { model: 'm', messages: [{ role: 'user', content: 'q' }], env: {} });
    assert.equal(b.ok, false);
    assert.equal(b.status, 502);
    assert.equal(b.text, undefined);
  } finally { s.close(); }
});

test('an unparseable or answer-less body is a failure, never an empty success', async () => {
  const bodies = [
    (res) => { res.statusCode = 200; res.end('not json'); },
    (res) => json(res, 200, { choices: [] }),
    (res) => json(res, 200, { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'all thought' } }] }),
  ];
  let i = 0;
  const s = await serve((req, res) => bodies[i++](res));
  try {
    const { provider } = resolveModelProvider({ local: { baseUrl: s.base, engine: 'lmstudio' }, env: {} });
    const ask = () => chatComplete(provider, { model: 'm', messages: [{ role: 'user', content: 'q' }], env: {} });
    const notJson = await ask();
    assert.equal(notJson.ok, false);
    assert.match(notJson.error, /not JSON/);
    const none = await ask();
    assert.equal(none.ok, false);
    assert.match(none.error, /without a completion/);
    const empty = await ask();
    assert.equal(empty.ok, false);
    assert.equal(empty.code, 'empty-answer');
    assert.equal(empty.thinking, 'all thought', 'the reasoning is kept for a caller that can use it');
    assert.match(empty.error, /token limit/);
  } finally { s.close(); }
});

test('a redirect is not followed, so the key reaches only the configured host', async () => {
  const other = await serve((req, res) => json(res, 200, { content: [{ type: 'text', text: 'x' }] }));
  const s = await serve((req, res) => { res.statusCode = 307; res.setHeader('location', `${other.base}/v1/messages`); res.end(); });
  try {
    const env = { CW_MODEL_PROVIDER: 'anthropic', CW_MODEL_BASE_URL: s.base, CW_MODEL_API_KEY: fakeKey() };
    const r = await chatComplete(resolveModelProvider({ env }).provider, { messages: [{ role: 'user', content: 'q' }], env });
    assert.equal(r.ok, false);
    assert.equal(r.status, 307);
    assert.equal(other.seen.length, 0);
  } finally { s.close(); other.close(); }
});

test('a bounded timeout, and an unreachable server, are failures that say so', async () => {
  const s = await serve(() => { /* never answers */ });
  try {
    const { provider } = resolveModelProvider({ local: { baseUrl: s.base }, env: {} });
    const slow = await chatComplete(provider, { model: 'm', messages: [{ role: 'user', content: 'q' }], timeoutMs: 150, env: {} });
    assert.equal(slow.ok, false);
    assert.match(slow.error, /no answer within/);
    const viaEnv = await chatComplete(provider, { model: 'm', messages: [{ role: 'user', content: 'q' }], env: { CW_MODEL_TIMEOUT_MS: '150' } });
    assert.match(viaEnv.error, /no answer within/);
  } finally { s.close(); }
  const closed = await serve(() => {});
  const base = closed.base;
  closed.close();
  const { provider } = resolveModelProvider({ local: { baseUrl: base }, env: {} });
  const r = await chatComplete(provider, { model: 'm', messages: [{ role: 'user', content: 'q' }], env: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /unreachable/);
});

test('no model selected is refused before any request', async () => {
  const { provider } = resolveModelProvider({ local: LOCAL, env: {} });
  const r = await chatComplete(provider, { messages: [{ role: 'user', content: 'q' }], env: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /no model/);
});

test('describeProvider names engine, model and host, and nothing else', () => {
  const env = { CW_MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: fakeKey() };
  const { provider } = resolveModelProvider({ env });
  assert.equal(describeProvider(provider), 'anthropic:claude-sonnet-5-5 @ api.anthropic.com');
});
