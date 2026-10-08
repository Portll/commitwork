// RED TEAM: proves every report parser can still FAIL. Each format gets a PLANTED finding and
// must refuse to call it clean; the assertion is deliberately `sev !== 'ok'` (severity mapping is
// pinned in parse-report.test.mjs). The completeness guard at the bottom is the load-bearing
// part: no lane joins PARSED_FORMATS without proving it can go red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseReport, PARSED_FORMATS } from '../commitwork.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-canary-'));
const write = (name, data) => {
  const p = join(T, name);
  writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data));
  return p;
};

// One planted, unambiguous finding per format, in that tool's real on-disk shape.
const CANARIES = {
  sarif: ['osv.sarif', { runs: [{ tool: { driver: { name: 'osv-scanner' } }, results: [{ ruleId: 'CVE-2026-0001', level: 'error' }] }] }],
  trufflehog: ['th.jsonl', '{"DetectorName":"AWS","Verified":true,"SourceMetadata":{}}'],
  'npm-audit': ['npm.json', { metadata: { vulnerabilities: { critical: 1, high: 0, moderate: 0, low: 0 } } }],
  trivy: ['trivy.json', { Results: [{ Vulnerabilities: [{ VulnerabilityID: 'CVE-2026-2', Severity: 'CRITICAL' }] }] }],
  gitleaks: ['gl.json', [{ RuleID: 'aws-access-key', File: 'src/c.js', StartLine: 3 }]],
  // An unvalidated low-confidence row: the weakest finding the lane can carry must still not read clean.
  betterleaks: ['bl.json', [{ RuleID: 'generic-password', File: 'src/c.js', StartLine: 3, Attributes: { confidence: 'low' } }]],
  retire: ['retire.json', { version: '5.4.3', data: [{ file: 'f', results: [{ vulnerabilities: [{ severity: 'high' }] }] }] }],
  hadolint: ['hadolint.json', [{ level: 'error', code: 'DL3000' }]],
  socket: ['socket.json', { ok: true, alerts: [{ severity: 'high' }] }],
  nuclei: ['nuclei.jsonl', JSON.stringify({ 'template-id': 'exposed-env', info: { severity: 'high' }, type: 'http', 'matched-at': 'http://x/.env', response: 'HTTP/1.1 200 OK\r\n\r\n{}' })],
  schemathesis: ['schemathesis.jsonl', JSON.stringify({ ScenarioFinished: { status: 'failure' } })],
  'tls-headers': ['tls.json', { ran: true, headers: { missing: ['content-security-policy'] }, tls: { findings: [{ severity: 'high' }] } }],
  'cspm-github': ['cspm.json', { ran: true, fail: 1, pass: 4 }],
  scorecard: ['scorecard.json', { ran: true, counts: { checks: 5, scored: 5, inconclusive: 0, passing: 4, failing: 1 } }],
  depscan: ['depscan.json', { ran: true, counts: { crit: 1, high: 0, med: 0, low: 0, total: 1 },
    reachability: { state: 'analysed', exploitable: 1, notAdjudicated: 0 } }],
  'gradle-wrapper': ['gw.json', { ran: true, applicable: true, findings: [{ rule: 'distribution-url-off-vendor', sev: 'high', message: 'points elsewhere' }] }],
  'authz-bola': ['bola.json', { ran: true, findings: [{ endpoint: '/api/users/{id}', kind: 'idor' }] }],
  a11y: ['a11y.json', { ran: true, criteria: [{ state: 'fail', level: 'A', id: '1.1.1' }] }],
  // both lanes require their wrapper — a bare-shape plant would score noscan and pass for the wrong reason
  actionlint: ['actionlint.json', { tool: 'actionlint', ran: true, findings: [{ message: '"github.event.issue.title" is potentially untrusted. avoid using it directly in inline scripts.', filepath: '.github/workflows/w.yml', line: 8, kind: 'expression' }] }],
  shellcheck: ['shellcheck.json', { comments: [{ file: 'deploy.sh', line: 4, column: 1, level: 'error', code: 1011, message: 'This apostrophe terminated the string!' }] }],
  // bearer keys its findings BY SEVERITY rather than listing them, so the planted finding is a
  // populated `critical` bucket. This lane joined PARSED_FORMATS on 2026-08-28 after being found
  // publishing 171 rows while calling itself unscanned — the canary is the half that was missing.
  bearer: ['bearer.json', { critical: [{ id: 'javascript_lang_hardcoded_secret', title: 'Hard-coded secret' }], high: [], medium: [], low: [] }],
  // A planted SOURCE-context finding must go red. filesScanned>0 matters: the parser treats a
  // zero-file walk as a void, so a canary without it would pass for the wrong reason.
  'weak-random': ['weak-random.json', { tool: 'weak-random-detect', summary: { findings: 1, byRule: { 'rust-systemtime': 1 }, filesScanned: 12, testContext: 0 }, findings: [{ rule: 'rust-systemtime', severity: 'high', path: 'src/cli.rs', line: 885, context: 'source', fn: 'generate_api_key', detail: 'let timestamp = SystemTime::now()' }] }],
  // minify-detect wraps its own shape; a planted HIGH must not read clean even though ok stays true
  minify: ['minify.json', { tool: 'minify-detect', summary: { findings: 1, filesScanned: 1, byRule: { 'unscannable-void': 1 }, filesSkipped: [] }, findings: [{ rule: 'unscannable-void', path: 'sitemap/vendor/three.min.js', sev: 'high', capped: false, metrics: {}, detail: 'codeql-excluded AND over semgrep ceiling' }] }],
  // Coverage, not vulnerabilities — so the planted "finding" is an unresolved copybook. It must not
  // read clean, because a scan that never saw the fields a copybook defines has not scanned clean.
  'cobol-inventory': ['cobol-inventory.json', { tool: 'cobolwork-inventory', schemaVersion: 2, summary: { filesScanned: 4, programs: 4, programFiles: 4, copybookFiles: 0, jclFiles: 0, copiesMissing: 1, filesUnreadable: 0, formats: { fixed: 4 }, coverageIncomplete: true, nosrc: false }, missingCopybooks: { CUSTREC: 1 }, unreadable: [] }],
  // the shared in-house shape; a planted crit must read as the worst row, never as ok
  'rule-counts': ['rule-counts.json', { tool: 'agent-config', summary: { findings: 1, byRule: { 'env-secret-inline': 1 }, filesScanned: 2 }, findings: [{ rule: 'env-secret-inline', path: '.mcp.json', sev: 'crit', detail: 'key GITHUB_TOKEN' }] }],
  // the exit code decides this lane, so the plant carries one; without it the parser reads noscan
  // and the canary would pass for the wrong reason
  'jackson-guard': ['jackson-guard.txt', 'GUARD FAILED — ACCEPT_CASE_INSENSITIVE_PROPERTIES enabled (opens jackson CVE-2026-54515):\n  src/main/resources/application.yml:4: accept-case-insensitive-properties: true\n', 1],
};

// A format is exempt ONLY with a stated reason; the guard below rejects an empty one.
const EXEMPT = {
  sbom: 'An SBOM is an INVENTORY, not a finding list — `sev` is `ok` for every valid document by '
    + 'design, and the count it publishes is components, not vulnerabilities. Its failure mode is '
    + 'covered instead by the zero-dependency case (components OMITTED, not []) pinned in '
    + 'parse-report.test.mjs, where a valid clean SBOM was being read as "no sbom".',
};

for (const [format, [file, body, exit]] of Object.entries(CANARIES)) {
  test(`canary: ${format} — a planted finding must NOT read as clean`, () => {
    const p = write(file, body);
    if (exit !== undefined) writeFileSync(`${p}.exit`, `${exit}\n`);
    const r = parseReport(format, p);
    assert.notEqual(r.sev, 'ok', `${format} scored a planted finding as clean — this handler cannot fail`);
    assert.ok(r.sev, `${format} returned no severity at all`);
  });
}

// Negative control: a parser hard-wired to `sev:'high'` would satisfy every canary above.
test('negative control: a genuinely clean report still reads clean', () => {
  const clean = {
    sarif: ['c.sarif', { runs: [{ results: [] }] }],
    // A genuinely clean gitleaks run carries its scanned-bytes receipt; `[]` alone is a VOID, and
    // that direction is pinned in bin/test/parse-report.test.mjs. Writing the sibling log here is
    // what makes this fixture actually clean rather than merely empty — the distinction this whole
    // negative control exists to respect.
    gitleaks: ['c-gl.json', [], '9:41PM INF scanned ~1048576 bytes (1.00 MB) in 90ms\n'],
    betterleaks: ['c-bl.json', [], '9:41PM INF scanned ~1048576 bytes (1.00 MB) in 90ms\n'],
    hadolint: ['c-h.json', []],
    socket: ['c-s.json', { ok: true, alerts: [] }],
    'cspm-github': ['c-cspm.json', { ran: true, fail: 0, pass: 9 }],
    scorecard: ['c-scorecard.json', { ran: true, counts: { checks: 9, scored: 9, inconclusive: 0, passing: 9, failing: 0 } }],
    // clean means the ANALYSER RAN and found nothing — a run with no slices is noscan, not ok,
    // and that direction is pinned in bin/test/depscan-reachability.test.mjs
    depscan: ['c-depscan.json', { ran: true, counts: { crit: 0, high: 0, med: 0, low: 0, total: 0 },
      reachability: { state: 'analysed', exploitable: 0, notAdjudicated: 0 } }],
    // clean means a wrapper WAS examined and its fetch path is sound — applicable:false is a
    // different claim (no wrapper at all) and is pinned in bin/test/gradle-wrapper-verify.test.mjs
    'gradle-wrapper': ['c-gw.json', { ran: true, applicable: true, findings: [] }],
    'authz-bola': ['c-bola.json', { ran: true, findings: [] }],
    actionlint: ['c-al.json', { tool: 'actionlint', ran: true, findings: [] }],
    shellcheck: ['c-sc.json', { comments: [] }],
    // clean means all four buckets PRESENT and empty. An object missing them is a void, and that
    // direction is pinned in bin/test/parse-report.test.mjs — including the `{}` case, which is the
    // shape the old `generic` pass-through scored green.
    bearer: ['c-bearer.json', { critical: [], high: [], medium: [], low: [] }],
    // clean means the walk EXAMINED something and found nothing. A test-context row is present and
    // still clean, which is the distinction the lane's whole context split exists for.
    'weak-random': ['c-weak-random.json', { tool: 'weak-random-detect', summary: { findings: 0, byRule: {}, filesScanned: 40, testContext: 1 }, findings: [{ rule: 'js-math-random', severity: 'high', path: 'benches/x_bench.js', line: 3, context: 'test' }] }],
    // clean means COBOL was read and nothing was found AND every COPY resolved. A tree with an
    // unresolved copybook is not clean here — it is incomplete, which the canary above pins.
    'cobol-inventory': ['c-cobol-inventory.json', { tool: 'cobolwork-inventory', schemaVersion: 2, summary: { filesScanned: 4, programs: 4, programFiles: 4, copybookFiles: 2, jclFiles: 0, copiesMissing: 0, filesUnreadable: 0, formats: { fixed: 4 }, coverageIncomplete: false, nosrc: false }, missingCopybooks: {}, unreadable: [] }],
    'rule-counts': ['c-rule-counts.json', { tool: 'agent-config', summary: { findings: 0, byRule: {}, filesScanned: 2 }, findings: [] }],
    // clean means the OK line with a scanned count AND exit 0 beside it; OK alone is unwitnessed
    'jackson-guard': ['c-jackson-guard.txt', 'guard-jackson-caseinsensitive: OK — ACCEPT_CASE_INSENSITIVE_PROPERTIES not enabled in 3 scanned file(s) under . (CVE-2026-54515 unreachable here).\n', null, 0],
  };
  for (const [format, [file, body, sidecarLog, exit]] of Object.entries(clean)) {
    const p = write(file, body);
    // Some parsers require the tool's own statement of work before believing an empty report — the
    // receipt rule. Where a fixture declares one, write it beside the report exactly as the sweep
    // does, so this control tests a CLEAN scan rather than an unproven one.
    if (sidecarLog) writeFileSync(p.replace(/\.jsonl?$/i, '') + '.log', sidecarLog);
    if (exit !== undefined) writeFileSync(`${p}.exit`, `${exit}\n`);
    assert.equal(parseReport(format, p).sev, 'ok',
      `${format} called a clean report dirty — grey/red where green belongs is the same defect mirrored`);
  }
});

// ── completeness: no lane joins the fleet without proving it can go red ──────
test('every PARSED_FORMAT has a canary or a JUSTIFIED exemption', () => {
  const missing = [...PARSED_FORMATS].filter((f) => !(f in CANARIES) && !(f in EXEMPT));
  assert.deepEqual(missing, [],
    `these formats can be parsed but nothing proves they can report a finding: ${missing.join(', ')}. `
    + 'Add a canary above, or an EXEMPT entry saying why the format cannot carry one.');
  for (const [f, why] of Object.entries(EXEMPT)) {
    assert.ok(typeof why === 'string' && why.trim().length > 40, `exemption for ${f} needs a real reason`);
  }
  // and the reverse: a canary for a format nobody parses is dead weight that reads as coverage.
  const orphaned = Object.keys(CANARIES).filter((f) => !PARSED_FORMATS.has(f));
  assert.deepEqual(orphaned, [], `canaries for formats no longer parsed: ${orphaned.join(', ')}`);
});
