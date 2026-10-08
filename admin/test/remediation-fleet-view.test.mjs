// The remediation layer's per-area reads and the fleet page's render, in process: planSummary()
// reads the counts a generated plan states about itself, inputsIn() names every absent input with
// its producer, remediationFleetView() lists every declared area in a fixed order, and the panel's
// own render functions — lifted from the served source — draw that payload without dropping a row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planSummary, inputsIn, remediationFleetView, REMEDIATION_INPUTS } from '../routes/remediation.mjs';
import { panelSource } from './lib/panel-source.mjs';
import { buildRemediationFixture, planText, ALPHA_BATCH, BETA_BATCH } from './lib/remediation-fixture.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-remfleet-view-'));
const FX = buildRemediationFixture(T);
// The prompt catalogue is read through registry() at call time; pin it to the fixture.
process.env.CW_REGISTRY = FX.registryPath;
const NOW = Date.parse('2026-09-27T00:00:00.000Z');
const view = () => remediationFleetView({ reg: FX.reg, root: FX.reports, nowMs: NOW });
const KEYS = REMEDIATION_INPUTS.map((s) => s.key);

// ── the plan's own counts ───────────────────────────────────────────────────────────────────────
test('THE REGRESSION: a generated plan has no bullets, and its package count is not zero', () => {
  const md = planText({ main: [3, 7], low: [1, 2], kev: 1 });
  assert.equal((md.match(/^\s*[-*]\s+/gm) || []).length, 0, 'the tab counted these, so every plan read "0 item(s)"');
  const s = planSummary(md);
  assert.equal(s.parsed, true);
  assert.equal(s.packages, 4);
  assert.equal(s.findings, 9);
  assert.deepEqual(s.main, { packages: 3, findings: 7 });
  assert.deepEqual(s.low, { packages: 1, findings: 2 });
  assert.equal(s.kevPackages, 1);
  assert.equal(s.headline.kev, 1);
  assert.equal(s.generated, '2026-09-01T00:00:00.000Z');
});

test('a zero plan parses to zero; a plan without the headings parses to unknown, never zero', () => {
  const z = planSummary(planText({ main: [0, 0], low: [0, 0] }));
  assert.equal(z.parsed, true);
  assert.equal(z.packages, 0);
  assert.equal(z.kevPackages, 0);
  const u = planSummary('# some other document\n\nno sections here\n');
  assert.equal(u.parsed, false);
  assert.equal(u.packages, undefined, 'an unparsed plan carries no count to be read as zero');
  assert.match(u.why, /unknown, not zero/);
});

// ── per-area inputs ─────────────────────────────────────────────────────────────────────────────
test('each area reads its OWN directory: two synthetic areas, two different answers', () => {
  const a = inputsIn(join(FX.reports, 'alpha'), { root: FX.reports });
  const b = inputsIn(join(FX.reports, 'beta'), { root: FX.reports });
  for (const k of KEYS) assert.equal(a.inputs[k].state, 'ok', `alpha.${k}`);
  assert.equal(a.inputs.plan.summary.packages, 4);
  assert.equal(a.inputs.ledger.entries, 2);
  assert.equal(a.inputs.codeqlFleet.findings, 1);
  assert.equal(a.inputs.batch.source, ALPHA_BATCH, 'a batch named relative to the reports root resolves');
  assert.deepEqual([a.outputs.triage.runs, a.outputs.triage.verdicts], [1, 1]);
  assert.deepEqual(a.outputs.codeqlJobs.byState, { lodged: 1 });
  assert.equal(a.scanners.secrets.total, 2);

  assert.equal(b.inputs.plan.summary.packages, 0);
  assert.equal(b.inputs.rollup.state, 'ok');
  assert.equal(b.inputs.batch.state, 'absent');
  assert.ok(b.inputs.batch.why.includes(BETA_BATCH), 'the missing batch is named, not just counted');
  assert.equal(b.inputs.ledger.state, 'absent');
  assert.equal(b.inputs.codeqlFleet.state, 'absent');
  assert.equal(b.outputs.triage.state, 'absent');
  assert.equal(b.scanners.secrets.total, 0);
});

test('an area with nothing on disk names every input as absent, each with its producer', () => {
  const g = inputsIn(join(FX.reports, 'gamma'), { root: FX.reports });
  for (const k of KEYS) {
    assert.equal(g.inputs[k].state, 'absent', k);
    assert.ok(String(g.inputs[k].producedBy).length > 20, `${k} names no producer`);
  }
  assert.match(g.inputs.rollup.producedBy, /full scan/);
  assert.match(g.inputs.ledger.producedBy, /two scans/);
  assert.equal(g.scanners, null, 'no rollup lends no counts');
});

test('an unreadable input is its own state, never absent', () => {
  const fx = buildRemediationFixture(mkdtempSync(join(tmpdir(), 'cw-remfleet-torn-')));
  writeFileSync(join(fx.reports, 'alpha', 'remediation-ledger.json'), '{"entries": [');
  writeFileSync(join(fx.reports, 'alpha', 'rollup.json'), '{"generated":');
  const r = inputsIn(join(fx.reports, 'alpha'), { root: fx.reports });
  assert.equal(r.inputs.ledger.state, 'unreadable');
  assert.ok(r.inputs.ledger.why, 'the parse error travels');
  assert.equal(r.inputs.rollup.state, 'unreadable');
  assert.equal(r.inputs.batch.state, 'unknown', 'a torn rollup leaves its batch unknown, not absent');
  assert.equal(r.scanners, null, 'a torn rollup lends no counts');
});

// ── the fleet view ──────────────────────────────────────────────────────────────────────────────
test('the fleet lists every declared area, the empty one included, plus the undeclared directory', () => {
  const v = view();
  assert.equal(v.ok, true);
  assert.deepEqual(v.areas.map((a) => a.label), ['Alpha', 'Beta', 'Gamma', 'stray'], 'label order, then report directory');
  assert.deepEqual(v.areas.map((a) => a.declared), [true, true, true, false]);
  const [alpha, beta, gamma, stray] = v.areas;
  assert.deepEqual(alpha.missing, []);
  assert.deepEqual(beta.missing, ['batch', 'ledger', 'codeqlFleet']);
  assert.deepEqual(gamma.missing, KEYS, 'a never-scanned project is a row naming all five, never a dropped row');
  assert.deepEqual(stray.missing, ['plan', 'batch', 'ledger', 'codeqlFleet']);
  assert.equal(alpha.live.secrets.total, 2);
  assert.equal(beta.live.secrets.total, 0);
  assert.deepEqual(gamma.live, {});
  assert.ok(v.catalogue.some((c) => c.check === 'secrets-gitleaks' && c.category === 'secrets'));
  assert.equal(v.generatedAt, '2026-09-27T00:00:00.000Z');
});

test('the fleet view is deterministic: same inputs, byte-identical payload', () => {
  assert.equal(JSON.stringify(view()), JSON.stringify(view()));
});

test('no areas and no reports root is stated, not an empty success', () => {
  const v = remediationFleetView({ reg: { reportsRoot: join(T, 'nowhere'), areas: [] }, root: join(T, 'nowhere'), nowMs: NOW });
  assert.equal(v.ok, true);
  assert.deepEqual(v.areas, []);
  assert.equal(v.undeclaredScan.state, 'absent');
});

// ── the render, lifted from the served panel source ─────────────────────────────────────────────
const SRC = panelSource('index.html');
const lines = SRC.split('\n');
const line = (prefix) => { const l = lines.find((x) => x.startsWith(prefix)); assert.ok(l, `${prefix} not found in the panel source`); return l; };
const constBlock = (name) => {
  const s = lines.findIndex((l) => l.startsWith(`const ${name}=`));
  assert.ok(s > -1, `${name} not found in the panel source`);
  const e = lines.findIndex((l, i) => i >= s && l === '};');
  return lines.slice(s, e + 1).join('\n');
};
const fn = (name) => {
  const at = SRC.indexOf(`function ${name}(`);
  assert.ok(at > -1, `function ${name} not found in the panel source`);
  return SRC.slice(at, SRC.indexOf('\n}', at) + 2);
};
const R = new Function([line('const esc='), line('const pill='), constBlock('covState'),
  ...['rpWeight', 'riPill', 'riDetail', 'roDetail', 'remInputsHtml', 'remFleetHtml'].map(fn),
  'return { remInputsHtml, remFleetHtml };'].join('\n'))();

test('render: every row drawn in the server\'s order, absent inputs named, unknown kept apart from zero', () => {
  const v = view();
  const r = R.remFleetHtml(v);
  assert.equal((r.html.match(/<tr><td>/g) || []).length, 4, 'one row per area, the empty one included');
  const at = (label) => r.html.indexOf(`data-proj="${label}"`);
  assert.ok(at('Alpha') < at('Beta') && at('Beta') < at('Gamma') && at('Gamma') < at('stray'));
  assert.match(r.html, /4 package\(s\) · 9 finding\(s\)/);
  assert.match(r.html, /1 KEV/);
  const secretsPrompts = v.catalogue.filter((c) => c.category === 'secrets').length;
  assert.ok(r.html.includes(`${secretsPrompts} actionable`), 'alpha\'s secrets count reaches the prompt tally through rpWeight');
  assert.match(r.html, /no counts — never scanned/, 'gamma: no rollup is no result, not clean');
  assert.match(r.html, /not in the registry/);
  const gammaRow = r.html.slice(at('Gamma'), at('stray'));
  for (const l of ['latest results', 'fix plan', 'scanner artifacts', 'verified-fix ledger', 'CodeQL findings']) {
    assert.ok(gammaRow.includes(`>${l}</span>`), `gamma's missing ${l} is not named`);
  }
  assert.equal(r.n, '4 projects · 1 with open plan items · 3 missing an input · 2 plan count(s) unknown');
});

test('render: the project Inputs strip names each missing input with what produces it', () => {
  const g = inputsIn(join(FX.reports, 'gamma'), { root: FX.reports });
  const gr = R.remInputsHtml({ ok: true, inputs: KEYS.map((k) => g.inputs[k]), outputs: g.outputs });
  assert.equal(gr.n, '5 of 5 missing');
  assert.match(gr.html, /produced by a full scan of this project/);
  assert.match(gr.html, /none yet/, 'the layer\'s own records say none yet, not missing');
  const a = inputsIn(join(FX.reports, 'alpha'), { root: FX.reports });
  const ar = R.remInputsHtml({ ok: true, inputs: KEYS.map((k) => a.inputs[k]), outputs: a.outputs });
  assert.equal(ar.n, 'all 5 present');
  assert.match(ar.html, /4 package\(s\) · 9 finding\(s\) · 1 on KEV/);
});

test('render: a project that did not resolve, or a route that did not answer, draws no rows', () => {
  const u = R.remInputsHtml({ ok: false, project: { state: 'unselected' }, error: 'no project selected — the remediation layer answers for one project at a time' });
  assert.equal(u.n, 'unknown');
  assert.match(u.html, /no project selected/);
  assert.doesNotMatch(u.html, /pill/);
  const boot = R.remInputsHtml({ projects: [], remediation: [] });
  assert.match(boot.html, /did not answer/);
});

test('render: hostile labels and reasons are escaped', () => {
  const r = R.remFleetHtml({ catalogue: [], areas: [{ label: '<img src=x onerror=alert(1)>', out: 'x', declared: true, state: 'misdeclared', why: '<script>bad()</script>' }] });
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  assert.ok(!r.html.includes('<img') && !r.html.includes('<script>'));
  assert.match(r.html, /&lt;img/);
});
