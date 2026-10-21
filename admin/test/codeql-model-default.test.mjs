// The CodeQL pipeline with a hosted local analyst that fixes its own sampling, against a really-spawned
// panel: the Messages API is a server on 127.0.0.1, claude -p is stubbed at CW_CODEQL_CLAUDE_CMD and
// the divergence store sits in a temp dir. Operator decision 2026-10-08: the analyst runs on such a
// model, and the job, its agreement and its divergence row each state the weaker basis.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request, createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { validateAgainstSchema } from '../../lib/json-schema.mjs';
import { readDimension } from '../../monitor/nondeterministic-store.mjs';
import { divergenceView } from '../routes/correlations.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-cqdefault-'));
const REPO = join(TMP, 'repos', 'alpha');
const STORE = join(TMP, 'nondet');
const FINDING = { service: 'alpha', lifecycle: 'active', sarif: 'codeql.sarif', ruleId: 'js/sampled', ruleName: 'js/sampled',
  severity: 'high', securitySeverity: 8.1, message: 'fixture finding', file: 'src/a.js', line: 4 };
const SUBJECT = [FINDING.service, FINDING.sarif, FINDING.ruleId, FINDING.file].join('|');
const jobErrors = (job) => validateAgainstSchema(job, { path: join(HERE, '..', '..', 'schema', 'codeql-remediation-job.schema.json') }).errors;

let localPort, child, hosted, savedStore;
const seen = [];

const freePort = () => new Promise((res, rej) => {
  const s = createNetServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const send = (method, path, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const req = request({ host: '127.0.0.1', port: localPort, path, method,
    headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } : headers }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* not json */ } resolve({ status: res.statusCode, body: buf, json }); });
  });
  req.on('error', reject);
  req.end(data);
});

before(async () => {
  savedStore = process.env.CW_NONDET_STORE;
  process.env.CW_NONDET_STORE = STORE;
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea', defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'alpha', path: REPO, manifest: 'security-baseline', area: 'fixarea' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
  }));
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });
  mkdirSync(join(REPO, 'src'), { recursive: true });
  writeFileSync(join(TMP, 'reports', 'fixarea', 'codeql-fleet.json'), JSON.stringify({
    generated: '2026-08-19T10:00:00.000Z', batch: 'sweep-20260819100000-fixarea', area: 'fixarea',
    coverage: { area: 'fixarea', scope: 'area', label: 'fixarea', basis: 'fixture' },
    scanned: 1, totals: { crit: 0, high: 1, med: 0, low: 0, total: 1 },
    perService: [{ service: 'alpha', lifecycle: 'active', crit: 0, high: 1, med: 0, low: 0, total: 1 }],
    findings: [FINDING],
  }));

  const claudeStub = join(TMP, 'claude-stub.mjs');
  writeFileSync(claudeStub, `
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const v = input.includes('agreesWithPeer')
    ? { classification: 'real', agreesWithPeer: true, positionChanged: false, response: 'same conclusion', remediation: 'validate the input', diff: '', confidence: 'high' }
    : { classification: 'real', investigation: 'input reaches the sink', falsePositiveAnalysis: 'no sanitiser; real', remediation: 'validate the input', diff: '', confidence: 'high' };
  process.stdout.write(JSON.stringify({ type: 'result', result: JSON.stringify(v) }));
});
`);

  hosted = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const j = JSON.parse(body);
      seen.push({ url: req.url, body: j });
      const cross = !!j.output_config?.format?.schema?.properties?.agreesWithPeer;
      const v = cross
        ? { classification: 'real', agreesWithPeer: true, positionChanged: false, response: 'same conclusion', remediation: 'validate the input', diff: '', confidence: 'medium' }
        : { classification: 'real', investigation: 'read the flow', falsePositiveAnalysis: 'weighed both sides', remediation: 'validate the input', diff: '', confidence: 'medium' };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ type: 'message', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(v) }] }));
    });
  });
  await new Promise((r) => hosted.listen(0, '127.0.0.1', r));

  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env,
      CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(await freePort()), CW_ADMIN_LOCAL_PORT: String(localPort),
      CW_LMSTUDIO_URL: 'http://127.0.0.1:9', CW_NONDET_STORE: STORE,
      CW_MODEL_PROVIDER: 'anthropic', CW_MODEL_BASE_URL: `http://127.0.0.1:${hosted.address().port}`,
      CW_MODEL_API_KEY: ['fixture', 'key', process.pid].join('-'), CW_MODEL_NAME: 'claude-opus-5-5',
      CW_CODEQL_CLAUDE_CMD: `"${process.execPath}" "${claudeStub}"` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 300 && !up; i++) { // boot is ~6-11s on a loaded box
    try { up = (await send('GET', '/api/csrf')).status === 200; } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, 'panel did not come up against the fixture registry');
});
after(() => {
  child?.kill('SIGKILL'); hosted?.close();
  if (savedStore === undefined) delete process.env.CW_NONDET_STORE; else process.env.CW_NONDET_STORE = savedStore;
  rmSync(TMP, { recursive: true, force: true });
});

test('the analyst runs on a model that fixes its own sampling, and the job states that basis', async () => {
  const csrf = (await send('GET', '/api/csrf')).json.token;
  const r = await send('POST', '/api/codeql/remediate', { project: 'fixarea', service: FINDING.service, ruleId: FINDING.ruleId, file: FINDING.file, sarif: FINDING.sarif }, { 'x-cw-csrf': csrf });
  assert.equal(r.status, 200, r.body);
  for (let i = 0; i < 150; i++) {
    const l = await send('GET', '/api/codeql/remediation?project=fixarea');
    const j = (l.json.jobs || []).find((x) => x.id === r.json.id);
    if (j && ['lodged', 'failed', 'stopped'].includes(j.state)) break;
    await new Promise((rr) => setTimeout(rr, 100));
  }
  const job = (await send('GET', `/api/codeql/remediation/job?project=fixarea&id=${r.json.id}`)).json.job;
  assert.equal(job.state, 'lodged', job.error);

  assert.equal(seen.length, 2, 'the hosted analyst answered both local stages');
  for (const s of seen) assert.equal('temperature' in s.body, false, 'no temperature reaches a model that fixes its own sampling');

  assert.equal(job.stages.local.sampling, 'model-default');
  assert.equal(job.stages.localCross.sampling, 'model-default');
  assert.equal('sampling' in job.stages.opus, false, 'claude -p reports no sampling, and none is invented');
  assert.match(job.agreement.basis, /local analyst ran at model-default sampling \(claude-opus-5-5 fixes its own; temperature not pinned\)/);
  assert.ok(job.events.some((e) => /local analysis: real .*model-default sampling, temperature not pinned/.test(e.msg)));
  assert.deepEqual(jobErrors(job), [], 'the job matches its frozen schema');

  const rows = readDimension('divergence').subjects.find((s) => s.subject === SUBJECT).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail.local.sampling, 'model-default', 'the divergence row carries the basis of its local side');
  const v = divergenceView().subjects.find((s) => s.subject === SUBJECT);
  assert.equal(v.latestModelDefault, true);
  assert.equal(v.modelDefaultSamples, 1);
});
