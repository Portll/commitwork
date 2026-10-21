// bin/parse-renovate.mjs, run on synthetic Renovate debug logs. Pins what the summary promises:
// one row per renovate/ branch (lockfile-maintenance and repeats dropped), version/type/dep read
// from the object body before branchName, rows ordered major→minor→patch then by dep, byType counts,
// `ran` read from the log itself — and a missing log reported as ran:false, never as zero updates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PARSE = join(CW, 'bin', 'parse-renovate.mjs');

function parse(t, logText) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-renovate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'renovate.log');
  if (logText !== null) writeFileSync(path, logText);
  const r = spawnSync(process.execPath, [PARSE, path], { encoding: 'utf8' });
  return { code: r.status, doc: JSON.parse(r.stdout), err: r.stderr };
}

// The shape a dry-run debug log carries: a dep object with its depName, then an updates[] whose
// entries end in branchName. One dep may carry several updates, which all belong to it.
const upd = (newVersion, updateType, branchName) =>
  `        { "newVersion": "${newVersion}", "updateType": "${updateType}", "branchName": "${branchName}" }`;
const dep = (head, updates) => ['    {', `      ${head},`, '      "currentValue": "^1.0.0",', '      "updates": [',
  updates.join(',\n'), '      ]', '    }'].join('\n');

const LOG = [
  'DEBUG: packageFiles with updates (repository=example/widget)',
  '  "deps": [',
  // no depName anywhere before it: the dep is read from the branch slug
  dep('"packageName": "left-pad"', [upd('2.0.0', 'major', 'renovate/left-pad-v2')]),
  dep('"depName": "zod"', [upd('3.24.1', 'patch', 'renovate/zod-3.x')]),
  // two updates of one dep: both are eslint's
  dep('"depName": "eslint"', [upd('8.57.1', 'minor', 'renovate/eslint-8.x'), upd('9.0.0', 'major', 'renovate/eslint-9.x')]),
  dep('"depName": "axios"', [upd('1.8.0', 'minor', 'renovate/axios-1.x')]),
  // a repeat of a branch already seen, and the artifact branch: neither is a distinct update
  dep('"depName": "zod"', [upd('3.24.1', 'patch', 'renovate/zod-3.x')]),
  dep('"depName": "lock file maintenance"', [upd('0', 'lockFileMaintenance', 'renovate/lock-file-maintenance')]),
  '  ]',
  'INFO: Repository finished',
].join('\n');

test('one row per distinct renovate/ branch, ordered by update type then dep, with byType counts', (t) => {
  const { code, doc } = parse(t, LOG);
  assert.equal(code, 0);
  assert.equal(doc.ran, true);
  assert.equal(doc.count, 5, 'the repeat and the lockfile-maintenance branch are dropped');
  assert.deepEqual(doc.byType, { major: 2, patch: 1, minor: 2 });
  assert.deepEqual(doc.updates.map((u) => [u.updateType, u.dep, u.newVersion]), [
    ['major', 'eslint', '9.0.0'], ['major', 'left-pad', '2.0.0'],
    ['minor', 'axios', '1.8.0'], ['minor', 'eslint', '8.57.1'],
    ['patch', 'zod', '3.24.1'],
  ]);
  assert.deepEqual(doc.updates.find((u) => u.dep === 'axios'),
    { dep: 'axios', branch: 'renovate/axios-1.x', newVersion: '1.8.0', updateType: 'minor' });
});

test('with no depName before it the dep is the branch slug minus its version suffix', (t) => {
  const { doc } = parse(t, LOG);
  const lp = doc.updates.find((u) => u.branch === 'renovate/left-pad-v2');
  assert.equal(lp.dep, 'left-pad');
  assert.equal(lp.updateType, 'major');
});

test('a log that never reached the end markers reports ran:false, with whatever it did parse', (t) => {
  const { code, doc } = parse(t, 'DEBUG: starting\nERROR: config validation failed\n');
  assert.equal(code, 0);
  assert.deepEqual(doc, { ran: false, count: 0, byType: {}, updates: [] });
});

test('a missing log is reported as not-run with a reason, never as a clean zero', (t) => {
  const { code, doc } = parse(t, null);
  assert.equal(code, 0);
  assert.deepEqual(doc, { ran: false, reason: 'no log' });
  assert.equal('count' in doc, false, 'no count is published for a run that cannot be read');
});
