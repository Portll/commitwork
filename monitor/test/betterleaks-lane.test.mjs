import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _gitleaksCounts } from '../extractors/secrets.mjs';
import { parseBetterleaks } from '../../bin/lib/report-parsers/secrets.mjs';

const row = (RuleID, File, StartLine, confidence, ValidationStatus) => ({
  RuleID, File, StartLine, Match: 'REDACTED', Secret: 'REDACTED', Entropy: 4.2,
  Attributes: { confidence, path: File, resource: 'fs.content' },
  Fingerprint: `${File}:${RuleID}:${StartLine}`,
  ...(ValidationStatus ? { ValidationStatus } : {}),
});

const RECEIPT = '12:00PM INF validation complete errors=0 invalid=1 valid=1\n12:00PM INF scanned ~2048 bytes (2.05 KB) in 0.1s\n';

const inDir = (rows, log, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-betterleaks-'));
  try {
    writeFileSync(join(dir, 'betterleaks.json'), JSON.stringify(rows));
    if (log !== null) writeFileSync(join(dir, 'betterleaks.log'), log);
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

const ROWS = [
  row('github-pat', 'src/a.mjs', 3, 'high', 'valid'),
  row('slack-bot-token', 'src/b.mjs', 9, 'high', 'invalid'),
  row('generic-password', 'src/c.mjs', 4, 'low'),
  row('private-key', 'src/d.pem', 1, 'high', 'constructor'),
];

test('the inline verdict sets severity; everything unvalidated is undetermined', () => inDir(ROWS, RECEIPT, (dir) => {
  const c = _gitleaksCounts(dir, 'betterleaks.json', null, 'secretsBetterleaks');
  assert.equal(c.verifyRan, true);
  assert.deepEqual([c.crit, c.high, c.med, c.low, c.undetermined, c.total], [1, 0, 0, 1, 2, 4]);
  const byRule = Object.fromEntries(c.findings.map((f) => [f.rule, f]));
  assert.equal(byRule['github-pat'].verified, true);
  assert.equal(byRule['slack-bot-token'].verified, false);
  assert.equal(byRule['generic-password'].verified, null);
  assert.equal(byRule['generic-password'].confidence, 'low');
  assert.equal(byRule['private-key'].verified, null, 'an unknown status string is not a verdict, whatever its name');
}));

test('without the validation line in the log, validation is not claimed to have run', () => inDir(ROWS, 'INF scanned ~2048 bytes\n', (dir) => {
  assert.equal(_gitleaksCounts(dir, 'betterleaks.json', null, 'secretsBetterleaks').verifyRan, false);
}));

test('a gitleaks report is unaffected by the inline path', () => inDir(ROWS, RECEIPT, (dir) => {
  const c = _gitleaksCounts(dir, 'betterleaks.json', 'absent-verify.json', 'secrets');
  assert.equal(c.verifyRan, false);
  assert.equal(c.undetermined, 4, 'a sidecar-mode lane ignores ValidationStatus');
}));

test('the CLI grades high only on a validated-live credential', () => {
  inDir(ROWS, RECEIPT, (dir) => {
    const p = parseBetterleaks(join(dir, 'betterleaks.json'));
    assert.equal(p.sev, 'high');
    assert.equal(p.verified, 1);
    assert.match(p.summary, /1 validated live, 1 invalid or revoked, 1 low-confidence and unvalidated/);
  });
  inDir(ROWS.slice(1), RECEIPT, (dir) => assert.equal(parseBetterleaks(join(dir, 'betterleaks.json')).sev, 'med'));
});

test('an empty report needs the scanned-bytes receipt, and names betterleaks when it is missing', () => {
  inDir([], RECEIPT, (dir) => assert.equal(parseBetterleaks(join(dir, 'betterleaks.json')).sev, 'ok'));
  inDir([], null, (dir) => {
    const p = parseBetterleaks(join(dir, 'betterleaks.json'));
    assert.equal(p.sev, 'noscan');
    assert.match(p.summary, /betterleaks\.log/);
  });
});
