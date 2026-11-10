// The Runner page's assembly on envelopes captured from the real stack API (runner/api.mjs over a
// real ledger, meter, claims and poll), and the page rendered from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRunnerModel, bytes, readRunner, RUNNER_ROUTES, secs, when } from '../lib/runner-view.mjs';
import { renderRunnerPage } from '../lib/runner-page.mjs';
import { unmeasured, UNMEASURED, UP_REMEDY } from '../../lib/stack-client.mjs';

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/stack-api/${name}.json`, import.meta.url), 'utf8'));
const URL_ = 'http://127.0.0.1:17990';
const up = () => ({ health: fx('health'), slots: fx('slots'), decisions: fx('decisions'), jobs: fx('jobs'), now: fx('resources-now') });
const bare = () => ({ health: fx('bare-health'), slots: fx('bare-slots'), decisions: fx('bare-decisions'), jobs: fx('bare-jobs'), now: fx('bare-resources-now') });
const down = () => Object.fromEntries(Object.entries(RUNNER_ROUTES).map(([k, r]) => [k,
  unmeasured(r.split('?')[0], 'stack-down', `the stack API at ${URL_} refused the connection`, { detail: 'ECONNREFUSED' })]));
const model = (env) => buildRunnerModel(env, { url: URL_ });
const texts = (cells) => cells.map((c) => c.text);

/** Every figure cell in a model. */
function figures(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if ('unknown' in node && 'text' in node) out.push(node);
  else for (const v of Object.values(node)) figures(v, out);
  return out;
}

test('slots: each state and the running job', () => {
  const m = model(up());
  assert.equal(m.slots.state, 'measured');
  assert.deepEqual(m.slots.rows.map((s) => [s.id, s.state, s.tone]), [['slot-1', 'idle', 'live'], ['slot-2', 'running', 'live']]);
  assert.deepEqual(m.slots.rows[1].job, { repo: 'example-owner/example-private', runner: 'cw-slot-2-1040-1792659702', runId: 104, jobId: 1040 });
  assert.deepEqual(m.kpis.map((k) => [k.k, k.v.text]), [['Slots', '2'], ['Running jobs', '1'], ['Docker VM CPU', '25.0%'], ['Docker VM memory used', '5.7 GiB']]);
});

test('decisions: the code, the outcome and the reason of each', () => {
  const rows = model(up()).decisions.rows;
  assert.deepEqual(rows.map((d) => [d.code, d.outcome, d.tone]), [
    ['capacity-wait', 'wait', 'part'], ['admitted', 'admit', 'live'], ['admitted', 'admit', 'live'],
    ['event-privileged', 'refuse', 'plain'], ['repo-approval-weak', 'refuse', 'plain'],
    ['admitted', 'admit', 'live'], ['needs-container', 'refuse', 'plain'],
  ]);
  const gate = rows.find((d) => d.code === 'repo-approval-weak');
  assert.deepEqual([gate.repo, gate.runId, gate.jobId, gate.seen], ['example-owner/example-public', null, null, 2]);
  assert.match(rows.find((d) => d.code === 'event-privileged').reason, /pull_request_target runs with the base repository's secrets/);
  assert.equal(rows.find((d) => d.code === 'needs-container').reason, 'needs docker; slots have none (container:)');
});

test('jobs: wall time, CPU-seconds and peak memory; an unread memory.peak is UNMEASURED', () => {
  const jobs = model(up()).layers.jobs;
  assert.equal(jobs.label, 'JOBS');
  const [second, first] = jobs.rows;
  assert.deepEqual([first.jobId, first.exit, ...texts([first.wall, first.cpuSec, first.memPeak, first.io])],
    [1010, { text: 'exit 0', tone: 'live' }, '42.5 s', '5.00 s', '210.0 MiB', '1.0 MiB read · 2.0 MiB written']);
  assert.deepEqual([second.jobId, second.exit, ...texts([second.wall, second.cpuSec, second.memPeak])],
    [1030, { text: 'exit 1', tone: 'part' }, '2 min 5 s', '<0.01 s', UNMEASURED]);
  assert.equal(second.memPeak.why, 'the slot could not read memory.peak');
});

test('resources: the Docker VM, containers and jobs layers, each labelled', () => {
  const { vm, containers, jobs } = model(up()).layers;
  assert.deepEqual([vm.label, containers.label, jobs.label], ['DOCKER VM', 'CONTAINERS', 'JOBS']);
  assert.deepEqual(vm.figures.map((f) => [f.k, f.v.text]), [
    ['CPU, all VM CPUs', '25.0%'], ['CPUs', '2'], ['Memory used', '5.7 GiB'], ['Memory total', '24.8 GiB'],
    ['Swap used', '0 B'], ['Load 1 · 5 · 15 min', '1.50 · 0.75 · 0.25'],
  ]);
  const byService = Object.fromEntries(containers.rows.map((c) => [c.service, c]));
  assert.deepEqual(texts([byService['slot-1'].cpuPct, byService['slot-1'].memMax]), ['98.5%', '6.0 GiB']);
  assert.deepEqual(texts([byService['slot-2'].cpuPct, byService['slot-2'].memMax, byService['slot-2'].memPeak]), ['0.0%', 'no limit', UNMEASURED]);
  assert.equal(byService.egress.state, 'unmeasured');
  assert.ok(figures(byService.egress).every((f) => f.unknown && f.why === 'no cgroup: the container is stopped or not started'));
});

test('a stopped stack: every figure UNMEASURED with the reason and the remedy, never 0', () => {
  const m = model(down());
  const cells = figures(m);
  assert.ok(cells.length >= 6);
  assert.ok(cells.every((c) => c.unknown && c.text === UNMEASURED), 'every figure is UNMEASURED');
  for (const sec of [m.api, m.slots, m.decisions, m.layers.vm, m.layers.containers, m.layers.jobs]) {
    assert.equal(sec.state, 'unmeasured');
    assert.match(sec.why, /refused the connection/);
    assert.equal(sec.remedy, UP_REMEDY);
  }
  const html = renderRunnerPage(m);
  assert.doesNotMatch(html, />\s*0(\.0+)?\s*(%|B|s)?\s*</, 'no figure renders as zero');
  assert.ok(html.split(UP_REMEDY).length - 1 >= 6);
  for (const label of ['DOCKER VM', 'CONTAINERS', 'JOBS']) assert.ok(html.includes(`<div class="layer">${label}`), label);
});

test('a dispatcher with no ledger, meter or slot table: UNMEASURED by source, with its reason', () => {
  const m = model(bare());
  assert.equal(m.api.state, 'measured');
  assert.deepEqual(m.api.sources.map((s) => [s.id, s.tone]), [['dispatcher', 'live'], ['meter', 'part'], ['ledger', 'part'], ['veld', 'unk'], ['spine', 'unk']]);
  assert.equal(m.slots.why, 'slots unavailable: no slot table configured');
  assert.equal(m.layers.jobs.why, 'ledger unavailable: no ledger configured');
  assert.equal(m.layers.vm.why, 'meter unavailable: no meter configured');
  assert.ok(figures(m).every((c) => c.unknown));
});

test('one failed route leaves the others measured', () => {
  const env = up();
  env.slots = unmeasured('/v1/runner/slots', 'token-rejected', 'the stack API rejected the token from ~/.config/portll-stack/api-token');
  const m = model(env);
  assert.equal(m.slots.state, 'unmeasured');
  assert.deepEqual(texts(m.kpis.map((k) => k.v)), [UNMEASURED, UNMEASURED, '25.0%', '5.7 GiB']);
  assert.equal(m.decisions.state, 'measured');
});

test('the page escapes every text the API supplies', () => {
  const env = up();
  env.decisions.data.decisions[0].reason = '<img src=x onerror=alert(1)>';
  env.decisions.data.decisions[0].repo = '"><script>alert(2)</script>';
  const html = renderRunnerPage(model(env));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>alert(2)'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('readRunner asks each route once, through the reader and options it is given', async () => {
  const asked = [];
  const env = await readRunner({ url: URL_, read: async (route, opts) => { asked.push([route, opts.url]); return { route }; } });
  assert.deepEqual(asked, Object.values(RUNNER_ROUTES).map((r) => [r, URL_]));
  assert.deepEqual(Object.keys(env), ['health', 'slots', 'decisions', 'jobs', 'now']);
});

test('formatters', () => {
  assert.deepEqual([bytes(0), bytes(1536), bytes(6442450944), bytes('max')], ['0 B', '1.5 KiB', '6.0 GiB', 'no limit']);
  assert.deepEqual([secs(0), secs(0.0001), secs(5), secs(42.5), secs(125.2)], ['0.00 s', '<0.01 s', '5.00 s', '42.5 s', '2 min 5 s']);
  assert.deepEqual([when('2026-10-22T09:03:47.700Z'), when(null)], ['2026-10-22 09:03:47Z', '—']);
});
