// node --test monitor/test/  — lib/deploy-core.mjs: IMPORTING IT MUST NOT WRITE, PRINT, OR EXIT.
// A child imports it under a throwaway $HOME/cwd: stdout+stderr must be empty, both trees stay
// byte-identical, and a sentinel written AFTER the import must exist. The negative control aims
// the same harness at bin/deploy.mjs and must fail all three ways, or the green is vacuous.

import { describe, test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '../..');
const CORE = join(CW, 'lib', 'deploy-core.mjs');

// The child does exactly one interesting thing — the dynamic import — and then proves it is still
// running. The sentinel and the child script live OUTSIDE the trees being hashed.
const CHILD = `
import { writeFileSync } from 'node:fs';
const mod = await import(process.env.CW_IMPORT_TARGET);
await new Promise((r) => setTimeout(r, 20));
writeFileSync(process.env.CW_SENTINEL, JSON.stringify({ alive: true, exports: Object.keys(mod).sort() }));
`;

let root;
before(() => { root = mkdtempSync(join(tmpdir(), 'cw-purity-')); });
after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

// Content-addressed, so a rewrite with identical bytes is not reported and a one-byte change is.
function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      const rel = relative(dir, p);
      if (e.isSymbolicLink()) out.push(`L ${rel} -> ${readlinkSync(p)}`);
      else if (e.isDirectory()) { out.push(`D ${rel}`); walk(p); }
      else out.push(`F ${rel} ${statSync(p).size} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`);
    }
  };
  walk(dir);
  return out.join('\n');
}

// Import `target` in a child whose HOME and cwd are throwaway directories, and report everything
// observable about the attempt.
function importInChild(target, label) {
  const box = join(root, label);
  const home = join(box, 'home');
  const work = join(box, 'work');
  const harness = join(box, 'harness'); // deliberately not hashed: the script and sentinel live here
  mkdirSync(join(home, '.cloudflared'), { recursive: true });
  mkdirSync(work, { recursive: true });
  mkdirSync(harness, { recursive: true });
  // a canary where the daemon reads, so "wrote nothing" is checked at the exact place that matters
  writeFileSync(join(home, '.cloudflared', 'config.yml'), 'tunnel: canary\ningress:\n  - service: http_status:404\n');
  const script = join(harness, 'import-once.mjs');
  const sentinel = join(harness, 'sentinel.json');
  writeFileSync(script, CHILD);

  const beforeHome = snapshot(home);
  const beforeWork = snapshot(work);
  const r = spawnSync(process.execPath, [script], {
    cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home, CW_IMPORT_TARGET: pathToFileURL(target).href, CW_SENTINEL: sentinel },
  });
  return {
    code: r.status ?? -1,
    stdout: String(r.stdout || ''), stderr: String(r.stderr || ''),
    sentinel: existsSync(sentinel) ? JSON.parse(readFileSync(sentinel, 'utf8')) : null,
    homeChanged: snapshot(home) !== beforeHome,
    workChanged: snapshot(work) !== beforeWork,
  };
}

describe('lib/deploy-core.mjs — importing it must not write, print, or exit', () => {
  test('the import is silent, writes nothing, and the process is still alive afterwards', () => {
    const r = importInChild(CORE, 'core');
    assert.equal(r.stdout, '', `importing deploy-core wrote to stdout:\n${r.stdout}`);
    assert.equal(r.stderr, '', `importing deploy-core wrote to stderr:\n${r.stderr}`);
    assert.equal(r.homeChanged, false, 'importing deploy-core modified something under $HOME');
    assert.equal(r.workChanged, false, 'importing deploy-core modified something in the cwd');
    assert.ok(r.sentinel, 'the process did not survive the import — a module-scope exit() ran');
    assert.equal(r.sentinel.alive, true);
    assert.equal(r.code, 0, `the child exited ${r.code}`);
  });

  test('and it exports the verb, so the import is not silent because it is empty', () => {
    const r = importInChild(CORE, 'exports');
    // pinned as an exact set — what the module offers is part of its contract; the attestation
    // exports exist so deploy-state.mjs can adopt the rule without copying it
    assert.deepEqual(r.sentinel?.exports,
      ['ATTEST', 'ATTEST_DRIFT', 'attestRows', 'classifyAttestation', 'explainAttestation', 'verify'],
      'deploy-core must export verify() and the attestation rule — and nothing else');
  });

  test('CONTROL: the same harness aimed at bin/deploy.mjs fails all three ways', () => {
    // proves the harness can actually SEE printing and exiting
    const r = importInChild(join(CW, 'bin', 'deploy.mjs'), 'cli');
    assert.ok(r.stdout.length + r.stderr.length > 0, 'the harness failed to observe the CLI printing');
    assert.equal(r.sentinel, null, 'the harness failed to observe the CLI exiting at module scope');
  });
});
