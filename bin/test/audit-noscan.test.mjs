// Pins the four Part C bin/audit.mjs silent-green defects (R20) — the class F8/F1 closed in
// commitwork.mjs. G.3/R20's predicate: no handler OR unparseable artifact ⇒ noscan; the two
// halves are pinned separately because conflating them is exactly the guarded bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyFindings, hasTestCoverage, resolveOpenapi, runTool } from '../audit.mjs';

const T = () => mkdtempSync(join(tmpdir(), 'audit-noscan-'));
const write = (dir, name, data) => { const p = join(dir, name); writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data)); return p; };

// ═══════════════════════════════════════════════════════════════════════════
// Defect 1 (HIGH L110) + G.3 predicate — classifyFindings
// ═══════════════════════════════════════════════════════════════════════════

// ── half 1 of the predicate: NO HANDLER ──────────────────────────────────────
test('G.3 half 1 — an UNHANDLED format (docker-bench/text) is noscan even with a report file present', () => {
  const rd = T();
  // a real docker-bench report full of WARN/FAIL lines
  write(rd, 'docker-bench.log', '[WARN] 4.1  Ensure a user for the container has been created\n[FAIL] 5.9  Enable AppArmor Profile\n');
  const r = classifyFindings({ id: 'docker-bench', report: 'text', category: 'host-hardening' }, rd);
  assert.equal(r.noscan, true, 'an unhandled format must noscan, never silently score 0 findings');
  assert.match(r.reason, /no parser for report format 'text'/);
});

test('G.3 half 1 — testssl/json, schemathesis/text, prowler/json, falco/stream are all honestly unhandled', () => {
  for (const [id, report] of [['testssl', 'json'], ['schemathesis', 'text'], ['prowler', 'json'], ['falco', 'stream']]) {
    const rd = T();
    write(rd, `${id}.out`, 'irrelevant — no handler exists for this shape yet');
    const r = classifyFindings({ id, report, category: 'x' }, rd);
    assert.equal(r.noscan, true, `${id} (${report}) must noscan — no fabricated parse of an unverified shape`);
  }
});

// ── half 2 of the predicate: HANDLED format, artifact could not be parsed ────
test("G.3 half 2 — a HANDLED format (sarif) with a CORRUPT artifact is noscan, not a false clean", () => {
  const rd = T();
  write(rd, 'gitleaks.sarif', '{not valid json!!'); // truncated/corrupt write — the C3-class case
  const r = classifyFindings({ id: 'gitleaks', report: 'sarif', category: 'secrets' }, rd);
  assert.equal(r.noscan, true);
  assert.match(r.reason, /unparseable sarif|corrupt/);
  // must NOT be confused with the "no handler" branch — sarif IS handled
  assert.doesNotMatch(r.reason, /no parser for report format/);
});

test('G.3 half 2 — a HANDLED format (sarif) with a MISSING artifact is noscan', () => {
  const rd = T(); // empty dir — the tool never wrote anything
  const r = classifyFindings({ id: 'semgrep', report: 'sarif', category: 'sast' }, rd);
  assert.equal(r.noscan, true);
  assert.match(r.reason, /no \.sarif report written/);
});

test('G.3 half 2 — a HANDLED format (sbom) with a CORRUPT artifact is noscan', () => {
  const rd = T();
  write(rd, 'sbom.cdx.json', '{"components": [ this is not json');
  const r = classifyFindings({ id: 'syft', report: 'sbom' }, rd);
  assert.equal(r.noscan, true);
  assert.match(r.reason, /unparseable sbom/);
});

test('G.3 half 2 — a HANDLED format (sbom) with garbage JSON that is not a CycloneDX doc is noscan', () => {
  const rd = T();
  write(rd, 'sbom.cdx.json', { totally: 'unrelated', shape: true });
  const r = classifyFindings({ id: 'syft', report: 'sbom' }, rd);
  assert.equal(r.noscan, true);
  assert.match(r.reason, /not a CycloneDX document/);
});

// ── regression guards: a genuinely clean / genuinely dirty handled report still classifies correctly ──
test('sarif with real findings still buckets severity (secrets floor to high)', () => {
  const rd = T();
  write(rd, 'gitleaks.sarif', { runs: [{ tool: { driver: { rules: [] } }, results: [{ ruleId: 'aws-key', level: 'warning' }] }] });
  const r = classifyFindings({ id: 'gitleaks', report: 'sarif', category: 'secrets' }, rd);
  assert.equal(r.noscan, false);
  assert.equal(r.sev.high, 1, 'a secret-shaped finding must never default to medium');
});

test('sarif with zero results is a genuinely clean scan, not noscan', () => {
  const rd = T();
  write(rd, 'semgrep.sarif', { runs: [{ tool: { driver: { name: 'semgrep', rules: [] } }, results: [] }] });
  const r = classifyFindings({ id: 'semgrep', report: 'sarif', category: 'sast' }, rd);
  assert.equal(r.noscan, false);
  assert.deepEqual(r.sev, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
});

// Real syft shape: CycloneDX OMITS the `components` key entirely for a zero-dependency project —
// a components==null ⇒ noscan check would falsely void every dependency-free project.
test('sbom with the components KEY OMITTED (real syft zero-dependency shape) is a clean 0, not noscan', () => {
  const rd = T();
  write(rd, 'sbom.cdx.json', { bomFormat: 'CycloneDX', specVersion: '1.7', metadata: {} }); // no `components` key at all
  const r = classifyFindings({ id: 'syft', report: 'sbom' }, rd);
  assert.equal(r.noscan, false, 'a real, valid, zero-dependency CycloneDX doc must not be voided');
  assert.match(r.note, /0 components/);
});

test('sbom with components present counts them', () => {
  const rd = T();
  write(rd, 'sbom.cdx.json', { bomFormat: 'CycloneDX', components: [{ name: 'a' }, { name: 'b' }] });
  const r = classifyFindings({ id: 'syft', report: 'sbom' }, rd);
  assert.equal(r.noscan, false);
  assert.match(r.note, /2 components/);
});

test('nuclei (HANDLERS_BY_ID override on a generic "json" format) scores JSONL severity, mirroring commitwork.mjs', () => {
  const rd = T();
  const live = JSON.stringify({ 'template-id': 't1', info: { severity: 'high' }, type: 'http', 'matched-at': 'http://x/a', response: 'HTTP/1.1 200 OK\r\n\r\n{}' });
  const dead = JSON.stringify({ 'template-id': 'ghost', info: { severity: 'critical' }, type: 'http', 'matched-at': 'http://x/nope', response: 'HTTP/1.1 404 Not Found\r\n\r\n{}' });
  write(rd, 'nuclei.json', [live, dead].join('\n'));
  const r = classifyFindings({ id: 'nuclei', report: 'json', category: 'dast-templated' }, rd);
  assert.equal(r.noscan, false);
  assert.equal(r.sev.high, 1, 'only the 200-response finding is live');
  assert.match(r.note, /unconfirmed/, 'the 404 match is surfaced, not silently dropped');
});

test('nuclei with an empty (genuinely clean) report is ok, not noscan', () => {
  const rd = T();
  write(rd, 'nuclei.json', '');
  const r = classifyFindings({ id: 'nuclei', report: 'json' }, rd);
  assert.equal(r.noscan, false);
  assert.equal(r.note, '0');
});

test('nuclei with unparseable garbage (no valid JSONL lines at all) is noscan', () => {
  const rd = T();
  write(rd, 'nuclei.json', 'not json\nstill not json\n');
  const r = classifyFindings({ id: 'nuclei', report: 'json' }, rd);
  assert.equal(r.noscan, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// Defect 2 (MED L104) — runTool: exit status / error / timeout classification
// ═══════════════════════════════════════════════════════════════════════════

test('runTool: a tool invocation that EXITS NONZERO classifies as noscan (void), not ran', () => {
  const outDir = T();
  const f = runTool({ id: 'boom', report: 'sarif', run: 'exit 3' }, { project: T(), outDir, url: '', foundOpenapi: null });
  assert.equal(f.noscan, true);
  assert.match(f.reason, /exited 3/);
  assert.equal(f.run.status, 3);
});

test('runTool: a tool invocation KILLED BY TIMEOUT classifies as noscan (void), not ran', () => {
  const outDir = T();
  // short test-controlled timeout — still a REAL spawnSync timeout kill
  const f = runTool({ id: 'slowpoke', report: 'sarif', run: 'sleep 5' }, { project: T(), outDir, url: '', foundOpenapi: null, timeoutMs: 200 });
  assert.equal(f.noscan, true);
  assert.match(f.reason, /did not complete/);
  assert.equal(f.run.error, 'ETIMEDOUT');
  assert.equal(f.run.status, null);
});

test('runTool: exit 0 with NO report written still reaches noscan via classifyFindings (both layers agree)', () => {
  const outDir = T();
  const f = runTool({ id: 'quiet', report: 'sarif', run: 'true' }, { project: T(), outDir, url: '', foundOpenapi: null });
  assert.equal(f.noscan, true);
  assert.match(f.reason, /no \.sarif report written/);
});

test('runTool: exit 0 with a real, valid report is NOT noscan (happy-path regression guard)', () => {
  const outDir = T();
  const project = T();
  // pre-write a valid sarif where runTool will look, then run a no-op exit-0 command
  const rd = join(outDir, 'happy');
  mkdirSync(rd, { recursive: true });
  write(rd, 'happy.sarif', { runs: [{ tool: { driver: { rules: [] } }, results: [{ ruleId: 'r1', level: 'error' }] }] });
  const f = runTool({ id: 'happy', report: 'sarif', category: 'sast', run: 'true' }, { project, outDir, url: '', foundOpenapi: null });
  assert.equal(f.noscan, false);
  assert.equal(f.sev.high, 1);
  assert.equal(f.run.status, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Defect 3 (MED L178) — hasTestCoverage: bounded tree walk, not root-only / not the dead `exts` clause
// ═══════════════════════════════════════════════════════════════════════════

test('hasTestCoverage: an EMPTY tree has no coverage — the void MUST be raised', () => {
  const project = T();
  assert.equal(hasTestCoverage(project), false);
});

test('hasTestCoverage: tests ONLY under src/test/java (JVM layout, not top-level) — the void must NOT be raised', () => {
  const project = T();
  mkdirSync(join(project, 'src', 'test', 'java', 'com', 'example'), { recursive: true });
  write(join(project, 'src', 'test', 'java', 'com', 'example'), 'FooTest.java', 'class FooTest {}');
  assert.equal(hasTestCoverage(project), true, 'a JVM src/test/java dir must be detected below the root');
});

test('hasTestCoverage: tests under services/*/src/test (monorepo layout) — the void must NOT be raised', () => {
  const project = T();
  mkdirSync(join(project, 'services', 'payments-svc', 'src', 'test', 'java'), { recursive: true });
  assert.equal(hasTestCoverage(project), true, 'a monorepo service test dir must be detected below the root');
});

test('hasTestCoverage: a root-level *.test.js file is detected (the dead `exts` clause replacement)', () => {
  const project = T();
  write(project, 'foo.test.js', '// test');
  assert.equal(hasTestCoverage(project), true);
});

test('hasTestCoverage: an unrelated file that merely contains "test" as a substring does NOT count (precision guard)', () => {
  const project = T();
  write(project, 'testing-notes.txt', 'not a test file');
  write(project, 'attestation.json', '{}');
  assert.equal(hasTestCoverage(project), false, 'a loose substring match would be a false green, not a fix');
});

// ═══════════════════════════════════════════════════════════════════════════
// Defect 4 (LOW) — resolveOpenapi: openapi.json/.yml, and the docs/api DIRECTORY fallback is gone
// ═══════════════════════════════════════════════════════════════════════════

test('resolveOpenapi: an explicit --openapi arg always wins', () => {
  assert.equal(resolveOpenapi(T(), '/some/explicit/path.yaml'), '/some/explicit/path.yaml');
});

test('resolveOpenapi: openapi.json at the root is found (the old code checked only .yaml)', () => {
  const project = T();
  write(project, 'openapi.json', '{}');
  assert.equal(resolveOpenapi(project, undefined), 'openapi.json');
});

test('resolveOpenapi: openapi.yml (short extension) at the root is found', () => {
  const project = T();
  write(project, 'openapi.yml', 'openapi: 3.0.0');
  assert.equal(resolveOpenapi(project, undefined), 'openapi.yml');
});

test('resolveOpenapi: a docs/api DIRECTORY with no root spec file resolves to null — the removed fallback', () => {
  const project = T();
  mkdirSync(join(project, 'docs', 'api'), { recursive: true });
  write(join(project, 'docs', 'api'), 'openapi.yaml', 'openapi: 3.0.0'); // spec lives inside the dir, not at the root
  const found = resolveOpenapi(project, undefined);
  assert.notEqual(found, 'docs/api', 'CW_OPENAPI must never be handed a directory — schemathesis run "$CW_OPENAPI" cannot consume one');
  assert.equal(found, null);
});
