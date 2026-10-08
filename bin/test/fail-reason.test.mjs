// A failed lane row used to carry the command and nothing else, so `sbom-syft: fail` and
// `sast-joern: fail` told a reader only that something went wrong — 69 rows of it in one sweep. The
// tool already wrote why into the log the lane declares; this is that line, redacted and capped,
// because the row reaches the rollup.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { failReason } from '../commitwork.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-failreason-'));
let n = 0;
const withLog = (text) => {
  const d = join(T, `d${n++}`);
  mkdirSync(d, { recursive: true });
  if (text !== null) writeFileSync(join(d, 'lane.log'), text);
  return d;
};
const CHECK = { id: 'x', report: { file: 'lane.json', format: 'sbom', log: 'lane.log' } };

describe('why a lane failed', () => {
  test('the tool\'s last line rides with the exit code', () => {
    const d = withLog('starting\nsbom-enrich: NOT ENRICHED (no-reference) — no syft native document to read\n');
    assert.equal(failReason(CHECK, 1, d), 'exited 1 — sbom-enrich: NOT ENRICHED (no-reference) — no syft native document to read');
  });

  test('a lane that declares no log still names its exit', () => {
    assert.equal(failReason({ id: 'x', report: { file: 'a.json', format: 'json' } }, 2, withLog('ignored')), 'exited 2');
  });

  test('a missing or empty log degrades to the exit alone, never to silence', () => {
    assert.equal(failReason(CHECK, 1, withLog(null)), 'exited 1');
    assert.equal(failReason(CHECK, 1, withLog('\n   \n')), 'exited 1');
  });

  test('a killed lane says it was signalled rather than reporting a status it does not have', () => {
    assert.match(failReason(CHECK, null, withLog('')), /^exited without a status \(signalled\)/);
  });

  test('a high-entropy run in the log is redacted before it reaches the row', () => {
    // Built at run time so this source carries no token-shaped literal for a secret scan to report.
    const alnum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const secret = `ghp_${Array.from({ length: 36 }, (_, i) => alnum[(i * 37 + 11) % 62]).join('')}`;
    const r = failReason(CHECK, 1, withLog(`auth failed for token ${secret}\n`));
    assert.doesNotMatch(r, new RegExp(secret));
    assert.match(r, /⟨redacted:\d+c⟩/);
  });

  test('only the tail of a large log is read, and the reason is capped', () => {
    const d = withLog(`${'x'.repeat(200000)}\nlast line: the tool could not start\n`);
    const r = failReason(CHECK, 127, d);
    assert.match(r, /last line: the tool could not start$/);
    assert.ok(r.length < 260, `reason was ${r.length} chars`);
  });
});
