// bin/base-images.mjs: which images a repository names, and what a scan of each becomes. The scan is
// injected, so these run with no network and no trivy; the SARIF is read back through the shared
// reader to prove an unscanned or end-of-support image reduces coverage instead of reading clean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { imageRefsIn, collectRefs, toSarif } from '../base-images.mjs';
import { _sarifCounts, _sarifDetail } from '../../monitor/extractors/sarif.mjs';

test('images named by FROM and Compose, without build stages, scratch or variables', () => {
  const df = 'ARG BASE=node:20\nFROM --platform=linux/amd64 golang:1.22 AS build\nRUN go build\nFROM build AS test\nFROM ${BASE}\nFROM scratch\nFROM alpine:3.21.0\n';
  assert.deepEqual(imageRefsIn('Dockerfile', df), [{ ref: 'golang:1.22', line: 2 }, { ref: 'alpine:3.21.0', line: 7 }]);
  assert.deepEqual(imageRefsIn('docker-compose.yml', 'services:\n  db:\n    image: "postgres:16.2"\n  app:\n    image: ${APP_IMAGE}\n'), [{ ref: 'postgres:16.2', line: 3 }]);
  assert.deepEqual(imageRefsIn('README.md', 'FROM node:20'), []);
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-bi-'));
  const put = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
  put('Dockerfile', 'FROM alpine:3.21.0\n');
  put('svc/Dockerfile', 'FROM alpine:3.21.0\n');
  put('compose.yaml', 'services:\n  old:\n    image: alpine:3.15\n  gone:\n    image: example.invalid/none:1\n');
  put('node_modules/x/Dockerfile', 'FROM node:12\n');
  put('.claude/worktrees/agent-a/Dockerfile', 'FROM node:12\n');
  return dir;
}

const vuln = (id, sev, fixed, pkg = 'openssl') => ({ VulnerabilityID: id, Severity: sev, PkgName: pkg, InstalledVersion: '3.3.0', FixedVersion: fixed, Title: `${pkg}: memory growth in the ${id.slice(-1) === '1' ? 'parser' : 'encoder'}` });
const FAKE = {
  'alpine:3.21.0': { report: { Metadata: { OS: { Family: 'alpine', Name: '3.21.0' } }, Results: [{ Vulnerabilities: [
    vuln('CVE-2026-0001', 'CRITICAL', '3.3.1'), vuln('CVE-2026-0001', 'CRITICAL', '3.3.1', 'libssl3'), vuln('CVE-2026-0002', 'MEDIUM', ''), vuln('CVE-2026-0003', 'LOW', '3.3.2'),
  ] }] } },
  'alpine:3.15': { report: { Metadata: { OS: { Family: 'alpine', Name: '3.15.11', EOSL: true } }, Results: [] } },
  'example.invalid/none:1': { error: 'unable to find the specified image' },
};
const fakeScan = (ref) => FAKE[ref];

test('every named image is found once, with every line that names it; copies and installs are skipped', () => {
  const refs = collectRefs(repo());
  assert.deepEqual([...refs.keys()], ['alpine:3.15', 'alpine:3.21.0', 'example.invalid/none:1']);
  assert.deepEqual(refs.get('alpine:3.21.0'), [{ file: 'Dockerfile', line: 1 }, { file: 'svc/Dockerfile', line: 1 }]);
});

test('a fixable advisory is one finding per naming line; unfixed ones are counted, not reported', () => {
  const run = toSarif(collectRefs(repo()), fakeScan).runs[0];
  assert.deepEqual(run.results.map((r) => [r.ruleId, r.locations[0].physicalLocation.artifactLocation.uri, r.properties['security-severity']]), [
    ['CVE-2026-0001', 'Dockerfile', '9.5'], ['CVE-2026-0003', 'Dockerfile', '2.0'],
    ['CVE-2026-0001', 'svc/Dockerfile', '9.5'], ['CVE-2026-0003', 'svc/Dockerfile', '2.0'],
  ]);
  assert.match(run.results[0].message.text, /alpine:3\.21\.0 ships openssl 3\.3\.0; CVE-2026-0001 is fixed in 3\.3\.1/);
  const img = run.properties.images.find((i) => i.ref === 'alpine:3.21.0');
  assert.deepEqual({ fixable: img.fixable, unfixed: img.unfixed }, { fixable: 3, unfixed: { MEDIUM: 1 } });
});

test('an unscannable image and one past end of support are notices on their lines, and read as reduced coverage', () => {
  const doc = toSarif(collectRefs(repo()), fakeScan);
  const notes = doc.runs[0].invocations[0].toolExecutionNotifications;
  assert.deepEqual(notes.map((n) => n.message.text.replace(/:.*$/, '')), ['Image alpine', 'Image example.invalid/none']);
  assert.match(notes[0].message.text, /past end of support/);
  assert.equal(doc.runs[0].properties.images.find((i) => i.ref === 'alpine:3.15').endOfSupport, true);

  const dir = mkdtempSync(join(tmpdir(), 'cw-bi-sarif-'));
  writeFileSync(join(dir, 'base-images.sarif'), JSON.stringify(doc));
  const c = _sarifCounts(dir, 'base-images.sarif');
  assert.equal(c.crit, 2);
  assert.equal(c.coverage.state, 'partial');
  assert.deepEqual(c.partialAnalysis.byReason, { 'image-not-scanned': 1 }, 'one file, compose.yaml, names both unscanned images');
  assert.equal(_sarifDetail(dir, 'base-images.sarif', 'baseImages').ruleTitles['CVE-2026-0001'], 'openssl: memory growth in the parser');
});

test('without trivy nothing is scanned and the run says so; with no images there is nothing to say', () => {
  const missing = toSarif(collectRefs(repo()), fakeScan, { trivyPresent: false }).runs[0];
  assert.equal(missing.invocations[0].executionSuccessful, false);
  assert.equal(missing.results.length, 0);
  const none = toSarif(new Map(), fakeScan, { trivyPresent: false }).runs[0];
  assert.equal(none.invocations[0].executionSuccessful, true);
  assert.deepEqual(none.properties.images, []);
});

test('the per-repository image limit leaves the rest as notices', () => {
  const prev = process.env.CW_BASE_IMAGES_MAX;
  process.env.CW_BASE_IMAGES_MAX = '1';
  try {
    const run = toSarif(collectRefs(repo()), fakeScan).runs[0];
    assert.equal(run.properties.images.filter((i) => i.scanned).length, 1);
    assert.ok(run.invocations[0].toolExecutionNotifications.some((n) => /over the 1-image limit/.test(n.message.text)));
  } finally { if (prev === undefined) delete process.env.CW_BASE_IMAGES_MAX; else process.env.CW_BASE_IMAGES_MAX = prev; }
});
