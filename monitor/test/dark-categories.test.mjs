// The seven categories that had a scanner, an artifact and a remediation prompt but no category.
// Pins: every prompt-carrying, artifact-producing check resolves to a rollup category (or a
// declared alias), and the extractors distinguish a VOID from a clean zero.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCANNER_CHECKS, CHECK_ALIASES, canonicalCheck } from '../scanner-checks.mjs';
import { parseReport } from '../../bin/commitwork.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = join(HERE, '..', '..');
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

describe('every scanner that writes an artifact reaches a category', () => {
  const CHECK_TO_CAT = new Map(Object.entries(SCANNER_CHECKS).map(([cat, id]) => [id, cat]));

  test('the seven formerly-dark checks all have a category now', () => {
    for (const id of ['secrets', 'sast-go-gosec', 'deps-go-govulncheck', 'dockerfile-lint',
      'tls-headers', 'api-fuzz', 'cspm-github']) {
      assert.ok(CHECK_TO_CAT.get(id), `${id} writes a report but resolves to no rollup category — its panel card would say "no live counts"`);
    }
  });

  test('a declared alias names a check that really exists, and is not itself a category', () => {
    for (const [alias, target] of Object.entries(CHECK_ALIASES)) {
      assert.ok(CHECK_TO_CAT.get(target), `alias ${alias} points at ${target}, which has no category`);
      assert.equal(CHECK_TO_CAT.get(alias), undefined, `${alias} is an alias and must not also be a category in its own right`);
      assert.equal(canonicalCheck(alias), target);
    }
  });

  test('an alias and its target are the SAME scanner — same report file, or the claim is false', () => {
    // an alias claims two ids are ONE scanner — different artifacts would make crediting both a provenance lie
    const byId = new Map();
    for (const name of ['runtime', 'security-baseline']) {
      for (const c of readJSON(join(CW, 'manifests', `${name}.json`)).checks || []) {
        if (!byId.has(c.id)) byId.set(c.id, c);
      }
    }
    for (const [alias, target] of Object.entries(CHECK_ALIASES)) {
      const a = byId.get(alias), t = byId.get(target);
      if (!a || !t) continue; // an alias for a check outside these two manifests is out of scope here
      assert.equal(a.report && a.report.file, t.report && t.report.file,
        `${alias} and ${target} are declared as one scanner but write different report files`);
    }
  });

  test('canonicalCheck is identity for anything not declared an alias', () => {
    for (const id of ['secrets-gitleaks', 'sast', '', 'nope', '__proto__', 'constructor']) {
      assert.equal(canonicalCheck(id), id);
    }
  });
});

describe('a void is never a clean zero', () => {
  let dir;
  const write = (name, body) => { writeFileSync(join(dir, name), body); return join(dir, name); };
  test.beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cw-dark-')); });
  test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test('schemathesis: a run whose spec never loaded is noscan, NOT a pass', () => {
    // the exact measured stream shape — the old generic format scored ok because the file existed
    const p = write('s.ndjson', [
      JSON.stringify({ Initialize: { command: 'st run …' } }),
      JSON.stringify({ LoadingStarted: { id: 'x' } }),
      JSON.stringify({ FatalError: { exception: { type: 'LoaderError', message: 'Failed to load schema due to client error (HTTP 401 Unauthorized)' } } }),
    ].join('\n'));
    const r = parseReport('schemathesis', p);
    assert.equal(r.sev, 'noscan', 'nothing was fuzzed, so there is no result to be clean');
    assert.match(r.summary, /401/, 'and the cause travels with it');
  });

  test('schemathesis: scenarios that ran and passed ARE a clean result', () => {
    const p = write('s.ndjson', [
      JSON.stringify({ ScenarioFinished: { status: 'success' } }),
      JSON.stringify({ ScenarioFinished: { status: 'success' } }),
    ].join('\n'));
    const r = parseReport('schemathesis', p);
    assert.equal(r.sev, 'ok');
    assert.equal(r.total, 0);
  });

  test('schemathesis: a failing scenario is high — a 500 or a contract breach is a defect', () => {
    const p = write('s.ndjson', [
      JSON.stringify({ ScenarioFinished: { status: 'failure' } }),
      JSON.stringify({ ScenarioFinished: { status: 'success' } }),
    ].join('\n'));
    const r = parseReport('schemathesis', p);
    assert.equal(r.sev, 'high');
    assert.equal(r.total, 1);
  });

  test('tls-headers: ran:false is a noscan, not a grade of zero missing headers', () => {
    const p = write('t.json', JSON.stringify({ ran: false, skipped: true, reason: 'no CW_TARGET_URL' }));
    const r = parseReport('tls-headers', p);
    assert.equal(r.sev, 'noscan');
    assert.match(r.summary, /no CW_TARGET_URL/);
  });

  test('tls-headers: missing headers are counted and graded med, an expired cert high', () => {
    const p = write('t.json', JSON.stringify({ ran: true,
      headers: { ran: true, grade: 'C', missing: ['strict-transport-security', 'content-security-policy'] },
      tls: { ran: true, findings: [{ severity: 'high', issue: 'certificate expired' }] } }));
    const r = parseReport('tls-headers', p);
    assert.equal(r.sev, 'high', 'a bad certificate outranks missing headers');
    assert.equal(r.total, 3);
  });

  test('cspm-github: a self-gated skip is a noscan — never "0 failing controls"', () => {
    const p = write('c.json', JSON.stringify({ ran: false, skipped: true, reason: 'PROWLER_GITHUB_TOKEN unset' }));
    const r = parseReport('cspm-github', p);
    assert.equal(r.sev, 'noscan', 'no control was evaluated, so zero failures would be an inversion');
    assert.match(r.summary, /PROWLER_GITHUB_TOKEN/);
  });

  test('cspm-github: real failing controls are high; all-passing is ok', () => {
    assert.equal(parseReport('cspm-github', write('a.json', JSON.stringify({ ran: true, pass: 20, fail: 3 }))).sev, 'high');
    const clean = parseReport('cspm-github', write('b.json', JSON.stringify({ ran: true, pass: 23, fail: 0 })));
    assert.equal(clean.sev, 'ok');
    assert.equal(clean.total, 0);
  });
});

describe('the tokenless GitHub-posture lane', () => {
  const baseline = readJSON(join(CW, 'manifests', 'security-baseline.json'));
  const check = (id) => (baseline.checks || []).find((c) => c.id === id);

  test('zizmor runs OFFLINE — the whole point is a lane no missing token can void', () => {
    const z = check('actions-zizmor');
    assert.ok(z, 'actions-zizmor must be declared in security-baseline');
    const cmd = (z.local || []).join(' ');
    assert.match(cmd, /--offline/,
      'without --offline zizmor enables online rules and wants a GH token, which re-creates the gap this check exists to close');
    assert.ok(!(z.requires || {}).secrets,
      'declaring a secret would gate the check in the runner and make it skippable for want of a credential it does not need');
    assert.deepEqual(z.appliesIfExists, ['.github/workflows'],
      'a repo with no workflows has no Actions posture to audit — it should skip, not noscan');
    assert.ok((baseline.groups.all || []).includes('actions-zizmor'), 'it must be in the sweep');
  });

  test('zizmor reports SARIF, so it reuses the parsed path rather than a pass-through', async () => {
    const { PARSED_FORMATS } = await import('../../bin/commitwork.mjs');
    assert.equal(check('actions-zizmor').report.format, 'sarif');
    assert.ok(PARSED_FORMATS.has('sarif'));
  });

  test('cspm no longer hard-gates on a dedicated token it may not need', () => {
    const c = check('cspm-github');
    assert.ok(!(c.requires || {}).secrets,
      'requires.secrets resolves from env/keychain only, so it blocked the check before bin/cspm-github.sh could offer the existing gh session — the script is the authority on its own credential');
    assert.deepEqual((c.requires || {}).tools, ['prowler']);
  });

  test('the cspm script keeps CI from scanning on an ambient credential', () => {
    const sh = readFileSync(join(CW, 'bin', 'cspm-github.sh'), 'utf8');
    assert.match(sh, /CI:-/, 'the gh fallback must be refused when $CI is set');
    assert.match(sh, /gh auth token/, 'and must otherwise reuse the operator’s existing session');
    assert.match(sh, /"credential":"%s"/,
      'which credential was used is provenance the report has to carry — "the dedicated auditor token" and "whoever was logged into gh" are different claims');
  });

  test('prowler exit 3 is a RESULT, not a failed scan', () => {
    // 3 means completed-with-failures — treating it as an error discards the runs with something to report
    const sh = readFileSync(join(CW, 'bin', 'cspm-github.sh'), 'utf8');
    assert.match(sh, /0\|3\)/, 'exit 0 and 3 must both be accepted as completed scans');
  });
});

describe('the report-format contract', () => {
  test('the new formats are declared PARSED, not pass-through — a pass-through scores green regardless', async () => {
    const { PARSED_FORMATS, PASSTHROUGH_FORMATS } = await import('../../bin/commitwork.mjs');
    for (const f of ['schemathesis', 'tls-headers', 'cspm-github']) {
      assert.ok(PARSED_FORMATS.has(f), `${f} must be a parsed format`);
      assert.ok(!PASSTHROUGH_FORMATS.has(f), `${f} must not be a pass-through`);
    }
  });

  test('no bundled manifest still routes a findings-bearing report through a pass-through format', async () => {
    const { PASSTHROUGH_FORMATS } = await import('../../bin/commitwork.mjs');
    // These checks produce findings, so scoring them on file-existence alone is a silent green.
    const MUST_PARSE = new Set(['api-fuzz', 'api-fuzz-schemathesis', 'tls-headers', 'cspm-github',
      'dockerfile-lint', 'secrets', 'secrets-gitleaks', 'sast', 'sast-codeql', 'sast-codeql-java',
      'sast-go-gosec', 'deps-osv', 'deps-jvm', 'iac-config', 'dast-nuclei']);
    for (const name of ['security-baseline', 'runtime']) {
      for (const c of readJSON(join(CW, 'manifests', `${name}.json`)).checks || []) {
        if (!MUST_PARSE.has(c.id) || !c.report) continue;
        assert.ok(!PASSTHROUGH_FORMATS.has(c.report.format),
          `${name}/${c.id} declares report.format '${c.report.format}', a pass-through — it scores GREEN whatever the report says`);
      }
    }
  });
});
