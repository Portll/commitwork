// The schemas manifests/formats.json freezes, held to what their writers emit: each writer runs on
// synthetic inputs and its output must validate, and a document with its version or shape broken
// must not. format-freeze.test.mjs pins the schemas; this proves they describe the writers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { validateAgainstSchema } from '../../monitor/registry.mjs';
import { emptyIssuesDoc, mintIssue, mutateIssue, closeIssue, reopenIssue } from '../../monitor/issue-store.mjs';
import { appendRecord, journal } from '../lib/verdict-journal-core.mjs';
import { buildDigest, writeDigest } from '../digest.mjs';
import { deliverDigest, ledgerPath } from '../digest-deliver.mjs';
import { emptyLedger, planTodos } from '../../monitor/daily-todos.mjs';
import { itemId } from '../../monitor/daily.mjs';
import { newJob, writeJob, runJob, readJob } from '../../lib/cobolwork-remediation-jobs.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'cw-format-schemas-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
let seq = 0;
const scratch = () => { const d = join(tmp, `case-${seq++}`); mkdirSync(d, { recursive: true }); return d; };

const schemaPath = (name) => join(REPO, 'schema', `${name}.schema.json`);
const errorsOf = (name, doc) => validateAgainstSchema(doc, { path: schemaPath(name) }).errors;
const assertValid = (name, doc, what) => assert.deepEqual(errorsOf(name, doc), [], `${name}: ${what}`);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// Every valid document a test produced, for the refusal checks at the end.
const produced = [];
const keep = (name, field, doc) => { produced.push({ name, field, doc }); return doc; };

function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
async function withEnvAsync(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// ── digest ──────────────────────────────────────────────────────────────────────────────────────
const NOW = '2026-03-02T12:00:00.000Z';
const IN = '2026-03-02T06:00:00.000Z';
const IN2 = '2026-03-02T09:00:00.000Z';
const OLD = '2026-02-20T00:00:00.000Z';

function digestInputs(d) {
  const doc = emptyIssuesDoc();
  const src = (k) => ({ kind: 'finding', key: `f:example-repo|osv|${k}|pkg|lock`, tool: 'osv', rule: null });
  const mk = (k, severity, at) => mintIssue(doc, { area: 'area-a', repo: 'example-repo', kind: 'vuln', severity, title: `pkg ${k}`, source: src(k) }, at).id;
  mk('CVE-A', 'high', IN);
  const raised = mk('CVE-C', 'low', OLD);
  mutateIssue(doc, raised, (i) => { i.severity = 'med'; }, 'issue-updated', { severity: { from: 'low', to: 'med' } }, IN);
  const unk = mk('CVE-D', 'weird', OLD);
  mutateIssue(doc, unk, (i) => { i.severity = 'crit'; }, 'issue-updated', { severity: { from: 'unknown', to: 'crit' } }, IN2);
  const back = mk('CVE-F', 'high', OLD);
  closeIssue(doc, back, { as: 'accepted', evidence: 'closed for this fixture', at: OLD });
  reopenIssue(doc, back, { at: IN2, reason: 'finding reappeared' });
  doc.lastIngest['area-a'] = { sliceId: 'sweep-20260302060000', generated: IN };
  doc.lastIngest['area-b'] = { sliceId: 'sweep-20260220000000', generated: OLD };
  const issuesPath = join(d, 'issues.json');
  writeFileSync(issuesPath, JSON.stringify(doc));

  const verdictDir = join(d, 'verdicts');
  mkdirSync(verdictDir, { recursive: true });
  for (const [gate, r] of [
    ['gate-ratchet', { at: IN, verdict: 'worse', exit: 2, metrics: { drifted: 2 }, baseline: { drifted: 0 } }],
    ['gate-ratchet', { at: IN2, verdict: 'steady', metrics: { drifted: 0 }, baseline: { drifted: 0 } }],
    ['gate-tests', { at: IN, verdict: 'regression-committed', exit: 2, baseline: { fail: 4 }, names: ['a', 'b'] }],
    ['gate-tests', { at: IN2, verdict: 'deferred', exit: 0 }],
  ]) appendRecord(join(verdictDir, `${gate}.jsonl`), { v: 1, gate, pid: 1, session: null, ...r });

  const reportsRoot = join(d, 'reports');
  mkdirSync(join(reportsRoot, 'area-a'), { recursive: true });
  appendRecord(join(reportsRoot, 'area-a', 'sweep-journal.jsonl'), {
    v: 1, kind: 'sweep-area-verdict', at: IN, sliceId: 'sweep-20260302000000', area: 'area-a',
    repos: { missing: ['repo-gone'], scans: [{ name: 'repo-one', manifest: 'hermetic-tests', code: 2, ran: false, why: 'refused before scanning' }] },
    rollup: 'lock-contention', issues: { status: 'refused-identity-regression' }, preflight: 'ok', hostInventory: 'unknown', races: 'failed',
    memoryExport: { state: 'failed', kind: 'broken', reason: 'receipts failed' }, canary: { state: 'failed', why: 'harness output unreadable' },
    steps: { liveness: 'failed' }, finalize: { timeline: 'failed' },
  });
  appendRecord(join(reportsRoot, 'sweep-fleet-journal.jsonl'), {
    v: 1, kind: 'sweep-fleet-verdict', at: IN2, stamp: '20260302080000',
    areas: [{ slug: 'area-b', code: 1, secs: 3, timedOut: false }, { slug: 'area-c', code: null, secs: 3600, timedOut: true }],
    finalize: { compact: 'failed' },
  });
  for (const [area, marker] of [['area-d', { pid: 4242, startedAt: OLD, sliceId: 'sweep-20260220000000' }], ['area-e', { startedAt: IN }]]) {
    mkdirSync(join(reportsRoot, area), { recursive: true });
    writeFileSync(join(reportsRoot, area, '.sweep-inflight.json'), JSON.stringify(marker));
  }
  const registerPath = join(d, 'disregarded-warnings.json');
  const aside = (code, subject, at) => ({ source: 'sweep', code, subject, why: 'synthetic set-aside', who: 'operator (test)', at });
  writeFileSync(registerPath, JSON.stringify({ disregarded: [aside('step-failed', 'area-a/steps.liveness', OLD), aside('canary-failed', 'area-a/canary', IN)] }));
  return { root: d, env: { CW_NOW: NOW }, issuesPath, verdictDir, reportsRoot, pidAlive: () => false, registerPath };
}

test('digest: a document with every kind of row, and one with every input absent, validate', () => {
  const full = buildDigest(digestInputs(scratch()));
  const s = full.sections;
  assert.ok(s.severityCrossings.items.length >= 3 && s.ratchetBreaches.items.length && s.failedWork.items.length >= 8,
    'precondition: the fixture reaches crossings, breaches and failures');
  assert.ok(s.ratchetBreaches.undetermined.length && s.failedWork.undetermined.some((u) => u.source === 'in-flight marker'),
    'precondition: both kinds of undetermined row are present');
  assert.ok(s.returnedWarnings.items.length && s.returnedWarnings.coverage['set-aside'], 'precondition: a returned and a judged set-aside are present');
  assertValid('digest', keep('digest', 'schema', full), 'a populated digest');

  const d = scratch();
  const empty = buildDigest({ root: d, env: { CW_NOW: NOW }, issuesPath: join(d, 'none.json'), verdictDir: join(d, 'none'), reportsRoot: join(d, 'none'), registerPath: join(d, 'none-register.json') });
  assert.equal(empty.status, 'not-measured', 'precondition: every section is unmeasured');
  assertValid('digest', empty, 'a digest with nothing measured');

  const w = writeDigest(full, { root: d, reportsRoot: join(d, 'reports') });
  assertValid('digest', readJson(w.json), 'the file writeDigest lands');
});

// ── digest deliveries ───────────────────────────────────────────────────────────────────────────
test('digest-deliveries: the ledger after a delivery, a refusal and a retry validates', async () => {
  const d = scratch();
  const reportsRoot = join(d, 'reports');
  await withEnvAsync({ CW_REPORTS_ROOT: reportsRoot }, async () => {
    const { json } = writeDigest(buildDigest(digestInputs(d)), { root: d, reportsRoot });
    const env = { CW_NOW: NOW, CW_DIGEST_SLACK_URL: 'https://hooks.example/services/T0/B0/fixture', CW_DIGEST_WEBHOOK_URL: 'http://example.test/hook' };
    const fetchImpl = async () => ({ status: 200, statusText: 'OK', body: null });
    const first = await deliverDigest({ root: d, file: json, env, fetchImpl });
    assert.deepEqual(first.results.map((r) => r.state).sort(), ['delivered', 'failed'], 'precondition: one sent, one refused off loopback');
    await deliverDigest({ root: d, file: json, env, fetchImpl });
    const ledger = readJson(ledgerPath(d));
    assert.ok(Object.values(ledger.deliveries).some((r) => r.attempts === 2 && r.status === null), 'precondition: the refused destination was retried');
    assertValid('digest-deliveries', keep('digest-deliveries', 'schema', ledger), 'the delivery ledger');
    assert.doesNotMatch(JSON.stringify(ledger), /services\/T0|example\.test\/hook/, 'precondition: no URL path reached the ledger');
  });
});

// ── verdict journal ─────────────────────────────────────────────────────────────────────────────
test('verdict-journal: records journal() writes, across a rotation, validate', () => {
  const dir = scratch();
  withEnv({ CW_NOW: NOW, CW_VERDICT_MAX_BYTES: '400', CW_VERDICT_PIN: undefined }, () => {
    journal('fixture-gate', { verdict: 'steady', exit: 0, metrics: { drifted: 0 } }, { dir });
    for (let i = 0; i < 4; i++) journal('fixture-gate', { verdict: 'worse', exit: 2, detail: 'x'.repeat(120) }, { dir, session: `session-${i}` });
  });
  const files = readdirSync(dir).filter((f) => f.startsWith('fixture-gate.jsonl'));
  const recs = files.flatMap((f) => jsonl(join(dir, f)));
  assert.ok(files.length > 1, 'precondition: the journal rotated');
  const prevs = recs.map((r) => String(r.prev));
  assert.ok(prevs.includes('genesis') && prevs.some((p) => p.startsWith('rotation:')) && prevs.some((p) => /^[0-9a-f]{32}$/.test(p)),
    'precondition: every kind of chain link appears');
  for (const r of recs) assertValid('verdict-journal', r, `record ${r.prev}`);
  keep('verdict-journal', 'v', recs[0]);
});

// ── CRA refresh status and evidence index ───────────────────────────────────────────────────────
// The full pipeline's records are validated in cra/test/cra.test.mjs; this is the gate-stop path.
test('cra-refresh-status: the record a run stopped at the preflight gate writes validates', () => {
  const d = scratch();
  const r = spawnSync(process.execPath, [join(REPO, 'cra', 'refresh.mjs'), '--no-xlsx', '--no-sign'], {
    cwd: d, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: d, CW_CRA_ROOT: d, CW_CRA_OUT: join(d, 'out'), CW_CRA_NOW: NOW, CW_ESCALATE: '0' },
  });
  assert.notEqual(r.status, 0, `precondition: an unconfigured root stops at the gate\n${r.stdout}${r.stderr}`);
  const status = readJson(join(d, 'out', 'refresh-status.json'));
  assert.equal(status.ok, false);
  assert.deepEqual(status.steps.map((s) => s.outcome), ['failed']);
  assertValid('cra-refresh-status', keep('cra-refresh-status', 'schema', status), 'a gate-stopped run');
});

// ── build-health ────────────────────────────────────────────────────────────────────────────────
test('build-health: the reports deadcode, toolchain and provenance print validate', () => {
  const repo = join(scratch(), 'repo');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# fixture\n[ok](docs/a.md) [dead](docs/missing.md)\n');
  writeFileSync(join(repo, 'docs', 'a.md'), '# a\n');
  writeFileSync(join(repo, 'CMakeLists.txt'), 'project(fixture)\n');
  const run = (sub) => {
    const r = spawnSync(process.execPath, [join(REPO, 'bin', 'build-health.mjs'), sub, repo], { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, `${sub}: ${r.stderr}`);
    return JSON.parse(r.stdout);
  };
  const dead = run('deadcode');
  assert.ok(dead.results.some((x) => x.kind === 'documentation') && dead.results.some((x) => x.lang && x.ran === false),
    'precondition: a documentation row and a language row that did not run');
  assertValid('build-health', keep('build-health', 'schemaVersion', dead), 'deadcode');
  const prov = run('provenance');
  assert.equal(prov.status, 'advisory');
  assertValid('build-health', prov, 'provenance');
  rmSync(join(repo, 'CMakeLists.txt'));
  const tool = run('toolchain');
  assert.equal(tool.status, 'n/a');
  assertValid('build-health', tool, 'toolchain with nothing to build');
});

// ── daily ledger ────────────────────────────────────────────────────────────────────────────────
test('daily-ledger: the ledger through filing, a fix and a rename validates', () => {
  const A = itemId('r', 'sastFixture', 'rule-a', 'src/old.js');
  const N = itemId('r', 'sastFixture', 'rule-a', 'src/new.js');
  const B = itemId('r', 'sastFixture', 'rule-b', 'src/b.js');
  const cfg = { sha256: 'f'.repeat(64) };
  const sug = (ids) => ({ id: 'S1', repo: 'r', findingIds: ids, priority: 'p1', title: 't', why: 'w', where: [{ file: 'f', line: 1 }], change: 'c', verify: { lane: 'sast', expect: 'e' }, effort: 'S', confidence: 'high' });
  const report = (batch, s) => ({ area: 'ar', batch, suggestions: s });
  const digest = (items, fixed = []) => ({ config: cfg, repos: [{ name: 'r', items, omittedIds: [], fixed: fixed.map((id) => ({ id })), carried: [] }] });
  const step = (batch, s, d, ledger, todos = []) => planTodos({ report: report(batch, s), digest: d, ledger, todos, reportPath: '/r.json', today: '2026-03-02' }).ledger;

  assertValid('daily-ledger', emptyLedger(), 'the empty ledger');
  const filed = step('sweep-20260301000000', [sug([A, B])], digest([{ id: A }, { id: B }]), emptyLedger());
  filed.findings[A].todoId = 't1';
  const renamed = step('sweep-20260302000000', [], digest([{ id: N, category: 'sastFixture', rule: 'rule-a', renamedFrom: 'src/old.js' }, { id: B }]), filed, [{ id: 't1', status: 'todo', tags: [] }]);
  assert.equal(renamed.findings[A].state, 'renamed', 'precondition: a renamed entry');
  const fixed = step('sweep-20260303000000', [], digest([], [B]), renamed, [{ id: 't1', status: 'todo', tags: [] }]);
  assert.equal(fixed.findings[B].fixedBatch, 'sweep-20260303000000', 'precondition: a fixed entry');
  for (const [what, l] of [['filed', filed], ['renamed', renamed], ['fixed', fixed]]) assertValid('daily-ledger', l, what);
  keep('daily-ledger', 'schema', fixed);
});

// ── feature inventory and census ────────────────────────────────────────────────────────────────
// A tree with an entry point on every surface, and a charter that reaches every class.
function featureTree(root) {
  const put = (rel, s) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), s); };
  put('bin/commitwork.mjs', "#!/usr/bin/env node\nasync function main() {\n  const cmd = process.argv[2];\n  if (cmd === 'scan') return 0;\n  switch (cmd) { case 'brief': return 0; }\n}\n");
  put('bin/tool.mjs', '#!/usr/bin/env node\nconsole.log(1);\n');
  put('bin/tool-core.mjs', 'export const x = 1;\n');
  put('bin/guarded.mjs', "import { isMainModule } from '../lib/is-main.mjs';\nif (isMainModule(import.meta.url)) console.log(1);\n");
  put('lib/flags.mjs', 'export const flag = () => process.env.CW_FIXTURE_FLAG;\n');
  put('admin/serve.mjs', "import { routes as fxRoutes } from './routes/fx.mjs';\nconst MODULAR_ROUTES = [...fxRoutes];\nconst PANEL_VIEWS = new Set(['home']);\n");
  put('admin/routes/fx.mjs', "const P = '/api/fx/computed';\nexport const routes = [\n  { method: 'GET', path: '/api/fx/a', handle: () => {} },\n"
    + "  ...['x', 'y'].map((v) => ({ method: 'GET', path: `/api/fx/${v}`, handle: () => {} })),\n  { method: 'POST', path: P, handle: () => {} },\n];\n");
  put('admin/routes/unwired.mjs', "export const routes = [{ method: 'GET', path: '/api/unwired', handle: () => {} }];\n");
  put('admin/static/panel-router.js', "const NATIVE={home:'cw-home'};\nconst VALID_VIEWS=new Set(['home','legacy']);\nconst VIEW_ALIAS={old:'home'};\n");
  put('admin/menus/navigation.js', "const TAB_GROUPS=Object.freeze({home: 'main'});\n");
  put('mcp/tools.mjs', "export const DESC = {\n  fx_tool: {\n    name: 'fx_tool',\n    description: 'fixture',\n  },\n};\n");
  put('mcp/server.mjs', 'const H = { ...DESC.fx_tool };\n');
  put('monitor/install-agents.mjs', "const a = { label: 'com.portll.fixture' };\nconst b = (slug) => ({ label: `com.portll.area-${slug}` });\n");
  put('package.json', JSON.stringify({ private: true, bin: { fx: 'bin/tool.mjs' }, scripts: { test: 'node --test' } }, null, 2));
  put('bin/test/tool.test.mjs', "import '../tool-core.mjs';\ntest('GET /api/fx/a', () => {});\nconst e = process.env.CW_TEST_ONLY;\n");
  put('bin/test/cli.test.mjs', "// commitwork.mjs scan, commitwork.mjs brief\nconst s = 'commitwork.mjs';\n");
  put('README.md', '# fixture\nRun bin/tool.mjs, or `commitwork.mjs scan`.\n');
}
const CHARTER = {
  schema: 'commitwork.feature-charter/1', charterVersion: 'fixture-1', charter: ['a fixture product'],
  membershipTests: { core: 'c', extension: 'e', 'ring-outward': 'r', fragment: 'f', orphan: 'o' },
  classPriority: ['orphan', 'fragment', 'declared'],
  censusPopulation: ['cli-command', 'cli-script', 'http-route', 'ui-view', 'mcp-tool', 'job', 'package-api'],
  populationNote: 'flags are counted, not classed',
  experimentalFlags: { 'fx-preview': { label: 'Fixture preview', why: 'w' }, 'fx-code': { label: 'Gated in code', why: 'w' } },
  groups: [
    { id: 'cli', surface: 'cli-command', keys: ['scan', 'brief'], class: 'core', why: 'w' },
    { id: 'scripts', surface: 'cli-script', keys: ['bin'], class: 'extension', why: 'w' },
    { id: 'fx-routes', surface: 'http-route', keys: ['fx'], class: 'ring-outward', why: 'w', experimental: true, flag: 'fx-preview' },
    { id: 'views', surface: 'ui-view', keys: ['main'], class: 'fragment', why: 'declared incomplete' },
  ],
};

test('feature-inventory and feature-census: the files both CLIs write over a fixture tree validate', () => {
  const d = scratch();
  const root = join(d, 'tree');
  featureTree(root);
  const env = { PATH: process.env.PATH, HOME: d, CW_NOW: NOW };
  const run = (script, extra) => {
    const r = spawnSync(process.execPath, [join(REPO, 'bin', script)], { cwd: d, encoding: 'utf8', env: { ...env, ...extra } });
    assert.equal(r.status, 0, `${script}: ${r.stderr}`);
  };
  const invPath = join(d, 'out', 'features.json');
  run('feature-inventory.mjs', { CW_FI_ROOT: root, CW_FI_OUT: invPath });
  const inv = readJson(invPath);
  assert.deepEqual(Object.keys(inv.surfaces).sort(), ['cli-command', 'cli-script', 'config-flag', 'http-route', 'job', 'mcp-tool', 'package-api', 'ui-view'],
    'precondition: an entry point on every surface');
  assert.ok(inv.features.some((f) => f.undetermined) && inv.features.some((f) => f.file === null), 'precondition: an undetermined row and a test-only flag');
  assertValid('feature-inventory', keep('feature-inventory', 'schema', inv), 'the inventory');

  const charter = join(d, 'charter.json');
  writeFileSync(charter, JSON.stringify(CHARTER));
  const censusPath = join(d, 'out', 'census.json');
  run('feature-census.mjs', { CW_FC_IN: invPath, CW_FC_OUT: censusPath, CW_FC_CHARTER: charter });
  const census = readJson(censusPath);
  assert.deepEqual(Object.keys(census.counts).sort(), ['core', 'extension', 'fragment', 'orphan', 'ring-outward', 'unclassified'],
    'precondition: every class has a row');
  assert.ok(census.experimentalFlags.some((f) => f.groups.length === 0), 'precondition: a flag gated only in code');
  // Optional in the schema only because censuses written before flags existed lack them.
  assert.ok(census.rows.every((r) => 'experimental' in r && 'flag' in r && 'flagEnforcedBy' in r), 'the writer states each row\'s flag');
  assertValid('feature-census', keep('feature-census', 'schema', census), 'the census');
});

// ── pattern-scan ────────────────────────────────────────────────────────────────────────────────
test('pattern-scan: the --json record over a fixture repository validates, with every adjudication', () => {
  const d = scratch();
  const root = join(d, 'repo');
  const put = (rel, s) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), s); };
  put('lib/a.mjs', "import { spawnSync } from 'node:child_process';\nconst ROOT = process.env.CW_FIXTURE_ROOT;\n"
    + "export function f() { try { return JSON.parse('x'); } catch { return []; } }\n"
    + "export function g() { const r = spawnSync('git', ['log']); return r.stdout.toString().split('\\n'); }\n");
  put('test/a.test.mjs', "import { test } from 'node:test';\ntest('nothing', () => { const x = 1; });\n");
  put('docs/n.md', '# notes\nSee commit deadbeefcafe1234.\n');
  const git = (...args) => assert.equal(spawnSync('git', ['-c', 'user.email=f@example.invalid', '-c', 'user.name=f', ...args], { cwd: root }).status, 0, `git ${args[0]}`);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'base');
  put('evaluations/record.json', '{}\n');

  const journalDir = join(d, 'journal');
  withEnv({ CW_NOW: NOW }, () => journal('pattern-scan', { kind: 'adjudication', identity: 'test/a.test.mjs::test:nothing::R1', truth: 'false-alarm', adjudicatedBy: 'operator', basis: 'fixture' }, { dir: journalDir }));
  const baseline = join(d, 'baseline.json');
  writeFileSync(baseline, JSON.stringify({ schema: 'commitwork.pattern-baseline/1', seededAt: NOW, head: 'f'.repeat(40), dirty: false, forced: false,
    bindingsSha256: '0'.repeat(64), identities: ['lib/a.mjs::<module>::M9'] }));
  const r = spawnSync(process.execPath, [join(REPO, 'bin', 'pattern-scan.mjs'), '--json'], {
    cwd: d, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: d, CW_NOW: NOW, CW_PATTERN_ROOT: root, CW_PATTERN_BASELINE: baseline, CW_ISSUES: join(d, 'no-issues.json'), CW_PATTERN_JOURNAL_DIR: journalDir },
  });
  assert.equal(r.status, 1, `precondition: new findings exit 1\n${r.stderr}`);
  const rec = JSON.parse(r.stdout);
  assert.deepEqual([...new Set(rec.observations.map((o) => o.adjudication))].sort(), ['accepted', 'baseline', 'finding', 'undetermined'],
    'precondition: every adjudication appears');
  assert.ok(rec.detectors.some((x) => x.status === 'not-applicable') && rec.baselineProvenance.stale, 'precondition: an inapplicable detector and a stale baseline');
  assertValid('pattern-scan', keep('pattern-scan', 'schema', rec), 'the run record');
});

// ── scan.json ───────────────────────────────────────────────────────────────────────────────────
test('run-scan: the scan.json a scan writes, with clean, finding, void and n/a cells, validates', () => {
  const d = scratch();
  const repo = join(d, 'roots', 'fixture-repo');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'README.txt'), 'fixture\n');
  spawnSync('git', ['init', '-q', repo]);
  const cdx = (exit) => `printf '%s' '${JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', components: [{ name: 'left-pad', version: '1.3.0' }] })}' > "$CW_REPORT_DIR/$CHECK.json"; echo ${exit} > "$CW_REPORT_DIR/$CHECK.json.exit"`;
  const lane = (id, cmd, format, extra = {}) => ({ id, local: [`CHECK=${id}; ${cmd}`], report: { file: `${id}.json`, format }, ...extra });
  const manifest = join(d, 'm.json');
  writeFileSync(manifest, JSON.stringify({ repo: 'fixture', groups: { all: ['sbom', 'sbom-exit', 'leaks', 'live', 'py', 'absent'] }, checks: [
    lane('sbom', cdx(0), 'sbom'),
    lane('sbom-exit', cdx(3), 'sbom'),
    lane('leaks', `printf '%s' '[{"RuleID":"generic-api-key","File":"src/a.js","StartLine":3}]' > "$CW_REPORT_DIR/leaks.json"; echo 1 > "$CW_REPORT_DIR/leaks.json.exit"`, 'gitleaks'),
    lane('live', 'true', 'json', { requiresUrl: true }),
    lane('py', 'true', 'json', { appliesIfSourceExt: ['.py'] }),
    lane('absent', 'true', 'json'),
  ] }));
  const out = join(d, 'out');
  const r = spawnSync(process.execPath, [join(REPO, 'bin', 'commitwork.mjs'), 'scan', '--manifest', manifest, '--root', join(d, 'roots'), '--out', out], {
    cwd: d, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: d, CW_SKIP_SETUP: '1', CW_SANDBOX: 'off', CW_ASSERT_TREE: '0', CW_SELF_SWEEP: '0', FORCE_COLOR: '0',
      COMMITWORK_TRUST_REPO_MANIFEST: '1', CW_SCAN_CONFIG: join(d, 'no-scan-config.json'), CW_PERF_FEEDBACK: join(d, 'perf.jsonl') },
  });
  const scan = readJson(join(out, 'scan.json'));
  const cells = scan.repos[0].cells;
  assert.deepEqual(Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, c.sev])),
    { sbom: 'ok', 'sbom-exit': 'noscan', leaks: 'high', live: 'noscan', py: 'skip', absent: 'noscan' }, `precondition: every kind of cell\n${r.stdout}${r.stderr}`);
  assert.ok(Object.keys(scan.boundaries || {}).length && cells.sbom.boundary, 'precondition: threat models stored once and referenced');
  assertValid('run-scan', keep('run-scan', 'version', scan), 'scan.json');
});

// ── remediation records whose writers run only inside the panel ─────────────────────────────────
// The triage verdict file and the CodeQL job are written by admin routes that need a live panel
// and stubbed engines; admin/test/remediation-handoff.test.mjs and admin/test/codeql-remediation.test.mjs
// run those writers and validate what lands. These are hand-built in the same shapes, for the
// refusal checks below.
test('triage-verdict-record and codeql-remediation-job: synthetic records in the writers\' shapes validate', () => {
  const triage = {
    schema: 'commitwork/triage-verdict.v1', check: 'secrets-gitleaks', engine: 'llama.cpp', model: 'fixmodel', project: 'fixarea',
    generated: NOW, artifact: '/reports/sweep-20260302000000-fixarea/alpha/gitleaks.json', artifactTruncated: false, verdictSalvaged: false,
    verdict: { verdict: 'all-false-positives', summary: 's', findings: [{ id: 'src/a.js:5', classification: 'false-positive', reason: 'r' }], caveats: [] },
  };
  assertValid('triage-verdict-record', keep('triage-verdict-record', 'schema', triage), 'a triage verdict record');
  assertValid('triage-verdict-record', { ...triage, project: null, artifact: null, verdictSalvaged: true }, 'a salvaged verdict with no artifact');

  const stage = (verdict) => ({ status: 'done', queuedAt: NOW, startedAt: NOW, finishedAt: NOW, verdict, thinking: null, salvaged: false, raw: null, error: null });
  const analysis = { classification: 'real', investigation: 'i', falsePositiveAnalysis: 'f', remediation: 'r', diff: '', confidence: 'high' };
  const cross = { classification: 'real', agreesWithPeer: true, positionChanged: false, response: 'r', remediation: 'r', diff: '--- a/src/app.js\n+++ b/src/app.js\n', confidence: 'high' };
  const codeql = {
    schema: 'commitwork/codeql-remediation-job.v1', id: '0123456789abcdef', key: 'alpha|codeql.sarif|js/code-injection|src/app.js', project: 'fixarea',
    createdAt: NOW, finding: { service: 'alpha', lifecycle: 'active', sarif: 'codeql.sarif', ruleId: 'js/code-injection', file: 'src/app.js', line: 2 },
    state: 'applied',
    engines: { local: { engine: 'lmstudio', model: 'fixture-model', pinned: false }, review: { engine: 'claude-p', model: 'opus' } },
    stages: { local: stage(analysis), opus: stage(analysis), localCross: stage(cross), opusCross: stage(cross) },
    agreement: { agree: true, classifications: { local: 'real', opus: 'real' }, basis: 'b' },
    remediation: { classification: 'real', executable: true, diff: cross.diff, source: 'opus-cross', summary: 'r' },
    error: null,
    applied: { at: NOW, commit: 'a'.repeat(40), files: ['src/app.js'], message: 'm', resweep: { started: false, reason: 'trigger unavailable to this route' } },
    events: [{ at: NOW, msg: 'pipeline started' }], repoPath: null, sourceNote: 'repository path not resolved on this box — source not read', lodgedAt: NOW, updatedAt: NOW,
  };
  assertValid('codeql-remediation-job', keep('codeql-remediation-job', 'schema', codeql), 'an applied CodeQL job');
  assertValid('codeql-remediation-job', { ...codeql, state: 'stopped', stages: { local: stage(analysis), opus: { status: 'stopped', finishedAt: NOW } },
    agreement: null, remediation: null, applied: null, stoppedAt: NOW, stoppedBy: 'operator' }, 'a stopped CodeQL job');
});

// ── cobolwork remediation job ───────────────────────────────────────────────────────────────────
// The full draft, apply and verify path is validated in lib/test/cobolwork-remediation.test.mjs,
// which runs it against its cobolwork stand-in. This is the job before and after a run cobolwork
// could not start.
test('cobolwork-remediation-job: a queued job, and one cobolwork could not run, validate as written', async () => {
  const d = scratch();
  const root = join(d, 'repo');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'P.cbl'), '       IDENTIFICATION DIVISION.\n');
  const git = (...args) => assert.equal(spawnSync('git', ['-c', 'user.email=f@example.invalid', '-c', 'user.name=f', ...args], { cwd: root }).status, 0, `git ${args[0]}`);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const dir = join(d, 'jobs');
  await withEnvAsync({ CW_NOW: NOW, CW_COBOLWORK_BIN: join(d, 'no-such-cobolwork') }, async () => {
    const job = newJob({ repo: 'fixture', fingerprint: 'b'.repeat(32), engines: { drafter: { engine: 'lmstudio', model: 'm', pinned: false }, reviewer: null } });
    writeJob(dir, job);
    assertValid('cobolwork-remediation-job', readJob(dir, job.id).job, 'a queued job');
    await runJob(dir, job, { repoPath: root, drafter: async () => ({ ok: false, error: 'not reached' }) });
  });
  const { job } = readJob(dir, newJob({ repo: 'fixture', fingerprint: 'b'.repeat(32), engines: {} }).id);
  assert.equal(job.state, 'unscanned', `precondition: ${job.error}`);
  assert.equal(job.unknownReason, 'not-run');
  assertValid('cobolwork-remediation-job', keep('cobolwork-remediation-job', 'schema', job), 'a job cobolwork could not run');
});

// ── refusals ────────────────────────────────────────────────────────────────────────────────────
test('each schema refuses its document with the version removed or changed, or with an unknown top-level key', () => {
  const names = new Set(produced.map((p) => p.name));
  assert.deepEqual([...names].sort(), ['build-health', 'cobolwork-remediation-job', 'codeql-remediation-job', 'cra-refresh-status', 'daily-ledger',
    'digest', 'digest-deliveries', 'feature-census', 'feature-inventory', 'pattern-scan', 'run-scan', 'triage-verdict-record', 'verdict-journal'],
    'precondition: every writer test ran first and kept a document');
  for (const { name, field, doc } of produced) {
    const { [field]: version, ...without } = doc;
    assert.notDeepEqual(errorsOf(name, without), [], `${name}: a document without ${field} was accepted`);
    const bumped = { ...doc, [field]: typeof version === 'number' ? version + 1 : `${version}x` };
    assert.notDeepEqual(errorsOf(name, bumped), [], `${name}: ${field} ${JSON.stringify(bumped[field])} was accepted`);
    if (name !== 'verdict-journal') assert.notDeepEqual(errorsOf(name, { ...doc, unexpected: true }), [], `${name}: an unknown top-level key was accepted`);
  }
});
