// Computes severity counts and detail rows from a PHP_CodeSniffer JSON report (monitor/extractors/sast-lint.mjs _phpcsCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _phpcsCounts } from '../extractors/sast-lint.mjs';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_phpcsCounts-'));
  try {
    const result = _phpcsCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable object when JSON cannot be parsed', () => {
  const dir = mkdtempSync(join(tmpdir(), '_phpcsCounts-'));
  try {
    const file = 'bad.json';
    writeFileSync(join(dir, file), '{ not: json ');
    const result = _phpcsCounts(dir, file);
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable object when parsed JSON lacks a proper files object', () => {
  const dir = mkdtempSync(join(tmpdir(), '_phpcsCounts-'));
  try {
    const file = 'no-files.json';
    writeFileSync(join(dir, file), JSON.stringify({}));
    const result = _phpcsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a single error message correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), '_phpcsCounts-'));
  try {
    const file = 'one-error.json';
    const payload = {
      files: {
        'src/file.php': {
          messages: [
            { type: 'ERROR', source: 'Security.Bad', line: 10, message: 'bad thing' }
          ]
        }
      }
    };
    writeFileSync(join(dir, file), JSON.stringify(payload));
    const result = _phpcsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ rule: "Security.Bad", file: "src/file.php", line: 10, sev: "high", message: "bad thing", corroboratedBy: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a warning message as medium severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_phpcsCounts-'));
  try {
    const file = 'one-warning.json';
    const payload = {
      files: {
        'src/file.php': {
          messages: [
            { type: 'WARNING', source: 'Security.Warn', line: 5, message: 'just a warning' }
          ]
        }
      }
    };
    writeFileSync(join(dir, file), JSON.stringify(payload));
    const result = _phpcsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 1, low: 0, total: 1, ran: true, findings: [{ rule: "Security.Warn", file: "src/file.php", line: 5, sev: "med", message: "just a warning", corroboratedBy: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles missing type field defaulting to medium severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_phpcsCounts-'));
  try {
    const file = 'no-type.json';
    const payload = {
      files: {
        'src/file.php': {
          messages: [
            { source: 'Security.Missing', line: 3, message: 'no type' }
          ]
        }
      }
    };
    writeFileSync(join(dir, file), JSON.stringify(payload));
    const result = _phpcsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 1, low: 0, total: 1, ran: true, findings: [{ rule: "Security.Missing", file: "src/file.php", line: 3, sev: "med", message: "no type", corroboratedBy: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores entries without a messages array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_phpcsCounts-'));
  try {
    const file = 'no-messages.json';
    const payload = {
      files: {
        'src/file.php': {}
      }
    };
    writeFileSync(join(dir, file), JSON.stringify(payload));
    const result = _phpcsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processes multiple files and multiple messages', () => {
  const dir = mkdtempSync(join(tmpdir(), '_phpcsCounts-'));
  try {
    const file = 'multi.json';
    const payload = {
      files: {
        'src/a.php': {
          messages: [
            { type: 'ERROR', source: 'Sec.A', line: 1, message: 'a error' },
            { type: 'WARNING', source: 'Sec.B', line: 2, message: 'a warning' }
          ]
        },
        'src/b.php': {
          messages: [
            { type: 'ERROR', source: 'Sec.C', line: 3, message: 'b error' }
          ]
        }
      }
    };
    writeFileSync(join(dir, file), JSON.stringify(payload));
    const result = _phpcsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 2, med: 1, low: 0, total: 3, ran: true, findings: [{ rule: "Sec.A", file: "src/a.php", line: 1, sev: "high", message: "a error", corroboratedBy: "" }, { rule: "Sec.B", file: "src/a.php", line: 2, sev: "med", message: "a warning", corroboratedBy: "" }, { rule: "Sec.C", file: "src/b.php", line: 3, sev: "high", message: "b error", corroboratedBy: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles numeric line values that are falsy (0) correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), '_phpcsCounts-'));
  try {
    const file = 'zero-line.json';
    const payload = {
      files: {
        'src/file.php': {
          messages: [
            { type: 'ERROR', source: 'Sec.Zero', line: 0, message: 'zero line' }
          ]
        }
      }
    };
    writeFileSync(join(dir, file), JSON.stringify(payload));
    const result = _phpcsCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ rule: "Sec.Zero", file: "src/file.php", line: 0, sev: "high", message: "zero line", corroboratedBy: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
