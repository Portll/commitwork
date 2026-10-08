// The triage handoff — /api/llm/targets + POST /api/remediation/handoff: detection reports what is
// actually up; a local run sends manifest prompt (system) + scanner artifact (user) and writes
// evidence under reports/<area>/handoff/; claude launches via CW_HANDOFF_CMD; inputs are closed sets.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { hostsInProbeOrder, urlEnvVar } from '../../monitor/llm-hosts.mjs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http, { request } from 'node:http';
import { createServer } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const CW = join(HERE, '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-handoff-'));
const ARTIFACT_MARKER = 'ARTIFACT-MARKER-77';

// the SAVED schema every local run is bound to — read from disk so the test tracks schema edits
const SCHEMA = JSON.parse(readFileSync(join(CW, 'schema', 'triage-verdict.schema.json'), 'utf8'));
// a conforming verdict the fake engines answer with; `summary` carries the per-test marker
const VERDICT_JSON = (summary) => JSON.stringify({ verdict: 'all-false-positives', summary,
  findings: [{ id: 'src/a.js:5', classification: 'false-positive', reason: 'path string, entropy 3.5' }], caveats: [] });

// the prompt the route must serve — read from disk so the test tracks manifest edits
const MANIFEST_PROMPT = JSON.parse(readFileSync(join(CW, 'manifests', 'security-baseline.json'), 'utf8'))
  .checks.find((c) => c.id === 'secrets-gitleaks').remediationPrompt;
assert.ok(MANIFEST_PROMPT, 'secrets-gitleaks lost its remediationPrompt — the fixture premise changed');

let localPort, child, fakeLlamaCpp, llamaCppPort, fakeLmstudio, lmstudioPort, deadPort, postureFile;
const seen = { tags: 0, chat: [], lmchat: [] }; // what the fake engines were actually sent

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const hit = (path, { method = 'GET', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const h = { ...headers };
  if (body != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
  const req = request({ host: '127.0.0.1', port: localPort, path, method, headers: h }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, body: buf, json }); });
  });
  req.on('error', reject);
  if (body != null) req.write(body);
  req.end();
});
let csrf;
const post = async (path, payload) => hit(path, { method: 'POST', body: JSON.stringify(payload), headers: { 'x-cw-csrf': csrf } });

before(async () => {
  // fixture reports tree: a rolled batch (rollup.source) holding the artifact the handoff must find
  const batch = join(TMP, 'reports', 'sweep-20260802000000-fixarea');
  mkdirSync(join(batch, 'alpha'), { recursive: true });
  writeFileSync(join(batch, 'alpha', 'gitleaks.json'),
    JSON.stringify([{ RuleID: 'aws-key', File: 'src/a.js', StartLine: 5, note: ARTIFACT_MARKER }]));
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    defaultManifest: 'security-baseline', roots: [], projects: [],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
  }));
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });
  writeFileSync(join(TMP, 'reports', 'fixarea', 'rollup.json'), JSON.stringify({
    generated: '2026-08-02T00:00:00.000Z', source: batch, totals: { repos: 1 },
    scanners: { secrets: { crit: 0, high: 1, med: 0, low: 0, total: 1, repos: 1, ran: 1, skipped: 0, noscan: 0, check: 'secrets-gitleaks' } },
    repos: [{ name: 'alpha', scanners: { secrets: { total: 1 } } }],
  }));

  // fake llama.cpp — OpenAI-compatible, like every declared host since ollama was removed
  // (2026-08-27). It was the ollama stub speaking /api/tags + /api/chat; the model behaviours it
  // exercises are unchanged, only the protocol is, because there is only one protocol now.
  llamaCppPort = await freePort();
  fakeLlamaCpp = http.createServer((req, res) => {
    if (req.url === '/v1/models') { seen.tags++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fixmodel' }, { id: 'thinkmodel' }, { id: 'prosemodel' }] })); return; }
    if (req.url === '/v1/chat/completions') {
      let b = '';
      req.on('data', (d) => { b += d; });
      req.on('end', () => {
        const body = JSON.parse(b);
        seen.chat.push(body);
        res.setHeader('content-type', 'application/json');
        // fixmodel/thinkmodel honour the enforced schema; prosemodel defies it — the fail-honest path
        const content = body.model === 'thinkmodel' ? '<think>LLAMACPP-THINK-TRACE</think>' + VERDICT_JSON('TAGGED-ANSWER')
          : body.model === 'prosemodel' ? 'LOCAL-PROSE that ignores the schema entirely'
          : VERDICT_JSON('LOCAL-TRIAGE-REPLY');
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
      });
      return;
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => fakeLlamaCpp.listen(llamaCppPort, '127.0.0.1', r));

  // fake LM Studio: OpenAI-compatible, separates the thinking channel as reasoning_content
  lmstudioPort = await freePort();
  fakeLmstudio = http.createServer((req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fixreason' }, { id: 'leakymodel' }] })); return; }
    if (req.url === '/v1/chat/completions') {
      let b = '';
      req.on('data', (d) => { b += d; });
      req.on('end', () => {
        const body = JSON.parse(b);
        seen.lmchat.push(body);
        res.setHeader('content-type', 'application/json');
        // leakymodel: the entire output lands in the reasoning channel, content empty
        res.end(JSON.stringify({ choices: [{ message: body.model === 'leakymodel'
          ? { role: 'assistant', content: '', reasoning_content: 'Let me reason about this... ' + VERDICT_JSON('SALVAGED-ANSWER') }
          : { role: 'assistant', content: VERDICT_JSON('LM-FINAL-ANSWER'), reasoning_content: 'LM-THINK-TRACE' } }] }));
      });
      return;
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => fakeLmstudio.listen(lmstudioPort, '127.0.0.1', r));

  const port = await freePort();
  localPort = await freePort();
  deadPort = await freePort(); // bound then released — connecting refuses immediately
  postureFile = join(TMP, 'llm-runtime.json');
  writeFileSync(postureFile, JSON.stringify({
    enabled: true,
    hosts: { 'llama.cpp': { enabled: true, model: null }, lmstudio: { enabled: true, model: null } },
    roles: {},
  }));
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
      // Runners are OFF by default (security-first, 2026-08-27); this end-to-end suite opts in for
      // the two hosts it stubs. Written into the spawned server's env so the opt-in travels with
      // the process under test rather than leaking from the developer's machine.
      CW_LLM_RUNTIME: postureFile,
      // Per-host overrides from the declaration's own naming scheme. Every OTHER declared host is
      // pointed at a port nothing is listening on, so a host this test does not stub can never
      // reach a real server on the developer's machine — a hazard that arrived the moment the host
      // list grew past the two that used to be hardcoded here.
      ...Object.fromEntries(
        hostsInProbeOrder().map((h) => [urlEnvVar(h.id), `http://127.0.0.1:${deadPort}`])
      ),
      [urlEnvVar('llama.cpp')]: `http://127.0.0.1:${llamaCppPort}`,
      [urlEnvVar('lmstudio')]: `http://127.0.0.1:${lmstudioPort}`,
      CW_HANDOFF_CMD: '/usr/bin/true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { const r = await hit('/api/csrf'); if (r.status === 200) { csrf = r.json.token; up = true; } } catch { /* not yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, 'panel did not come up');
});
after(() => { child?.kill('SIGKILL'); fakeLlamaCpp?.close(); fakeLmstudio?.close(); rmSync(TMP, { recursive: true, force: true }); });

describe('detection — /api/llm/targets', () => {
  test('reports each live engine with its models, LM Studio FIRST — the preference order the UI defaults to', async () => {
    const r = await hit('/api/llm/targets');
    assert.equal(r.status, 200);
    // LM Studio stays FIRST — it heads probeOrder in the declaration because its port is
    // unshared, so a hit there is unambiguous. That is a different claim from being the DEFAULT,
    // which is llama.cpp; the two were conflated before manifests/llm-hosts.json existed.
    assert.equal(r.json.engines[0].name, 'lmstudio', 'LM Studio heads the declared probe order');
    const byName = Object.fromEntries(r.json.engines.map((e) => [e.name, e]));
    assert.equal(byName['llama.cpp'].up, true);
    assert.deepEqual(byName['llama.cpp'].models, ['fixmodel', 'thinkmodel', 'prosemodel']);
    assert.equal(byName.lmstudio.up, true);
    assert.deepEqual(byName.lmstudio.models, ['fixreason', 'leakymodel']);
    // NOTE: `identified` is true here and that is correct — this test gives every host its own
    // override URL, so nothing shares an endpoint. The shared-port collapse is asserted in
    // admin/test/llm-targets-autoregister.test.mjs, where the URLs are made to coincide.
  });
});

describe('local run — prompt + artifact over the wire, evidence on disk', () => {
  test('the model receives the manifest prompt as system and the artifact as user content', async () => {
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'llama.cpp', model: 'fixmodel' });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.verdict.verdict, 'all-false-positives', 'the machine-readable verdict is the answer now');
    assert.equal(r.json.verdict.summary, 'LOCAL-TRIAGE-REPLY');
    assert.equal(r.json.verdictError, null);
    assert.equal(r.json.thinking, null, 'a model with no thinking channel yields null — the UI renders no block, never an empty one');
    assert.equal(r.json.sent.system, MANIFEST_PROMPT, 'the prompt AS SENT is echoed for the panel to display');
    assert.ok(r.json.sent.user.includes(ARTIFACT_MARKER), 'so is the artifact half');
    assert.ok(r.json.sent.user.includes('triage-verdict schema'), 'the structured-output instruction is stated in the prompt, not only enforced');
    assert.equal(seen.chat.length, 1, 'exactly one chat call must have crossed the wire');
    const sent = seen.chat[0];
    assert.equal(sent.model, 'fixmodel');
    // The SAVED schema crosses the wire as engine-side enforcement — never a paraphrase of it.
    // One dialect now: this used to assert ollama's `format` key here and OpenAI's
    // `response_format` further down, which is precisely the duplication that removing the second
    // protocol removed.
    const rf0 = sent.response_format;
    assert.equal(rf0 && rf0.type, 'json_schema');
    assert.equal(rf0.json_schema.strict, true);
    assert.deepEqual(rf0.json_schema.schema, SCHEMA, 'the host must receive schema/triage-verdict.schema.json verbatim');
    // A PROTECTION WAS LOST HERE AND IS RECORDED RATHER THAN DELETED QUIETLY.
    //
    // These two lines used to assert `options.num_ctx = 16384` and `keep_alive = '5m'` — ollama
    // request fields that pinned the KV cache (a GGUF-declared context can size one that pages the
    // machine) and bounded how long a loaded model squatted. The OpenAI API has neither field:
    // llama.cpp sets context with `-c` at server start and vLLM with --max-model-len, so the knob
    // moved from per-request enforcement to the operator's launch flags. We cannot assert it any
    // more because we no longer send it, and pretending otherwise by asserting a field the server
    // ignores would be worse than saying so. See the `contextNote` on the declaration.
    assert.equal(sent.options, undefined, 'no ollama-shaped options are sent to an OpenAI host');
    assert.equal(sent.messages[0].role, 'system');
    assert.equal(sent.messages[0].content, MANIFEST_PROMPT, 'the system message IS the manifest prompt, verbatim');
    assert.ok(sent.messages[1].content.includes(ARTIFACT_MARKER), 'the scanner artifact must reach the model');
    assert.ok(sent.messages[1].content.includes('gitleaks.json'), 'named, so the model knows what it is reading');
    // the manifest's FORMAT FACTS must travel with the artifact — models confabulate syntax otherwise
    assert.ok(sent.messages[1].content.includes('FORMAT FACTS'), 'the scanner\'s format mechanics must travel with the handoff');
    assert.ok(sent.messages[1].content.includes('Fingerprint field'), 'and must name the Fingerprint field as the literal ignore line');
  });

  test('the exchange is written under reports/<area>/handoff/ — evidence .md AND machine-readable .verdict.json', async () => {
    const dir = join(TMP, 'reports', 'fixarea', 'handoff');
    const mds = readdirSync(dir).filter((f) => f.startsWith('secrets-gitleaks-llama-cpp-') && f.endsWith('.md'));
    assert.equal(mds.length, 1, 'one local run, one evidence file');
    const text = readFileSync(join(dir, mds[0]), 'utf8');
    assert.ok(text.includes('LOCAL-TRIAGE-REPLY'), 'the reply is the evidence');
    assert.ok(text.includes(MANIFEST_PROMPT.slice(0, 60)), 'alongside what was asked');
    const vjs = readdirSync(dir).filter((f) => f.startsWith('secrets-gitleaks-llama-cpp-') && f.endsWith('.verdict.json'));
    assert.equal(vjs.length, 1, 'the machine-readable verdict file must land beside the evidence');
    const v = JSON.parse(readFileSync(join(dir, vjs[0]), 'utf8'));
    assert.equal(v.schema, 'commitwork/triage-verdict.v1', 'the verdict names the schema it conforms to');
    assert.equal(v.verdict.summary, 'LOCAL-TRIAGE-REPLY');
    assert.equal(v.check, 'secrets-gitleaks');
    assert.equal(v.engine, 'llama.cpp');
  });
});

describe('thinking models — the reasoning channel is separated, wherever the engine puts it', () => {
  test('LM Studio: reasoning_content becomes `thinking`, the answer stays clean', async () => {
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'lmstudio', model: 'fixreason' });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.thinking, 'LM-THINK-TRACE');
    assert.equal(r.json.verdict.summary, 'LM-FINAL-ANSWER');
    assert.equal(seen.lmchat[0].messages[0].content, MANIFEST_PROMPT, 'LM Studio gets the same composition ollama does');
    assert.ok(seen.lmchat[0].messages[1].content.includes(ARTIFACT_MARKER));
    // the same SAVED schema, in LM Studio's dialect — enforced, named, strict
    const rf = seen.lmchat[0].response_format;
    assert.equal(rf && rf.type, 'json_schema');
    assert.equal(rf.json_schema.name, 'triage_verdict');
    assert.equal(rf.json_schema.strict, true);
    assert.deepEqual(rf.json_schema.schema, SCHEMA, 'LM Studio must receive schema/triage-verdict.schema.json verbatim');
  });

  test('llama.cpp: inline <think> tags are split out — the answer never renders wrapped in its own scratchpad', async () => {
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'llama.cpp', model: 'thinkmodel' });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.thinking, 'LLAMACPP-THINK-TRACE');
    assert.equal(r.json.verdict.summary, 'TAGGED-ANSWER', 'the verdict parses from what remains after the think tags');
  });

  test('a verdict trapped in the reasoning channel is SALVAGED and marked — never lost, never passed off as clean', async () => {
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'lmstudio', model: 'leakymodel' });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.verdict.summary, 'SALVAGED-ANSWER', 'the verdict must be recovered from the thinking tail');
    assert.equal(r.json.verdictSalvaged, true, 'and marked salvaged — the operator must know enforcement misrouted');
    assert.equal(r.json.verdictError, null);
    const dir = join(TMP, 'reports', 'fixarea', 'handoff');
    const vjs = readdirSync(dir).filter((f) => f.startsWith('secrets-gitleaks-lmstudio-') && f.endsWith('.verdict.json'));
    const salvaged = vjs.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).filter((v) => v.verdictSalvaged);
    assert.equal(salvaged.length, 1, 'the verdict file records the salvage');
  });

  test('the evidence file carries the thinking alongside the reply — how the model got there is auditable', async () => {
    const dir = join(TMP, 'reports', 'fixarea', 'handoff');
    const lm = readdirSync(dir).filter((f) => f.startsWith('secrets-gitleaks-lmstudio-') && f.endsWith('.md'));
    const text = lm.map((f) => readFileSync(join(dir, f), 'utf8')).find((t) => t.includes('LM-FINAL-ANSWER'));
    assert.ok(text, 'the fixreason run\'s evidence file must exist');
    assert.ok(text.includes('## Model thinking'));
    assert.ok(text.includes('LM-THINK-TRACE'));
    assert.ok(text.includes('LM-FINAL-ANSWER'));
  });

  test('a model that defies enforcement fails HONEST: verdictError stated, raw preserved, no verdict file', async () => {
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'llama.cpp', model: 'prosemodel' });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.ok, true, 'the run HAPPENED — only the structured half failed');
    assert.equal(r.json.verdict, null);
    assert.match(r.json.verdictError, /not a triage verdict/);
    assert.equal(r.json.reply, 'LOCAL-PROSE that ignores the schema entirely', 'the raw reply survives for the operator');
    const dir = join(TMP, 'reports', 'fixarea', 'handoff');
    const mds = readdirSync(dir).filter((f) => f.startsWith('secrets-gitleaks-llama-cpp-') && f.endsWith('.md'));
    const noVerdict = mds.map((f) => readFileSync(join(dir, f), 'utf8')).filter((t) => t.includes('No verdict file'));
    assert.equal(noVerdict.length, 1, 'the evidence .md states that no verdict file exists, and why');
  });
});

describe('claude engine — a composed handoff, launched through the seam', () => {
  test('launches via CW_HANDOFF_CMD and the handoff file carries prompt, artifact path and counts', async () => {
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'claude' });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.started, true);
    assert.equal(r.json.via, 'CW_HANDOFF_CMD', 'the seam must win over Terminal/VS Code launching');
    assert.ok(existsSync(r.json.file), 'the handoff file must exist');
    const text = readFileSync(r.json.file, 'utf8');
    assert.ok(text.includes(MANIFEST_PROMPT), 'the prompt travels whole');
    assert.ok(text.includes(join('alpha', 'gitleaks.json')), 'the artifact is named by PATH — the agent reads files itself');
    assert.ok(text.includes('"total":1'), 'the live counts travel too');
  });
});

describe('refusals — closed sets, stated reasons', () => {
  test('an unknown check is refused', async () => {
    const r = await post('/api/remediation/handoff', { check: '../../etc/passwd', project: 'fixarea', engine: 'claude' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /unknown check/);
  });
  test('an unknown engine is refused', async () => {
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'evil' });
    assert.equal(r.status, 400);
  });
  test('a local run without a model is refused, pointing at the detection route', async () => {
    const r = await post('/api/remediation/handoff', { check: 'secrets-gitleaks', project: 'fixarea', engine: 'llama.cpp' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /model/);
  });
  test('a POST without the CSRF header is refused before any of this runs', async () => {
    const r = await hit('/api/remediation/handoff', { method: 'POST', body: JSON.stringify({ check: 'secrets-gitleaks', engine: 'claude' }) });
    assert.equal(r.status, 403);
  });
});
