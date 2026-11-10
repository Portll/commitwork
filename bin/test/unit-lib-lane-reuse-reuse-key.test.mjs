// The key under which a lane's result can be reused, or why it cannot (bin/lib/lane-reuse.mjs reuseKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reuseKey } from '../lib/lane-reuse.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const stated = { x: { state: 'present', versionState: 'stated', version: '1' } };
const plain = { egress: 'none', requires: { tools: ['x'] }, reuse: {} };
const seed = (dir) => {
  mkdirSync(join(dir, 'bin', 'lib'), { recursive: true });
  writeFileSync(join(dir, 'bin', 'lib', 'sandbox.mjs'), 'export {};\n');
  writeFileSync(join(dir, 'bin', 'lib', 'scanner-env.mjs'), 'export {};\n');
};
const run = (dir, check, over = {}) => reuseKey({ check, repoPath: dir, tools: stated, env: {}, root: dir, cfg: { maxFiles: 100 }, ...over });

test('a lane without a reuse declaration is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reuseKey-'));
  try {
    assert.deepEqual(run(dir, { egress: 'none', requires: { tools: ['x'] } }), { ok: false, why: 'the lane declares no reuse' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a lane with egress other than none is refused unless it is registry egress beside packs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reuseKey-'));
  try {
    assert.deepEqual(run(dir, { ...plain, egress: 'registry' }), { ok: false, why: "the lane's egress is registry and nothing keys what it could fetch" });
    assert.deepEqual(run(dir, { ...plain, egress: undefined }), { ok: false, why: "the lane's egress is undeclared and nothing keys what it could fetch" });
    assert.deepEqual(run(dir, { ...plain, egress: 'network', reuse: { packs: 'codeql' } }), { ok: false, why: "the lane's egress is network and nothing keys what it could fetch" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a lane that takes secrets, runs repository code or declares no tools is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reuseKey-'));
  try {
    assert.deepEqual(run(dir, { ...plain, requires: { tools: ['x'], secrets: ['TOKEN'] } }), { ok: false, why: 'the lane takes secrets, so it reads live data' });
    assert.deepEqual(run(dir, { ...plain, executesRepoCode: true }), { ok: false, why: 'the lane runs repository code' });
    assert.deepEqual(run(dir, { ...plain, requiresRepoTrust: true }), { ok: false, why: 'the lane runs repository code' });
    assert.deepEqual(run(dir, { ...plain, requires: { secrets: [] } }), { ok: false, why: 'the lane declares no tools, so its version is unknown' });
    assert.deepEqual(run(dir, { egress: 'none', reuse: {} }), { ok: false, why: 'the lane declares no tools, so its version is unknown' });
    assert.deepEqual(run(dir, { ...plain, requires: { tools: [] } }), { ok: false, why: 'the lane declares no tools, so its version is unknown' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('each declared tool must be probed present and, without a stated version, found on PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reuseKey-'));
  try {
    assert.deepEqual(run(dir, plain, { tools: {} }), { ok: false, why: 'x is not present (not probed)' });
    assert.deepEqual(run(dir, plain, { tools: undefined }), { ok: false, why: 'x is not present (not probed)' });
    assert.deepEqual(run(dir, plain, { tools: { x: { state: 'missing' } } }), { ok: false, why: 'x is not present (missing)' });
    const why = 'the x version is not stated and its executable cannot be resolved';
    assert.deepEqual(run(dir, plain, { tools: { x: { state: 'present', versionState: 'unknown', version: '1' } } }), { ok: false, why });
    assert.deepEqual(run(dir, plain, { tools: { x: { state: 'present', versionState: 'stated', version: '' } } }), { ok: false, why });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the tree fingerprint fails when the tree holds more files than maxFiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reuseKey-'));
  try {
    seed(dir);
    assert.deepEqual(run(dir, plain, { cfg: { maxFiles: 1 } }), { ok: false, why: 'the tree has more than 1 files' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing input is refused by name and an input that cannot be stated is refused as unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reuseKey-'));
  try {
    assert.deepEqual(run(dir, plain), { ok: false, why: 'declared input bin/lib/sandbox.mjs is missing' });
    seed(dir);
    assert.deepEqual(run(dir, { ...plain, reuse: { inputs: ['lanes/gone.txt'] } }), { ok: false, why: 'declared input lanes/gone.txt is missing' });
    assert.deepEqual(run(dir, { ...plain, reuse: { inputs: ['bin/lib/sandbox.mjs/x'] } }), { ok: false, why: 'a declared input is unreadable (ENOTDIR)' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unknown packs are refused and codeql packs key the package listing and model files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reuseKey-'));
  try {
    seed(dir);
    assert.deepEqual(run(dir, { ...plain, egress: 'registry', reuse: { packs: 'foo' } }), { ok: false, why: 'unknown packs "foo"' });
    assert.deepEqual(run(dir, { ...plain, reuse: { packs: 7 } }), { ok: false, why: 'unknown packs 7' });
    mkdirSync(join(dir, 'pk', 'acme', 'rules', '1.0.0'), { recursive: true });
    mkdirSync(join(dir, 'models'));
    writeFileSync(join(dir, 'models', 'm.yml'), 'm\n');
    const env = { CW_CODEQL_PACKAGES: join(dir, 'pk'), CW_CODEQL_MODELS: join(dir, 'models') };
    const r = run(dir, { ...plain, egress: 'registry', reuse: { packs: 'codeql' } }, { env });
    assert.equal(r.ok, true);
    assert.deepEqual(r.parts.packs, { packages: ['acme/rules@1.0.0'], models: { dir: join(dir, 'models'), files: { 'm.yml': sha('m\n') } } });
    assert.equal(r.parts.treeFiles, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stated provenance, directory inputs and the settings a lane reads are keyed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reuseKey-'));
  try {
    seed(dir);
    mkdirSync(join(dir, 'lanes'));
    writeFileSync(join(dir, 'lanes', 'rules.yml'), 'r: 1\n');
    const h = sha('export {};\n');
    const sandbox = join(dir, 'bin', 'lib', 'sandbox.mjs');
    const check = { egress: 'none', requires: { tools: ['x'] }, local: ['scan ${CW_LEVEL} $CW_ROOT'], reuse: { inputs: ['lanes'], env: ['CW_EXTRA'] } };
    const tools = { x: { state: 'present', versionState: 'stated', version: '2.1', resolvedFrom: '/opt/x', commit: 'abc' } };
    const env = { CW_LEVEL: 'high', CW_EXTRA: join(dir, 'absent.cfg'), CW_SANDBOX: sandbox, CW_ROOT: '/r' };
    const r = run(dir, check, { tools, env });
    assert.equal(r.ok, true);
    assert.deepEqual(r.parts.tools, { x: { version: '2.1', resolvedFrom: '/opt/x', commit: 'abc' } });
    assert.deepEqual(r.parts.inputs, { 'bin/lib/sandbox.mjs': h, 'bin/lib/scanner-env.mjs': h, 'lanes/rules.yml': sha('r: 1\n') });
    assert.deepEqual(r.parts.env, { CW_EXTRA: { path: join(dir, 'absent.cfg'), absent: true }, CW_LEVEL: 'high', CW_SANDBOX: { path: sandbox, sha: h } });
    assert.equal(r.parts.treeFiles, 3);
    assert.deepEqual(run(dir, plain, { env: { CW_SANDBOX: dir } }), { ok: false, why: `a setting the lane reads names an unreadable file (${dir} is not a file, so its contents cannot be keyed)` });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a lane that passes every check is keyed over its check, tree, tools, inputs and settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reuseKey-'));
  try {
    seed(dir);
    const { key, parts: { tree, ...parts }, ...rest } = run(dir, plain, { cfg: { maxFiles: 2 } });
    const h = sha('export {};\n');
    const check = 'abc6e1f81cbeb9bfebc4135461ff14c3b3f3ca1a6ab2f9b3e928e5ed66a22459';
    assert.deepEqual(rest, { ok: true });
    assert.deepEqual(parts, { v: 2, check, tools: { x: { version: '1', resolvedFrom: null, commit: null } }, inputs: { 'bin/lib/sandbox.mjs': h, 'bin/lib/scanner-env.mjs': h }, env: { CW_SANDBOX: null }, packs: null, treeFiles: 2 });
    assert.equal(key, sha(`{"check":"${check}","env":{"CW_SANDBOX":null},"inputs":{"bin/lib/sandbox.mjs":"${h}","bin/lib/scanner-env.mjs":"${h}"},"packs":null,"tools":{"x":{"commit":null,"resolvedFrom":null,"version":"1"}},"tree":"${tree}","v":2}`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
