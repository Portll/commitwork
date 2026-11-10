// Groups scanner findings by rule and lane into a markdown remediation table (monitor/remediation-scanner-section.mjs scannerRemediationSection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scannerRemediationSection } from '../remediation-scanner-section.mjs';

test('returns empty array when no valid findings exist', () => {
  const r = scannerRemediationSection({});
  assert.deepEqual(r, []);
});

test('excludes dependency and metric categories', () => {
  const r = scannerRemediationSection({ deps: [{ rule: 'x', sev: 'crit' }], metrics: [{ rule: 'y', sev: 'high' }] });
  assert.deepEqual(r, ["", "## Code, secrets and configuration \u2014 critical and high \u2014 1 rules, 1 sites", "", "Scanner findings outside the dependency tables above. Each row is one rule in one lane; the issue tracker holds every site.", "", "| # | Severity | Kind | Rule | Lane | Sites | Repos | First file |", "|---|---|---|---|---|---|---|---|", "| 1 | High | \u2014 | `y` | metrics | 1 |  | \u2014 |"]);
});

test('skips rows with annotations or invalid severity', () => {
  const r = scannerRemediationSection({ code: [{ rule: 'a', sev: 'crit', annotation: 'skip' }, { rule: 'b', sev: 'low' }] });
  assert.deepEqual(r, []);
});

test('uses rule id when rule is missing', () => {
  const r = scannerRemediationSection({ code: [{ id: 'my-id', sev: 'high' }] });
  assert.deepEqual(r, ["", "## Code, secrets and configuration \u2014 critical and high \u2014 1 rules, 1 sites", "", "Scanner findings outside the dependency tables above. Each row is one rule in one lane; the issue tracker holds every site.", "", "| # | Severity | Kind | Rule | Lane | Sites | Repos | First file |", "|---|---|---|---|---|---|---|---|", "| 1 | High | \u2014 | `my-id` | code | 1 |  | \u2014 |"]);
});

test('uses unnamed rule placeholder when no rule fields exist', () => {
  const r = scannerRemediationSection({ code: [{ sev: 'crit' }] });
  assert.deepEqual(r, ["", "## Code, secrets and configuration \u2014 critical and high \u2014 1 rules, 1 sites", "", "Scanner findings outside the dependency tables above. Each row is one rule in one lane; the issue tracker holds every site.", "", "| # | Severity | Kind | Rule | Lane | Sites | Repos | First file |", "|---|---|---|---|---|---|---|---|", "| 1 | Critical | \u2014 | `(unnamed rule)` | code | 1 |  | \u2014 |"]);
});

test('escalates severity when a more critical finding exists in same group', () => {
  const r = scannerRemediationSection({ code: [{ rule: 'r', sev: 'high' }, { rule: 'r', sev: 'crit' }] });
  assert.deepEqual(r, ["", "## Code, secrets and configuration \u2014 critical and high \u2014 1 rules, 2 sites", "", "Scanner findings outside the dependency tables above. Each row is one rule in one lane; the issue tracker holds every site.", "", "| # | Severity | Kind | Rule | Lane | Sites | Repos | First file |", "|---|---|---|---|---|---|---|---|", "| 1 | Critical | \u2014 | `r` | code | 2 |  | \u2014 |"]);
});

test('uses file path for first file column', () => {
  const r = scannerRemediationSection({ code: [{ rule: 'r', sev: 'high', file: 'src/a.js' }] });
  assert.deepEqual(r, ["", "## Code, secrets and configuration \u2014 critical and high \u2014 1 rules, 1 sites", "", "Scanner findings outside the dependency tables above. Each row is one rule in one lane; the issue tracker holds every site.", "", "| # | Severity | Kind | Rule | Lane | Sites | Repos | First file |", "|---|---|---|---|---|---|---|---|", "| 1 | High | \u2014 | `r` | code | 1 |  | `src/a.js` |"]);
});

test('uses package name when file and path are missing', () => {
  const r = scannerRemediationSection({ code: [{ rule: 'r', sev: 'high', package: 'pkg' }] });
  assert.deepEqual(r, ["", "## Code, secrets and configuration \u2014 critical and high \u2014 1 rules, 1 sites", "", "Scanner findings outside the dependency tables above. Each row is one rule in one lane; the issue tracker holds every site.", "", "| # | Severity | Kind | Rule | Lane | Sites | Repos | First file |", "|---|---|---|---|---|---|---|---|", "| 1 | High | \u2014 | `r` | code | 1 |  | `pkg` |"]);
});

test('sorts by severity then sites then category then rule', () => {
  const r = scannerRemediationSection({
    b: [{ rule: 'z', sev: 'high' }, { rule: 'z', sev: 'high' }],
    a: [{ rule: 'y', sev: 'high' }]
  });
  assert.deepEqual(r, ["", "## Code, secrets and configuration \u2014 critical and high \u2014 2 rules, 3 sites", "", "Scanner findings outside the dependency tables above. Each row is one rule in one lane; the issue tracker holds every site.", "", "| # | Severity | Kind | Rule | Lane | Sites | Repos | First file |", "|---|---|---|---|---|---|---|---|", "| 1 | High | \u2014 | `z` | b | 2 |  | \u2014 |", "| 2 | High | \u2014 | `y` | a | 1 |  | \u2014 |"]);
});

test('numbers rows starting from one', () => {
  const r = scannerRemediationSection({ code: [{ rule: 'r', sev: 'crit' }] });
  assert.deepEqual(r, ["", "## Code, secrets and configuration \u2014 critical and high \u2014 1 rules, 1 sites", "", "Scanner findings outside the dependency tables above. Each row is one rule in one lane; the issue tracker holds every site.", "", "| # | Severity | Kind | Rule | Lane | Sites | Repos | First file |", "|---|---|---|---|---|---|---|---|", "| 1 | Critical | \u2014 | `r` | code | 1 |  | \u2014 |"]);
});
