// Tests parseReport's severity classification and the F8 silent-green format lint.
// No network, no external tools; fixtures are written to a tmp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseReport, classifyReport, validateManifest, PARSED_FORMATS, PASSTHROUGH_FORMATS } from '../commitwork.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-parsereport-'));
const write = (name, data) => { const p = join(T, name); writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data)); return p; };

// ── gitleaks: the F8 fix ─────────────────────────────────────────────────────
test('gitleaks report WITH findings → high (was silently ok before F8)', () => {
  const p = write('gitleaks-dirty.json', [
    { RuleID: 'aws-access-key', File: 'src/config.js', StartLine: 10 },
    { RuleID: 'generic-api-key', File: '.env', StartLine: 3 },
  ]);
  const r = parseReport('gitleaks', p);
  assert.equal(r.sev, 'high');
  assert.equal(r.total, 2);
  assert.match(r.summary, /2 secret findings/);
  // redaction guard: the secret value must never appear in the summary.
  assert.ok(!/secret/i.test(r.summary) || !/=|:.*[A-Za-z0-9]{16}/.test(r.summary));
});

// A CLEAN GITLEAKS RESULT MUST CARRY ITS RECEIPT — the trufflehog rule, applied to the tool beside
// it. `[]` is what a clean run writes and equally what a run killed on its first syscall writes, so
// the report alone cannot separate them. gitleaks states its own work on stderr, captured to the
// sibling log: `INF scanned ~6974065 bytes (6.97 MB) in 1.12s`.
//
// These three tests replace a single one that asserted `[] → ok` unconditionally. That assertion
// was the false-clean in test form: it pinned the behaviour that an empty report needs no evidence.
const withLog = (base, logText) => {
  const p = write(`${base}.json`, []);
  writeFileSync(join(T, `${base}.log`), logText);
  return p;
};

test('gitleaks: EMPTY array WITH a scanned-bytes receipt → ok, and the summary carries the number', () => {
  const r = parseReport('gitleaks', withLog('gitleaks-clean',
    '9:41PM INF scanned ~6974065 bytes (6.97 MB) in 1.12s\n9:41PM INF no leaks found\n'));
  assert.equal(r.sev, 'ok');
  assert.equal(r.total, 0);
  // "0" and "0 secrets in 6.65 MB scanned" are different claims; only the second is checkable.
  assert.match(r.summary, /MB scanned/);
});

test('gitleaks: EMPTY array with NO receipt → noscan, never a clean repo', () => {
  const r = parseReport('gitleaks', write('gitleaks-noreceipt.json', []));
  assert.equal(r.sev, 'noscan');
  assert.equal(r.ok, false);
  assert.match(r.summary, /did not finish/);
});

test('gitleaks: a receipt saying ZERO bytes scanned is its own answer, not a clean scan', () => {
  const r = parseReport('gitleaks', withLog('gitleaks-zerobytes',
    '9:41PM INF scanned ~0 bytes (0 B) in 2ms\n9:41PM INF no leaks found\n'));
  assert.equal(r.sev, 'noscan');
  assert.match(r.summary, /0 bytes/);
});

test('gitleaks: ANSI colour in the log does not hide the receipt', () => {
  // gitleaks colourises even when redirected, so a naive match misses the line and every clean
  // scan would degrade to noscan — a false GREY, which is the opposite failure and just as wrong.
  const r = parseReport('gitleaks', withLog('gitleaks-ansi',
    '[90m9:41PM[0m [32mINF[0m [1mscanned ~1048576 bytes (1.00 MB) in 90ms[0m\n'));
  assert.equal(r.sev, 'ok');
  assert.match(r.summary, /1\.00 MB scanned/);
});

test('gitleaks: findings are believed on their own evidence — no receipt required', () => {
  // The restriction that makes the rule safe to apply per lane: the receipt gates CLEAN, never
  // detection. A run that found something has already proved it did work.
  const r = parseReport('gitleaks', write('gitleaks-dirty-noreceipt.json', [{ RuleID: 'x', File: 'a', StartLine: 1 }]));
  assert.equal(r.sev, 'high');
  assert.equal(r.total, 1);
});

test('gitleaks with a missing report → not ok, not a false green', () => {
  const r = parseReport('gitleaks', join(T, 'does-not-exist.json'));
  assert.equal(r.ok, false);
  assert.notEqual(r.sev, 'ok'); // must not classify absence as clean
});

test('gitleaks with non-array garbage → no data, not green', () => {
  const r = parseReport('gitleaks', write('gitleaks-garbage.json', { not: 'an array' }));
  assert.equal(r.ok, false);
  assert.notEqual(r.sev, 'ok');
});

// ── negative control: a real handler still greens a genuinely clean report ────
test('sbom with components still reports ok (handler regression guard)', () => {
  const r = parseReport('sbom', write('sbom.json', { components: [{ name: 'x' }, { name: 'y' }] }));
  assert.equal(r.sev, 'ok');
  assert.match(r.summary, /2 components/);
});

// ── the three-way format lint (F8 class) ─────────────────────────────────────
test('lint: a parsed format (gitleaks) does NOT warn', () => {
  const m = { checks: [{ id: 'secrets-gitleaks', report: { file: 'gitleaks.json', format: 'gitleaks' } }] };
  const { warnings } = validateManifest(m, 'test.json');
  assert.ok(!warnings.some((w) => /silent-green/.test(w)), `unexpected silent-green warning: ${warnings}`);
});

test('lint: a pass-through format (generic) does NOT warn', () => {
  const m = { checks: [{ id: 'authz-test', report: { file: 'authz.json', format: 'generic' } }] };
  const { warnings } = validateManifest(m, 'test.json');
  assert.ok(!warnings.some((w) => /silent-green/.test(w)), `unexpected silent-green warning: ${warnings}`);
});

test('lint: nuclei is HANDLED — no silent-green warning (the last unhandled format is closed)', () => {
  const m = { checks: [{ id: 'dast-nuclei', report: { file: 'nuclei.jsonl', format: 'nuclei' } }] };
  const { warnings } = validateManifest(m, 'test.json');
  assert.ok(!warnings.some((w) => /silent-green/.test(w)), `nuclei should be handled now, got: ${warnings}`);
});

test('nuclei: JSONL severities score, and a finding matched on a 4xx is unconfirmed not live', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-nuclei-'));
  const w = (name, lines) => { const p = join(dir, name); writeFileSync(p, lines.join('\n')); return p; };
  const live = (sev) => JSON.stringify({ 'template-id': 't-' + sev, info: { severity: sev }, type: 'http', 'matched-at': 'http://x/a', response: 'HTTP/1.1 200 OK\r\n\r\n{}' });
  const dead = (sev) => JSON.stringify({ 'template-id': 'ghost', info: { severity: sev }, type: 'http', 'matched-at': 'http://x/nope', response: 'HTTP/1.1 404 Not Found\r\n\r\n{}' });
  assert.equal(parseReport('nuclei', w('a.jsonl', [live('high')])).sev, 'high');
  assert.equal(parseReport('nuclei', w('b.jsonl', [live('medium')])).sev, 'med');
  assert.equal(parseReport('nuclei', w('c.jsonl', [])).sev, 'ok');
  // a template that matched a 404 must not be counted as a live exposure, but must still be seen
  const mixed = parseReport('nuclei', w('d.jsonl', [live('high'), dead('critical')]));
  assert.equal(mixed.total, 1, 'only the 200-response finding is live');
  assert.match(mixed.summary, /unconfirmed/, 'the 4xx match is surfaced, not silently dropped');
});

// Liveness is tri-state — live / unknown / refuted — and only refuted demotes severity.
test('nuclei: a network detect is live, an unreadable HTTP response is UNKNOWN — and neither is silently green', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-nuclei-tri-'));
  const w = (name, lines) => { const p = join(dir, name); writeFileSync(p, lines.join('\n')); return p; };
  // no HTTP status line at all, and not an http target → live by construction
  const netDetect = JSON.stringify({ 'template-id': 'snmpv3-detect', info: { severity: 'high' }, type: 'javascript', 'matched-at': '127.0.0.1:161', response: 'Enterprise: unknown' });
  // an http target whose response could not be parsed → liveness unknown, NOT refuted
  const unreadable = JSON.stringify({ 'template-id': 'mystery', info: { severity: 'high' }, type: 'http', 'matched-at': 'http://x/a', response: '' });

  const net = parseReport('nuclei', w('net.jsonl', [netDetect]));
  assert.equal(net.sev, 'high', 'a network detect carries no HTTP status and is live, not demoted');
  assert.equal(net.total, 1);
  assert.ok(!/unknown/.test(net.summary), 'a network detect is not reported as unknown liveness');

  const unk = parseReport('nuclei', w('unk.jsonl', [unreadable]));
  assert.equal(unk.sev, 'high', 'an unreadable response must not demote severity — explicit uncertainty');
  assert.equal(unk.total, 1, 'it is still counted');
  assert.match(unk.summary, /liveness unknown/, 'and it is NAMED as unknown rather than claimed live');
  assert.match(unk.summary, /^0 live findings/, 'the live count excludes it');
});

// ── retire / socket / hadolint handlers (F8 follow-on) ───────────────────────
test('retire: findings map to severity (real-shape), clean/0-byte are ok/no-data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-retire-'));
  const withHigh = write('r1.json', { version: '5.4.3', data: [{ file: 'f', results: [{ vulnerabilities: [{ severity: 'high' }, { severity: 'medium' }] }] }] });
  assert.equal(parseReport('retire', withHigh).sev, 'high');
  assert.equal(parseReport('retire', withHigh).total, 2);
  assert.equal(parseReport('retire', write('r2.json', { version: '5.4.3', data: [] })).sev, 'ok'); // clean
  writeFileSync(join(dir, 'empty.json'), ''); // 0-byte clean variant → null → no data, not a crash
  assert.equal(parseReport('retire', join(dir, 'empty.json')).ok, false);
});

test('hadolint: an error → high, warning/info → med, [] → ok', () => {
  assert.equal(parseReport('hadolint', write('h1.json', [{ level: 'error', code: 'DL3000' }])).sev, 'high');
  assert.equal(parseReport('hadolint', write('h2.json', [{ level: 'warning' }, { level: 'info' }])).sev, 'med');
  assert.equal(parseReport('hadolint', write('h3.json', [])).sev, 'ok');
  assert.equal(parseReport('hadolint', write('h4.json', 'not-an-array')).ok, false);
});

test('socket: the {ok:false} error shape is a VOID (noscan), never green', () => {
  const err = parseReport('socket', write('s1.json', { ok: false, message: 'Input error' }));
  assert.equal(err.sev, 'noscan');
  assert.notEqual(err.sev, 'ok'); // the load-bearing case: a token-less socket run must not read clean
  const okScan = parseReport('socket', write('s2.json', { ok: true, alerts: [{ severity: 'high' }] }));
  assert.equal(okScan.sev, 'high');
  assert.equal(parseReport('socket', write('s3.json', { ok: true, alerts: [] })).sev, 'ok');
});

// ── sarif: MAL- advisories are malware, not one more `warning` ───────────────
// osv-scanner emits MAL- records at level=warning on the same osv.sarif as the CVEs.
const sarif = (results, rules = []) => ({ runs: [{ tool: { driver: { name: 'osv-scanner', rules } }, results }] });

test('sarif: one MAL- record at level=warning is HIGH, not med', () => {
  const r = parseReport('sarif', write('osv-mal.sarif', sarif([
    { ruleId: 'CVE-2026-1000', level: 'warning' },
    { ruleId: 'MAL-2025-47141', level: 'warning' },
  ])));
  assert.equal(r.sev, 'high', 'confirmed malware must outrank the level tally');
  assert.equal(r.malicious, 1);
  assert.deepEqual(r.maliciousIds, ['MAL-2025-47141']);
  assert.match(r.summary, /MALICIOUS/, 'the count must be legible in the summary, not just the object');
  assert.equal(r.total, 2, 'total still counts every result — existing consumers unchanged');
});

test('sarif: a MAL- id hiding as a grouped ALIAS is still found', () => {
  // aliased MAL ids appear only in the rule metadata
  const r = parseReport('sarif', write('osv-alias.sarif', sarif(
    [{ ruleId: 'GHSA-aaaa-bbbb-cccc', level: 'warning' }],
    [{ id: 'GHSA-aaaa-bbbb-cccc', shortDescription: { text: 'GHSA-aaaa-bbbb-cccc, MAL-2025-47141: malicious code in @ctrl/tinycolor' } }],
  )));
  assert.equal(r.sev, 'high');
  assert.equal(r.malicious, 1);
  assert.deepEqual(r.maliciousIds, ['MAL-2025-47141']);
});

test('sarif: a CVE-only report keeps its existing severity exactly (no regression)', () => {
  const warnOnly = parseReport('sarif', write('osv-cve.sarif', sarif([
    { ruleId: 'CVE-2026-1000', level: 'warning' }, { ruleId: 'GHSA-xxxx-yyyy-zzzz', level: 'note' },
  ])));
  assert.equal(warnOnly.sev, 'med');
  assert.equal(warnOnly.malicious, 0);
  assert.doesNotMatch(warnOnly.summary, /MALICIOUS/);
  const withError = parseReport('sarif', write('osv-err.sarif', sarif([{ ruleId: 'CVE-2026-1001', level: 'error' }])));
  assert.equal(withError.sev, 'high');
  assert.equal(withError.malicious, 0);
  const clean = parseReport('sarif', write('osv-clean.sarif', sarif([])));
  assert.equal(clean.sev, 'ok');
  assert.equal(clean.summary, '0');
});

// The `clean` case at :217 above asserts sev 'ok' / summary '0' on sarif([]) — zero results, and
// the helper emits NO invocations[]. That is the deps-osv false-clean shape exactly: with egress
// severed osv-scanner writes precisely this document. The assertion stays, deliberately, because
// promoting it would fail 2,103 of 10,354 stored SARIFs; the grade is carried unchanged and the
// unwitnessed-ness is reported alongside it. Worth naming that the SUITE pinned the defect too —
// code and test were written from one understanding, so they agreed and neither could see it.
test('sarif: a zero with no invocation record is FLAGGED while its grade is left alone', () => {
  const witnessed = (results) => ({ runs: [{ tool: { driver: { name: 'osv-scanner', rules: [] } }, results, invocations: [{ executionSuccessful: true }] }] });
  const bare = parseReport('sarif', write('osv-bare.sarif', sarif([])));
  assert.equal(bare.unwitnessedZero, true, 'zero results and no invocations — nothing witnessed this scan');
  assert.equal(bare.sev, 'ok', 'the GRADE is unchanged here; promoting it is a separate, measured decision');

  const seen = parseReport('sarif', write('osv-seen.sarif', witnessed([])));
  assert.equal(seen.unwitnessedZero, false, 'an execution record is the witness that was missing');
  assert.equal(seen.sev, 'ok');

  // discriminates, without the states diverging — the fleet-wide false positive stays refused
  assert.notEqual(bare.unwitnessedZero, seen.unwitnessedZero, 'a flag that never varies pins nothing');
  assert.equal(bare.sev, seen.sev);

  // findings witness themselves; the flag must not fire on a report that found something
  const found = parseReport('sarif', write('osv-found.sarif', sarif([{ ruleId: 'CVE-2026-1000', level: 'warning' }])));
  assert.equal(found.unwitnessedZero, false);
});

test('sarif: absence and 0-byte stay GREY — a missing scan is never 0 malicious', () => {
  const missing = parseReport('sarif', join(T, 'no-such.sarif'));
  assert.equal(missing.ok, false);
  assert.notEqual(missing.sev, 'ok');
  assert.equal(missing.malicious, undefined, 'absence must not report a malware COUNT of zero');
  const empty = parseReport('sarif', write('osv-empty.sarif', ''));
  assert.equal(empty.nosrc, true, '0-byte is "no sources", distinct from "scanned, clean"');
});

// ── F8, second sighting: a CRASHED tool read as a clean one ──────────────────
test('sarif that parses but has NO runs[] is not a report — noscan, never green', () => {
  for (const [name, body] of [
    ['osv-errobj.sarif', { error: 'osv-scanner: permission denied' }],
    ['osv-wrongshape.sarif', { foo: 1 }],
    ['osv-null-runs.sarif', { runs: null }],
  ]) {
    const r = parseReport('sarif', write(name, body));
    assert.equal(r.sev, 'noscan', `${name} must be a void, not a pass`);
    assert.notEqual(r.sev, 'ok');
    assert.equal(r.total, undefined, 'a non-report must not publish a finding COUNT');
  }
  // the boundary: an empty-but-VALID sarif is a real scan that found nothing, and stays green.
  const clean = parseReport('sarif', write('osv-valid-empty.sarif', { runs: [{ results: [] }] }));
  assert.equal(clean.sev, 'ok');
  assert.equal(clean.total, 0);
});

test('trufflehog output that never parsed → noscan; a crash is not "0 secrets"', () => {
  const panicked = parseReport('trufflehog', write('th-panic.jsonl',
    'panic: runtime error: out of memory\ngoroutine 1 [running]:\n'));
  assert.equal(panicked.sev, 'noscan', 'a died-mid-run scanner must not report clean');
  assert.match(panicked.summary, /not parseable/);
  assert.equal(panicked.verified, undefined, 'a crash must not publish a verified COUNT of zero');

  // findings present ⇒ the run produced real records, so interleaved log noise stays ignorable.
  const noisy = parseReport('trufflehog', write('th-noisy.jsonl',
    '2026-08-07 info: scanning\n{"DetectorName":"AWS","Verified":true}\n'));
  assert.equal(noisy.sev, 'high');
  assert.equal(noisy.total, 1);
});

// ── a SAST lane that loaded ZERO rules is not a clean one ────────────────────
// SG_FAILED is verbatim semgrep 1.171.0 output: ruleset 404, zero rules loaded, exit 7.
const SG_FAILED = {
  version: '2.1.0',
  runs: [{
    invocations: [{
      executionSuccessful: true,   // NOTE: semgrep says TRUE while reporting fatal config errors
      toolExecutionNotifications: [
        { descriptor: { id: 'SemgrepError' }, level: 'error', message: { text: 'Failed to download configuration from https://semgrep.dev/c/p/does-not-exist-xyz-123 HTTP 404.' } },
        { descriptor: { id: 'SemgrepError' }, level: 'error', message: { text: 'invalid configuration file found (1 configs were invalid)' } },
      ],
    }],
    results: [],
    tool: { driver: { name: 'Semgrep OSS', rules: [], semanticVersion: '1.171.0' } },
  }],
};

test('sarif: a tool that reported an ERROR and found nothing is a void, not a pass', () => {
  const r = parseReport('sarif', write('semgrep-noRules.sarif', SG_FAILED));
  assert.equal(r.sev, 'noscan', 'zero rules loaded must never read as zero findings');
  assert.match(r.summary, /tool reported failure/);
  assert.match(r.summary, /404/, 'the tool’s own reason must survive into the summary');
  assert.equal(r.total, undefined, 'a scan that never ran must not publish a finding COUNT');
});

test('sarif: executionSuccessful=false is a void even with no notifications', () => {
  const r = parseReport('sarif', write('sarif-execfalse.sarif',
    { version: '2.1.0', runs: [{ invocations: [{ executionSuccessful: false }], results: [] }] }));
  assert.equal(r.sev, 'noscan');
});

test('sarif: FINDINGS outrank tool errors — a degraded run is not discarded', () => {
  // a partial failure that still produced results is degraded, not void
  const degraded = {
    version: '2.1.0',
    runs: [{
      invocations: [{ executionSuccessful: true, toolExecutionNotifications: [
        { level: 'error', message: { text: 'could not parse 1 file' } }] }],
      results: [{ level: 'error', ruleId: 'sqli', message: { text: 'SQL injection' } }],
    }],
  };
  const r = parseReport('sarif', write('semgrep-degraded.sarif', degraded));
  assert.equal(r.sev, 'high', 'a real finding must still be reported');
  assert.equal(r.total, 1);
});

test('sarif: a healthy scan with warning-level notifications stays clean', () => {
  const r = parseReport('sarif', write('semgrep-warn.sarif',
    { version: '2.1.0', runs: [{ invocations: [{ executionSuccessful: true, toolExecutionNotifications: [
      { level: 'warning', message: { text: 'skipped a large file' } }] }], results: [] }] }));
  assert.equal(r.sev, 'ok', 'warnings are not failures — this must not go grey');
  assert.equal(r.total, 0);
});

// ── actionlint + shellcheck ──────────────────────────────────────────────────
// Fixtures captured from actionlint 1.7.12 / shellcheck 0.11.0. Both default to a bare JSON
// array, so each lane requires a wrapper only a real run can produce.
test('actionlint: the ran:true wrapper is required — a bare array is a void', () => {
  // The bare array is exactly what `-format '{{json .}}'` emits; the manifest wraps it instead.
  const bare = parseReport('actionlint', write('al-bare.json', [{ message: 'x', kind: 'expression' }]));
  assert.equal(bare.sev, 'noscan', 'no attestation ⇒ no claim about the workflows');
  assert.match(bare.summary, /did not run/);
});

test('actionlint: untrusted input in an inline run is HIGH, above ordinary findings', () => {
  const wrapped = {
    tool: 'actionlint', ran: true,
    findings: [
      { message: '"github.event.pull_request.title" is potentially untrusted. avoid using it directly in inline scripts.', filepath: '.github/workflows/bad.yml', line: 8, kind: 'expression' },
      { message: 'property "evnt" is not defined in object type', filepath: '.github/workflows/bad.yml', line: 11, kind: 'expression' },
      { message: 'the runner of "actions/checkout@v1" action is too old', filepath: '.github/workflows/bad.yml', line: 12, kind: 'action' },
    ],
  };
  const r = parseReport('actionlint', write('al-inj.json', wrapped));
  assert.equal(r.sev, 'high', 'script injection on pull_request_target is a live RCE');
  assert.equal(r.injection, 1);
  assert.equal(r.total, 3);
  assert.match(r.summary, /UNTRUSTED-INPUT/);
});

test('actionlint: findings of an UNKNOWN kind still score med, never clean', () => {
  // actionlint carries no severity field, so unknown kinds fail toward visible
  const r = parseReport('actionlint', write('al-unknown.json',
    { tool: 'actionlint', ran: true, findings: [{ message: 'something new', kind: 'a-kind-from-2027' }] }));
  assert.equal(r.sev, 'med');
  assert.equal(r.total, 1);
});

test('actionlint: a real clean run (wrapper present, findings empty) is green', () => {
  const r = parseReport('actionlint', write('al-clean.json', { tool: 'actionlint', ran: true, findings: [] }));
  assert.equal(r.sev, 'ok');
  assert.equal(r.total, 0);
});

test('shellcheck: json1 comments[] is required — a bare array is a void', () => {
  const bare = parseReport('shellcheck', write('sc-bare.json', [{ level: 'error', code: 2086 }]));
  assert.equal(bare.sev, 'noscan', '--format=json cannot distinguish clean from never-ran');
  assert.match(bare.summary, /no comments/);
});

test('shellcheck: error gates high, warning med, and advisory is counted but does NOT gate', () => {
  const mk = (level, code) => ({ file: 'a.sh', line: 1, column: 1, level, code, message: 'm' });
  const err = parseReport('shellcheck', write('sc-err.json',
    { comments: [mk('error', 1011), mk('warning', 2164), mk('info', 2086), mk('style', 2006)] }));
  assert.equal(err.sev, 'high');
  assert.equal(err.total, 2, 'total counts error+warning only');
  assert.equal(err.advisory, 2, 'info/style are counted, not dropped');
  assert.match(err.summary, /advisory/, 'and they are NAMED — invisible is not the same as absent');

  // advisory alone must not lift the lane off green — an always-on alarm is no alarm
  const only = parseReport('shellcheck', write('sc-adv.json', { comments: [mk('info', 2086), mk('style', 2006)] }));
  assert.equal(only.sev, 'ok');
  assert.equal(only.total, 0);
  assert.equal(only.advisory, 2);
  assert.match(only.summary, /\+2 advisory/);
});

// ── the exit code, for the one case no parser can decide ─────────────────────
// The exit sidecar is consulted only after "nothing found": a non-zero exit is the normal
// successful state for gitleaks/semgrep/shellcheck.
test('an empty report is clean on exit 0 and a VOID on a non-zero exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-exit-'));
  const check = { id: 'secrets', report: { format: 'trufflehog', file: 'trufflehog.json' } };
  // the fixture writes the .log completion receipt so only the exit code varies
  const RECEIPT = JSON.stringify({ msg: 'finished scanning', chunks: 12, bytes: 3400, verified_secrets: 0 });
  const write2 = (body, exit) => {
    writeFileSync(join(dir, 'trufflehog.json'), body);
    writeFileSync(join(dir, 'trufflehog.log'), RECEIPT);
    if (exit === null) { try { rmSync(join(dir, 'trufflehog.json.exit')); } catch { /* absent already */ } }
    else writeFileSync(join(dir, 'trufflehog.json.exit'), `${exit}\n`);
    return classifyReport(check, dir, dir);
  };
  assert.equal(write2('', 0).sev, 'ok', 'empty + exit 0 is a real clean scan');

  const crashed = write2('', 1);
  assert.equal(crashed.sev, 'noscan', 'empty + non-zero cannot be told from clean, so it is a void');
  assert.match(crashed.summary, /exited 1/);

  // Lanes that do not yet write a sidecar must be completely unaffected — this is additive.
  assert.equal(write2('', null).sev, 'ok', 'no sidecar ⇒ the old behaviour, not a new void');

  // and the restriction that makes the whole rule safe: findings outrank the exit code.
  assert.equal(write2('{"DetectorName":"AWS","Verified":true}', 183).sev, 'high',
    'a non-zero exit must never suppress a finding the tool actually reported');
});

// ── a clean scan must PROVE it scanned ───────────────────────────────────────
// Trufflehog's completion record (stderr → trufflehog.log) gates the clean verdict; shapes
// verified against trufflehog 3.95.9.
test('trufflehog: a clean result requires the completion receipt, and cites it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-receipt-'));
  const rep = join(dir, 'trufflehog.json');
  const log = join(dir, 'trufflehog.log');
  const put = (logBody) => { writeFileSync(rep, ''); writeFileSync(log, logBody); return parseReport('trufflehog', rep); };

  const clean = put(JSON.stringify({ msg: 'finished scanning', chunks: 2, bytes: 41, verified_secrets: 0, trufflehog_version: '3.95.9' }));
  assert.equal(clean.sev, 'ok');
  assert.equal(clean.total, 0);
  assert.match(clean.summary, /2 chunk\(s\)/, 'the clean claim carries the evidence that backs it');
  assert.match(clean.summary, /41 byte\(s\)/);

  // finished, but examined nothing — an empty scan is not a clean repository
  const nothing = put(JSON.stringify({ msg: 'finished scanning', chunks: 0, bytes: 0 }));
  assert.equal(nothing.sev, 'noscan');
  assert.match(nothing.summary, /examined NOTHING/);

  // never finished: no receipt at all
  assert.equal(put('').sev, 'noscan');
  assert.match(put('{"msg":"scanning repo"}').summary, /did not finish/,
    'a start line is not a finish line');

  // and the negative control: a real finding never needs a receipt to be believed
  writeFileSync(rep, '{"DetectorName":"AWS","Verified":true,"SourceMetadata":{}}');
  writeFileSync(log, '');
  assert.equal(parseReport('trufflehog', rep).sev, 'high',
    'findings prove the scanner worked by themselves — the receipt gates CLEAN, not detection');
});

// ── the property that generalises all of the above ───────────────────────────
// Asserted over PARSED_FORMATS itself, so a new lane is covered the moment its name lands in the
// set. Absence is classifyReport's reportMissing path, covered in honest-provenance.test.mjs.
test('NO parsed format scores green on input a healthy tool would never write', () => {
  const CRASH_RESIDUE = [
    ['a tool error object', '{"error":"permission denied"}'],
    ['an empty object', '{}'],
    ['a panic / non-JSON', 'panic: runtime error: out of memory'],
  ];
  const green = [];
  for (const fmt of [...PARSED_FORMATS].sort()) {
    for (const [label, body] of CRASH_RESIDUE) {
      const file = `prop-${fmt}-${label.replace(/\W+/g, '-')}.rep`;
      writeFileSync(join(T, file), body);
      const { sev, summary } = classifyReport({ id: fmt, report: { format: fmt, file } }, T, T);
      if (sev === 'ok') green.push(`${fmt} + ${label} → ok / ${summary}`);
    }
  }
  assert.deepEqual(green, [],
    `these formats read crash residue as a clean scan:\n  ${green.join('\n  ')}`);
});

// ── the classification sets stay coherent (drift guard) ──────────────────────
test('PARSED_FORMATS and PASSTHROUGH_FORMATS are disjoint', () => {
  for (const f of PARSED_FORMATS) assert.ok(!PASSTHROUGH_FORMATS.has(f), `${f} in both sets`);
});

// ── bearer: a lane that published 171 findings while calling itself unscanned ─
//
// bearer.json is `{ critical: [...], high: [...], medium: [...], low: [...] }`. The lane was
// declared `format: "generic"` — a PASS-THROUGH, so the manifest lint stayed silent — which made
// parseReport return total 0, which put classifyReport into emptyClean, which consulted the exit
// code. Bearer exits 1 when it FINDS something, so the lane reported
// `nothing found, but the tool exited 1` on a report holding 171 rows. MEASURED 2026-08-28: memory-layer's
// rollup listed sast-bearer under noscanReasons and carried 171 bearer rows in scannerFindings, in
// the same document. monitor/extractors.mjs could read the file; this reader could not.
test('bearer: severity buckets are counted, and critical/high lift the lane to high', () => {
  const p = write('bearer-dirty.json', {
    critical: [{ id: 'javascript_lang_hardcoded_secret' }],
    high: [{ id: 'python_lang_path_traversal' }, { id: 'python_lang_path_traversal' }],
    medium: [],
    low: [{ id: 'javascript_lang_logger_leak' }],
  });
  const r = parseReport('bearer', p);
  assert.equal(r.ok, true);
  assert.equal(r.total, 4);
  assert.equal(r.sev, 'high');
  assert.match(r.summary, /1 critical/);
  assert.match(r.summary, /2 high/);
  assert.match(r.summary, /1 low/);
});

test('bearer: findings with no critical/high → med, all buckets empty → ok', () => {
  assert.equal(parseReport('bearer', write('b-med.json', { critical: [], high: [], medium: [{}], low: [{}] })).sev, 'med');
  const clean = parseReport('bearer', write('b-clean.json', { critical: [], high: [], medium: [], low: [] }));
  assert.equal(clean.sev, 'ok');
  assert.equal(clean.total, 0);
});

// FAIL CLOSED. Each of these is a shape that is NOT a bearer document, and every one of them used
// to score green through the `generic` pass-through. `{}` is the sharp case: valid JSON, an object,
// and zero evidence that bearer ever ran.
test('bearer: garbage, {} and an error object are voids, never clean', () => {
  for (const [name, data] of [['bg1', 'not json at all'], ['bg2', {}], ['bg3', { error: 'permission denied' }], ['bg4', []]]) {
    const r = parseReport('bearer', write(`${name}.json`, data));
    assert.equal(r.ok, false, `${name} must not parse as a bearer report`);
    assert.equal(r.sev, 'noscan', `${name} must be a void`);
  }
});

// The lint that was asleep: `generic` is a declared pass-through, so the silent-green warning never
// fired for this lane. `bearer` is now a PARSED format, which is what makes the lint meaningful for
// it at all.
test('bearer is a parsed format, not a pass-through', () => {
  assert.ok(PARSED_FORMATS.has('bearer'));
  assert.ok(!PASSTHROUGH_FORMATS.has('bearer'));
});

// ── rule-counts: the row's severity word is folded into SEVERITY, never passed through ──────────
// Measured 2026-09-30 on cobolwork: agent-config's one `low` row reached classifyReport as sev
// `low`, which index.md rendered 🟢 and the worst-of ranked 0. `crit` took the same two paths.
const ruleCounts = (name, sevs) => write(`${name}.json`, {
  tool: 'agent-config', summary: { findings: sevs.length, byRule: sevs.length ? { r: sevs.length } : {}, filesScanned: 2 },
  findings: sevs.map((sev) => ({ rule: 'r', path: '.claude/settings.json', sev, detail: 'd' })),
});

test('rule-counts: crit and high rows → high; med, low and unrated rows → med; none → ok', () => {
  for (const [rows, want] of [[['crit'], 'high'], [['critical', 'low'], 'high'], [['high'], 'high'],
    [['med'], 'med'], [['medium'], 'med'], [['low'], 'med'], [['low', 'low'], 'med'], [['info'], 'med'], [[undefined], 'med'], [[], 'ok']]) {
    const r = parseReport('rule-counts', ruleCounts(`rc-${rows.join('-') || 'none'}`, rows));
    assert.equal(r.sev, want, `${JSON.stringify(rows)} → ${r.sev}`);
    assert.equal(r.ok, true);
    assert.equal(r.total, rows.length);
  }
});

test('rule-counts: the summary keeps the worst row\'s own word, which the fold drops', () => {
  assert.match(parseReport('rule-counts', ruleCounts('rc-sum-low', ['low'])).summary, /^1 finding across 2 files, worst low — r×1$/);
  assert.match(parseReport('rule-counts', ruleCounts('rc-sum-crit', ['low', 'crit'])).summary, /worst crit/);
  assert.match(parseReport('rule-counts', ruleCounts('rc-sum-info', ['info'])).summary, /worst unrated/);
  assert.equal(parseReport('rule-counts', ruleCounts('rc-sum-none', [])).summary, '0 (2 files)');
});

test('rule-counts: classifyReport returns a SEVERITY word for every row severity, so index.md never greens a finding', async () => {
  const { isSeverity } = await import('../../monitor/check-vocabulary.mjs');
  for (const s of ['crit', 'critical', 'high', 'med', 'medium', 'low', 'info']) {
    const file = `rc-classify-${s}.json`;
    ruleCounts(file.replace(/\.json$/, ''), [s]);
    const { sev } = classifyReport({ id: 'agent-config', report: { format: 'rule-counts', file } }, T, T);
    assert.ok(isSeverity(sev), `${s} row classified as '${sev}'`);
    assert.notEqual(sev, 'ok', `${s} row classified clean`);
  }
});
