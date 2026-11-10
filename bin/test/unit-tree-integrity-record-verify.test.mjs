// Verifies installed Python package RECORD files against the tree (bin/tree-integrity.mjs recordVerify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordVerify } from '../tree-integrity.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha256 = (s) => createHash('sha256').update(s).digest('base64url');

test('returns not-applicable when no RECORD files exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordVerify-'));
  try {
    mkdirSync(join(dir, 'site', 'pkg.dist-info'), { recursive: true });
    const r = recordVerify(dir, new Set(), { skippedPaths: [] });
    assert.deepEqual(r, { state: "not-applicable", reason: "no *.dist-info/RECORD in the tree, so there is no installed Python package to verify", findings: [], filesScanned: 0, unreadable: [], partialReasons: [], stats: { records: 0, sites: 0, hashed: 0, verified: 0, unhashed: 0, unhashedAbsent: 0, outOfTree: 0, unsupportedHash: 0, conda: { distributions: 0, names: [] }, bytecodeUnlisted: 0, foreignUnlisted: 0, unlistedNotJudged: [], unparseable: [] } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports hash mismatch when file content differs from RECORD', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordVerify-'));
  try {
    const site = join(dir, 'site');
    const dist = join(site, 'pkg.dist-info');
    mkdirSync(join(site, 'pkg'), { recursive: true });
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(site, 'pkg', 'mod.py'), 'original content');
    const digest = sha256('original content');
    writeFileSync(join(dist, 'RECORD'), `pkg/mod.py,sha256=${digest},16\n`);
    writeFileSync(join(site, 'pkg', 'mod.py'), 'tampered content');
    const r = recordVerify(dir, new Set(), { skippedPaths: [] });
    assert.deepEqual(r, { state: "measured", reason: null, findings: [{ rule: "record-hash-mismatch", path: "site/pkg/mod.py", sev: "high", cwe: "CWE-345", detail: "content differs from the sha256 in site/pkg.dist-info/RECORD (16 bytes recorded, 16 on disk)" }], filesScanned: 1, unreadable: [], partialReasons: [], stats: { records: 1, sites: 1, hashed: 1, verified: 0, unhashed: 0, unhashedAbsent: 0, outOfTree: 0, unsupportedHash: 0, conda: { distributions: 0, names: [] }, bytecodeUnlisted: 0, foreignUnlisted: 0, unlistedNotJudged: [], unparseable: [] } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports file missing when RECORD lists a file that is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordVerify-'));
  try {
    const site = join(dir, 'site');
    const dist = join(site, 'pkg.dist-info');
    mkdirSync(join(site, 'pkg'), { recursive: true });
    mkdirSync(dist, { recursive: true });
    const digest = sha256('data');
    writeFileSync(join(dist, 'RECORD'), `pkg/gone.py,sha256=${digest},4\n`);
    const r = recordVerify(dir, new Set(), { skippedPaths: [] });
    assert.deepEqual(r, { state: "measured", reason: null, findings: [{ rule: "record-file-missing", path: "site/pkg/gone.py", sev: "med", cwe: "CWE-345", detail: "listed with a sha256 hash in site/pkg.dist-info/RECORD and absent from the tree" }], filesScanned: 1, unreadable: [], partialReasons: [], stats: { records: 1, sites: 1, hashed: 1, verified: 0, unhashed: 0, unhashedAbsent: 0, outOfTree: 0, unsupportedHash: 0, conda: { distributions: 0, names: [] }, bytecodeUnlisted: 0, foreignUnlisted: 0, unlistedNotJudged: [], unparseable: [] } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports unlisted file in a directory owned by a distribution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordVerify-'));
  try {
    const site = join(dir, 'site');
    const dist = join(site, 'pkg.dist-info');
    mkdirSync(join(site, 'pkg'), { recursive: true });
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(site, 'pkg', 'legit.py'), 'x');
    const digest = sha256('x');
    writeFileSync(join(dist, 'RECORD'), `pkg/legit.py,sha256=${digest},1\n`);
    writeFileSync(join(site, 'pkg', 'rogue.py'), 'y');
    const r = recordVerify(dir, new Set(), { skippedPaths: [] });
    assert.deepEqual(r, { state: "measured", reason: null, findings: [{ rule: "record-unlisted-file", path: "site/pkg/rogue.py", sev: "high", cwe: "CWE-345", detail: "in pkg/, which pkg installs, and listed in no RECORD there" }], filesScanned: 2, unreadable: [], partialReasons: [], stats: { records: 1, sites: 1, hashed: 1, verified: 1, unhashed: 0, unhashedAbsent: 0, outOfTree: 0, unsupportedHash: 0, conda: { distributions: 0, names: [] }, bytecodeUnlisted: 0, foreignUnlisted: 0, unlistedNotJudged: [], unparseable: [] } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports hash mismatch when a listed file is replaced by a symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordVerify-'));
  try {
    const site = join(dir, 'site');
    const dist = join(site, 'pkg.dist-info');
    mkdirSync(join(site, 'pkg'), { recursive: true });
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(site, 'pkg', 'target.py'), 'real');
    const digest = sha256('real');
    writeFileSync(join(dist, 'RECORD'), `pkg/link.py,sha256=${digest},4\n`);
    symlinkSync(join(site, 'pkg', 'target.py'), join(site, 'pkg', 'link.py'));
    const r = recordVerify(dir, new Set(), { skippedPaths: [] });
    assert.deepEqual(r, { state: "measured", reason: null, findings: [{ rule: "record-hash-mismatch", path: "site/pkg/link.py", sev: "high", cwe: "CWE-345", detail: "replaced by a symbolic link (not followed); site/pkg.dist-info/RECORD lists a regular file" }, { rule: "record-unlisted-file", path: "site/pkg/target.py", sev: "high", cwe: "CWE-345", detail: "in pkg/, which pkg installs, and listed in no RECORD there" }], filesScanned: 2, unreadable: [], partialReasons: [], stats: { records: 1, sites: 1, hashed: 1, verified: 0, unhashed: 0, unhashedAbsent: 0, outOfTree: 0, unsupportedHash: 0, conda: { distributions: 0, names: [] }, bytecodeUnlisted: 0, foreignUnlisted: 0, unlistedNotJudged: [], unparseable: [] } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports hash mismatch when a listed file is replaced by a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordVerify-'));
  try {
    const site = join(dir, 'site');
    const dist = join(site, 'pkg.dist-info');
    mkdirSync(join(site, 'pkg'), { recursive: true });
    mkdirSync(dist, { recursive: true });
    const digest = sha256('was a file');
    writeFileSync(join(dist, 'RECORD'), `pkg/nowdir,sha256=${digest},10\n`);
    mkdirSync(join(site, 'pkg', 'nowdir'));
    const r = recordVerify(dir, new Set(), { skippedPaths: [] });
    assert.deepEqual(r, { state: "measured", reason: null, findings: [{ rule: "record-hash-mismatch", path: "site/pkg/nowdir", sev: "med", cwe: "CWE-345", detail: "replaced by a directory or special file; site/pkg.dist-info/RECORD lists a regular file" }], filesScanned: 1, unreadable: [], partialReasons: [], stats: { records: 1, sites: 1, hashed: 1, verified: 0, unhashed: 0, unhashedAbsent: 0, outOfTree: 0, unsupportedHash: 0, conda: { distributions: 0, names: [] }, bytecodeUnlisted: 0, foreignUnlisted: 0, unlistedNotJudged: [], unparseable: [] } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports hash mismatch when file size differs from RECORD', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordVerify-'));
  try {
    const site = join(dir, 'site');
    const dist = join(site, 'pkg.dist-info');
    mkdirSync(join(site, 'pkg'), { recursive: true });
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(site, 'pkg', 'mod.py'), 'short');
    const digest = sha256('short');
    writeFileSync(join(dist, 'RECORD'), `pkg/mod.py,sha256=${digest},999\n`);
    const r = recordVerify(dir, new Set(), { skippedPaths: [] });
    assert.deepEqual(r, { state: "measured", reason: null, findings: [], filesScanned: 1, unreadable: [], partialReasons: [], stats: { records: 1, sites: 1, hashed: 1, verified: 1, unhashed: 0, unhashedAbsent: 0, outOfTree: 0, unsupportedHash: 0, conda: { distributions: 0, names: [] }, bytecodeUnlisted: 0, foreignUnlisted: 0, unlistedNotJudged: [], unparseable: [] } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports unlisted file with multiple owners in detail message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordVerify-'));
  try {
    const site = join(dir, 'site');
    const d1 = join(site, 'a.dist-info');
    const d2 = join(site, 'b.dist-info');
    const d3 = join(site, 'c.dist-info');
    const d4 = join(site, 'd.dist-info');
    mkdirSync(join(site, 'shared'), { recursive: true });
    mkdirSync(d1); mkdirSync(d2); mkdirSync(d3); mkdirSync(d4);
    writeFileSync(join(site, 'shared', 'x.py'), 'x');
    const digest = sha256('x');
    writeFileSync(join(d1, 'RECORD'), `shared/x.py,sha256=${digest},1\n`);
    writeFileSync(join(d2, 'RECORD'), `shared/x.py,sha256=${digest},1\n`);
    writeFileSync(join(d3, 'RECORD'), `shared/x.py,sha256=${digest},1\n`);
    writeFileSync(join(d4, 'RECORD'), `shared/x.py,sha256=${digest},1\n`);
    writeFileSync(join(site, 'shared', 'extra.py'), 'y');
    const r = recordVerify(dir, new Set(), { skippedPaths: [] });
    assert.deepEqual(r, { state: "measured", reason: null, findings: [{ rule: "record-unlisted-file", path: "site/shared/extra.py", sev: "high", cwe: "CWE-345", detail: "in shared/, which a, b, c and 1 more install, and listed in no RECORD there" }], filesScanned: 5, unreadable: [], partialReasons: [], stats: { records: 4, sites: 1, hashed: 4, verified: 4, unhashed: 0, unhashedAbsent: 0, outOfTree: 0, unsupportedHash: 0, conda: { distributions: 0, names: [] }, bytecodeUnlisted: 0, foreignUnlisted: 0, unlistedNotJudged: [], unparseable: [] } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports unlisted file with exactly three owners in detail message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordVerify-'));
  try {
    const site = join(dir, 'site');
    const d1 = join(site, 'a.dist-info');
    const d2 = join(site, 'b.dist-info');
    const d3 = join(site, 'c.dist-info');
    mkdirSync(join(site, 'shared'), { recursive: true });
    mkdirSync(d1); mkdirSync(d2); mkdirSync(d3);
    writeFileSync(join(site, 'shared', 'x.py'), 'x');
    const digest = sha256('x');
    writeFileSync(join(d1, 'RECORD'), `shared/x.py,sha256=${digest},1\n`);
    writeFileSync(join(d2, 'RECORD'), `shared/x.py,sha256=${digest},1\n`);
    writeFileSync(join(d3, 'RECORD'), `shared/x.py,sha256=${digest},1\n`);
    writeFileSync(join(site, 'shared', 'extra.py'), 'y');
    const r = recordVerify(dir, new Set(), { skippedPaths: [] });
    assert.deepEqual(r, { state: "measured", reason: null, findings: [{ rule: "record-unlisted-file", path: "site/shared/extra.py", sev: "high", cwe: "CWE-345", detail: "in shared/, which a, b, c install, and listed in no RECORD there" }], filesScanned: 4, unreadable: [], partialReasons: [], stats: { records: 3, sites: 1, hashed: 3, verified: 3, unhashed: 0, unhashedAbsent: 0, outOfTree: 0, unsupportedHash: 0, conda: { distributions: 0, names: [] }, bytecodeUnlisted: 0, foreignUnlisted: 0, unlistedNotJudged: [], unparseable: [] } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
