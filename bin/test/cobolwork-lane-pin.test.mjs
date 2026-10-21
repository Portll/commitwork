// The COBOL lanes run the cobolwork the resolver finds, through the real runner and the real lane
// command lifted from manifests/security-baseline.json: the pinned install, or CW_COBOLWORK_BIN, and
// never the `cobolwork` on PATH. With neither, an applicable lane is a blocked void naming the
// install, never a clean pass and never a quiet n/a.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../cobolwork-pin.mjs';
import { toolPrefixes } from '../commitwork.mjs';
import { _cobolworkCounts } from '../../monitor/extractors/sast-lint.mjs';
import { COMMIT, packCobolwork, pinFor, writePins } from '../../lib/test/fixtures/cobolwork-pack.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'commitwork.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-cobol-lane-pin-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const BASELINE = JSON.parse(readFileSync(join(CW, 'manifests', 'security-baseline.json'), 'utf8'));
const LANE = BASELINE.checks.find((c) => c.id === 'sast-cobol-cobolwork');
const MANIFEST = join(TMP, 'm.json');
writeFileSync(MANIFEST, JSON.stringify({ repo: 'fixture', checks: [LANE] }));

const REPO = join(TMP, 'repo');
mkdirSync(REPO);
writeFileSync(join(REPO, 'P.cbl'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. P.\n       PROCEDURE DIVISION.\n           GOBACK.\n');

// The working checkout this keeps out: a `cobolwork` on PATH that would write a clean report.
const PATH_DIR = join(TMP, 'path');
const MARK = join(TMP, 'path-cobolwork-ran');
mkdirSync(PATH_DIR);
const writer = (mark, from) => `#!/bin/sh\ntouch '${mark}'\nwhile [ "$1" != "--out" ] && [ $# -gt 0 ]; do shift; done\necho '{"tool":"cobolwork","schemaVersion":3,"summary":{"filesScanned":1,"from":"${from}"},"findings":[]}' > "$2"\n`;
writeFileSync(join(PATH_DIR, 'cobolwork'), writer(MARK, 'path'));
chmodSync(join(PATH_DIR, 'cobolwork'), 0o755);

const pack = packCobolwork();
const PINS = writePins(TMP, pinFor({ sha256: pack.sha256 }));
const TGZ = join(TMP, 'cobolwork-9.9.9.tgz');
writeFileSync(TGZ, pack.tgz);

let n = 0;
function run(over = {}) {
  const reports = join(TMP, `reports-${++n}`);
  mkdirSync(reports);
  const env = { ...process.env, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1', CW_SANDBOX: 'off', CW_ASSERT_TREE: '0',
    CW_TOOL_PINS: PINS, CW_TOOLS_ROOT: join(TMP, 'empty-root'), CW_COBOLWORK_BIN: '', FORCE_COLOR: '0',
    PATH: [PATH_DIR, dirname(process.execPath), process.env.PATH].join(delimiter), ...over };
  const r = spawnSync(process.execPath, [CLI, 'run', LANE.id, '--manifest', MANIFEST, '--repo', REPO, '--no-fail-fast'], { encoding: 'utf8', env });
  let rows;
  try { rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')); }
  catch (e) { assert.fail(`checks-status.json unreadable (${e.message}); runner exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
  const row = rows.find((x) => x.check === LANE.id);
  const read = (f) => (existsSync(join(reports, f)) ? JSON.parse(readFileSync(join(reports, f), 'utf8')) : null);
  return { r, row, reports, out: `${r.stdout}${r.stderr}`, report: read('cobolwork.json'), provenance: read(`tool-version-${LANE.id}.json`) };
}

test('the shipped lane names the tool it needs, and runs it only through CW_TOOL_COBOLWORK', () => {
  assert.deepEqual(LANE.requires.tools, ['cobolwork']);
  const cmd = LANE.local.join('\n');
  assert.match(cmd, /"\$CW_TOOL_COBOLWORK" scan \. --out/);
  assert.doesNotMatch(cmd, /command -v cobolwork|(^|[;&|]\s*)cobolwork /, 'no cobolwork by name');
  for (const id of ['cobol-inventory', 'secrets-cobol-jcl']) {
    const c = BASELINE.checks.find((x) => x.id === id);
    assert.ok(c.requires.tools.includes('cobolwork'), id);
    assert.match(c.local.join('\n'), /"\$CW_TOOL_COBOLWORK" /, id);
    assert.doesNotMatch(c.local.join('\n'), /command -v cobolwork|\$\(cobolwork |(^|[;&|]\s*)cobolwork /, id);
  }
});

test('with the pin not installed, the lane is a blocked void naming the install, and the cobolwork on PATH never runs', () => {
  const { row, out, report } = run();
  assert.equal(row.status, 'noscan', JSON.stringify(row));
  assert.match(row.reason, /tool:cobolwork \(cobolwork 9\.9\.9, pinned in .*tool-pins\.json, is not installed/);
  assert.match(row.reason, /node bin\/cobolwork-pin\.mjs --install/);
  assert.equal(row.coverage, 'unknown');
  assert.match(out, /BLOCKED/);
  assert.equal(report, null, 'no report, so nothing downstream can read one as clean');
  assert.equal(existsSync(MARK), false, 'the cobolwork on PATH was not run');
});

test('CW_COBOLWORK_BIN is what the lane runs when it is set, and the provenance says so', () => {
  const bin = join(TMP, 'override-cobolwork');
  const mark = join(TMP, 'override-ran');
  writeFileSync(bin, writer(mark, 'override').replace('#!/bin/sh\n', '#!/bin/sh\n[ "$1" = "--version" ] && { echo 1.2.3; exit 0; }\n'));
  chmodSync(bin, 0o755);
  const { row, report, provenance } = run({ CW_COBOLWORK_BIN: bin });
  assert.equal(row.status, 'pass', JSON.stringify(row));
  assert.equal(report.summary.from, 'override');
  assert.equal(existsSync(MARK), false);
  assert.equal(provenance.tools.cobolwork.resolvedFrom, 'override');
  assert.equal(provenance.tools.cobolwork.version, '1.2.3');
});

test('the pinned install is what the lane runs, and its revision reaches the provenance stamp and the lane block', async () => {
  const root = join(TMP, 'root');
  const inst = await install({ env: { ...process.env, CW_TOOL_PINS: PINS, CW_TOOLS_ROOT: root, CW_COBOLWORK_BIN: '' }, from: TGZ });
  assert.equal(inst.ok, true, inst.reason);
  const { row, report, provenance, reports } = run({ CW_TOOLS_ROOT: root });
  assert.equal(row.status, 'pass', JSON.stringify(row));
  assert.equal(report.summary.toolRevision.commit, COMMIT, 'the pinned package wrote it');
  assert.equal(existsSync(MARK), false);
  assert.deepEqual(provenance.tools.cobolwork, { state: 'present', version: '9.9.9', versionState: 'stated', resolvedFrom: 'pinned', commit: COMMIT });
  const block = _cobolworkCounts(reports, 'cobolwork.json');
  assert.deepEqual(block.toolRevision, { commit: COMMIT, dirty: false, tag: 'v9.9.9', from: 'release' });

  // The host sandbox is told to allow the install directory, not the prefix of the cobolwork on PATH.
  const saved = { ...process.env };
  Object.assign(process.env, { CW_TOOL_PINS: PINS, CW_TOOLS_ROOT: root, PATH: `${PATH_DIR}${delimiter}${process.env.PATH}` });
  delete process.env.CW_COBOLWORK_BIN;
  try {
    assert.deepEqual(toolPrefixes(LANE, '/nonexistent-home'), [realpathSync(join(root, 'cobolwork', '9.9.9'))]);
    process.env.CW_TOOLS_ROOT = join(TMP, 'empty-root');
    assert.deepEqual(toolPrefixes(LANE, '/nonexistent-home'), [], 'an unresolved pin grants nothing, and PATH is not asked');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('the scan path reads the same resolution: an unresolved pin is a blocked void in its cell, not a skip', () => {
  const root = join(TMP, 'scan-root');
  const repo = join(root, 'cobol-repo');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'P.cbl'), readFileSync(join(REPO, 'P.cbl')));
  spawnSync('git', ['init', '-q', repo]);
  const out = join(TMP, 'scan-out');
  const r = spawnSync(process.execPath, [CLI, 'scan', '--manifest', MANIFEST, '--root', root, '--out', out], { encoding: 'utf8',
    env: { ...process.env, CW_SKIP_SETUP: '1', CW_SANDBOX: 'off', CW_TOOL_PINS: PINS, CW_TOOLS_ROOT: join(TMP, 'empty-root'), CW_COBOLWORK_BIN: '', FORCE_COLOR: '0',
      PATH: [PATH_DIR, process.env.PATH].join(delimiter) } });
  const summary = readFileSync(join(out, 'cobol-repo', 'summary.md'), 'utf8');
  assert.match(summary, /\| sast-cobol-cobolwork \| NOSCAN \| tool:cobolwork \(cobolwork 9\.9\.9, pinned in /, `${r.stdout}\n${r.stderr}`);
  assert.equal(existsSync(MARK), false);
});
