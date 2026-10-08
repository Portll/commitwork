// node --test bin/test/sandbox-require.test.mjs
//
// CW_SANDBOX=require, the container's setting: when the host sandbox cannot confine a lane, the lane
// is refused as noscan and its command never runs. Without it the same host runs every lane
// unconfined and each row says so. The sandbox tool is made to fail by a stub earlier on PATH, so
// both directions are measured on any host, including one whose real sandbox works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skip = process.platform === 'win32' ? 'no host sandbox exists on Windows to make unavailable; the probe is unavailable by construction there' : false;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-sandbox-require-'));
  const repo = join(dir, 'repo'); const reports = join(dir, 'reports'); const stubs = join(dir, 'stubs');
  for (const d of [repo, reports, stubs]) mkdirSync(d);
  for (const tool of ['sandbox-exec', 'bwrap']) {
    writeFileSync(join(stubs, tool), '#!/bin/sh\necho "stub: no namespaces here" >&2\nexit 1\n');
    chmodSync(join(stubs, tool), 0o755);
  }
  const lane = (id, egress) => ({
    id, description: `fixture: ${egress || 'no'} egress`, groups: ['probe'],
    local: [`touch "$CW_REPORT_DIR/ran-${id}"; printf '{"tool":"${id}","summary":{"findings":0,"byRule":{},"filesScanned":1},"findings":[]}' > "$CW_REPORT_DIR/${id}.json"; echo 0 > "$CW_REPORT_DIR/${id}.json.exit"`],
    report: { file: `${id}.json`, format: 'rule-counts' }, ...(egress ? { egress } : {}),
  });
  const manifest = join(dir, 'm.json');
  writeFileSync(manifest, JSON.stringify({ repo: 'fixture', groups: { probe: ['none-lane', 'open-lane', 'bare-lane'] },
    checks: [lane('none-lane', 'none'), lane('open-lane', 'registry'), lane('bare-lane', null)] }));
  const env = (sandbox) => {
    const e = { ...process.env, PATH: `${stubs}${delimiter}${process.env.PATH}`, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1', CW_DOCKER: 'false' };
    delete e.CW_SANDBOX;
    if (sandbox) e.CW_SANDBOX = sandbox;
    return e;
  };
  const cli = (args, sandbox) => spawnSync(process.execPath, [join(ROOT, 'bin', 'commitwork.mjs'), ...args], { encoding: 'utf8', env: env(sandbox), cwd: repo });
  const rows = () => Object.fromEntries(JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')).map((r) => [r.check, r]));
  return { dir, repo, reports, manifest, cli, rows, ran: (id) => existsSync(join(reports, `ran-${id}`)), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const run = (fx, sandbox) => fx.cli(['run', 'probe', '--manifest', fx.manifest, '--repo', fx.repo, '--no-fail-fast'], sandbox);

test('CW_SANDBOX=require: an unavailable sandbox refuses every host lane as noscan, and no lane command runs', { skip }, () => {
  const fx = fixture();
  try {
    const r = run(fx, 'require');
    let rows;
    try { rows = fx.rows(); } catch (e) { assert.fail(`checks-status.json unreadable (${e.message}); exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
    for (const id of ['none-lane', 'open-lane', 'bare-lane']) {
      assert.equal(rows[id].status, 'noscan', `${id}: ${JSON.stringify(rows[id])}`);
      assert.equal(rows[id].coverage, 'unknown', id);
      assert.equal(fx.ran(id), false, `${id} ran its command under CW_SANDBOX=require`);
    }
    assert.match(JSON.stringify(rows['none-lane']), /CW_SANDBOX=require and the host sandbox is unavailable[^"]*stub: no namespaces here/);
    assert.match(JSON.stringify(rows['bare-lane']), /CW_SANDBOX=require and the check declares no egress class/);
    assert.match(r.stderr, /CW_SANDBOX=require, so every host lane is refused as noscan/);
  } finally { fx.cleanup(); }
});

test('the control: unset, the same unavailable sandbox runs every lane unconfined and each row says why', { skip }, () => {
  const fx = fixture();
  try {
    const r = run(fx, null);
    const rows = fx.rows();
    for (const id of ['none-lane', 'open-lane', 'bare-lane']) {
      assert.equal(fx.ran(id), true, `${id} did not run: ${r.stdout}\n${r.stderr}`);
      assert.equal(rows[id].isolation, 'none', id);
      assert.ok(rows[id].isolationReason, `${id} ran unconfined without saying why`);
    }
    assert.match(rows['none-lane'].isolationReason, /host sandbox unavailable/);
  } finally { fx.cleanup(); }
});

test('doctor names the sandbox state and what CW_SANDBOX=require does about it', { skip }, () => {
  const fx = fixture();
  try {
    const required = fx.cli(['doctor', '--manifest', fx.manifest, '--repo', fx.repo], 'require');
    assert.match(required.stdout, /✗ host sandbox\s+\(\S+ exited 1: stub: no namespaces here\)/);
    assert.match(required.stdout, /CW_SANDBOX=require: every host lane is refused as noscan/);
    const plain = fx.cli(['doctor', '--manifest', fx.manifest, '--repo', fx.repo], null);
    assert.match(plain.stdout, /lanes run unconfined and each row records isolation: none/);
  } finally { fx.cleanup(); }
});
