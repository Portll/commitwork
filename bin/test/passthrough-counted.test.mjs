// classifyReport over a pass-through format whose lane has a rollup reader: the check-time cell
// carries the reader's count instead of `written`, and a zero count changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { classifyReport } from '../commitwork.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PHPCS = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8')).checks.find((c) => c.id === 'sast-php-phpcs');
const report = (messages) => JSON.stringify({ totals: { errors: messages.length, warnings: 0, fixable: 0 },
  files: { '/fixture/src/page.php': { errors: messages.length, warnings: 0, messages } } });
const EVAL = { message: 'eval() is a security risk', source: 'Security.BadFunctions.NoEvals.NoEvals', severity: 5, fixable: false, type: 'ERROR', line: 6, column: 1 };
const classify = (body, exit) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-passthrough-'));
  try {
    writeFileSync(join(d, 'phpcs.json'), body);
    writeFileSync(join(d, 'phpcs.json.exit'), `${exit}\n`);
    return classifyReport(PHPCS, d, d);
  } finally { rmSync(d, { recursive: true, force: true }); }
};

test('a phpcs report holding findings is counted by the rollup reader, not published as written', () => {
  const r = classify(report([EVAL, EVAL]), 2);
  assert.notEqual(r.sev, 'ok');
  assert.match(r.summary, /^2 findings — .*\(counted by the rollup reader\)$/);
});

test('a phpcs report with no messages keeps the presence verdict it had', () => {
  const r = classify(report([]), 0);
  assert.equal(r.sev, 'ok');
  assert.equal(r.summary, 'written');
});
