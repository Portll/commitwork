// monitor/rollup.mjs per-finding detail: redaction by whitelist, no silent caps, carry across
// narrow sweeps, determinism. Harness: self-contained reports root + registry via CW_REGISTRY,
// real rollup as a child process, fetch disabled.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';
import { DETAIL_CAP } from '../extractors.mjs';
const HOSTILE = 'HOSTILE-SECRET-VALUE-X9'; // planted in Secret/Match; must appear in NO output

// cap imported, not hardcoded — an over-cap fixture must stay over-cap whatever the number is
assert.ok(Number.isFinite(DETAIL_CAP) && DETAIL_CAP > 0, 'DETAIL_CAP must be a positive number');
const OVER = 50; // rows past the cap in the over-cap fixture
const gitleaksFile = (i) => `f${String(i).padStart(5, '0')}.js`;

const AREAS = [
  { slug: 'primary-area', label: 'primary', out: 'primary-area', primary: true },
  { slug: 'det-area', label: 'detail', out: 'det-area', members: ['alpha', 'beta'] },
];

// one gitleaks record with every field the real tool writes — including the ones that must not cross
const glRow = (file, line, rule) => ({
  RuleID: rule, Description: 'found a secret', StartLine: line, EndLine: line, StartColumn: 1,
  EndColumn: 9, Match: `authorization: ${HOSTILE}`, Secret: HOSTILE, File: file, SymlinkFile: '',
  Commit: 'abc123def4567890', Entropy: 3.7, Author: 'dev', Email: 'dev@example.com',
  Date: '2026-01-01T00:00:00Z', Message: 'commit msg', Tags: [], Fingerprint: `${file}:${rule}:${line}`,
});

const osvSarif = (withMal) => ({ runs: [{ tool: { driver: { name: 'osv-scanner', rules: [
  ...(withMal ? [{ id: 'MAL-2025-47141', shortDescription: { text: 'MAL-2025-47141: malicious code in @ctrl/tinycolor' } }] : []),
  { id: 'CVE-2026-1111', shortDescription: { text: 'CVE-2026-1111: benign vulnerability' } },
] } }, results: [
  ...(withMal ? [{ ruleId: 'MAL-2025-47141', message: { text: "Package '@ctrl/tinycolor@4.1.1' is vulnerable to 'MAL-2025-47141'." },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///src/package-lock.json' } } }] }] : []),
  { ruleId: 'CVE-2026-1111', message: { text: "Package 'undici@7.24.8' is vulnerable to 'CVE-2026-1111'." },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///src/package-lock.json' } } }] },
] }] });

const guarddogSarif = { runs: [{ tool: { driver: { name: 'GuardDog-npm', rules: [
  { id: 'typosquatting', defaultConfiguration: { level: 'warning' }, shortDescription: { text: 'GuardDog rule: typosquatting' } },
  { id: 'risky_new_dependency', defaultConfiguration: { level: 'warning' }, shortDescription: { text: 'GuardDog rule: risky_new_dependency' } },
] } }, results: [
  { ruleId: 'typosquatting', level: 'warning', message: { text: "Package 'evil-package@1.0.0' is a potential typosquat of 'good-package'" },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///src/package-lock.json' } } }] },
  { ruleId: 'risky_new_dependency', level: 'warning', message: { text: 'newly published dependency with no track record' } },
] }] };

const checksRow = (check) => ({ check, status: 'pass', durationMs: 5, at: '2026-08-01T12:00:01.000Z' });

// sastSemgrep lane: one long message (bounded by capMessage) and a snippet carrying the hostile value
const semgrepSarif = { runs: [{ tool: { driver: { name: 'semgrep', rules: [
  { id: 'js.express.xss', properties: { 'security-severity': '8.1', cwe: 'CWE-79: Improper Neutralization of Input During Web Page Generation' } },
] } }, results: [
  { ruleId: 'js.express.xss', message: { text: 'XSS: ' + 'x'.repeat(300) },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'src/app.js' }, region: { startLine: 42, snippet: { text: HOSTILE } } } }] },
  { ruleId: 'js.express.xss', message: { text: 'second finding' },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: 7 } } }] },
] }] };

// nuclei jsonl for the dast lane: the hostname must be stripped AT THE EXTRACTOR, info-severity
// results are neither counted nor rowed, and a scheme-less matched-at still loses its host
const HOSTILE_HOST = 'internal-secret-host.example';
const nucleiJsonl = [
  JSON.stringify({ 'template-id': 'exposed-panel', info: { name: 'Admin panel', severity: 'high' }, 'matched-at': `https://${HOSTILE_HOST}:8443/admin/login` }),
  'not json — must be skipped',
  JSON.stringify({ 'template-id': 'tech-detect', info: { name: 'Tech', severity: 'info' }, 'matched-at': `https://${HOSTILE_HOST}/` }),
  JSON.stringify({ 'template-id': 'open-redirect', info: { name: 'Open redirect', severity: 'medium' }, 'matched-at': `${HOSTILE_HOST}:8080/redirect?x=1` }),
].join('\n');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-detail-'));
  const reg = {
    reportsRoot: join(root, 'reports'), monitorOutput: AREAS[0].out,
    defaultManifest: 'security-baseline', roots: [], projects: [], areas: AREAS,
  };
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify(reg));
  for (const a of AREAS) mkdirSync(join(root, 'reports', a.out), { recursive: true });

  const batch = join(root, 'reports', 'sweep-20260801120000-det-area');
  mkdirSync(join(batch, 'alpha'), { recursive: true });
  mkdirSync(join(batch, 'beta'), { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20260801120000', kind: 'sweep', group: 'all', only: null, sweptAll: false,
    area: 'det-area', areaOut: 'reports/det-area', startedAt: '2026-08-01T12:00:00.000Z',
    scope: { repos: [{ name: 'alpha', manifests: ['security-baseline'] }, { name: 'beta', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} },
    anchors: {},
  }));

  // alpha: 3 gitleaks rows DELIBERATELY out of order, one MAL- + one CVE, two GuardDog signals
  writeFileSync(join(batch, 'alpha', 'gitleaks.json'), JSON.stringify([
    glRow('src/b.js', 10, 'aws-key'), glRow('src/a.js', 99, 'generic-token'), glRow('src/a.js', 5, 'aws-key'),
  ]));
  writeFileSync(join(batch, 'alpha', 'osv.sarif'), JSON.stringify(osvSarif(true)));
  writeFileSync(join(batch, 'alpha', 'guarddog.sarif'), JSON.stringify(guarddogSarif));
  writeFileSync(join(batch, 'alpha', 'semgrep.sarif'), JSON.stringify(semgrepSarif));
  writeFileSync(join(batch, 'alpha', 'nuclei.jsonl'), nucleiJsonl);
  writeFileSync(join(batch, 'alpha', 'checks-status.json'), JSON.stringify(
    ['secrets-gitleaks', 'deps-osv', 'supply-chain-guarddog', 'sast', 'dast-nuclei'].map(checksRow)));

  // beta: DETAIL_CAP + OVER gitleaks rows — over the cap by construction, whatever the cap is
  writeFileSync(join(batch, 'beta', 'gitleaks.json'), JSON.stringify(
    Array.from({ length: DETAIL_CAP + OVER }, (_, i) => glRow(gitleaksFile(i + 1), i + 1, 'generic-token'))));
  writeFileSync(join(batch, 'beta', 'checks-status.json'), JSON.stringify([checksRow('secrets-gitleaks')]));

  return { root, batch, regPath, out: join(root, 'reports', 'det-area') };
}

// a narrow follow-up batch that re-runs ONLY deps-osv (so secrets + guarddog must carry)
function narrowBatch(root, stamp) {
  const b = join(root, 'reports', `sweep-${stamp}-det-area`);
  mkdirSync(join(b, 'alpha'), { recursive: true });
  writeFileSync(join(b, 'batch-manifest.json'), JSON.stringify({
    sliceId: `sweep-${stamp}`, kind: 'sweep', group: 'supply-chain', only: null, sweptAll: false,
    area: 'det-area', areaOut: 'reports/det-area', startedAt: '2026-08-01T13:00:00.000Z',
    scope: { repos: [{ name: 'alpha', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} },
    anchors: {},
  }));
  writeFileSync(join(b, 'alpha', 'osv.sarif'), JSON.stringify(osvSarif(false))); // CVE only — zero MAL, measured fresh
  writeFileSync(join(b, 'alpha', 'checks-status.json'), JSON.stringify([checksRow('deps-osv')]));
  return b;
}

const runRollup = (regPath, batch, env = {}) => spawnSync(
  process.execPath, ['--import', NO_FETCH, ROLLUP, batch],
  { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: regPath, CW_MONITOR_OUT: '', ...env } });

const readRollup = (out) => JSON.parse(readFileSync(join(out, 'rollup.json'), 'utf8'));

// the fixture, rolled once — shared by the §1 shape tests
const FX = fixture();
{
  const r = runRollup(FX.regPath, FX.batch);
  assert.equal(r.status, 0, `fixture rollup failed: ${r.stderr?.slice(0, 500)}`);
}

describe('§1 — findings[]: whitelisted, sorted, capped — fleet block only, per-repo copy stripped', () => {
  test('gitleaks rows are whitelisted and sorted, and an UNVERIFIED row carries no severity', () => {
    // CHANGED 2026-08-24. This test used to assert sev:'high' on every row and
    // `high === 3`, with the note "counts must stay byte-compatible with the old extractor".
    // That byte-compatibility was to a defect: gitleaks performs no verification, and the lane
    // published 2,368 unverified regex matches at HIGH across the 100-repo corpus while the
    // sibling TruffleHog lane found 3 live credentials in the entire fleet. An unverified row is
    // now UNDETERMINED — counted outside crit/high/med/low — and the fixture has no verification
    // sidecar, so all three rows land there. `verified: null` is the honest state, not `false`.
    //
    // EXTENDED 2026-08-29: `context` and `publicByDesign` joined the secrets schema, so every
    // whitelisted row now carries them. rowsFor() materialises EVERY declared field through
    // COERCE, so a row whose extractor omitted them (extractors.mjs:1317 emits each only when
    // truthy) gets '' and false here. That is correct for these two and not a repeat of the
    // verified/tri problem above: publicByDesign is `PUBLIC_BY_DESIGN.has(rule)` at
    // extractors.mjs:1304 — a closed-set lookup that is genuinely true or false for every rule,
    // never unknown. `verified` needed `tri` because absence there means "no verifier could be
    // asked"; absence here means "this rule is not in the set", which IS false.
    const rollup = readRollup(FX.out);
    const alphaRows = rollup.scannerFindings.secrets.filter((f) => f.repo === 'alpha');
    assert.deepEqual(alphaRows, [
      { repo: 'alpha', rule: 'aws-key', file: 'src/a.js', line: 5, sev: '', verified: null, entropy: 3.7, testPath: false, commit: 'abc123def4567890', redacted: true , context: '', publicByDesign: false },
      { repo: 'alpha', rule: 'generic-token', file: 'src/a.js', line: 99, sev: '', verified: null, entropy: 3.7, testPath: false, commit: 'abc123def4567890', redacted: true , context: '', publicByDesign: false },
      { repo: 'alpha', rule: 'aws-key', file: 'src/b.js', line: 10, sev: '', verified: null, entropy: 3.7, testPath: false, commit: 'abc123def4567890', redacted: true , context: '', publicByDesign: false },
    ]);
    const alpha = rollup.repos.find((x) => x.name === 'alpha');
    assert.equal('truncated' in alpha.scanners.secrets, false, 'nothing was dropped, so no truncated marker');
    assert.equal(alpha.scanners.secrets.total, 3, 'every row is still COUNTED — undetermined is not dropped');
    assert.equal(alpha.scanners.secrets.high, 0,
      'THE REGRESSION GUARD: an unverified regex match must never publish as high again');
    assert.equal(alpha.scanners.secrets.undetermined, 3, 'it is counted here instead, in its own field');
  });

  test('the per-repo findings copy is STRIPPED — the fleet block is the only serialized detail', () => {
    // the duplicate was 105 KB of one project's 382 KB rollup and nothing read it; truncated/counts stay
    const rollup = readRollup(FX.out);
    for (const r of rollup.repos) {
      for (const [key, c] of Object.entries(r.scanners || {})) {
        assert.equal('findings' in c, false, `${r.name}.scanners.${key} still carries a per-repo findings copy`);
      }
    }
  });

  test('an over-cap repo yields exactly DETAIL_CAP rows AND records what was dropped', () => {
    const rollup = readRollup(FX.out);
    const s = rollup.repos.find((x) => x.name === 'beta').scanners.secrets;
    assert.equal(s.truncated, OVER, 'the cap must be recorded per repo, never a silent slice');
    assert.equal(s.total, DETAIL_CAP + OVER, 'the COUNT stays the real total — only the detail is bounded');
    const betaRows = rollup.scannerFindings.secrets.filter((f) => f.repo === 'beta');
    assert.equal(betaRows.length, DETAIL_CAP);
    assert.equal(betaRows[0].file, gitleaksFile(1));
    assert.equal(betaRows[DETAIL_CAP - 1].file, gitleaksFile(DETAIL_CAP));
  });

  test('NO artifact the rollup writes contains secret material — not the value, not the source fields', () => {
    const walk = (d, acc = []) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, acc); else acc.push(p);
      }
      return acc;
    };
    for (const f of walk(FX.out)) {
      const t = readFileSync(f, 'utf8');
      assert.ok(!t.includes(HOSTILE), `${f} leaks the planted secret value`);
      // the source fields must not be copied either — "Secret":"REDACTED" is one drift from "Secret":"AKIA..."
      if (f.endsWith('.json')) {
        assert.ok(!/"(Secret|Match|Entropy|Fingerprint)"/.test(t), `${f} copies gitleaks source fields`);
      }
    }
  });

  test('OSV MAL- rows: id/package/version/ecosystem/advisory — scoped names keep their scope', () => {
    const rollup = readRollup(FX.out);
    assert.deepEqual(rollup.scannerFindings.maliciousPackages, [{
      repo: 'alpha', id: 'MAL-2025-47141', package: '@ctrl/tinycolor', version: '4.1.1',
      ecosystem: 'npm', advisory: 'https://osv.dev/vulnerability/MAL-2025-47141',
    }]);
    const alpha = rollup.repos.find((x) => x.name === 'alpha');
    assert.equal(alpha.scanners.maliciousPackages.crit, 1, 'the plain CVE result must not enter the MAL lane');
    assert.equal(alpha.scanners.maliciousPackages.total, 1);
  });

  test('GuardDog rows: rule/package/version/message, package honest-empty when the text has none', () => {
    const rollup = readRollup(FX.out);
    // The row shape is unchanged by the capability/verdict split — deliberately. The family is
    // determined by the rule prefix these rows already carry, and the split lives in the CATEGORY
    // counts (`capability`, `verdicts`), where it changes what is published as a finding.
    assert.deepEqual(rollup.scannerFindings.supplyChainHeuristic, [
      { repo: 'alpha', rule: 'risky_new_dependency', package: '', version: '', message: 'newly published dependency with no track record' },
      { repo: 'alpha', rule: 'typosquatting', package: 'evil-package', version: '1.0.0', message: "Package 'evil-package@1.0.0' is a potential typosquat of 'good-package'" },
    ]);
  });

  test('SARIF rows (sastSemgrep): rule/file/line/sev/message/cwe — bounded and self-declaring, sev is the tally bucket', () => {
    // the property, not the number: the copy stays bounded, and a truncated message must SAY so
    const rollup = readRollup(FX.out);
    const rows = rollup.scannerFindings.sastSemgrep;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { repo: 'alpha', rule: 'js.express.xss', file: 'src/a.js', line: 7, sev: 'high', message: 'second finding', cwe: 'CWE-79', corroboratedBy: '' });
    assert.equal(rows[1].file, 'src/app.js');
    assert.equal(rows[1].line, 42);
    assert.equal(rows[1].cwe, 'CWE-79', 'the rule asserts one CWE; both results under it carry the same rule-level tag');
    assert.ok(rows[1].message.length <= 4200, 'the copy is bounded — a SARIF message can carry source text');
    assert.ok(rows[1].message.length > 240, 'and it is no longer cut at 240, which truncated 48% of real diagnoses');
    assert.doesNotMatch(rows[1].message, /truncated at/, 'a message under the cap must not claim it was truncated');
    assert.equal(rollup.scanners.sastSemgrep.high, 2, 'counts stay byte-compatible with the counts-only extractor');
    assert.equal(rollup.scanners.sastSemgrep.total, 2);
  });

  test('a message OVER the cap is truncated and says so — silent truncation is the defect', async () => {
    // a reader who can see the cut knows to open the SARIF
    const { capMessage, MESSAGE_CAP } = await import('../extractors.mjs');
    const long = 'x'.repeat(MESSAGE_CAP + 500);
    const out = capMessage(long);
    assert.ok(out.length > MESSAGE_CAP, 'the marker is appended, not squeezed inside the budget');
    assert.match(out, /truncated at 4000 chars/, 'truncation must announce itself');
    assert.equal(capMessage('short one'), 'short one', 'text under the cap passes through untouched');
  });

  test('nuclei rows (dast): the PORT is carried and the HOSTNAME is not — they are different claims', () => {
    // a port names a SERVICE and is carried; a hostname names a MACHINE and never travels
    const rollup = readRollup(FX.out);
    assert.deepEqual(rollup.scannerFindings.dast, [
      { repo: 'alpha', rule: 'exposed-panel', sev: 'high', path: '/admin/login', port: '8443', proto: '', name: 'Admin panel' },
      { repo: 'alpha', rule: 'open-redirect', sev: 'med', path: '/redirect?x=1', port: '8080', proto: '', name: 'Open redirect' },
    ]);
    assert.notEqual(rollup.scannerFindings.dast[0].port, rollup.scannerFindings.dast[1].port);
    // proto is honest-empty: absent stays absent, never guessed from the scheme
    assert.equal(rollup.scannerFindings.dast[0].proto, '');
    const alpha = rollup.repos.find((x) => x.name === 'alpha');
    assert.equal(alpha.scanners.dast.total, 2, 'info-severity results are neither counted nor rowed');
    assert.equal(alpha.scanners.dast.high, 1);
    assert.equal(alpha.scanners.dast.med, 1);
    // the scanned hostname must never reach ANY artifact the rollup writes
    const walk = (d, acc = []) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, acc); else acc.push(p);
      }
      return acc;
    };
    for (const f of walk(FX.out)) assert.ok(!readFileSync(f, 'utf8').includes(HOSTILE_HOST), `${f} leaks the scanned hostname`);
  });
});

describe('§2 — fleet-shaped scannerFindings', () => {
  test('flattened {repo, ...finding}, sorted by repo then the per-category key', () => {
    const sf = readRollup(FX.out).scannerFindings;
    assert.deepEqual(Object.keys(sf).sort(), ['dast', 'maliciousPackages', 'sastSemgrep', 'secrets', 'supplyChainHeuristic']);
    assert.equal(sf.secrets.length, 3 + DETAIL_CAP, '3 alpha rows + the capped beta rows');
    assert.equal(sf.secrets[0].repo, 'alpha');
    assert.deepEqual(sf.secrets[0], { repo: 'alpha', rule: 'aws-key', file: 'src/a.js', line: 5, sev: '', verified: null, entropy: 3.7, testPath: false, commit: 'abc123def4567890', redacted: true, context: '', publicByDesign: false });
    assert.ok(sf.secrets.slice(3).every((r) => r.repo === 'beta'), 'alpha sorts before beta');
    assert.equal(sf.maliciousPackages.length, 1);
    assert.equal(sf.maliciousPackages[0].repo, 'alpha');
  });

  test('a narrow sweep CARRIES detail for what it did not re-run, and stays fresh for what it did', () => {
    const before = readRollup(FX.out);
    const r = runRollup(FX.regPath, narrowBatch(FX.root, '20260801130000'));
    assert.equal(r.status, 0, `narrow rollup failed: ${r.stderr?.slice(0, 500)}`);
    const after = readRollup(FX.out);

    assert.equal(after.scanners.secrets.carried, true, 'setup: secrets was not re-run');
    assert.deepEqual(after.scannerFindings.secrets, before.scannerFindings.secrets,
      'the drill-down must not empty while the count still stands');
    assert.equal(after.scanners.supplyChainHeuristic.carried, true);
    assert.deepEqual(after.scannerFindings.supplyChainHeuristic, before.scannerFindings.supplyChainHeuristic);

    // deps-osv DID run: zero MAL- is a fresh, affirmative measurement — not carried, not absent
    assert.ok(!after.scanners.maliciousPackages.carried, 'a re-run category must not be labelled carried');
    assert.deepEqual(after.scannerFindings.maliciousPackages, [],
      'fresh zero renders as an EMPTY list, distinct from carried detail');
  });

  test('carried detail CHAINS through a second narrow sweep', () => {
    const first = readRollup(FX.out);
    const r = runRollup(FX.regPath, narrowBatch(FX.root, '20260801140000'));
    assert.equal(r.status, 0, `second narrow rollup failed: ${r.stderr?.slice(0, 500)}`);
    const after = readRollup(FX.out);
    assert.equal(after.scanners.secrets.carried, true, 'still carried after TWO narrow sweeps');
    assert.deepEqual(after.scannerFindings.secrets, first.scannerFindings.secrets);
  });
});

describe('§1 determinism — the rerollup gate must keep holding with detail arrays in the output', () => {
  test('two rolls of the same batch differ only by ISO timestamp and stamp', () => {
    const fx = fixture();
    const outs = [mkdtempSync(join(tmpdir(), 'cw-det-a-')), mkdtempSync(join(tmpdir(), 'cw-det-b-'))];
    for (const o of outs) {
      const r = runRollup(fx.regPath, fx.batch, { CW_MONITOR_OUT: o });
      assert.equal(r.status, 0, `rollup failed: ${r.stderr?.slice(0, 400)}`);
    }
    const norm = (s) => s
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ISO>')
      .replace(/(?<!\d)\d{14}(?!\d)/g, '<STAMP>');
    const [a, b] = outs.map((o) => norm(readFileSync(join(o, 'rollup.json'), 'utf8')));
    assert.equal(a, b, 'NON-DETERMINISTIC rollup.json — a finding array is unsorted or a wall-clock value leaked');
  });
});
