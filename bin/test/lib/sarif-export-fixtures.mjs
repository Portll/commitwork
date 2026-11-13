// Fixture run for the SARIF export tests: one repository directory with osv and semgrep reports.
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export const write = (p, body) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body)); };
export const AT = '2026-10-04T00:00:00.000Z';

export const osvSarif = (advs) => ({ version: '2.1.0', runs: [{
  tool: { driver: { name: 'osv-scanner', rules: advs.map((a) => ({ id: a.id, shortDescription: { text: `${a.id}: a flaw in ${a.pkg}` },
    properties: { 'security-severity': String(a.cvss) } })) } },
  invocations: [{ executionSuccessful: true }],
  results: advs.map((a) => ({ ruleId: a.id, message: { text: `Package '${a.pkg}@${a.version}' is vulnerable to '${a.id}'.` },
    locations: [{ physicalLocation: { artifactLocation: { uri: a.uri || 'package-lock.json' } } }] })),
}] });
export const semgrepSarif = (results) => ({ version: '2.1.0', runs: [{
  tool: { driver: { name: 'semgrep', rules: [...new Set(results.map((r) => r.rule))].map((id) => ({ id })) } },
  invocations: [{ executionSuccessful: true }],
  results: results.map((r) => ({ ruleId: r.rule, level: r.level, message: { text: r.message },
    locations: [{ physicalLocation: { artifactLocation: { uri: r.file }, region: { startLine: r.line } } }],
    ...(r.suppressed ? { suppressions: [{ kind: 'inSource' }] } : {}) })),
}] });

export function fixtureRun({ line = 3 } = {}) {
  const run = mkdtempSync(join(tmpdir(), 'cw-sarif-run-'));
  const dir = join(run, 'app');
  write(join(dir, 'summary.md'), '# Security report — app\n\nRepo: `/src/app`\n');
  write(join(dir, 'osv.sarif'), osvSarif([
    { id: 'CVE-2020-0001', pkg: 'big', version: '1.0.0', cvss: 9.8 },
    { id: 'CVE-2020-0004', pkg: 'loose', version: '0.1.0', cvss: 9.1, uri: 'requirements.txt' },
  ]));
  write(join(dir, 'osv-declared.json'), { ran: true, manifests: { 'requirements.txt': { resolved: ['loose@0.1.0'] } } });
  write(join(dir, 'semgrep.sarif'), semgrepSarif([
    { rule: 'r.open', level: 'error', file: 'src/a.js', line, message: 'tainted value reaches eval' },
    { rule: 'r.open', level: 'error', file: 'src/a.js', line: line + 20, message: 'tainted value reaches eval again' },
    { rule: 'r.warn', level: 'warning', file: '/src/app/src/b.js', line: 7, message: 'weak comparison' },
    { rule: 'r.hidden', level: 'error', file: 'src/c.js', line: 9, message: 'reviewed', suppressed: true },
  ]));
  const rows = [{ repo: '/src/app', slug: 'app', commit: 'abc123', cells: {
    'deps-osv': { sev: 'high', summary: '2 advisories' },
    sast: { sev: 'high', summary: '3 (2e/1w)' },
    'dast-nuclei': { sev: 'noscan', summary: 'runtime scanner did not run — no live URL' },
    'sast-opengrep': { sev: 'med', summary: '2', coverage: 'reduced', coverageReason: 'the tool exited 2' },
    'shell-lint': { sev: 'skip', summary: 'no .sh sources' },
  } }];
  return { run, rows };
}
