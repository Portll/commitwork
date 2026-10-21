// CLI command dispatch and exit codes (bin/launchlist.mjs main).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../launchlist.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns 0 and prints help when no command is given', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (m) => logs.push(m);
  console.error = (m) => logs.push(m);
  try {
    const code = await main([]);
    assert.equal(code, 0);
    assert.ok(logs.some((l) => l.includes('launchlist')));
  } finally {
    console.log = origLog;
    console.error = origErr;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 0 and prints help when --help is passed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (m) => logs.push(m);
  console.error = (m) => logs.push(m);
  try {
    const code = await main(['--help']);
    assert.equal(code, 0);
    assert.ok(logs.some((l) => l.includes('launchlist')));
  } finally {
    console.log = origLog;
    console.error = origErr;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 0 and prints help when -h is passed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (m) => logs.push(m);
  console.error = (m) => logs.push(m);
  try {
    const code = await main(['-h']);
    assert.equal(code, 0);
    assert.ok(logs.some((l) => l.includes('launchlist')));
  } finally {
    console.log = origLog;
    console.error = origErr;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 2 and prints error for unknown command', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (m) => logs.push(m);
  console.error = (m) => logs.push(m);
  try {
    const code = await main(['frobnicate']);
    assert.equal(code, 2);
    assert.ok(logs.some((l) => l.includes('unknown command frobnicate')));
  } finally {
    console.log = origLog;
    console.error = origErr;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 2 and prints error when a flag needs a value but none is given', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (m) => logs.push(m);
  console.error = (m) => logs.push(m);
  try {
    const code = await main(['run', '--project']);
    assert.equal(code, 2);
    assert.ok(logs.some((l) => l.includes('--project needs a value')));
  } finally {
    console.log = origLog;
    console.error = origErr;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 2 and prints error when a flag needs a value and next arg is another flag', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (m) => logs.push(m);
  console.error = (m) => logs.push(m);
  try {
    const code = await main(['run', '--project', '--all']);
    assert.equal(code, 2);
    assert.ok(logs.some((l) => l.includes('--project needs a value')));
  } finally {
    console.log = origLog;
    console.error = origErr;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 2 and prints error for tick with missing positional args', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (m) => logs.push(m);
  console.error = (m) => logs.push(m);
  try {
    const code = await main(['tick']);
    assert.equal(code, 2);
    assert.ok(logs.some((l) => l.includes('usage: launchlist tick')));
  } finally {
    console.log = origLog;
    console.error = origErr;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 2 and prints error for add with missing project', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (m) => logs.push(m);
  console.error = (m) => logs.push(m);
  try {
    const code = await main(['add']);
    assert.equal(code, 2);
    assert.ok(logs.some((l) => l.includes('usage: launchlist add')));
  } finally {
    console.log = origLog;
    console.error = origErr;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 2 and prints error for import with missing file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (m) => logs.push(m);
  console.error = (m) => logs.push(m);
  try {
    const code = await main(['import', 'proj']);
    assert.equal(code, 2);
    assert.ok(logs.some((l) => l.includes('usage: launchlist import')));
  } finally {
    console.log = origLog;
    console.error = origErr;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 2 and prints error when import file is not a JSON array', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  const file = join(dir, 'items.json');
  writeFileSync(file, '{"not":"array"}');
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (m) => logs.push(m);
  console.error = (m) => logs.push(m);
  try {
    const code = await main(['import', 'proj', file]);
    assert.equal(code, 2);
    assert.ok(logs.some((l) => l.includes('must hold a JSON array')));
  } finally {
    console.log = origLog;
    console.error = origErr;
    rmSync(dir, { recursive: true, force: true });
  }
});
