// monitor/stpa-sweep.mjs, asserted against FIXTURES for every classification. One test reads the
// real default files, and only to prove the sensor is not blind: the dispatch moved out of
// admin/serve.mjs once and the sweep reported an empty closure point with exit 0 for weeks.
// Effect-based: every test proves a classification, not that the tool "ran".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTriggerKinds, extractPolicyGate, extractApplyCheck, classify, runOnce, exitCodeFor, closurePaths, KNOWN_SELECTORS, EXIT } from '../stpa-sweep.mjs';

const SWEEP = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'stpa-sweep.mjs');

// A trimmed but STRUCTURALLY faithful stand-in for admin/serve.mjs's trigger() — same dispatch
// shape (ternary chain, HEALTH[kind] closed map, triggerProject() resolver), different length.
const SAFE_SERVE_FIXTURE = `
function triggerProject(requested) { return 'resolved-safely'; }
const HEALTH = { 'health-all': 'all' };
function trigger(kind, project, opts = {}) {
  const proj = triggerProject(project);
  const args = kind === 'sweep'
    ? ['node', 'sweep.mjs', opts.check || 'all', proj, ...(opts.repo ? ['--repo', opts.repo] : [])].filter(Boolean)
    : kind === 'bola'
      ? ['node', 'bola-sweep.mjs', proj].filter(Boolean)
    : HEALTH[kind]
      ? ['node', 'health-sweep.mjs', HEALTH[kind], proj].filter(Boolean)
      : null;
  return args;
}
`;

// The same shape, but a new kind bypasses triggerProject() and reads a raw request field.
const UNSAFE_SERVE_FIXTURE = `
function triggerProject(requested) { return 'resolved-safely'; }
function trigger(kind, project, opts = {}) {
  const args = kind === 'sweep'
    ? ['node', 'sweep.mjs', proj]
    : kind === 'deploy'
      ? ['node', 'deploy.mjs', opts.target]
      : null;
  return args;
}
`;

// The shape admin/lib/jobs.mjs has had since the job engine left serve.mjs: the ternary chain lives
// in jobArgv(), and trigger() resolves the project and tests kinds in guards that build no argv.
const JOBS_FIXTURE = `
export function triggerProject(requested) { return 'resolved-safely'; }
const HEALTH = { 'health-all': 'all' };
export function jobArgv(kind, proj, opts = {}) {
  // a prose line naming kind === 'ghost' and opts.evil must not become a kind or a reference
  return kind === 'sweep'
    ? ['node', 'sweep.mjs', opts.check || 'all', proj, ...(opts.repo ? ['--repo', opts.repo] : [])].filter(Boolean)
    : kind === 'bola'
      ? ['node', 'bola-sweep.mjs', proj].filter(Boolean)
    : kind === 'install-tools'
      ? ['node', 'commitwork.mjs', 'setup', ...(opts.only?.length ? ['--only', opts.only.join(',')] : [])]
    : kind === 'scan-path'
      ? (opts.out && (opts.pc || opts.path) ? ['node', 'commitwork.mjs', 'brief', '--root', opts.path, '--out', opts.out] : null)
    : HEALTH[kind]
      ? ['node', 'health-sweep.mjs', HEALTH[kind], proj].filter(Boolean)
      : null;
}

export function trigger(kind, project, opts = {}) {
  if ((kind === 'sweep' || HEALTH[kind]) && !String(project || '').trim()) return { started: false };
  const proj = kind === 'scan-path' ? '' : triggerProject(project);
  const args = jobArgv(kind, proj, opts);
  const override = kind === 'sweep' ? 1 : null;
  return { args, override };
}
`;

const NO_DISPATCH_FIXTURE = 'export const routes = [];\n';

const GATED_POLICY_FIXTURE = `
const API_SETTABLE_MODES = new Set(['report', 'hitl-item']);
export const routes = [
  { method: 'POST', path: '/api/remediation-policy', handle: (ctx) => {
    if (doc.mode !== undefined && MODES.includes(doc.mode) && !API_SETTABLE_MODES.has(doc.mode)) {
      return send(403, { ok: false, error: 'escalation refused' });
    }
    if (doc.m3 && doc.m3.autoMerge === true) {
      return send(403, { ok: false, error: 'autoMerge refused' });
    }
  } },
];
`;

const UNGATED_POLICY_FIXTURE = `
const API_SETTABLE_MODES = new Set(['report', 'hitl-item', 'agentic-apply']);
export const routes = [];
`;

const APPLY_CHECK_FIXTURE = `
const chk = git(['apply', '--check', '--whitespace=nowarn', patch]);
if (chk.status !== 0) return fail('refused');
`;

const NO_APPLY_CHECK_FIXTURE = `
const ap = git(['apply', patch]);
`;

test('extractTriggerKinds: a resolver-gated dispatch classifies every kind as allowlist-safe', () => {
  const rows = extractTriggerKinds(SAFE_SERVE_FIXTURE);
  const kinds = rows.map((r) => r.kind);
  assert.ok(kinds.includes('sweep'), 'did not find the sweep kind');
  assert.ok(kinds.includes('bola'), 'did not find the bola kind');
  assert.ok(kinds.includes('health-*'), 'did not find the closed HEALTH map');
  for (const r of rows) assert.ok(['allowlist', 'closed-map'].includes(r.argvSource), `${r.kind} was not classified safe: ${r.detail}`);
});

test('extractTriggerKinds: a kind referencing a raw opts field is unclassified, never fabricated safe', () => {
  const rows = extractTriggerKinds(UNSAFE_SERVE_FIXTURE);
  const deploy = rows.find((r) => r.kind === 'deploy');
  assert.ok(deploy, 'did not find the deploy kind');
  assert.equal(deploy.argvSource, 'unclassified', 'a raw opts.target reference was classified safe — that is fabrication');
});

test('extractTriggerKinds: the jobArgv shape is scoped to the dispatch, deduplicated and read past its comments', () => {
  const rows = extractTriggerKinds(JOBS_FIXTURE);
  assert.deepEqual(rows.map((r) => r.kind), ['sweep', 'bola', 'install-tools', 'scan-path', 'health-*'], 'guards in trigger() and prose in comments are not kinds');
  const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
  for (const k of ['sweep', 'bola']) assert.equal(by[k].argvSource, 'allowlist', `${k}: ${by[k].suggestion}`);
  assert.equal(by['health-*'].argvSource, 'closed-map');
  assert.equal(by['install-tools'].argvSource, 'unclassified');
  assert.match(by['install-tools'].suggestion, /argv reads opts\.only — .*KNOWN_SELECTORS/);
  assert.equal(by['scan-path'].argvSource, 'unclassified');
  assert.match(by['scan-path'].suggestion, /argv reads opts\.out, opts\.pc, opts\.path/);
  assert.doesNotMatch(JSON.stringify(rows), /ghost|opts\.evil/);
  assert.ok(rows.filter((r) => r.argvSource !== 'unclassified').every((r) => !('suggestion' in r)), 'a classified row carries no suggestion');
  assert.deepEqual([...KNOWN_SELECTORS], ['check', 'repo', 'label']);
});

test('extractTriggerKinds: a resolver that is declared but is not what trigger() passes classifies nothing safe', () => {
  const rows = extractTriggerKinds(JOBS_FIXTURE.replace('jobArgv(kind, proj, opts)', 'jobArgv(kind, project, opts)'));
  const kinds = rows.filter((r) => r.kind !== 'health-*');
  assert.equal(kinds.length, 4);
  for (const r of kinds) {
    assert.equal(r.argvSource, 'unclassified', r.kind);
    assert.match(r.suggestion, /no variable assigned from triggerProject\(\) reaches the dispatch/);
  }
});

test('extractTriggerKinds: a known selector beside an unknown field does not excuse the unknown one', () => {
  const rows = extractTriggerKinds(JOBS_FIXTURE.replace("opts.check || 'all', proj,", "opts.check || 'all', proj, opts.extra,"));
  const sweep = rows.find((r) => r.kind === 'sweep');
  assert.equal(sweep.argvSource, 'unclassified', 'opts.check in the same branch used to make the whole branch read safe');
  assert.match(sweep.suggestion, /argv reads opts\.extra —/);
});

test('extractPolicyGate: a gated policy file reads both escalation gates as true', () => {
  const g = extractPolicyGate(GATED_POLICY_FIXTURE);
  assert.deepEqual(g.settableModes, ['report', 'hitl-item']);
  assert.equal(g.modeEscalationGated, true);
  assert.equal(g.autoMergeGated, true);
});

test('extractPolicyGate: an ungated file with a THIRD settable mode is caught, not silently passed', () => {
  const g = extractPolicyGate(UNGATED_POLICY_FIXTURE);
  assert.deepEqual(g.settableModes, ['report', 'hitl-item', 'agentic-apply'], 'the third mode must be visible in the extraction, not hidden');
  assert.equal(g.modeEscalationGated, false, 'no 403 gate exists in this fixture — must not be reported as gated');
});

test('extractApplyCheck: finds a real git apply --check call', () => {
  assert.equal(extractApplyCheck(APPLY_CHECK_FIXTURE).hasApplyCheck, true);
});

test('extractApplyCheck: an apply with no --check is flagged as missing, not assumed present', () => {
  assert.equal(extractApplyCheck(NO_APPLY_CHECK_FIXTURE).hasApplyCheck, false);
});

test('classify: a closed-map kind (HEALTH[kind]) classifies safe, not merely extracts safe', () => {
  // Regression: extractTriggerKinds correctly labels HEALTH[kind] 'closed-map', but the first build
  // of classify() only recognised 'allowlist' as safe -- caught by running the real tool against
  // admin/serve.mjs, where health-* came back UNCLASSIFIED despite being legitimately closed. A
  // fixture-only test suite did not catch this; the positive control against real source did.
  const rows = classify({
    triggerKinds: extractTriggerKinds(SAFE_SERVE_FIXTURE),
    policyGate: extractPolicyGate(GATED_POLICY_FIXTURE),
    applyCheck: extractApplyCheck(APPLY_CHECK_FIXTURE),
  });
  const health = rows.find((r) => r.subject.includes('health-*'));
  assert.ok(health, 'no row for the health-* closed map');
  assert.equal(health.verdict, 'classified-safe', 'a closed object literal must classify safe, not unclassified');
});

test('classify: a fully-safe fixture set produces zero "flagged" rows and one permanent open finding', () => {
  const rows = classify({
    triggerKinds: extractTriggerKinds(SAFE_SERVE_FIXTURE),
    policyGate: extractPolicyGate(GATED_POLICY_FIXTURE),
    applyCheck: extractApplyCheck(APPLY_CHECK_FIXTURE),
  });
  assert.equal(rows.filter((r) => r.verdict === 'flagged').length, 0);
  assert.equal(rows.filter((r) => r.verdict === 'open-finding').length, 1, 'the ADVERSARIAL row must always be present — it is a stated gap, not a solved one');
});

test('classify: an ungated policy file produces a FLAGGED row, not a silent pass', () => {
  const rows = classify({
    triggerKinds: extractTriggerKinds(SAFE_SERVE_FIXTURE),
    policyGate: extractPolicyGate(UNGATED_POLICY_FIXTURE),
    applyCheck: extractApplyCheck(APPLY_CHECK_FIXTURE),
  });
  const flagged = rows.filter((r) => r.verdict === 'flagged');
  assert.ok(flagged.length >= 1, 'an ungated escalation path produced zero flagged rows');
});

test('classify: an unreadable closure point makes the cross-check row unclassified, not safe-by-default', () => {
  const rows = classify({
    triggerKinds: [],
    policyGate: extractPolicyGate(GATED_POLICY_FIXTURE),
    applyCheck: extractApplyCheck(APPLY_CHECK_FIXTURE),
  });
  const crossCheck = rows.find((r) => r.uca === 'UCA7\'');
  assert.equal(crossCheck.verdict, 'unclassified', 'zero trigger kinds found must not still cross-check as safe');
});

test('runOnce: reads three fixture paths via explicit override and never touches the real repo files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-stpa-fixture-'));
  try {
    const sp = join(dir, 'serve.mjs'); writeFileSync(sp, SAFE_SERVE_FIXTURE);
    const pp = join(dir, 'policy.mjs'); writeFileSync(pp, GATED_POLICY_FIXTURE);
    const ap = join(dir, 'apply.mjs'); writeFileSync(ap, APPLY_CHECK_FIXTURE);
    const result = runOnce({ servePath: sp, policyPath: pp, applyPath: ap });
    assert.equal(result.summary.flagged, 0);
    assert.ok(result.summary.total > 0);
    assert.ok(Array.isArray(result.rows));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── conservation, step 4 of the spec's build sequence ────────────────────────────────────────────
// Mirrors SC3 of the shipped CAPEC/ATT&CK analysis ("no total changes when enrichment is on/off"):
// this tool's own output must be a pure function of the source it reads. Two runs against an
// UNCHANGED tree must produce byte-identical rows (the `at` timestamp is the one field allowed to
// differ) — a re-derivable classifier that drifts between identical runs would be worse than a
// static doc, because it would look authoritative while being unstable.
test('CONSERVATION: two runs against an unchanged tree produce identical rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-stpa-conservation-'));
  try {
    const sp = join(dir, 'serve.mjs'); writeFileSync(sp, SAFE_SERVE_FIXTURE);
    const pp = join(dir, 'policy.mjs'); writeFileSync(pp, GATED_POLICY_FIXTURE);
    const ap = join(dir, 'apply.mjs'); writeFileSync(ap, APPLY_CHECK_FIXTURE);
    const paths = { servePath: sp, policyPath: pp, applyPath: ap };
    const r1 = runOnce(paths);
    const r2 = runOnce(paths);
    assert.deepEqual(r1.rows, r2.rows, 'rows differed across two runs against the SAME unchanged source — the classifier is not deterministic');
    assert.deepEqual(r1.summary, r2.summary);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// NEGATIVE CONTROL for the conservation test above: a real source change MUST move the output, or
// the "conservation" test would be vacuously true (passing because nothing the tool reads ever
// actually varies) — the same discipline bin/upstream-fetch.mjs's chain tests apply with their own
// POSITIVE CONTROL tampering tests.
test('CONSERVATION negative control: a real source change DOES move the output (the test above is not vacuous)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-stpa-conservation-neg-'));
  try {
    const sp = join(dir, 'serve.mjs'); writeFileSync(sp, SAFE_SERVE_FIXTURE);
    const pp = join(dir, 'policy.mjs'); writeFileSync(pp, GATED_POLICY_FIXTURE);
    const ap = join(dir, 'apply.mjs'); writeFileSync(ap, APPLY_CHECK_FIXTURE);
    const paths = { servePath: sp, policyPath: pp, applyPath: ap };
    const before = runOnce(paths);
    writeFileSync(pp, UNGATED_POLICY_FIXTURE); // remove the escalation gate
    const after = runOnce(paths);
    assert.notDeepEqual(before.rows, after.rows, 'removing the escalation gate did not change the output — the conservation test above cannot be trusted if nothing here ever moves');
    assert.equal(after.summary.flagged > before.summary.flagged, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the exit contract: 0 clean · 1 flagged · 2 failed · 3 open findings · 4 unclassified ──────────
// Until 2026-09-16 open-finding rows never reached the exit: a run whose only non-safe row was the
// permanent ++ADVERSARIAL finding exited 0, and every caller that read "0 = clean" was told the
// loop was clean by a sweep that had just named an open finding. Until 2026-10-04 the same was true
// of unclassified rows, and a dispatch that had moved files read as a clean loop.

test('exitCodeFor: flagged beats unclassified, unclassified beats open findings, open findings beat clean', () => {
  assert.equal(exitCodeFor({ flagged: 0, unclassified: 0, openFindings: 0 }), EXIT.clean);
  assert.equal(exitCodeFor({ flagged: 0, unclassified: 0, openFindings: 1 }), EXIT.openFindings);
  assert.equal(exitCodeFor({ flagged: 1, unclassified: 0, openFindings: 1 }), EXIT.flagged, 'one flagged row must win over open findings');
  assert.equal(exitCodeFor({ flagged: 0, unclassified: 3, openFindings: 0 }), EXIT.unclassified, 'a closure point nobody checked is a warning, never a clean exit');
  assert.equal(exitCodeFor({ flagged: 0, unclassified: 1, openFindings: 1 }), EXIT.unclassified, 'an unchecked point outranks a gap already named');
  assert.equal(exitCodeFor({ flagged: 1, unclassified: 2, openFindings: 0 }), EXIT.flagged);
  assert.deepEqual(EXIT, { clean: 0, flagged: 21, failed: 2, openFindings: 23, unclassified: 24 });
});

// The import sits mid-line on purpose: bin/lib/tracked-imports.mjs reads a line-anchored `import`
// inside this fixture as a real import of this test file, and extractEnvelope() only needs the
// specifier present, not a parseable module.
const ENVELOPED_APPLY_FIXTURE = `
const enveloped = true; import { envelope } from '../../lib/prompt-envelope.mjs';
function findingBlock(f) { return envelope(f.text); }
${APPLY_CHECK_FIXTURE}`;

const ENVELOPED_REMED_FIXTURE = `
const enveloped = true; import { envelope } from '../../lib/prompt-envelope.mjs';
async function runLocalModel(artifactText) { return envelope(artifactText); }
`;

// Spawns the real CLI against fixtures only: every source path and the witness are env-overridden,
// and CW_STPA_OUT keeps the report out of reports/.
function runCli({ serve = SAFE_SERVE_FIXTURE, policy = GATED_POLICY_FIXTURE, apply = APPLY_CHECK_FIXTURE, remed = 'export const routes = [];', witness = null, serveMissing = false, extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-stpa-cli-'));
  try {
    const sp = join(dir, 'serve.mjs'); if (!serveMissing) writeFileSync(sp, serve);
    const pp = join(dir, 'policy.mjs'); writeFileSync(pp, policy);
    const ap = join(dir, 'apply.mjs'); writeFileSync(ap, apply);
    const rp = join(dir, 'remed.mjs'); writeFileSync(rp, remed);
    const wp = join(dir, 'witness.json'); if (witness) writeFileSync(wp, JSON.stringify(witness));
    for (const [rel, body] of Object.entries(extra)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); }
    const out = join(dir, 'out');
    const r = spawnSync(process.execPath, [SWEEP], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CW_STPA_SERVE_PATH: sp, CW_STPA_POLICY_PATH: pp, CW_STPA_APPLY_PATH: ap, CW_STPA_REMED_PATH: rp,
        CW_STPA_ENVELOPE_WITNESS: wp, CW_STPA_OUT: out, CW_NOW: '2026-09-15T01:00:00.000Z',
      },
    });
    let wrote = []; let report = null;
    try { wrote = readdirSync(out); if (wrote.length === 1) report = JSON.parse(readFileSync(join(out, wrote[0]), 'utf8')); } catch { wrote = null; }
    return { status: r.status, stdout: r.stdout, wrote, report };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('CLI exit 23: safe closure points, no live witness — the ADVERSARIAL finding is open and nothing is flagged', () => {
  const r = runCli();
  assert.equal(r.status, EXIT.openFindings, `exit ${r.status}:\n${r.stdout}`);
  assert.match(r.stdout, /OPEN\s+\+\+ADVERSARIAL/);
  assert.doesNotMatch(r.stdout, /^\[stpa\] FLAG/m, 'nothing should be flagged in the safe fixture set');
  assert.match(r.stdout, /1 open finding\(s\), nothing flagged — exit 23/);
  assert.equal(r.wrote?.length, 1, 'the report is still written on exit 23');
});

test('CLI exit 21: a flagged row wins over the open finding that is also present', () => {
  const r = runCli({ policy: UNGATED_POLICY_FIXTURE });
  assert.equal(r.status, EXIT.flagged, `exit ${r.status}:\n${r.stdout}`);
  assert.match(r.stdout, /^\[stpa\] FLAG/m);
  assert.match(r.stdout, /OPEN\s+\+\+ADVERSARIAL/, 'the open finding is still reported alongside the flag');
});

test('CLI exit 2: an unreadable closure point is a failed sweep, never 0 and never 23', () => {
  const r = runCli({ serveMissing: true });
  assert.equal(r.status, 2, `exit ${r.status}:\n${r.stdout}`);
  assert.match(r.stdout, /FAILED: /);
  assert.equal(r.wrote, null, 'a failed sweep writes no report');
});

test('CLI exit 0: enveloped machine paths plus a fresh witness close the ADVERSARIAL row — the only way to exit 0', () => {
  const r = runCli({ apply: ENVELOPED_APPLY_FIXTURE, remed: ENVELOPED_REMED_FIXTURE, witness: { pass: true, at: '2026-09-15T00:00:00.000Z' } });
  assert.equal(r.status, 0, `exit ${r.status}:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /^\[stpa\] (?:FLAG|OPEN)/m);
  // negative control: the same fixtures with a STALE witness go back to 3, so the 0 above is earned
  const stale = runCli({ apply: ENVELOPED_APPLY_FIXTURE, remed: ENVELOPED_REMED_FIXTURE, witness: { pass: true, at: '2026-08-01T00:00:00.000Z' } });
  assert.equal(stale.status, EXIT.openFindings, `stale witness exit ${stale.status}:\n${stale.stdout}`);
});

// ── exit 24: an unclassified closure point is a warning, with the fix where one can be derived ────
const FRESH = { pass: true, at: '2026-09-15T00:00:00.000Z' };

test('CLI exit 24: a dispatch that moved is a warning naming the file it moved to, never a clean 0', () => {
  const r = runCli({ serve: NO_DISPATCH_FIXTURE, apply: ENVELOPED_APPLY_FIXTURE, remed: ENVELOPED_REMED_FIXTURE, witness: FRESH,
    extra: { 'lib/jobs.mjs': JOBS_FIXTURE, 'test/decoy.mjs': JOBS_FIXTURE } });
  assert.equal(r.status, EXIT.unclassified, `exit ${r.status}:\n${r.stdout}`);
  assert.match(r.stdout, /UNCL\s+UCA1'\s+trigger\(\) dispatch/);
  assert.match(r.stdout, /WARN\s+2 row\(s\) unclassified/);
  assert.match(r.stdout, /HINT\s+UCA1'\s+trigger\(\) dispatch — the job-kind dispatch is declared in \S+\/lib\/jobs\.mjs — set CW_STPA_SERVE_PATH/);
  assert.doesNotMatch(r.stdout, /decoy/, 'a test tree is not where a closure point lives');
  assert.match(r.stdout, /2 unclassified row\(s\), nothing flagged — exit 24/);
  const row = r.report.rows.find((x) => x.subject === 'trigger() dispatch');
  assert.match(row.suggestion, /lib\/jobs\.mjs/, 'the suggestion travels in the report, not only the log');
  assert.ok(r.report.rows.filter((x) => x.verdict !== 'unclassified').every((x) => !('suggestion' in x)));
});

test('CLI: 4 beats 3 and 1 beats 4, and a point with nowhere to point says so', () => {
  const stale = runCli({ serve: NO_DISPATCH_FIXTURE, apply: ENVELOPED_APPLY_FIXTURE, remed: ENVELOPED_REMED_FIXTURE, witness: { pass: true, at: '2026-08-01T00:00:00.000Z' } });
  assert.equal(stale.status, EXIT.unclassified, `exit ${stale.status}:\n${stale.stdout}`);
  assert.match(stale.stdout, /OPEN\s+\+\+ADVERSARIAL/, 'the open finding is still reported beside the warning');
  assert.match(stale.stdout, /HINT\s+UCA1'.* — no file under \S+\/ declares the job-kind dispatch — the closure point may have been removed/);
  const flagged = runCli({ serve: NO_DISPATCH_FIXTURE, policy: UNGATED_POLICY_FIXTURE });
  assert.equal(flagged.status, EXIT.flagged, `exit ${flagged.status}:\n${flagged.stdout}`);
  assert.match(flagged.stdout, /WARN\s+2 row\(s\) unclassified/, 'the warning is still printed under a flag');
});

test('CLI exit 24: an unknown argv field in the dispatch is named in the hint', () => {
  const r = runCli({ serve: JOBS_FIXTURE, apply: ENVELOPED_APPLY_FIXTURE, remed: ENVELOPED_REMED_FIXTURE, witness: FRESH });
  assert.equal(r.status, EXIT.unclassified, `exit ${r.status}:\n${r.stdout}`);
  assert.match(r.stdout, /HINT\s+UCA1'\s+trigger kind "scan-path" — argv reads opts\.out, opts\.pc, opts\.path/);
  assert.match(r.stdout, /OK\s+UCA7'/, 'the closure points were all readable; only two kinds are unchecked');
});

test('runOnce: a policy gate that moved gets its file named, and an apply check that is gone says so', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-stpa-moved-'));
  try {
    const sp = join(dir, 'serve.mjs'); writeFileSync(sp, SAFE_SERVE_FIXTURE);
    const pp = join(dir, 'policy.mjs'); writeFileSync(pp, 'export const routes = [];');
    const ap = join(dir, 'apply.mjs'); writeFileSync(ap, NO_APPLY_CHECK_FIXTURE);
    mkdirSync(join(dir, 'routes')); writeFileSync(join(dir, 'routes', 'policy-gate.mjs'), GATED_POLICY_FIXTURE);
    const { rows, summary } = runOnce({ servePath: sp, policyPath: pp, applyPath: ap });
    const policy = rows.filter((r) => r.uca === 'UCA2\'');
    assert.equal(policy.length, 2);
    for (const r of policy) {
      assert.equal(r.verdict, 'unclassified');
      assert.match(r.suggestion, /API_SETTABLE_MODES is declared in \S+\/routes\/policy-gate\.mjs — set CW_STPA_POLICY_PATH/);
    }
    const apply = rows.find((r) => r.subject === 'diff apply-time re-check');
    assert.equal(apply.verdict, 'unclassified');
    assert.match(apply.suggestion, /no file under \S+\/ declares the `git apply --check` call/);
    assert.equal(exitCodeFor(summary), EXIT.unclassified);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── second witness: the sensor is not blind on the real tree ─────────────────────────────────────
// Fixtures prove how a shape is classified; they cannot notice that the real closure point left the
// file the sweep reads. This asserts presence only, never a verdict, so a new job kind does not
// redden it and a moved dispatch does.
test('SECOND WITNESS: the default files still carry their closure points', () => {
  const p = closurePaths();
  const kinds = extractTriggerKinds(readFileSync(p.serve, 'utf8')).filter((k) => k.kind !== 'health-*');
  assert.ok(kinds.length >= 3, `${kinds.length} job kind(s) found in ${p.serve} — the dispatch moved, and the sweep is blind until its default follows`);
  assert.notEqual(extractPolicyGate(readFileSync(p.policy, 'utf8')).settableModes, null, `API_SETTABLE_MODES is not in ${p.policy}`);
  assert.equal(extractApplyCheck(readFileSync(p.apply, 'utf8')).hasApplyCheck, true, `no git apply --check in ${p.apply}`);
});
