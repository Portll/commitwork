// The CodeQL route's local analyst goes through lib/model-provider.mjs: LM Studio by default, the
// hosted API that CW_MODEL_PROVIDER names when one is configured. The leaks check reuses the same
// analyst but sends a matched secret, so it stays on LM Studio whatever is configured. Both against
// servers on 127.0.0.1; no real model, no real key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveLocalModel, runLocal } from '../routes/codeql-remediation.mjs';
import { routes as leakRoutes } from '../routes/leaks-check.mjs';
import { ANTHROPIC_DEFAULT_MODEL, ANTHROPIC_DEFAULT_MAX_TOKENS } from '../../lib/model-provider.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-codeql-provider-'));
const REPO = join(TMP, 'repos', 'fixapp');
const KEYS = ['CW_REGISTRY', 'CW_LLM_URL_LMSTUDIO', 'CW_LMSTUDIO_URL', 'CW_CODEQL_LOCAL_MODEL',
  'CW_MODEL_PROVIDER', 'CW_MODEL_BASE_URL', 'CW_MODEL_API_KEY', 'CW_MODEL_NAME', 'ANTHROPIC_API_KEY'];
const saved = {};
const SCHEMA = { type: 'object', additionalProperties: false, required: ['classification'], properties: { classification: { type: 'string' } } };
const lmSeen = [], hostedSeen = [];
let lm, hosted;

function serve(seen, answer) {
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ url: req.url, headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer(req.url, body)));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}
const base = (srv) => `http://127.0.0.1:${srv.address().port}`;

before(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  lm = await serve(lmSeen, (url, body) => (url === '/v1/models'
    ? { data: [{ id: 'text-embedding-x' }, { id: 'qwen/qwen3.8-27b' }] }
    : { model: body.model, choices: [{ finish_reason: 'stop', message: { content: body.response_format.json_schema.name === 'leak_triage'
      ? JSON.stringify({ verdict: 'fixture', confidence: 'high', reasoning: 'a documented example value', signals: ['test path'] })
      : JSON.stringify({ classification: 'real' }) } }] }));
  hosted = await serve(hostedSeen, () => ({ type: 'message', model: 'claude-hosted', stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ classification: 'false-positive' }) }] }));
  mkdirSync(join(REPO, 'test'), { recursive: true });
  writeFileSync(join(REPO, 'test', 'fixture.js'), 'const a = 1;\nconst label = "placeholder-value";\nconst b = 2;\n');
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), defaultManifest: 'security-baseline', roots: [],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
    projects: [{ name: 'fixapp', area: 'fixarea', path: REPO, manifest: 'security-baseline' }],
  }));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, {
    CW_REGISTRY: join(TMP, 'projects.json'), CW_LLM_URL_LMSTUDIO: base(lm),
    CW_MODEL_PROVIDER: 'anthropic', CW_MODEL_BASE_URL: base(hosted), CW_MODEL_API_KEY: 'fixture-key',
  });
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  lm.close(); hosted.close();
  rmSync(TMP, { recursive: true, force: true });
});

test('with no provider configured the analyst is LM Studio, choosing the loaded Qwen 3.8 model', async () => {
  const held = process.env.CW_MODEL_PROVIDER;
  delete process.env.CW_MODEL_PROVIDER;
  const heldBase = process.env.CW_MODEL_BASE_URL;
  delete process.env.CW_MODEL_BASE_URL;
  try {
    const local = await resolveLocalModel();
    assert.equal(local.ok, true, local.error);
    assert.equal(local.provider.id, 'local');
    assert.equal(local.model, 'qwen/qwen3.8-27b');
    assert.equal(local.pinned, false);
    const n = lmSeen.length;
    const r = await runLocal(local.model, 'sys', 'user', SCHEMA, 'codeql_remediation_analysis', null, undefined, local.provider);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.verdict, { classification: 'real' });
    assert.deepEqual(r.answeredBy, { provider: 'local', engine: 'lmstudio', model: 'qwen/qwen3.8-27b', host: new URL(base(lm)).host });
    assert.equal(r.sampling, 'pinned-0');
    const call = lmSeen[n];
    assert.equal(call.url, '/v1/chat/completions');
    assert.equal(call.body.temperature, 0);
    assert.equal('max_tokens' in call.body, false, 'no ceiling was ever sent to the local analyst');
    assert.deepEqual(call.body.response_format, { type: 'json_schema', json_schema: { name: 'codeql_remediation_analysis', strict: true, schema: SCHEMA } });
    assert.deepEqual(call.body.messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'user' }]);
  } finally { process.env.CW_MODEL_PROVIDER = held; process.env.CW_MODEL_BASE_URL = heldBase; }
});

test('a hosted model that fixes its own sampling runs as the analyst, and its result records model-default sampling', async () => {
  const local = await resolveLocalModel();
  assert.equal(local.ok, true, local.error);
  assert.equal(local.model, ANTHROPIC_DEFAULT_MODEL);
  const hostedBefore = hostedSeen.length;
  const r = await runLocal(local.model, 'sys', 'user', SCHEMA, 'codeql_remediation_analysis', null, undefined, local.provider);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.verdict, { classification: 'false-positive' });
  assert.equal(r.sampling, 'model-default');
  assert.equal(hostedSeen.length, hostedBefore + 1, 'the model was asked');
  assert.equal('temperature' in hostedSeen.at(-1).body, false, 'and sent no temperature');
});

test('a configured hosted provider answers the analyst, constrained to the schema and named as itself', async () => {
  const local = await resolveLocalModel();
  assert.equal(local.ok, true, local.error);
  assert.equal(local.provider.id, 'anthropic');
  assert.equal(local.model, ANTHROPIC_DEFAULT_MODEL);
  assert.equal(local.pinned, true);
  const lmBefore = lmSeen.filter((c) => c.url === '/v1/chat/completions').length;
  const r = await runLocal('claude-opus-4-6', 'sys', 'user', SCHEMA, 'codeql_remediation_analysis', null, undefined, local.provider);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.sampling, 'pinned-0');
  assert.deepEqual(r.verdict, { classification: 'false-positive' });
  assert.deepEqual(r.answeredBy, { provider: 'anthropic', engine: 'anthropic', model: 'claude-hosted', host: new URL(base(hosted)).host });
  const call = hostedSeen.at(-1);
  assert.equal(call.url, '/v1/messages');
  assert.equal(call.headers['x-api-key'], 'fixture-key');
  assert.equal(call.body.system, 'sys');
  assert.equal(call.body.temperature, 0);
  assert.equal(call.body.max_tokens, ANTHROPIC_DEFAULT_MAX_TOKENS);
  assert.deepEqual(call.body.output_config, { format: { type: 'json_schema', schema: SCHEMA } });
  assert.equal(lmSeen.filter((c) => c.url === '/v1/chat/completions').length, lmBefore, 'LM Studio was not asked');
});

test('a misconfigured hosted provider refuses the job; it never falls back to LM Studio', async () => {
  const held = process.env.CW_MODEL_API_KEY;
  delete process.env.CW_MODEL_API_KEY;
  try {
    const local = await resolveLocalModel();
    assert.equal(local.ok, false);
    assert.match(local.error, /CW_MODEL_API_KEY|ANTHROPIC_API_KEY/);
  } finally { process.env.CW_MODEL_API_KEY = held; }
});

test('the leaks check keeps the matched secret on LM Studio while a hosted provider is configured', async () => {
  const hostedBefore = hostedSeen.length;
  const route = leakRoutes.find((r) => r.path === '/api/leaks/check');
  const sent = [];
  await route.handle({
    req: {},
    send: (status, payload) => { sent.push({ status, payload }); return payload; },
    adminSession: () => ({ user: 'op' }),
    readJsonBody: (_req, cb) => cb({ repo: 'fixapp', rule: 'generic-api-key', file: 'test/fixture.js', line: 2 }, null),
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, 200, JSON.stringify(sent[0].payload));
  assert.equal(sent[0].payload.verdict, 'fixture');
  assert.equal(sent[0].payload.answeredBy.provider, 'local');
  assert.equal(sent[0].payload.answeredBy.host, new URL(base(lm)).host);
  assert.equal(hostedSeen.length, hostedBefore, 'nothing was sent to the hosted API');
  const call = lmSeen.at(-1);
  assert.equal(call.body.response_format.json_schema.name, 'leak_triage');
  assert.ok(call.body.messages[1].content.includes('placeholder-value'), 'the matched line went to LM Studio, and only there');
});
