// Draft remediation PR results and state counts per advisory (bin/remediation-draft-pr.mjs main).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../remediation-draft-pr.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const USAGE = 'usage: remediation-draft-pr.mjs <advisories.json> [--open] | --reconcile';
const SKIP = { state: 'skipped', reason: 'no fixed version to bump to' };

function run(doc, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  try {
    const p = join(dir, 'in.json');
    writeFileSync(p, JSON.stringify(doc));
    const out = [];
    const err = [];
    const code = main([p, ...extra], { env: {}, out: (l) => out.push(l), err: (l) => err.push(l) });
    return { code, out, err };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('no input path prints the usage line and returns 2', () => {
  const err = [];
  const out = [];
  const code = main(['--open'], { env: {}, out: (l) => out.push(l), err: (l) => err.push(l) });
  assert.equal(code, 2);
  assert.deepEqual(err, [USAGE]);
  assert.deepEqual(out, []);
});

test('a missing input file returns 2 with a cannot read message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  try {
    const p = join(dir, 'missing.json');
    const err = [];
    const code = main([p], { env: {}, out: () => {}, err: (l) => err.push(l) });
    assert.equal(code, 2);
    assert.equal(err.length, 1);
    assert.equal(err[0].startsWith(`cannot read ${p}: ENOENT`), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a document without advisories reports no advisories in dry run and returns 0', () => {
  const r = run({});
  assert.deepEqual(r, { code: 0, out: [], err: ['dry run (pass --open to act): no advisories'] });
});

test('an empty advisories list with --open reports no advisories without the dry run prefix', () => {
  const r = run({ advisories: [] }, ['--open']);
  assert.deepEqual(r, { code: 0, out: [], err: ['no advisories'] });
});

test('one advisory without a fix is skipped and counted once', () => {
  const r = run({ advisories: [{ id: 'a1', package: 'p1' }] });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.map((l) => JSON.parse(l)), [{ id: "a1", package: "p1", state: "disabled", reason: "mode=report opens no pull requests", recorded: false }]);
  assert.deepEqual(r.err, ["dry run (pass --open to act): disabled=1"]);
});

test('two skipped advisories are counted as skipped=2', () => {
  const r = run({ advisories: [{ id: 'a1', package: 'p1' }, { id: 'a2', package: 'p2' }] });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.map((l) => JSON.parse(l)), [{ id: "a1", package: "p1", state: "disabled", reason: "mode=report opens no pull requests", recorded: false }, { id: "a2", package: "p2", state: "disabled", reason: "mode=report opens no pull requests", recorded: false }]);
  assert.deepEqual(r.err, ["dry run (pass --open to act): disabled=2"]);
});

test('three skipped advisories with --open are counted as skipped=3', () => {
  const advisories = Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, package: `p${i}` }));
  const r = run({ advisories }, ['--open']);
  assert.equal(r.code, 0);
  assert.equal(r.out.length, 3);
  assert.deepEqual(r.err, ["disabled=3"]);
});
