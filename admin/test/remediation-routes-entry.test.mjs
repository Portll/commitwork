// GET /api/remediation/inputs and GET /api/remediation/prompts through their handlers, on the
// synthetic reports tree in lib/remediation-fixture.mjs plus one area whose rollup is torn. The
// registry is reached through CW_REGISTRY at call time; the project allowlist is the ctx's
// knownProjects(), as serve.mjs passes it. Neither route checks a session itself — both sit behind
// the panel's login gate (see route-auth.test.mjs) — so what is asserted here is the scope each
// request resolves to and what each input's state says about the files on disk.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes, REMEDIATION_INPUTS } from '../routes/remediation.mjs';
import { buildRemediationFixture, ALPHA_BATCH, BETA_BATCH } from './lib/remediation-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const T = mkdtempSync(join(tmpdir(), 'cw-remediation-entry-'));
const saved = process.env.CW_REGISTRY;
let FX;

before(() => {
  FX = buildRemediationFixture(T);
  // delta: declared, with a torn rollup and a plan that carries none of the rollup's headings
  const reg = JSON.parse(readFileSync(FX.registryPath, 'utf8'));
  reg.areas.push({ slug: 'delta', label: 'Delta', out: 'delta' });
  writeFileSync(FX.registryPath, JSON.stringify(reg));
  mkdirSync(join(FX.reports, 'delta'), { recursive: true });
  writeFileSync(join(FX.reports, 'delta', 'rollup.json'), '{ "generated": "2026-09-03T00:00:00.000Z", "scanners": { ');
  writeFileSync(join(FX.reports, 'delta', 'REMEDIATION.md'), '# notes\n\n- one bullet that is not a plan\n');
  process.env.CW_REGISTRY = FX.registryPath;
});
after(() => {
  if (saved === undefined) delete process.env.CW_REGISTRY; else process.env.CW_REGISTRY = saved;
  rmSync(T, { recursive: true, force: true });
});

const KNOWN = new Set(['alpha', 'beta', 'gamma', 'delta', 'alpha-app', 'beta-app']);
const route = (path) => routes.find((r) => r.method === 'GET' && r.path === path);
const call = (path, project) => new Promise((resolve) => {
  route(path).handle({
    req: {}, query: new URLSearchParams(project == null ? {} : { project }), knownProjects: () => KNOWN,
    send: (code, payload) => resolve({ code, payload }),
  });
});
const byKey = (inputs) => Object.fromEntries(inputs.map((i) => [i.key, i]));

test('inputs: an unselected or unknown project is its own answer, never a row of absents', async () => {
  const none = await call('/api/remediation/inputs', null);
  assert.equal(none.code, 200);
  assert.deepEqual(none.payload, { ok: false, project: { state: 'unselected', why: none.payload.error, slug: null, out: null }, error: 'no project selected — the remediation layer answers for one project at a time' });

  const unknown = await call('/api/remediation/inputs', 'zeta-not-declared');
  assert.equal(unknown.payload.ok, false);
  assert.equal(unknown.payload.project.state, 'unknown');
  assert.equal(unknown.payload.error, "'zeta-not-declared' is not a project this panel knows");
  assert.equal(unknown.payload.inputs, undefined);
});

test('inputs: a fully swept project reports every input present, with what each holds', async () => {
  const r = await call('/api/remediation/inputs', 'alpha');
  assert.equal(r.code, 200);
  const p = r.payload;
  assert.equal(p.ok, true);
  assert.deepEqual(p.project, { state: 'ok', why: null, slug: 'alpha', out: 'alpha' });
  assert.deepEqual(p.inputs.map((i) => i.key), REMEDIATION_INPUTS.map((s) => s.key), 'inputs come back in the declared order');
  const i = byKey(p.inputs);
  assert.deepEqual(p.inputs.map((x) => x.state), ['ok', 'ok', 'ok', 'ok', 'ok']);
  assert.equal(i.rollup.generated, '2026-09-01T00:00:00.000Z');
  assert.deepEqual({ parsed: i.plan.summary.parsed, packages: i.plan.summary.packages, findings: i.plan.summary.findings, kev: i.plan.summary.kevPackages },
    { parsed: true, packages: 4, findings: 9, kev: 1 });
  assert.deepEqual(i.plan.summary.headline, { crit: 1, high: 4, med: 2, low: 2, kev: 1 });
  assert.equal(i.batch.source, ALPHA_BATCH, 'a reports-root-relative source resolves');
  assert.equal(i.ledger.entries, 2);
  assert.equal(i.codeqlFleet.findings, 1);
  assert.deepEqual({ state: p.outputs.triage.state, runs: p.outputs.triage.runs, verdicts: p.outputs.triage.verdicts }, { state: 'ok', runs: 1, verdicts: 1 });
  assert.deepEqual({ state: p.outputs.codeqlJobs.state, jobs: p.outputs.codeqlJobs.jobs, byState: p.outputs.codeqlJobs.byState }, { state: 'ok', jobs: 1, byState: { lodged: 1 } });
  for (const x of p.inputs) assert.ok(x.producedBy && x.label, `${x.key} says what produces it`);
});

test('inputs: a batch the rollup names but the disk no longer holds is absent, and says which', async () => {
  const i = byKey((await call('/api/remediation/inputs', 'beta')).payload.inputs);
  assert.equal(i.rollup.state, 'ok');
  assert.deepEqual({ parsed: i.plan.summary.parsed, packages: i.plan.summary.packages }, { parsed: true, packages: 0 }, 'a zero plan is a parsed zero');
  assert.equal(i.batch.state, 'absent');
  assert.equal(i.batch.source, BETA_BATCH);
  assert.match(i.batch.why, /is not under the reports root on this box/);
  assert.equal(i.ledger.state, 'absent');
  assert.equal(i.codeqlFleet.state, 'absent');
});

test('inputs: a declared project never swept names every input absent — and why the batch is', async () => {
  const p = (await call('/api/remediation/inputs', 'gamma')).payload;
  assert.equal(p.ok, true);
  assert.deepEqual(p.inputs.map((x) => x.state), ['absent', 'absent', 'absent', 'absent', 'absent']);
  assert.equal(byKey(p.inputs).batch.why, 'there is no rollup.json to name a batch');
  assert.equal(p.outputs.triage.state, 'absent');
});

test('inputs: a torn rollup is unreadable, the batch it would name is unknown, and an unparsed plan has no count', async () => {
  const i = byKey((await call('/api/remediation/inputs', 'delta')).payload.inputs);
  assert.equal(i.rollup.state, 'unreadable');
  assert.ok(i.rollup.why, 'the reason travels');
  assert.equal(i.batch.state, 'unknown');
  assert.equal(i.plan.state, 'ok');
  assert.equal(i.plan.summary.parsed, false);
  assert.equal(i.plan.summary.packages, undefined, 'an unparsed plan carries no count, not a zero');
});

test('prompts: a project\'s live counts join onto its scanner\'s prompt, and nowhere else', async () => {
  const r = await call('/api/remediation/prompts', 'alpha');
  assert.equal(r.code, 200);
  const p = r.payload;
  assert.equal(p.ok, true);
  assert.equal(p.generated, '2026-09-01T00:00:00.000Z');
  assert.deepEqual(p.project, { state: 'ok', why: null, slug: 'alpha', out: 'alpha' });
  assert.deepEqual(p.rollup, { state: 'ok', why: null });
  const rollup = JSON.parse(readFileSync(join(FX.reports, 'alpha', 'rollup.json'), 'utf8'));

  const secrets = p.prompts.filter((x) => x.category === 'secrets');
  assert.ok(secrets.length >= 1, 'the bundled manifests carry a prompt for the secrets lane');
  for (const x of secrets) assert.deepEqual(x.live, rollup.scanners.secrets);
  for (const x of p.prompts.filter((y) => y.category !== 'secrets')) assert.equal(x.live, null, `${x.check}: no fabricated zero`);
  for (const x of p.prompts) assert.ok(typeof x.prompt === 'string' && x.prompt.length && x.manifest && x.check);

  // sorted by manifest, then check
  const keys = p.prompts.map((x) => `${x.manifest}\u0000${x.check}`);
  assert.deepEqual(keys, [...keys].sort());
  // second witness: every security-baseline check that declares a prompt is served
  const sb = JSON.parse(readFileSync(join(HERE, '..', '..', 'manifests', 'security-baseline.json'), 'utf8'));
  const served = new Set(p.prompts.map((x) => x.check));
  for (const c of sb.checks.filter((x) => x.remediationPrompt)) assert.ok(served.has(c.id), `${c.id} declares a prompt that is not served`);
});

test('prompts: a torn rollup is reported unreadable and every live count is null', async () => {
  const p = (await call('/api/remediation/prompts', 'delta')).payload;
  assert.equal(p.rollup.state, 'unreadable');
  assert.ok(p.rollup.why);
  assert.equal(p.generated, null);
  assert.ok(p.prompts.length > 0, 'the catalogue is still served');
  assert.ok(p.prompts.every((x) => x.live === null));
});

test('prompts: with no project selected the catalogue is served with no counts and says why', async () => {
  const p = (await call('/api/remediation/prompts', null)).payload;
  assert.equal(p.ok, true);
  assert.equal(p.project.state, 'unselected');
  assert.equal(p.rollup.state, 'absent');
  assert.ok(p.prompts.length > 0);
  assert.ok(p.prompts.every((x) => x.live === null));
});

test('both are GET-only in the dispatch table', () => {
  for (const path of ['/api/remediation/inputs', '/api/remediation/prompts']) {
    assert.deepEqual(routes.filter((r) => r.path === path).map((r) => r.method), ['GET'], path);
  }
});
