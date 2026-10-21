// node --test monitor/test/ — the scanner-binary hash lens. The classification that matters most:
// hash differs + version string IDENTICAL = 'swapped' (the supply-chain signature), and it must
// never blur into 'changed' (an ordinary upgrade). Baseline discipline: unreadable fails closed,
// only ENOENT is "no baseline yet", and only --accept (the human act) moves the pin.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  compareTools, observeTools, readBaseline, readRoster, runLens, acceptBaseline, sha256File,
} from '../scanner-binary.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-sbin-')); dirs.push(d); return d; };

const env = (kv, fn) => async () => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { await fn(); } finally {
    for (const k of Object.keys(kv)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
};

const OBS = (over = {}) => ({ name: 'semgrep', path: '/opt/bin/semgrep', sha256: 'aaa', version: 'semgrep 1.90.0', ...over });
const BASE = (over = {}) => ({ at: 't0', tools: { semgrep: { path: '/opt/bin/semgrep', sha256: 'aaa', version: 'semgrep 1.90.0', ...over } } });

describe('compareTools — the classification', () => {
  test('identical hash is ok, even when the path moved', () => {
    assert.equal(compareTools([OBS()], BASE()).rows[0].state, 'ok');
    const moved = compareTools([OBS({ path: '/new/semgrep' })], BASE()).rows[0];
    assert.equal(moved.state, 'ok');
    assert.equal(moved.moved, true);
    assert.equal(moved.from, '/opt/bin/semgrep');
  });

  test('SWAPPED: different bytes, identical version string — never blurred into changed', () => {
    const r = compareTools([OBS({ sha256: 'bbb' })], BASE());
    assert.equal(r.rows[0].state, 'swapped');
    assert.equal(r.state, 'findings');
  });

  test('changed: different bytes, different version — an upgrade is still a diff to re-accept', () => {
    const r = compareTools([OBS({ sha256: 'bbb', version: 'semgrep 1.91.0' })], BASE());
    assert.equal(r.rows[0].state, 'changed');
    assert.equal(r.state, 'findings');
  });

  test('an unreadable version cannot certify a swap — hash drift with a null version is changed, marked incomparable', () => {
    const r = compareTools([OBS({ sha256: 'bbb', version: null })], BASE());
    assert.equal(r.rows[0].state, 'changed');
    assert.equal(r.rows[0].versionComparable, false);
    assert.equal(r.rows[0].versionAxis.unknownReason, 'unstated');
  });

  test('pinned then gone from PATH is removed (a finding); never-pinned and absent is its own quiet state', () => {
    const gone = compareTools([{ name: 'semgrep', path: null }], BASE());
    assert.equal(gone.rows[0].state, 'removed');
    assert.equal(gone.state, 'findings');
    const never = compareTools([{ name: 'semgrep', path: null }], { at: 't0', tools: {} });
    assert.equal(never.rows[0].state, 'absent');
    assert.equal(never.state, 'ok');
  });

  test('present but never accepted is unbaselined — grey, not ok and not a finding', () => {
    const r = compareTools([OBS()], { at: 't0', tools: {} });
    assert.equal(r.rows[0].state, 'unbaselined');
    assert.equal(r.state, 'unpinned');
    assert.deepEqual(r.findings, []);
  });

  test('no baseline at all: everything present reads unbaselined and the state says so', () => {
    const r = compareTools([OBS()], null);
    assert.equal(r.rows[0].state, 'unbaselined');
    assert.equal(r.state, 'no-baseline');
  });
});

describe('baseline discipline', () => {
  test('an unreadable baseline THROWS — only ENOENT means "no baseline yet"', async () => {
    const dir = scratch();
    const b = join(dir, 'base.json');
    writeFileSync(b, '{corrupt');
    await env({ CW_SCANNER_BASELINE: b }, async () => { assert.throws(() => readBaseline()); })();
    await env({ CW_SCANNER_BASELINE: join(dir, 'absent.json') }, async () => { assert.equal(readBaseline(), null); })();
  });

  test('--accept pins observed tools atomically, and the next run reads ok', async () => {
    const dir = scratch();
    const roster = join(dir, 'roster.json');
    const base = join(dir, 'base.json');
    const tool = join(dir, 'fakescan');
    writeFileSync(tool, '#!/bin/sh\necho fakescan 1.0.0\n', { mode: 0o755 });
    writeFileSync(roster, JSON.stringify({ tools: [{ name: 'fakescan', versionArgs: ['--version'] }] }));
    const exec = (cmd, args, opts) => (cmd === 'which' || cmd === 'where')
      ? `${tool}\n`
      : execFileSync(cmd, args, opts);
    await env({ CW_SCANNER_ROSTER: roster, CW_SCANNER_BASELINE: base, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      const first = await runLens({ exec });
      assert.equal(first.state, 'no-baseline');
      const a = await acceptBaseline({ exec });
      assert.deepEqual(a.pinned, ['fakescan']);
      const pinned = JSON.parse(readFileSync(base, 'utf8'));
      assert.equal(pinned.at, '2026-08-27T00:00:00.000Z');
      assert.equal(pinned.tools.fakescan.version, 'fakescan 1.0.0');
      const second = await runLens({ exec });
      assert.equal(second.state, 'ok');
      assert.equal(second.rows[0].state, 'ok');
      // The binary is swapped, the version claim kept — the lens must see through it.
      writeFileSync(tool, '#!/bin/sh\n# different bytes\necho fakescan 1.0.0\n', { mode: 0o755 });
      const third = await runLens({ exec });
      assert.equal(third.rows[0].state, 'swapped');
    })();
  });
});

describe('observation', () => {
  test('an absent tool observes path:null; a hash failure is unknown, never a silent skip', async () => {
    const roster = { tools: [{ name: 'ghost', versionArgs: ['--version'] }] };
    const execAbsent = () => { throw new Error('not found'); };
    const obs = await observeTools(roster, { exec: execAbsent });
    assert.deepEqual(obs, [{ name: 'ghost', path: null }]);

    const execFound = (cmd) => (cmd === 'which' || cmd === 'where') ? '/x/ghost\n' : 'v';
    const failHash = async () => { const e = new Error('boom'); e.code = 'EACCES'; throw e; };
    const obs2 = await observeTools(roster, { exec: execFound, hashFile: failHash });
    assert.equal(obs2[0].sha256, null);
    assert.equal(obs2[0].unknownReason, 'tool-failed');
  });

  test('sha256File hashes real bytes', async () => {
    const dir = scratch();
    const f = join(dir, 'x');
    writeFileSync(f, 'hello');
    assert.equal(await sha256File(f), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});

describe('the schema is applied, not merely listed', () => {
  test('an invalid roster REFUSES to load — never silently pins a different tool set', async () => {
    const dir = scratch();
    const roster = join(dir, 'roster.json');
    writeFileSync(roster, JSON.stringify({ tools: [{ name: 'UPPER CASE BAD', versionArgs: [] }] }));
    await env({ CW_SCANNER_ROSTER: roster }, async () => {
      assert.throws(() => readRoster(), /invalid/);
    })();
  });
});

describe('the shipped roster', () => {
  test('parses, and every declared tool is actually referenced by this codebase — a roster row nobody invokes is rot', () => {
    const roster = readRoster();
    assert.ok(roster.tools.length >= 12);
    for (const t of roster.tools) {
      assert.ok(/^[a-z0-9-]+$/.test(t.name), t.name);
      assert.ok(Array.isArray(t.versionArgs) && t.versionArgs.length, `${t.name} versionArgs`);
      const hits = execFileSync('git', ['grep', '-l', '--fixed-strings', t.name, '--', 'bin', 'monitor', 'cra', 'manifests'], { encoding: 'utf8', cwd: fileURLToPath(new URL('../..', import.meta.url)) }).trim();
      assert.ok(hits.length, `${t.name} appears nowhere in bin/ monitor/ cra/ manifests/ — remove it or wire it`);
    }
  });
});
