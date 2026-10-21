// Renders the CRA Art. 14 final report markdown and JSON for a case (cra/report.mjs renderFinal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFinal } from '../report.mjs';

test('renders a vulnerability final report with a verified fix and no overdue clocks', () => {
  const kase = {
    caseId: 'C-1',
    kind: 'vulnerability',
    vulnId: 'CVE-2025-0001',
    title: 'RCE in parser',
    severity: 'high',
    cvss: 9.8,
    epss: 0.9,
    kev: true,
    trigger: 'kev',
    packages: ['pkg@1.0.0'],
    repos: ['org/repo'],
    advisory: 'ADV-1',
    clocks: {
      basis: 'awareness',
      earlyWarningDue: '2025-01-01T00:00:00Z',
      notificationDue: '2025-01-02T00:00:00Z',
      finalDue: '2025-01-15T00:00:00Z',
      finalBasis: 'awareness + 14 days',
    },
  };
  const product = { id: 'p1', name: 'Widget', version: '1.0.0' };
  const manufacturer = { name: 'Acme', contact: 'sec@acme.example' };
  const ledger = [
    { vulnId: 'CVE-2025-0001', repo: 'org/repo', package: 'pkg', fromVersion: '1.0.0', toVersion: '1.0.1', evidence: { tier: 'strong', detail: 'lockfile diff' }, fixCommit: 'abc123' },
  ];
  const ref = '2025-01-01T00:00:00Z';
  const { md, json } = renderFinal(kase, product, manufacturer, ledger, ref);

  assert.equal(json.type, 'final-report');
  assert.equal(json.case, 'C-1');
  assert.equal(json.vulnId, 'CVE-2025-0001');
  assert.equal(json.draft, true);
  assert.equal(json.generatedAt, ref);
  assert.deepEqual(json.verifiedFixes, [
    '- org/repo: pkg 1.0.0 \u2192 1.0.1 (evidence: strong \u2014 lockfile diff; commit abc123)',
  ]);
  assert.equal(json.clocks, kase.clocks);
  assert.equal(json.manufacturer, manufacturer);
  assert.deepEqual(json.product, { id: 'p1', name: 'Widget', version: '1.0.0' });

  assert.match(md, /^# CRA Art\. 14 \u2014 Final report \(14 days\) \u2014 CVE-2025-0001 in Widget$/m);
  assert.match(md, /DRAFT \u2014 NOT SUBMITTED/);
  assert.match(md, /- \*\*Case:\*\* C-1 _\(vulnerability\)_/);
  assert.match(md, /- \*\*Manufacturer:\*\* Acme \(sec@acme\.example\)/);
  assert.match(md, /- \*\*Product:\*\* Widget 1\.0\.0 \(id: p1\)/);
  assert.match(md, /- \*\*Vulnerability:\*\* CVE-2025-0001 \u2014 RCE in parser/);
  assert.match(md, /- \*\*Affected packages:\*\* pkg@1\.0\.0/);
  assert.match(md, /- \*\*Affected components \(repos\):\*\* org\/repo/);
  assert.match(md, /- \*\*Severity:\*\* high \(CVSS 9\.8\) \u00b7 EPSS 0\.9 \u00b7 KEV YES/);
  assert.match(md, /- \*\*Exploitation trigger:\*\* kev \(listed in CISA KEV \u2014 treat as actively exploited\)/);
  assert.match(md, /- \*\*Advisory:\*\* ADV-1/);
  assert.match(md, /- \*\*Description of the vulnerability:\*\* RCE in parser \(CVE-2025-0001\)/);
  assert.match(md, /- \*\*Severity and impact:\*\* high, CVSS 9\.8; TODO final impact statement/);
  assert.match(md, /- \*\*Root cause \(if available\):\*\* TODO/);
  assert.match(md, /- org\/repo: pkg 1\.0\.0 \u2192 1\.0\.1 \(evidence: strong \u2014 lockfile diff; commit abc123\)/);
  assert.match(md, /The measures above are backed by the commitwork remediation ledger/);
  assert.match(md, /- \*\*Awareness basis:\*\* awareness/);
  assert.match(md, /- \*\*Early warning due \(awareness \+ 24h\):\*\* 2025-01-01T00:00:00Z/);
  assert.match(md, /- \*\*Vulnerability notification due \(awareness \+ 72h\):\*\* 2025-01-02T00:00:00Z/);
  assert.match(md, /- \*\*Final report due \(awareness \+ 14 days\):\*\* 2025-01-15T00:00:00Z/);
  assert.doesNotMatch(md, /OVERDUE/);
});

test('marks clocks as overdue when the reference time is after the due time', () => {
  const kase = {
    caseId: 'C-2',
    kind: 'vulnerability',
    vulnId: 'CVE-2025-0002',
    title: 'XSS',
    severity: 'medium',
    cvss: 5.3,
    epss: 0.1,
    kev: false,
    trigger: 'epss',
    packages: [],
    repos: ['org/repo2'],
    clocks: {
      basis: 'awareness',
      earlyWarningDue: '2025-01-01T00:00:00Z',
      notificationDue: '2025-01-02T00:00:00Z',
      finalDue: '2025-01-15T00:00:00Z',
    },
  };
  const product = { id: 'p2', name: 'Gadget', version: '2.0.0' };
  const manufacturer = { name: 'Beta', contact: 'TODO contact' };
  const ref = '2025-01-16T00:00:00Z';
  const { md } = renderFinal(kase, product, manufacturer, [], ref);

  assert.match(md, /- \*\*Early warning due \(awareness \+ 24h\):\*\* 2025-01-01T00:00:00Z  \u26a0\ufe0f OVERDUE/);
  assert.match(md, /- \*\*Vulnerability notification due \(awareness \+ 72h\):\*\* 2025-01-02T00:00:00Z  \u26a0\ufe0f OVERDUE/);
  assert.match(md, /- \*\*Final report due \(awareness \+ 14 days \u2014 recomputed from when a corrective measure is available \(`watch\.mjs measure`\)\):\*\* 2025-01-15T00:00:00Z  \u26a0\ufe0f OVERDUE/);
  assert.match(md, /- \*\*Exploitation trigger:\*\* epss \(EPSS exploitation probability over threshold \u2014 verify active exploitation\)/);
  assert.match(md, /- \*\*Severity:\*\* medium \(CVSS 5\.3\) \u00b7 EPSS 0\.1 \u00b7 KEV no/);
  assert.match(md, /  - TODO \u2014 no verified fix in the remediation ledger yet/);
  assert.match(md, /No strong\/medium-tier ledger entry yet/);
});

test('renders an incident final report with one-month due label and no fixes', () => {
  const kase = {
    caseId: 'C-3',
    kind: 'incident',
    title: 'Mass data breach',
    summary: '10k records leaked',
    severity: 'critical',
    repos: ['org/repo3'],
    packages: ['pkg3@2.0.0'],
    clocks: {
      basis: 'awareness',
      earlyWarningDue: '2025-02-01T00:00:00Z',
      notificationDue: '2025-02-02T00:00:00Z',
      finalDue: '2025-03-01T00:00:00Z',
      finalBasis: 'one month after notification',
    },
  };
  const product = { id: 'p3', name: 'Service', version: '3.0.0' };
  const manufacturer = { name: 'Gamma', contact: 'cirt@gamma.example', euRepresentative: 'EU Rep GmbH' };
  const ref = '2025-02-01T00:00:00Z';
  const { md, json } = renderFinal(kase, product, manufacturer, [], ref);

  assert.equal(json.vulnId, undefined);
  assert.deepEqual(json.verifiedFixes, []);
  assert.match(md, /^# CRA Art\. 14 \u2014 Final report \(one month after notification\) \u2014 incident "Mass data breach" in Service$/m);
  assert.match(md, /- \*\*Case:\*\* C-3 _\(incident\)_/);
  assert.match(md, /- \*\*Manufacturer:\*\* Gamma \(cirt@gamma\.example\)/);
  assert.match(md, /- \*\*EU authorised representative:\*\* EU Rep GmbH/);
  assert.match(md, /- \*\*Incident:\*\* Mass data breach \u2014 10k records leaked/);
  assert.match(md, /- \*\*Trigger:\*\* severe incident \(manufacturer-declared\) \u2014 Art\. 14\(1\) second limb/);
  assert.match(md, /- \*\*Severity:\*\* critical/);
  assert.match(md, /- \*\*Description of the incident:\*\* Mass data breach/);
  assert.match(md, /- \*\*Severity and impact:\*\* critical; TODO final impact statement/);
  assert.match(md, /  - TODO \u2014 no verified fix in the remediation ledger yet/);
  assert.match(md, /No strong\/medium-tier ledger entry yet/);
  assert.match(md, /- \*\*Final report due \(one month after notification\):\*\* 2025-03-01T00:00:00Z/);
  assert.doesNotMatch(md, /OVERDUE/);
});

test('excludes ledger entries that do not match the case repos or evidence tier', () => {
  const kase = {
    caseId: 'C-4',
    kind: 'vulnerability',
    vulnId: 'CVE-2025-0004',
    title: 'SQLi',
    severity: 'high',
    cvss: 8.1,
    epss: null,
    kev: false,
    trigger: 'epss',
    packages: ['pkg4@1.0.0'],
    repos: ['org/repo4'],
    clocks: {
      basis: 'awareness',
      earlyWarningDue: '2025-01-01T00:00:00Z',
      notificationDue: '2025-01-02T00:00:00Z',
      finalDue: '2025-01-15T00:00:00Z',
    },
  };
  const product = { id: 'p4', name: 'App', version: '1.0.0' };
  const manufacturer = { name: 'Delta', contact: 'sec@delta.example' };
  const ledger = [
    { vulnId: 'CVE-2025-0004', repo: 'org/other', package: 'pkg4', fromVersion: '1.0.0', toVersion: '1.0.1', evidence: { tier: 'strong', detail: 'diff' } },
    { vulnId: 'CVE-2025-0004', repo: 'org/repo4', package: 'pkg4', fromVersion: '1.0.0', toVersion: '1.0.1', evidence: { tier: 'weak', detail: 'unconfirmed' } },
    { vulnId: 'CVE-2025-9999', repo: 'org/repo4', package: 'pkg4', fromVersion: '1.0.0', toVersion: '1.0.1', evidence: { tier: 'strong', detail: 'diff' } },
    { vulnId: 'CVE-2025-0004', repo: 'org/repo4', package: 'pkg4', fromVersion: '1.0.0', toVersion: '1.0.1', evidence: { tier: 'medium', detail: 'code review' } },
  ];
  const ref = '2025-01-01T00:00:00Z';
  const { md, json } = renderFinal(kase, product, manufacturer, ledger, ref);

  assert.deepEqual(json.verifiedFixes, [
    '- org/repo4: pkg4 1.0.0 \u2192 1.0.1 (evidence: medium \u2014 code review)',
  ]);
  assert.match(md, /- org\/repo4: pkg4 1\.0\.0 \u2192 1\.0\.1 \(evidence: medium \u2014 code review\)/);
  assert.doesNotMatch(md, /org\/other/);
  assert.doesNotMatch(md, /weak/);
  assert.match(md, /- \*\*Severity:\*\* high \(CVSS 8\.1\) \u00b7 EPSS unknown \u00b7 KEV no/);
  assert.match(md, /The measures above are backed by the commitwork remediation ledger/);
});

test('uses TODO placeholders for missing manufacturer, title, and severity fields', () => {
  const kase = {
    caseId: 'C-5',
    kind: 'vulnerability',
    vulnId: 'CVE-2025-0005',
    severity: undefined,
    cvss: undefined,
    epss: undefined,
    kev: false,
    trigger: 'epss',
    packages: [],
    repos: [],
    clocks: {
      basis: 'awareness',
      earlyWarningDue: '2025-01-01T00:00:00Z',
      notificationDue: '2025-01-02T00:00:00Z',
      finalDue: '2025-01-15T00:00:00Z',
    },
  };
  const product = { id: 'p5', name: 'Tool', version: '0.1.0' };
  const manufacturer = { name: undefined, contact: undefined };
  const ref = '2025-01-01T00:00:00Z';
  const { md } = renderFinal(kase, product, manufacturer, [], ref);

  assert.match(md, /- \*\*Manufacturer:\*\* TODO \(TODO contact\)/);
  assert.doesNotMatch(md, /EU authorised representative/);
  assert.match(md, /- \*\*Vulnerability:\*\* CVE-2025-0005/);
  assert.match(md, /- \*\*Affected packages:\*\* n\/a/);
  assert.match(md, /- \*\*Affected components \(repos\):\*\* n\/a/);
  assert.match(md, /- \*\*Severity:\*\* unknown \u00b7 EPSS unknown \u00b7 KEV no/);
  assert.match(md, /- \*\*Description of the vulnerability:\*\* TODO \(CVE-2025-0005\)/);
  assert.match(md, /- \*\*Severity and impact:\*\* unknown; TODO final impact statement/);
  assert.match(md, /  - TODO \u2014 no verified fix in the remediation ledger yet/);
  assert.match(md, /No strong\/medium-tier ledger entry yet/);
});

test('ignores ledger entries for incidents because vulnId is absent', () => {
  const kase = {
    caseId: 'C-6',
    kind: 'incident',
    title: 'Outage',
    severity: 'high',
    repos: ['org/repo6'],
    packages: ['pkg6@1.0.0'],
    clocks: {
      basis: 'awareness',
      earlyWarningDue: '2025-01-01T00:00:00Z',
      notificationDue: '2025-01-02T00:00:00Z',
      finalDue: '2025-02-01T00:00:00Z',
    },
  };
  const product = { id: 'p6', name: 'Platform', version: '1.0.0' };
  const manufacturer = { name: 'Epsilon', contact: 'sec@epsilon.example' };
  const ledger = [
    { vulnId: 'CVE-2025-0006', repo: 'org/repo6', package: 'pkg6', fromVersion: '1.0.0', toVersion: '1.0.1', evidence: { tier: 'strong', detail: 'diff' } },
  ];
  const ref = '2025-01-01T00:00:00Z';
  const { md, json } = renderFinal(kase, product, manufacturer, ledger, ref);

  assert.deepEqual(json.verifiedFixes, []);
  assert.match(md, /  - TODO \u2014 no verified fix in the remediation ledger yet/);
  assert.match(md, /No strong\/medium-tier ledger entry yet/);
  assert.match(md, /- \*\*Incident:\*\* Outage/);
  assert.match(md, /- \*\*Description of the incident:\*\* Outage/);
});

test('renders an incident with missing title as untitled and uses default final basis', () => {
  const kase = {
    caseId: 'C-7',
    kind: 'incident',
    severity: 'medium',
    repos: ['org/repo7'],
    packages: [],
    clocks: {
      basis: 'awareness',
      earlyWarningDue: '2025-01-01T00:00:00Z',
      notificationDue: '2025-01-02T00:00:00Z',
      finalDue: '2025-02-01T00:00:00Z',
    },
  };
  const product = { id: 'p7', name: 'API', version: '2.0.0' };
  const manufacturer = { name: 'Zeta', contact: 'sec@zeta.example' };
  const ref = '2025-01-01T00:00:00Z';
  const { md } = renderFinal(kase, product, manufacturer, [], ref);

  assert.match(md, /^# CRA Art\. 14 \u2014 Final report \(one month after notification\) \u2014 incident "untitled" in API$/m);
  assert.match(md, /- \*\*Incident:\*\* TODO/);
  assert.match(md, /- \*\*Description of the incident:\*\* TODO/);
  assert.match(md, /- \*\*Severity:\*\* medium/);
  assert.match(md, /- \*\*Final report due \(awareness \+ 14 days \u2014 recomputed from when a corrective measure is available \(`watch\.mjs measure`\)\):\*\* 2025-02-01T00:00:00Z/);
});

test('omits advisory and EU representative lines when those fields are absent', () => {
  const kase = {
    caseId: 'C-8',
    kind: 'vulnerability',
    vulnId: 'CVE-2025-0008',
    title: 'DoS',
    severity: 'low',
    cvss: 3.1,
    epss: 0.01,
    kev: false,
    trigger: 'epss',
    packages: ['pkg8@1.0.0'],
    repos: ['org/repo8'],
    clocks: {
      basis: 'awareness',
      earlyWarningDue: '2025-01-01T00:00:00Z',
      notificationDue: '2025-01-02T00:00:00Z',
      finalDue: '2025-01-15T00:00:00Z',
    },
  };
  const product = { id: 'p8', name: 'Lib', version: '1.0.0' };
  const manufacturer = { name: 'Eta', contact: 'sec@eta.example' };
  const ref = '2025-01-01T00:00:00Z';
  const { md } = renderFinal(kase, product, manufacturer, [], ref);

  assert.doesNotMatch(md, /Advisory/);
  assert.doesNotMatch(md, /EU authorised representative/);
  assert.match(md, /- \*\*Manufacturer:\*\* Eta \(sec@eta\.example\)/);
  assert.match(md, /- \*\*Vulnerability:\*\* CVE-2025-0008 \u2014 DoS/);
  assert.match(md, /- \*\*Severity:\*\* low \(CVSS 3\.1\) \u00b7 EPSS 0\.01 \u00b7 KEV no/);
  assert.match(md, /- \*\*Exploitation trigger:\*\* epss \(EPSS exploitation probability over threshold \u2014 verify active exploitation\)/);
});
