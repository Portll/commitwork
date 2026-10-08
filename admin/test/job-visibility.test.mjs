// Who sees which job (operator ruling 2026-09-29). /api/status and /api/status/events served every
// job to every signed-in session on either port: one area's sweep log, another area's lane news and
// a scan-path run's local paths. Now a fleet run is shown only in the fleet view, any other run
// only to the selection that names its area or repo, and a scan-path run everywhere with its path
// redacted off the operator port. Driven through the real job runner against stand-in scripts, and
// the panel's own attach/rescope functions against a recorded fetch.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initJobs, trigger, jobs, jobScope, jobStatusFor } from '../lib/jobs.mjs';
import { routes, initJobRoutes } from '../routes/jobs.mjs';
import { panelScript } from './lib/panel-source.mjs';

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'cw-job-vis-')));
const CW = join(TMP, 'cw');
const OUT = join(TMP, 'scan-out');
const ACME = join(TMP, 'repos', 'acme');
const ENV = ['CW_SCAN_PATH_OUT', 'CW_JOB_LOG_DIR', 'CW_HEALTH_RUNS_STORE', 'CW_SWEEP_CMD'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
after(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});
process.env.CW_SCAN_PATH_OUT = OUT;
process.env.CW_JOB_LOG_DIR = join(TMP, 'job-logs');
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
delete process.env.CW_SWEEP_CMD;
for (const d of [join(CW, 'monitor'), join(CW, 'bin'), OUT, ACME]) mkdirSync(d, { recursive: true });
const echo = (tag) => `console.log(${JSON.stringify(tag)} + ' ' + JSON.stringify(process.argv.slice(2)));\n`;
writeFileSync(join(CW, 'monitor', 'sweep.mjs'), echo('SWEEP'));
writeFileSync(join(CW, 'monitor', 'stpa-sweep.mjs'), echo('STPA'));
writeFileSync(join(CW, 'bin', 'commitwork.mjs'), echo('SCAN'));
const registry = () => ({ areas: [{ slug: 'alpha', label: 'Alpha Label' }, { slug: 'beta' }], projects: [{ name: 'acme', area: 'alpha' }] });
initJobs({ CW, registry, sessionStorePath: () => join(TMP, 'sessions.json'),
  projectSlug: (s) => ({ 'Alpha Label': 'alpha' })[s] || s, primaryArea: () => ({ slug: 'alpha' }) });
initJobRoutes({ registry, registryStale: () => false });

const route = (method, path) => routes.find((r) => r.method === method && r.path === path);
const until = async (what, pred, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (pred()) return;
  assert.fail(`timed out waiting for ${what}`);
};
const run = async (kind, project, opts) => {
  assert.deepEqual(trigger(kind, project, opts), { started: true });
  await until(`${kind} to finish`, () => !jobs[kind].running);
};
const status = (project, loopback = false) => new Promise((res) => route('GET', '/api/status').handle({
  req: { url: `/api/status?project=${encodeURIComponent(project)}` }, isLoopbackReq: loopback, send: (_c, p) => res(p) }));

/** An /api/status/events connection: frames parsed as they are written; close() releases the slot. */
function sse(query, { loopback = false } = {}) {
  const raw = [], on = {};
  const res = { writeHead() {}, write(s) { raw.push(s); return true; }, on(ev, fn) { on[ev] = fn; } };
  const req = { url: `/api/status/events?${query}`, headers: {}, on() {} };
  route('GET', '/api/status/events').handle({ req, res, send: (code) => assert.fail(`the stream answered ${code}`), isLoopbackReq: loopback });
  return {
    text: () => raw.join(''),
    frames: () => raw.filter((s) => /^(id: \d+\n)?event: /.test(s)).map((s) => ({
      event: /event: (\w+)/.exec(s)[1], data: JSON.parse(/data: (.*)/.exec(s)[1]) })),
    close: () => on.close && on.close(),
  };
}

test('a sweep for one area is invisible to a client on another area, and to the fleet view', async () => {
  await run('sweep', 'alpha');
  const mine = await status('alpha');
  assert.equal(mine.sweep.project, 'alpha');
  assert.ok(mine.sweep.lines.some((l) => l.startsWith('SWEEP ')));
  assert.ok('sweep' in mine.running);
  assert.equal((await status('Alpha Label')).sweep.project, 'alpha', 'the picker sends a label; it resolves to the slug');
  for (const other of ['beta', '']) {
    const st = await status(other);
    assert.equal(st.sweep, null, `a sweep of alpha reached ${other || 'the fleet view'}`);
    assert.ok(!('sweep' in st.running), 'not even as a running flag');
  }
  const b = sse('kind=sweep&project=beta'), a = sse('kind=sweep&project=alpha');
  assert.deepEqual(b.frames(), [{ event: 'status', data: null }]);
  assert.ok(!b.text().includes('SWEEP'));
  assert.ok(a.frames().some((f) => f.event === 'line' && f.data.line.startsWith('SWEEP ')));
  assert.equal(a.frames().at(-1).data.project, 'alpha');
  a.close(); b.close();
});

test('live frames follow visibility: a stream open on another area receives nothing of the run', async () => {
  const a = sse('kind=sweep&project=alpha'), b = sse('kind=sweep&project=beta');
  const before = b.frames().length;
  await run('sweep', 'alpha');
  assert.equal(b.frames().length, before, `beta received ${JSON.stringify(b.frames().slice(before))}`);
  assert.ok(a.frames().some((f) => f.event === 'status' && f.data && f.data.running === false));
  a.close(); b.close();
});

test('a narrowed run answers to its repo as well as its area', async () => {
  await run('sweep', 'alpha', { repo: 'acme', label: 'repo acme' });
  assert.equal((await status('acme')).sweep.repo, 'acme');
  assert.equal((await status('alpha')).sweep.repo, 'acme');
  assert.equal((await status('beta')).sweep, null);
});

test('a fleet run is shown only in the fleet view', async () => {
  await run('stpa', '');
  assert.equal((await status('')).stpa.fleet, true);
  assert.equal((await status('alpha')).stpa, null, 'a fleet run reached a project view');
  // STPA reads commitwork's own control loop: fleet whatever project its argv carries.
  await run('stpa', 'alpha');
  assert.ok((await status('')).stpa.lines.some((l) => l === 'STPA ["alpha"]'));
  assert.equal((await status('alpha')).stpa, null);
});

test('a scan-path run is seen everywhere, with its path and output redacted off the operator port', async () => {
  const pub = sse('kind=scan-path&project=beta'), op = sse('kind=scan-path&project=beta', { loopback: true });
  await run('scan-path', null, { path: ACME, label: `scan: ${ACME}` });
  await until('the terminal status on both streams', () => [pub, op].every((s) => s.frames().some((f) => f.event === 'status' && f.data && !f.data.running)));
  const replay = sse('kind=scan-path&project=');
  for (const s of [pub, replay]) {
    assert.ok(s.frames().some((f) => f.event === 'line' && f.data.line.startsWith('SCAN ')), 'the run itself was hidden');
    assert.ok(!s.text().includes(ACME) && !s.text().includes(OUT), `a path reached the published port:\n${s.text()}`);
    assert.equal(s.frames().filter((f) => f.event === 'status').at(-1).data.label, 'scan: [redacted: shown on the operator port]');
  }
  assert.ok(op.text().includes(ACME) && op.text().includes(OUT), 'the operator port lost the path');
  assert.equal(jobStatusFor('scan-path', jobScope({ operator: true })).label, `scan: ${ACME}`);
  for (const s of [pub, op, replay]) s.close();
});

// ── the client: it sends its selection, and re-attaches when the selection changes ───────────────

const SRC = panelScript('index.html');
const line = (prefix) => {
  const l = SRC.split('\n').find((x) => x.startsWith(prefix));
  assert.ok(l, `${prefix} is not in the served panel source`);
  return l;
};
const fnSrc = (name) => {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
  const at = SRC.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(at > -1, `${name} is not in the served panel source`);
  return SRC.slice(at, SRC.indexOf('\n}\n', at) + 2);
};

function client() {
  const log = { fetched: [], stopped: 0, rendered: [] };
  const replies = [];
  const body = [
    "let curProj='Alpha Label', curView='overview', jobScopeOf=null, sweepTimer=null, sweepActive=false, lastSeq=-1,",
    '  laneRun={}, stpaTimer=null, stpaActive=false, lastStpaSeq=-1, healthTimer=null;',
    "const scopeOf=(v)=>(v==='fleet'||v==='stpa'?'fleet':'project');",
    'const fetch=(url)=>{log.fetched.push(url);return new Promise((r)=>replies.push(()=>r({json:async()=>({sweep:{project:url},stpa:null,health:null})})));};',
    'const renderSweep=(sw)=>log.rendered.push(sw&&sw.project), updateSweepBtn=()=>{}, seedLanes=()=>{}, startSweepPolling=()=>{},',
    '  renderStpa=()=>{}, startStpaPolling=()=>{}, renderHealth=()=>{}, pollHealth=()=>{}, paintLaneTab=()=>{},',
    '  stopSweepStream=()=>{log.stopped++;}, stopStpaStream=()=>{};',
    line('const jobSel='), line('const jobQ='), fnSrc('attachJobs'), fnSrc('rescopeJobs'),
    'return { attachJobs, rescopeJobs, set:(p,v)=>{curProj=p;if(v)curView=v;} };',
  ].join('\n');
  return { log, replies, ...new Function('log', 'replies', body)(log, replies) };
}
const flush = async (c) => { while (c.replies.length) c.replies.shift()(); await new Promise((r) => setTimeout(r, 0)); };

test('the panel asks for its selection and re-attaches when the picker or the page scope changes', async () => {
  const c = client();
  c.attachJobs();
  assert.deepEqual(c.log.fetched, ['/api/status?project=Alpha%20Label']);
  await flush(c);
  c.rescopeJobs();
  assert.equal(c.log.fetched.length, 1, 'an unchanged selection must not re-attach');
  c.set('beta');
  c.rescopeJobs();
  assert.equal(c.log.stopped, 1, 'the stream opened for the old selection was left open');
  assert.equal(c.log.fetched.at(-1), '/api/status?project=beta');
  c.set('beta', 'fleet');
  c.rescopeJobs();
  assert.equal(c.log.fetched.at(-1), '/api/status?project=', 'a fleet page is the fleet view, whatever the picker holds');
  await flush(c);
  // Two attaches in flight: only the newer selection may render.
  c.set('alpha', 'overview'); c.rescopeJobs();
  c.set('beta'); c.rescopeJobs();
  await flush(c);
  assert.deepEqual(c.log.rendered.slice(-1), ['/api/status?project=beta']);
  assert.ok(!c.log.rendered.includes('/api/status?project=alpha'), 'a superseded selection rendered its jobs');
});

test('every job request in the panel carries the selection, and both navigation paths re-scope', () => {
  const bare = SRC.split('\n').filter((l) => /['"`]\/api\/status(\/events)?['"`?]/.test(l) && !/jobQ\(/.test(l) && !/could not read \/api\/status/.test(l)
    && !/kind=scan-path/.test(l));
  assert.deepEqual(bare, [], 'a job request without the selection would see only fleet runs');
  assert.match(fnSrc('startSweepStream'), /new EventSource\('\/api\/status\/events\?kind=sweep&'\+jobQ\(\)\)/);
  assert.match(fnSrc('startStpaStream'), /new EventSource\('\/api\/status\/events\?kind=stpa&'\+jobQ\(\)\)/);
  assert.match(fnSrc('load'), /rescopeJobs\(\);/);
  assert.match(fnSrc('setView'), /rescopeJobs\(\);/);
  assert.match(fnSrc('bolaPollOnce'), /jobQ\(bolaSlug\|\|''\)/, 'the BOLA page lists every area and asks for the one it started');
});
