import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRoot, runLens, gitleaksWitness, exitCodeFor, EXIT } from '../transcript-secrets.mjs';
import { VERDICT } from '../../bin/secrets-sweep.mjs';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', 'transcript-secrets.mjs');
const NOW = '2026-10-11T00:00:00.000Z';
// assembled at run time so the test file itself carries no token shape
const TOKEN = ['gh', 'p_', 'Qx7Lm2Vn9Rt4Wz1Kp8Hs3Jd6Fy5Bc0Ng', 'Ae2U'].join('');
const line = (o) => `${JSON.stringify(o)}\n`;
const transcript = (text) => line({ type: 'user', message: { content: [{ type: 'tool_result', content: text }] } });

function fixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'cw-transcripts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'proj-a', 'sub'), { recursive: true });
  writeFileSync(join(root, 'proj-a', 'leak.jsonl'), transcript(`export GITHUB_TOKEN=${TOKEN}`) + transcript(`again ${TOKEN}`) + transcript('nothing here'));
  writeFileSync(join(root, 'proj-a', 'sub', 'clean.jsonl'), transcript('plain text') + transcript('{"ok":true}'));
  writeFileSync(join(root, 'proj-a', 'notes.md'), 'placeholder key: AKIAIOSFODNN7EXAMPLE\n');
  writeFileSync(join(root, 'proj-a', 'noise.jsonl'), line({ type: 'assistant', message: { content: [{ type: 'thinking', signature: 'x' }] }, cwd: '/Users/someone/Repositories/x' }) + transcript('value Kd9fQ2mZ7Lp1Rt4Vn8Hs3Jd6Wy5Bc0NgQx7Lm2Vn9Rt4Wz1Kp8Hs3Jd6Fy5 end') + transcript('mail jane.doe@acme-corp.co.uk or call +61 400 000 000'));
  writeFileSync(join(root, 'proj-a', 'old.jsonl'), transcript(TOKEN));
  const old = new Date(Date.parse(NOW) - 40 * 86_400_000);
  utimesSync(join(root, 'proj-a', 'old.jsonl'), old, old);
  writeFileSync(join(root, 'proj-a', 'image.png'), Buffer.from([0x89, 0x50, 0, 0]));
  return root;
}

test('scanRoot: a token in a tool result is one REAL-SECRET finding per file and class, with no value in the output', (t) => {
  const root = fixtureRoot(t);
  const r = scanRoot(root, { sinceAt: Date.parse(NOW) - 7 * 86_400_000, env: {} });
  assert.deepEqual([r.present, r.files, r.scanned], [true, 4, 4]);
  const leak = r.findings.find((f) => f.file === 'proj-a/leak.jsonl' && f.verdict === VERDICT.SECRET);
  assert.ok(leak, JSON.stringify(r.findings));
  assert.equal(leak.count, 2, 'two lines, one finding row');
  assert.equal(leak.fingerprints.length, 1, 'the same span hashes to one fingerprint');
  assert.equal(leak.firstLine, 1);
  assert.ok(!JSON.stringify(r).includes(TOKEN) && !JSON.stringify(r).includes(TOKEN.slice(4, 12)), 'the value never leaves the scanner');
  assert.ok(!r.findings.some((f) => f.file === 'proj-a/old.jsonl'), 'outside the window');
  assert.ok(!r.findings.some((f) => f.file === 'proj-a/sub/clean.jsonl'));
  assert.ok(!r.findings.some((f) => f.file === 'proj-a/notes.md'), 'a documented example key is counted as a placeholder, not reported');
  assert.ok(!r.findings.some((f) => f.file === 'proj-a/noise.jsonl'), 'signatures, home paths, emails and phones are counted, never per-file findings');
  assert.equal(r.counted.placeholders, 1);
  assert.ok(r.counted.entropyRuns >= 1, JSON.stringify(r.counted));
  assert.ok(r.counted.context['context/email'] >= 1 && r.counted.context['context/home-path'] >= 1, JSON.stringify(r.counted.context));
  assert.ok(r.findings.every((f) => f.verdict === VERDICT.SECRET));
  assert.deepEqual(scanRoot(join(root, 'nope'), { sinceAt: 0, env: {} }).present, false);
});

test('scanRoot: oversize and unreadable files are stated, never clean', (t) => {
  const root = fixtureRoot(t);
  const r = scanRoot(root, { sinceAt: 0, env: { CW_TRANSCRIPT_MAX_BYTES: '30' } });
  assert.ok(r.unscanned.length >= 3 && r.unscanned.every((u) => /too-large/.test(u.reason)));
  assert.equal(r.scanned, 0);
  if (process.platform !== 'win32' && process.getuid && process.getuid() !== 0) {
    chmodSync(join(root, 'proj-a', 'leak.jsonl'), 0o000);
    mkdirSync(join(root, 'locked')); writeFileSync(join(root, 'locked', 'x.jsonl'), 'x'); chmodSync(join(root, 'locked'), 0o000);
    const d = scanRoot(root, { sinceAt: 0, env: {} });
    chmodSync(join(root, 'proj-a', 'leak.jsonl'), 0o600); chmodSync(join(root, 'locked'), 0o700);
    assert.deepEqual(d.failures.map((f) => f.file).sort(), ['locked', 'proj-a/leak.jsonl'], 'an unreadable file and an unlistable directory are both failures');
  }
});

function stubGitleaks(dir, body) {
  const p = join(dir, 'gitleaks-stub.cjs');
  writeFileSync(p, body);
  const sh = join(dir, 'gitleaks');
  writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${p}" "$@"\n`);
  chmodSync(sh, 0o755);
  return sh;
}
const REPORTING_STUB = `
const a = process.argv.slice(2);
if (a[0] === 'version') { console.log('9.9.9-stub'); process.exit(0); }
const report = a[a.indexOf('--report-path') + 1]; const src = a[a.indexOf('--source') + 1];
const fs = require('fs'); const path = require('path');
const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
const st = fs.statSync(src); if (st.isDirectory()) walk(src); else files.push(src);
const rows = files.filter((f) => f.endsWith('leak.jsonl')).map((f) => ({ RuleID: 'github-pat', File: f, StartLine: 1, Secret: 'REDACTED' }));
fs.writeFileSync(report, JSON.stringify(rows)); process.exit(rows.length ? 1 : 0);
`;

test('the lens: gitleaks is a second witness (ran, off, absent, failed), roots absent are stated, exit codes follow', (t) => {
  const root = fixtureRoot(t);
  const bindir = mkdtempSync(join(tmpdir(), 'cw-gl-')); t.after(() => rmSync(bindir, { recursive: true, force: true }));
  const env = { CW_NOW: NOW, CW_TRANSCRIPT_GITLEAKS: stubGitleaks(bindir, REPORTING_STUB) };
  const r = runLens({ roots: [root, join(root, 'absent')], env });
  assert.deepEqual([r.summary.roots, r.summary.rootsPresent, r.summary.scanned], [2, 1, 4]);
  assert.equal(r.summary.secrets, 2);
  assert.equal(r.summary.counted.placeholders, 1);
  assert.deepEqual([r.secondWitness.state, r.secondWitness.version, r.secondWitness.findings], ['ran', '9.9.9-stub', 1]);
  assert.deepEqual(r.secondWitness.perFile, [{ file: 'proj-a/leak.jsonl', rule: 'github-pat', count: 1 }]);
  assert.ok(!JSON.stringify(r).includes('REDACTED') && !JSON.stringify(r).includes(TOKEN));
  assert.equal(exitCodeFor(r), EXIT.secrets);
  const same = runLens({ roots: [root, join(root, 'absent')], env });
  assert.equal(JSON.stringify(same), JSON.stringify(r), 'deterministic');

  assert.equal(runLens({ roots: [root], env: { ...env, CW_TRANSCRIPT_GITLEAKS: 'off' } }).secondWitness.state, 'off');
  assert.equal(runLens({ roots: [root], env: { ...env, CW_TRANSCRIPT_GITLEAKS: join(bindir, 'nope') } }).secondWitness.state, 'absent');
  const bindir2 = mkdtempSync(join(tmpdir(), 'cw-gl-fail-')); t.after(() => rmSync(bindir2, { recursive: true, force: true }));
  const failing = stubGitleaks(bindir2, `if (process.argv[2] === 'version') { console.log('x'); process.exit(0); } process.exit(126);`);
  const bad = runLens({ roots: [root], env: { ...env, CW_TRANSCRIPT_GITLEAKS: failing } });
  assert.equal(bad.secondWitness.state, 'failed');
  assert.equal(exitCodeFor(bad), EXIT.failed, 'a failed witness is not a clean one');

  const cleanRoot = mkdtempSync(join(tmpdir(), 'cw-transcripts-clean-')); t.after(() => rmSync(cleanRoot, { recursive: true, force: true }));
  writeFileSync(join(cleanRoot, 'a.jsonl'), transcript('hello'));
  const clean = runLens({ roots: [cleanRoot], env: { ...env, CW_TRANSCRIPT_GITLEAKS: 'off' } });
  assert.equal(exitCodeFor(clean), EXIT.clean);
  const none = runLens({ roots: [join(root, 'absent')], env: { ...env, CW_TRANSCRIPT_GITLEAKS: 'off' } });
  assert.equal(exitCodeFor(none), EXIT.failed, 'nothing scanned is not clean');

  const cli = spawnSync(process.execPath, [TOOL, '--root', root, '--since', 'all'], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(cli.status, EXIT.secrets, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /\S+\s+×1\s+.*proj-a\/old\.jsonl/);
  assert.match(cli.stdout, /second witness gitleaks: ran 9\.9\.9-stub — 1 finding\(s\)/);
  assert.ok(!cli.stdout.includes(TOKEN.slice(4, 12)));
});

test('gitleaksWitness: only files the scanner saw are handed over, hard-linked, never the originals\' paths in the report', (t) => {
  const root = fixtureRoot(t);
  const bindir = mkdtempSync(join(tmpdir(), 'cw-gl2-')); t.after(() => rmSync(bindir, { recursive: true, force: true }));
  const w = gitleaksWitness([{ root, present: true, scannedFiles: [{ abs: join(root, 'proj-a', 'leak.jsonl'), rel: 'proj-a/leak.jsonl' }] }], { env: { CW_TRANSCRIPT_GITLEAKS: stubGitleaks(bindir, REPORTING_STUB) } });
  assert.deepEqual(w.perFile, [{ file: 'proj-a/leak.jsonl', rule: 'github-pat', count: 1 }]);
  assert.ok(!JSON.stringify(w).includes(root), 'the scratch path, not the transcript root, was scanned');
});
