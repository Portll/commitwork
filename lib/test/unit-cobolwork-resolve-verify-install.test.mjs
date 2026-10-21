// Verifies that a pinned cobolwork install matches the pin and is intact (lib/cobolwork-resolve.mjs verifyInstall).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyInstall, digestEntries, readTree, statedCommit, installDir, RECEIPT, SCRIPT, REVISION } from '../cobolwork-resolve.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

function setup() {
  return mkdtempSync(join(tmpdir(), 'verifyInstall-'));
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

function makeInstall(root, pin, { receipt, files, scriptMode } = {}) {
  const dir = installDir(pin, { CW_TOOLS_ROOT: root });
  mkdirSync(dir, { recursive: true });
  
  if (receipt !== undefined) {
    writeFileSync(join(dir, RECEIPT), JSON.stringify(receipt));
  }
  
  if (files) {
    for (const [rel, data] of Object.entries(files)) {
      const filePath = join(dir, rel);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, data);
    }
  }
  
  if (scriptMode !== undefined) {
    const scriptPath = join(dir, ...SCRIPT.split('/'));
    if (!existsSync(scriptPath)) {
      mkdirSync(dirname(scriptPath), { recursive: true });
      writeFileSync(scriptPath, '#!/usr/bin/env node\n');
    }
    chmodSync(scriptPath, scriptMode);
  }
  
  return dir;
}

test('returns ok when receipt matches pin and tree is intact', { skip: process.platform === 'win32' && 'Windows reports no executable mode bit' }, () => {
  const root = setup();
  try {
    const pin = { version: '1.0.0', sha256: 'abc123', commit: 'a'.repeat(40), asset: 'test.tar.gz' };
    const files = {
      'package/lib/revision.json': JSON.stringify({ commit: 'a'.repeat(40) }),
      'package/bin/cobolwork.mjs': '#!/usr/bin/env node\n'
    };
    const dir = makeInstall(root, pin, { files, scriptMode: 0o755 });
    const treeSha256 = digestEntries(readTree(dir));
    const receipt = { version: pin.version, sha256: pin.sha256, commit: pin.commit, treeSha256 };
    writeFileSync(join(dir, RECEIPT), JSON.stringify(receipt));
    
    const result = verifyInstall(pin, { env: { CW_TOOLS_ROOT: root }, platform: 'linux' });
    assert.equal(result.ok, true);
    assert.equal(result.dir, dir);
    assert.equal(result.script, join(dir, ...SCRIPT.split('/')));
    assert.deepEqual(result.receipt, receipt);
  } finally {
    cleanup(root);
  }
});

test('fails when install directory does not exist', () => {
  const root = setup();
  try {
    const pin = { version: '1.0.0', sha256: 'abc123', commit: 'a'.repeat(40), asset: 'test.tar.gz' };
    const result = verifyInstall(pin, { env: { CW_TOOLS_ROOT: root }, platform: 'linux' });
    assert.equal(result.ok, false);
    assert.equal(result.dir, installDir(pin, { CW_TOOLS_ROOT: root }));
    assert.match(result.reason, /nothing is installed at/);
  } finally {
    cleanup(root);
  }
});

test('fails when receipt file is missing but directory exists', () => {
  const root = setup();
  try {
    const pin = { version: '1.0.0', sha256: 'abc123', commit: 'a'.repeat(40), asset: 'test.tar.gz' };
    const dir = makeInstall(root, pin, {});
    const result = verifyInstall(pin, { env: { CW_TOOLS_ROOT: root }, platform: 'linux' });
    assert.equal(result.ok, false);
    assert.equal(result.dir, dir);
    assert.match(result.reason, /holds no install receipt/);
  } finally {
    cleanup(root);
  }
});

test('fails when receipt version does not match pin', () => {
  const root = setup();
  try {
    const pin = { version: '1.0.0', sha256: 'abc123', commit: 'a'.repeat(40), asset: 'test.tar.gz' };
    const files = { 'package/lib/revision.json': JSON.stringify({ commit: 'a'.repeat(40) }) };
    const dir = makeInstall(root, pin, { files, scriptMode: 0o755 });
    const treeSha256 = digestEntries(readTree(dir));
    const receipt = { version: '2.0.0', sha256: pin.sha256, commit: pin.commit, treeSha256 };
    writeFileSync(join(dir, RECEIPT), JSON.stringify(receipt));
    
    const result = verifyInstall(pin, { env: { CW_TOOLS_ROOT: root }, platform: 'linux' });
    assert.equal(result.ok, false);
    assert.equal(result.dir, dir);
    assert.match(result.reason, /was installed with version "2\.0\.0"/);
  } finally {
    cleanup(root);
  }
});

test('fails when receipt sha256 does not match pin', () => {
  const root = setup();
  try {
    const pin = { version: '1.0.0', sha256: 'abc123', commit: 'a'.repeat(40), asset: 'test.tar.gz' };
    const files = { 'package/lib/revision.json': JSON.stringify({ commit: 'a'.repeat(40) }) };
    const dir = makeInstall(root, pin, { files, scriptMode: 0o755 });
    const treeSha256 = digestEntries(readTree(dir));
    const receipt = { version: pin.version, sha256: 'different', commit: pin.commit, treeSha256 };
    writeFileSync(join(dir, RECEIPT), JSON.stringify(receipt));
    
    const result = verifyInstall(pin, { env: { CW_TOOLS_ROOT: root }, platform: 'linux' });
    assert.equal(result.ok, false);
    assert.equal(result.dir, dir);
    assert.match(result.reason, /was installed with sha256 "different"/);
  } finally {
    cleanup(root);
  }
});

test('fails when receipt commit does not match pin', () => {
  const root = setup();
  try {
    const pin = { version: '1.0.0', sha256: 'abc123', commit: 'a'.repeat(40), asset: 'test.tar.gz' };
    const files = { 'package/lib/revision.json': JSON.stringify({ commit: 'b'.repeat(40) }) };
    const dir = makeInstall(root, pin, { files, scriptMode: 0o755 });
    const treeSha256 = digestEntries(readTree(dir));
    const receipt = { version: pin.version, sha256: pin.sha256, commit: 'b'.repeat(40), treeSha256 };
    writeFileSync(join(dir, RECEIPT), JSON.stringify(receipt));
    
    const result = verifyInstall(pin, { env: { CW_TOOLS_ROOT: root }, platform: 'linux' });
    assert.equal(result.ok, false);
    assert.equal(result.dir, dir);
    assert.match(result.reason, /was installed with commit/);
  } finally {
    cleanup(root);
  }
});

test('fails when tree digest does not match receipt', () => {
  const root = setup();
  try {
    const pin = { version: '1.0.0', sha256: 'abc123', commit: 'a'.repeat(40), asset: 'test.tar.gz' };
    const files = { 'package/lib/revision.json': JSON.stringify({ commit: 'a'.repeat(40) }) };
    const dir = makeInstall(root, pin, { files, scriptMode: 0o755 });
    const receipt = { version: pin.version, sha256: pin.sha256, commit: pin.commit, treeSha256: 'wronghash' };
    writeFileSync(join(dir, RECEIPT), JSON.stringify(receipt));
    
    const result = verifyInstall(pin, { env: { CW_TOOLS_ROOT: root }, platform: 'linux' });
    assert.equal(result.ok, false);
    assert.equal(result.dir, dir);
    assert.match(result.reason, /files under .* are not the ones installed/);
  } finally {
    cleanup(root);
  }
});

test('fails when stated commit in revision.json does not match pin', () => {
  const root = setup();
  try {
    const pin = { version: '1.0.0', sha256: 'abc123', commit: 'a'.repeat(40), asset: 'test.tar.gz' };
    const files = { 'package/lib/revision.json': JSON.stringify({ commit: 'b'.repeat(40) }) };
    const dir = makeInstall(root, pin, { files, scriptMode: 0o755 });
    const treeSha256 = digestEntries(readTree(dir));
    const receipt = { version: pin.version, sha256: pin.sha256, commit: pin.commit, treeSha256 };
    writeFileSync(join(dir, RECEIPT), JSON.stringify(receipt));
    
    const result = verifyInstall(pin, { env: { CW_TOOLS_ROOT: root }, platform: 'linux' });
    assert.equal(result.ok, false);
    assert.equal(result.dir, dir);
    assert.match(result.reason, /states commit/);
  } finally {
    cleanup(root);
  }
});

test('fails when script is not executable on non-windows platform', { skip: process.platform === 'win32' && 'Windows reports no executable mode bit' }, () => {
  const root = setup();
  try {
    const pin = { version: '1.0.0', sha256: 'abc123', commit: 'a'.repeat(40), asset: 'test.tar.gz' };
    const files = {
      'package/lib/revision.json': JSON.stringify({ commit: 'a'.repeat(40) }),
      'package/bin/cobolwork.mjs': '#!/usr/bin/env node\n'
    };
    const dir = makeInstall(root, pin, { files, scriptMode: 0o644 });
    const treeSha256 = digestEntries(readTree(dir));
    const receipt = { version: pin.version, sha256: pin.sha256, commit: pin.commit, treeSha256 };
    writeFileSync(join(dir, RECEIPT), JSON.stringify(receipt));
    
    const result = verifyInstall(pin, { env: { CW_TOOLS_ROOT: root }, platform: 'linux' });
    assert.equal(result.ok, false);
    assert.equal(result.dir, dir);
    assert.match(result.reason, /is not executable/);
  } finally {
    cleanup(root);
  }
});

test('skips executable check on win32 platform', () => {
  const root = setup();
  try {
    const pin = { version: '1.0.0', sha256: 'abc123', commit: 'a'.repeat(40), asset: 'test.tar.gz' };
    const files = {
      'package/lib/revision.json': JSON.stringify({ commit: 'a'.repeat(40) }),
      'package/bin/cobolwork.mjs': '#!/usr/bin/env node\n'
    };
    const dir = makeInstall(root, pin, { files, scriptMode: 0o644 });
    const treeSha256 = digestEntries(readTree(dir));
    const receipt = { version: pin.version, sha256: pin.sha256, commit: pin.commit, treeSha256 };
    writeFileSync(join(dir, RECEIPT), JSON.stringify(receipt));
    
    const result = verifyInstall(pin, { env: { CW_TOOLS_ROOT: root }, platform: 'win32' });
    assert.equal(result.ok, true);
    assert.equal(result.dir, dir);
  } finally {
    cleanup(root);
  }
});
