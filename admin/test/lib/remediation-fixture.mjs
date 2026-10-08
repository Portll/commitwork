// admin/test/lib/remediation-fixture.mjs — a synthetic reports tree for the remediation layer:
// two projects whose inputs differ, one declared project with nothing on disk, and one undeclared
// report directory. Every name is invented; nothing here describes a real project.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARTIFACT_MARKER = 'REMFLEET-ARTIFACT-7C1';
export const ALPHA_BATCH = 'sweep-20260901000000-alpha';
export const BETA_BATCH = 'sweep-20260902000000-beta';

/** A plan in the shape monitor/rollup.mjs writes: tables under section headings, no bullets. */
export function planText({ main, low, kev = 0, stamp = '2026-09-01T00:00:00.000Z' }) {
  const table = (n, sev) => ['| # | Package | Severity | EPSS | Fix | Affected repos | CVEs |', '|---|---|---|---|---|---|---|',
    ...Array.from({ length: n }, (_, i) => `| ${i + 1} | \`pkg-${sev.toLowerCase()}-${i}\` @1.0.0 | ${sev} | 1.0% | 1.0.1 | demo-app | CVE-2000-${1000 + i} |`)];
  return [
    '# CVE remediation plan', '',
    `Generated ${stamp} from \`sweep-fixture\`. Prioritised by **KEV (known-exploited) → severity → EPSS (exploit probability) → blast radius**.`, '',
    `**Headline:** 1 critical · 4 high · 2 medium · 2 low · **${kev} on CISA KEV**.`, '',
    ...(kev ? ['## 🚨 KEV — known exploited (patch first, any severity)', '',
      '| Package | Severity | EPSS | Fix | Repos | CVE |', '|---|---|---|---|---|---|',
      ...Array.from({ length: kev }, (_, i) => `| \`pkg-kev-${i}\` | Critical | 90.0% | 2.0.0 | demo-app | CVE-2000-000${i} |`), ''] : []),
    `## Critical / High / Medium — ${main[0]} packages, ${main[1]} findings`, '', ...table(main[0], 'High'), '',
    `## Low severity — ${low[0]} packages, ${low[1]} findings`, '', ...table(low[0], 'Low'), '',
    '## How to apply', '',
    '1. **KEV first** — anything in the KEV table is actively exploited in the wild; patch regardless of CVSS.', '',
  ].join('\n');
}

const json = (p, v) => writeFileSync(p, JSON.stringify(v));

export function buildRemediationFixture(T) {
  const reports = join(T, 'reports');
  const repos = join(T, 'repos');
  for (const r of ['alpha-app', 'beta-app']) mkdirSync(join(repos, r), { recursive: true });
  const reg = {
    reportsRoot: reports, monitorOutput: 'alpha', defaultManifest: 'security-baseline', roots: [],
    areas: [
      { slug: 'alpha', label: 'Alpha', out: 'alpha', primary: true },
      { slug: 'beta', label: 'Beta', out: 'beta' },
      { slug: 'gamma', label: 'Gamma', out: 'gamma' },
    ],
    projects: [
      { name: 'alpha-app', path: join(repos, 'alpha-app'), area: 'alpha', manifest: 'security-baseline' },
      { name: 'beta-app', path: join(repos, 'beta-app'), area: 'beta', manifest: 'security-baseline' },
    ],
  };
  const registryPath = join(T, 'projects.json');
  json(registryPath, reg);

  // alpha — every input present, and its batch named RELATIVE to the reports root, as sourceKey() writes it
  mkdirSync(join(reports, ALPHA_BATCH, 'alpha-app'), { recursive: true });
  json(join(reports, ALPHA_BATCH, 'alpha-app', 'gitleaks.json'), [{ RuleID: 'demo-rule', File: 'src/a.js', StartLine: 3, note: ARTIFACT_MARKER }]);
  const A = join(reports, 'alpha');
  mkdirSync(join(A, 'codeql-remediation'), { recursive: true });
  mkdirSync(join(A, 'handoff'), { recursive: true });
  json(join(A, 'rollup.json'), { generated: '2026-09-01T00:00:00.000Z', source: ALPHA_BATCH,
    scanners: { secrets: { crit: 0, high: 2, med: 0, low: 0, total: 2, repos: 1, ran: 1, skipped: 0, noscan: 0, check: 'secrets-gitleaks' } },
    repos: [{ name: 'alpha-app', scanners: { secrets: { total: 2 } } }] });
  writeFileSync(join(A, 'REMEDIATION.md'), planText({ main: [3, 7], low: [1, 2], kev: 1 }));
  json(join(A, 'remediation-ledger.json'), { note: 'fixture', entries: [{ key: 'demo|1' }, { key: 'demo|2' }] });
  json(join(A, 'codeql-fleet.json'), { findings: [{ service: 'alpha-app', ruleId: 'js/demo-rule', file: 'a.js', sarif: 'codeql.sarif', severity: 'error', message: 'demo' }] });
  json(join(A, 'codeql-remediation', '0123456789abcdef.json'), { id: '0123456789abcdef', state: 'lodged' });
  writeFileSync(join(A, 'handoff', 'secrets-gitleaks-1.md'), '# an earlier triage\n');
  writeFileSync(join(A, 'handoff', 'secrets-gitleaks-demo-1.verdict.json'), '{}');

  // beta — scanned clean, a zero plan, and a batch the rollup names that is no longer on disk
  const B = join(reports, 'beta');
  mkdirSync(B, { recursive: true });
  json(join(B, 'rollup.json'), { generated: '2026-09-02T00:00:00.000Z', source: BETA_BATCH,
    scanners: { secrets: { crit: 0, high: 0, med: 0, low: 0, total: 0, repos: 1, ran: 1, skipped: 0, noscan: 0, check: 'secrets-gitleaks' } },
    repos: [{ name: 'beta-app', scanners: { secrets: { total: 0 } } }] });
  writeFileSync(join(B, 'REMEDIATION.md'), planText({ main: [0, 0], low: [0, 0] }));

  // gamma — declared, never scanned: no directory at all

  // stray — an undeclared report directory holding a rollup
  mkdirSync(join(reports, 'stray'), { recursive: true });
  json(join(reports, 'stray', 'rollup.json'), { generated: '2026-08-01T00:00:00.000Z', scanners: {} });

  return { reg, registryPath, reports, repos };
}
