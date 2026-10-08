// bin/issue-llm.mjs through lib/model-provider.mjs, end to end: the CLI runs against servers on
// 127.0.0.1 that answer as LM Studio and as the Anthropic Messages API, and the issue record names
// whichever one answered. No real network, no real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { emptyIssuesDoc, mintIssue, saveIssues, withIssuesLock, loadIssues } from '../../monitor/issue-store.mjs';
import { attribution } from '../issue-llm.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'issue-llm.mjs');
const fakeKey = () => ['fake', 'issue', 'key', process.pid, Date.now()].join('-');

function serve(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { seen.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null }); handler(req, res); });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    seen, base: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close(); },
  })));
}
const json = (res, status, obj) => { res.statusCode = status; res.end(JSON.stringify(obj)); };

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-issue-llm-provider-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const storePath = join(dir, 'issues.json');
  const doc = emptyIssuesDoc();
  const { id } = mintIssue(doc, {
    area: 'testarea', title: 'fixture: a finding to triage', severity: 'high', repo: null, kind: 'task',
    body: 'fixture body', remediation: 'fixture remediation', class: 'F',
    source: { kind: 'manual', key: null, tool: null, rule: null },
  }, '2026-08-01T00:00:00.000Z');
  withIssuesLock(() => saveIssues(doc, { path: storePath }), { path: storePath });
  return { dir, storePath, id };
}

// Async spawn: the stub servers live in this process, so a blocking spawnSync would starve them.
function run(fx, env) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CLI, '--issue', fx.id], {
      env: {
        PATH: process.env.PATH, HOME: fx.dir, CW_ISSUES: fx.storePath, CW_NOW: '2026-08-02T00:00:00.000Z',
        CW_VERDICT_DIR: join(fx.dir, 'verdicts'), CW_CALIBRATE_BASELINE: join(fx.dir, 'baseline.json'), ...env,
      },
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => ok({ code, out, err }));
  });
}

test('attribution names the engine, the answering model and its host', () => {
  assert.deepEqual(attribution({ provider: 'anthropic', engine: 'anthropic', model: 'claude-x', host: 'h:1' }, 'asked'),
    { engine: 'anthropic', model: 'claude-x', host: 'h:1' });
  assert.deepEqual(attribution({ engine: 'lmstudio', model: null, host: 'h:2' }, 'asked'), { engine: 'lmstudio', model: 'asked', host: 'h:2' });
});

test('default: the local server answers and the record says lmstudio', async (t) => {
  const fx = fixture(t);
  const lm = await serve((req, res) => {
    if (req.url === '/v1/models') return json(res, 200, { data: [{ id: 'local-coder-27b' }] });
    json(res, 200, { model: 'local-coder-27b', choices: [{ finish_reason: 'stop', message: { content: 'VERDICT: false-positive\nCONFIDENCE: high' } }] });
  });
  t.after(lm.close);
  const r = await run(fx, { CW_LLM_URL_LMSTUDIO: lm.base });
  assert.equal(r.code, 0, r.err + r.out);
  const llm = loadIssues({ path: fx.storePath }).issues[fx.id].llm;
  assert.equal(llm.engine, 'lmstudio');
  assert.equal(llm.model, 'local-coder-27b');
  assert.equal(llm.host, new URL(lm.base).host);
  assert.equal(llm.verdict, 'false-positive');
  assert.equal(lm.seen.find((s) => s.url === '/v1/chat/completions').body.temperature, 0.2);
});

test('CW_MODEL_PROVIDER=anthropic: the API answers, the record says so, the key stays out of output', async (t) => {
  const fx = fixture(t);
  const key = fakeKey();
  const api = await serve((req, res) => json(res, 200, {
    type: 'message', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'VERDICT: real-vulnerability\nCONFIDENCE: medium' }],
  }));
  const lm = await serve((req, res) => json(res, 500, {}));
  t.after(() => { api.close(); lm.close(); });
  const r = await run(fx, { CW_MODEL_PROVIDER: 'anthropic', CW_MODEL_BASE_URL: api.base, CW_MODEL_API_KEY: key, CW_LLM_URL_LMSTUDIO: lm.base });
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /anthropic:claude-sonnet-5-5 @ 127\.0\.0\.1/);
  assert.equal((r.out + r.err).includes(key), false);
  const llm = loadIssues({ path: fx.storePath }).issues[fx.id].llm;
  assert.deepEqual({ engine: llm.engine, model: llm.model, host: llm.host, verdict: llm.verdict },
    { engine: 'anthropic', model: 'claude-sonnet-5-5', host: new URL(api.base).host, verdict: 'real-vulnerability' });
  assert.equal(api.seen[0].url, '/v1/messages');
  assert.equal(api.seen[0].headers['x-api-key'], key);
  assert.equal(lm.seen.length, 0, 'an API run never touches the local server');
});

test('an API failure is reported with its status and records nothing; no fallback to local', async (t) => {
  const fx = fixture(t);
  const api = await serve((req, res) => json(res, 500, { type: 'error', error: { type: 'api_error', message: 'internal' } }));
  const lm = await serve((req, res) => json(res, 200, { data: [{ id: 'm' }], choices: [{ message: { content: 'VERDICT: false-positive' } }] }));
  t.after(() => { api.close(); lm.close(); });
  const r = await run(fx, { CW_MODEL_PROVIDER: 'anthropic', CW_MODEL_BASE_URL: api.base, CW_MODEL_API_KEY: fakeKey(), CW_LLM_URL_LMSTUDIO: lm.base });
  assert.match(r.out, /FAILED: .*HTTP 500: internal/);
  assert.equal(loadIssues({ path: fx.storePath }).issues[fx.id].llm ?? null, null);
  assert.equal(lm.seen.length, 0);
});

test('a misconfigured provider exits 2 before any request', async (t) => {
  const fx = fixture(t);
  const r = await run(fx, { CW_MODEL_PROVIDER: 'anthropic' });
  assert.equal(r.code, 2);
  assert.match(r.err, /ANTHROPIC_API_KEY or CW_MODEL_API_KEY/);
});
