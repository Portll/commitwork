// Stage-1 divergence from the dual-agent CodeQL pipeline (admin/routes/codeql-remediation.mjs) into
// the nondeterministic store, against a really-spawned panel with both engines stubbed at their seams
// (CW_LMSTUDIO_URL, CW_CODEQL_CLAUDE_CMD) and the store in a temp dir (CW_NONDET_STORE). The rows
// are then read back through the correlations route the Divergence tab calls.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request, createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { validateAgainstSchema } from '../../lib/json-schema.mjs';
import { readDimension, record } from '../../monitor/nondeterministic-store.mjs';
import { WEIGHTS } from '../../monitor/divergence.mjs';
import { routes as correlationRoutes } from '../routes/correlations.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-cqdiv-'));
const REPO = join(TMP, 'repos', 'alpha');
const STORE = join(TMP, 'nondet');
const FLEET = join(TMP, 'reports', 'fixarea', 'codeql-fleet.json');
const jobErrors = (job) => validateAgainstSchema(job, { path: join(HERE, '..', '..', 'schema', 'codeql-remediation-job.schema.json') }).errors;

// The stubs answer by rule: js/opposed is a false positive to the local analyst at stage 1, and
// js/local-fails gets a reply that is not a verdict. Opus says real throughout, and both say real at
// cross-review, so cross-review agrees where stage 1 did not.
const finding = (ruleId, file, line) => ({ service: 'alpha', lifecycle: 'active', sarif: 'codeql.sarif',
  ruleId, ruleName: ruleId, severity: 'high', securitySeverity: 8.1, message: 'fixture finding', file, line });
const AGREE = finding('js/agree', 'src/a.js', 7);
const OPPOSED = finding('js/opposed', 'src/b.js', 9);
const LOCAL_FAILS = finding('js/local-fails', 'src/c.js', 3);
const STORE_REFUSES = finding('js/store-refuses', 'src/d.js', 5);
const KAPPA = finding('js/kappa', 'src/e.js', 2);
const subjectOf = (f) => [f.service, f.sarif, f.ruleId, f.file].join('|');
const writeFleet = (findings) => writeFileSync(FLEET, JSON.stringify({
  generated: '2026-08-19T10:00:00.000Z', batch: 'sweep-20260819100000-fixarea', area: 'fixarea',
  coverage: { area: 'fixarea', scope: 'area', label: 'fixarea', basis: 'fixture' },
  scanned: 1, totals: { crit: 0, high: findings.length, med: 0, low: 0, total: findings.length },
  perService: [{ service: 'alpha', lifecycle: 'active', crit: 0, high: findings.length, med: 0, low: 0, total: findings.length }],
  findings,
}));

let localPort, child, lmSrv, lmPort, savedStore;

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
let csrf = null;
const post = async (path, body) => {
  if (!csrf) csrf = (await send('GET', '/api/csrf')).json.token;
  return send('POST', path, body, { 'x-cw-csrf': csrf });
};

// Dispatch one finding and wait for the job to finish; the full job record is the result.
async function runJob(f) {
  const r = await post('/api/codeql/remediate', { project: 'fixarea', service: f.service, ruleId: f.ruleId, file: f.file, sarif: f.sarif });
  assert.equal(r.status, 200, r.body);
  for (let i = 0; i < 150; i++) {
    const l = await send('GET', '/api/codeql/remediation?project=fixarea');
    const j = (l.json.jobs || []).find((x) => x.id === r.json.id);
    if (j && ['lodged', 'failed', 'stopped'].includes(j.state)) break;
    await new Promise((rr) => setTimeout(rr, 100));
  }
  return (await send('GET', `/api/codeql/remediation/job?project=fixarea&id=${r.json.id}`)).json.job;
}
const rowsFor = (f) => (readDimension('divergence').subjects.find((s) => s.subject === subjectOf(f)) || { rows: [] }).rows;
const outcome = (job) => ({ state: job.state, error: job.error, agreement: job.agreement, remediation: job.remediation });

before(async () => {
  savedStore = process.env.CW_NONDET_STORE;
  process.env.CW_NONDET_STORE = STORE; // this process reads what the panel writes
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'alpha', path: REPO, manifest: 'security-baseline', area: 'fixarea' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
  }));
  mkdirSync(dirname(FLEET), { recursive: true });
  mkdirSync(join(REPO, 'src'), { recursive: true });
  writeFleet([AGREE, OPPOSED, LOCAL_FAILS, STORE_REFUSES]);

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

  lmPort = await freePort();
  lmSrv = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'qwen/qwen3.8-27b' }] }));
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.statusCode = 404; return res.end('{}'); }
      const j = JSON.parse(body);
      const prompt = j.messages.map((m) => m.content).join('\n');
      const cross = j.response_format.json_schema.name === 'codeql_remediation_cross';
      const v = cross
        ? { classification: 'real', agreesWithPeer: true, positionChanged: prompt.includes('js/opposed'), response: 'adopting the peer position', remediation: 'validate the input', diff: '', confidence: 'medium' }
        : prompt.includes('js/local-fails') ? { note: 'not a verdict' }
          : { classification: prompt.includes('js/opposed') ? 'false-positive' : 'real', investigation: 'read the flow', falsePositiveAnalysis: 'weighed both sides', remediation: 'validate the input', diff: '', confidence: 'medium' };
      return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(v) } }] }));
    });
  });
  await new Promise((r) => lmSrv.listen(lmPort, '127.0.0.1', r));

  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env,
      CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(await freePort()), CW_ADMIN_LOCAL_PORT: String(localPort),
      CW_LMSTUDIO_URL: `http://127.0.0.1:${lmPort}`, CW_NONDET_STORE: STORE,
      CW_MODEL_PROVIDER: '', CW_MODEL_BASE_URL: '', CW_MODEL_NAME: '',
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
  child?.kill('SIGKILL'); lmSrv?.close();
  if (savedStore === undefined) delete process.env.CW_NONDET_STORE; else process.env.CW_NONDET_STORE = savedStore;
  rmSync(TMP, { recursive: true, force: true });
});

test('agreeing stage-1 verdicts record one row, keyed without the line, scored 0', async () => {
  const job = await runJob(AGREE);
  assert.equal(job.state, 'lodged', job.error);
  const d = readDimension('divergence');
  assert.deepEqual(d.subjects.map((s) => s.subject), ['alpha|codeql.sarif|js/agree|src/a.js']);
  const rows = rowsFor(AGREE);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].score, 0);
  const det = rows[0].detail;
  assert.deepEqual(det.components, { perFinding: 0, verdictMismatch: 0, coveragePenalty: 0 });
  assert.equal(det.source, 'codeql-remediation');
  assert.equal(det.jobId, job.id);
  assert.equal(det.correlation, 'unmeasured', 'no lens correlation is measured for this pair');
  assert.equal(det.correlationApplied, 0);
  assert.match(det.correlationWhy, /0 finding\(s\) with a stage-1 pair .* below the minimum of 30/);
  assert.ok(job.events.some((e) => /lens correlation unmeasured/.test(e.msg)));
  assert.equal(det.local.classification, 'real');
  assert.equal(det.local.answeredBy.provider, 'local');
  assert.equal(det.local.answeredBy.model, 'qwen/qwen3.8-27b');
  assert.equal(det.opus.answeredBy, null, 'claude -p reports no answeredBy, and none is invented');
  assert.equal(det.local.sampling, 'pinned-0', 'the local side states the temperature that was sent');
  assert.equal('sampling' in det.opus, false);
  assert.deepEqual(det.opus.engine, { engine: 'claude-p', model: 'opus' });
  assert.ok(job.events.some((e) => /divergence of the independent analyses: 0\.00 recorded/.test(e.msg)));
  assert.deepEqual(jobErrors(job), [], 'the job still matches its frozen schema');
});

test('the same finding at a moved line is the same subject', async () => {
  writeFleet([{ ...AGREE, line: 41 }, OPPOSED, LOCAL_FAILS, STORE_REFUSES]);
  const job = await runJob({ ...AGREE, line: 41 });
  assert.equal(job.state, 'lodged', job.error);
  assert.equal(readDimension('divergence').subjects.length, 1);
  assert.equal(rowsFor(AGREE).length, 2, 'a moved line appends to the same subject, never starts another');
});

test('real vs false-positive at stage 1 scores opposed, although cross-review agreed', async () => {
  const job = await runJob(OPPOSED);
  assert.equal(job.state, 'lodged', job.error);
  assert.equal(job.agreement.agree, true, 'cross-review converged');
  assert.equal(job.stages.local.verdict.classification, 'false-positive');
  const rows = rowsFor(OPPOSED);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].detail.components, { perFinding: 1, verdictMismatch: 1, coveragePenalty: 0 });
  assert.equal(rows[0].score, Number((WEIGHTS.perFinding + WEIGHTS.verdictMismatch).toFixed(4)));
  assert.deepEqual([rows[0].detail.local.classification, rows[0].detail.opus.classification], ['false-positive', 'real']);
});

test('one side failing at stage 1 records nothing', async () => {
  const job = await runJob(LOCAL_FAILS);
  assert.equal(job.state, 'failed');
  assert.equal(job.stages.local.status, 'failed');
  assert.equal(job.stages.opus.status, 'done');
  assert.deepEqual(rowsFor(LOCAL_FAILS), []);
  assert.ok(!job.events.some((e) => /divergence/.test(e.msg)));
});

test('a refused store write leaves the job result unchanged and is narrated', async () => {
  const baseline = await runJob(STORE_REFUSES);
  assert.equal(baseline.state, 'lodged', baseline.error);
  assert.equal(rowsFor(STORE_REFUSES).length, 1);
  // the dimension directory becomes a file, so the store cannot write any divergence row
  const dim = join(STORE, 'divergence');
  renameSync(dim, `${dim}.held`);
  writeFileSync(dim, 'not a directory\n');
  let refused;
  try { refused = await runJob(STORE_REFUSES); }
  finally { rmSync(dim); renameSync(`${dim}.held`, dim); }
  assert.deepEqual(outcome(refused), outcome(baseline));
  for (const s of ['local', 'opus', 'localCross', 'opusCross']) assert.equal(refused.stages[s].status, 'done', s);
  assert.ok(refused.events.some((e) => /divergence NOT recorded — the store refused the write/.test(e.msg)));
  assert.equal(rowsFor(STORE_REFUSES).length, 1, 'the refused run wrote nothing');
  assert.deepEqual(jobErrors(refused), []);
});

test('the correlations route serves the rows the pipeline recorded', () => {
  const out = {};
  correlationRoutes.find((r) => r.path === '/api/correlations/divergence')
    .handle({ req: {}, adminSession: () => ({ user: 'tester' }), send: (code, body) => { out.code = code; out.body = body; } });
  assert.equal(out.code, 200);
  assert.equal(out.body.state, 'measured');
  const by = Object.fromEntries(out.body.subjects.map((s) => [s.subject, s]));
  assert.deepEqual(Object.keys(by).sort(), [AGREE, OPPOSED, STORE_REFUSES].map(subjectOf).sort());
  assert.equal(out.body.subjects[0].subject, subjectOf(OPPOSED), 'highest divergence first');
  assert.deepEqual(by[subjectOf(OPPOSED)].components, { perFinding: 1, verdictMismatch: 1, coveragePenalty: 0 });
  assert.equal(by[subjectOf(AGREE)].score, 0);
  assert.equal(by[subjectOf(AGREE)].samples, 2);
  assert.equal(by[subjectOf(AGREE)].modelDefaultSamples, 0, 'every sample here was pinned');
  assert.equal(by[subjectOf(AGREE)].latestModelDefault, false);
});

test('past stage-1 pairs of the same engine pair measure kappa, and it discounts the next row', async () => {
  // 30 seeded findings: 12 real/real, 3 real/fp, 3 fp/real, 12 fp/fp. With the three findings the
  // earlier tests recorded (two real/real, one fp/real) that is n 33, 26 agreeing; marginals 17/16
  // local and 18/15 opus give chance 546/1089, so kappa = (26*33 - 546) / (1089 - 546) = 0.5746.
  const side = (classification) => ({ classification, salvaged: false, answeredBy: { provider: 'local', engine: 'lmstudio', model: 'qwen/qwen3.8-27b', host: `127.0.0.1:${lmPort}` },
    engine: { engine: 'lmstudio', model: 'qwen/qwen3.8-27b', pinned: false, provider: 'local', host: `127.0.0.1:${lmPort}` }, sampling: 'pinned-0' });
  let i = 0;
  for (const [a, b, c] of [['real', 'real', 12], ['real', 'false-positive', 3], ['false-positive', 'real', 3], ['false-positive', 'false-positive', 12]]) {
    for (let j = 0; j < c; j++, i++) {
      record({ subject: `seed|codeql.sarif|js/seed-${i}|src/s${i}.js`, dimension: 'divergence', score: a === b ? 0 : 0.9,
        detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', jobId: '0000000000000000', local: side(a), opus: { classification: b, answeredBy: null, engine: { engine: 'claude-p', model: 'opus' } } } });
    }
  }
  writeFleet([AGREE, OPPOSED, LOCAL_FAILS, STORE_REFUSES, KAPPA]);
  const job = await runJob(KAPPA);
  assert.equal(job.state, 'lodged', job.error);
  const [r] = rowsFor(KAPPA);
  assert.deepEqual(r.detail.correlation, { method: 'kappa-upper-bound', n: 33, kappa: 0.5746, observed: 0.7879, chance: 0.5014,
    pair: 'local:qwen/qwen3.8-27b × claude-p:opus', sampling: 'pinned-0', minN: 30 });
  assert.equal(r.detail.correlationApplied, 0.5746);
  assert.equal(r.score, 0.5746, 'both said real: the agreement is discounted by the upper bound, 1 - (1 - 0) * (1 - 0.5746)');
  assert.ok(job.events.some((e) => /agreement discounted by kappa 0\.5746 over 33 past pairs/.test(e.msg)));
  assert.equal(job.stages.local.verdict.classification, 'real', 'the estimate changes the score, never a classification');
});
