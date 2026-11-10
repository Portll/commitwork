// The normalised completion or failure of one chat request to an openai or anthropic wire (lib/model-provider.mjs chatComplete).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatComplete } from '../model-provider.mjs';

const http = process.getBuiltinModule('node:http');
const https = process.getBuiltinModule('node:https');
let reply = null;
let sent = null;
function fakeRequest(u, opts, onResponse) {
  const handlers = {};
  const req = {
    on(event, fn) { handlers[event] = fn; return req; },
    destroy() {},
    end(payload) {
      const { 'content-length': _length, ...headers } = opts.headers;
      sent = { url: u.href, method: opts.method, headers, body: JSON.parse(String(payload)) };
      if (!reply || reply.error) { handlers.error(reply ? reply.error : new Error('no reply')); return; }
      const resHandlers = {};
      onResponse({ statusCode: reply.status, on(event, fn) { resHandlers[event] = fn; } });
      resHandlers.data(Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(reply.body));
      resHandlers.end();
    },
  };
  return req;
}
http.request = fakeRequest;
https.request = fakeRequest;

async function call(provider, options, response = null) {
  reply = response;
  sent = null;
  const pending = chatComplete(provider, options);
  const request = sent;
  return { result: await pending, request };
}

const msgs = [{ role: 'user', content: 'hi' }];
const claude = { id: 'anthropic', engine: 'claude', wire: 'anthropic', baseUrl: 'http://claude.test', model: 'claude-sonnet-4-5' };
const claudeBy = (model = 'claude-sonnet-4-5') => ({ provider: 'anthropic', engine: 'claude', model, host: 'claude.test' });
const key1 = { CW_MODEL_API_KEY: 'sk-1' };
const claudeHeaders = { 'content-type': 'application/json', 'x-api-key': 'sk-1', 'anthropic-version': '2023-06-01' };

test('a missing model is reported without sending a request', async () => {
  const { result, request } = await call({ id: 'local', engine: 'llama', wire: 'openai', baseUrl: 'http://127.0.0.1:8080/v1' }, { messages: msgs, env: {} });
  assert.deepEqual(result, { ok: false, error: 'no model selected', answeredBy: { provider: 'local', engine: 'llama', model: null, host: '127.0.0.1:8080' } });
  assert.equal(request, null);
});

test('an anthropic wire without a usable key is refused before sending', async () => {
  const official = await call({ ...claude, baseUrl: 'https://api.anthropic.com' }, { messages: msgs, env: {} });
  assert.deepEqual(official.result, { ok: false, error: 'no API key for anthropic in the environment', answeredBy: { ...claudeBy(), host: 'api.anthropic.com' } });
  const proxied = await call(claude, { messages: msgs, env: { ANTHROPIC_API_KEY: 'sk-ant' } });
  assert.deepEqual(proxied.result, { ok: false, error: 'no API key for anthropic in the environment', answeredBy: claudeBy() });
  assert.equal(proxied.request, null);
});

test('extra request fields on a non openai wire are refused without sending', async () => {
  const { result, request } = await call(claude, { messages: msgs, extra: { logprobs: true, seed: 1 }, env: key1 }, { status: 200, body: '{}' });
  assert.deepEqual(result, { ok: false, error: 'claude (claude.test) takes no logprobs, seed; the request was not sent', answeredBy: claudeBy() });
  assert.equal(request, null);
});

test('an openai wire posts the system prompt and bearer token and returns the reported model', async () => {
  const provider = { id: 'local', engine: 'llama', wire: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', model: 'llama-3', tokenEnv: 'LLAMA_TOKEN' };
  const body = { model: 'llama-3-q4', choices: [{ message: { content: 'hello', reasoning_content: 'think' }, finish_reason: 'stop' }], usage: { total_tokens: 5 } };
  const { result, request } = await call(provider, { messages: msgs, system: 'be brief', signal: new AbortController().signal, env: { LLAMA_TOKEN: 'tok-9' } }, { status: 200, body: JSON.stringify(body) });
  assert.deepEqual(request, { url: 'http://127.0.0.1:8080/v1/chat/completions', method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok-9' }, body: { model: 'llama-3', temperature: 0, max_tokens: 2048, messages: [{ role: 'system', content: 'be brief' }, ...msgs] } });
  assert.deepEqual(result, { ok: true, text: 'hello', thinking: 'think', truncated: false, finishReason: 'stop', usage: { total_tokens: 5 }, temperature: 0, answeredBy: { provider: 'local', engine: 'llama', model: 'llama-3-q4', host: '127.0.0.1:8080' } });
});

test('a keyless openai wire sends extra fields and a json schema and omits a null max tokens', async () => {
  const provider = { id: 'local', engine: 'vllm', wire: 'openai', baseUrl: 'http://127.0.0.1:8000/v1', model: 'qwen' };
  const body = { choices: [{ message: { content: [{ type: 'text', text: 'ok' }, { type: 'image' }, null], reasoning: 'r' }, finish_reason: 'length' }] };
  const { result, request } = await call(provider, { messages: msgs, maxTokens: null, temperature: 0.7, extra: { top_k: 20 }, jsonSchema: { name: 'verdict', schema: { type: 'object' } }, env: {} }, { status: 200, body: JSON.stringify(body) });
  assert.deepEqual(request, { url: 'http://127.0.0.1:8000/v1/chat/completions', method: 'POST', headers: { 'content-type': 'application/json' }, body: { top_k: 20, model: 'qwen', temperature: 0.7, messages: msgs, response_format: { type: 'json_schema', json_schema: { name: 'verdict', strict: true, schema: { type: 'object' } } } } });
  assert.deepEqual(result, { ok: true, text: 'ok', thinking: 'r', truncated: true, finishReason: 'length', usage: null, temperature: 0.7, answeredBy: { provider: 'local', engine: 'vllm', model: 'qwen', host: '127.0.0.1:8000' } });
});

test('an anthropic wire posts default max tokens, schema and system and joins its blocks at status 299', async () => {
  const body = { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'thinking', thinking: 'a' }, { type: 'thinking', thinking: 'b' }, { type: 'text', text: '{"x":' }, { type: 'text', text: '1}' }], stop_reason: 'max_tokens', usage: { input_tokens: 3 } };
  const { result, request } = await call(claude, { messages: msgs, system: 'sys', maxTokens: null, temperature: NaN, jsonSchema: { name: 'out', schema: { type: 'object' } }, env: key1 }, { status: 299, body: JSON.stringify(body) });
  assert.deepEqual(request, { url: 'http://claude.test/v1/messages', method: 'POST', headers: claudeHeaders, body: { model: 'claude-sonnet-4-5', max_tokens: 16000, temperature: 0, messages: msgs, system: 'sys', output_config: { format: { type: 'json_schema', schema: { type: 'object' } } } } });
  assert.deepEqual(result, { ok: true, text: '{"x":1}', thinking: 'a\n\nb', truncated: true, finishReason: 'max_tokens', usage: { input_tokens: 3 }, temperature: 0, answeredBy: claudeBy('claude-sonnet-4-5-20250929') });
});

test('a model that fixes its own sampling gets no temperature and its refusals and blank answers are not ok', async () => {
  const opus = { ...claude, model: 'claude-opus-5-5' };
  const options = { messages: msgs, temperature: 0.5, env: key1 };
  const refused = await call(opus, options, { status: 200, body: JSON.stringify({ content: [], stop_reason: 'refusal', stop_details: { category: 'cyber' } }) });
  assert.deepEqual(refused.request, { url: 'http://claude.test/v1/messages', method: 'POST', headers: claudeHeaders, body: { model: 'claude-opus-5-5', max_tokens: 2048, messages: msgs } });
  assert.deepEqual(refused.result, { ok: false, status: 200, code: 'refusal', error: 'claude (claude.test) declined the request (cyber)', finishReason: 'refusal', answeredBy: claudeBy('claude-opus-5-5') });
  const bare = await call(opus, options, { status: 200, body: JSON.stringify({ content: [{ type: 'text', text: 'no' }], stop_reason: 'refusal' }) });
  assert.deepEqual(bare.result, { ok: false, status: 200, code: 'refusal', error: 'claude (claude.test) declined the request', finishReason: 'refusal', answeredBy: claudeBy('claude-opus-5-5') });
  const blank = await call(opus, options, { status: 200, body: JSON.stringify({ model: 'claude-opus-5-5-x', content: [{ type: 'text', text: ' \n' }, { type: 'thinking', thinking: 'hm' }], stop_reason: 'max_tokens' }) });
  assert.deepEqual(blank.result, { ok: false, status: 200, code: 'empty-answer', error: 'claude (claude.test) returned no answer text (cut off at the token limit)', thinking: 'hm', truncated: true, finishReason: 'max_tokens', temperature: null, answeredBy: claudeBy('claude-opus-5-5-x') });
  const silent = await call(opus, options, { status: 200, body: JSON.stringify({ content: [], stop_reason: 'end_turn' }) });
  assert.deepEqual(silent.result, { ok: false, status: 200, code: 'empty-answer', error: 'claude (claude.test) returned no answer text', thinking: null, truncated: false, finishReason: 'end_turn', temperature: null, answeredBy: claudeBy('claude-opus-5-5') });
});

test('a status below 200 or above 299 is reported with its error detail and the key redacted', async () => {
  const env = { CW_MODEL_API_KEY: 'sk-secret' };
  const cases = [
    [199, JSON.stringify({ error: { type: 'auth', message: 'bad key sk-secret' } }), 'claude (claude.test) answered HTTP 199: bad key [redacted]'],
    [300, 'moved', 'claude (claude.test) answered HTTP 300'],
    [404, JSON.stringify({ error: 'nope' }), 'claude (claude.test) answered HTTP 404: nope'],
    [529, JSON.stringify({ error: { type: 'overloaded_error' } }), 'claude (claude.test) answered HTTP 529: overloaded_error'],
    [500, JSON.stringify({ error: { message: 'x'.repeat(250) } }), `claude (claude.test) answered HTTP 500: ${'x'.repeat(200)}`],
  ];
  for (const [status, body, error] of cases) {
    const { result } = await call(claude, { messages: msgs, env }, { status, body });
    assert.deepEqual(result, { ok: false, status, error, answeredBy: claudeBy() });
  }
});

test('a 2xx body that is not json, lacks a completion or exceeds 32 MiB is reported', async () => {
  let parseError = null;
  try { JSON.parse('not json'); } catch (e) { parseError = e.message; }
  const bad = await call(claude, { messages: msgs, env: key1 }, { status: 200, body: 'not json' });
  assert.deepEqual(bad.result, { ok: false, status: 200, error: `claude (claude.test) answered HTTP 200 with a body that is not JSON (${parseError})`, answeredBy: claudeBy() });
  const none = await call(claude, { messages: msgs, env: key1 }, { status: 200, body: JSON.stringify({ content: 'x' }) });
  assert.deepEqual(none.result, { ok: false, status: 200, error: 'claude (claude.test) answered HTTP 200 without a completion in its body', answeredBy: claudeBy() });
  const limit = 32 * 1024 * 1024;
  const over = await call(claude, { messages: msgs, env: key1 }, { status: 200, body: Buffer.alloc(limit + 1, 32) });
  assert.deepEqual(over.result, { ok: false, error: 'claude (claude.test): response exceeded 33554432 bytes', code: 'too-large', stopped: false, answeredBy: claudeBy() });
  const exact = Buffer.alloc(limit, 32);
  exact.write(JSON.stringify({ content: [{ type: 'text', text: 'big' }], stop_reason: 'end_turn' }));
  const fits = await call(claude, { messages: msgs, env: key1 }, { status: 200, body: exact });
  assert.deepEqual(fits.result, { ok: true, text: 'big', thinking: null, truncated: false, finishReason: 'end_turn', usage: null, temperature: 0, answeredBy: claudeBy() });
});

test('a transport failure or a caller abort is reported as not ok with the key redacted', async () => {
  const env = { CW_MODEL_API_KEY: 'sk-secret' };
  const lost = await call(claude, { messages: msgs, env }, { error: new Error('refused for sk-secret') });
  assert.deepEqual(lost.result, { ok: false, error: 'claude (claude.test): unreachable: refused for [redacted]', code: 'unreachable', stopped: false, answeredBy: claudeBy() });
  const stopped = await call(claude, { messages: msgs, env, signal: AbortSignal.abort() }, { error: new Error('aborted') });
  assert.deepEqual(stopped.result, { ok: false, error: 'claude (claude.test): stopped by caller', code: 'stopped', stopped: true, answeredBy: claudeBy() });
});
