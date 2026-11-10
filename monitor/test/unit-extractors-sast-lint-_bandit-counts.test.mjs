// Counts Bandit JSON results into severity buckets with titled rules (monitor/extractors/sast-lint.mjs _banditCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _banditCounts } from '../extractors/sast-lint.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_banditCounts-'));
  try {
    const result = _banditCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable true when parsed JSON lacks a results array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_banditCounts-'));
  try {
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ foo: 1 }));
    const result = _banditCounts(dir, 'bad.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable false when parsed JSON is null', () => {
  const dir = mkdtempSync(join(tmpdir(), '_banditCounts-'));
  try {
    writeFileSync(join(dir, 'null.json'), 'null');
    const result = _banditCounts(dir, 'null.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts high severity results with confidence in message', () => {
  const dir = mkdtempSync(join(tmpdir(), '_banditCounts-'));
  try {
    const data = {
      results: [
        {
          filename: 'app.py',
          line_number: 10,
          test_id: 'B603',
          issue_severity: 'HIGH',
          issue_confidence: 'MEDIUM',
          issue_text: 'subprocess call with shell=True',
          issue_cwe: { id: 78 },
          test_name: 'subprocess_without_shell_equals_true'
        }
      ],
      errors: []
    };
    writeFileSync(join(dir, 'report.json'), JSON.stringify(data));
    const result = _banditCounts(dir, 'report.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ rule: "B603", file: "app.py", line: 10, sev: "high", message: "subprocess call with shell=True (confidence: MEDIUM)", cwe: "CWE-78" }], ruleTitles: { B603: "subprocess without shell equals true" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips results with unrecognized severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_banditCounts-'));
  try {
    const data = {
      results: [
        {
          filename: 'app.py',
          line_number: 5,
          test_id: 'B101',
          issue_severity: 'CRITICAL',
          issue_confidence: 'HIGH',
          issue_text: 'assert used',
          issue_cwe: { id: 681 },
          test_name: 'assert_used'
        }
      ],
      errors: []
    };
    writeFileSync(join(dir, 'report.json'), JSON.stringify(data));
    const result = _banditCounts(dir, 'report.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles missing issue_confidence and issue_cwe fields', () => {
  const dir = mkdtempSync(join(tmpdir(), '_banditCounts-'));
  try {
    const data = {
      results: [
        {
          filename: 'app.py',
          line_number: 3,
          test_id: 'B301',
          issue_severity: 'MEDIUM',
          issue_text: 'PICKLE usage',
          test_name: 'blacklist'
        }
      ],
      errors: []
    };
    writeFileSync(join(dir, 'report.json'), JSON.stringify(data));
    const result = _banditCounts(dir, 'report.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 1, low: 0, total: 1, ran: true, findings: [{ rule: "B301", file: "app.py", line: 3, sev: "med", message: "PICKLE usage", cwe: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles missing filename and line_number fields', () => {
  const dir = mkdtempSync(join(tmpdir(), '_banditCounts-'));
  try {
    const data = {
      results: [
        {
          test_id: 'B404',
          issue_severity: 'LOW',
          issue_confidence: 'HIGH',
          issue_text: 'import of pickle',
          test_name: 'blacklist'
        }
      ],
      errors: []
    };
    writeFileSync(join(dir, 'report.json'), JSON.stringify(data));
    const result = _banditCounts(dir, 'report.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, findings: [{ rule: "B404", file: "", line: 0, sev: "low", message: "import of pickle (confidence: HIGH)", cwe: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles missing test_name field', () => {
  const dir = mkdtempSync(join(tmpdir(), '_banditCounts-'));
  try {
    const data = {
      results: [
        {
          filename: 'app.py',
          line_number: 7,
          test_id: 'B602',
          issue_severity: 'HIGH',
          issue_confidence: 'MEDIUM',
          issue_text: 'subprocess call',
          issue_cwe: { id: 78 }
        }
      ],
      errors: []
    };
    writeFileSync(join(dir, 'report.json'), JSON.stringify(data));
    const result = _banditCounts(dir, 'report.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ rule: "B602", file: "app.py", line: 7, sev: "high", message: "subprocess call (confidence: MEDIUM)", cwe: "CWE-78" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles non-string test_name field', () => {
  const dir = mkdtempSync(join(tmpdir(), '_banditCounts-'));
  try {
    const data = {
      results: [
        {
          filename: 'app.py',
          line_number: 2,
          test_id: 'B104',
          issue_severity: 'LOW',
          issue_confidence: 'MEDIUM',
          issue_text: 'binding to all interfaces',
          issue_cwe: { id: 605 },
          test_name: 42
        }
      ],
      errors: []
    };
    writeFileSync(join(dir, 'report.json'), JSON.stringify(data));
    const result = _banditCounts(dir, 'report.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, findings: [{ rule: "B104", file: "app.py", line: 2, sev: "low", message: "binding to all interfaces (confidence: MEDIUM)", cwe: "CWE-605" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles empty results array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_banditCounts-'));
  try {
    writeFileSync(join(dir, 'empty.json'), JSON.stringify({ results: [], errors: [] }));
    const result = _banditCounts(dir, 'empty.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
