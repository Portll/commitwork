// bin/security-work-queue.mjs loadBetterleaksContext: the private-store assessment is context when
// present, absent on ENOENT only, and any other read failure refuses.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadBetterleaksContext, BETTERLEAKS_CONTEXT_TITLE } from '../security-work-queue.mjs';

const ENV = 'CW_BETTERLEAKS_ASSESSMENT';
const saved = process.env[ENV];
const scratch = () => mkdtempSync(join(tmpdir(), 'cw-bl-assessment-'));
const dirs = [];
afterEach(() => {
  if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved;
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

test('the override path, set after import, is read as the assessment context', () => {
  const d = scratch(); dirs.push(d);
  const file = join(d, 'assessment.md');
  writeFileSync(file, '# fixture assessment\n');
  process.env[ENV] = file;
  const r = loadBetterleaksContext(d);
  assert.equal(r.path, file);
  assert.deepEqual(r.context, { title: BETTERLEAKS_CONTEXT_TITLE, text: '# fixture assessment\n' });
});

test('without the override the default is the root private store', () => {
  const d = scratch(); dirs.push(d);
  delete process.env[ENV];
  mkdirSync(join(d, 'monitor', 'private'), { recursive: true });
  writeFileSync(join(d, 'monitor', 'private', 'betterleaks-assessment.md'), 'private copy');
  const r = loadBetterleaksContext(d);
  assert.equal(r.path, join(d, 'monitor', 'private', 'betterleaks-assessment.md'));
  assert.equal(r.context.text, 'private copy');
});

test('ENOENT is the legitimately absent state: no context, the path to supply, no throw', () => {
  const d = scratch(); dirs.push(d);
  process.env[ENV] = join(d, 'missing.md');
  const r = loadBetterleaksContext(d);
  assert.equal(r.context, null);
  assert.equal(r.path, join(d, 'missing.md'));
});

test('a read failure other than ENOENT refuses rather than reading as absent', () => {
  const d = scratch(); dirs.push(d);
  process.env[ENV] = d; // a directory: EISDIR
  assert.throws(() => loadBetterleaksContext(d), (e) => {
    assert.match(e.message, /cannot read the Betterleaks assessment/);
    assert.equal(e.cause?.code, 'EISDIR');
    return true;
  });
});
