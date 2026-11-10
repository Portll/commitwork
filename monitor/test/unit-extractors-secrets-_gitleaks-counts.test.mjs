// Counts gitleaks findings with verification verdicts and context classification (monitor/extractors/secrets.mjs _gitleaksCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _gitleaksCounts } from '../extractors/secrets.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the gitleaks file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gitleaksCounts-'));
  try {
    const result = _gitleaksCounts(dir, 'gitleaks.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with ran true when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gitleaksCounts-'));
  try {
    writeFileSync(join(dir, 'gitleaks.json'), '');
    const result = _gitleaksCounts(dir, 'gitleaks.json');
    assert.equal(result.ran, true);
    assert.equal(result.crit, 0);
    assert.equal(result.high, 0);
    assert.equal(result.med, 0);
    assert.equal(result.low, 0);
    assert.equal(result.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gitleaksCounts-'));
  try {
    writeFileSync(join(dir, 'gitleaks.json'), '{invalid');
    const result = _gitleaksCounts(dir, 'gitleaks.json');
    assert.equal(result.ran, false);
    assert.equal(result.unreadable, true);
    assert.match(result.reason, /gitleaks\.json refused/);
    assert.equal(result.crit, 0);
    assert.equal(result.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a verified finding as crit when verdict file says verified true', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gitleaksCounts-'));
  try {
    writeFileSync(join(dir, 'gitleaks.json'), JSON.stringify([{ RuleID: 'aws-access-token', File: 'src/app.js', StartLine: 10, Commit: 'abc123', Entropy: 4.5 }]));
    writeFileSync(join(dir, 'gitleaks-verify.json'), JSON.stringify({ ran: true, verdicts: [{ file: 'src/app.js', line: 10, rule: 'aws-access-token', verified: true }] }));
    const result = _gitleaksCounts(dir, 'gitleaks.json');
    assert.equal(result.crit, 1);
    assert.equal(result.total, 1);
    assert.equal(result.verifyRan, true);
    assert.equal(result.undetermined, 0);
    assert.equal(result.testPath, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a refused finding as low when verdict file says verified false', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gitleaksCounts-'));
  try {
    writeFileSync(join(dir, 'gitleaks.json'), JSON.stringify([{ RuleID: 'aws-access-token', File: 'src/app.js', StartLine: 10, Commit: 'abc123' }]));
    writeFileSync(join(dir, 'gitleaks-verify.json'), JSON.stringify({ ran: true, verdicts: [{ file: 'src/app.js', line: 10, rule: 'aws-access-token', verified: false }] }));
    const result = _gitleaksCounts(dir, 'gitleaks.json');
    assert.equal(result.low, 1);
    assert.equal(result.crit, 0);
    assert.equal(result.total, 1);
    assert.equal(result.undetermined, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a finding as undetermined when no verdict is available', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gitleaksCounts-'));
  try {
    writeFileSync(join(dir, 'gitleaks.json'), JSON.stringify([{ RuleID: 'generic-api-key', File: 'src/config.js', StartLine: 5, Commit: 'def456' }]));
    const result = _gitleaksCounts(dir, 'gitleaks.json');
    assert.equal(result.undetermined, 1);
    assert.equal(result.crit, 0);
    assert.equal(result.low, 0);
    assert.equal(result.total, 1);
    assert.equal(result.verifyRan, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks findings in test paths with testPath true and increments testPath count', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gitleaksCounts-'));
  try {
    writeFileSync(join(dir, 'gitleaks.json'), JSON.stringify([{ RuleID: 'aws-access-token', File: 'src/test/app.test.js', StartLine: 3, Commit: 'ghi789' }]));
    const result = _gitleaksCounts(dir, 'gitleaks.json');
    assert.equal(result.testPath, 1);
    assert.equal(result.undetermined, 1);
    assert.equal(result.total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('forces public-by-design rules to undetermined even when verified true', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gitleaksCounts-'));
  try {
    writeFileSync(join(dir, 'gitleaks.json'), JSON.stringify([{ RuleID: 'gcp-api-key', File: 'src/client.js', StartLine: 7, Commit: 'jkl012' }]));
    writeFileSync(join(dir, 'gitleaks-verify.json'), JSON.stringify({ ran: true, verdicts: [{ file: 'src/client.js', line: 7, rule: 'gcp-api-key', verified: true }] }));
    const result = _gitleaksCounts(dir, 'gitleaks.json');
    assert.equal(result.undetermined, 1);
    assert.equal(result.crit, 0);
    assert.equal(result.total, 1);
    assert.equal(result.verifyRan, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reads inline validation status when verdictFile is null', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gitleaksCounts-'));
  try {
    writeFileSync(join(dir, 'gitleaks.json'), JSON.stringify([{ RuleID: 'aws-access-token', File: 'src/app.js', StartLine: 10, Commit: 'abc123', ValidationStatus: 'valid' }]));
    const result = _gitleaksCounts(dir, 'gitleaks.json', null);
    assert.equal(result.crit, 1);
    assert.equal(result.total, 1);
    assert.equal(result.undetermined, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies vendored paths with context vendored', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gitleaksCounts-'));
  try {
    writeFileSync(join(dir, 'gitleaks.json'), JSON.stringify([{ RuleID: 'private-key', File: 'vendor/lib/key.pem', StartLine: 1, Commit: 'mno345' }]));
    const result = _gitleaksCounts(dir, 'gitleaks.json');
    assert.equal(result.undetermined, 1);
    assert.equal(result.testPath, 0);
    assert.equal(result.total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
