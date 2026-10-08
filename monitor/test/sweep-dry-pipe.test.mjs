// `sweep.mjs --dry` must deliver ALL of its output to a pipe, however slowly the pipe is read.
//
// On 2026-09-27 sweep-exclude.test.mjs went red with no commit behind it. A 3,184-repo corpus had
// landed under ~/Repositories, which the example registry declares as a root, so a clean checkout's
// `--all --dry` printed 530 KB. --dry ended in a bare process.exit(0), stdout to a pipe is
// asynchronous on macOS, and a reader that fell behind got 65,535 bytes with exit 0: everything but
// the fan-out plan and the summary, which print last.
//
// Pinned as a contract, not a symptom: a fixture fleet big enough to overrun the pipe, and a reader
// that drains nothing until the child has exited or a bounded hold has passed. The broken child
// exits inside the hold with its tail still queued; a fixed one cannot exit until it is read.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const CW = fileURLToPath(new URL('../..', import.meta.url));
const SWEEP = join(CW, 'monitor/sweep.mjs');
const N = 800;          // x ~400 bytes a line: several times the pipe plus the reader's own buffer
const HOLD_MS = 1500;   // the broken child exits in ~100 ms; the fixed one waits this out

let tmp, root, regPath, env;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cw-sweep-pipe-'));
  root = join(tmp, 'r'.repeat(150)); // long paths: fewer repos for the same byte count
  for (let i = 0; i < N; i++) mkdirSync(join(root, `repo-${String(i).padStart(4, '0')}`, '.git'), { recursive: true });
  regPath = join(tmp, 'projects.json');
  writeFileSync(regPath, JSON.stringify({
    reportsRoot: relative(CW, join(tmp, 'reports')),
    areas: [{ slug: 'alpha', out: 'alpha', primary: true }],
    roots: [{ path: root, maxDepth: 1 }],
    projects: [],
  }, null, 1));
  env = {
    ...process.env, CW_REGISTRY: regPath, CW_SKIP_SETUP: '1', CW_NO_COLOR: '1', CW_MONITOR_OUT: '',
    CW_SWEEP_REFUSALS: join(tmp, 'sweep-refusals.jsonl'),
  };
});
after(() => rmSync(tmp, { recursive: true, force: true }));

function readLate(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SWEEP, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '', released = false, exitedFirst = false;
    child.stderr.on('data', (d) => { err += d; });
    const release = () => {
      if (released) return;
      released = true;
      child.stdout.on('data', (d) => chunks.push(d));
    };
    const timer = setTimeout(release, HOLD_MS);
    child.once('exit', () => { if (!released) exitedFirst = true; clearTimeout(timer); release(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ out: Buffer.concat(chunks).toString('utf8'), code, err, exitedFirst }));
  });
}

test('--all --dry reaches a late reader whole: every repo, the fan-out plan, and the summary', async () => {
  // Not vacuous: output that fits the pipe and the reader's buffer could never be truncated. Each
  // repo line carries its path twice.
  assert.ok(N * 2 * root.length > 256 * 1024, 'fixture too small to overrun a pipe, so this would prove nothing');
  const { out, code, err, exitedFirst } = await readLate(['all', '--all', '--dry']);
  assert.equal(code, 0, err);
  const repoLines = out.split('\n').filter((l) => /^ {2}repo-\d{4} {2}\[/.test(l));
  assert.equal(repoLines.length, N,
    `a late reader got ${repoLines.length} of ${N} repo lines and ${Buffer.byteLength(out)} bytes`
    + (exitedFirst ? ' — the child exited with output still queued' : ''));
  assert.match(out, /fans out per AREA/);
  assert.match(out, /^ {2}areas: alpha$/m);
  assert.match(out, new RegExp(`dry run: ${N} projects`), 'the summary, printed last, is missing');
});
