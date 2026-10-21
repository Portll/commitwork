// REMEDIATION.md's section for scanner findings outside the dependency tables: what it lists, what it
// never lists, and that a finding's message (which can carry a matched secret) never reaches it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scannerRemediationSection } from '../remediation-scanner-section.mjs';

const SECRET = 'AKIA-PLANTED-SECRET-VALUE';
const findings = {
  iac: [
    { repo: 'ironwork', rule: 'DS-0002', file: 'tools/gcobol/Dockerfile', line: 1, sev: 'high', message: 'Specify at least 1 USER command' },
    { repo: 'veld', rule: 'DS-0002', file: 'docker/x.Dockerfile', line: 1, sev: 'high', message: 'm' },
    { repo: 'ironwork', rule: 'DS-0026', file: 'tools/gcobol/Dockerfile', line: 1, sev: 'low', message: 'healthcheck' },
  ],
  secrets: [{ repo: 'demo-shop', rule: 'generic-api-key', file: 'a.env', line: 3, sev: 'crit', message: `found ${SECRET}` }],
  sastSemgrep: [
    { repo: 'demo-shop', rule: 'js.x|y', file: 'src/a|b.js', line: 2, sev: 'high', message: 'pipe' },
    { repo: 'demo-shop', rule: 'js.suppressed', file: 'src/c.js', line: 9, sev: 'crit', message: 's', annotation: { action: 'false-positive' } },
  ],
  depsRetire: [{ repo: 'demo-shop', rule: 'CVE-1', file: 'package.json', sev: 'crit', message: 'dep' }],
  stubs: [{ repo: 'demo-shop', rule: 'todo', file: 'a.js', sev: 'high', message: 'TODO' }],
};
const titles = { iac: { 'DS-0002': "Image user should not be 'root'" } };

test('critical first, then the widest rule; titled where the rule has a title', () => {
  const md = scannerRemediationSection(findings, titles).join('\n');
  assert.match(md, /## Code, secrets and configuration — critical and high — 3 rules, 4 sites/);
  const rows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l));
  assert.equal(rows.length, 3);
  assert.match(rows[0], /^\| 1 \| Critical \| vulnerability \| `generic-api-key` \| secrets \| 1 \| demo-shop \|/);
  assert.match(rows[1], /^\| 2 \| High \| posture \| Image user should not be 'root' \(`DS-0002`\) \| iac \| 2 \| ironwork, veld \|/);
});

test('dependency, metric, suppressed and below-high rows are not listed', () => {
  const md = scannerRemediationSection(findings, titles).join('\n');
  for (const absent of ['DS-0026', 'js.suppressed', 'CVE-1', 'todo']) assert.ok(!md.includes(absent), `${absent} must not be listed`);
});

test('a finding message never reaches the plan, and table cells cannot break the table', () => {
  const md = scannerRemediationSection(findings, titles).join('\n');
  assert.ok(!md.includes(SECRET), 'a matched secret must not be written into the plan');
  assert.match(md, /`js\.x\\\|y`/);
  assert.match(md, /`src\/a\\\|b\.js`/);
});

test('nothing at critical or high writes no section; a long list states what it left out', () => {
  assert.deepEqual(scannerRemediationSection({ iac: [{ repo: 'r', rule: 'x', sev: 'med' }] }), []);
  assert.deepEqual(scannerRemediationSection({}), []);
  const many = { sastSemgrep: Array.from({ length: 70 }, (_, i) => ({ repo: 'r', rule: `rule-${String(i).padStart(2, '0')}`, file: 'f.js', sev: 'high' })) };
  const md = scannerRemediationSection(many).join('\n');
  assert.equal(md.split('\n').filter((l) => /^\| \d+ \|/.test(l)).length, 60);
  assert.match(md, /10 more rule\(s\) are not listed here/);
});
