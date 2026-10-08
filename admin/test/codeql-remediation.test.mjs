// The dual-agent CodeQL remediation pipeline (admin/routes/codeql-remediation.mjs) and the
// /codeql/ path route, against a really-spawned panel with every engine stubbed at its declared
// seam (CW_LMSTUDIO_URL, CW_CODEQL_CLAUDE_CMD, CW_SWEEP_CMD); apply is verified out of git itself.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-cqremed-'));
const REPO = join(TMP, 'repos', 'alpha');
const DIFF_FILE = join(TMP, 'lodged.patch');
const RESWEEP_MARKER = join(TMP, 'resweep-marker.json');
const RESTART_MARKER = join(TMP, 'restart-marker.json');
const DELAY_FILE = join(TMP, 'claude-delay.txt'); // stub sleep in ms, mutable mid-suite — the stop test needs a stage it can catch running

// the finding under remediation — identity is service|sarif|ruleId|file; line is context only
const FINDING = { service: 'alpha', lifecycle: 'active', sarif: 'codeql.sarif',
  ruleId: 'js/code-injection', ruleName: 'Code injection', severity: 'crit', securitySeverity: 9.3,
  message: 'User-controlled data is evaluated as code.', file: 'src/app.js', line: 2 };
// a second identity in the same file — the lane-concurrency test dispatches both at once
const FINDING2 = { service: 'alpha', lifecycle: 'active', sarif: 'codeql.sarif',
  ruleId: 'js/request-forgery', ruleName: 'Request forgery', severity: 'high', securitySeverity: 9.1,
  message: 'The URL of this request depends on a user-provided value.', file: 'src/app.js', line: 2 };

const APP_BEFORE = 'function handle(input){\n  return eval(input);\n}\n';
const PATCH = [
  'diff --git a/src/app.js b/src/app.js',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -1,3 +1,3 @@',
  ' function handle(input){',
  '-  return eval(input);',
  '+  return JSON.parse(input);',
  ' }',
  '',
].join('\n');

let localPort, child, lmSrv;

const freePort = () => new Promise((res, rej) => {
  const s = createNetServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const hit = (path) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: localPort, path, method: 'GET' }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, body: buf, json }); });
  });
  req.on('error', reject);
  req.end();
});
let csrf = null;
const post = async (path, body) => {
  if (!csrf) csrf = (await hit('/api/csrf')).json.token;
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request({ host: '127.0.0.1', port: localPort, path, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-cw-csrf': csrf } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* not json */ } resolve({ status: res.statusCode, body: buf, json }); });
    });
    req.on('error', reject);
    req.end(data);
  });
};
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });

before(async () => {
  // fixture registry + reports tree
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'alpha', path: REPO, manifest: 'security-baseline', area: 'fixarea' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
  }));
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });
  writeFileSync(join(TMP, 'reports', 'fixarea', 'codeql-fleet.json'), JSON.stringify({
    generated: '2026-08-19T10:00:00.000Z', batch: 'sweep-20260819100000-fixarea', area: 'fixarea',
    coverage: { area: 'fixarea', scope: 'area', label: 'fixarea', basis: 'fixture' },
    scanned: 1, totals: { crit: 1, high: 1, med: 0, low: 0, total: 2 },
    perService: [{ service: 'alpha', lifecycle: 'active', crit: 1, high: 1, med: 0, low: 0, total: 2 }],
    findings: [FINDING, FINDING2],
  }));

  // the target repo — a real git repo, hooks and signing neutralised so the fixture is hermetic
  mkdirSync(join(REPO, 'src'), { recursive: true });
  writeFileSync(join(REPO, 'src', 'app.js'), APP_BEFORE);
  execFileSync('git', ['init', '-q', REPO]);
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', join(REPO, '.git', 'no-hooks'));
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture: vulnerable app');

  writeFileSync(DIFF_FILE, PATCH);

  // claude -p stub: tells cross from analysis by the prompt's field list, answers in the json wrapper
  writeFileSync(DELAY_FILE, '0');
  const claudeStub = join(TMP, 'claude-stub.mjs');
  writeFileSync(claudeStub, `
import { readFileSync } from 'node:fs';
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let delay = 0;
  try { delay = Number(readFileSync(process.env.CW_TEST_DELAY_FILE, 'utf8').trim()) || 0; } catch { /* no delay */ }
  setTimeout(() => {
    const cross = input.includes('agreesWithPeer');
    const diff = readFileSync(process.env.CW_TEST_DIFF_FILE, 'utf8');
    const v = cross
      ? { classification: 'real', agreesWithPeer: true, positionChanged: false, response: 'the local agent reached the same conclusion', remediation: 'replace eval with JSON.parse', diff, confidence: 'high' }
      : { classification: 'real', investigation: 'request input reaches eval', falsePositiveAnalysis: 'no sanitiser on the path; real', remediation: 'replace eval with JSON.parse', diff, confidence: 'high' };
    process.stdout.write(JSON.stringify({ type: 'result', result: JSON.stringify(v) }));
  }, delay);
});
`);
  // resweep stub: the evidence that apply really triggered a sweep
  const sweepStub = join(TMP, 'sweep-stub.mjs');
  writeFileSync(sweepStub, `
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.CW_TEST_RESWEEP_MARKER, JSON.stringify({ argv: process.argv.slice(2), at: new Date().toISOString() }));
`);
  // restart stub: the successor seam — proves the handoff spawned without booting a real panel
  const restartStub = join(TMP, 'restart-stub.mjs');
  writeFileSync(restartStub, `
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.CW_TEST_RESTART_MARKER, JSON.stringify({ at: new Date().toISOString() }));
`);

  // LM Studio stub — returns real-but-diffless verdicts, so the lodged diff must come from opus
  const lmPort = await freePort();
  lmSrv = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/v1/models') {
        return res.end(JSON.stringify({ data: [{ id: 'text-embedding-nomic-v1.5' }, { id: 'qwen/qwen3.8-27b' }] }));
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        let j = null; try { j = JSON.parse(body); } catch { /* fall through */ }
        const cross = !!(j && j.response_format && j.response_format.json_schema && j.response_format.json_schema.name === 'codeql_remediation_cross');
        const v = cross
          ? { classification: 'real', agreesWithPeer: true, positionChanged: false, response: 'opus verdict matches mine', remediation: 'replace eval with JSON.parse', diff: '', confidence: 'medium' }
          : { classification: 'real', investigation: 'eval of user-controlled input', falsePositiveAnalysis: 'no evidence of sanitisation; real', remediation: 'use JSON.parse instead of eval', diff: '', confidence: 'medium' };
        return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(v) } }] }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => lmSrv.listen(lmPort, '127.0.0.1', r));

  const port = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env,
      CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
      CW_LMSTUDIO_URL: `http://127.0.0.1:${lmPort}`,
      CW_CODEQL_CLAUDE_CMD: `"${process.execPath}" "${join(TMP, 'claude-stub.mjs')}"`,
      CW_SWEEP_CMD: `"${process.execPath}" "${join(TMP, 'sweep-stub.mjs')}"`,
      CW_PANEL_RESTART_EXEC: `"${process.execPath}" "${join(TMP, 'restart-stub.mjs')}"`,
      CW_TEST_DIFF_FILE: DIFF_FILE, CW_TEST_RESWEEP_MARKER: RESWEEP_MARKER, CW_TEST_RESTART_MARKER: RESTART_MARKER,
      CW_TEST_DELAY_FILE: DELAY_FILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await hit('/api/csrf')).status === 200; } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, 'panel did not come up against the fixture registry');
});
after(() => { child?.kill('SIGKILL'); lmSrv?.close(); rmSync(TMP, { recursive: true, force: true }); });

test('/codeql/ is a path route to the panel — same document, real URL', async () => {
  for (const p of ['/codeql/', '/codeql']) {
    const r = await hit(p);
    assert.equal(r.status, 200, `${p} must serve the panel`);
    assert.ok(r.body.includes('id="view-codeql"'), `${p} must serve the panel document (view-codeql present)`);
  }
});

test('an empty job store lists as ok:true, jobs:[] — legitimately absent, not an error', async () => {
  const r = await hit('/api/codeql/remediation?project=fixarea');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, jobs: [] });
});

test('a finding not in codeql-fleet.json is refused — the request selects, it never supplies', async () => {
  const r = await post('/api/codeql/remediate', { project: 'fixarea', service: 'alpha', ruleId: 'js/made-up', file: 'src/app.js', sarif: 'codeql.sarif' });
  assert.equal(r.status, 404);
  assert.equal(r.json.ok, false);
});

test('the pipeline runs both agents, cross-reviews, and lodges the opus diff with agreement', async () => {
  const r = await post('/api/codeql/remediate', { project: 'fixarea', service: FINDING.service, ruleId: FINDING.ruleId, file: FINDING.file, sarif: FINDING.sarif });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.ok, true);
  assert.match(r.json.id, /^[a-f0-9]{16}$/);
  assert.equal(r.json.engines.local.model, 'qwen/qwen3.8-27b', 'the resolver must pick the qwen3.8 id and skip the embedding model');

  let job = null;
  for (let i = 0; i < 100; i++) {
    const l = await hit('/api/codeql/remediation?project=fixarea');
    job = (l.json.jobs || []).find((j) => j.id === r.json.id) || null;
    if (job && ['lodged', 'failed'].includes(job.state)) break;
    await new Promise((rr) => setTimeout(rr, 100));
  }
  assert.ok(job, 'the job must appear in the list');
  assert.equal(job.state, 'lodged', `pipeline must lodge, got ${job.state}: ${job.error}`);
  assert.equal(job.agreement.agree, true);
  assert.equal(job.executable, true);
  // the list summary carries each stage's structured heart — what the console popout streams
  assert.equal(job.stages.opus.status, 'done');
  assert.equal(job.stages.opus.classification, 'real');
  assert.equal(job.stages.opus.diff, true, 'the opus stage offered a diff');
  assert.equal(job.stages.localCross.classification, 'real');
  assert.ok(Array.isArray(job.events) && job.events.length > 0, 'the list summary must tail the event narration');

  const d = await hit(`/api/codeql/remediation/job?project=fixarea&id=${r.json.id}`);
  assert.equal(d.status, 200);
  const full = d.json.job;
  for (const s of ['local', 'opus', 'localCross', 'opusCross']) {
    assert.equal(full.stages[s].status, 'done', `stage ${s} must complete`);
    assert.ok(full.stages[s].verdict, `stage ${s} must carry its verdict`);
  }
  assert.equal(full.remediation.source, 'opus-cross', 'the local agent lodged no diff, so the executable diff must be the opus one');
  assert.equal(full.remediation.diff, PATCH);
  assert.equal(full.stages.opusCross.verdict.agreesWithPeer, true);
  // identity discipline: the key must not contain the line number
  assert.equal(full.key, 'alpha|codeql.sarif|js/code-injection|src/app.js');
  // the job narrates itself — start, engines, four stage results, agreement, lodge
  assert.ok(Array.isArray(full.events) && full.events.length >= 8, `expected a full event trail, got ${(full.events || []).length}`);
  assert.ok(full.events.some((e) => /agreement: AGREED/.test(e.msg)), 'the agreement must be narrated');
  assert.ok(full.events.some((e) => /lodged with an executable diff \(opus-cross\)/.test(e.msg)), 'the lodge must be narrated with its diff source');
});

test('▶ apply: git-applies the lodged diff, commits ONLY its files without trailers, and resweeps', async () => {
  const list = await hit('/api/codeql/remediation?project=fixarea');
  const job = (list.json.jobs || []).find((j) => j.state === 'lodged');
  assert.ok(job, 'a lodged job must exist from the previous test');

  // a bystander file another session might have staged — the pathspec commit must not take it
  writeFileSync(join(REPO, 'bystander.txt'), 'not part of the remediation\n');
  git('add', 'bystander.txt');

  const r = await post('/api/codeql/remediate/apply', { project: 'fixarea', id: job.id });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.files, ['src/app.js']);
  assert.equal(r.json.resweep.started, true, 'apply must start the targeted resweep');

  assert.equal(readFileSync(join(REPO, 'src', 'app.js'), 'utf8'), APP_BEFORE.replace('eval', 'JSON.parse'));
  const show = git('show', '--stat', '--format=%B', 'HEAD');
  assert.match(show, /codeql remediation: js\/code-injection in src\/app\.js/);
  assert.match(show, /agents in agreement/);
  assert.ok(!/Co-Authored-By/i.test(show), 'the commit must carry no attribution trailer');
  assert.ok(show.includes('src/app.js') && !show.includes('bystander.txt'), 'the commit must contain only the diff\'s own files');

  for (let i = 0; i < 50 && !existsSync(RESWEEP_MARKER); i++) await new Promise((rr) => setTimeout(rr, 100));
  assert.ok(existsSync(RESWEEP_MARKER), 'the resweep stub must actually have been spawned');

  const again = await post('/api/codeql/remediate/apply', { project: 'fixarea', id: job.id });
  assert.equal(again.status, 409, 'a second apply must be refused as already applied');
});

test('clear removes finished records (patch evidence too) and refuses unknown ids', async () => {
  const bad = await post('/api/codeql/remediation/clear', { project: 'fixarea', id: 'deadbeefdeadbeef' });
  assert.equal(bad.status, 404, 'clearing a job that does not exist must say so');
  const r = await post('/api/codeql/remediation/clear', { project: 'fixarea' });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.cleared, 1, 'the applied job from the previous test must be cleared');
  const l = await hit('/api/codeql/remediation?project=fixarea');
  assert.deepEqual(l.json, { ok: true, jobs: [] }, 'the store must be empty after clear');
});

test('two findings dispatched together both advance through the engine lanes and lodge', async () => {
  const r1 = await post('/api/codeql/remediate', { project: 'fixarea', service: FINDING.service, ruleId: FINDING.ruleId, file: FINDING.file, sarif: FINDING.sarif });
  const r2 = await post('/api/codeql/remediate', { project: 'fixarea', service: FINDING2.service, ruleId: FINDING2.ruleId, file: FINDING2.file, sarif: FINDING2.sarif });
  assert.equal(r1.status, 200, r1.body);
  assert.equal(r2.status, 200, 'the second dispatch must be accepted immediately — jobs queue on lanes, not behind each other');
  assert.notEqual(r1.json.id, r2.json.id);
  let jobs = [];
  for (let i = 0; i < 100; i++) {
    jobs = (await hit('/api/codeql/remediation?project=fixarea')).json.jobs || [];
    if (jobs.length >= 2 && jobs.every((j) => ['lodged', 'failed'].includes(j.state))) break;
    await new Promise((rr) => setTimeout(rr, 100));
  }
  assert.equal(jobs.length, 2);
  for (const j of jobs) assert.equal(j.state, 'lodged', `${j.finding && j.finding.ruleId}: ${j.error || ''}`);
});

test('■ stop: waiting stages never start, the running claude child dies, the job records stopped — and retry recovers', async () => {
  writeFileSync(DELAY_FILE, '8000'); // the opus stub sleeps, so there is a running stage to catch
  const r = await post('/api/codeql/remediate', { project: 'fixarea', service: FINDING.service, ruleId: FINDING.ruleId, file: FINDING.file, sarif: FINDING.sarif });
  assert.equal(r.status, 200, r.body);
  let running = false;
  for (let i = 0; i < 50 && !running; i++) {
    const l = await hit('/api/codeql/remediation?project=fixarea');
    const j = (l.json.jobs || []).find((x) => x.id === r.json.id);
    running = !!(j && j.stages.opus && j.stages.opus.status === 'running');
    if (!running) await new Promise((rr) => setTimeout(rr, 100));
  }
  assert.ok(running, 'the opus stage must be running against the delayed stub before the stop');
  const s = await post('/api/codeql/remediate/stop', { project: 'fixarea', id: r.json.id });
  assert.equal(s.status, 200, s.body);
  assert.equal(s.json.stopping, true);
  let job = null;
  for (let i = 0; i < 60; i++) {
    const l = await hit('/api/codeql/remediation?project=fixarea');
    job = (l.json.jobs || []).find((x) => x.id === r.json.id) || null;
    if (job && job.state === 'stopped') break;
    await new Promise((rr) => setTimeout(rr, 100));
  }
  assert.equal(job && job.state, 'stopped', `job must record stopped, got ${job && job.state}: ${job && job.error}`);
  const d = await hit(`/api/codeql/remediation/job?project=fixarea&id=${r.json.id}`);
  assert.equal(d.json.job.state, 'stopped');
  assert.equal(d.json.job.remediation, null, 'a stopped run publishes NO remediation');
  assert.equal(d.json.job.stages.local.status, 'done', 'the finished local stage keeps its verdict as evidence');
  assert.equal(d.json.job.stages.opus.status, 'stopped');
  assert.ok((d.json.job.events || []).some((e) => /STOPPED by operator/.test(e.msg)), 'the stop must be narrated');
  // a second stop finds nothing running and says so
  const s2 = await post('/api/codeql/remediate/stop', { project: 'fixarea', id: r.json.id });
  assert.equal(s2.status, 409);
  // retry recovers: same identity, fresh run, lodges
  writeFileSync(DELAY_FILE, '0');
  const r2 = await post('/api/codeql/remediate', { project: 'fixarea', service: FINDING.service, ruleId: FINDING.ruleId, file: FINDING.file, sarif: FINDING.sarif });
  assert.equal(r2.status, 200, 'a stopped job must be re-dispatchable');
  let relodged = null;
  for (let i = 0; i < 100; i++) {
    const l = await hit('/api/codeql/remediation?project=fixarea');
    relodged = (l.json.jobs || []).find((x) => x.id === r2.json.id) || null;
    if (relodged && ['lodged', 'failed'].includes(relodged.state)) break;
    await new Promise((rr) => setTimeout(rr, 100));
  }
  assert.equal(relodged && relodged.state, 'lodged', `retry must lodge, got ${relodged && relodged.state}: ${relodged && relodged.error}`);
});

test('panel health: a touched file is NOT stale, a CHANGED one is, and it is named', async () => {
  // This asserted the opposite until 2026-09-02: it bumped mtime with utimesSync and required
  // stale=true. That encoded the defect rather than the requirement — mtime answers "was this
  // written", not "is this different", and on a tree ~28 sessions share, git checkout, a rebase and
  // a peer saving without editing all bump it. Measured against a five-hour-old panel at the time:
  // 8 of 32 watched files had newer mtimes and half of those checked were byte-identical to HEAD.
  // The stamp is sha256 of content now, so both directions are asserted here and the mtime case is
  // the one that would silently come back.
  const r = await hit('/api/panel/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.pid > 0 && r.json.uptimeSecs >= 0);
  assert.equal(r.json.code.stale, false, 'a freshly booted panel must not read stale');
  assert.equal(r.json.code.basis, 'sha256-content',
    'the verdict must declare what it is based on — an mtime answer wearing this name is the regression');

  const target = join(HERE, '..', 'rp-origin.mjs');
  const st = statSync(target);
  const original = readFileSync(target);

  // (1) mtime moves, content does not. This MUST read current.
  utimesSync(target, st.atime, new Date());
  try {
    const r2 = await hit('/api/panel/health');
    assert.equal(r2.json.code.stale, false,
      `a touched but unchanged file must NOT read stale — got changed=${JSON.stringify(r2.json.code.changed)}`);
  } finally { utimesSync(target, st.atime, st.mtime); }

  // (2) content actually changes. This MUST read stale, and name the file.
  try {
    writeFileSync(target, Buffer.concat([original, Buffer.from('\n// canary: content changed\n')]));
    const r3 = await hit('/api/panel/health');
    assert.equal(r3.json.code.stale, true, 'a genuinely changed watched file must read stale');
    assert.ok(r3.json.code.changed.includes('rp-origin.mjs'),
      `changed must name the file, got ${JSON.stringify(r3.json.code.changed)}`);
  } finally {
    // restore bytes AND mtime — this runs against the operator's real tree, and leaving either
    // altered would hand the next reader a panel that reads stale for a reason this test invented
    writeFileSync(target, original);
    utimesSync(target, st.atime, st.mtime);
  }
  const r4 = await hit('/api/panel/health');
  assert.equal(r4.json.code.stale, false, 'restored content must read current again');
});

// LAST TEST, deliberately: a successful restart exits the panel under test.
test('panel restart: answers, spawns the successor seam, and the old pid exits', async () => {
  const r = await post('/api/panel/restart', {});
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.restarting, true);
  const exited = child.exitCode !== null || await new Promise((res) => {
    const t = setTimeout(() => res(false), 8000);
    child.once('exit', () => { clearTimeout(t); res(true); });
  });
  assert.ok(exited, 'the old process must exit after handing the ports off');
  for (let i = 0; i < 50 && !existsSync(RESTART_MARKER); i++) await new Promise((rr) => setTimeout(rr, 100));
  assert.ok(existsSync(RESTART_MARKER), 'the successor exec seam must have been spawned');
});
